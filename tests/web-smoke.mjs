import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const root = resolve(process.argv[2] || 'dist-web');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const { gameTemplate } = await json(new URL('../package.json', import.meta.url));
const settingsSlot = gameTemplate.id + ':device.settings';
const manifest = await json(resolve(root, 'asset-manifest.json'));
const entries = Object.entries(manifest.groups).flatMap(([group, { assets }]) =>
  Object.values(assets).map(asset => ({ ...asset, group })));
for (const asset of entries) {
  assert(!asset.address || asset.address.startsWith('assets/'), 'Authoring file shipped: ' + asset.address);
}
const pageAsset = name => {
  const asset = entries.find(entry => entry.address?.endsWith('/' + name + '.esprefab'));
  assert(asset, 'Missing exported prefab: ' + name);
  return asset;
};
const home = pageAsset('home'), room = pageAsset('room');
assert.equal(manifest.groups[room.group].bundleMode, 'lazy');
assert.equal(manifest.groups[home.group].bundleMode, 'local');
const gameConfig = await json(resolve(root, 'game.config.json'));
assert(!gameConfig.debugChannel, 'Run the smoke test against a shipping Web export.');
const width = gameConfig.screenFit.designWidth, height = gameConfig.screenFit.designHeight;

// Drive the authored controls at their design resolution, using the shipped prefab layout.
const points = new Map();
for (const asset of ['home', 'room', 'pause', 'settings', 'reset'].map(pageAsset)) {
  const prefab = await json(resolve(root, asset.path));
  const rects = new Map();
  const dim = (d, extent) => d.unit === 1 ? extent * d.value / 100 : d.value;
  for (const node of prefab.entities) {
    const layout = node.components.find(c => c.type === 'UINode')?.data;
    if (!layout) continue;
    const parent = rects.get(node.parent) ?? { x: 0, y: 0, width, height };
    const rect = { x: parent.x + dim(layout.insetLeft, parent.width), y: parent.y + dim(layout.insetTop, parent.height),
      width: dim(layout.width, parent.width), height: dim(layout.height, parent.height) };
    rects.set(node.prefabEntityId, rect);
    points.set(node.name, [rect.x + rect.width / 2, rect.y + rect.height / 2]);
  }
}

const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }).end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
    headless: true, args: ['--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(12_000);
  const errors = [];
  const warnings = [];
  let packRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'warning') warnings.push(msg.text()); });
  page.on('request', request => { if (request.url().endsWith('/' + room.path)) packRequests++; });
  const frames = (n = 4) => page.evaluate(count => new Promise(resolve => {
    function frame() { if (--count <= 0) resolve(); else requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
  }), n);
  async function loadHome() {
    const ready = page.waitForResponse(r => r.url().endsWith('/' + home.path) && r.ok());
    await page.goto(origin);
    await ready;
    await page.locator('#es-splash').waitFor({ state: 'detached' });
    await frames();
  }
  const tap = async (x, y) => { await page.mouse.click(x, y, { delay: 90 }); await frames(); };
  const click = async name => { assert(points.has(name), name); await tap(...points.get(name)); };
  const back = async () => { await page.keyboard.press('Escape', { delay: 90 }); await frames(); };
  const waitPrefs = async (field, expected) => {
    await page.waitForFunction(([slot, field, expected]) => {
      const key = Object.keys(localStorage).find(k => k.endsWith(slot));
      return key && JSON.parse(localStorage.getItem(key)).data[field] === expected;
    }, [settingsSlot, field, expected]);
  };

  await loadHome();
  assert.equal(packRequests, 0, 'Home eagerly requested the on-demand content');
  const coldStartMs = Math.round(await page.evaluate(() => performance.now()));
  const homeImage = await page.screenshot();

  // Hold a real request, cancel from the UI and then deliver the stale bytes.
  let deliver;
  const held = new Promise(resolve => { deliver = resolve; });
  const matcher = '**/' + room.path;
  await page.route(matcher, async route => { await held; await route.continue(); });
  const requested = page.waitForRequest(matcher);
  await click('StartExperience'); await requested;
  await back();
  const arrived = page.waitForResponse(matcher);
  deliver(); await arrived; await frames();
  await page.unroute(matcher);
  await click('OpenSettings');
  await click('Language'); await waitPrefs('language', 'en');
  await click('Reset'); await back();
  await click('Louder'); await waitPrefs('volume', 0.9);
  await click('TextSize'); await waitPrefs('largeText', true);
  await loadHome();
  await click('OpenSettings');
  await click('Language'); await waitPrefs('language', 'zh');
  await click('Reset'); await click('ConfirmReset'); await waitPrefs('volume', 0.8);
  await waitPrefs('largeText', false);
  await back();

  // A fresh app realm has no cached bundle. Fail delivery, then retry the same route.
  await loadHome();
  let offline = true;
  await page.route(matcher, route => offline ? route.fulfill({ status: 503, body: 'offline' }) : route.continue());
  const failed = page.waitForEvent('console', { predicate: msg => msg.text().includes('page=room') });
  await click('StartExperience'); await failed; await frames();
  offline = false;
  const recovered = page.waitForResponse(r => r.url().endsWith('/' + room.path) && r.ok());
  await tap(width * 0.33, height * 0.55 + 25); await recovered; await frames();
  assert(!homeImage.equals(await page.screenshot()), 'Room and home frames were identical');
  const frameP95 = await page.evaluate(async () => {
    const samples = [];
    let last = await new Promise(requestAnimationFrame);
    while (samples.length < 60) {
      const now = await new Promise(requestAnimationFrame);
      samples.push(now - last);
      last = now;
    }
    return samples.sort((a, b) => a - b)[56];
  });
  const pauseReady = page.waitForResponse(r => r.url().endsWith('/' + pageAsset('pause').path) && r.ok());
  await click('PauseRoom'); await pauseReady; await frames();
  await click('PauseSettings'); await click('Louder'); await waitPrefs('volume', 0.9);
  await back(); await click('Resume'); await click('ExitRoom');
  await click('OpenSettings'); await click('Quieter'); await waitPrefs('volume', 0.8);
  assert.deepEqual(errors, []);
  assert.equal(warnings.filter(msg => msg.includes('] page=') && !msg.includes('page=room')).length, 0);
  console.log('Web smoke passed: lazy delivery, late cancellation, retry, pause, modal back, settings after reload.');
  console.log('Chrome ' + browser.version() + ', ' + width + '×' + height + ', cold home including splash: ' + coldStartMs +
    ' ms, room rAF p95 (60 intervals): ' + frameP95.toFixed(1) + ' ms.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
