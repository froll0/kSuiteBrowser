import { WebContentsView, type BrowserWindow } from 'electron';
import type { PaletteData } from '../shared/types';

const WIDTH = 620;
const HEIGHT = 460;

/** The command palette (Ctrl+K), in its own view above the pages, centred near the top of the window. */
export class CommandPalette {
  private readonly view: WebContentsView;
  private visible = false;
  private hiddenAt = 0;
  private readonly ready: Promise<void>;

  constructor(private readonly window: BrowserWindow, paths: { html: string; preload: string }, private readonly top: () => number) {
    this.view = new WebContentsView({ webPreferences: { preload: paths.preload, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.view.setBackgroundColor('#00000000');
    this.ready = this.view.webContents.loadFile(paths.html).catch(() => {});
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.on('will-navigate', (e) => e.preventDefault());
    this.view.webContents.on('blur', () => this.hide());
  }

  get contents() {
    return this.view.webContents;
  }

  isVisible(): boolean {
    return this.visible;
  }

  justHidden(): boolean {
    return Date.now() - this.hiddenAt < 300;
  }

  async show(data: PaletteData): Promise<void> {
    await this.ready;
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const top = Math.round(this.top() + 6);
    const w = Math.min(WIDTH, width - 16);
    this.view.setBounds({ x: Math.round((width - w) / 2), y: top, width: w, height: Math.max(180, Math.min(HEIGHT, height - top - 12)) });
    this.view.webContents.send('palette:data', data);
    this.window.contentView.addChildView(this.view);
    this.visible = true;
    this.view.webContents.focus();
  }

  hide(): void {
    if (!this.visible || this.window.isDestroyed()) return;
    this.window.contentView.removeChildView(this.view);
    this.visible = false;
    this.hiddenAt = Date.now();
  }

  destroy(): void {
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
