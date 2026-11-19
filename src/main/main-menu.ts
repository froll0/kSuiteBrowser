import { WebContentsView, type BrowserWindow } from 'electron';
import type { MainMenuData, Rect } from '../shared/types';

const WIDTH = 340;

/** The main menu (⋮), in its own view above the pages, under the button that opens it. */
export class MainMenuPopup {
  private readonly view: WebContentsView;
  private visible = false;
  private hiddenAt = 0;
  private anchor: Rect | null = null;
  private height = 480;
  private readonly ready: Promise<void>;

  constructor(private readonly window: BrowserWindow, paths: { html: string; preload: string }) {
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

  /** Just closed by a click elsewhere, e.g. on the ⋮ button: don't reopen at once. */
  justHidden(): boolean {
    return Date.now() - this.hiddenAt < 300;
  }

  async show(data: MainMenuData, anchor: Rect | null): Promise<void> {
    await this.ready;
    if (this.window.isDestroyed()) return;
    this.anchor = anchor;
    this.place();
    this.view.webContents.send('mainmenu:data', data);
    this.window.contentView.addChildView(this.view);
    this.visible = true;
    this.view.webContents.focus();
  }

  /** New data while open (zoom changed): keeps what is folded open and the selection. */
  refresh(data: MainMenuData): void {
    if (this.visible) this.view.webContents.send('mainmenu:data', data);
  }

  /** The page measured itself (or a section opened). */
  resize(height: number): void {
    if (!Number.isFinite(height)) return;
    this.height = Math.max(120, Math.min(1200, Math.round(height)));
    if (this.visible) this.place();
  }

  private place(): void {
    const [width, height] = this.window.getContentSize();
    const top = this.anchor ? this.anchor.y + this.anchor.height + 4 : 48;
    const w = Math.min(WIDTH, width - 16);
    // Right edge under the right edge of the button.
    const right = this.anchor ? this.anchor.x + this.anchor.width : width - 8;
    const x = Math.max(8, Math.min(right - w, width - w - 8));
    this.view.setBounds({ x: Math.round(x), y: Math.round(top), width: Math.round(w), height: Math.max(120, Math.min(this.height, height - top - 8)) });
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
