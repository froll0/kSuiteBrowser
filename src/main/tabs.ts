import { BrowserWindow, WebContentsView, type NavigationEntry, type Session, type WebContents } from 'electron';
import type { Rect, TabState } from '../shared/types';

/** A tab. It can move to another window, so its listeners always go through `owner`. */
export interface Tab {
  id: number;
  view: WebContentsView;
  favicon: string | null;
  appId: string | null;
  pinned: boolean;
  /** URL that failed to load while the error page is shown. */
  failedUrl: string | null;
  owner: TabManager;
}

export interface ClosedTab {
  url: string;
  pinned: boolean;
  entries: NavigationEntry[];
  index: number;
}

export interface TabManagerHooks {
  onChange(tabs: TabState[]): void;
  /** Called once for every new page WebContents, to attach context menus, window handlers, etc. */
  onWebContentsCreated(contents: WebContents, tabs: TabManager): void;
  /** Extra per-tab state shown in the toolbar: shield, zoom badge, bookmark star. */
  extraState(contents: WebContents): Pick<TabState, 'blocked' | 'protectionActive' | 'zoom' | 'bookmarked'>;
  /** Page to show instead of the generic error page (e.g. the HTTPS-only warning), with the URL to display. */
  failurePage?(contents: WebContents, url: string, code: number): { load: string; display: string } | null;
}

export interface TabManagerOptions {
  session: Session;
  /** Preload for tabs; it only exposes an API to internal ksuite:// pages. */
  preload: string;
}

export interface CreateOptions {
  background?: boolean;
  appId?: string | null;
  pinned?: boolean;
  /** Position in the tab strip; default: at the end. */
  index?: number;
  /** Navigation history to restore instead of loading `url` (reopened or duplicated tabs). */
  history?: { entries: NavigationEntry[]; index: number };
}

// Global so tab ids stay unique when tabs move between windows.
let nextTabId = 1;
const MAX_CLOSED = 25;

/** Owns the page views shown in the content area of a window. */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: number | null = null;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly closed: ClosedTab[] = [];

  constructor(
    private readonly window: BrowserWindow,
    readonly hooks: TabManagerHooks,
    private readonly options: TabManagerOptions,
  ) {}

  get session(): Session {
    return this.options.session;
  }

  create(url: string, options: CreateOptions = {}): number {
    const view = new WebContentsView({
      webPreferences: {
        session: this.options.session,
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
      },
    });
    const tab: Tab = { id: nextTabId++, view, favicon: null, appId: options.appId ?? null, pinned: Boolean(options.pinned), failedUrl: null, owner: this };
    this.insert(tab, options.index);

    const wc = view.webContents;
    const emit = () => tab.owner.emit();
    wc.on('page-title-updated', emit);
    wc.on('did-start-loading', emit);
    wc.on('did-stop-loading', emit);
    wc.on('audio-state-changed', emit);
    wc.on('did-navigate', (_e, navUrl) => {
      if (!navUrl.startsWith('data:') && !navUrl.startsWith('ksuite://https-only')) tab.failedUrl = null;
      tab.favicon = null;
      emit();
    });
    wc.on('did-navigate-in-page', emit);
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null;
      emit();
    });
    wc.on('did-fail-load', (_e, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. new navigation)
      const special = tab.owner.hooks.failurePage?.(wc, validatedUrl, code);
      tab.failedUrl = special ? special.display : validatedUrl;
      void wc.loadURL(special ? special.load : errorPage(validatedUrl, description));
    });
    this.hooks.onWebContentsCreated(wc, this);

    if (options.history?.entries.length) {
      wc.navigationHistory.restore({ entries: options.history.entries, index: options.history.index }).catch(() => void wc.loadURL(url));
    } else {
      void wc.loadURL(url);
    }
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
    const tab = this.detach(id);
    if (!tab) return;
    const wc = tab.view.webContents;
    const url = tab.failedUrl ?? wc.getURL();
    if (url && !url.startsWith('data:')) {
      this.closed.push({ url, pinned: tab.pinned, entries: wc.navigationHistory.getAllEntries(), index: wc.navigationHistory.getActiveIndex() });
      if (this.closed.length > MAX_CLOSED) this.closed.shift();
    }
    wc.close();
  }

  /** Reopens the last closed tab with its back/forward history. */
  reopenClosed(): boolean {
    const last = this.closed.pop();
    if (!last) return false;
    this.create(last.url, { pinned: last.pinned, history: { entries: last.entries, index: last.index } });
    return true;
  }

  duplicate(id: number): void {
    const tab = this.find(id);
    if (!tab) return;
    const wc = tab.view.webContents;
    this.create(tab.failedUrl ?? wc.getURL(), {
      index: this.tabs.indexOf(tab) + 1,
      history: { entries: wc.navigationHistory.getAllEntries(), index: wc.navigationHistory.getActiveIndex() },
    });
  }

  /** Removes a tab from this window without destroying its page (to move it elsewhere). */
  detach(id: number): Tab | undefined {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return undefined;
    const [tab] = this.tabs.splice(index, 1);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs[index] ?? this.tabs[index - 1];
      if (next) this.activate(next.id);
    }
    this.emit();
    return tab;
  }

  /** Takes a tab detached from another window. */
  adopt(tab: Tab, index?: number): void {
    tab.owner = this;
    this.insert(tab, index);
    this.activate(tab.id);
  }

  /** Moves a tab to a new position; pinned tabs always stay before the others. */
  move(id: number, toIndex: number): void {
    const tab = this.find(id);
    if (!tab) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    this.insert(tab, toIndex);
    this.emit();
  }

  setPinned(id: number, pinned: boolean): void {
    const tab = this.find(id);
    if (!tab || tab.pinned === pinned) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    tab.pinned = pinned;
    this.insert(tab, pinned ? this.tabs.filter((t) => t.pinned).length : undefined);
    this.emit();
  }

  setMuted(id: number, muted: boolean): void {
    const wc = this.contents(id);
    if (!wc) return;
    wc.setAudioMuted(muted);
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

  /** Activates the tab at a position (Ctrl+1…8); -1 is the last tab (Ctrl+9). */
  activateIndex(index: number): void {
    const tab = index < 0 ? this.tabs[this.tabs.length - 1] : this.tabs[index];
    if (tab) this.activate(tab.id);
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

  ids(): number[] {
    return this.tabs.map((t) => t.id);
  }

  count(): number {
    return this.tabs.length;
  }

  hasClosed(): boolean {
    return this.closed.length > 0;
  }

  /** Re-sends the tab states, e.g. when the blocked counter or a setting changed. */
  refresh(): void {
    this.emit();
  }

  /** Tab id owning a WebContents, if any. */
  idOf(contents: WebContents): number | null {
    return this.tabs.find((t) => t.view.webContents === contents)?.id ?? null;
  }

  /** Tabs to reopen at the next start. */
  saved(): Array<{ url: string; pinned: boolean }> {
    return this.states()
      .filter((t) => t.url && !t.url.startsWith('data:'))
      .map((t) => ({ url: t.url, pinned: t.pinned }));
  }

  /** Closes every tab; used when the window goes away. */
  destroy(): void {
    for (const tab of this.tabs) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.tabs = [];
    this.activeId = null;
  }

  states(): TabState[] {
    return this.tabs.map((t) => {
      const wc = t.view.webContents;
      const url = t.failedUrl ?? wc.getURL();
      return {
        id: t.id,
        title: url.startsWith('ksuite://newtab') ? 'Nuova scheda' : wc.getTitle() || url || 'Nuova scheda',
        url,
        favicon: t.favicon,
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        active: t.id === this.activeId,
        appId: t.appId,
        pinned: t.pinned,
        audible: wc.isCurrentlyAudible(),
        muted: wc.isAudioMuted(),
        ...this.hooks.extraState(wc),
      };
    });
  }

  private insert(tab: Tab, index?: number): void {
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    const min = tab.pinned ? 0 : pinnedCount;
    const max = tab.pinned ? pinnedCount : this.tabs.length;
    const at = Math.min(max, Math.max(min, index ?? max));
    this.tabs.splice(at, 0, tab);
  }

  private find(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  emit(): void {
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
