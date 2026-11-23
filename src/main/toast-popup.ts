import { WebContentsView, type BrowserWindow } from 'electron';
import type { PopupLook, Rect } from '../shared/types';
import { applyLookScript } from './status-bubble';

export type ToastKind = 'info' | 'success' | 'error';

const HEIGHT = 52;

const ICONS: Record<ToastKind, string> = {
  success: '<path d="M20 6 9 17l-5-5"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
};

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden}
body{display:flex;align-items:center;justify-content:center;padding:0 12px;box-sizing:border-box}
div{box-sizing:border-box;display:flex;align-items:center;gap:10px;height:${HEIGHT - 12}px;max-width:100%;padding:0 16px 0 12px;
font:500 13px var(--font,system-ui,sans-serif);border-radius:var(--r-pill,999px);background:var(--text,#16181c);color:var(--surface,#fff);
box-shadow:0 8px 24px rgba(0,0,0,.22);animation:in .18s ease-out}
div.error{background:var(--danger,#d1242f);color:#fff}
svg{flex:none;width:18px;height:18px}
div.success svg{color:var(--success-on,#4fd27a)}
span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
:root.reduce-motion div{animation:none}
</style><body><div id="t"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></svg><span></span></div>`;

/**
 * Short confirmations ("Added to bookmarks", "Email sent"): a pill floating at the bottom of the page,
 * where it covers no button. The pages are native layers, so it lives in its own small view on top.
 */
export class ToastPopup {
  private view: WebContentsView | null = null;
  private visible = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly window: BrowserWindow,
    private readonly area: () => Rect,
    private readonly look: () => PopupLook,
  ) {}

  private ensure(): WebContentsView {
    if (this.view) return this.view;
    const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } });
    view.setBackgroundColor('#00000000');
    void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    view.webContents.on('will-navigate', (e) => e.preventDefault());
    this.view = view;
    return view;
  }

  show(kind: ToastKind, message: string): void {
    if (this.window.isDestroyed() || !message) return;
    const view = this.ensure();
    const area = this.area();
    if (area.width < 120 || area.height < HEIGHT * 2) return;
    const width = Math.round(Math.min(area.width - 32, 560, Math.max(200, message.length * 7.4 + 88)));
    view.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + area.height - HEIGHT - 12), width, height: HEIGHT });
    const look = this.look();
    // Readable on the inverted pill in both themes.
    const tick = look.dark ? '#1a7f37' : '#4fd27a';
    const script = `${applyLookScript(look)}document.documentElement.style.setProperty('--success-on',${JSON.stringify(tick)});`
      + `const t=document.getElementById('t');t.className=${JSON.stringify(kind)};t.querySelector('svg').innerHTML=${JSON.stringify(ICONS[kind])};`
      + `t.querySelector('span').textContent=${JSON.stringify(message)};t.style.animation='none';void t.offsetWidth;t.style.animation='';`;
    void view.webContents.executeJavaScript(script).catch(() => {});
    // Re-adding keeps it above the page views.
    this.window.contentView.addChildView(view);
    this.visible = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), kind === 'error' ? 7000 : 3500);
  }

  hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
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
