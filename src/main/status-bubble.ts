import { WebContentsView, screen, type BrowserWindow } from 'electron';
import type { PopupLook, Rect } from '../shared/types';
import { readableUrl } from '../shared/url';

const HEIGHT = 24;
const HIDE_DELAY = 120;

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}
div{box-sizing:border-box;height:${HEIGHT}px;line-height:${HEIGHT - 2}px;padding:0 10px;font:12px var(--font,system-ui,sans-serif);
white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid var(--border,#d5dae2);border-radius:var(--r-pill,999px);
background:var(--surface-2,#f4f6f9);color:var(--text-2,#39414f)}
</style><body><div id="t"></div>`;

/** Link address shown at the bottom of the page while hovering a link, like other browsers. */
export class StatusBubble {
  private view: WebContentsView | null = null;
  private visible = false;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly area: () => Rect,
    private readonly look: () => PopupLook,
  ) {}

  private ensure(): WebContentsView {
    if (this.view) return this.view;
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    view.setBackgroundColor('#00000000');
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    view.webContents.on('will-navigate', (e) => e.preventDefault());
    this.view = view;
    return view;
  }

  show(url: string): void {
    if (!url) return this.scheduleHide();
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    const view = this.ensure();
    const area = this.area();
    if (area.width < 50 || area.height < HEIGHT) return this.hide();
    const text = readableUrl(url);
    const width = Math.round(Math.min(area.width / 2, Math.max(120, text.length * 6.4 + 20)));
    // Move to the right when the pointer is where the bubble would be.
    const cursor = screen.getCursorScreenPoint();
    const content = this.window.getContentBounds();
    const cx = cursor.x - content.x;
    const cy = cursor.y - content.y;
    const bottom = area.y + area.height;
    const right = cx < area.x + width + 26 && cy > bottom - HEIGHT - 46;
    // A pill floating inside the page corner (clear of the rounded canvas edge).
    const pad = 6;
    view.setBounds({ x: right ? area.x + area.width - width - pad : area.x + pad, y: bottom - HEIGHT - pad, width, height: HEIGHT });
    void view.webContents.executeJavaScript(`document.getElementById('t').textContent=${JSON.stringify(text)};${applyLookScript(this.look())}`).catch(() => {});
    // Re-adding keeps the bubble above the page views.
    this.window.contentView.addChildView(view);
    this.visible = true;
  }

  private scheduleHide(): void {
    if (!this.visible || this.hideTimer) return;
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY);
  }

  hide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
    if (!this.visible || !this.view || this.window.isDestroyed()) return;
    this.window.contentView.removeChildView(this.view);
    this.visible = false;
  }

  destroy(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }
}

/** Script that applies a popup look to a data: page. */
export function applyLookScript(look: PopupLook): string {
  return `(()=>{const r=document.documentElement;for(const [k,v] of Object.entries(${JSON.stringify(look.vars)}))r.style.setProperty(k,v);r.style.colorScheme=${JSON.stringify(look.dark ? 'dark' : 'light')};})();`;
}
