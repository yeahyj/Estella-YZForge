import { defineSystem, Mut, Name, Query, Res, Schedule,
  type AssetsData, type Entity, type LocalizationAPI, type SceneManagerState, type World } from 'esengine';
import type { Session } from '../../framework/flow/session';
import { GameSession } from '../../framework/flow/resource';
import { SceneLifetime } from '../../framework/flow/scene';
import type { PageHost } from '../../framework/ui/pages';
import type { UIRouter } from '../../framework/ui/router';
import { content } from '../../gen/schema';
import { loadRequired } from '../../framework/content/assets';
import { WorkshopClock } from './workshop-components';

const tableFile = 'assets/data/content_experiences.json';

export function installWorkshop(host: PageHost, router: UIRouter, session: Session, assets: AssetsData,
  locale: LocalizationAPI, experienceId: string, settingsEnabled: boolean, scenes: SceneManagerState, world: World) {
  locale.addCatalog('zh', { room: '样例空间', elapsed: '运行时间 {n} 秒', pause: '暂停', paused: '已暂停',
    resume: '继续', leave: '返回主界面' });
  locale.addCatalog('en', { room: 'Workshop', elapsed: 'Session time  {n} s', pause: 'Pause', paused: 'Paused',
    resume: 'Resume', leave: 'Return home' });
  const t = (key: string) => locale.t(key);
  const sceneName = 'experience.' + experienceId;
  let clock: Entity | undefined;
  scenes.register({
    name: sceneName,
    setup(ctx) {
      clock = ctx.spawn();
      world.insert(clock, Name, { value: 'WorkshopSession' });
      world.insert(clock, WorkshopClock, { experience: experienceId, seconds: 0 });
    },
    cleanup() { clock = undefined; },
    systems: [{ schedule: Schedule.Update, system: defineSystem([Query(Mut(WorkshopClock)), Res(GameSession)], (rows, time) => {
      if (time.running) for (const [, state] of rows) state.seconds = Math.floor(time.elapsed);
    }, { name: 'WorkshopClockSystem' }) }],
  });
  const lifetime = new SceneLifetime(scenes, sceneName);
  host.register({
    id: 'room',
    layer: 'hud',
    acquire: () => lifetime.acquire(),
    asset: async () => {
      const { data } = await loadRequired(assets, tableFile, () => assets.loadJson(tableFile));
      try {
        const experience = new content.Experiences(data).get(experienceId);
        if (!experience) throw new Error('Unknown experience in ' + tableFile + ': ' + experienceId);
        return experience;
      } finally {
        assets.releaseAssets(new Map([['json', new Set([tableFile])]]));
      }
    },
    bind: () => {
      let shown = -1;
      const seconds = () => clock === undefined ? 0 : world.get(clock, WorkshopClock).seconds;
      return {
        enter: () => session.start(), leave: () => session.stop(),
        onBack: () => { void router.open('pause'); },
        text: { RoomTitle: () => t('room'), Elapsed: () => locale.t('elapsed', { n: seconds() }),
          PauseRoom: () => t('pause'), ExitRoom: () => t('leave') },
        buttons: { PauseRoom: { run: () => { void router.open('pause'); } }, ExitRoom: { run: () => { void router.open('home'); } } },
        tick: () => {
          const now = seconds();
          if (now === shown) return false;
          shown = now;
          return true;
        },
      };
    },
  });
  host.register({
    id: 'pause', asset: { prefab: 'assets/boot/pause.esprefab' },
    bind: () => ({
      enter: () => session.hold('menu', true), leave: () => session.hold('menu', false),
      text: { PauseTitle: () => t('paused'), Resume: () => t('resume'), PauseSettings: () => t('settings'), LeaveRoom: () => t('leave') },
      buttons: { Resume: { run: () => router.back() }, PauseSettings: { available: () => settingsEnabled, run: () => { void router.open('settings'); } },
        LeaveRoom: { run: () => { void router.open('home'); } } },
    }),
  });
}
