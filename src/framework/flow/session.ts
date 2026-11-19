/** The simulation has its own lifetime. A device resume cannot dismiss a player's pause menu. */
export class Session {
  private pauses = new Set<'menu' | 'loading' | 'background'>();
  private started = false;
  private skipResumeFrame = false;
  elapsed = 0;

  get running(): boolean { return this.started && this.pauses.size === 0; }
  start(): void { this.elapsed = 0; this.started = true; }
  stop(): void { this.started = false; this.elapsed = 0; }
  hold(reason: 'menu' | 'loading' | 'background', paused: boolean): void {
    if (paused) this.pauses.add(reason);
    else if (this.pauses.delete(reason) && reason === 'background') this.skipResumeFrame = true;
  }
  tick(delta: number): void {
    if (this.skipResumeFrame) { this.skipResumeFrame = false; return; }
    if (this.running && Number.isFinite(delta) && delta > 0) this.elapsed += delta;
  }
}
