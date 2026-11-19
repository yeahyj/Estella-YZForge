import assert from 'node:assert/strict';
import test from 'node:test';
import { UIRouter, type Screen } from '../src/framework/ui/router';
import { Session } from '../src/framework/flow/session';
import { SceneLifetime } from '../src/framework/flow/scene';
import { openPreferences } from '../src/modules/settings/preferences';
import type { SaveStorage, SceneContext } from 'esengine';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function view(layer: Screen['layer'] = 'page') {
  return {
    layer, visible: false, interactive: false, releases: 0, selection: 'first',
    present(visible: boolean, interactive: boolean) { this.visible = visible; this.interactive = interactive; },
    focus(name?: string) { this.selection = name ?? 'first'; },
    focused() { return this.selection; },
    refresh() {}, dispose() { this.releases++; },
  };
}

test('nested modal consumes back and restores the exact control', async () => {
  const views = { home: view(), settings: view(), dialog: view('modal') };
  const router = new UIRouter(async id => views[id as keyof typeof views], () => {});
  await router.open('home');
  views.home.selection = 'OpenSettings';
  await router.open('settings');
  views.settings.selection = 'Reset';
  await router.open('dialog');
  assert.equal(views.settings.visible, true);
  assert.equal(views.settings.interactive, false);
  assert.equal(views.home.visible, false);
  assert(router.back());
  assert.equal(views.settings.selection, 'Reset');
  assert.equal(views.settings.interactive, true);
  assert(router.back());
  assert.equal(views.home.selection, 'OpenSettings');
  assert.equal(router.back(), false);
  assert.equal(views.dialog.releases, 1);
});

test('double open coalesces, cancelled requests release late results without reopening', async () => {
  const late = deferred<Screen>();
  const room = view(), home = view();
  let loads = 0;
  const router = new UIRouter(async id => {
    if (id === 'room') { loads++; return late.promise; }
    return home;
  }, () => {});
  await router.open('home');
  const first = router.open('room');
  assert.equal(router.open('room'), first);
  assert(!home.interactive);
  assert(router.back());
  late.resolve(room);
  await first;
  assert.equal(loads, 1);
  assert.equal(room.releases, 1);
  assert.equal(router.current, 'home');
  assert(home.interactive);
});

test('failure and activation failure keep the previous page available for retry', async () => {
  const home = view(), bad = view(), good = view();
  bad.present = () => { throw Error('invalid content'); };
  let tries = 0;
  const router = new UIRouter(async id => {
    if (id === 'home') return home;
    if (++tries === 1) throw Error('offline');
    return tries === 2 ? bad : good;
  }, () => {});
  await router.open('home');
  await router.open('room');
  assert.equal(router.status?.kind, 'error');
  await router.retry();
  assert.equal(bad.releases, 1);
  assert.equal(router.current, 'home');
  await router.retry();
  assert.equal(router.current, 'room');
  router.dispose();
  assert.equal(home.releases, 1);
  assert.equal(good.releases, 1);
});

test('disposing a world invalidates work that is still in flight', async () => {
  const late = deferred<Screen>(), result = view();
  const router = new UIRouter(() => late.promise, () => {});
  const pending = router.open('home');
  router.dispose();
  late.resolve(result);
  await pending;
  assert.equal(result.releases, 1);
  assert.equal(router.current, undefined);
});

test('pause causes compose, and background time never advances the session', () => {
  const clock = new Session();
  clock.start(); clock.tick(1);
  clock.hold('menu', true); clock.hold('background', true);
  clock.hold('background', false); clock.tick(20); clock.tick(1);
  assert.equal(clock.elapsed, 1);
  clock.hold('menu', false); clock.tick(1); assert.equal(clock.elapsed, 2);
  clock.hold('loading', true); clock.tick(3); assert.equal(clock.elapsed, 2);
  clock.hold('loading', false); clock.stop(); clock.tick(1);
  assert.equal(clock.elapsed, 0);
});

function memory() {
  const values = new Map<string, unknown>();
  const storage: SaveStorage = {
    getJSON<T>(key: string) { return values.get(key) as T | undefined; },
    setJSON(key, value) { values.set(key, structuredClone(value)); },
    has(key) { return values.has(key); }, remove(key) { values.delete(key); },
  };
  return { values, storage };
}

test('overlapping owners of a native scene unload exactly once, before re-entry', async () => {
  const calls: string[] = [];
  const retiring = deferred<void>();
  const lifetime = new SceneLifetime({
    async loadAdditive(name) { calls.push('load ' + name); return {} as SceneContext; },
    async unload(name) { calls.push('unload ' + name); await retiring.promise; },
  }, 'level');
  const [leaveA, leaveB] = await Promise.all([lifetime.acquire(), lifetime.acquire()]);
  await leaveA(); await leaveA();
  assert.deepEqual(calls, ['load level']);
  const last = leaveB(), reopened = lifetime.acquire();
  await Promise.resolve();
  assert.deepEqual(calls, ['load level', 'unload level']);
  retiring.resolve();
  await last;
  const leaveAgain = await reopened;
  assert.deepEqual(calls, ['load level', 'unload level', 'load level']);
  await leaveAgain();
});

test('uses the real engine to migrate an old slot and isolate a second product', async () => {
  const { values, storage } = memory();
  values.set('one:device.settings', { version: 1, savedAt: 1, data: { volume: 0.4 } });
  const first = openPreferences('one', storage), second = openPreferences('two', storage);
  assert.deepEqual(first.value, { volume: 0.4, language: 'zh', largeText: false });
  await first.update(v => ({ ...v, language: 'en' }));
  assert.equal((values.get('one:device.settings') as { version: number }).version, 2);
  assert.equal(openPreferences('one', storage).value.language, 'en');
  assert.equal(second.value.volume, 0.8);
  assert(!values.has('two:device.settings'));
});

test('future and malformed saves retain their original bytes', async () => {
  for (const envelope of [{ version: 9, data: { volume: 0.5 } }, { version: 2, data: {} }, 'invalid']) {
    const { values, storage } = memory();
    values.set('one:device.settings', envelope);
    const prefs = openPreferences('one', storage);
    assert(prefs.readError);
    await assert.rejects(prefs.update(v => ({ ...v, volume: 0 })));
    assert.deepEqual(values.get('one:device.settings'), envelope);
  }
});

test('overlapping writes commit in order, a failed write can be retried', async () => {
  const { storage } = memory();
  let shouldFail = true;
  storage.flush = async () => { if (shouldFail) throw Error('storage unavailable'); };
  const prefs = openPreferences('one', storage);
  await assert.rejects(prefs.update(v => ({ ...v, volume: 0 })));
  assert.equal(prefs.value.volume, 0);
  assert.deepEqual(prefs.value, openPreferences('one', storage).value);
  shouldFail = false;
  await Promise.all([prefs.update(v => ({ ...v, volume: 0.3 })), prefs.update(v => ({ ...v, language: 'en' }))]);
  assert.equal(prefs.value.volume, 0.3);
  assert.equal(openPreferences('one', storage).value.language, 'en');
});
