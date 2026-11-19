import {
  Name, percent, px, setUIVisible, spawnUIEntity, Text, UIPointerEvents, UIVisualType,
  type Entity, type World,
} from 'esengine';

export function mountLayers(world: World, canvas: Entity) {
  const layer = (name: string) => {
    const entity = spawnUIEntity({ world, parent: canvas, node: { fill: true } });
    world.insert(entity, Name, { value: name });
    return entity;
  };
  const hud = layer('HudLayer'), page = layer('PageLayer'), modal = layer('ModalLayer');
  const notice = spawnUIEntity({ world, parent: canvas,
    node: { position: 1, insetLeft: percent(20), insetBottom: px(8), width: percent(60), height: px(38),
      pointerEvents: UIPointerEvents.None },
    visual: { visualType: UIVisualType.SolidColor, color: { r: 0.1, g: 0.22, b: 0.21, a: 1 } },
    text: { content: '', align: 1, verticalAlign: 1, fontSize: 18 } });
  world.insert(notice, Name, { value: 'Toast' });
  setUIVisible(world, notice, false);
  const overlay = layer('LoadingLayer');
  let remaining = 0;
  return {
    hud, page, modal, overlay,
    toast(message: string) {
      world.insert(notice, Text, { ...world.get(notice, Text), content: message });
      setUIVisible(world, notice, true);
      remaining = 1.8;
    },
    tick(unscaledSeconds: number) {
      if (remaining <= 0) return;
      remaining -= unscaledSeconds;
      if (remaining <= 0) setUIVisible(world, notice, false);
    },
  };
}

export type UILayers = ReturnType<typeof mountLayers>;
