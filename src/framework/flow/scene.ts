import type { SceneManagerState } from 'esengine';

/** Share a native scene until the last caller leaves. Serialize load/unload across rapid re-entry. */
export class SceneLifetime {
  private tail = Promise.resolve();
  private owners = 0;
  constructor(private readonly scenes: Pick<SceneManagerState, 'loadAdditive' | 'unload'>, private readonly name: string) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => {}, () => {});
    return result;
  }

  acquire(): Promise<() => Promise<void>> {
    return this.enqueue(async () => {
      if (!this.owners) await this.scenes.loadAdditive(this.name);
      this.owners++;
      let held = true;
      return () => this.enqueue(async () => {
        if (!held) return;
        held = false;
        if (--this.owners === 0) await this.scenes.unload(this.name);
      });
    });
  }
}
