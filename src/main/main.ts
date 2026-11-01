// Must stay first: the profile folder, then the interface language, are chosen before the other modules load.
import './profile-boot';
import './locale-boot';
import {
  BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session as electronSession, shell,
  webContents as allWebContents, type IpcMainInvokeEvent, type Session,
} from 'electron';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { cpus } from 'node:os';
import { pathToFileURL } from 'node:url';
import { INTERNAL, IPC } from '../shared/ipc';
import { INFOMANIAK_APPS } from '../shared/infomaniak-apps';
import { siteOf } from '../shared/privacy-rules';
import { matchesAll } from '../shared/search-match';
import { buildSuggestions } from '../shared/suggest';
import type {
  AutofillAddress, AutofillCard, ImportReport, TabGroup, TagColor, TabLayout, PaletteChoice, PaletteData, SiteSettingsPatch, AboutInfo, AiChatRequest, ApiResult, BookmarkFolder, HistoryVisit, BrowsingDataSelection, DriveFile, NewEvent, OutgoingMail, Rect, Settings, Suggestion, TabSearchData, TabState,
} from '../shared/types';
import { TOOLBAR_ITEMS, TOOLBAR_ITEM_IDS, type ToolbarItem } from '../shared/appearance';
import { searchAnswerMessages } from '../shared/ai-prompts';
import { permissionLabel } from '../shared/external-protocols';
import { secureDnsConfig } from '../shared/secure-dns';
import { shieldConfig, type ShieldConfig } from '../shared/fingerprint';
import { webRtcPolicy } from '../shared/webrtc';
import { generatePassword } from '../shared/password-gen';
import { framedIconSvg, letterIconSvg, topSites } from '../shared/top-sites';
import { chromeUserAgent, resolveOmniboxInput } from '../shared/url';
import { stepZoom, withSiteZoom, zoomFor } from '../shared/zoom';
import { buildAppMenu, type AppMenuActions } from './app-menu';
import { COMMANDS, COMMAND_IDS, SETTINGS_SECTIONS, displayShortcut, shortcutFor, type CommandId } from '../shared/commands';
import { TrackerBlocker } from './blocker';
import { ThreatProtection } from './threats';
import { ReaderCache, extractArticle, readerOriginal, readerUrl } from './reader';
import { pageMedia, pageMediaAction } from './media';
import { widevineReady, widevineStatus } from './widevine';
import { SyncEngine } from './sync/engine';
import type { HoverInfo } from './hover-card';
import { clearBrowsingData } from './browsing-data';
import { DownloadManager } from './downloads';
import { isInternalUrl, registerInternalScheme, serveInternalPages } from './internal-pages';
import { AiService, readPage } from './ai';
import { NotificationCenter } from './notifications';
import { UpdateService } from './updater';
import { PasswordManager, currentTotp } from './passwords/manager';
import { originOf } from './passwords/vault';
import { configurePermissions, memoryOnly, persistentMemory } from './permissions';
import { PrivacyGuard } from './privacy';
import { CloudServices } from './services';
import { SettingsStore } from './settings';
import { BookmarksStore } from './stores/bookmarks';
import { FaviconStore } from './stores/favicons';
import { HistoryStore } from './stores/history';
import { BrowserWindowController, NEWTAB_URL, popupLook, type WindowContext } from './window';
import { DEFAULT_SETTINGS, TAG_COLORS, TAG_COLOR_INFO, sanitizeSettings } from '../shared/settings-schema';
import { purgeRemovedFeatures } from './purge';
import { SiteForgetter } from './forget';
import { createProfile, currentProfile, listProfiles, openProfile, removeProfile, updateProfile } from './profiles';
import { detectSources, importCookies, readSource, type ImportKind } from './importer';
import { applySiteSettings, clearSiteData, normalizeSiteHost, siteSettingsInfo } from './site-settings';
import { openSites } from '../shared/forget-sites';
import { isAllowedInternalSender } from '../shared/ipc-guard';
import { locale, plural, resolveLocale, tr } from '../shared/i18n';

// Widevine comes from Google's component updater: unless the user turned protected content on, it
// stays off and the browser makes no request to Google's update servers.
// Protected content: the component updater (Widevine, from Google) runs only when asked for.
if (!startupSetting('drmOptIn')) app.commandLine.appendSwitch('disable-component-update');
// Third-party cookies blocked in Chromium itself: not only on the network but also for scripts in
// embedded frames (document.cookie), the way trackers otherwise follow you across sites. Partitioned
// cookies (CHIPS) and the Storage Access API (asked to the user) still work for legitimate embeds.
if (startupSetting('blockThirdPartyCookies')) app.commandLine.appendSwitch('test-third-party-cookie-phaseout');
// Higher security levels: no JavaScript JIT compiler (the source of most browser exploits) and so no
// WebAssembly; audio and video start only after a click on the page.
if (startupSetting('securityLevel') !== 'standard') {
  app.commandLine.appendSwitch('js-flags', '--jitless');
  app.commandLine.appendSwitch('autoplay-policy', 'document-user-activation-required');
}
registerInternalScheme();
// Every renderer runs in Chromium's sandbox, whatever its own options say (unless --no-sandbox is
// given explicitly: only for development and tests running as root, where Chromium needs it).
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
// No page may embed a <webview> (a full browser inside the page) or open windows Velo doesn't manage.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});
// Windows shows notifications only for apps with an explicit identity.
if (process.platform === 'win32') app.setAppUserModelId('io.github.froll0.velo');

const PATHS = {
  chromePreload: join(__dirname, '../preload/preload.js'),
  pagePreload: join(__dirname, '../preload/page.js'),
  adblockPreload: join(__dirname, '../preload/adblock.js'),
  passwordsPreload: join(__dirname, '../preload/passwords.js'),
  shieldPreload: join(__dirname, '../preload/shield.js'),
  chromeHtml: join(__dirname, '../renderer/index.html'),
  suggestHtml: join(__dirname, '../renderer/suggest.html'),
  suggestPreload: join(__dirname, '../preload/suggest.js'),
  tabSearchHtml: join(__dirname, '../renderer/tabsearch.html'),
  tabSearchPreload: join(__dirname, '../preload/tabsearch.js'),
  paletteHtml: join(__dirname, '../renderer/palette.html'),
  palettePreload: join(__dirname, '../preload/palette.js'),
  // Windows wants a multi-size .ico for crisp taskbar and title bar icons.
  appIcon: join(__dirname, process.platform === 'win32' ? '../icon.ico' : '../icon.png'),
  pages: join(__dirname, '../pages'),
};

let settings: SettingsStore;
let services: CloudServices;
let downloads: DownloadManager;
let history: HistoryStore;
let bookmarks: BookmarksStore;
let passwords: PasswordManager;
let sync: SyncEngine;
let favicons: FaviconStore;
let notifications: NotificationCenter;
let updates: UpdateService;
let ai: AiService;
let forgetter: SiteForgetter | null = null;

/** A tab to open: `open` ones (links from other apps) load and come to the front, the others start asleep. */
type SavedTab = { url: string; pinned?: boolean; title?: string; open?: boolean; groupId?: string | null; workspace?: string; container?: string | null };
type SavedWindow = { tabs: SavedTab[]; layout?: Partial<TabLayout> };
const blocker = new TrackerBlocker();
const threats = new ThreatProtection();
const readerCache = new ReaderCache();
const guards = new Map<Session, PrivacyGuard>();
/** Random key per session for fingerprinting protection: values change at every restart. */
const fingerprintKeys = new WeakMap<Session, Buffer>();
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
    dialog.showErrorBox('Velo', String(err));
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
  // Changes of the last second (the save waits a moment) are kept too.
  if (!quitting && settings) saveSessionNow();
  quitting = true;
  const s = settings?.get();
  // Sites to forget: the ones still open, unless their tabs come back at the next start.
  // Per session: the normal one and each container keep their own cookies.
  const forget = s && s.forgetSitesOnClose && s.startup !== 'restore'
    ? allForgetters().flatMap(([container, f]) => [...openSites(tabUrls(container))].filter((site) => !s.rememberedSites.includes(site)).map((site) => () => f.forget(site)))
    : [];
  if (!s || dataCleared || (!s.clearCookiesOnExit && !s.clearCacheOnExit && forget.length === 0)) return;
  event.preventDefault();
  dataCleared = true;
  void Promise.all([
    ...(s.clearCookiesOnExit || s.clearCacheOnExit
      ? persistentSessions().map((ses) => clearBrowsingData(ses, { cookies: s.clearCookiesOnExit, cache: s.clearCacheOnExit }))
      : []),
    ...forget.map((run) => run()),
  ])
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

async function start(): Promise<void> {
  app.setAboutPanelOptions({ applicationName: 'Velo', applicationVersion: app.getVersion(), copyright: tr('Licenza MIT') });
  // Look like a regular Chrome: the default user agent names Electron and this app, which makes the
  // browser easy to fingerprint and gets sign-ins refused by some sites (e.g. Google).
  app.userAgentFallback = chromeUserAgent(app.userAgentFallback);

  // In development the app runs inside the Electron binary: give the Dock our icon instead of Electron's.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../icon.png'));

  settings = new SettingsStore();
  services = new CloudServices(settings);
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
  sync = new SyncEngine({
    userData: app.getPath('userData'),
    services,
    tokenConfigured: () => settings.tokenStatus().configured,
    bookmarks,
    history,
    vault: passwords.vault,
    openTabs: () => [...windows]
      .filter((w) => !w.isPrivate)
      .flatMap((w) => w.tabs.states())
      .filter((t) => /^https?:/i.test(t.url))
      .map((t) => ({ title: t.title, url: t.url })),
    onStatus: (status) => sendToInternalPages(INTERNAL.evSync, status),
    spaces: {
      get: () => ({ workspaces: settings.get().workspaces, containers: settings.get().containers }),
      set: (key, items) => settings.update({ [key]: items } as Partial<Settings>),
      isDefault: (key) => JSON.stringify(settings.get()[key]) === JSON.stringify(DEFAULT_SETTINGS[key]),
    },
  });
  settings.onChange((next, prev) => {
    if (JSON.stringify([next.workspaces, next.containers]) !== JSON.stringify([prev.workspaces, prev.containers])) sync.soon();
  });
  bookmarks.onChange(() => sync.soon());
  passwords.vault.onChange(() => sync.soon());
  sync.start();
  passwords.register();
  forgetter = new SiteForgetter(electronSession.defaultSession, settings, () => tabUrls(null));
  notifications = new NotificationCenter(settings, services, {
    openApp: (appId) => {
      const appDef = INFOMANIAK_APPS.find((a) => a.id === appId);
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
  // Extensions and Tor were removed: what older versions left in the profile goes too.
  await purgeRemovedFeatures(app.getPath('userData'), electronSession.defaultSession).catch((err) => console.error('[profilo] pulizia non riuscita:', err));
  Menu.setApplicationMenu(buildMenu());

  // Protected content (Netflix…): pages opened before the Widevine module is ready can't play it.
  if (settings.get().drmOptIn) await widevineReady(8000);

  // Links opened from other apps are added to the restored session, like other browsers do.
  const restored = settings.get().startup === 'restore' ? readSavedSession() : [];
  if (restored.length) {
    restored[restored.length - 1].tabs.push(...pendingUrls);
    for (const w of restored) openWindow(false, w.tabs, { layout: w.layout });
  } else {
    // First start: the welcome page (shown once, also if it's closed before the end).
    const first = settings.get().onboarded ? [] : [{ url: 'velo://welcome/', open: true }];
    if (first.length) settings.update({ onboarded: true });
    openWindow(false, [...first, ...pendingUrls]);
  }
  pendingUrls.length = 0;

  // Unused background tabs go to sleep to free memory.
  setInterval(() => {
    const minutes = settings.get().sleepTabsAfter;
    if (minutes > 0) for (const w of windows) void w.tabs.sleepIdle(minutes * 60_000);
  }, 60_000).unref();
}

/** Sets up a session; `container` for a container's (its own site permissions). */
function setupSession(ses: Session, isPrivate: boolean, container?: string): void {
  const guard = new PrivacyGuard(ses, settings, blocker, (wcId) => {
    const wc = allWebContents.fromId(wcId);
    if (!wc) return;
    for (const w of windows) if (w.tabs.idOf(wc) !== null) w.scheduleRefresh();
  }, (url) => threats.match(url));
  guard.install();
  guards.set(ses, guard);
  downloads.attach(ses, { isPrivate });
  configurePermissions(ses, settings, isPrivate ? memoryOnly() : persistentMemory(settings, container), () => lastFocused?.win ?? null, (contents) => offerDrm(contents));
  serveInternalPages(ses, PATHS.pages, faviconFor);
  ses.registerPreloadScript({ type: 'frame', id: 'velo-adblock', filePath: PATHS.adblockPreload });
  ses.registerPreloadScript({ type: 'frame', id: 'velo-passwords', filePath: PATHS.passwordsPreload });
  ses.registerPreloadScript({ type: 'frame', id: 'velo-shield', filePath: PATHS.shieldPreload });
  // On Linux Chromium downloads the Hunspell dictionaries from Google: Velo ships them instead, and
  // the download address leads nowhere (a closed local port) so nothing ever goes to Google.
  if (process.platform === 'linux') {
    ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/');
    installBundledDictionaries();
  }
  // macOS uses the system spell checker; elsewhere pick Italian and English.
  if (process.platform !== 'darwin') {
    const available = ses.availableSpellCheckerLanguages;
    const first = (...codes: string[]) => codes.find((l) => available.includes(l));
    const wanted = [first('it-IT', 'it'), first('en-US', 'en-GB', 'en')].filter((l): l is string => Boolean(l));
    if (wanted.length) ses.setSpellCheckerLanguages(wanted);
  }
}

// ---------- Containers ----------

const containerSessions = new Map<string, Session>();

/** Session of a container: its own cookies, storage and cache on disk, with the same protections. */
function containerSession(id: string): Session | undefined {
  if (!settings.get().containers.some((c) => c.id === id)) return undefined;
  let ses = containerSessions.get(id);
  if (!ses) {
    ses = electronSession.fromPartition(`persist:container-${id}`);
    setupSession(ses, false, id);
    containerSessions.set(id, ses);
    containerForgetters.set(id, new SiteForgetter(ses, settings, () => tabUrls(id)));
  }
  return ses;
}

const containerForgetters = new Map<string, SiteForgetter>();

/** Addresses of the tabs of normal windows in a container (null: without container). */
function tabUrls(container: string | null): string[] {
  return [...windows].filter((w) => !w.isPrivate).flatMap((w) => w.tabs.states().filter((t) => t.container === container).map((t) => t.url));
}

/** "Forget sites" for the normal session and for every container in use. */
function allForgetters(): Array<[string | null, SiteForgetter]> {
  return [...(forgetter ? [[null, forgetter] as [null, SiteForgetter]] : []), ...containerForgetters];
}

/** The sessions saved on disk: the normal one and those of the containers (also unused ones). */
function persistentSessions(): Session[] {
  return [electronSession.defaultSession, ...settings.get().containers.map((c) => containerSession(c.id)).filter((x): x is Session => Boolean(x))];
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
  shieldConfigFor: (ses, url) => shieldConfigFor(ses, url),
  containerSession: (id) => containerSession(id),
  stepZoom: (w, wc, direction) => changeZoom(w, wc, direction),
  guardFor: (ses) => guards.get(ses),
  ownerOf: (contents) => [...windows].find((w) => w.tabs.idOf(contents) !== null) ?? null,
  switchToTab: (from, tabId) => switchToTab(from, tabId),
  recordFavicon: (contents, source) => {
    const origin = originOf(contents.getURL());
    if (origin) void favicons.record(origin, source, (url) => contents.session.fetch(url));
  },
  paths: PATHS,
  onTabsChanged: (w) => {
    if (!w.isPrivate) {
      scheduleSessionSave();
      for (const [, f] of allForgetters()) f.update();
    }
  },
  onClosed: (w) => {
    windows.delete(w);
    if (!w.isPrivate) for (const [, f] of allForgetters()) f.update();
    if (lastFocused === w) lastFocused = null;
    // Keep the last window's tabs for the next start (closing it quits the app).
    if (!w.isPrivate && !quitting && normalWindow()) scheduleSessionSave();
  },
};

function openWindow(
  isPrivate: boolean,
  tabs: SavedTab[] | null,
  options: { session?: Session; bounds?: Partial<Electron.Rectangle>; layout?: Partial<TabLayout> } = {},
): BrowserWindowController {
  let ses = options.session ?? electronSession.defaultSession;
  if (isPrivate && !options.session) {
    // No "persist:" prefix: cookies, cache and storage live in memory and vanish with the window.
    ses = electronSession.fromPartition(`private-${++privateCounter}`);
    setupSession(ses, true);
  }
  const controller = new BrowserWindowController(windowContext, ses, isPrivate, tabs, options.bounds, options.layout);
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
    { label: tr('Nuova scheda a destra'), click: () => w.tabs.create(settings.get().newTabPage === 'newtab' ? NEWTAB_URL : settings.get().homePage, { index: index + 1 }) },
    { type: 'separator' },
    { label: tr('Ricarica'), click: () => w.tabs.reload(tabId) },
    { label: tr('Duplica'), click: () => w.tabs.duplicate(tabId) },
    { label: state.pinned ? tr('Sblocca scheda') : tr('Fissa scheda'), click: () => w.tabs.setPinned(tabId, !state.pinned) },
    { label: state.muted ? tr('Riattiva audio del sito') : tr('Disattiva audio del sito'), click: () => w.tabs.setMuted(tabId, !state.muted) },
    {
      label: state.sleeping ? tr('In pausa per risparmiare memoria') : tr('Metti in pausa (libera memoria)'),
      enabled: !state.sleeping && !state.active,
      click: () => w.tabs.sleepTab(tabId),
    },
    { type: 'separator' },
    ...tabOrganizeItems(w, tabId, state),
    { type: 'separator' },
    { label: tr('Sposta in una nuova finestra'), enabled: ids.length > 1, click: () => moveTab(w, tabId, 'new') },
    ...(others.length
      ? [{ label: tr('Sposta nella finestra'), submenu: others.map((o) => ({ label: o.tabs.states().find((t) => t.active)?.title.slice(0, 50) ?? tr('Finestra'), click: () => moveTab(w, tabId, o) })) }]
      : []),
    { type: 'separator' },
    { label: tr('Chiudi scheda'), click: () => w.closeTab(tabId) },
    { label: tr('Chiudi le altre schede'), enabled: ids.length > 1, click: () => closeMany(ids.filter((id) => id !== tabId && !isPinned(id))) },
    { label: tr('Chiudi le schede a destra'), enabled: index < ids.length - 1, click: () => closeMany(ids.slice(index + 1)) },
    { type: 'separator' },
    { label: tr('Riapri scheda chiusa'), enabled: w.tabs.hasClosed(), click: () => w.tabs.reopenClosed() },
  ]).popup({ window: w.win });
}

/** Groups, workspaces and containers in the tab menu. */
function tabOrganizeItems(w: BrowserWindowController, tabId: number, state: TabState): Electron.MenuItemConstructorOptions[] {
  const groups = w.tabs.groupList();
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (!state.pinned) {
    items.push(state.groupId
      ? { label: tr('Rimuovi dal gruppo'), click: () => w.tabs.setGroup(tabId, null) }
      : { label: tr('Aggiungi a un nuovo gruppo'), click: () => w.tabs.createGroup([tabId]) });
    const others = groups.filter((g) => g.id !== state.groupId);
    if (others.length) items.push({ label: tr('Aggiungi al gruppo'), submenu: others.map((g) => ({ label: groupLabel(g), click: () => w.tabs.setGroup(tabId, g.id) })) });
  }
  if (!w.isPrivate) {
    const spaces = settings.get().workspaces;
    items.push({
      label: tr('Sposta nello spazio di lavoro'),
      submenu: [
        ...spaces.map((x) => ({ label: tr(x.name), type: 'radio' as const, checked: x.id === state.workspace, click: () => w.tabs.moveToWorkspace(tabId, x.id) })),
        { type: 'separator' as const },
        {
          label: tr('Nuovo spazio di lavoro'),
          click: () => {
            w.tabs.moveToWorkspace(tabId, newWorkspace(w, false));
            w.tabs.activate(tabId);
          },
        },
      ],
    });
    items.push({
      label: tr('Riapri in un contenitore'),
      submenu: [
        { label: tr('Nessun contenitore'), type: 'radio' as const, checked: !state.container, click: () => reopenInContainer(w, tabId, null) },
        ...settings.get().containers.map((c) => ({ label: tr(c.name), type: 'radio' as const, checked: state.container === c.id, click: () => reopenInContainer(w, tabId, c.id) })),
      ],
    });
  }
  return items;
}

/** Copies the dictionaries shipped with the Linux build where Chromium looks for them. */
function installBundledDictionaries(): void {
  const source = app.isPackaged ? join(process.resourcesPath, 'dictionaries') : join(__dirname, '../../build/dictionaries');
  const target = join(app.getPath('userData'), 'Dictionaries');
  try {
    if (!existsSync(source)) return;
    mkdirSync(target, { recursive: true });
    for (const file of readdirSync(source)) {
      if (file.endsWith('.bdic') && !existsSync(join(target, file))) copyFileSync(join(source, file), join(target, file));
    }
  } catch (err) {
    console.error('[spellcheck] dizionari non installati:', err);
  }
}

/** Fingerprinting protection of a page (and its frames and workers), from the address of the top page. */
function shieldConfigFor(ses: Session, topUrl: string): ShieldConfig {
  let key = fingerprintKeys.get(ses);
  if (!key) fingerprintKeys.set(ses, (key = randomBytes(32)));
  const s = settings.get();
  return shieldConfig({
    setting: s.fingerprintProtection,
    site: /^https?:/i.test(topUrl) ? siteOf(topUrl) : null,
    exceptions: s.protectionExceptions,
    sessionKey: key,
    cpus: cpus().length || 4,
    forceStrict: s.securityLevel === 'safest',
    blockWebGL: s.securityLevel !== 'standard',
  });
}

/** A setting read before the app is ready (some Chromium switches must be set then). */
function startupSetting<K extends keyof Settings>(key: K): Settings[K] {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')) as { settings?: Partial<Settings> };
    return sanitizeSettings(raw.settings ?? {})[key];
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

const drmOffered = new WeakSet<BrowserWindowController>();
/** A page asked for protected content while Widevine is off: the window offers to turn it on (once). */
function offerDrm(contents: Electron.WebContents): void {
  const w = [...windows].find((x) => x.tabs.idOf(contents) !== null);
  if (!w || w.isPrivate || drmOffered.has(w)) return;
  drmOffered.add(w);
  let host = '';
  try {
    host = new URL(contents.getURL()).hostname.replace(/^www\./, '');
  } catch {
    /* no host */
  }
  w.send(IPC.evDrmOffer, { host });
}

/** Turns protected content on: the module is downloaded at the next start, so restart now (tabs come back). */
function enableDrmAndRestart(): void {
  settings.update({ drmOptIn: true });
  restartVelo();
}

/** Restarts the browser, reopening the tabs. */
function restartVelo(): void {
  saveSessionNow();
  app.relaunch();
  app.quit();
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
  saveTimer = setTimeout(saveSessionNow, 1000);
}

function saveSessionNow(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  {
    const data = [...windows].filter((w) => !w.isPrivate).map((w) => ({ tabs: w.tabs.saved(), layout: w.tabLayout() })).filter((w) => w.tabs.length > 0);
    if (data.length === 0) return;
    try {
      writeFileSync(sessionFile(), JSON.stringify({ windows: data }), { mode: 0o600 });
    } catch (err) {
      console.error('[session] salvataggio non riuscito:', err);
    }
  }
}

function readSavedSession(): SavedWindow[] {
  try {
    const parsed = JSON.parse(readFileSync(sessionFile(), 'utf8')) as { windows?: unknown };
    if (!Array.isArray(parsed.windows)) return [];
    const id = (v: unknown) => (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v) ? v : null);
    return parsed.windows
      // Older sessions stored a list of tabs per window (and before that plain URLs).
      .map((w: unknown) => (Array.isArray(w) ? { tabs: w } : (w as { tabs?: unknown; layout?: Partial<TabLayout> })))
      .filter((w) => w && Array.isArray(w.tabs))
      .map((w) => {
        const groups = Array.isArray(w.layout?.groups)
          ? w.layout.groups.filter((g) => g && id(g.id)).map((g) => ({ id: g.id, name: String(g.name ?? '').slice(0, 40), color: TAG_COLORS.includes(g.color) ? g.color : 'grey', collapsed: Boolean(g.collapsed) }))
          : [];
        const tabs = (w.tabs as unknown[])
          .map((t) => (typeof t === 'string' ? { url: t } : (t as SavedTab)))
          .filter((t) => t && typeof t.url === 'string' && /^(https?|velo|file):/i.test(t.url))
          .map((t) => ({
            url: t.url,
            pinned: Boolean(t.pinned),
            title: typeof t.title === 'string' ? t.title.slice(0, 300) : undefined,
            groupId: id(t.groupId),
            workspace: id(t.workspace) ?? undefined,
            container: id(t.container),
          }));
        return { tabs, layout: { groups, workspace: id(w.layout?.workspace) ?? undefined } };
      })
      .filter((w) => w.tabs.length > 0);
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
  const frameKeys = ['theme', 'accentColor', 'palette', 'backdrop', 'density'] as const;
  if (frameKeys.some((k) => next[k] !== previous[k])) for (const w of windows) w.applyTitleBarTheme();
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
  if (next.autoHideToolbar !== previous.autoHideToolbar || JSON.stringify(next.shortcuts) !== JSON.stringify(previous.shortcuts)) Menu.setApplicationMenu(buildMenu());
  if (next.clearCookiesOnExit || next.clearCacheOnExit) dataCleared = false;
  if (next.defaultZoom !== previous.defaultZoom || next.siteZoom !== previous.siteZoom) {
    for (const w of windows) for (const t of w.tabs.states()) {
      const wc = w.tabs.contents(t.id);
      if (wc) applyZoom(wc);
    }
    refreshAllTabs();
  }

  // Deleted workspaces: their tabs move to the first one. Deleted containers: their tabs reopen without
  // a container and their cookies and data are erased.
  const gone = <T extends { id: string }>(before: T[], after: T[]) => before.filter((x) => !after.some((y) => y.id === x.id)).map((x) => x.id);
  for (const id of gone(previous.workspaces, next.workspaces)) for (const w of windows) w.tabs.dropWorkspace(id, next.workspaces[0].id);
  for (const id of gone(previous.containers, next.containers)) {
    for (const w of windows) for (const t of w.tabs.states().filter((x) => x.container === id)) reopenInContainer(w, t.id, null);
    const ses = containerSessions.get(id) ?? electronSession.fromPartition(`persist:container-${id}`);
    containerSessions.delete(id);
    containerForgetters.get(id)?.dispose();
    containerForgetters.delete(id);
    settings.update({ sitePermissions: settings.get().sitePermissions.filter((p) => p.container !== id) });
    void ses.clearStorageData().then(() => ses.clearCache()).catch(() => {});
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
  if (!/^(https?|file|velo):/i.test(url)) return;
  const existing = bookmarks.find(url);
  if (!existing) {
    bookmarks.add({ title: wc.getTitle(), url, folder: 'bar' });
    w.send(IPC.evToast, { kind: 'success', message: tr('Aggiunto alla barra dei preferiti') });
    return;
  }
  const other: BookmarkFolder = existing.folder === 'bar' ? 'other' : 'bar';
  Menu.buildFromTemplate([
    { label: tr('Nei preferiti: {0}', existing.title), enabled: false },
    { type: 'separator' },
    { label: other === 'other' ? tr('Sposta in Altri preferiti') : tr('Sposta nella barra dei preferiti'), click: () => bookmarks.update(existing.id, { folder: other }) },
    { label: tr('Modifica…'), click: () => w.openInternal('velo://bookmarks/') },
    { label: tr('Rimuovi dai preferiti'), click: () => bookmarks.remove(existing.id) },
  ]).popup({ window: w.win });
}

function bookmarkContextMenu(w: BrowserWindowController, id: string): void {
  const b = bookmarks.list().find((x) => x.id === id);
  if (!b) return;
  const other: BookmarkFolder = b.folder === 'bar' ? 'other' : 'bar';
  Menu.buildFromTemplate([
    { label: tr('Apri'), click: () => openUrl(w, b.url, 'current') },
    { label: tr('Apri in una nuova scheda'), click: () => openUrl(w, b.url, 'background') },
    { label: tr('Apri in una nuova finestra'), click: () => openUrl(w, b.url, 'window') },
    { label: tr('Apri in una finestra privata'), click: () => openUrl(w, b.url, 'private') },
    { type: 'separator' },
    { label: other === 'other' ? tr('Sposta in Altri preferiti') : tr('Sposta nella barra dei preferiti'), click: () => bookmarks.update(b.id, { folder: other }) },
    { label: tr('Modifica…'), click: () => w.openInternal('velo://bookmarks/') },
    { label: tr('Elimina'), click: () => bookmarks.remove(b.id) },
  ]).popup({ window: w.win });
}

function allBookmarksMenu(w: BrowserWindowController): void {
  const item = (b: { title: string; url: string }) => ({ label: b.title.slice(0, 60) || b.url, click: () => openUrl(w, b.url, 'current') });
  const bar = bookmarks.list().filter((b) => b.folder === 'bar');
  const others = bookmarks.list().filter((b) => b.folder === 'other');
  Menu.buildFromTemplate([
    ...bar.map(item),
    ...(bar.length ? [{ type: 'separator' as const }] : []),
    { label: tr('Altri preferiti'), submenu: others.length ? others.map(item) : [{ label: tr('Vuoto'), enabled: false }] },
    { type: 'separator' },
    { label: tr('Gestisci preferiti'), click: () => w.openInternal('velo://bookmarks/') },
  ]).popup({ window: w.win });
}

function refreshAllTabs(): void {
  for (const w of windows) w.tabs.refresh();
}

function broadcast(channel: string, payload?: unknown): void {
  for (const w of windows) w.send(channel, payload);
}

// ---------- Menu ----------

/** What each command does (menu, shortcuts, command palette). */
function appActions(): AppMenuActions {
  return {
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
    customize: () => current()?.openSettings('appearance'),
    find: () => current()?.focusChrome(IPC.evFind),
    findNext: (backwards) => current()?.send(IPC.evFindNext, { backwards }),
    zoomIn: () => zoomActive('in'),
    zoomOut: () => zoomActive('out'),
    zoomReset: () => zoomActive('reset'),
    duplicateTab: () => withActiveTab((w, id) => w.tabs.duplicate(id)),
    pinTab: () => withActiveTab((w, id) => w.tabs.setPinned(id, !w.tabs.states().find((t) => t.id === id)?.pinned)),
    muteTab: () => withActiveTab((w, id) => w.tabs.setMuted(id, !w.tabs.states().find((t) => t.id === id)?.muted)),
    commandPalette: () => toggleCommandPalette(current()),
    groupTab: () => withActiveTab((w, id) => w.tabs.createGroup([id])),
    newContainerTab: () => {
      const w = current();
      if (w) showContainerMenu(w);
    },
    nextWorkspace: () => cycleWorkspace(1),
    previousWorkspace: () => cycleWorkspace(-1),
    switchProfile: () => current()?.openSettings('profiles'),
    profileItems: () => {
      const here = currentProfile().id;
      return listProfiles().map((p) => ({ label: tr(p.name), type: 'radio', checked: p.id === here, click: () => (p.id === here ? current()?.focus() : openProfile(p.id)) }));
    },
    importData: () => current()?.openInternal('velo://import/'),
    siteSettings: () => withActiveTab((w, id) => openSiteSettings(w, w.tabs.states().find((t) => t.id === id)?.url ?? '')),
    toggleBookmarksBar: () => settings.update({ showBookmarksBar: !settings.get().showBookmarksBar }),
    toggleAutoHide: () => settings.update({ autoHideToolbar: !settings.get().autoHideToolbar }),
    autoHide: () => settings.get().autoHideToolbar,
    bookmarkPage: () => {
      const w = current();
      const id = w?.activeTabId();
      if (w && id != null) bookmarkPageMenu(w, id);
    },
    openHistory: () => current()?.openInternal('velo://history/'),
    openBookmarks: () => current()?.openInternal('velo://bookmarks/'),
    openPasswords: () => current()?.openInternal('velo://passwords/'),
    checkUpdates: () => {
      current()?.openSettings('updates');
      void updates.check();
    },
    about: () => current()?.openSettings('about'),
    clearData: () => current()?.openSettings('privacy'),
    devTools: () => current()?.activeContents()?.toggleDevTools(),
  };
}

function buildMenu(): Menu {
  return buildAppMenu(appActions(), settings.get().shortcuts);
}

// ---------- Groups, workspaces, containers ----------

const colorLabel = (c: TagColor) => tr(TAG_COLOR_INFO[c].name);
const groupLabel = (g: TabGroup) => g.name || tr('Gruppo {0}', colorLabel(g.color).toLowerCase());

function cycleWorkspace(step: 1 | -1): void {
  const w = current();
  if (!w || w.isPrivate) return;
  const list = settings.get().workspaces;
  const at = list.findIndex((x) => x.id === w.tabs.currentWorkspace());
  w.tabs.switchWorkspace(list[(at + step + list.length) % list.length].id);
}

/** A new workspace named "Spazio N", shown at once unless `show` is false. Returns its id. */
function newWorkspace(w: BrowserWindowController, show = true): string {
  const list = settings.get().workspaces;
  let n = list.length + 1;
  while (list.some((x) => x.name === tr('Spazio {0}', n))) n++;
  const used = new Set(list.map((x) => x.color));
  const color = TAG_COLORS.find((c) => !used.has(c) && c !== 'grey') ?? 'grey';
  const id = `ws-${randomBytes(4).toString('hex')}`;
  settings.update({ workspaces: [...list, { id, name: tr('Spazio {0}', n), color }] });
  if (show) w.tabs.switchWorkspace(id);
  return id;
}

function showWorkspaceMenu(w: BrowserWindowController, anchor?: Rect): void {
  const currentId = w.tabs.currentWorkspace();
  const counts = new Map<string, number>();
  for (const t of w.tabs.states()) counts.set(t.workspace, (counts.get(t.workspace) ?? 0) + 1);
  const items: Electron.MenuItemConstructorOptions[] = settings.get().workspaces.map((x) => ({
    label: tr(x.name),
    sublabel: counts.get(x.id) ? plural(counts.get(x.id)!, 'Una scheda', '{n} schede') : tr('Nessuna scheda'),
    type: 'radio',
    checked: x.id === currentId,
    click: () => w.tabs.switchWorkspace(x.id),
  }));
  items.push(
    { type: 'separator' },
    { label: tr('Nuovo spazio di lavoro'), click: () => newWorkspace(w) },
    { label: tr('Gestisci spazi di lavoro…'), click: () => w.openSettings('workspaces') },
  );
  const menu = Menu.buildFromTemplate(items);
  menu.popup(anchor ? { window: w.win, x: Math.round(anchor.x), y: Math.round(anchor.y + anchor.height) } : { window: w.win });
}

function showContainerMenu(w: BrowserWindowController, anchor?: Rect): void {
  if (w.isPrivate) return;
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: tr('Nuova scheda in un contenitore'), enabled: false },
    ...settings.get().containers.map((c) => ({ label: `${tr(c.name)} · ${colorLabel(c.color)}`, click: () => w.newTab(undefined, { container: c.id }) })),
    { type: 'separator' },
    { label: tr('Gestisci contenitori…'), click: () => w.openSettings('workspaces') },
  ];
  Menu.buildFromTemplate(items).popup(anchor ? { window: w.win, x: Math.round(anchor.x), y: Math.round(anchor.y + anchor.height) } : { window: w.win });
}

function showGroupMenu(w: BrowserWindowController, groupId: string): void {
  const group = w.tabs.groupList().find((g) => g.id === groupId);
  if (!group) return;
  const tabsOf = w.tabs.groupTabs(groupId);
  Menu.buildFromTemplate([
    { label: groupLabel(group), enabled: false },
    { label: tr('Rinomina…'), click: () => w.send(IPC.evGroupRename, groupId) },
    { label: tr('Colore'), submenu: TAG_COLORS.map((c) => ({ label: colorLabel(c), type: 'radio' as const, checked: group.color === c, click: () => w.tabs.updateGroup(groupId, { color: c }) })) },
    { label: group.collapsed ? tr('Espandi') : tr('Comprimi'), click: () => w.tabs.updateGroup(groupId, { collapsed: !group.collapsed }) },
    { type: 'separator' },
    {
      label: tr('Nuova scheda nel gruppo'),
      click: () => {
        const last = tabsOf[tabsOf.length - 1];
        const t = w.tabs.states().find((x) => x.id === last);
        w.tabs.create(newTabUrl(), { groupId, container: t?.container ?? null });
      },
    },
    { label: tr('Separa le schede'), click: () => w.tabs.ungroup(groupId) },
    {
      label: tr('Chiudi il gruppo'),
      click: () => {
        for (const id of tabsOf) w.tabs.close(id);
        if (w.tabs.count() === 0) w.win.close();
      },
    },
  ]).popup({ window: w.win });
}

/** Opens the page of a tab again in another container (its cookies differ, so it really reloads). */
function reopenInContainer(w: BrowserWindowController, tabId: number, container: string | null): void {
  const state = w.tabs.states().find((t) => t.id === tabId);
  if (!state || state.container === container) return;
  const index = w.tabs.ids().indexOf(tabId);
  w.tabs.create(state.url || newTabUrl(), { index: index + 1, container, groupId: state.groupId, workspace: state.workspace });
  w.tabs.close(tabId);
}

function withActiveTab(fn: (w: BrowserWindowController, tabId: number) => void): void {
  const w = current();
  const id = w?.activeTabId();
  if (w && id != null) fn(w, id);
}

function zoomActive(direction: 'in' | 'out' | 'reset'): void {
  const w = current();
  const wc = w?.activeContents();
  if (w && wc) changeZoom(w, wc, direction);
}

function showShieldMenu(w: BrowserWindowController, tabId: number): void {
  const wc = w.tabs.contents(tabId);
  const url = wc?.getURL() ?? '';
  const site = /^https?:/i.test(url) ? siteOf(url) : null;
  const guard = wc ? guards.get(wc.session) : undefined;
  const s = settings.get();
  const items: Electron.MenuItemConstructorOptions[] = [];

  if (site && guard && wc) {
    const exempt = s.protectionExceptions.includes(site);
    items.push(
      { label: tr('Protezioni per {0}', site), enabled: false },
      {
        label: tr('Protezioni attive su questo sito (tracker, cookie, impronta digitale)'),
        type: 'checkbox',
        checked: !exempt,
        click: () => {
          const next = exempt ? s.protectionExceptions.filter((h) => h !== site) : [...s.protectionExceptions, site];
          settings.update({ protectionExceptions: next });
          wc.reload();
        },
      },
      { label: tr('{0} richieste bloccate in questa pagina', guard.blockedCount(wc.id)), enabled: false },
      ...(s.forgetSitesOnClose && !w.isPrivate
        ? [{
            label: tr('Ricorda questo sito (non cancellare i suoi dati alla chiusura)'),
            type: 'checkbox' as const,
            checked: s.rememberedSites.includes(site),
            click: () => {
              const list = settings.get().rememberedSites;
              settings.update({ rememberedSites: list.includes(site) ? list.filter((x) => x !== site) : [...list, site] });
            },
          }]
        : []),
    );
    if (guard.wasCleaned(wc.id)) items.push({ label: tr('Parametri di tracciamento rimossi dall’indirizzo'), enabled: false });
    if (s.trackingProtection === 'off') items.push({ label: tr('Il blocco dei tracker è disattivato nelle impostazioni'), enabled: false });
    items.push({ type: 'separator' });
  } else {
    items.push({ label: tr('Nessuna protezione necessaria per questa pagina'), enabled: false }, { type: 'separator' });
  }
  items.push({ label: tr('Impostazioni privacy…'), click: () => w.openSettings('privacy') });
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
      label: secure ? tr('La connessione è sicura') : tr('La connessione non è sicura'),
      sublabel: secure ? tr('Le informazioni che invii restano private') : tr('Non inserire password o dati della carta'),
      enabled: false,
    },
    { type: 'separator' },
  ];

  if (w.isPrivate) {
    items.push({ label: tr('Nelle finestre private i permessi valgono fino alla chiusura'), enabled: false });
  } else {
    const box = w.tabs.states().find((t) => t.id === tabId)?.container ?? undefined;
    const granted = settings.get().sitePermissions.filter((p) => p.host === hostname && p.container === box);
    if (granted.length === 0) items.push({ label: tr('Nessun permesso scelto per questo sito'), enabled: false });
    for (const p of granted) {
      const set = (allowed: boolean | null) => {
        const others = settings.get().sitePermissions.filter((x) => !(x.host === hostname && x.permission === p.permission && x.container === box));
        settings.update({ sitePermissions: allowed === null ? others : [...others, { ...p, allowed }] });
      };
      items.push({
        label: `${permissionLabel(p.permission)}: ${p.allowed ? 'consentito' : 'bloccato'}`,
        submenu: [
          { label: tr('Consenti'), type: 'radio', checked: p.allowed, click: () => set(true) },
          { label: tr('Blocca'), type: 'radio', checked: !p.allowed, click: () => set(false) },
          { label: tr('Chiedi di nuovo'), click: () => set(null) },
        ],
      });
    }
  }
  items.push(
    {
      label: tr('Cancella cookie e dati del sito'),
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
    { label: tr('Protezioni del sito…'), click: () => showShieldMenu(w, tabId) },
    { label: tr('Impostazioni del sito…'), click: () => openSiteSettings(w, url) },
  );
  Menu.buildFromTemplate(items).popup({ window: w.win });
}

/** velo://site/ for the site of a page (or the list of sites). */
function openSiteSettings(w: BrowserWindowController, pageUrl: string): void {
  let host = '';
  try {
    host = /^https?:/i.test(pageUrl) ? new URL(pageUrl).hostname : '';
  } catch {
    /* list of sites */
  }
  w.openInternal(host ? `velo://site/?host=${encodeURIComponent(host)}` : 'velo://site/');
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
    remote: w.isPrivate ? [] : sync.remoteTabs(),
    look: popupLook(settings.get(), w.isPrivate),
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
    host = u.protocol === 'velo:' ? 'Velo' : u.protocol === 'file:' ? decodeURIComponent(u.pathname) : u.host.replace(/^www\./, '');
  } catch {
    /* keep the address */
  }
  const meta: string[] = [];
  if (t.sleeping) meta.push(tr('In pausa: si ricarica quando la apri'));
  else {
    const pid = w.tabs.contents(t.id)?.getOSProcessId();
    const metric = pid ? app.getAppMetrics().find((m) => m.pid === pid) : undefined;
    if (metric) meta.push(`Memoria: ${Math.max(1, Math.round(metric.memory.workingSetSize / 1024))} MB`);
  }
  if (t.audible && !t.muted) meta.push(tr('Sta riproducendo audio'));
  if (t.muted) meta.push(tr('Audio disattivato'));
  return { title: t.title || t.url, host, meta: meta.join(' · ') };
}

/** Reader mode: extracts the article and shows it in velo://reader, or goes back to the page. */
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
    w.send(IPC.evToast, { kind: 'info', message: tr('In questa pagina non c’è un articolo da mostrare in modalità lettura.') });
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
/** Right click on the toolbar: remove or move a button, add one, or open the full editor. */
function showToolbarMenu(w: BrowserWindowController, item: string | null): void {
  const s = settings.get();
  const known = (v: unknown): v is ToolbarItem => typeof v === 'string' && v in TOOLBAR_ITEMS;
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (known(item)) {
    const inStart = s.toolbarStart.includes(item);
    const without = { toolbarStart: s.toolbarStart.filter((x) => x !== item), toolbarEnd: s.toolbarEnd.filter((x) => x !== item) };
    items.push(
      { label: tr('Rimuovi «{0}» dalla barra', TOOLBAR_ITEMS[item].label), click: () => settings.update(without) },
      inStart
        ? { label: tr('Sposta dopo la barra degli indirizzi'), click: () => settings.update({ ...without, toolbarEnd: [item, ...without.toolbarEnd] }) }
        : { label: tr('Sposta prima della barra degli indirizzi'), click: () => settings.update({ ...without, toolbarStart: [...without.toolbarStart, item] }) },
      { type: 'separator' },
    );
  }
  const missing = TOOLBAR_ITEM_IDS.filter((id) => !s.toolbarStart.includes(id) && !s.toolbarEnd.includes(id));
  if (missing.length) {
    items.push({
      label: tr('Aggiungi un pulsante'),
      submenu: missing.map((id) => ({ label: TOOLBAR_ITEMS[id].label, click: () => settings.update({ toolbarEnd: [...settings.get().toolbarEnd, id] }) })),
    });
  }
  items.push({ label: tr('Personalizza l’aspetto…'), click: () => w.openSettings('appearance') });
  if (!w.win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: w.win });
}

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
      { label: info.playing ? tr('Pausa') : tr('Riprendi'), click: () => void pageMediaAction(wc, info.playing ? 'pause' : 'play') },
      { label: t.muted ? tr('Riattiva audio') : tr('Disattiva audio'), click: () => w.tabs.setMuted(t.id, !t.muted) },
    );
    if (info.hasVideo) items.push({ label: 'Picture-in-picture', type: 'checkbox', checked: info.pip, click: () => void pageMediaAction(wc, 'toggle-pip') });
    if (!t.active) items.push({ label: tr('Vai alla scheda'), click: () => w.tabs.activate(t.id) });
  }
  if (!items.length) items.push({ label: tr('Nessun contenuto audio o video'), enabled: false });
  if (!w.win.isDestroyed()) Menu.buildFromTemplate(items).popup({ window: w.win });
}

/** Commands that need the optional cloud account. */
const CLOUD_COMMANDS: CommandId[] = ['savePageToDrive', 'mailPage', 'togglePanel'];

function paletteData(w: BrowserWindowController): PaletteData {
  const s = settings.get();
  const cloud = settings.tokenStatus().configured;
  return {
    commands: COMMANDS.filter((c) => c.id !== 'commandPalette' && (cloud || !CLOUD_COMMANDS.includes(c.id))).map((c) => ({
      id: c.id, label: tr(c.label), group: c.group, keys: displayShortcut(shortcutFor(c.id, s.shortcuts), process.platform),
    })),
    tabs: tabSearchData(w).tabs,
    bookmarks: bookmarks.list().map((b) => ({ title: b.title, url: b.url })),
    sections: SETTINGS_SECTIONS.map((x) => ({ id: x.id, label: tr(x.label), keywords: tr(x.keywords) })),
    look: popupLook(s, w.isPrivate),
  };
}

function toggleCommandPalette(w: BrowserWindowController | null): void {
  if (!w) return;
  if (w.palette.isVisible()) w.palette.hide();
  else if (!w.palette.justHidden()) {
    w.suggestions.hide();
    w.tabSearch.hide();
    void w.palette.show(paletteData(w));
  }
}

function runPaletteChoice(w: BrowserWindowController, choice: PaletteChoice): void {
  w.palette.hide();
  if (choice.kind === 'command' && COMMAND_IDS.includes(choice.id as CommandId)) {
    w.focus();
    appActions()[choice.id as CommandId]();
  } else if (choice.kind === 'tab') {
    switchToTab(w, Number(choice.tabId));
  } else if (choice.kind === 'setting' && SETTINGS_SECTIONS.some((x) => x.id === choice.id)) {
    w.openSettings(choice.id);
  } else if (choice.kind === 'url' && typeof choice.url === 'string' && /^(https?|velo|file):/i.test(choice.url)) {
    w.tabs.create(choice.url);
  } else if (choice.kind === 'input' && typeof choice.text === 'string' && choice.text.trim()) {
    w.tabs.create(resolveOmniboxInput(choice.text, settings.get().searchEngine));
  }
}

function toggleTabSearch(w: BrowserWindowController | null, anchor?: Rect): void {
  if (!w) return;
  if (w.tabSearch.isVisible()) w.tabSearch.hide();
  else if (!w.tabSearch.justHidden()) {
    w.suggestions.hide();
    void w.tabSearch.show(tabSearchData(w), anchor);
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
  ipcMain.on('tabsearch:open', (event, url: string) => {
    const w = searcher(event.sender);
    if (!w || typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
    w.tabSearch.hide();
    w.tabs.create(url);
  });
  ipcMain.on('tabsearch:dismiss', (event) => {
    const w = searcher(event.sender);
    if (!w) return;
    w.tabSearch.hide();
    w.activeContents()?.focus();
  });
  const paletteOwner = (sender: Electron.WebContents) => [...windows].find((c) => c.palette.contents === sender);
  ipcMain.on('palette:choose', (event, choice: PaletteChoice) => {
    const w = paletteOwner(event.sender);
    if (w && choice && typeof choice === 'object') runPaletteChoice(w, choice);
  });
  ipcMain.on('palette:dismiss', (event) => {
    const w = paletteOwner(event.sender);
    if (!w) return;
    w.palette.hide();
    w.activeContents()?.focus();
  });
  ipcMain.on('suggest:choose', (event, index: number) => {
    const w = [...windows].find((c) => c.suggestions.contents === event.sender);
    if (w && Number.isInteger(index)) w.suggestions.choose(index);
  });
  handle(IPC.windowInfo, (w) => {
    const profile = currentProfile();
    return { isPrivate: w.isPrivate, windowId: w.win.id, platform: process.platform, profile: profile.id === 'default' ? null : { ...profile, name: tr(profile.name) } };
  });
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
  handle(IPC.tabLayout, (w) => w.tabLayout());
  handle(IPC.groupMenu, (w, groupId: string) => showGroupMenu(w, String(groupId)));
  handle(IPC.groupUpdate, (w, groupId: string, patch: { name?: string; collapsed?: boolean }) => {
    if (patch && typeof patch === 'object') w.tabs.updateGroup(String(groupId), { name: typeof patch.name === 'string' ? patch.name : undefined, collapsed: typeof patch.collapsed === 'boolean' ? patch.collapsed : undefined });
  });
  handle(IPC.workspaceMenu, (w, anchor?: Rect) => showWorkspaceMenu(w, anchor && typeof anchor.x === 'number' ? anchor : undefined));
  handle(IPC.workspaceSwitch, (w, id: string) => {
    if (settings.get().workspaces.some((x) => x.id === id)) w.tabs.switchWorkspace(id);
  });
  handle(IPC.containerMenu, (w, anchor?: Rect) => showContainerMenu(w, anchor && typeof anchor.x === 'number' ? anchor : undefined));
  handle(IPC.tabsCreate, (w, url?: string) => w.newTab(url ? resolveOmniboxInput(url, settings.get().searchEngine) : undefined));
  handle(IPC.tabsClose, (w, id: number) => w.closeTab(id));
  handle(IPC.tabsActivate, (w, id: number) => w.tabs.activate(id));
  handle(IPC.tabsNavigate, (w, id: number, input: string) => w.tabs.navigate(id, resolveOmniboxInput(input, settings.get().searchEngine)));
  handle(IPC.tabsBack, (w, id: number) => w.tabs.contents(id)?.navigationHistory.goBack());
  handle(IPC.tabsForward, (w, id: number) => w.tabs.contents(id)?.navigationHistory.goForward());
  handle(IPC.tabsReload, (w, id: number) => w.tabs.reload(id));
  handle(IPC.tabsStop, (w, id: number) => w.tabs.contents(id)?.stop());
  handle(IPC.openApp, (w, appId: string) => {
    const appDef = INFOMANIAK_APPS.find((a) => a.id === appId);
    if (appDef) w.tabs.openApp(appDef.id, appDef.url);
  });
  handle(IPC.setContentBounds, (w, rect: Rect) => w.tabs.setBounds(rect));
  handle(IPC.windowControl, (w, action: string) => {
    if (action === 'minimize') w.win.minimize();
    else if (action === 'maximize') {
      if (w.win.isFullScreen()) w.win.setFullScreen(false);
      else if (w.win.isMaximized()) w.win.unmaximize();
      else w.win.maximize();
    } else if (action === 'close') w.win.close();
  });
  handle(IPC.chromeVisible, (w, visible: boolean) => w.setChromeVisible(Boolean(visible)));
  handle(IPC.showAppMenu, (w) => Menu.getApplicationMenu()?.popup({ window: w.win }));
  handle(IPC.showShieldMenu, (w, tabId: number) => showShieldMenu(w, tabId));
  handle(IPC.tabSearch, (w, anchor?: Rect) => toggleTabSearch(w, anchor && typeof anchor.x === 'number' ? anchor : undefined));
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
  handle(IPC.drmEnable, () => enableDrmAndRestart());
  // Synchronous: the shield preload needs it before the page's scripts run.
  ipcMain.on('shield:config', (event) => {
    let top = '';
    try {
      top = event.senderFrame?.top?.url || event.sender.getURL();
    } catch {
      /* frame gone */
    }
    event.returnValue = shieldConfigFor(event.sender.session, top);
  });
  ipcMain.on('shield:drm-wanted', (event) => {
    if (!settings.get().drmOptIn) offerDrm(event.sender);
  });
  handle(IPC.toolbarMenu, (w, item: string | null) => showToolbarMenu(w, item));
  handle(IPC.readerToggle, (w, tabId: number) => toggleReader(w, Number(tabId)));
  handle(IPC.tabHover, (w, tabId: number | null, rect?: Rect) => {
    const state = tabId == null ? undefined : w.tabs.states().find((t) => t.id === Number(tabId));
    if (!state || !rect || w.tabSearch.isVisible()) return w.hoverCard.hide();
    void w.hoverCard.show(hoverInfo(w, state), rect);
  });
  handle(IPC.suggestShow, (w, items: Suggestion[], rect: Rect, selected: number) => w.suggestions.show(items, rect, selected, popupLook(settings.get(), w.isPrivate)));
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
      const picked = await dialog.showOpenDialog(w.win, { title: tr('Carica su kDrive'), properties: ['openFile', 'multiSelections'] });
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
      if (!wc) throw new Error(tr('Nessuna scheda attiva.'));
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

// ---------- IPC: internal pages (velo://) ----------

/** Handlers for internal pages; only the top frame of the allowed velo:// hosts may call them. */
function handleInternal<A extends unknown[], R>(channel: string, hosts: string[], fn: (event: IpcMainInvokeEvent, ...args: A) => R): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    const frame = event.senderFrame;
    if (!isAllowedInternalSender(frame?.url, hosts, Boolean(frame) && frame === event.sender.mainFrame)) throw new Error('Unauthorized IPC sender');
    return fn(event, ...(args as A));
  });
}

function registerInternalIpc(): void {
  const S = ['settings'];
  // Every internal page reads the settings (theme); only the settings page changes them.
  handleInternal(INTERNAL.settingsGet, ['settings', 'newtab', 'search', 'history', 'bookmarks', 'passwords', 'https-only', 'blocked', 'reader', 'site', 'welcome', 'import'], () => settings.get());
  // The welcome page makes the first choices (language, look, privacy).
  const SW = ['settings', 'welcome'];
  handleInternal(INTERNAL.settingsSet, SW, (_e, patch: Partial<Settings>) => settings.update(patch));
  handleInternal(INTERNAL.localeInfo, SW, () => ({ current: locale(), system: resolveLocale('system', app.getPreferredSystemLanguages()) }));
  handleInternal(INTERNAL.restart, SW, () => restartVelo());
  handleInternal(INTERNAL.tokenStatus, S, () => settings.tokenStatus());
  handleInternal(INTERNAL.defaultBrowserStatus, S, () => isDefaultBrowser());
  // Import from other browsers on this computer.
  const IMPORT = ['import', 'welcome'];
  handleInternal(INTERNAL.importSources, IMPORT, () => detectSources().map(({ id, browser, key, profileName }) => ({ id, browser, key, profileName })));
  handleInternal(INTERNAL.importRun, IMPORT, (_e, sourceId: string, wanted: string[]) => wrap(async () => {
    const source = detectSources().find((x) => x.id === sourceId);
    if (!source) throw new Error(tr('Profilo non trovato.'));
    const kinds = (Array.isArray(wanted) ? wanted : []).filter((k): k is ImportKind => ['bookmarks', 'history', 'logins', 'cookies'].includes(k));
    const data = readSource(source, kinds);
    const report: ImportReport = { bookmarks: 0, history: 0, logins: 0, cookies: 0, skipped: data.skipped };
    if (data.bookmarks) report.bookmarks = bookmarks.import(data.bookmarks);
    if (data.history) report.history = history.importMany(data.history);
    if (data.logins?.length) {
      // The rest is imported anyway; passwords wait for the vault (locked, or without a primary password yet).
      if (passwords.vault.status().state === 'unlocked') report.logins = passwords.vault.importLogins(data.logins);
      else report.skipped.push({ what: 'logins', count: data.logins.length, reason: tr('le password di Velo sono bloccate o non ancora configurate: aprile dalla pagina Password e importa di nuovo') });
    }
    if (data.cookies) report.cookies = await importCookies(electronSession.defaultSession, data.cookies);
    return report;
  }));
  // Profiles (separate Velo instances with their own data).
  const color = (c: unknown) => (TAG_COLORS.includes(c as TagColor) ? (c as TagColor) : 'grey');
  handleInternal(INTERNAL.profilesList, S, () => ({ current: currentProfile().id, profiles: listProfiles().map((p) => ({ ...p, name: tr(p.name) })) }));
  handleInternal(INTERNAL.profileCreate, S, (_e, name: string, c: string) => {
    const profile = createProfile(String(name ?? ''), color(c));
    Menu.setApplicationMenu(buildMenu());
    openProfile(profile.id);
    return profile;
  });
  handleInternal(INTERNAL.profileUpdate, S, (_e, id: string, patch: { name?: string; color?: string }) => {
    updateProfile(String(id), { name: typeof patch?.name === 'string' ? patch.name : undefined, color: patch?.color ? color(patch.color) : undefined });
    Menu.setApplicationMenu(buildMenu());
  });
  handleInternal(INTERNAL.profileRemove, S, (_e, id: string) => wrap(() => {
    removeProfile(String(id));
    Menu.setApplicationMenu(buildMenu());
  }));
  handleInternal(INTERNAL.profileOpen, S, (_e, id: string) => openProfile(String(id)));
  handleInternal(INTERNAL.shortcutsInfo, S, () => ({
    platform: process.platform,
    commands: COMMANDS.map((c) => ({ id: c.id, label: tr(c.label), group: tr(c.group), keys: shortcutFor(c.id, settings.get().shortcuts), defaultKeys: c.keys })),
  }));
  // While the settings page records a shortcut, the menu must not run the command it belongs to.
  handleInternal(INTERNAL.shortcutsCapture, S, (event, on: boolean) => event.sender.setIgnoreMenuShortcuts(Boolean(on)));
  handleInternal(INTERNAL.welcomeFinish, ['welcome'], (event, url: string, restart: boolean) => {
    settings.update({ onboarded: true });
    const target = url === 'velo://settings/#account' ? url : newTabUrl();
    if (restart) event.sender.once('did-finish-load', () => restartVelo());
    void event.sender.loadURL(target);
  });
  // Per-site settings (velo://site/?host=…).
  const SITE = ['site'];
  const siteHost = (input: unknown) => normalizeSiteHost(String(input ?? ''));
  handleInternal(INTERNAL.siteInfo, SITE, (event, input: string) => {
    const host = siteHost(input);
    return host ? siteSettingsInfo(settings, event.sender.session, host) : null;
  });
  handleInternal(INTERNAL.siteSet, SITE, (event, input: string, patch: SiteSettingsPatch) => {
    const host = siteHost(input);
    if (!host || !patch || typeof patch !== 'object') return null;
    applySiteSettings(settings, host, patch);
    return siteSettingsInfo(settings, event.sender.session, host);
  });
  handleInternal(INTERNAL.siteClear, SITE, async (event, input: string) => {
    const host = siteHost(input);
    if (!host) return null;
    await clearSiteData(event.sender.session, host);
    return siteSettingsInfo(settings, event.sender.session, host);
  });
  handleInternal(INTERNAL.siteList, [...SITE, 'settings'], () => {
    const s = settings.get();
    const sites = new Map<string, Set<string>>();
    const add = (host: string, what: string) => sites.set(host, (sites.get(host) ?? new Set()).add(what));
    for (const p of s.sitePermissions) add(p.host, 'permissions');
    for (const host of Object.keys(s.siteZoom)) add(host, 'zoom');
    for (const host of s.protectionExceptions) add(host, 'protection');
    for (const host of s.httpExceptions) add(host, 'http');
    for (const host of s.rememberedSites) add(host, 'remembered');
    return [...sites].sort(([a], [b]) => a.localeCompare(b)).map(([host, what]) => ({ host, what: [...what] }));
  });
  handleInternal(INTERNAL.defaultBrowserSet, S, () => makeDefaultBrowser());
  handleInternal(INTERNAL.tokenSet, S, (_e, token: string) =>
    wrap(async () => {
      if (!token.trim()) throw new Error(tr('Il token è vuoto.'));
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
      // The normal windows and every container (a private window clears only itself).
      const targets = event.sender.session === electronSession.defaultSession ? persistentSessions() : [event.sender.session];
      for (const ses of targets) await clearBrowsingData(ses, selection);
      if (selection.history) history.clearSince(0);
      if (selection.downloads) downloads.clear();
      if (selection.permissions) settings.update({ sitePermissions: [] });
    }),
  );
  handleInternal(INTERNAL.chooseDownloadDir, S, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? current()?.win;
    const options = { title: tr('Cartella per i download'), defaultPath: downloads.folder(), properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
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
    if (!origin) throw new Error(tr('Indirizzo del sito non valido.'));
    if (!entry.password) throw new Error(tr('La password è vuota.'));
    return vault().save(origin, String(entry.username ?? ''), String(entry.password));
  }));
  handleInternal(INTERNAL.pwUpdate, P, (_e, id: string, patch: { username?: string; password?: string; origin?: string; totp?: string | null }) => wrap(() => vault().update(String(id), patch ?? {})));
  handleInternal(INTERNAL.pwRemove, P, (_e, id: string) => wrap(() => vault().remove(String(id))));
  handleInternal(INTERNAL.pwRemoveNever, P, (_e, origin: string) => wrap(() => vault().setNever(String(origin), false)));
  handleInternal(INTERNAL.pwSetPrimary, P, (_e, next: string, current?: string) => wrap(() => vault().setPrimary(String(next ?? ''), String(current ?? ''))));
  handleInternal(INTERNAL.pwRemovePrimary, P, (_e, current: string) => wrap(() => vault().removePrimary(String(current ?? ''))));
  handleInternal(INTERNAL.pwImport, P, (_e, csv: string) => wrap(() => vault().importCsv(String(csv ?? '').slice(0, 20_000_000))));
  handleInternal(INTERNAL.pwExport, P, (_e, primary?: string) => wrap(async () => {
    // Exporting writes every password in clear text: ask for the primary password again.
    if (!(await vault().checkPrimary(String(primary ?? '')))) throw new Error(tr('Password principale errata.'));
    return vault().exportCsv();
  }));
  handleInternal(INTERNAL.pwGenerate, P, () => generatePassword());
  // Current two-factor codes of the logins that have a key.
  handleInternal(INTERNAL.pwTotp, P, () => wrap(() => {
    passwords.touch();
    const out: Record<string, { code: string; remaining: number }> = {};
    for (const l of vault().list()) {
      const code = l.totp ? currentTotp(l.totp) : null;
      if (code) out[l.id] = code;
    }
    return out;
  }));
  handleInternal(INTERNAL.afList, P, () => wrap(() => ({ addresses: vault().addresses(), cards: vault().cards() })));
  handleInternal(INTERNAL.afSaveAddress, P, (_e, address: Partial<AutofillAddress>) => wrap(() => vault().saveAddress(address && typeof address === 'object' ? address : {})));
  handleInternal(INTERNAL.afSaveCard, P, (_e, card: Partial<AutofillCard>) => wrap(() => vault().saveCard(card && typeof card === 'object' ? card : {})));
  handleInternal(INTERNAL.afRemoveAddress, P, (_e, id: string) => wrap(() => vault().removeAddress(String(id))));
  handleInternal(INTERNAL.afRemoveCard, P, (_e, id: string) => wrap(() => vault().removeCard(String(id))));
  handleInternal(INTERNAL.newtabData, ['newtab'], (event) => {
    const s = settings.get();
    const isPrivate = !event.sender.session.isPersistent();
    return {
      isPrivate,
      topSites: !isPrivate && s.saveHistory && s.showTopSites ? topSites(history.summaries(), s.hiddenTopSites) : [],
      searchEngine: s.searchEngine,
      showTopSites: s.showTopSites,
      hiddenCount: s.hiddenTopSites.length,
      cloud: settings.tokenStatus().configured,
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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(tr('URL non valido'));
    threats.allow(parsed.href);
    void event.sender.loadURL(parsed.href);
  });
  handleInternal(INTERNAL.threatStatus, ['settings'], () => threats.status());
  handleInternal(INTERNAL.drmStatus, ['settings'], () => widevineStatus());
  handleInternal(INTERNAL.syncStatus, S, () => sync.status());
  handleInternal(INTERNAL.syncProbe, S, () => wrap(() => sync.probe()));
  handleInternal(INTERNAL.syncEnable, S, (_e, passphrase: string, deviceName?: string) => wrap(() => sync.enable(String(passphrase ?? ''), typeof deviceName === 'string' ? deviceName : undefined)));
  handleInternal(INTERNAL.syncUnlock, S, (_e, passphrase: string) => wrap(() => sync.unlock(String(passphrase ?? ''))));
  handleInternal(INTERNAL.syncNow, S, () => wrap(() => sync.syncNow()));
  handleInternal(INTERNAL.syncDisable, S, () => wrap(() => sync.disable()));
  handleInternal(INTERNAL.syncReset, S, () => wrap(() => sync.resetRemote()));
  handleInternal(INTERNAL.syncOptions, S, (_e, options: Parameters<SyncEngine['setOptions']>[0]) => sync.setOptions(options ?? {}));
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
    if (parsed.protocol !== 'http:') throw new Error(tr('URL non valido'));
    const host = parsed.hostname.toLowerCase();
    if (!settings.get().httpExceptions.includes(host)) settings.update({ httpExceptions: [...settings.get().httpExceptions, host] });
    void event.sender.loadURL(parsed.href);
  });
}

// ---------- IPC: unified search (velo://search) ----------

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
      isDefault: s.searchEngine === 'velo',
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
    const appDef = INFOMANIAK_APPS.find((a) => a.id === appId);
    const w = ownerOf(event.sender);
    if (appDef && w) w.tabs.openApp(appDef.id, appDef.url);
  });
  handleInternal(INTERNAL.searchCompose, H, (event, to: string) => {
    ownerOf(event.sender)?.send(IPC.evComposeMail, { to: String(to ?? ''), subject: '', body: '' });
  });
  handleInternal(INTERNAL.searchSetDefault, H, () => settings.update({ searchEngine: 'velo' }));
  handleInternal(INTERNAL.searchAi, H, (event, query: string) => ai.start(searchAnswerMessages(q(query)), event.sender, INTERNAL.evAi));
  handleInternal(INTERNAL.aiCancel, H, (_e, id: string) => ai.cancel(String(id)));
}

// ---------- IPC: cosmetic filtering (strict mode) ----------

function registerAdblockIpc(): void {
  ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => true);
  ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url: string, msg?: Parameters<TrackerBlocker['cosmetics']>[1]) => {
    const guard = guards.get(event.sender.session);
    // CSS goes into the tab's top document: requests from iframes would hide the wrong elements.
    if (event.senderFrame !== event.sender.mainFrame) return;
    if (!guard || typeof url !== 'string' || !guard.protectionActiveFor(url)) return;
    const result = blocker.cosmetics(url, msg, { frameId: event.frameId, processId: event.processId });
    if (!result) return;
    if (result.styles.length > 0) void event.sender.insertCSS(result.styles, { cssOrigin: 'user' });
    for (const script of result.scripts) void event.sender.executeJavaScript(script, true).catch(() => undefined);
  });
}
