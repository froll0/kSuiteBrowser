import { WebContentsView, type BrowserWindow } from 'electron';
import type { TabSearchData } from '../shared/types';

const WIDTH = 460;
const MAX_HEIGHT = 560;

/** The "search tabs" list, in its own view above the pages (like the address bar suggestions). */
export class TabSearchPopup {
  private readonly view: WebContentsView;
  private visible = false;
  private hiddenAt = 0;
  private ready: Promise<void>;

  constructor(
    private readonly window: BrowserWindow,
    paths: { html: string; preload: string },
    top: number,
  ) {
    this.view = new WebContentsView({
      webPreferences: { preload: paths.preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.view.setBackgroundColor('#00000000');
    this.ready = this.view.webContents.loadFile(paths.html).catch(() => {});
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.on('will-navigate', (e) => e.preventDefault());
    // Clicking anywhere else closes it.
    this.view.webContents.on('blur', () => this.hide());
    this.top = top;
  }

  private top: number;

  get contents() {
    return this.view.webContents;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Just closed by a click elsewhere, e.g. on the button that toggles it: don't reopen at once. */
  justHidden(): boolean {
    return Date.now() - this.hiddenAt < 300;
  }

  async show(data: Omit<TabSearchData, 'reset'>): Promise<void> {
    await this.ready;
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const rows = data.tabs.length + Math.min(5, data.closed.length) + data.remote.reduce((n, d) => n + Math.min(8, d.tabs.length) + 1, 0);
    const wanted = 58 + rows * 44 + (data.closed.length ? 64 : 32) + 12;
    const h = Math.max(160, Math.min(MAX_HEIGHT, wanted, height - this.top - 8));
    // Right-aligned under the tab strip, like the button that opens it.
    this.view.setBounds({ x: Math.max(0, width - WIDTH - 8), y: this.top + 2, width: Math.min(WIDTH, width), height: h });
    this.view.webContents.send('tabsearch:data', { ...data, reset: !this.visible });
    this.window.contentView.addChildView(this.view);
    this.visible = true;
    this.view.webContents.focus();
  }

  /** New data while open (a tab was closed): keeps the query. */
  refresh(data: Omit<TabSearchData, 'reset'>): void {
    if (this.visible) this.view.webContents.send('tabsearch:data', { ...data, reset: false });
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
