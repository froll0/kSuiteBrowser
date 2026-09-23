import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import type { Rect, TabState } from '../shared/types';

interface Tab {
  id: number;
  view: WebContentsView;
  favicon: string | null;
  appId: string | null;
  /** URL that failed to load while the error page is shown. */
  failedUrl: string | null;
}

export interface TabManagerHooks {
  onChange(tabs: TabState[]): void;
  /** Called for every new page WebContents, to attach context menus, window handlers, etc. */
  onWebContentsCreated(contents: WebContents, tabs: TabManager): void;
}

/** Owns the page views shown in the content area of the main window. */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: number | null = null;
  private nextId = 1;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    private readonly window: BrowserWindow,
    private readonly hooks: TabManagerHooks,
  ) {}

  create(url: string, options: { background?: boolean; appId?: string | null } = {}): number {
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    const tab: Tab = { id: this.nextId++, view, favicon: null, appId: options.appId ?? null, failedUrl: null };
    this.tabs.push(tab);

    const wc = view.webContents;
    const emit = () => this.emit();
    wc.on('page-title-updated', emit);
    wc.on('did-start-loading', emit);
    wc.on('did-stop-loading', emit);
    wc.on('did-navigate', (_e, url) => {
      if (!url.startsWith('data:')) tab.failedUrl = null;
      emit();
    });
    wc.on('did-navigate-in-page', emit);
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null;
      emit();
    });
    wc.on('did-fail-load', (_e, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. new navigation)
      tab.failedUrl = validatedUrl;
      void wc.loadURL(errorPage(validatedUrl, description));
    });
    this.hooks.onWebContentsCreated(wc, this);

    void wc.loadURL(url);
    if (!options.background || this.activeId === null) this.activate(tab.id);
    else this.emit();
    return tab.id;
  }

  /** Focuses an existing tab of a kSuite app, or opens it. */
  openApp(appId: string, url: string): void {
    const existing = this.tabs.find((t) => t.appId === appId);
    if (existing) this.activate(existing.id);
    else this.create(url, { appId });
  }

  close(id: number): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return;
    const [tab] = this.tabs.splice(index, 1);
    this.window.contentView.removeChildView(tab.view);
    tab.view.webContents.close();

    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs[index] ?? this.tabs[index - 1];
      if (next) this.activate(next.id);
    }
    this.emit();
  }

  activate(id: number): void {
    const tab = this.find(id);
    if (!tab) return;
    const previous = this.activeId !== null ? this.find(this.activeId) : undefined;
    if (previous && previous !== tab) this.window.contentView.removeChildView(previous.view);
    this.activeId = id;
    this.window.contentView.addChildView(tab.view);
    tab.view.setBounds(this.bounds);
    tab.view.webContents.focus();
    this.emit();
  }

  cycle(step: 1 | -1): void {
    if (this.tabs.length < 2 || this.activeId === null) return;
    const index = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }

  setBounds(rect: Rect): void {
    this.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    this.active()?.view.setBounds(this.bounds);
  }

  reload(id: number): void {
    const tab = this.find(id);
    if (!tab) return;
    if (tab.failedUrl) void tab.view.webContents.loadURL(tab.failedUrl);
    else tab.view.webContents.reload();
  }

  navigate(id: number, url: string): void {
    void this.find(id)?.view.webContents.loadURL(url);
  }

  active(): Tab | undefined {
    return this.activeId !== null ? this.find(this.activeId) : undefined;
  }

  activeContents(): WebContents | undefined {
    return this.active()?.view.webContents;
  }

  contents(id: number): WebContents | undefined {
    return this.find(id)?.view.webContents;
  }

  count(): number {
    return this.tabs.length;
  }

  states(): TabState[] {
    return this.tabs.map((t) => {
      const wc = t.view.webContents;
      const url = t.failedUrl ?? wc.getURL();
      return {
        id: t.id,
        title: wc.getTitle() || url || 'Nuova scheda',
        url,
        favicon: t.favicon,
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        active: t.id === this.activeId,
        appId: t.appId,
      };
    });
  }

  private find(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  private emit(): void {
    if (!this.window.isDestroyed()) this.hooks.onChange(this.states());
  }
}

function errorPage(url: string, description: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const html = `<!doctype html><meta charset="utf-8"><title>Pagina non disponibile</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#333;background:#f6f7f9}
main{max-width:520px;padding:24px}h1{font-size:20px}code{word-break:break-all;color:#666}</style>
<main><h1>Impossibile caricare la pagina</h1><p>${esc(description)}</p><code>${esc(url)}</code></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
