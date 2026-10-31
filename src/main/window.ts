import { BrowserWindow, app, dialog, nativeTheme, type Session, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import type { DriveFile, PopupLook, Settings, TabLayout } from '../shared/types';
import { chromeColors, densityMetrics, isDark, tokens, type ChromeColors } from '../shared/appearance';
import { attachContextMenu } from './context-menu';
import { popupTitle } from '../shared/url';
import { isInternalUrl } from './internal-pages';
import { isReaderable, readerableIds } from './reader';
import { webRtcPolicy } from '../shared/webrtc';
import type { PrivacyGuard } from './privacy';
import type { CloudServices } from './services';
import type { SettingsStore } from './settings';
import type { BookmarksStore } from './stores/bookmarks';
import type { HistoryStore } from './stores/history';
import { HoverCard } from './hover-card';
import { StatusBubble } from './status-bubble';
import { TabSearchPopup } from './tab-search-popup';
import { CommandPalette } from './command-palette';
import { SuggestionsPopup } from './suggestions-popup';
import { TabManager } from './tabs';
import { protectWorkers } from './worker-shield';
import type { ShieldConfig } from '../shared/fingerprint';
import { tr } from '../shared/i18n';

export interface WindowContext {
  settings: SettingsStore;
  services: CloudServices;
  history: HistoryStore;
  bookmarks: BookmarksStore;
  /** Undefined once a private session is gone (its window is closing). */
  guardFor(session: Session): PrivacyGuard | undefined;
  /** Session of a container (created on first use), undefined for an unknown container. */
  containerSession(id: string): Session | undefined;
  /** Fingerprinting protection for a page address in a session (also used for its workers). */
  shieldConfigFor(session: Session, pageUrl: string): ShieldConfig;
  /** Applies the zoom saved for the page's site (or the default zoom). */
  applyZoom(contents: WebContents): void;
  stepZoom(controller: BrowserWindowController, contents: WebContents, direction: 'in' | 'out'): void;
  paths: { chromePreload: string; pagePreload: string; chromeHtml: string; suggestHtml: string; suggestPreload: string; tabSearchHtml: string; tabSearchPreload: string; paletteHtml: string; palettePreload: string; appIcon: string };
  onTabsChanged(controller: BrowserWindowController): void;
  /** Window currently holding a tab's page (tabs can move between windows). */
  ownerOf(contents: WebContents): BrowserWindowController | null;
  /** Brings an open tab to the front, in whichever window holds it. */
  switchToTab(from: BrowserWindowController, tabId: number): boolean;
  recordFavicon(contents: WebContents, faviconUrl: string): void;
  onClosed(controller: BrowserWindowController): void;
}

export const SETTINGS_URL = 'velo://settings/';
/** Colours of the native parts of the window (title bar buttons, background) for the chosen appearance. */
function frameColors(settings: Settings, isPrivate: boolean): ChromeColors {
  return chromeColors(settings, isPrivate || isDark(settings.theme, nativeTheme.shouldUseDarkColors), isPrivate);
}

function titleBarOverlay(settings: Settings, isPrivate: boolean): Electron.TitleBarOverlayOptions {
  const c = frameColors(settings, isPrivate);
  return { color: c.backdrop, symbolColor: c.symbol, height: densityMetrics(settings.density).row };
}

/** Look of the popup views of a window. */
export function popupLook(settings: Settings, isPrivate: boolean): PopupLook {
  const dark = isPrivate || isDark(settings.theme, nativeTheme.shouldUseDarkColors);
  return { dark, vars: tokens(settings, dark, isPrivate) };
}

export const NEWTAB_URL = 'velo://newtab/';

/** One browser window: the UI around it, its tabs and its session (persistent, or in-memory when private). */
export class BrowserWindowController {
  readonly win: BrowserWindow;
  readonly tabs: TabManager;
  readonly suggestions: SuggestionsPopup;
  readonly statusBubble: StatusBubble;
  readonly tabSearch: TabSearchPopup;
  readonly palette: CommandPalette;
  readonly hoverCard: HoverCard;
  private refreshTimer: NodeJS.Timeout | null = null;
  private lastActive: number | null = null;
  /** HTTP authentication requests waiting for the user. */
  private readonly authRequests = new Map<string, { contents: WebContents; callback: (username?: string, password?: string) => void; cleanup: () => void }>();

  constructor(
    private readonly ctx: WindowContext,
    readonly session: Session,
    readonly isPrivate: boolean,
    /** null: start without tabs (a tab moved from another window is about to arrive). */
    initialTabs: Array<{ url: string; pinned?: boolean; title?: string; open?: boolean; groupId?: string | null; workspace?: string; container?: string | null }> | null,
    bounds?: Partial<Electron.Rectangle>,
    /** Groups and workspace of a restored window. */
    layout?: Partial<TabLayout>,
  ) {
    this.win = new BrowserWindow({
      width: 1400,
      height: 900,
      ...bounds,
      minWidth: 720,
      minHeight: 480,
      title: isPrivate ? tr('Velo — Finestra privata') : 'Velo',
      backgroundColor: frameColors(ctx.settings.get(), isPrivate).backdrop,
      autoHideMenuBar: true,
      icon: ctx.paths.appIcon,
      // Tabs live in the title bar; the system draws its window buttons over it.
      // On Linux the system buttons drawn over the page can't be hidden (or recoloured) reliably: Velo
      // draws its own, which go away with the auto-hiding bar.
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
        : process.platform === 'win32'
          ? { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlay(ctx.settings.get(), isPrivate) }
          : { frame: false }),
      webPreferences: {
        preload: ctx.paths.chromePreload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // Velo's own window buttons (Linux) show whether the window is maximized.
    const sendState = () => this.send(IPC.evWindowState, { maximized: this.win.isMaximized(), fullscreen: this.win.isFullScreen() });
    for (const event of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) this.win.on(event as 'maximize', sendState);

    // The browser UI itself must never navigate away from the bundled page.
    this.win.webContents.on('will-navigate', (e) => e.preventDefault());
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    const guardOf = (contents: WebContents | null) => ctx.guardFor(contents?.session ?? session);
    this.tabs = new TabManager(
      this.win,
      {
        onChange: (states) => {
          if (this.lastActive !== this.activeTabIdFrom(states)) this.statusBubble?.hide();
          this.lastActive = this.activeTabIdFrom(states);
          this.send(IPC.evTabs, states);
          this.send(IPC.evTabLayout, this.tabLayout());
          ctx.onTabsChanged(this);
        },
        onWebContentsCreated: (contents) => this.setupPage(contents),
        newTabUrl: () => (ctx.settings.get().newTabPage === 'newtab' ? NEWTAB_URL : ctx.settings.get().homePage),
        extraState: (contents, url) => ({
          blocked: contents ? (guardOf(contents)?.blockedCount(contents.id) ?? 0) : 0,
          protectionActive: guardOf(contents)?.protectionActiveFor(url || null) ?? false,
          // The PDF viewer fits the page by changing the zoom itself: no badge for that.
          zoom: !contents || /\.pdf($|[?#])/i.test(url) ? ctx.settings.get().defaultZoom : Math.round(contents.getZoomFactor() * 100),
          bookmarked: /^(https?|file|velo):/i.test(url) && Boolean(ctx.bookmarks.find(url)),
          readerable: contents ? readerableIds.has(contents.id) : false,
        }),
        failurePage: (contents, url) => {
          const guard = guardOf(contents);
          if (!guard) return null;
          const threat = guard.threatFor(contents.id, url);
          if (threat) return { load: `velo://blocked/?kind=${threat.kind}&url=${encodeURIComponent(threat.url)}`, display: threat.url };
          const http = guard.httpFallbackFor(contents.id, url);
          return http ? { load: `velo://https-only/?url=${encodeURIComponent(http)}`, display: http } : null;
        },
      },
      // Containers live in normal windows only: a private window keeps everything in its own memory.
      { session, preload: ctx.paths.pagePreload, containerSession: (id) => (isPrivate ? undefined : ctx.containerSession(id)) },
    );

    // A window opened without a session (or with a tab moved to it) starts in the first workspace.
    this.tabs.restoreLayout([], ctx.settings.get().workspaces[0].id);

    this.suggestions = new SuggestionsPopup(this.win, { html: ctx.paths.suggestHtml, preload: ctx.paths.suggestPreload }, (item) => {
      if (item.kind === 'tab' && item.tabId !== undefined && ctx.switchToTab(this, item.tabId)) return;
      const id = this.activeTabId();
      if (id === null) this.tabs.create(item.url);
      else this.tabs.navigate(id, item.url);
      this.activeContents()?.focus();
    });

    this.tabSearch = new TabSearchPopup(this.win, { html: ctx.paths.tabSearchHtml, preload: ctx.paths.tabSearchPreload }, () => densityMetrics(ctx.settings.get().density).row);
    this.palette = new CommandPalette(this.win, { html: ctx.paths.paletteHtml, preload: ctx.paths.palettePreload }, () => densityMetrics(ctx.settings.get().density).row);
    const look = () => popupLook(ctx.settings.get(), isPrivate);
    this.statusBubble = new StatusBubble(this.win, () => this.tabs.pageArea(), look);
    this.hoverCard = new HoverCard(this.win, look, () => ctx.settings.get().tabsLayout === 'side');

    const initialLook = JSON.stringify(popupLook(ctx.settings.get(), isPrivate));
    void this.win.loadFile(ctx.paths.chromeHtml, { query: { ...(isPrivate ? { private: '1' } : {}), look: initialLook } });
    this.applyTitleBarTheme();
    this.win.webContents.once('did-finish-load', () => {
      if (initialTabs === null) return;
      // Workspaces deleted since the session was saved: their tabs go to the first one.
      const known = new Set(ctx.settings.get().workspaces.map((w) => w.id));
      const workspaceOf = (id: string | undefined) => (id && known.has(id) ? id : ctx.settings.get().workspaces[0].id);
      this.tabs.restoreLayout(layout?.groups ?? [], workspaceOf(layout?.workspace));
      const tabs: typeof initialTabs = (initialTabs.length ? initialTabs : [{ url: ctx.settings.get().homePage }]).map((t) => ({ ...t, workspace: workspaceOf(t.workspace) }));
      // Restored tabs start asleep and load when first shown: the window opens fast even with many tabs.
      const opened = tabs.some((t) => t.open);
      const front = opened ? tabs.map((t) => Boolean(t.open)).lastIndexOf(true) : Math.max(0, tabs.findIndex((t) => !t.pinned));
      const ids = tabs.map((t, i) => this.tabs.create(t.url, {
        pinned: t.pinned, background: true, asleep: i !== front && !t.open, title: t.title,
        groupId: t.groupId, workspace: t.workspace, container: t.container,
      }));
      if (ids[front] !== undefined) this.tabs.activate(ids[front]);
    });
    this.win.on('closed', () => {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.suggestions.destroy();
      this.statusBubble.destroy();
      this.tabSearch.destroy();
      this.palette.destroy();
      this.hoverCard.destroy();
      this.tabs.destroy();
      ctx.onClosed(this);
    });
  }

  private chromeVisible = true;

  /** Auto-hiding toolbar: the system window buttons appear and disappear with the browser bar. */
  setChromeVisible(visible: boolean): void {
    if (this.win.isDestroyed() || this.chromeVisible === visible) return;
    this.chromeVisible = visible;
    if (process.platform === 'darwin') this.win.setWindowButtonVisibility(visible);
    else this.applyTitleBarTheme();
  }

  /** Keeps the system window buttons in the colours of the current theme. */
  applyTitleBarTheme(): void {
    if (this.win.isDestroyed()) return;
    if (process.platform === 'darwin') {
      // Traffic lights centred in the first row, whatever its height.
      this.win.setWindowButtonPosition({ x: 14, y: Math.round((densityMetrics(this.ctx.settings.get().density).row - 14) / 2) });
      return;
    }
    if (process.platform === 'win32') {
      const overlay = titleBarOverlay(this.ctx.settings.get(), this.isPrivate);
      // Hidden bar: invisible buttons over the page (some systems keep a minimum height).
      this.win.setTitleBarOverlay(this.chromeVisible ? overlay : { color: '#00000000', symbolColor: '#00000000', height: 1 });
    }
    this.win.setBackgroundColor(frameColors(this.ctx.settings.get(), this.isPrivate).backdrop);
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

  /** Groups and workspace of the tab strip. */
  tabLayout(): TabLayout {
    return { groups: this.tabs.groupList(), workspace: this.tabs.currentWorkspace() };
  }

  /** Links opened from a page stay in its container and group. */
  sameAs(contents: WebContents): { container?: string | null; groupId?: string | null } {
    const id = this.tabs.idOf(contents);
    const t = id === null ? undefined : this.tabs.states().find((x) => x.id === id);
    return t ? { container: t.container, groupId: t.groupId } : {};
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

  private activeTabIdFrom(states: Array<{ id: number; active: boolean }>): number | null {
    return states.find((t) => t.active)?.id ?? null;
  }

  activeTabId(): number | null {
    return this.tabs.states().find((t) => t.active)?.id ?? null;
  }

  activeContents(): WebContents | undefined {
    return this.tabs.activeContents();
  }

  newTab(url?: string, options: { afterActive?: boolean; container?: string | null } = {}): void {
    const s = this.ctx.settings.get();
    const active = this.activeTabId();
    const index = options.afterActive && active !== null ? this.tabs.ids().indexOf(active) + 1 : undefined;
    this.tabs.create(url ?? (s.newTabPage === 'newtab' ? NEWTAB_URL : s.homePage), { index, container: options.container });
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

  /** Focuses the tab already showing an internal page (velo://host/), or opens it. */
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
      this.send(IPC.evToast, { kind: 'success', message: tr('"{0}" salvato in {1}', file.name, this.ctx.settings.get().driveUploadFolderName) });
    } catch (err) {
      this.send(IPC.evToast, { kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Shows the sign-in bar for a site using HTTP authentication. */
  requestAuth(contents: WebContents, info: Electron.AuthInfo, callback: (username?: string, password?: string) => void): void {
    const id = randomUUID();
    const onNavigation = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame && !details.isSameDocument) withdraw();
    };
    const cleanup = () => {
      contents.off('did-start-navigation', onNavigation);
      contents.off('destroyed', withdraw);
    };
    // A new page or a closed tab withdraws the request.
    const withdraw = () => {
      if (!this.authRequests.has(id)) return;
      this.answerAuth(id, null);
      this.send(IPC.evAuthPrompt, { id, tabId: null, host: '', realm: '', isProxy: false, cancelled: true });
    };
    this.authRequests.set(id, { contents, callback, cleanup });
    contents.on('did-start-navigation', onNavigation);
    contents.once('destroyed', withdraw);
    const host = info.port && ![80, 443].includes(info.port) ? `${info.host}:${info.port}` : info.host;
    this.send(IPC.evAuthPrompt, { id, tabId: this.tabs.idOf(contents), host, realm: info.realm ?? '', isProxy: info.isProxy });
  }

  answerAuth(id: string, credentials: { username: string; password: string } | null): void {
    const request = this.authRequests.get(id);
    if (!request) return;
    this.authRequests.delete(id);
    request.cleanup();
    if (credentials && typeof credentials.username === 'string' && typeof credentials.password === 'string') request.callback(credentials.username, credentials.password);
    else request.callback();
  }

  print(contents: WebContents): void {
    contents.print({}, (success, reason) => {
      if (!success && reason && reason !== 'Print job canceled' && reason !== 'cancelled') this.send(IPC.evToast, { kind: 'error', message: tr('Stampa non riuscita: {0}', reason) });
    });
  }

  /** "Save page as": complete HTML page (with its files) or a single MHTML file. */
  async savePageAs(contents: WebContents): Promise<void> {
    const url = contents.getURL();
    if (!/^(https?|file):/i.test(url)) return;
    const name = (contents.getTitle() || 'pagina').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || 'pagina';
    const { canceled, filePath } = await dialog.showSaveDialog(this.win, {
      title: tr('Salva pagina con nome'),
      defaultPath: join(this.ctx.settings.get().downloadDir ?? app.getPath('downloads'), `${name}.html`),
      filters: [
        { name: tr('Pagina web completa'), extensions: ['html', 'htm'] },
        { name: tr('Pagina web, file singolo (MHTML)'), extensions: ['mhtml'] },
      ],
    });
    if (canceled || !filePath) return;
    try {
      await contents.savePage(filePath, filePath.toLowerCase().endsWith('.mhtml') ? 'MHTML' : 'HTMLComplete');
      this.send(IPC.evToast, { kind: 'success', message: tr('Pagina salvata') });
    } catch (err) {
      this.send(IPC.evToast, { kind: 'error', message: tr('Salvataggio non riuscito: {0}', err instanceof Error ? err.message : String(err)) });
    }
  }

  viewSource(contents: WebContents): void {
    const url = contents.getURL();
    if (/^(https?|file):/i.test(url)) this.tabs.create(`view-source:${url}`, { index: this.indexAfter(contents) });
  }

  savePageToDrive(contents: WebContents): Promise<void> {
    return this.runDriveAction(tr('Salvataggio pagina in PDF'), () => this.ctx.services.savePageAsPdf(contents));
  }

  /**
   * Popup windows (sign-in with Google, Microsoft, a bank…) have no address bar: their title shows
   * the site and whether the connection is secure, so a fake login page can be spotted. They get
   * the same protections as tabs (context menu, external apps, HTTP sign-in, internal pages).
   */
  private setupPopup(popup: BrowserWindow): void {
    const wc = popup.webContents;
    this.setupPage(wc);
    const refresh = () => {
      if (!popup.isDestroyed()) popup.setTitle(popupTitle(wc.getURL(), wc.getTitle()));
    };
    popup.on('page-title-updated', (e) => {
      e.preventDefault();
      refresh();
    });
    wc.on('did-navigate', refresh);
    wc.on('did-navigate-in-page', refresh);
    refresh();
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
    // WebRTC may only use what the privacy setting allows, decided again for every page.
    // Workers get the same fingerprinting protection as the page.
    protectWorkers(contents, (url) => (/^https?:/i.test(url) ? this.ctx.shieldConfigFor(contents.session, url) : null));
    const applyWebRtc = (url: string) => contents.setWebRTCIPHandlingPolicy(webRtcPolicy(this.ctx.settings.get().webRtcProtection, url));
    applyWebRtc(contents.getURL());
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) applyWebRtc(details.url);
    });
    contents.on('login', (event, _details, info, callback) => {
      event.preventDefault();
      owner().requestAuth(contents, info, callback);
    });
    // The auto-hiding bar can come back when the page is scrolled up (and go when scrolled down): the tab
    // preload reports the direction (see preload/page.ts).
    contents.ipc.on('page:scroll-direction', (event, up: unknown) => {
      const s = this.ctx.settings.get();
      if (!s.autoHideToolbar || !s.revealToolbarOnScrollUp || event.senderFrame !== contents.mainFrame) return;
      const w = owner();
      if (w.tabs.activeContents() === contents) w.send(IPC.evScrollReveal, up === true);
    });
    // The auto-hiding bar goes away when the page takes the focus.
    contents.on('focus', () => {
      const w = owner();
      if (w.tabs.activeContents() === contents) w.send(IPC.evPageFocus);
    });
    contents.on('update-target-url', (_e, url) => {
      const w = owner();
      if (w.tabs.activeContents() === contents) w.statusBubble.show(/^(javascript|data):/i.test(url) ? '' : url);
    });
    // Reader mode is offered for pages that look like articles, checked once the page has loaded.
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) readerableIds.delete(contents.id);
    });
    contents.on('did-finish-load', () => {
      void isReaderable(contents).then((ok) => {
        if (contents.isDestroyed()) return;
        if (ok) readerableIds.add(contents.id);
        else readerableIds.delete(contents.id);
        owner().tabs.refresh();
      });
    });
    contents.once('destroyed', () => readerableIds.delete(contents.id));
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
            icon: this.ctx.paths.appIcon,
            webPreferences: { session: contents.session, sandbox: true, contextIsolation: true, nodeIntegration: false, plugins: true },
          },
        };
      }
      owner().tabs.create(url, { background: disposition === 'background-tab', index: owner().indexAfter(contents), ...owner().sameAs(contents) });
      return { action: 'deny' };
    });
    contents.on('did-create-window', (popup) => this.setupPopup(popup));

    contents.on('will-navigate', (e, url) => {
      // Web pages may not open the browser's internal pages.
      if (isInternalUrl(url)) {
        if (!isInternalUrl(contents.getURL())) e.preventDefault();
        return;
      }
      // mailto:, tel:, zoommtg:… go through Chromium's external protocol handling, which asks for the
      // "openExternal" permission: see permissions.ts (dangerous schemes are refused there).
    });

    attachContextMenu(contents, {
      openInNewTab: (url) => owner().tabs.create(url, { background: true, index: owner().indexAfter(contents), ...owner().sameAs(contents) }),
      saveUrlToDrive: (url) => void owner().runDriveAction(tr('Salvataggio su kDrive'), () => this.ctx.services.saveUrlToDrive(contents.session, url)),
      savePageToDrive: (wc) => void owner().savePageToDrive(wc),
      mailLink: (url, title) => owner().composeMail(url, title),
      print: (wc) => owner().print(wc),
      savePageAs: (wc) => void owner().savePageAs(wc),
      viewSource: (wc) => owner().viewSource(wc),
      aiEnabled: () => this.ctx.settings.get().aiEnabled && this.ctx.settings.tokenStatus().configured,
      cloudEnabled: () => this.ctx.settings.tokenStatus().configured,
      askAboutText: (action, text) => owner().send(IPC.evAiAsk, { action, text }),
      askAboutPage: (action) => owner().send(IPC.evAiAsk, { page: action }),
    });
  }
}

