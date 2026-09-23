import { BrowserWindow, nativeTheme, shell, type Session, type WebContents } from 'electron';
import { IPC } from '../shared/ipc';
import type { DriveFile } from '../shared/types';
import { attachContextMenu } from './context-menu';
import { isInternalUrl } from './internal-pages';
import type { PrivacyGuard } from './privacy';
import type { KSuiteServices } from './services';
import type { SettingsStore } from './settings';
import type { BookmarksStore } from './stores/bookmarks';
import type { HistoryStore } from './stores/history';
import { SuggestionsPopup } from './suggestions-popup';
import { TabManager } from './tabs';

export interface WindowContext {
  settings: SettingsStore;
  services: KSuiteServices;
  history: HistoryStore;
  bookmarks: BookmarksStore;
  guardFor(session: Session): PrivacyGuard;
  /** Applies the zoom saved for the page's site (or the default zoom). */
  applyZoom(contents: WebContents): void;
  stepZoom(controller: BrowserWindowController, contents: WebContents, direction: 'in' | 'out'): void;
  paths: { chromePreload: string; pagePreload: string; chromeHtml: string; suggestHtml: string; suggestPreload: string; appIcon: string };
  onTabsChanged(controller: BrowserWindowController): void;
  /** Window currently holding a tab's page (tabs can move between windows). */
  ownerOf(contents: WebContents): BrowserWindowController | null;
  recordFavicon(contents: WebContents, faviconUrl: string): void;
  onClosed(controller: BrowserWindowController): void;
}

export const SETTINGS_URL = 'ksuite://settings/';
export const TITLEBAR_HEIGHT = 42;

/** Chrome colours matching src/renderer/styles.css (title bar, window buttons, page background). */
function chromeColors(isPrivate: boolean): { titlebar: string; symbol: string; surface: string } {
  if (isPrivate) return { titlebar: '#1f1830', symbol: '#d8d0ea', surface: '#2a2140' };
  return nativeTheme.shouldUseDarkColors
    ? { titlebar: '#111317', symbol: '#c3c8d0', surface: '#1b1d22' }
    : { titlebar: '#e6eaf0', symbol: '#3d4450', surface: '#ffffff' };
}

function titleBarOverlay(isPrivate: boolean): Electron.TitleBarOverlayOptions {
  const c = chromeColors(isPrivate);
  return { color: c.titlebar, symbolColor: c.symbol, height: TITLEBAR_HEIGHT };
}
export const NEWTAB_URL = 'ksuite://newtab/';

/** One browser window: the UI around it, its tabs and its session (persistent, or in-memory when private). */
export class BrowserWindowController {
  readonly win: BrowserWindow;
  readonly tabs: TabManager;
  readonly suggestions: SuggestionsPopup;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: WindowContext,
    readonly session: Session,
    readonly isPrivate: boolean,
    /** null: start without tabs (a tab moved from another window is about to arrive). */
    initialTabs: Array<{ url: string; pinned?: boolean }> | null,
    bounds?: Partial<Electron.Rectangle>,
  ) {
    this.win = new BrowserWindow({
      width: 1400,
      height: 900,
      ...bounds,
      minWidth: 720,
      minHeight: 480,
      title: isPrivate ? 'kSuite Browser — Finestra privata' : 'kSuite Browser',
      backgroundColor: chromeColors(isPrivate).surface,
      autoHideMenuBar: true,
      icon: ctx.paths.appIcon,
      // Tabs live in the title bar; the system draws its window buttons over it.
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(isPrivate) }),
      webPreferences: {
        preload: ctx.paths.chromePreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // The browser UI itself must never navigate away from the bundled page.
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const guard = ctx.guardFor(session);
    this.tabs = new TabManager(
      this.win,
      {
        onChange: (states) => {
          this.send(IPC.evTabs, states);
          ctx.onTabsChanged(this);
        },
        onWebContentsCreated: (contents) => this.setupPage(contents),
        extraState: (contents) => ({
          blocked: guard.blockedCount(contents.id),
          protectionActive: guard.protectionActiveFor(contents.getURL() || null),
          zoom: Math.round(contents.getZoomFactor() * 100),
          bookmarked: /^(https?|file|ksuite):/i.test(contents.getURL()) && Boolean(ctx.bookmarks.find(contents.getURL())),
        }),
        failurePage: (contents, url) => {
          const http = guard.httpFallbackFor(contents.id, url);
          return http ? { load: `ksuite://https-only/?url=${encodeURIComponent(http)}`, display: http } : null;
        },
      },
      { session, preload: ctx.paths.pagePreload },
    );

    this.suggestions = new SuggestionsPopup(this.win, { html: ctx.paths.suggestHtml, preload: ctx.paths.suggestPreload }, (item) => {
      const id = this.activeTabId();
      if (id === null) this.tabs.create(item.url);
      else this.tabs.navigate(id, item.url);
      this.activeContents()?.focus();
    });

    void this.win.loadFile(ctx.paths.chromeHtml, { query: isPrivate ? { private: '1' } : {} });
    this.win.webContents.once('did-finish-load', () => {
      if (initialTabs === null) return;
      const tabs = initialTabs.length ? initialTabs : [{ url: ctx.settings.get().homePage }];
      for (const t of tabs) this.tabs.create(t.url, { pinned: t.pinned, background: true });
      const firstUnpinned = this.tabs.states().find((t) => !t.pinned) ?? this.tabs.states()[0];
      if (firstUnpinned) this.tabs.activate(firstUnpinned.id);
    });
    this.win.on('closed', () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.suggestions.destroy();
      this.tabs.destroy();
      ctx.onClosed(this);
    });
  }

  /** Keeps the system window buttons in the colours of the current theme. */
  applyTitleBarTheme(): void {
    if (process.platform === 'darwin' || this.win.isDestroyed()) return;
    this.win.setTitleBarOverlay(titleBarOverlay(this.isPrivate));
    this.win.setBackgroundColor(chromeColors(this.isPrivate).surface);
  }

  send(channel: string, payload?: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
  }

  focusChrome(channel: string): void {
    this.win.webContents.focus();
    this.send(channel);
  }

  focus(): void {
    if (this.win.isMinimized()) this.win.restore();
    this.win.focus();
  }

  /** Position right after the tab of `contents`, where links opened from it go. */
  indexAfter(contents: WebContents): number | undefined {
    const id = this.tabs.idOf(contents);
    return id === null ? undefined : this.tabs.ids().indexOf(id) + 1;
  }

  /** Throttled tab refresh, used when blocked counters change during page loads. */
  scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.win.isDestroyed()) this.tabs.refresh();
    }, 300);
  }

  activeTabId(): number | null {
    return this.tabs.states().find((t) => t.active)?.id ?? null;
  }

  activeContents(): WebContents | undefined {
    return this.tabs.activeContents();
  }

  newTab(url?: string, options: { afterActive?: boolean } = {}): void {
    const s = this.ctx.settings.get();
    const active = this.activeTabId();
    const index = options.afterActive && active !== null ? this.tabs.ids().indexOf(active) + 1 : undefined;
    this.tabs.create(url ?? (s.newTabPage === 'newtab' ? NEWTAB_URL : s.homePage), { index });
    if (!url) this.focusChrome(IPC.evFocusAddress);
  }

  closeTab(id: number): void {
    this.tabs.close(id);
    if (this.tabs.count() === 0) this.win.close();
  }

  closeActiveTab(): void {
    const id = this.activeTabId();
    if (id !== null) this.closeTab(id);
  }

  /** Focuses the settings tab (or opens one), optionally at a section. */
  openSettings(section?: string): void {
    this.openInternal(section ? `${SETTINGS_URL}#${section}` : SETTINGS_URL);
  }

  /** Focuses the tab already showing an internal page (ksuite://host/), or opens it. */
  openInternal(url: string): void {
    const base = url.replace(/#.*$/, '');
    const existing = this.tabs.states().find((t) => t.url.startsWith(base));
    if (existing) {
      this.tabs.activate(existing.id);
      if (url !== base) this.tabs.navigate(existing.id, url);
    } else {
      this.tabs.create(url);
    }
  }

  composeMail(url: string, title: string): void {
    this.send(IPC.evComposeMail, { to: '', subject: title || url, body: `${title ? `${title}\n` : ''}${url}` });
  }

  async runDriveAction(label: string, action: () => Promise<DriveFile>): Promise<void> {
    this.send(IPC.evToast, { kind: 'info', message: `${label}…` });
    try {
      const file = await action();
      this.send(IPC.evToast, { kind: 'success', message: `"${file.name}" salvato in ${this.ctx.settings.get().driveUploadFolderName}` });
    } catch (err) {
      this.send(IPC.evToast, { kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  savePageToDrive(contents: WebContents): Promise<void> {
    return this.runDriveAction('Salvataggio pagina in PDF', () => this.ctx.services.savePageAsPdf(contents));
  }

  private setupPage(contents: WebContents): void {
    // The tab may move to another window: always act on the window that holds it now.
    const owner = () => this.ctx.ownerOf(contents) ?? this;
    // History (never for private windows) and per-site zoom.
    let visitId: string | null = null;
    const record = (url: string) => {
      visitId = null;
      if (owner().isPrivate || !this.ctx.settings.get().saveHistory || !/^https?:/i.test(url)) return;
      visitId = this.ctx.history.add(url, contents.getTitle() === url ? '' : contents.getTitle());
    };
    contents.on('did-navigate', (_e, url) => {
      record(url);
      this.ctx.applyZoom(contents);
    });
    contents.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (isMainFrame) record(url);
    });
    contents.on('page-favicon-updated', (_e, favicons) => {
      if (!owner().isPrivate && favicons[0]) this.ctx.recordFavicon(contents, favicons[0]);
    });
    contents.on('page-title-updated', (_e, title) => {
      if (visitId) this.ctx.history.setTitle(visitId, title);
    });
    contents.on('zoom-changed', (_e, direction) => this.ctx.stepZoom(owner(), contents, direction === 'in' ? 'in' : 'out'));
    contents.on('found-in-page', (_e, result) => {
      const tabId = owner().tabs.idOf(contents);
      if (tabId !== null) owner().send(IPC.evFindResult, { tabId, active: result.activeMatchOrdinal, total: result.matches });
    });

    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      if (isInternalUrl(url) && !isInternalUrl(contents.getURL())) return { action: 'deny' };
      // Real popups (e.g. OAuth logins) need window.opener: keep them as windows in the same session.
      if (disposition === 'new-window' && features) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
          },
        };
      }
      owner().tabs.create(url, { background: disposition === 'background-tab', index: owner().indexAfter(contents) });
      return { action: 'deny' };
    });

    contents.on('will-navigate', (e, url) => {
      // Web pages may not open the browser's internal pages.
      if (isInternalUrl(url)) {
        if (!isInternalUrl(contents.getURL())) e.preventDefault();
        return;
      }
      // Hand mailto:, tel:, etc. to the system instead of failing inside the tab.
      if (!/^(https?|file|about|data|blob|view-source):/i.test(url)) {
        e.preventDefault();
        void shell.openExternal(url);
      }
    });

    attachContextMenu(contents, {
      openInNewTab: (url) => owner().tabs.create(url, { background: true, index: owner().indexAfter(contents) }),
      saveUrlToDrive: (url) => void owner().runDriveAction('Salvataggio su kDrive', () => this.ctx.services.saveUrlToDrive(contents.session, url)),
      savePageToDrive: (wc) => void owner().savePageToDrive(wc),
      mailLink: (url, title) => owner().composeMail(url, title),
    });
  }
}
