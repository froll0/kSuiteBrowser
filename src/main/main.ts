import {
  BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session as electronSession, shell,
  webContents as allWebContents, type IpcMainInvokeEvent, type Session,
} from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { INTERNAL, IPC } from '../shared/ipc';
import { KSUITE_APPS } from '../shared/ksuite-apps';
import { siteOf } from '../shared/privacy-rules';
import { matchesAll } from '../shared/search-match';
import { buildSuggestions } from '../shared/suggest';
import type {
  AboutInfo, AiChatRequest, ApiResult, BookmarkFolder, HistoryVisit, BrowsingDataSelection, DriveFile, NewEvent, OutgoingMail, Rect, Settings, Suggestion, TabSearchData, TabState,
} from '../shared/types';
import { searchAnswerMessages } from '../shared/ai-prompts';
import { permissionLabel } from '../shared/external-protocols';
import { secureDnsConfig } from '../shared/secure-dns';
import { webRtcPolicy } from '../shared/webrtc';
import { generatePassword } from '../shared/password-gen';
import { framedIconSvg, letterIconSvg, topSites } from '../shared/top-sites';
import { chromeUserAgent, resolveOmniboxInput } from '../shared/url';
import { stepZoom, withSiteZoom, zoomFor } from '../shared/zoom';
import { buildAppMenu } from './app-menu';
import { TrackerBlocker } from './blocker';
import { ThreatProtection } from './threats';
import { ReaderCache, extractArticle, readerOriginal, readerUrl } from './reader';
import { pageMedia, pageMediaAction } from './media';
import type { HoverInfo } from './hover-card';
import { clearBrowsingData } from './browsing-data';
import { DownloadManager } from './downloads';
import { isInternalUrl, registerInternalScheme, serveInternalPages } from './internal-pages';
import { AiService, readPage } from './ai';
import { NotificationCenter } from './notifications';
import { UpdateService } from './updater';
import { PasswordManager } from './passwords/manager';
import { originOf } from './passwords/vault';
import { configurePermissions, memoryOnly, persistentMemory } from './permissions';
import { PrivacyGuard } from './privacy';
import { KSuiteServices } from './services';
import { SettingsStore } from './settings';
import { BookmarksStore } from './stores/bookmarks';
import { FaviconStore } from './stores/favicons';
import { HistoryStore } from './stores/history';
import { BrowserWindowController, NEWTAB_URL, type WindowContext } from './window';

registerInternalScheme();
// Windows shows notifications only for apps with an explicit identity.
if (process.platform === 'win32') app.setAppUserModelId('com.ksuitebrowser.app');

const PATHS = {
  chromePreload: join(__dirname, '../preload/preload.js'),
  pagePreload: join(__dirname, '../preload/page.js'),
  adblockPreload: join(__dirname, '../preload/adblock.js'),
  passwordsPreload: join(__dirname, '../preload/passwords.js'),
  chromeHtml: join(__dirname, '../renderer/index.html'),
  suggestHtml: join(__dirname, '../renderer/suggest.html'),
  suggestPreload: join(__dirname, '../preload/suggest.js'),
  tabSearchHtml: join(__dirname, '../renderer/tabsearch.html'),
  tabSearchPreload: join(__dirname, '../preload/tabsearch.js'),
  // Windows wants a multi-size .ico for crisp taskbar and title bar icons.
  appIcon: join(__dirname, process.platform === 'win32' ? '../icon.ico' : '../icon.png'),
  pages: join(__dirname, '../pages'),
};

let settings: SettingsStore;
let services: KSuiteServices;
let downloads: DownloadManager;
let history: HistoryStore;
let bookmarks: BookmarksStore;
let passwords: PasswordManager;
let favicons: FaviconStore;
let notifications: NotificationCenter;
let updates: UpdateService;
let ai: AiService;

/** A tab to open: `open` ones (links from other apps) load and come to the front, the others start asleep. */
type SavedTab = { url: string; pinned?: boolean; title?: string; open?: boolean };
const blocker = new TrackerBlocker();
const threats = new ThreatProtection();
const readerCache = new ReaderCache();
const guards = new Map<Session, PrivacyGuard>();
const windows = new Set<BrowserWindowController>();
let lastFocused: BrowserWindowController | null = null;
let privateCounter = 0;
let quitting = false;
let dataCleared = false;

const sessionFile = () => join(app.getPath('userData'), 'session.json');
const pendingUrls: SavedTab[] = urlsFromArgv(process.argv).map((url) => ({ url, open: true }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => openFromSystem(urlsFromArgv(argv), true));
  // macOS hands links and files over with events instead of the command line.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) openFromSystem([url]);
  });
  app.on('open-file', (event, path) => {
    event.preventDefault();
    openFromSystem([pathToFileURL(path).href]);
  });
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox('kSuite Browser', String(err));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => {
  history?.flush();
  bookmarks?.flush();
  favicons?.flush();
});

app.on('before-quit', (event) => {
  quitting = true;
  const s = settings?.get();
  if (!s || dataCleared || (!s.clearCookiesOnExit && !s.clearCacheOnExit)) return;
  event.preventDefault();
  dataCleared = true;
  void clearBrowsingData(electronSession.defaultSession, { cookies: s.clearCookiesOnExit, cache: s.clearCacheOnExit })
    .catch((err) => console.error('[privacy] pulizia alla chiusura non riuscita:', err))
    .finally(() => app.quit());
});

/** Web addresses and local documents passed on the command line (e.g. when this is the default browser). */
function urlsFromArgv(argv: string[]): string[] {
  const urls: string[] = [];
  for (const arg of argv.slice(1)) {
    if (/^https?:\/\//i.test(arg)) urls.push(arg);
    else if (!arg.startsWith('-') && /\.(html?|xhtml|pdf|svg|txt)$/i.test(arg) && existsSync(arg)) urls.push(pathToFileURL(resolve(arg)).href);
  }
  return urls;
}

/** Opens links coming from other apps in a normal window (a new one if only private windows are open). */
function openFromSystem(urls: string[], focus = urls.length === 0): void {
  if (!app.isReady() || !settings) {
    pendingUrls.push(...urls.map((url) => ({ url, open: true })));
    return;
  }
  const target = normalWindow();
  if (!target) {
    const w = openWindow(false, urls.length ? urls.map((url) => ({ url, open: true })) : [{ url: settings.get().homePage }]);
    w.focus();
    return;
  }
  for (const url of urls) target.tabs.create(url);
  if (focus || urls.length) target.focus();
}

// ---------- Default browser ----------

/** Registers or checks http/https; in development Electron runs the app folder, which must be part of it. */
function protocolClient<T>(fn: (protocol: string, path?: string, args?: string[]) => T, protocol: string): T {
  return process.defaultApp && process.argv[1] ? fn(protocol, process.execPath, [resolve(process.argv[1])]) : fn(protocol);
}

function isDefaultBrowser(): boolean {
  return ['http', 'https'].every((p) => protocolClient((...a) => app.isDefaultProtocolClient(...a), p));
}

async function makeDefaultBrowser(): Promise<boolean> {
  for (const p of ['http', 'https']) protocolClient((...a) => app.setAsDefaultProtocolClient(...a), p);
  // Windows 10+ only lets the user choose the default browser in its settings.
  if (process.platform === 'win32' && !isDefaultBrowser()) await shell.openExternal('ms-settings:defaultapps');
  return isDefaultBrowser();
}

// ---------- Startup ----------

function start(): void {
  // Look like a regular Chrome: the default user agent names Electron and this app, which makes the
  // browser easy to fingerprint and gets sign-ins refused by some sites (e.g. Google).
  app.userAgentFallback = chromeUserAgent(app.userAgentFallback);

  // In development the app runs inside the Electron binary: give the Dock our icon instead of Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../icon.png'));

  settings = new SettingsStore();
  services = new KSuiteServices(settings);
  downloads = new DownloadManager(settings, services, (items) => broadcast(IPC.evDownloads, items), {
    threatCheck: (url) => threats.match(url),
    window: () => lastFocused?.win ?? null,
  });
  history = new HistoryStore(join(app.getPath('userData'), 'history.json'));
  bookmarks = new BookmarksStore(join(app.getPath('userData'), 'bookmarks.json'));
  favicons = new FaviconStore(join(app.getPath('userData'), 'favicons.json'));
  passwords = new PasswordManager(app.getPath('userData'), settings, (_frame, sender) => {
    for (const w of windows) {
      const tabId = w.tabs.idOf(sender);
      if (tabId !== null) return { window: w, tabId };
    }
    return null;
  });
  passwords.register();
  notifications = new NotificationCenter(settings, services, {
    openApp: (appId) => {
      const appDef = KSUITE_APPS.find((a) => a.id === appId);
      if (!appDef) return;
      const target = normalWindow() ?? openWindow(false, []);
      target.tabs.openApp(appDef.id, appDef.url);
      target.focus();
    },
    onUnread: (count) => broadcast(IPC.evUnread, count),
  });
  notifications.start();
  ai = new AiService(settings);
  settings.onChange((next, prev) => {
    if (next.aiProductId !== prev.aiProductId) ai.reset();
  });
  updates = new UpdateService(settings, (status) => {
    broadcast(IPC.evUpdate, status);
    sendToInternalPages(INTERNAL.evUpdate, status);
  });
  void updates.start();
  bookmarks.onChange((list) => {
    broadcast(IPC.evBookmarks, list);
    sendToInternalPages(INTERNAL.evBookmarks, list);
    refreshAllTabs();
  });

  nativeTheme.themeSource = settings.get().theme;
  nativeTheme.on('updated', () => {
    for (const w of windows) w.applyTitleBarTheme();
  });
  void blocker.setLevel(settings.get().trackingProtection);
  threats.start();
  applySecureDns(settings.get());
  settings.onChange(onSettingsChanged);

  setupSession(electronSession.defaultSession, false);
  registerChromeIpc();
  registerInternalIpc();
  registerAdblockIpc();
  Menu.setApplicationMenu(buildMenu());

  // Links opened from other apps are added to the restored session, like other browsers do.
  const restored = settings.get().startup === 'restore' ? readSavedSession() : [];
  if (restored.length) {
    restored[restored.length - 1].push(...pendingUrls);
    for (const tabs of restored) openWindow(false, tabs);
  } else {
    openWindow(false, pendingUrls);
  }
  pendingUrls.length = 0;

  // Unused background tabs go to sleep to free memory.
  setInterval(() => {
    const minutes = settings.get().sleepTabsAfter;
    if (minutes > 0) for (const w of windows) void w.tabs.sleepIdle(minutes * 60_000);
  }, 60_000).unref();
}

function setupSession(ses: Session, isPrivate: boolean): void {
  const guard = new PrivacyGuard(ses, settings, blocker, (wcId) => {
    const wc = allWebContents.fromId(wcId);
    if (!wc) return;
    for (const w of windows) if (w.tabs.idOf(wc) !== null) w.scheduleRefresh();
  }, (url) => threats.match(url));
  guard.install();
  guards.set(ses, guard);
  downloads.attach(ses, { isPrivate });
  configurePermissions(ses, settings, isPrivate ? memoryOnly() : persistentMemory(settings), () => lastFocused?.win ?? null);
  serveInternalPages(ses, PATHS.pages, faviconFor);
  ses.registerPreloadScript({ type: 'frame', id: 'ksuite-adblock', filePath: PATHS.adblockPreload });
  ses.registerPreloadScript({ type: 'frame', id: 'ksuite-passwords', filePath: PATHS.passwordsPreload });
  // macOS uses the system spell checker; elsewhere pick Italian and English.
  if (process.platform !== 'darwin') {
    const available = ses.availableSpellCheckerLanguages;
    const first = (...codes: string[]) => codes.find((l) => available.includes(l));
    const wanted = [first('it-IT', 'it'), first('en-US', 'en-GB', 'en')].filter((l): l is string => Boolean(l));
    if (wanted.length) ses.setSpellCheckerLanguages(wanted);
  }
}

const windowContext: WindowContext = {
  get settings() {
    return settings;
  },
  get services() {
    return services;
  },
  get history() {
    return history;
  },
  get bookmarks() {
    return bookmarks;
  },
  applyZoom: (wc) => applyZoom(wc),
  stepZoom: (w, wc, direction) => changeZoom(w, wc, direction),
  guardFor: (ses) => guards.get(ses)!,
  ownerOf: (contents) => [...windows].find((w) => w.tabs.idOf(contents) !== null) ?? null,
  switchToTab: (from, tabId) => switchToTab(from, tabId),
  recordFavicon: (contents, source) => {
    const origin = originOf(contents.getURL());
    if (origin) void favicons.record(origin, source, (url) => contents.session.fetch(url));
  },
  paths: PATHS,
  onTabsChanged: (w) => {
    if (!w.isPrivate) scheduleSessionSave();
  },
  onClosed: (w) => {
    windows.delete(w);
    if (lastFocused === w) lastFocused = null;
    // Keep the last window's tabs for the next start (closing it quits the app).
    if (!w.isPrivate && !quitting && normalWindow()) scheduleSessionSave();
  },
};

function openWindow(isPrivate: boolean, tabs: SavedTab[] | null, options: { session?: Session; bounds?: Partial<Electron.Rectangle> } = {}): BrowserWindowController {
  let ses = options.session ?? electronSession.defaultSession;
  if (isPrivate && !options.session) {
    // No "persist:" prefix: cookies, cache and storage live in memory and vanish with the window.
    ses = electronSession.fromPartition(`private-${++privateCounter}`);
    setupSession(ses, true);
  }
  const controller = new BrowserWindowController(windowContext, ses, isPrivate, tabs, options.bounds);
  windows.add(controller);
  lastFocused = controller;
  controller.win.on('focus', () => (lastFocused = controller));
  // A private session lives as long as one of its windows (a tab may have been moved to a new one).
  if (isPrivate) controller.win.on('closed', () => {
    if (![...windows].some((w) => w.session === ses)) guards.delete(ses);
  });
  return controller;
}

function faviconFor(pageUrl: string): { mime: string; body: Buffer | string } {
  const origin = originOf(pageUrl) ?? originOf(`https://${pageUrl}`);
  const cached = origin ? favicons.get(origin) : null;
  if (cached) return { mime: 'image/svg+xml', body: framedIconSvg(cached.mime, cached.body) };
  let host = pageUrl;
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    /* keep raw */
  }
  return { mime: 'image/svg+xml', body: letterIconSvg(host || '?') };
}

// ---------- Moving tabs ----------

/** Moves a tab (with its live page) to another window of the same session, or to a new window. */
function moveTab(from: BrowserWindowController, tabId: number, to: BrowserWindowController | 'new', index?: number, point?: { x: number; y: number }): void {
  if (to !== 'new' && (to === from || to.session !== from.session)) return;
  if (to === 'new' && from.tabs.count() < 2) return;
  const tab = from.tabs.detach(tabId);
  if (!tab) return;
  tab.pinned = false;
  let target = to;
  if (target === 'new') {
    const [width, height] = from.win.getSize();
    const bounds = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: Math.round(point.x - 120), y: Math.round(point.y - 20), width, height } : undefined;
    target = openWindow(from.isPrivate, null, { session: from.session, bounds });
  }
  target.tabs.adopt(tab, index);
  target.focus();
  if (from.tabs.count() === 0) from.win.close();
}

function tabContextMenu(w: BrowserWindowController, tabId: number): void {
  const state = w.tabs.states().find((t) => t.id === tabId);
  if (!state) return;
  const ids = w.tabs.ids();
  const index = ids.indexOf(tabId);
  const others = [...windows].filter((x) => x !== w && x.session === w.session);
  const isPinned = (id: number) => w.tabs.states().find((t) => t.id === id)?.pinned;
  const closeMany = (list: number[]) => {
    for (const id of list) w.tabs.close(id);
  };
  Menu.buildFromTemplate([
    { label: 'Nuova scheda a destra', click: () => w.tabs.create(settings.get().newTabPage === 'newtab' ? NEWTAB_URL : settings.get().homePage, { index: index + 1 }) },
    { type: 'separator' },
    { label: 'Ricarica', click: () => w.tabs.reload(tabId) },
    { label: 'Duplica', click: () => w.tabs.duplicate(tabId) },
    { label: state.pinned ? 'Sblocca scheda' : 'Fissa scheda', click: () => w.tabs.setPinned(tabId, !state.pinned) },
    { label: state.muted ? 'Riattiva audio del sito' : 'Disattiva audio del sito', click: () => w.tabs.setMuted(tabId, !state.muted) },
    {
      label: state.sleeping ? 'In pausa per risparmiare memoria' : 'Metti in pausa (libera memoria)',
      enabled: !state.sleeping && !state.active,
      click: () => w.tabs.sleepTab(tabId),
    },
    { type: 'separator' },
    { label: 'Sposta in una nuova finestra', enabled: ids.length > 1, click: () => moveTab(w, tabId, 'new') },
    ...(others.length
      ? [{ label: 'Sposta nella finestra', submenu: others.map((o) => ({ label: o.tabs.states().find((t) => t.active)?.title.slice(0, 50) ?? 'Finestra', click: () => moveTab(w, tabId, o) })) }]
      : []),
    { type: 'separator' },
    { label: 'Chiudi scheda', click: () => w.closeTab(tabId) },
    { label: 'Chiudi le altre schede', enabled: ids.length > 1, click: () => closeMany(ids.filter((id) => id !== tabId && !isPinned(id))) },
    { label: 'Chiudi le schede a destra', enabled: index < ids.length - 1, click: () => closeMany(ids.slice(index + 1)) },
    { type: 'separator' },
    { label: 'Riapri scheda chiusa', enabled: w.tabs.hasClosed(), click: () => w.tabs.reopenClosed() },
  ]).popup({ window: w.win });
}

function newTabUrl(): string {
  return settings.get().newTabPage === 'newtab' ? NEWTAB_URL : settings.get().homePage;
}

function normalWindow(): BrowserWindowController | null {
  if (lastFocused && !lastFocused.isPrivate) return lastFocused;
  return [...windows].find((w) => !w.isPrivate) ?? null;
}

function current(): BrowserWindowController | null {
  const focused = BrowserWindow.getFocusedWindow();
  return [...windows].find((w) => w.win === focused) ?? lastFocused ?? [...windows][0] ?? null;
}

// ---------- Session restore ----------

let saveTimer: NodeJS.Timeout | null = null;
function scheduleSessionSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = [...windows].filter((w) => !w.isPrivate).map((w) => w.tabs.saved()).filter((tabs) => tabs.length > 0);
    if (data.length === 0) return;
    try {
      writeFileSync(sessionFile(), JSON.stringify({ windows: data }), { mode: 0o600 });
    } catch (err) {
      console.error('[session] salvataggio non riuscito:', err);
    }
  }, 1000);
}

function readSavedSession(): SavedTab[][] {
  try {
    const parsed = JSON.parse(readFileSync(sessionFile(), 'utf8')) as { windows?: unknown };
    if (!Array.isArray(parsed.windows)) return [];
    return parsed.windows
      .filter(Array.isArray)
      .map((tabs: unknown[]) =>
        tabs
          // Older sessions stored plain URLs.
          .map((t) => (typeof t === 'string' ? { url: t } : (t as SavedTab)))
          .filter((t) => t && typeof t.url === 'string' && /^(https?|ksuite|file):/i.test(t.url))
          .map((t) => ({ url: t.url, pinned: Boolean(t.pinned), title: typeof t.title === 'string' ? t.title.slice(0, 300) : undefined })),
      )
      .filter((tabs) => tabs.length > 0);
  } catch {
    return [];
  }
}

// ---------- Settings changes ----------

/** DNS over HTTPS for every window (the resolver is shared by all sessions). */
function applySecureDns(s: Settings): void {
  const config = secureDnsConfig(s.secureDns, s.secureDnsCustom);
  try {
    app.configureHostResolver({ ...config, enableBuiltInResolver: config.secureDnsMode !== 'off' });
  } catch (err) {
    console.error('[dns] configurazione non riuscita:', err);
  }
}

function onSettingsChanged(next: Settings, previous: Settings): void {
  if (next.theme !== previous.theme) nativeTheme.themeSource = next.theme;
  if (next.secureDns !== previous.secureDns || next.secureDnsCustom !== previous.secureDnsCustom) applySecureDns(next);
  if (next.webRtcProtection !== previous.webRtcProtection) {
    // Open pages follow at once (new connections use the new rule).
    for (const wc of allWebContents.getAllWebContents()) {
      if (!wc.isDestroyed() && /^https?:/i.test(wc.getURL())) wc.setWebRTCIPHandlingPolicy(webRtcPolicy(next.webRtcProtection, wc.getURL()));
    }
  }
  if (next.trackingProtection !== previous.trackingProtection) {
    void blocker.setLevel(next.trackingProtection).then(() => refreshAllTabs());
  }
  if (next.driveId !== previous.driveId) services.resetCache();
  if (next.protectionExceptions !== previous.protectionExceptions) refreshAllTabs();
  if (next.clearCookiesOnExit || next.clearCacheOnExit) dataCleared = false;
  if (next.defaultZoom !== previous.defaultZoom || next.siteZoom !== previous.siteZoom) {
    for (const w of windows) for (const t of w.tabs.states()) {
      const wc = w.tabs.contents(t.id);
      if (wc) applyZoom(wc);
    }
    refreshAllTabs();
  }

  broadcast(IPC.evSettings, next);
  sendToInternalPages(INTERNAL.evSettings, next);
}

function sendToInternalPages(channel: string, payload: unknown): void {
  for (const wc of allWebContents.getAllWebContents()) {
    if (!wc.isDestroyed() && isInternalUrl(wc.getURL())) wc.send(channel, payload);
  }
}

// ---------- Zoom ----------

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function applyZoom(wc: Electron.WebContents): void {
  const s = settings.get();
  const host = hostOf(wc.getURL());
  const zoom = host ? zoomFor(host, s.siteZoom, s.defaultZoom) : s.defaultZoom;
  if (Math.round(wc.getZoomFactor() * 100) !== zoom) wc.setZoomFactor(zoom / 100);
}

/** Zooms a page one step; the level is remembered for the site (except in private windows). */
function changeZoom(w: BrowserWindowController, wc: Electron.WebContents, direction: 'in' | 'out' | 'reset'): void {
  const s = settings.get();
  const next = direction === 'reset' ? s.defaultZoom : stepZoom(Math.round(wc.getZoomFactor() * 100), direction);
  wc.setZoomFactor(next / 100);
  const host = hostOf(wc.getURL());
  if (!w.isPrivate && host) settings.update({ siteZoom: withSiteZoom(s.siteZoom, host, next, s.defaultZoom) });
  else w.tabs.refresh();
}

// ---------- Bookmarks ----------

function openUrl(w: BrowserWindowController, url: string, how: 'current' | 'tab' | 'background' | 'window' | 'private'): void {
  if (how === 'window') openWindow(false, [{ url }]);
  else if (how === 'private') openWindow(true, [{ url }]);
  else if (how === 'current' && w.activeTabId() !== null) w.tabs.navigate(w.activeTabId()!, url);
  else w.tabs.create(url, { background: how === 'background' });
}

function bookmarkPageMenu(w: BrowserWindowController, tabId: number): void {
  const wc = w.tabs.contents(tabId);
  if (!wc) return;
  const url = wc.getURL();
  if (!/^(https?|file|ksuite):/i.test(url)) return;
  const existing = bookmarks.find(url);
  if (!existing) {
    bookmarks.add({ title: wc.getTitle(), url, folder: 'bar' });
    w.send(IPC.evToast, { kind: 'success', message: 'Aggiunto alla barra dei preferiti' });
    return;
  }
  const other: BookmarkFolder = existing.folder === 'bar' ? 'other' : 'bar';
  Menu.buildFromTemplate([
    { label: `Nei preferiti: ${existing.title}`, enabled: false },
    { type: 'separator' },
    { label: other === 'other' ? 'Sposta in Altri preferiti' : 'Sposta nella barra dei preferiti', click: () => bookmarks.update(existing.id, { folder: other }) },
    { label: 'Modifica…', click: () => w.openInternal('ksuite://bookmarks/') },
    { label: 'Rimuovi dai preferiti', click: () => bookmarks.remove(existing.id) },
  ]).popup({ window: w.win });
}

function bookmarkContextMenu(w: BrowserWindowController, id: string): void {
  const b = bookmarks.list().find((x) => x.id === id);
  if (!b) return;
  const other: BookmarkFolder = b.folder === 'bar' ? 'other' : 'bar';
  Menu.buildFromTemplate([
    { label: 'Apri', click: () => openUrl(w, b.url, 'current') },
    { label: 'Apri in una nuova scheda', click: () => openUrl(w, b.url, 'background') },
    { label: 'Apri in una nuova finestra', click: () => openUrl(w, b.url, 'window') },
    { label: 'Apri in una finestra privata', click: () => openUrl(w, b.url, 'private') },
    { type: 'separator' },
    { label: other === 'other' ? 'Sposta in Altri preferiti' : 'Sposta nella barra dei preferiti', click: () => bookmarks.update(b.id, { folder: other }) },
    { label: 'Modifica…', click: () => w.openInternal('ksuite://bookmarks/') },
    { label: 'Elimina', click: () => bookmarks.remove(b.id) },
  ]).popup({ window: w.win });
}

function allBookmarksMenu(w: BrowserWindowController): void {
  const item = (b: { title: string; url: string }) => ({ label: b.title.slice(0, 60) || b.url, click: () => openUrl(w, b.url, 'current') });
  const bar = bookmarks.list().filter((b) => b.folder === 'bar');
  const others = bookmarks.list().filter((b) => b.folder === 'other');
  Menu.buildFromTemplate([
    ...bar.map(item),
    ...(bar.length ? [{ type: 'separator' as const }] : []),
    { label: 'Altri preferiti', submenu: others.length ? others.map(item) : [{ label: 'Vuoto', enabled: false }] },
    { type: 'separator' },
    { label: 'Gestisci preferiti', click: () => w.openInternal('ksuite://bookmarks/') },
  ]).popup({ window: w.win });
}

function refreshAllTabs(): void {
  for (const w of windows) w.tabs.refresh();
}

function broadcast(channel: string, payload?: unknown): void {
  for (const w of windows) w.send(channel, payload);
}

// ---------- Menu ----------

function buildMenu(): Menu {
  return buildAppMenu({
    newTab: () => current()?.newTab(),
    newWindow: () => openWindow(false, [{ url: newTabUrl() }]),
    newPrivateWindow: () => openWindow(true, [{ url: newTabUrl() }]),
    reopenClosed: () => current()?.tabs.reopenClosed(),
    selectTab: (index) => current()?.tabs.activateIndex(index),
    closeTab: () => current()?.closeActiveTab(),
    focusAddress: () => current()?.focusChrome(IPC.evFocusAddress),
    reload: () => {
      const w = current();
      const id = w?.activeTabId();
      if (w && id != null) w.tabs.reload(id);
    },
    back: () => current()?.activeContents()?.navigationHistory.goBack(),
    forward: () => current()?.activeContents()?.navigationHistory.goForward(),
    nextTab: () => current()?.tabs.cycle(1),
    previousTab: () => current()?.tabs.cycle(-1),
    togglePanel: () => current()?.send(IPC.evTogglePanel),
    savePageToDrive: () => {
      const w = current();
      const wc = w?.activeContents();
      if (w && wc) void w.savePageToDrive(wc);
    },
    mailPage: () => {
      const w = current();
      const wc = w?.activeContents();
      if (w && wc) w.composeMail(wc.getURL(), wc.getTitle());
    },
    print: () => {
      const w = current();
      const wc = w?.activeContents();
      if (w && wc) w.print(wc);
    },
    savePageAs: () => {
      const w = current();
      const wc = w?.activeContents();
      if (w && wc) void w.savePageAs(wc);
    },
    viewSource: () => {
      const w = current();
      const wc = w?.activeContents();
      if (w && wc) w.viewSource(wc);
    },
    searchTabs: () => toggleTabSearch(current()),
    pictureInPicture: () => {
      const wc = current()?.activeContents();
      if (wc) void pageMediaAction(wc, 'toggle-pip');
    },
    reader: () => {
      const w = current();
      const id = w?.activeTabId();
      if (w && id != null) void toggleReader(w, id);
    },
    openSettings: () => current()?.openSettings(),
    find: () => current()?.focusChrome(IPC.evFind),
    findNext: (backwards) => current()?.send(IPC.evFindNext, { backwards }),
    zoom: (direction) => {
      const w = current();
      const wc = w?.activeContents();
      if (w && wc) changeZoom(w, wc, direction);
    },
    toggleBookmarksBar: () => settings.update({ showBookmarksBar: !settings.get().showBookmarksBar }),
    bookmarkPage: () => {
      const w = current();
      const id = w?.activeTabId();
      if (w && id != null) bookmarkPageMenu(w, id);
    },
    openHistory: () => current()?.openInternal('ksuite://history/'),
    openBookmarks: () => current()?.openInternal('ksuite://bookmarks/'),
    openPasswords: () => current()?.openInternal('ksuite://passwords/'),
    checkUpdates: () => {
      current()?.openSettings('updates');
      void updates.check();
    },
    about: () => current()?.openSettings('about'),
    clearData: () => current()?.openSettings('privacy'),
    devTools: () => current()?.activeContents()?.toggleDevTools(),
  });
}

function showShieldMenu(w: BrowserWindowController, tabId: number): void {
  const wc = w.tabs.contents(tabId);
  const url = wc?.getURL() ?? '';
  const site = /^https?:/i.test(url) ? siteOf(url) : null;
  const guard = guards.get(w.session);
  const s = settings.get();
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (site && guard && wc) {
    const exempt = s.protectionExceptions.includes(site);
    items.push(
      { label: `Protezioni per ${site}`, enabled: false },
      {
        label: 'Blocca tracker e cookie di terze parti su questo sito',
        type: 'checkbox',
        checked: !exempt,
        click: () => {
          const next = exempt ? s.protectionExceptions.filter((h) => h !== site) : [...s.protectionExceptions, site];
          settings.update({ protectionExceptions: next });
          wc.reload();
        },
      },
      { label: `${guard.blockedCount(wc.id)} richieste bloccate in questa pagina`, enabled: false },
    );
    if (guard.wasCleaned(wc.id)) items.push({ label: 'Parametri di tracciamento rimossi dall’indirizzo', enabled: false });
    if (s.trackingProtection === 'off') items.push({ label: 'Il blocco dei tracker è disattivato nelle impostazioni', enabled: false });
    items.push({ type: 'separator' });
  } else {
    items.push({ label: 'Nessuna protezione necessaria per questa pagina', enabled: false }, { type: 'separator' });
  }
  items.push({ label: 'Impostazioni privacy…', click: () => w.openSettings('privacy') });
  Menu.buildFromTemplate(items).popup({ window: w.win });
}


/** Menu of the lock / "Non sicuro" button: connection, the site's permissions and data, protections. */
function showSiteMenu(w: BrowserWindowController, tabId: number): void {
  const wc = w.tabs.contents(tabId);
  const url = wc?.getURL() ?? '';
  if (!wc || !/^https?:/i.test(url)) return;
  const { hostname, protocol, origin } = new URL(url);
  const secure = protocol === 'https:';
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: hostname, enabled: false },
    {
      label: secure ? 'La connessione è sicura' : 'La connessione non è sicura',
      sublabel: secure ? 'Le informazioni che invii restano private' : 'Non inserire password o dati della carta',
      enabled: false,
    },
    { type: 'separator' },
  ];

  if (w.isPrivate) {
    items.push({ label: 'Nelle finestre private i permessi valgono fino alla chiusura', enabled: false });
  } else {
    const granted = settings.get().sitePermissions.filter((p) => p.host === hostname);
    if (granted.length === 0) items.push({ label: 'Nessun permesso scelto per questo sito', enabled: false });
    for (const p of granted) {
      const set = (allowed: boolean | null) => {
        const others = settings.get().sitePermissions.filter((x) => !(x.host === hostname && x.permission === p.permission));
        settings.update({ sitePermissions: allowed === null ? others : [...others, { ...p, allowed }] });
      };
      items.push({
        label: `${permissionLabel(p.permission)}: ${p.allowed ? 'consentito' : 'bloccato'}`,
        submenu: [
          { label: 'Consenti', type: 'radio', checked: p.allowed, click: () => set(true) },
          { label: 'Blocca', type: 'radio', checked: !p.allowed, click: () => set(false) },
          { label: 'Chiedi di nuovo', click: () => set(null) },
        ],
      });
    }
  }
  items.push(
    {
      label: 'Cancella cookie e dati del sito',
      click: async () => {
        const site = siteOf(url);
        const cookies = await wc.session.cookies.get({});
        await Promise.all(cookies
          .filter((c) => c.domain && (c.domain.replace(/^\./, '') === site || c.domain.endsWith(`.${site}`)))
          .map((c) => wc.session.cookies.remove(`${c.secure ? 'https' : 'http'}://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`, c.name)));
        await wc.session.clearStorageData({ origin });
        wc.reload();
      },
    },
    { type: 'separator' },
    { label: 'Protezioni del sito…', click: () => showShieldMenu(w, tabId) },
    { label: 'Impostazioni dei siti…', click: () => w.openSettings('permissions') },
  );
  Menu.buildFromTemplate(items).popup({ window: w.win });
}

/** Tabs listed by "search tabs": every normal window, or only this one for a private window. */
function tabSearchData(w: BrowserWindowController): Omit<TabSearchData, 'reset'> {
  const scope = [...windows].filter((x) => (w.isPrivate ? x === w : !x.isPrivate));
  return {
    tabs: scope.flatMap((x) => x.tabs.states().map((t) => ({
      tabId: t.id,
      title: t.title,
      url: t.url,
      favicon: t.favicon,
      active: t.active,
      sleeping: t.sleeping,
      audible: t.audible,
      otherWindow: x !== w,
      lastActiveAt: t.lastActiveAt,
    }))),
    closed: w.tabs.recentlyClosed(),
    theme: w.isPrivate ? 'dark' : settings.get().theme,
  };
}

/** Brings an open tab to the front, in whichever window holds it (never across private and normal). */
function switchToTab(from: BrowserWindowController, tabId: number): boolean {
  const owner = [...windows].find((x) => x.tabs.ids().includes(tabId));
  if (!owner || owner.isPrivate !== from.isPrivate) return false;
  owner.tabs.activate(tabId);
  owner.focus();
  return true;
}

/** What the tab hover card says: site, state and the memory of the page's process. */
function hoverInfo(w: BrowserWindowController, t: TabState): HoverInfo {
  let host = t.url;
  try {
    const u = new URL(t.url);
    host = u.protocol === 'ksuite:' ? 'kSuite Browser' : u.protocol === 'file:' ? decodeURIComponent(u.pathname) : u.host.replace(/^www\./, '');
  } catch {
    /* keep the address */
  }
  const meta: string[] = [];
  if (t.sleeping) meta.push('In pausa: si ricarica quando la apri');
  else {
    const pid = w.tabs.contents(t.id)?.getOSProcessId();
    const metric = pid ? app.getAppMetrics().find((m) => m.pid === pid) : undefined;
    if (metric) meta.push(`Memoria: ${Math.max(1, Math.round(metric.memory.workingSetSize / 1024))} MB`);
  }
  if (t.audible && !t.muted) meta.push('Sta riproducendo audio');
  if (t.muted) meta.push('Audio disattivato');
  return { title: t.title || t.url, host, meta: meta.join(' · ') };
}

/** Reader mode: extracts the article and shows it in ksuite://reader, or goes back to the page. */
async function toggleReader(w: BrowserWindowController, tabId: number): Promise<void> {
  const wc = w.tabs.contents(tabId);
  if (!wc) return;
  const original = readerOriginal(wc.getURL());
  if (original) {
    exitReader(wc, original);
    return;
  }
  const article = await extractArticle(wc);
  if (!article) {
    w.send(IPC.evToast, { kind: 'info', message: 'In questa pagina non c’è un articolo da mostrare in modalità lettura.' });
    return;
  }
  readerCache.set(article);
  w.tabs.navigate(tabId, readerUrl(article.url));
}

function exitReader(wc: Electron.WebContents, original: string): void {
  const history = wc.navigationHistory;
  const index = history.getActiveIndex();
  if (index > 0 && history.getEntryAtIndex(index - 1)?.url === original) history.goBack();
  else void wc.loadURL(original);
}

/** Media controls of the window: every tab that played sound, with pause/play, picture-in-picture, go to tab. */
async function showMediaMenu(w: BrowserWindowController): Promise<void> {
  const tabs = w.tabs.states().filter((t) => t.media || t.audible);
  const items: Electron.MenuItemConstructorOptions[] = [];
  for (const t of tabs) {
    const wc = w.tabs.contents(t.id);
    if (!wc) continue;
    const info = await pageMedia(wc);
    if (items.length) items.push({ type: 'separator' });
    items.push(
      { label: t.title.length > 60 ? `${t.title.slice(0, 57)}…` : t.title, enabled: false },
      { label: info.playing ? 'Pausa' : 'Riprendi', click: () => void pageMediaAction(wc, info.playing ? 'pause' : 'play') },
      { label: t.muted ? 'Riattiva audio' : 'Disattiva audio', click: () => w.tabs.setMuted(t.id, !t.muted) },
    );
    if (info.hasVideo) items.push({ label: 'Picture-in-picture', type: 'checkbox', checked: info.pip, click: () => void pageMediaAction(wc, 'toggle-pip') });
    if (!t.active) items.push({ label: 'Vai alla scheda', click: () => w.tabs.activate(t.id) });
  }
  if (!items.length) items.push({ label: 'Nessun contenuto audio o video', enabled: false });
  if (!w.win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: w.win });
}

function toggleTabSearch(w: BrowserWindowController | null): void {
  if (!w) return;
  if (w.tabSearch.isVisible()) w.tabSearch.hide();
  else if (!w.tabSearch.justHidden()) {
    w.suggestions.hide();
    void w.tabSearch.show(tabSearchData(w));
  }
}

// ---------- IPC: browser UI ----------

async function wrap<T>(fn: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Handlers for the browser UI; the calling window is resolved from the sender. */
function handle<A extends unknown[], R>(channel: string, fn: (w: BrowserWindowController, ...args: A) => R): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const w = [...windows].find((c) => c.win.webContents === event.sender);
    if (!w) throw new Error('Unauthorized IPC sender');
    return fn(w, ...(args as A));
  });
}

function registerChromeIpc(): void {
  const searcher = (sender: Electron.WebContents) => [...windows].find((c) => c.tabSearch.contents === sender);
  ipcMain.on('tabsearch:choose', (event, tabId: number) => {
    const w = searcher(event.sender);
    const owner = [...windows].find((x) => x.tabs.ids().includes(Number(tabId)));
    if (!w || !owner || owner.isPrivate !== w.isPrivate) return;
    w.tabSearch.hide();
    owner.tabs.activate(Number(tabId));
    owner.focus();
  });
  ipcMain.on('tabsearch:close', (event, tabId: number) => {
    const w = searcher(event.sender);
    const owner = [...windows].find((x) => x.tabs.ids().includes(Number(tabId)));
    if (!w || !owner || owner.isPrivate !== w.isPrivate) return;
    owner.closeTab(Number(tabId));
    if (!w.win.isDestroyed()) w.tabSearch.refresh(tabSearchData(w));
  });
  ipcMain.on('tabsearch:reopen', (event, index: number) => {
    const w = searcher(event.sender);
    if (!w) return;
    w.tabSearch.hide();
    w.tabs.reopenClosedAt(Number(index));
  });
  ipcMain.on('tabsearch:dismiss', (event) => {
    const w = searcher(event.sender);
    if (!w) return;
    w.tabSearch.hide();
    w.activeContents()?.focus();
  });
  ipcMain.on('suggest:choose', (event, index: number) => {
    const w = [...windows].find((c) => c.suggestions.contents === event.sender);
    if (w && Number.isInteger(index)) w.suggestions.choose(index);
  });
  handle(IPC.windowInfo, (w) => ({ isPrivate: w.isPrivate, windowId: w.win.id, platform: process.platform }));
  handle(IPC.tabsMove, (w, id: number, index: number) => w.tabs.move(id, Number(index)));
  handle(IPC.tabsMenu, (w, id: number) => tabContextMenu(w, id));
  handle(IPC.tabsMute, (w, id: number) => {
    const state = w.tabs.states().find((t) => t.id === id);
    if (state) w.tabs.setMuted(id, !state.muted);
  });
  handle(IPC.tabsDetach, (w, id: number, x: number, y: number) => moveTab(w, id, 'new', undefined, { x: Number(x), y: Number(y) }));
  handle(IPC.tabsAdopt, (w, fromWindowId: number, tabId: number, index: number) => {
    const from = [...windows].find((x) => x.win.id === fromWindowId);
    if (from) moveTab(from, Number(tabId), w, Number(index));
  });
  handle(IPC.tabsList, (w) => w.tabs.states());
  handle(IPC.tabsCreate, (w, url?: string) => w.newTab(url ? resolveOmniboxInput(url, settings.get().searchEngine) : undefined));
  handle(IPC.tabsClose, (w, id: number) => w.closeTab(id));
  handle(IPC.tabsActivate, (w, id: number) => w.tabs.activate(id));
  handle(IPC.tabsNavigate, (w, id: number, input: string) => w.tabs.navigate(id, resolveOmniboxInput(input, settings.get().searchEngine)));
  handle(IPC.tabsBack, (w, id: number) => w.tabs.contents(id)?.navigationHistory.goBack());
  handle(IPC.tabsForward, (w, id: number) => w.tabs.contents(id)?.navigationHistory.goForward());
  handle(IPC.tabsReload, (w, id: number) => w.tabs.reload(id));
  handle(IPC.tabsStop, (w, id: number) => w.tabs.contents(id)?.stop());
  handle(IPC.openApp, (w, appId: string) => {
    const appDef = KSUITE_APPS.find((a) => a.id === appId);
    if (appDef) w.tabs.openApp(appDef.id, appDef.url);
  });
  handle(IPC.setContentBounds, (w, rect: Rect) => w.tabs.setBounds(rect));
  handle(IPC.showAppMenu, (w) => Menu.getApplicationMenu()?.popup({ window: w.win }));
  handle(IPC.showShieldMenu, (w, tabId: number) => showShieldMenu(w, tabId));
  handle(IPC.tabSearch, (w) => toggleTabSearch(w));
  handle(IPC.showSiteMenu, (w, tabId: number) => showSiteMenu(w, Number(tabId)));
  handle(IPC.openSettingsPage, (w, section?: string) => w.openSettings(section));

  handle(IPC.suggest, (w, input: string) => {
    const s = settings.get();
    // Private windows: no history, and only their own tabs.
    const useHistory = !w.isPrivate && s.saveHistory;
    const scope = [...windows].filter((x) => (w.isPrivate ? x === w : !x.isPrivate));
    const tabs = scope.flatMap((x) => x.tabs.states().filter((t) => !(x === w && t.active)).map((t) => ({ id: t.id, title: t.title, url: t.url })));
    return buildSuggestions(String(input ?? '').slice(0, 500), s.searchEngine, useHistory ? history.summaries() : [], bookmarks.list(), { tabs });
  });
  handle(IPC.tabsSwitch, (w, tabId: number) => switchToTab(w, Number(tabId)));
  handle(IPC.mediaMenu, (w) => showMediaMenu(w));
  handle(IPC.readerToggle, (w, tabId: number) => toggleReader(w, Number(tabId)));
  handle(IPC.tabHover, (w, tabId: number | null, rect?: Rect) => {
    const state = tabId == null ? undefined : w.tabs.states().find((t) => t.id === Number(tabId));
    if (!state || !rect || w.tabSearch.isVisible()) return w.hoverCard.hide();
    void w.hoverCard.show(hoverInfo(w, state), rect);
  });
  handle(IPC.suggestShow, (w, items: Suggestion[], rect: Rect, selected: number) => w.suggestions.show(items, rect, selected, settings.get().theme));
  handle(IPC.suggestHide, (w) => w.suggestions.hide());
  handle(IPC.findStart, (w, tabId: number, text: string, options: { forward?: boolean; newSearch?: boolean; matchCase?: boolean }) => {
    const wc = w.tabs.contents(tabId);
    if (!wc) return;
    if (!text) {
      wc.stopFindInPage('clearSelection');
      w.send(IPC.evFindResult, { tabId, active: 0, total: 0 });
      return;
    }
    // Electron's naming is inverted: findNext: true starts a new search, false moves to the next match.
    wc.findInPage(String(text), { forward: options?.forward !== false, findNext: options?.newSearch !== false, matchCase: Boolean(options?.matchCase) });
  });
  handle(IPC.findStop, (w, tabId: number) => w.tabs.contents(tabId)?.stopFindInPage('keepSelection'));
  handle(IPC.zoomReset, (w, tabId: number) => {
    const wc = w.tabs.contents(tabId);
    if (wc) changeZoom(w, wc, 'reset');
  });
  handle(IPC.bookmarkToggle, (w, tabId: number) => bookmarkPageMenu(w, tabId));
  handle(IPC.bookmarksList, () => bookmarks.list());
  handle(IPC.bookmarkOpen, (w, id: string, how: 'current' | 'background') => {
    const b = bookmarks.list().find((x) => x.id === id);
    if (b) openUrl(w, b.url, how === 'background' ? 'background' : 'current');
  });
  handle(IPC.bookmarkMenu, (w, id: string) => bookmarkContextMenu(w, id));
  handle(IPC.bookmarksMenu, (w) => allBookmarksMenu(w));
  handle(IPC.aiStatus, () => ai.status());
  handle(IPC.aiChat, async (w, request: AiChatRequest) => {
    const messages = (Array.isArray(request?.messages) ? request.messages : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 20_000) }));
    const tab = request?.pageTabId != null ? w.tabs.contents(Number(request.pageTabId)) : undefined;
    const page = tab ? await readPage(tab).catch(() => null) : null;
    return ai.start(messages, w.win.webContents, IPC.evAi, page);
  });
  handle(IPC.aiCancel, (_w, id: string) => ai.cancel(String(id)));
  handle(IPC.updateStatus, () => updates.get());
  handle(IPC.updateInstall, () => updates.install());
  handle(IPC.authAnswer, (w, id: string, credentials: { username: string; password: string } | null) => w.answerAuth(String(id), credentials));
  handle(IPC.passwordAnswer, (w, id: string, action: 'save' | 'never' | 'dismiss', username?: string) => passwords.answer(w, String(id), action, username));
  handle(IPC.passwordUnlock, (w, primary: string) => wrap(() => passwords.unlock(w, String(primary ?? ''))));

  handle(IPC.settingsGet, () => settings.get());
  handle(IPC.settingsSet, (_w, patch: Partial<Settings>) => settings.update(patch));
  handle(IPC.tokenStatus, () => settings.tokenStatus());

  handle(IPC.apiProfile, () => wrap(() => services.profile()));
  handle(IPC.apiDriveList, (_w, dirId: number, cursor?: string | null) => wrap(() => services.listDirectory(dirId, cursor)));
  handle(IPC.apiDriveSearch, (_w, query: string) => wrap(() => services.search(query)));
  handle(IPC.apiDriveDownload, (_w, fileId: number, name: string) =>
    wrap(async () => {
      const path = await services.downloadToDisk(fileId, name, downloads.folder());
      shell.showItemInFolder(path);
      return path;
    }),
  );
  handle(IPC.apiDriveUpload, (w, dirId: number) =>
    wrap(async () => {
      const picked = await dialog.showOpenDialog(w.win, { title: 'Carica su kDrive', properties: ['openFile', 'multiSelections'] });
      if (picked.canceled) return [];
      const uploaded: DriveFile[] = [];
      for (const path of picked.filePaths) uploaded.push(await services.uploadLocalFile(path, dirId));
      return uploaded;
    }),
  );
  handle(IPC.apiDriveOpenWeb, (w, file: DriveFile) =>
    wrap(async () => {
      w.tabs.create(await services.driveWebUrl(file));
    }),
  );
  handle(IPC.apiSavePageToDrive, (w) =>
    wrap(async () => {
      const wc = w.activeContents();
      if (!wc) throw new Error('Nessuna scheda attiva.');
      await w.savePageToDrive(wc);
    }),
  );
  handle(IPC.apiMailOverview, () => wrap(() => services.mailOverview()));
  handle(IPC.apiMailSend, (_w, mail: OutgoingMail) => wrap(() => services.sendMail(mail)));
  handle(IPC.apiCalendarUpcoming, () => wrap(() => services.upcomingEvents()));
  handle(IPC.apiCalendarCreate, (_w, event: NewEvent) => wrap(() => services.createEvent(event)));

  handle(IPC.downloadsList, () => downloads.list());
  handle(IPC.downloadsOpen, (_w, id: string, reveal: boolean) => downloads.open(id, reveal));
}

// ---------- IPC: internal pages (ksuite://) ----------

/** Handlers for internal pages; only the top frame of the allowed ksuite:// hosts may call them. */
function handleInternal<A extends unknown[], R>(channel: string, hosts: string[], fn: (event: IpcMainInvokeEvent, ...args: A) => R): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const frame = event.senderFrame;
    let allowed = false;
    try {
      const url = new URL(frame?.url ?? '');
      allowed = url.protocol === 'ksuite:' && hosts.includes(url.hostname) && frame === event.sender.mainFrame;
    } catch {
      allowed = false;
    }
    if (!allowed) throw new Error('Unauthorized IPC sender');
    return fn(event, ...(args as A));
  });
}

function registerInternalIpc(): void {
  const S = ['settings'];
  // Every internal page reads the settings (theme); only the settings page changes them.
  handleInternal(INTERNAL.settingsGet, ['settings', 'newtab', 'search', 'history', 'bookmarks', 'passwords', 'https-only', 'blocked', 'reader'], () => settings.get());
  handleInternal(INTERNAL.settingsSet, S, (_e, patch: Partial<Settings>) => settings.update(patch));
  handleInternal(INTERNAL.tokenStatus, S, () => settings.tokenStatus());
  handleInternal(INTERNAL.defaultBrowserStatus, S, () => isDefaultBrowser());
  handleInternal(INTERNAL.defaultBrowserSet, S, () => makeDefaultBrowser());
  handleInternal(INTERNAL.tokenSet, S, (_e, token: string) =>
    wrap(async () => {
      if (!token.trim()) throw new Error('Il token è vuoto.');
      settings.setToken(token);
      services.resetCache();
      const profile = await services.profile();
      notifications.reset();
      ai.reset();
      broadcast(IPC.evSettings, settings.get());
      return profile;
    }),
  );
  handleInternal(INTERNAL.tokenClear, S, () => {
    settings.clearToken();
    services.resetCache();
    notifications.reset();
    broadcast(IPC.evSettings, settings.get());
  });
  handleInternal(INTERNAL.drives, S, () => wrap(() => services.drives()));
  handleInternal(INTERNAL.testNotification, S, () => notifications.test());
  handleInternal(INTERNAL.aiProducts, S, () => wrap(() => ai.listProducts()));
  handleInternal(INTERNAL.aiModels, S, () => wrap(() => ai.listModels()));
  handleInternal(INTERNAL.aiTest, S, () => wrap(() => ai.test()));
  handleInternal(INTERNAL.updateStatus, S, () => updates.get());
  handleInternal(INTERNAL.updateCheck, S, () => updates.check());
  handleInternal(INTERNAL.updateDownload, S, () => updates.download());
  handleInternal(INTERNAL.updateInstall, S, () => updates.install());
  handleInternal(INTERNAL.updateOpenRelease, S, () => updates.openRelease());
  handleInternal(INTERNAL.clearData, S, (event, selection: BrowsingDataSelection) =>
    wrap(async () => {
      await clearBrowsingData(event.sender.session, selection);
      if (selection.history) history.clearSince(0);
      if (selection.downloads) downloads.clear();
      if (selection.permissions) settings.update({ sitePermissions: [] });
    }),
  );
  handleInternal(INTERNAL.chooseDownloadDir, S, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? current()?.win;
    const options = { title: 'Cartella per i download', defaultPath: downloads.folder(), properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    settings.update({ downloadDir: picked.filePaths[0] });
    return picked.filePaths[0];
  });
  handleInternal(INTERNAL.downloadDirInfo, S, () => downloads.folder());
  handleInternal(INTERNAL.about, S, (): AboutInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`,
    userData: app.getPath('userData'),
    blockerLists: blocker.describe(),
  }));
  const HB = ['history', 'bookmarks', 'settings'];
  handleInternal(INTERNAL.historySearch, ['history'], (_e, query: string, before?: number) => history.search(String(query ?? ''), 300, before ?? Infinity));
  handleInternal(INTERNAL.historyRemove, ['history'], (_e, ids: string[]) => history.remove(Array.isArray(ids) ? ids.map(String) : []));
  handleInternal(INTERNAL.historyClear, ['history', 'settings'], (_e, since: number) => history.clearSince(Number(since) || 0));
  handleInternal(INTERNAL.bookmarksList, HB, () => bookmarks.list());
  handleInternal(INTERNAL.bookmarksAdd, ['bookmarks'], (_e, b: { title: string; url: string; folder: BookmarkFolder }) => bookmarks.add(b));
  handleInternal(INTERNAL.bookmarksUpdate, ['bookmarks'], (_e, id: string, patch: { title?: string; url?: string; folder?: BookmarkFolder }) => bookmarks.update(String(id), patch ?? {}));
  handleInternal(INTERNAL.bookmarksRemove, ['bookmarks'], (_e, id: string) => bookmarks.remove(String(id)));
  handleInternal(INTERNAL.bookmarksShift, ['bookmarks'], (_e, id: string, direction: number) => bookmarks.shift(String(id), direction < 0 ? -1 : 1));
  handleInternal(INTERNAL.bookmarksImport, ['bookmarks'], (_e, items: Array<{ title: string; url: string; folder: BookmarkFolder }>) =>
    bookmarks.import(Array.isArray(items) ? items.slice(0, 20000) : []),
  );
  const P = ['passwords'];
  const vault = () => passwords.vault;
  handleInternal(INTERNAL.pwStatus, [...P, 'settings'], () => vault().status());
  handleInternal(INTERNAL.pwUnlock, P, (_e, primary: string) => wrap(async () => {
    await vault().unlock(String(primary ?? ''));
    passwords.touch();
  }));
  handleInternal(INTERNAL.pwLock, P, () => vault().lock());
  handleInternal(INTERNAL.pwBreaches, P, () => passwords.breachReport());
  handleInternal(INTERNAL.pwBreachCheck, P, () => wrap(() => {
    passwords.touch();
    return passwords.checkBreaches();
  }));
  handleInternal(INTERNAL.pwList, P, () => wrap(() => {
    passwords.touch();
    return vault().list();
  }));
  handleInternal(INTERNAL.pwNever, P, () => wrap(() => vault().never()));
  handleInternal(INTERNAL.pwAdd, P, (_e, entry: { url: string; username: string; password: string }) => wrap(() => {
    const origin = originOf(String(entry?.url ?? '')) ?? originOf(`https://${String(entry?.url ?? '')}`);
    if (!origin) throw new Error('Indirizzo del sito non valido.');
    if (!entry.password) throw new Error('La password è vuota.');
    return vault().save(origin, String(entry.username ?? ''), String(entry.password));
  }));
  handleInternal(INTERNAL.pwUpdate, P, (_e, id: string, patch: { username?: string; password?: string; origin?: string }) => wrap(() => vault().update(String(id), patch ?? {})));
  handleInternal(INTERNAL.pwRemove, P, (_e, id: string) => wrap(() => vault().remove(String(id))));
  handleInternal(INTERNAL.pwRemoveNever, P, (_e, origin: string) => wrap(() => vault().setNever(String(origin), false)));
  handleInternal(INTERNAL.pwSetPrimary, P, (_e, next: string, current?: string) => wrap(() => vault().setPrimary(String(next ?? ''), String(current ?? ''))));
  handleInternal(INTERNAL.pwRemovePrimary, P, (_e, current: string) => wrap(() => vault().removePrimary(String(current ?? ''))));
  handleInternal(INTERNAL.pwImport, P, (_e, csv: string) => wrap(() => vault().importCsv(String(csv ?? '').slice(0, 20_000_000))));
  handleInternal(INTERNAL.pwExport, P, (_e, primary?: string) => wrap(async () => {
    // Exporting writes every password in clear text: ask for the primary password again.
    if (!(await vault().checkPrimary(String(primary ?? '')))) throw new Error('Password principale errata.');
    return vault().exportCsv();
  }));
  handleInternal(INTERNAL.pwGenerate, P, () => generatePassword());
  handleInternal(INTERNAL.newtabData, ['newtab'], (event) => {
    const s = settings.get();
    const isPrivate = !event.sender.session.isPersistent();
    return {
      isPrivate,
      topSites: !isPrivate && s.saveHistory && s.showTopSites ? topSites(history.summaries(), s.hiddenTopSites) : [],
      searchEngine: s.searchEngine,
      showTopSites: s.showTopSites,
      hiddenCount: s.hiddenTopSites.length,
    };
  });
  handleInternal(INTERNAL.newtabHide, ['newtab'], (_e, url: string) => {
    const origin = originOf(String(url ?? ''));
    if (origin) settings.update({ hiddenTopSites: [...settings.get().hiddenTopSites, origin] });
  });
  handleInternal(INTERNAL.newtabRestore, ['newtab', 'settings'], () => settings.update({ hiddenTopSites: [] }));
  handleInternal(INTERNAL.newtabSuggest, ['newtab'], (event, input: string) => {
    const s = settings.get();
    // Private windows: no history suggestions, bookmarks only.
    const useHistory = event.sender.session.isPersistent() && s.saveHistory;
    return buildSuggestions(String(input ?? '').slice(0, 500), s.searchEngine, useHistory ? history.summaries() : [], bookmarks.list());
  });
  registerSearchIpc();
  handleInternal(INTERNAL.threatContinue, ['blocked'], (event, url: string) => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('URL non valido');
    threats.allow(parsed.href);
    void event.sender.loadURL(parsed.href);
  });
  handleInternal(INTERNAL.threatStatus, ['settings'], () => threats.status());
  const R = ['reader'];
  handleInternal(INTERNAL.readerArticle, R, (_e, url: string) => readerCache.get(String(url)));
  handleInternal(INTERNAL.readerPrefs, R, (_e, patch: Partial<Settings>) => {
    const p = patch ?? {};
    return settings.update({
      ...(p.readerFontSize !== undefined ? { readerFontSize: p.readerFontSize } : {}),
      ...(p.readerFont !== undefined ? { readerFont: p.readerFont } : {}),
      ...(p.readerTheme !== undefined ? { readerTheme: p.readerTheme } : {}),
      ...(p.readerWidth !== undefined ? { readerWidth: p.readerWidth } : {}),
    });
  });
  handleInternal(INTERNAL.readerExit, R, (event) => {
    const original = readerOriginal(event.sender.getURL());
    if (original) exitReader(event.sender, original);
  });
  handleInternal(INTERNAL.readerAskAi, R, (event, action: string) => {
    const w = [...windows].find((x) => x.tabs.idOf(event.sender) !== null);
    if (w && settings.get().aiEnabled) w.send(IPC.evAiAsk, { page: action === 'keypoints' ? 'keypoints' : 'summary' });
  });
  handleInternal(INTERNAL.httpsContinue, ['https-only'], (event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') throw new Error('URL non valido');
    const host = parsed.hostname.toLowerCase();
    if (!settings.get().httpExceptions.includes(host)) settings.update({ httpExceptions: [...settings.get().httpExceptions, host] });
    void event.sender.loadURL(parsed.href);
  });
}

// ---------- IPC: unified search (ksuite://search) ----------

function registerSearchIpc(): void {
  const H = ['search'];
  const q = (value: unknown) => String(value ?? '').trim().slice(0, 300);
  const ownerOf = (sender: Electron.WebContents) => [...windows].find((w) => w.tabs.idOf(sender) !== null) ?? null;

  handleInternal(INTERNAL.searchMeta, H, (event) => {
    const s = settings.get();
    const configured = settings.tokenStatus().configured;
    return {
      tokenConfigured: configured,
      webSearchEngine: s.webSearchEngine,
      isDefault: s.searchEngine === 'ksuite',
      aiEnabled: configured && s.aiEnabled,
      // Private windows never send the query to the AI without a click.
      aiAutoAnswer: configured && s.aiEnabled && s.aiAutoAnswer && event.sender.session.isPersistent(),
    };
  });
  handleInternal(INTERNAL.searchLocal, H, (event, query: string) => {
    const text = q(query);
    if (!text) return { bookmarks: [], history: [] };
    const found = bookmarks.list().filter((b) => matchesAll(text, b.title, b.url)).slice(0, 5);
    const seen = new Set(found.map((b) => b.url));
    const visits: HistoryVisit[] = [];
    // Private windows never show history.
    if (event.sender.session.isPersistent() && settings.get().saveHistory) {
      for (const v of history.search(text, 60)) {
        if (seen.has(v.url)) continue;
        seen.add(v.url);
        visits.push(v);
        if (visits.length === 6) break;
      }
    }
    return { bookmarks: found, history: visits };
  });
  handleInternal(INTERNAL.searchDrive, H, (_e, query: string) => wrap(async () => (await services.search(q(query))).slice(0, 8)));
  handleInternal(INTERNAL.searchMail, H, (_e, query: string) => wrap(() => services.searchMail(q(query))));
  handleInternal(INTERNAL.searchContacts, H, (_e, query: string) => wrap(() => services.searchContacts(q(query))));
  handleInternal(INTERNAL.searchEvents, H, (_e, query: string) => wrap(() => services.searchEvents(q(query))));
  handleInternal(INTERNAL.searchOpenDrive, H, (_e, file: DriveFile) => wrap(() => services.driveWebUrl(file)));
  handleInternal(INTERNAL.searchOpenApp, H, (event, appId: string) => {
    const appDef = KSUITE_APPS.find((a) => a.id === appId);
    const w = ownerOf(event.sender);
    if (appDef && w) w.tabs.openApp(appDef.id, appDef.url);
  });
  handleInternal(INTERNAL.searchCompose, H, (event, to: string) => {
    ownerOf(event.sender)?.send(IPC.evComposeMail, { to: String(to ?? ''), subject: '', body: '' });
  });
  handleInternal(INTERNAL.searchSetDefault, H, () => settings.update({ searchEngine: 'ksuite' }));
  handleInternal(INTERNAL.searchAi, H, (event, query: string) => ai.start(searchAnswerMessages(q(query)), event.sender, INTERNAL.evAi));
  handleInternal(INTERNAL.aiCancel, H, (_e, id: string) => ai.cancel(String(id)));
}

// ---------- IPC: cosmetic filtering (strict mode) ----------

function registerAdblockIpc(): void {
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => true);
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url: string, msg?: Parameters<TrackerBlocker['cosmetics']>[1]) => {
    const guard = guards.get(event.sender.session);
    if (!guard || typeof url !== 'string' || !guard.protectionActiveFor(url)) return;
    const result = blocker.cosmetics(url, msg, { frameId: event.frameId, processId: event.processId });
    if (!result) return;
    if (result.styles.length > 0) void event.sender.insertCSS(result.styles, { cssOrigin: 'user' });
    for (const script of result.scripts) void event.sender.executeJavaScript(script, true).catch(() => undefined);
  });
}
