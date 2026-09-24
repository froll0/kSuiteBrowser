import { WebContentsView, type BrowserWindow } from 'electron';
import type { Rect, TabSearchData } from '../shared/types';

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
    top: () => number,
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

  /** Default distance from the top (below the first row), when not opened from a button. */
  private top: () => number;

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

  async show(data: Omit<TabSearchData, 'reset'>, anchor?: Rect): Promise<void> {
    await this.ready;
    if (this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const rows = data.tabs.length + Math.min(5, data.closed.length) + data.remote.reduce((n, d) => n + Math.min(8, d.tabs.length) + 1, 0);
    const wanted = 58 + rows * 44 + (data.closed.length ? 64 : 32) + 12;
    const top = anchor ? anchor.y + anchor.height + 4 : this.top() + 2;
    const h = Math.max(160, Math.min(MAX_HEIGHT, wanted, height - top - 8));
    // Under the button that opened it (aligned on its right edge), else centred under the first row.
    const x = anchor ? anchor.x + anchor.width - WIDTH : (width - WIDTH) / 2;
    this.view.setBounds({ x: Math.round(Math.max(8, Math.min(x, width - WIDTH - 8))), y: Math.round(top), width: Math.min(WIDTH, width), height: h });
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
