import {
  createButton, Name, percent, px, setEntityActive, spawnUIEntity, Text, UIVisualType,
  type Entity, type FocusManagerState, type UIEventQueue, type World,
} from 'esengine';
import type { NavigationStatus, UIRouter } from './router';

/** Stays usable even when the first prefab or a downloadable group fails to load. */
export function makeLoadStatus(world: World, parent: Entity, events: UIEventQueue,
  focus: FocusManagerState, router: UIRouter, t: (key: string) => string, report: (status: NavigationStatus) => void) {
  const root = spawnUIEntity({ world, parent, node: { fill: true },
    visual: { visualType: UIVisualType.SolidColor, color: { r: 0.045, g: 0.085, b: 0.10, a: 1 } } });
  world.insert(root, Name, { value: 'LoadStatus' });
  const label = spawnUIEntity({ world, parent: root,
    node: { position: 1, insetLeft: percent(10), insetTop: percent(32), width: percent(80), height: px(72) },
    text: { content: '', align: 1, verticalAlign: 1, fontSize: 25 } });
  world.insert(label, Name, { value: 'LoadMessage' });
  const button = (name: string, left: number, run: () => void) => {
    const handle = createButton({ world, events, parent: root,
      node: { position: 1, insetLeft: percent(left), insetTop: percent(55), width: percent(28), height: px(50) },
      onClick: run });
    world.insert(handle.entity, Name, { value: name });
    const text = spawnUIEntity({ world, parent: handle.entity, node: { fill: true },
      text: { content: '', align: 1, verticalAlign: 1, fontSize: 19 } });
    return { handle, text };
  };
  const retry = button('RetryLoad', 19, () => { void router.retry(); });
  const cancel = button('CancelLoad', 53, () => { router.back(); });
  const write = (entity: Entity, content: string) => world.insert(entity, Text, { ...world.get(entity, Text), content });
  return {
    show(status: NavigationStatus, canGoBack: boolean) {
      const failed = status.kind === 'error';
      if (failed) report(status);
      const pct = !failed && status.total > 0 ? ' ' + Math.round(100 * status.loaded / status.total) + '%' : '';
      write(label, t(failed ? 'loadError' : 'loading') + pct);
      write(retry.text, t('retry'));
      write(cancel.text, t('back'));
      setEntityActive(world, retry.handle.entity, failed);
      setEntityActive(world, cancel.handle.entity, canGoBack);
      if (failed) focus.focus(retry.handle.entity); else if (canGoBack) focus.focus(cancel.handle.entity);
    },
    dispose() {
      retry.handle.dispose();
      cancel.handle.dispose();
      if (world.valid(root)) world.despawn(root);
    },
  };
}
