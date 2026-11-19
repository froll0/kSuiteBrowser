import { WebContentsView, type BrowserWindow } from 'electron';
import type { MainMenuData, Rect } from '../shared/types';

/** Where a menu opens: under a button (its left or right edge), or at a point (the mouse pointer). */
export type MenuPlace = { anchor: Rect; align: 'start' | 'end' } | { point: { x: number; y: number } };

const MAIN_WIDTH = 340;

/**
 * Menus drawn by Velo (the ⋮ menu and every popup menu), in their own view above the pages.
 * The page measures itself; the view is shown once it knows its size, so it never jumps.
 */
export class MainMenuPopup {
  private readonly view: WebContentsView;
  private visible = false;
  private shown = false;
  private hiddenAt = 0;
  private place: MenuPlace | null = null;
  private size = { width: MAIN_WIDTH, height: 480 };
  private variant: MainMenuData['variant'] = 'main';
  private revealTimer: NodeJS.Timeout | null = null;
  private readonly ready: Promise<void>;
  /** Called when the menu closes without a choice (Esc, click elsewhere). */
  onHide: (() => void) | null = null;

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

  /** Which menu is open (the ⋮ menu or another one). */
  get kind(): MainMenuData['variant'] {
    return this.variant;
  }

  /** Just closed by a click elsewhere, e.g. on the ⋮ button: don't reopen at once. */
  justHidden(): boolean {
    return Date.now() - this.hiddenAt < 300;
  }

  async show(data: MainMenuData, place: MenuPlace | null): Promise<void> {
    await this.ready;
    if (this.window.isDestroyed()) return;
    if (this.visible) this.hide();
    this.place = place;
    this.variant = data.variant;
    if (data.variant === 'main') this.size.width = MAIN_WIDTH;
    this.visible = true;
    this.shown = false;
    this.view.webContents.send('mainmenu:data', data);
    // Normally revealed by the page's first measure; this is only a safety net.
    this.revealTimer = setTimeout(() => this.reveal(), 250);
  }

  private reveal(): void {
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
    if (!this.visible || this.shown || this.window.isDestroyed()) return;
    this.layout();
    this.window.contentView.addChildView(this.view);
    this.shown = true;
    this.view.webContents.focus();
  }

  /** New data while open (zoom changed): keeps what is folded open and the selection. */
  refresh(data: MainMenuData): void {
    if (this.visible) this.view.webContents.send('mainmenu:data', data);
  }

  /** The page measured itself (or a section opened). */
  resize(width: number, height: number): void {
    if (!Number.isFinite(height)) return;
    this.size.height = Math.max(40, Math.min(1400, Math.round(height)));
    if (this.variant !== 'main' && Number.isFinite(width)) this.size.width = Math.max(200, Math.min(420, Math.round(width)));
    if (!this.visible) return;
    if (this.shown) this.layout();
    else this.reveal();
  }

  private layout(): void {
    const [winW, winH] = this.window.getContentSize();
    const w = Math.min(this.size.width, winW - 16);
    const h = Math.min(this.size.height, winH - 16);
    let x: number;
    let y: number;
    const p = this.place;
    if (p && 'point' in p) {
      x = p.point.x;
      y = p.point.y;
      // Like a native menu: opens to the left / upwards when there is no room to the right / below.
      if (x + w > winW - 8) x = Math.max(8, x - w);
      if (y + h > winH - 8) y = Math.max(8, y - h);
    } else if (p) {
      x = p.align === 'end' ? p.anchor.x + p.anchor.width - w : p.anchor.x;
      y = p.anchor.y + p.anchor.height + 4;
      if (y + h > winH - 8 && p.anchor.y - h - 4 > 8) y = p.anchor.y - h - 4;
    } else {
      x = winW - w - 8;
      y = 48;
    }
    x = Math.max(8, Math.min(x, winW - w - 8));
    y = Math.max(8, Math.min(y, winH - 8 - Math.min(h, winH - 16)));
    this.view.setBounds({ x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(Math.min(h, winH - y - 8)) });
  }

  hide(): void {
    if (!this.visible || this.window.isDestroyed()) return;
    if (this.revealTimer) clearTimeout(this.revealTimer);
    this.revealTimer = null;
    if (this.shown) this.window.contentView.removeChildView(this.view);
    this.visible = false;
    this.shown = false;
    this.hiddenAt = Date.now();
    const done = this.onHide;
    this.onHide = null;
    done?.();
  }

  destroy(): void {
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
