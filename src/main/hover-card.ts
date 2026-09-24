import { WebContentsView, type BrowserWindow } from 'electron';
import type { Rect } from '../shared/types';

const WIDTH = 280;

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden}
.card{box-sizing:border-box;width:${WIDTH}px;padding:10px 12px;border:1px solid #dde1e7;border-radius:12px;background:#fff;color:#15181d;
font:12.5px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
.title{font-weight:600;font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.host{margin-top:3px;color:#6a7280;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{margin-top:6px;padding-top:6px;border-top:1px solid #eceff3;color:#6a7280;font-size:12px}
.meta:empty{display:none}
body.dark .card{background:#1f2126;color:#e8eaee;border-color:#33373e}
body.dark .host,body.dark .meta{color:#979fab}
body.dark .meta{border-color:#2c3036}
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
    private readonly isDark: () => boolean,
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
      document.body.className = ${JSON.stringify(this.isDark() ? 'dark' : '')};
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
    const [width] = this.window.getContentSize();
    const x = Math.round(Math.min(Math.max(4, anchor.x), width - WIDTH - 4));
    view.setBounds({ x, y: Math.round(anchor.y + anchor.height + 4), width: WIDTH, height });
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
