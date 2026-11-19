import {
  addPlugin, addSystemToSchedule, Assets, Audio, defineSystem, FocusManager, getPlatform, GetWorld, Input,
  InputMap, Localization, LocalizationPlugin, Res, SceneManager, Schedule, Time, UIEvents, type LocalizationAPI, type SceneManagerState,
  type AssetsData, type AudioAPI, type Entity, type FocusManagerState, type InputState, type UIEventQueue, type World,
} from 'esengine';
import type { Session } from '../framework/flow/session';
import { GameSession, sessionPlugin } from '../framework/flow/resource';
import { makeLoadStatus } from '../framework/ui/load-status';
import { mountLayers } from '../framework/ui/layers';
import { PageHost } from '../framework/ui/pages';
import { UIRouter } from '../framework/ui/router';
import { installSettings } from '../modules/settings/pages';
import { openPreferences } from '../modules/settings/preferences';
import { installWorkshop } from '../game/features/workshop';
import { product } from './product';

function mount(world: World, canvas: Entity, assets: AssetsData, events: UIEventQueue,
  focus: FocusManagerState, audio: AudioAPI, locale: LocalizationAPI, session: Session, scenes: SceneManagerState) {
  locale.addCatalog('zh', { home: '工作台', start: '进入样例空间', settings: '设置', back: '返回', retry: '重试',
    loading: '正在加载', loadError: '内容加载失败', keys: 'Tab 切换    Enter 确认    Esc 返回' });
  locale.addCatalog('en', { home: 'Workbench', start: 'Enter workshop', settings: 'Settings', back: 'Back', retry: 'Retry',
    loading: 'Loading', loadError: 'Could not load this content', keys: 'Tab to navigate    Enter to select    Esc to go back' });
  const t = (key: string) => locale.t(key);
  const prefs = product.settings ? openPreferences(product.id) : undefined;
  const layers = mountLayers(world, canvas);
  const host = new PageHost(world, layers, assets, events, focus, () => prefs?.value.largeText ? 1.2 : 1);
  let overlay: ReturnType<typeof makeLoadStatus> | undefined;
  const router: UIRouter = new UIRouter((id, progress, active) => host.open(id, progress, active), (status, canGoBack) => {
    session.hold('loading', !!status);
    if (status) {
      overlay ??= makeLoadStatus(world, layers.overlay, events, focus, router, t, s => {
        if (s.kind === 'error') console.warn('[' + product.id + ' ' + product.build + '] page=' + s.id, s.cause);
      });
      overlay.show(status, canGoBack);
    } else {
      overlay?.dispose();
      overlay = undefined;
    }
  });
  const stopSettings = prefs ? installSettings(host, router, locale, audio, prefs, layers.toast) : undefined;
  if (product.experience) installWorkshop(host, router, session, assets, locale, product.experience, !!prefs, scenes, world);
  host.register({
    id: 'home', asset: { prefab: 'assets/boot/home.esprefab' },
    bind: () => ({
      text: { HomeTitle: () => t('home'), StartExperience: () => t('start'), OpenSettings: () => t('settings'), HomeHelp: () => t('keys') },
      buttons: {
        StartExperience: { available: () => !!product.experience, run: () => { void router.open('room'); } },
        OpenSettings: { available: () => !!prefs, run: () => { void router.open('settings'); } },
      },
    }),
  });
  const inputMap = new InputMap({ back: { type: 'button', bindings: [
    { kind: 'key', code: 'Escape' }, { kind: 'gpButton', button: 1 },
  ] } });
  const platform = getPlatform();
  const offHide = platform.onAppHide?.(() => session.hold('background', true));
  const offShow = platform.onAppShow?.(() => session.hold('background', false));
  void router.open('home');
  return {
    update(input: InputState, delta: number, unscaledDelta: number) {
      inputMap.evaluate(input);
      if (inputMap.pressed('back')) router.back();
      session.tick(delta);
      router.tick(delta);
      layers.tick(unscaledDelta);
    },
    dispose() {
      stopSettings?.();
      offHide?.();
      offShow?.();
      router.dispose();
      overlay?.dispose();
      session.hold('loading', false);
      session.hold('background', false);
    },
  };
}

export function startApplication(): void {
  addPlugin(new LocalizationPlugin({ locale: 'zh', fallback: 'en' }));
  addPlugin(sessionPlugin);
  const instances = new WeakMap<World, ReturnType<typeof mount>>();
  addSystemToSchedule(Schedule.Update, defineSystem(
    [GetWorld(), Res(Assets), Res(UIEvents), Res(FocusManager), Res(Audio), Res(Input), Res(Time), Res(Localization), Res(GameSession), Res(SceneManager)],
    (world, assets, events, focus, audio, input, time, locale, session, scenes) => {
      let app = instances.get(world);
      if (!app) {
        // The scene can finish loading after startup systems first run.
        const canvas = world.findEntityByName('AppCanvas');
        if (canvas === null) return;
        app = mount(world, canvas, assets, events, focus, audio, locale, session, scenes);
        instances.set(world, app);
        const off = world.onDespawn(entity => {
          if (entity !== canvas) return;
          off();
          instances.get(world)?.dispose();
          instances.delete(world);
        });
      }
      app.update(input, time.delta, time.unscaledDelta);
    }, { name: 'TemplateApplication' },
  ));
}
