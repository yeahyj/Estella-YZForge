import {
  Focusable, Interactable, Text, UIPages, UIInteraction, UIVisual, setEntityActive, setUIVisible,
  type AssetsData, type Entity, type FocusManagerState, type PageHandle, type UIEventQueue, type World,
} from 'esengine';
import { acquireGroup, loadRequired } from '../content/assets';
import type { Progress, Screen } from './router';
import type { UILayers } from './layers';

export interface PageAsset { prefab: string; group?: string; }
export interface Action { run(): void; available?(): boolean; enabled?(): boolean; }
export interface PageBindings {
  text: Record<string, () => string>;
  buttons: Record<string, Action>;
  enter?(): void;
  leave?(): void;
  dispose?(): void;
  onBack?(): void;
  /** Return true when a time-dependent label has changed. */
  tick?(seconds: number): boolean;
}
export interface PageDefinition {
  id: string;
  asset: PageAsset | (() => Promise<PageAsset>);
  layer?: Screen['layer'];
  acquire?(): Promise<() => Promise<void>>;
  bind(page: PageHandle): PageBindings;
}

export class PageHost {
  private readonly definitions = new Map<string, PageDefinition>();

  constructor(private readonly world: World, private readonly layers: UILayers,
    private readonly assets: AssetsData, private readonly events: UIEventQueue,
    private readonly focus: FocusManagerState, private readonly textScale: () => number) {}

  register(def: PageDefinition): void {
    if (this.definitions.has(def.id)) throw new Error('Duplicate page ID: ' + def.id);
    this.definitions.set(def.id, def);
  }

  async open(id: string, progress: Progress, active: () => boolean): Promise<Screen> {
    const def = this.definitions.get(id);
    if (!def) throw new Error('Unknown page: ' + id);
    const source = typeof def.asset === 'function' ? await def.asset() : def.asset;
    const { assets, world } = this;
    const layer = def.layer ?? 'page';
    const parent = this.layers[layer];
    const check = () => {
      if (!active() || !world.valid(parent)) throw new Error('Page request expired: ' + id);
    };
    check();
    const bundle = source.group ? await acquireGroup(assets, source.group, progress) : undefined;
    const pages = new UIPages(world, assets);
    const cleanup: (() => void)[] = [];
    if (bundle) cleanup.push(() => bundle.release());
    const dispose = () => { while (cleanup.length) cleanup.pop()!(); };
    try {
      check();
      pages.register(id, { prefab: source.prefab, parent: () => { check(); return parent; }, onClose: 'destroy' });
      await loadRequired(assets, source.prefab, () => pages.preload(id));
      // UIPages caches the prefab data internally. This owner acquired its own typed reference.
      cleanup.push(() => assets.releaseAssets(new Map([['prefab', new Set([source.prefab])]])));
      check();
      const page = await pages.open(id);
      cleanup.push(() => pages.close(id));
      check();
      setEntityActive(world, page.root, false);
      if (def.acquire) {
        const release = await def.acquire();
        cleanup.push(() => { void release().catch(error => console.error('Releasing ' + id, error)); });
        check();
      }
      const bindings = def.bind(page);
      if (bindings.dispose) cleanup.push(() => bindings.dispose!());
      const node = (name: string) => {
        const entity = page.find(name);
        if (entity === undefined) throw new Error(id + ' is missing prefab node ' + name);
        return entity;
      };
      const labels = Object.entries(bindings.text).map(([name, read]) => {
        const entity = node(name);
        if (!world.has(entity, Text)) throw new Error(id + '/' + name + ' needs Text');
        return { entity, read, size: world.get(entity, Text).fontSize };
      });
      let interactive = false;
      let entered = false;
      cleanup.push(() => { if (entered) bindings.leave?.(); });
      const controls = Object.entries(bindings.buttons).map(([name, action]) => {
        const entity = node(name);
        if (!world.has(entity, Interactable) || !world.has(entity, Focusable)) {
          throw new Error(id + '/' + name + ' needs Interactable and Focusable');
        }
        cleanup.push(this.events.on(entity, 'click', () => {
          if (interactive && (action.available?.() ?? true) && (action.enabled?.() ?? true)) action.run();
        }));
        return { entity, name, action, color: { ...world.get(entity, UIVisual).color }, highlighted: false };
      });
      const refresh = () => {
        for (const { entity, action } of controls) {
          const available = action.available?.() ?? true;
          if (action.available) setUIVisible(world, entity, available);
          const control = world.get(entity, Interactable);
          const enabled = interactive && available && (action.enabled?.() ?? true);
          if (control.enabled !== enabled) world.insert(entity, Interactable, { ...control, enabled });
        }
        for (const { entity, read, size } of labels) {
          const text = world.get(entity, Text);
          const content = read();
          const fontSize = Math.round(size * this.textScale());
          if (text.content !== content || text.fontSize !== fontSize) {
            world.insert(entity, Text, { ...text, content, fontSize });
          }
        }
      };
      return {
        layer,
        onBack: bindings.onBack,
        present: (visible, enabled) => {
          if (!entered && enabled) { entered = true; bindings.enter?.(); }
          interactive = enabled;
          setEntityActive(world, page.root, visible);
          refresh();
        },
        focused: () => controls.find(c => c.entity === this.focus.focusedEntity)?.name,
        focus: name => {
          const available = controls.filter(c => (c.action.available?.() ?? true) && (c.action.enabled?.() ?? true));
          const next = available.find(c => c.name === name) ?? available[0];
          if (next) this.focus.focus(next.entity); else this.focus.blur();
        },
        refresh,
        tick: delta => {
          if (bindings.tick?.(delta)) refresh();
          for (const control of controls) {
            const { entity, color } = control;
            const highlight = this.focus.isVisiblyFocused(entity) || world.get(entity, UIInteraction).hovered;
            if (highlight === control.highlighted) continue;
            control.highlighted = highlight;
            world.insert(entity, UIVisual, { ...world.get(entity, UIVisual),
              color: highlight ? { r: color.r + 0.09, g: color.g + 0.11, b: color.b + 0.1, a: color.a } : color });
          }
        },
        dispose,
      };
    } catch (error) { dispose(); throw error; }
  }
}
