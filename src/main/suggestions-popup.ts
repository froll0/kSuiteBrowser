import { WebContentsView, type BrowserWindow } from 'electron';
import type { PopupLook, Rect, Suggestion } from '../shared/types';

const ROW_HEIGHT = 36;
const PADDING = 8;

/**
 * Address bar suggestions. Page views are native layers above the browser UI, so a dropdown drawn
 * in the UI would be hidden behind the page: the list lives in its own small view on top.
 */
export class SuggestionsPopup {
  private readonly view: WebContentsView;
  private visible = false;
  private items: Suggestion[] = [];

  constructor(
    private readonly window: BrowserWindow,
    paths: { html: string; preload: string },
    private readonly onChoose: (suggestion: Suggestion) => void,
  ) {
    this.view = new WebContentsView({
      webPreferences: { preload: paths.preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.view.setBackgroundColor('#00000000');
    void this.view.webContents.loadFile(paths.html);
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.on('will-navigate', (e) => e.preventDefault());
  }

  get contents() {
    return this.view.webContents;
  }

  show(items: Suggestion[], anchor: Rect, selected: number, look: PopupLook): void {
    this.items = items;
    if (items.length === 0) return this.hide();
    this.view.setBounds({
      x: Math.round(anchor.x),
      y: Math.round(anchor.y + anchor.height + 2),
      width: Math.round(anchor.width),
      height: items.length * ROW_HEIGHT + PADDING,
    });
    this.view.webContents.send('suggest:items', { items, selected, look });
    // Re-adding moves the view on top of the page views.
    this.window.contentView.addChildView(this.view);
    this.visible = true;
  }

  hide(): void {
    if (!this.visible) return;
    this.window.contentView.removeChildView(this.view);
    this.visible = false;
  }

  choose(index: number): void {
    const item = this.items[index];
    this.hide();
    if (item) this.onChoose(item);
  }

  destroy(): void {
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
