import { WebContentsView, type BrowserWindow } from 'electron';
import type { PopupLook, Rect } from '../shared/types';
import { applyLookScript } from './status-bubble';

const WIDTH = 280;

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}
.card{box-sizing:border-box;width:${WIDTH}px;padding:10px 12px;border:1px solid var(--border,#dde1e7);border-radius:var(--r-md,12px);
background:var(--surface,#fff);color:var(--text,#15181d);font:12.5px/1.35 var(--font,system-ui,sans-serif)}
.title{font-weight:600;font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.host{margin-top:3px;color:var(--muted,#6a7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{margin-top:6px;padding-top:6px;border-top:1px solid var(--border,#eceff3);color:var(--muted,#6a7280);font-size:12px}
.meta:empty{display:none}
</style><body><div class="card"><div class="title" id="title"></div><div class="host" id="host"></div><div class="meta" id="meta"></div></div>`;

export interface HoverInfo {
  title: string;
  host: string;
  meta: string;
}

/** Card under a tab while the pointer rests on it: full title, site, state and memory. */
export class HoverCard {
  private view: WebContentsView | null = null;
  private visible = false;
  private seq = 0;

  constructor(
    private readonly window: BrowserWindow,
    private readonly look: () => PopupLook,
    private readonly beside: () => boolean,
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

  async show(info: HoverInfo, anchor: Rect): Promise<void> {
    const seq = ++this.seq;
    const view = this.ensure();
    const code = `(() => {
      document.getElementById('title').textContent = ${JSON.stringify(info.title)};
      document.getElementById('host').textContent = ${JSON.stringify(info.host)};
      document.getElementById('meta').textContent = ${JSON.stringify(info.meta)};
      ${applyLookScript(this.look())}
      return Math.ceil(document.querySelector('.card').getBoundingClientRect().height);
    })()`;
    let height = 64;
    try {
      if (view.webContents.isLoading()) await new Promise<void>((r) => view.webContents.once('did-finish-load', () => r()));
      height = Number(await view.webContents.executeJavaScript(code)) || height;
    } catch {
      return;
    }
    // A newer hover (or a hide) arrived meanwhile.
    if (seq !== this.seq || this.window.isDestroyed()) return;
    const [width, winHeight] = this.window.getContentSize();
    if (this.beside()) {
      // Vertical tabs: next to the tab.
      const y = Math.round(Math.min(Math.max(4, anchor.y), winHeight - height - 4));
      view.setBounds({ x: Math.round(anchor.x + anchor.width + 6), y, width: WIDTH, height });
    } else {
      const x = Math.round(Math.min(Math.max(4, anchor.x), width - WIDTH - 4));
      view.setBounds({ x, y: Math.round(anchor.y + anchor.height + 6), width: WIDTH, height });
    }
    this.window.contentView.addChildView(view);
    this.visible = true;
  }

  hide(): void {
    this.seq++;
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
