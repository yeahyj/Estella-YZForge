export interface Screen {
  layer: 'hud' | 'page' | 'modal';
  present(visible: boolean, interactive: boolean): void;
  focus(name?: string): void;
  focused(): string | undefined;
  refresh(): void;
  onBack?(): void;
  tick?(seconds: number): void;
  dispose(): void;
}

export type Progress = (loaded: number, total: number) => void;
export type NavigationStatus =
  | { kind: 'loading'; id: string; loaded: number; total: number }
  | { kind: 'error'; id: string; cause: unknown };

interface Entry {
  id: string;
  screen: Screen;
  savedFocus?: string;
}

/** Only a committed screen joins the stack. A cancelled load still owns its eventual cleanup. */
export class UIRouter {
  private readonly stack: Entry[] = [];
  private attempt = 0;
  private pending?: Promise<void>;
  private closed = false;
  status: NavigationStatus | null = null;

  constructor(
    private readonly load: (id: string, progress: Progress, active: () => boolean) => Promise<Screen>,
    private readonly notify: (status: NavigationStatus | null, canGoBack: boolean) => void,
  ) {}

  get current(): string | undefined { return this.top?.id; }
  private get top(): Entry | undefined { return this.stack[this.stack.length - 1]; }

  open(id: string): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.status?.kind === 'loading' && this.status.id === id && this.pending) return this.pending;
    return this.pending = this.navigate(id);
  }

  private async navigate(id: string): Promise<void> {
    if (!this.status && this.top) this.top.savedFocus = this.top.screen.focused();
    const token = ++this.attempt;
    const active = () => !this.closed && this.attempt === token;
    const existing = this.stack.findIndex(entry => entry.id === id);
    if (existing >= 0) {
      while (this.stack.length > existing + 1) this.stack.pop()!.screen.dispose();
      this.settle();
      return;
    }

    const progress: Progress = (loaded, total) => {
      if (!active()) return;
      this.status = { kind: 'loading', id, loaded, total };
      this.notify(this.status, this.stack.length > 0);
    };
    progress(0, 0);
    this.display();
    try {
      const screen = await this.load(id, progress, active);
      if (!active()) { screen.dispose(); return; }
      this.stack.push({ id, screen });
      try {
        this.settle();
      } catch (error) {
        this.stack.pop();
        screen.dispose();
        throw error;
      }
    } catch (cause) {
      if (!active()) return;
      this.status = { kind: 'error', id, cause };
      this.notify(this.status, this.stack.length > 0);
      this.display();
    }
  }

  back(): boolean {
    if (this.closed || !this.top) return false;
    if (!this.status && this.top.screen.onBack) { this.top.screen.onBack(); return true; }
    if (!this.status && this.stack.length === 1) return false;
    ++this.attempt;
    if (!this.status) this.stack.pop()!.screen.dispose();
    this.settle();
    return true;
  }

  retry(): Promise<void> | undefined {
    if (this.status?.kind === 'error') return this.open(this.status.id);
  }

  refresh(): void { for (const entry of this.stack) entry.screen.refresh(); }

  tick(seconds: number): void {
    if (!this.closed && !this.status) this.top?.screen.tick?.(seconds);
  }

  dispose(): void {
    this.closed = true;
    ++this.attempt;
    while (this.stack.length) this.stack.pop()!.screen.dispose();
    this.status = null;
  }

  private settle(): void {
    this.status = null;
    this.notify(null, false);
    this.display();
    this.top?.screen.focus(this.top.savedFocus);
  }

  private display(): void {
    let visible = true;
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const screen = this.stack[i].screen;
      screen.present(visible, !this.status && i === this.stack.length - 1);
      if (screen.layer !== 'modal') visible = false;
    }
  }
}
