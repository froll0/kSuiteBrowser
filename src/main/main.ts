import { BrowserWindow, Menu, app, dialog, ipcMain, session, shell, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { join } from 'node:path';
import { KSUITE_APPS } from '../shared/ksuite-apps';
import { IPC } from '../shared/ipc';
import type { ApiResult, DriveFile, NewEvent, OutgoingMail, Rect, Settings } from '../shared/types';
import { resolveOmniboxInput } from '../shared/url';
import { buildAppMenu } from './app-menu';
import { attachContextMenu } from './context-menu';
import { DownloadManager } from './downloads';
import { configurePermissions } from './permissions';
import { KSuiteServices } from './services';
import { SettingsStore } from './settings';
import { TabManager } from './tabs';

let win: BrowserWindow | null = null;
let tabs: TabManager | null = null;
let settings: SettingsStore;
let services: KSuiteServices;
let downloads: DownloadManager;

const pendingUrls: string[] = urlsFromArgv(process.argv);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    for (const url of urlsFromArgv(argv)) tabs?.create(url);
  });
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox('kSuite Browser', String(err));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());

function urlsFromArgv(argv: string[]): string[] {
  return argv.slice(1).filter((a) => /^https?:\/\//i.test(a));
}

function start(): void {
  settings = new SettingsStore();
  services = new KSuiteServices(settings);
  downloads = new DownloadManager(settings, services, (items) => send(IPC.evDownloads, items));

  const ses = session.defaultSession;
  downloads.attach(ses);
  configurePermissions(ses, () => win);

  createWindow();
  registerIpc();
  Menu.setApplicationMenu(
    buildAppMenu({
      newTab: () => newTab(),
      closeTab: () => closeActiveTab(),
      focusAddress: () => focusChrome(IPC.evFocusAddress),
      reload: () => withActive((id) => tabs?.reload(id)),
      back: () => tabs?.activeContents()?.navigationHistory.goBack(),
      forward: () => tabs?.activeContents()?.navigationHistory.goForward(),
      nextTab: () => tabs?.cycle(1),
      previousTab: () => tabs?.cycle(-1),
      togglePanel: () => send(IPC.evTogglePanel),
      savePageToDrive: () => {
        const wc = tabs?.activeContents();
        if (wc) void savePageToDrive(wc);
      },
      mailPage: () => {
        const wc = tabs?.activeContents();
        if (wc) composeMail(wc.getURL(), wc.getTitle());
      },
      openSettings: () => focusChrome(IPC.evOpenSettings),
      devTools: () => tabs?.activeContents()?.toggleDevTools(),
    }),
  );
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: 'kSuite Browser',
    backgroundColor: '#f4f6f9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The browser UI itself must never navigate away from the bundled page.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  tabs = new TabManager(win, {
    onChange: (states) => send(IPC.evTabs, states),
    onWebContentsCreated: setupPageContents,
  });

  void win.loadFile(join(__dirname, '../renderer/index.html'));
  win.webContents.once('did-finish-load', () => {
    const initial = pendingUrls.length ? pendingUrls.splice(0) : [settings.get().homePage];
    for (const url of initial) tabs?.create(url);
  });
  win.on('closed', () => {
    win = null;
    tabs = null;
  });
}

function setupPageContents(contents: WebContents, manager: TabManager): void {
  contents.setWindowOpenHandler(({ url, disposition, features }) => {
    // Real popups (e.g. OAuth logins) need window.opener: keep them as windows.
    if (disposition === 'new-window' && features) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      };
    }
    manager.create(url, { background: disposition === 'background-tab' });
    return { action: 'deny' };
  });

  contents.on('will-navigate', (e, url) => {
    // Hand mailto:, tel:, etc. to the system instead of failing inside the tab.
    if (!/^(https?|file|about|data|blob|view-source):/i.test(url)) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  attachContextMenu(contents, {
    openInNewTab: (url) => manager.create(url, { background: true }),
    saveUrlToDrive: (url) => void runDriveAction('Salvataggio su kDrive', () => services.saveUrlToDrive(contents.session, url)),
    savePageToDrive: (wc) => void savePageToDrive(wc),
    mailLink: (url, title) => composeMail(url, title),
  });
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function focusChrome(channel: string): void {
  win?.webContents.focus();
  send(channel);
}

function withActive(fn: (id: number) => void): void {
  const active = tabs?.states().find((t) => t.active);
  if (active) fn(active.id);
}

function newTab(url?: string): void {
  tabs?.create(url ?? settings.get().homePage);
  focusChrome(IPC.evFocusAddress);
}

function closeActiveTab(): void {
  withActive((id) => {
    tabs?.close(id);
    if (tabs && tabs.count() === 0) newTab();
  });
}

function composeMail(url: string, title: string): void {
  send(IPC.evComposeMail, { to: '', subject: title || url, body: `${title ? `${title}\n` : ''}${url}` });
}

async function savePageToDrive(contents: WebContents): Promise<void> {
  await runDriveAction('Salvataggio pagina in PDF', () => services.savePageAsPdf(contents));
}

async function runDriveAction(label: string, action: () => Promise<DriveFile>): Promise<void> {
  send(IPC.evToast, { kind: 'info', message: `${label}…` });
  try {
    const file = await action();
    send(IPC.evToast, { kind: 'success', message: `"${file.name}" salvato in ${settings.get().driveUploadFolderName}` });
  } catch (err) {
    send(IPC.evToast, { kind: 'error', message: errorMessage(err) });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function wrap<T>(fn: () => Promise<T> | T): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Only the browser UI may call IPC handlers; web pages have no preload, but check anyway. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R): void {
  ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    if (!win || event.sender !== win.webContents) throw new Error('Unauthorized IPC sender');
    return fn(...(args as A));
  });
}

function registerIpc(): void {
  handle(IPC.tabsList, () => tabs?.states() ?? []);
  handle(IPC.tabsCreate, (url?: string) => newTab(url ? resolveOmniboxInput(url, settings.get().searchEngine) : undefined));
  handle(IPC.tabsClose, (id: number) => {
    tabs?.close(id);
    if (tabs && tabs.count() === 0) newTab();
  });
  handle(IPC.tabsActivate, (id: number) => tabs?.activate(id));
  handle(IPC.tabsNavigate, (id: number, input: string) => tabs?.navigate(id, resolveOmniboxInput(input, settings.get().searchEngine)));
  handle(IPC.tabsBack, (id: number) => tabs?.contents(id)?.navigationHistory.goBack());
  handle(IPC.tabsForward, (id: number) => tabs?.contents(id)?.navigationHistory.goForward());
  handle(IPC.tabsReload, (id: number) => tabs?.reload(id));
  handle(IPC.tabsStop, (id: number) => tabs?.contents(id)?.stop());
  handle(IPC.openApp, (appId: string) => {
    const appDef = KSUITE_APPS.find((a) => a.id === appId);
    if (appDef) tabs?.openApp(appDef.id, appDef.url);
  });
  handle(IPC.setContentBounds, (rect: Rect) => tabs?.setBounds(rect));
  handle(IPC.showAppMenu, () => Menu.getApplicationMenu()?.popup({ window: win ?? undefined }));

  handle(IPC.settingsGet, () => settings.get());
  handle(IPC.settingsSet, (patch: Partial<Settings>) => {
    const before = settings.get().driveId;
    const next = settings.update(patch);
    if (next.driveId !== before) services.resetCache();
    return next;
  });
  handle(IPC.tokenStatus, () => settings.tokenStatus());
  handle(IPC.tokenSet, (token: string) =>
    wrap(async () => {
      if (!token.trim()) throw new Error('Il token è vuoto.');
      settings.setToken(token);
      services.resetCache();
      return services.profile();
    }),
  );
  handle(IPC.tokenClear, () => {
    settings.clearToken();
    services.resetCache();
  });

  handle(IPC.apiProfile, () => wrap(() => services.profile()));
  handle(IPC.apiDrives, () => wrap(() => services.drives()));
  handle(IPC.apiDriveList, (dirId: number, cursor?: string | null) => wrap(() => services.listDirectory(dirId, cursor)));
  handle(IPC.apiDriveSearch, (query: string) => wrap(() => services.search(query)));
  handle(IPC.apiDriveDownload, (fileId: number, name: string) =>
    wrap(async () => {
      const path = await services.downloadToDisk(fileId, name);
      shell.showItemInFolder(path);
      return path;
    }),
  );
  handle(IPC.apiDriveUpload, (dirId: number) =>
    wrap(async () => {
      const options = { title: 'Carica su kDrive', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> };
      const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (picked.canceled) return [];
      const uploaded: DriveFile[] = [];
      for (const path of picked.filePaths) uploaded.push(await services.uploadLocalFile(path, dirId));
      return uploaded;
    }),
  );
  handle(IPC.apiDriveOpenWeb, (file: DriveFile) =>
    wrap(async () => {
      tabs?.create(await services.driveWebUrl(file));
    }),
  );
  handle(IPC.apiSavePageToDrive, () =>
    wrap(async () => {
      const wc = tabs?.activeContents();
      if (!wc) throw new Error('Nessuna scheda attiva.');
      await savePageToDrive(wc);
    }),
  );
  handle(IPC.apiMailOverview, () => wrap(() => services.mailOverview()));
  handle(IPC.apiMailSend, (mail: OutgoingMail) => wrap(() => services.sendMail(mail)));
  handle(IPC.apiCalendarUpcoming, () => wrap(() => services.upcomingEvents()));
  handle(IPC.apiCalendarCreate, (event: NewEvent) => wrap(() => services.createEvent(event)));

  handle(IPC.downloadsList, () => downloads.list());
  handle(IPC.downloadsOpen, (id: string, reveal: boolean) => downloads.open(id, reveal));
}
