import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const mode = process.argv[2];
if (!['smoke', 'export'].includes(mode)) throw new Error('Use editor.mjs smoke or export');
const relativeBridge = 'resources/app.asar.unpacked/dist-electron/mcp/editor-mcp.mjs';
const bridge = [
  process.env.ESTELLA_MCP_SCRIPT,
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'estella-editor', relativeBridge),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs/@estella/editor', relativeBridge),
  '/Applications/Estella Editor.app/Contents/' + relativeBridge.replace('resources/', 'Resources/'),
].find(path => path && existsSync(path));
if (!bridge) throw new Error('Set ESTELLA_MCP_SCRIPT to the installed editor-mcp.mjs');
const child = spawn(process.execPath, [bridge, '--attach', '--instance', process.cwd(), '--all-tools'],
  { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
const pending = new Map();
let sequence = 0;
const lines = createInterface({ input: child.stdout });
lines.on('line', line => {
  const message = JSON.parse(line);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timer);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});
child.on('exit', () => {
  for (const request of pending.values()) {
    clearTimeout(request.timer);
    request.reject(new Error('Editor connection closed'));
  }
  pending.clear();
});
const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
function rpc(method, params) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 120_000);
    pending.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}
async function tool(name, args = {}) {
  const reply = await rpc('tools/call', { name, arguments: args });
  const value = reply.content.find(entry => entry.type === 'text')?.text ?? '';
  if (reply.isError || /^error:/i.test(value)) throw new Error(name + ' ' + value);
  try { return JSON.parse(value); } catch { return value; }
}

async function click(target) {
  // Scene data arrives in wall time. Let the next layout commit before resolving the button.
  for (let attempt = 0; ; attempt++) {
    try { await tool('click_ui', { target }); return; }
    catch (error) {
      if (attempt >= 30 || !/no entity|zero size|nothing in the UI|not found|no .*named|no .*match/i.test(error.message)) throw error;
      await tool('step', { frames: 3 });
    }
  }
}

async function checkSession() {
  const seconds = async () => (await tool('inspect_entity', { entity: 'WorkshopSession' })).components.WorkshopClock.seconds;
  await tool('set_play', { state: 'playing' });
  try {
    await tool('step', { frames: 15 });
    await click('StartExperience');
    await click('PauseRoom');
    await tool('step', { frames: 10 });
    const paused = await seconds();
    await tool('step', { frames: 120 });
    if (await seconds() !== paused) throw new Error('Paused scene advanced');
    await click('Resume');
    await tool('step', { frames: 120 });
    if (await seconds() <= paused) throw new Error('Resumed scene stayed frozen');
    await click('ExitRoom');
    await tool('step', { frames: 4 });
    try {
      await tool('inspect_entity', { entity: 'WorkshopSession' });
      throw new Error('Scene entity survived unload');
    } catch (error) { if (!/no entity named/.test(error.message)) throw error; }
    console.log('Native scene loaded, paused, resumed and released.');
  } finally { await tool('set_play', { state: 'stopped' }); }
}

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'template-check', version: '1' } });
  send({ method: 'notifications/initialized' });
  if (mode === 'export') {
    const result = await tool('export_game', { platform: 'web', debugChannel: false });
    if (!result.ok) throw new Error(JSON.stringify(result));
    console.log('Web export:', result.outDir, 'initial bytes:', result.size.initialBytes, 'on-demand bytes:', result.size.lazyBytes);
    for (const warning of result.warnings) console.warn(warning);
  } else {
    const result = await tool('verify', { acceptance: 'acceptance/framework.case' });
    if (!result.pass) throw new Error(JSON.stringify(result.checks, null, 2));
    console.log(result.summary);
    if (JSON.parse(readFileSync('package.json', 'utf8')).gameTemplate.experience === 'workshop') await checkSession();
  }
} finally {
  lines.close();
  child.stdin.end();
  child.kill();
}
