import {
  BrowserWindow, Menu, app, dialog, ipcMain, nativeTheme, session as electronSession, shell,
  webContents as allWebContents, type IpcMainInvokeEvent, type Session,
} from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { INTERNAL, IPC } from '../shared/ipc';
import { KSUITE_APPS } from '../shared/ksuite-apps';
import { siteOf } from '../shared/privacy-rules';
import type { AboutInfo, ApiResult, BrowsingDataSelection, DriveFile, NewEvent, OutgoingMail, Rect, Settings } from '../shared/types';
import { resolveOmniboxInput } from '../shared/url';
import { buildAppMenu } from './app-menu';
import { TrackerBlocker } from './blocker';
import { clearBrowsingData } from './browsing-data';
import { DownloadManager } from './downloads';
import { isInternalUrl, registerInternalScheme, serveInternalPages } from './internal-pages';
import { configurePermissions, memoryOnly, persistentMemory } from './permissions';
import { PrivacyGuard } from './privacy';
import { KSuiteServices } from './services';
import { SettingsStore } from './settings';
import { BrowserWindowController, type WindowContext } from './window';

registerInternalScheme();

const PATHS = {
  chromePreload: join(__dirname, '../preload/preload.js'),
  pagePreload: join(__dirname, '../preload/page.js'),
  adblockPreload: join(__dirname, '../preload/adblock.js'),
  chromeHtml: join(__dirname, '../renderer/index.html'),
  pages: join(__dirname, '../pages'),
};

let settings: SettingsStore;
let services: KSuiteServices;
let downloads: DownloadManager;
const blocker = new TrackerBlocker();
const guards = new Map<Session, PrivacyGuard>();
const windows = new Set<BrowserWindowController>();
let lastFocused: BrowserWindowController | null = null;
let privateCounter = 0;
let quitting = false;
let dataCleared = false;

const sessionFile = () => join(app.getPath('userData'), 'session.json');
const pendingUrls: string[] = urlsFromArgv(process.argv);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const target = normalWindow() ?? openWindow(false, []);
    target.focus();
    for (const url of urlsFromArgv(argv)) target.tabs.create(url);
  });
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox('kSuite Browser', String(err));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());

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

function urlsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /^https?:\/\//i.test(a));
}

// ---------- Startup ----------

function start(): void {
  settings = new SettingsStore();
  services = new KSuiteServices(settings);
  downloads = new DownloadManager(settings, services, (items) => broadcast(IPC.evDownloads, items));

  nativeTheme.themeSource = settings.get().theme;
  void blocker.setLevel(settings.get().trackingProtection);
  settings.onChange(onSettingsChanged);

  setupSession(electronSession.defaultSession, false);
  registerChromeIpc();
  registerInternalIpc();
  registerAdblockIpc();
  Menu.setApplicationMenu(buildMenu());

  const restored = settings.get().startup === 'restore' ? readSavedSession() : [];
  if (pendingUrls.length) openWindow(false, pendingUrls);
  else if (restored.length) for (const urls of restored) openWindow(false, urls);
  else openWindow(false, []);
}

function setupSession(ses: Session, isPrivate: boolean): void {
  const guard = new PrivacyGuard(ses, settings, blocker, (wcId) => {
    const wc = allWebContents.fromId(wcId);
    if (!wc) return;
    for (const w of windows) if (w.tabs.idOf(wc) !== null) w.scheduleRefresh();
  });
  guard.install();
  guards.set(ses, guard);
  downloads.attach(ses, { isPrivate });
  configurePermissions(ses, settings, isPrivate ? memoryOnly() : persistentMemory(settings), () => lastFocused?.win ?? null);
  serveInternalPages(ses, PATHS.pages);
  ses.registerPreloadScript({ type: 'frame', id: 'ksuite-adblock', filePath: PATHS.adblockPreload });
}

const windowContext: WindowContext = {
  get settings() {
    return settings;
  },
  get services() {
    return services;
  },
  guardFor: (ses) => guards.get(ses)!,
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

function openWindow(isPrivate: boolean, urls: string[]): BrowserWindowController {
  let ses = electronSession.defaultSession;
  if (isPrivate) {
    // No "persist:" prefix: cookies, cache and storage live in memory and vanish with the window.
    ses = electronSession.fromPartition(`private-${++privateCounter}`);
    setupSession(ses, true);
  }
  const controller = new BrowserWindowController(windowContext, ses, isPrivate, urls);
  windows.add(controller);
  lastFocused = controller;
  controller.win.on('focus', () => (lastFocused = controller));
  if (isPrivate) controller.win.on('closed', () => guards.delete(ses));
  return controller;
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
    const data = [...windows].filter((w) => !w.isPrivate).map((w) => w.tabs.urls()).filter((urls) => urls.length > 0);
    if (data.length === 0) return;
    try {
      writeFileSync(sessionFile(), JSON.stringify({ windows: data }), { mode: 0o600 });
    } catch (err) {
      console.error('[session] salvataggio non riuscito:', err);
    }
  }, 1000);
}

function readSavedSession(): string[][] {
  try {
    const parsed = JSON.parse(readFileSync(sessionFile(), 'utf8')) as { windows?: unknown };
    if (!Array.isArray(parsed.windows)) return [];
    return parsed.windows
      .filter(Array.isArray)
      .map((urls: unknown[]) => urls.filter((u): u is string => typeof u === 'string' && /^(https?|ksuite|file):/i.test(u)))
      .filter((urls) => urls.length > 0);
  } catch {
    return [];
  }
}

// ---------- Settings changes ----------

function onSettingsChanged(next: Settings, previous: Settings): void {
  if (next.theme !== previous.theme) nativeTheme.themeSource = next.theme;
  if (next.trackingProtection !== previous.trackingProtection) {
    void blocker.setLevel(next.trackingProtection).then(() => refreshAllTabs());
  }
  if (next.driveId !== previous.driveId) services.resetCache();
  if (next.protectionExceptions !== previous.protectionExceptions) refreshAllTabs();
  if (next.clearCookiesOnExit || next.clearCacheOnExit) dataCleared = false;

  broadcast(IPC.evSettings, next);
  for (const wc of allWebContents.getAllWebContents()) {
    if (!wc.isDestroyed() && isInternalUrl(wc.getURL())) wc.send(INTERNAL.evSettings, next);
  }
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
    newWindow: () => openWindow(false, []),
    newPrivateWindow: () => openWindow(true, []),
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
    openSettings: () => current()?.openSettings(),
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
    if (s.trackingProtection === 'off') items.push({ label: 'Il blocco dei tracker è disattivato nelle impostazioni', enabled: false });
    items.push({ type: 'separator' });
  } else {
    items.push({ label: 'Nessuna protezione necessaria per questa pagina', enabled: false }, { type: 'separator' });
  }
  items.push({ label: 'Impostazioni privacy…', click: () => w.openSettings('privacy') });
  Menu.buildFromTemplate(items).popup({ window: w.win });
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
  handle(IPC.windowInfo, (w) => ({ isPrivate: w.isPrivate }));
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
  handle(IPC.openSettingsPage, (w, section?: string) => w.openSettings(section));

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
  handleInternal(INTERNAL.settingsGet, S, () => settings.get());
  handleInternal(INTERNAL.settingsSet, S, (_e, patch: Partial<Settings>) => settings.update(patch));
  handleInternal(INTERNAL.tokenStatus, S, () => settings.tokenStatus());
  handleInternal(INTERNAL.tokenSet, S, (_e, token: string) =>
    wrap(async () => {
      if (!token.trim()) throw new Error('Il token è vuoto.');
      settings.setToken(token);
      services.resetCache();
      const profile = await services.profile();
      broadcast(IPC.evSettings, settings.get());
      return profile;
    }),
  );
  handleInternal(INTERNAL.tokenClear, S, () => {
    settings.clearToken();
    services.resetCache();
    broadcast(IPC.evSettings, settings.get());
  });
  handleInternal(INTERNAL.drives, S, () => wrap(() => services.drives()));
  handleInternal(INTERNAL.clearData, S, (event, selection: BrowsingDataSelection) =>
    wrap(async () => {
      await clearBrowsingData(event.sender.session, selection);
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
  handleInternal(INTERNAL.httpsContinue, ['https-only'], (event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:') throw new Error('URL non valido');
    const host = parsed.hostname.toLowerCase();
    if (!settings.get().httpExceptions.includes(host)) settings.update({ httpExceptions: [...settings.get().httpExceptions, host] });
    void event.sender.loadURL(parsed.href);
  });
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
