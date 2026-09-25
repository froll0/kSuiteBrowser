/// <reference types="chrome" />
import {
  BrowserWindow, Menu, Notification, WebContentsView, dialog, ipcMain, nativeImage, webContents,
  type Extension, type MenuItemConstructorOptions, type ServiceWorkerMain, type Session, type WebContents,
} from 'electron';
import { allSites, hostPatterns, matchesAny, matchesPattern } from '../../shared/match-pattern';
import type { ExtensionButton, ExtensionSummary, Rect, TabState } from '../../shared/types';
import type { BrowserWindowController } from '../window';
import { actionOf, describePermissions, extensionFile, iconDataUrl, iconPath, localize, type Manifest } from './manifest';
import { ExtensionRegistry, InstallError, type InstallPreview, type InstalledExtension } from './registry';

/** Tabs asleep have no page: they get an ID of their own and are reported as discarded. */
const SLEEPING_ID_BASE = 1_000_000;

interface Loaded {
  ext: Extension;
  info: InstalledExtension;
  manifest: Manifest;
  dir: string;
  name: string;
  hosts: string[];
  permissions: Set<string>;
}

interface ActionProps {
  title: string;
  icon: string | null;
  badgeText: string;
  badgeBg: string;
  badgeColor: string;
  popup: string;
  enabled: boolean;
}

interface MenuItem {
  id: string;
  title?: string;
  type?: 'normal' | 'checkbox' | 'radio' | 'separator';
  contexts?: string[];
  parentId?: string;
  checked?: boolean;
  enabled?: boolean;
  visible?: boolean;
  documentUrlPatterns?: string[];
  targetUrlPatterns?: string[];
}

interface CallContext {
  extId: string;
  sender: WebContents | null;
  worker: ServiceWorkerMain | null;
}

interface SnapTab {
  extId: number;
  windowId: number;
  index: number;
  url: string;
  title: string;
  status: 'loading' | 'complete';
  favIconUrl: string;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  discarded: boolean;
  active: boolean;
}

export interface HostDeps {
  session: Session;
  /** Normal (non-private) browser windows. */
  windows(): BrowserWindowController[];
  focused(): BrowserWindowController | null;
  openWindow(urls: string[]): BrowserWindowController;
  /** The toolbar gets the extensions button the first time an extension is installed. */
  firstInstall(): void;
}

const hex = (c: unknown): string => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c) && c.length >= 3) return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c.length > 3 ? Number(c[3]) / 255 : 1})`;
  return '#d1242f';
};

class Deferred {
  static wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

/** Popup of an extension's toolbar button: a page under the button, sized by its content. */
class ActionPopup {
  view: WebContentsView | null = null;
  extId: string | null = null;
  private closedAt = 0;

  constructor(private readonly owner: BrowserWindowController, private readonly session: Session) {}

  get contents(): WebContents | null {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  /** Just closed by a click elsewhere (on its own button?): don't reopen at once. */
  justClosed(): boolean {
    return Date.now() - this.closedAt < 300;
  }

  show(extId: string, url: string, anchor: Rect | null): void {
    this.close();
    const win = this.owner.win;
    if (win.isDestroyed()) return;
    const view = new WebContentsView({ webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false, enablePreferredSizeMode: true } });
    this.view = view;
    this.extId = extId;
    const wc = view.webContents;
    view.setBackgroundColor('#ffffff');
    view.setBorderRadius(10);
    const place = (width: number, height: number) => {
      if (win.isDestroyed() || this.view !== view) return;
      const [ww, wh] = win.getContentSize();
      const w = Math.max(25, Math.min(800, Math.ceil(width)));
      const h = Math.max(25, Math.min(600, Math.ceil(height), wh - 60));
      const right = anchor ? anchor.x + anchor.width : ww - 8;
      const top = anchor ? anchor.y + anchor.height + 4 : 48;
      view.setBounds({ x: Math.round(Math.max(8, Math.min(right - w, ww - w - 8))), y: Math.round(top), width: w, height: h });
    };
    wc.on('preferred-size-changed', (_e, size) => place(size.width, size.height));
    place(320, 200);
    wc.on('blur', () => setTimeout(() => {
      // Dialogs opened by the popup (file picker, alert) take the focus without meaning "close".
      if (this.view === view && !wc.isDestroyed() && !wc.isFocused() && !win.webContents.isDevToolsOpened()) this.close();
    }, 150));
    wc.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') this.close();
    });
    wc.setWindowOpenHandler(({ url: target }) => {
      this.owner.tabs.create(target);
      return { action: 'deny' };
    });
    void wc.loadURL(url);
    win.contentView.addChildView(view);
    wc.focus();
  }

  close(): void {
    const view = this.view;
    if (!view) return;
    this.view = null;
    this.extId = null;
    this.closedAt = Date.now();
    if (!this.owner.win.isDestroyed()) this.owner.win.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }
}

/**
 * Runs the installed extensions in the default session and implements the chrome.* API that
 * Electron lacks, on top of the browser's windows and tabs.
 */
export class ExtensionHost {
  readonly registry: ExtensionRegistry;
  private readonly loaded = new Map<string, Loaded>();
  private readonly actions = new Map<string, { global: ActionProps; tabs: Map<number, Partial<ActionProps>> }>();
  private readonly menus = new Map<string, Map<string, MenuItem>>();
  private readonly frames = new Map<string, Set<WebContents>>();
  private readonly workers = new Map<string, ServiceWorkerMain>();
  /** Events the extension's service worker listened to: they wake it up when it is stopped. */
  private readonly workerEvents = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Array<[string, unknown[]]>>();
  private readonly notifications = new Map<string, Notification>();
  private readonly popups = new Map<BrowserWindowController, ActionPopup>();
  private readonly popupWindows = new Map<number, { win: BrowserWindow; extId: string }>();
  private readonly snapshots = new Map<number, Map<number, SnapTab>>();
  /** Tabs an extension may act on after the user invoked it there (activeTab). */
  private readonly activeTab = new Map<string, Set<number>>();
  private readonly sidePanel = new Map<string, { path?: string; openOnAction: boolean }>();
  /**
   * A hidden page of each extension. Electron applies service worker preloads only in renderer
   * processes that also host a frame: keeping one alive puts the extension's worker in a process
   * where its chrome.* API gets completed.
   */
  private readonly hostPages = new Map<string, WebContentsView>();
  /** Worker versions that reported their API ready. */
  private readonly readyWorkers = new Set<number>();
  private readonly repaired = new Set<number>();
  /** Extensions that got runtime.onStartup in this run of the browser. */
  private readonly started = new Set<string>();
  /** Events waiting for the worker to add its listener (it adds them while its script runs). */
  private readonly awaiting = new Map<string, Array<{ name: string; args: unknown[]; until: number }>>();
  private downloadId = 0;

  constructor(private readonly deps: HostDeps, userData: string) {
    this.registry = new ExtensionRegistry(userData, deps.session, {
      loaded: (ext, info) => this.onLoaded(ext, info),
      unloaded: (id) => this.onUnloaded(id),
    });
    this.registry.onChange(() => this.refreshButtons());

    ipcMain.handle('crx:call', (e, name: string, args: unknown[]) => {
      const url = e.senderFrame?.url ?? '';
      const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(url);
      if (!m || !this.loaded.has(m[1])) throw new Error('Contesto non autorizzato');
      const frames = this.frames.get(m[1]) ?? new Set();
      if (!frames.has(e.sender)) {
        frames.add(e.sender);
        this.frames.set(m[1], frames);
        e.sender.once('destroyed', () => frames.delete(e.sender));
      }
      return this.call({ extId: m[1], sender: e.sender, worker: null }, name, Array.isArray(args) ? args : []);
    });

    const ses = deps.session;
    ses.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus === 'stopped') this.readyWorkers.delete(versionId);
      if (runningStatus !== 'starting' && runningStatus !== 'running') return;
      const worker = ses.serviceWorkers.getWorkerFromVersionID(versionId);
      if (worker) this.wireWorker(worker);
      if (runningStatus === 'running' && worker) setTimeout(() => this.checkWorker(worker, versionId), 2500);
    });
    ses.cookies.on('changed', (_e, cookie, cause, removed) => {
      const url = `https://${(cookie.domain ?? '').replace(/^\./, '')}${cookie.path ?? '/'}`;
      for (const l of this.loaded.values()) {
        if (l.permissions.has('cookies') && this.hostAccess(l, url)) this.emit(l.ext.id, 'cookies.onChanged', [{ removed, cookie: this.cookieOut(cookie), cause }]);
      }
    });
  }

  private wireWorker(worker: ServiceWorkerMain): void {
    const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.scope);
    if (!m || (worker as unknown as { __ksuite?: boolean }).__ksuite) return;
    (worker as unknown as { __ksuite?: boolean }).__ksuite = true;
    const extId = m[1];
    this.workers.set(extId, worker);
    worker.ipc.handle('crx:call', (_e, name: string, args: unknown[]) => {
      if (!this.loaded.has(extId)) throw new Error('Estensione non attiva');
      if (name === 'ready') {
        this.readyWorkers.add(worker.versionId);
        this.lifecycle(extId);
        return { value: undefined };
      }
      return this.call({ extId, sender: null, worker }, name, Array.isArray(args) ? args : []);
    });
  }

  /**
   * A worker that started without its completed API (it never said "ready") is restarted in the
   * process of the extension's hidden page. Done once per worker version.
   */
  private checkWorker(worker: ServiceWorkerMain, versionId: number): void {
    const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(worker.scope);
    if (!m || !this.loaded.has(m[1]) || this.readyWorkers.has(versionId) || this.repaired.has(versionId) || worker.isDestroyed()) return;
    this.repaired.add(versionId);
    const extId = m[1];
    console.warn('[extensions] API incompleta nel service worker, lo riavvio:', extId);
    const page = this.hostPages.get(extId);
    if (!page || page.webContents.isDestroyed()) return;
    // The worker lives in the page's process: restarting that process restarts both, the page first.
    page.webContents.forcefullyCrashRenderer();
    setTimeout(() => {
      if (page.webContents.isDestroyed()) return;
      page.webContents.once('did-finish-load', () => {
        void this.deps.session.serviceWorkers.startWorkerForScope(`chrome-extension://${extId}/`).then((w) => this.wireWorker(w), () => {});
      });
      page.webContents.reload();
    }, 200);
  }

  // ---------- Loading ----------

  async start(): Promise<void> {
    await this.registry.loadAll();
    // Store extensions: look for updates now and then.
    setTimeout(() => void this.registry.checkUpdates(), 60_000).unref();
    setInterval(() => void this.registry.checkUpdates(), 5 * 3600_000).unref();
  }

  private onLoaded(ext: Extension, info: InstalledExtension): void {
    // First, before the worker starts (see hostPages).
    this.hostPages.get(ext.id)?.webContents.close();
    const page = new WebContentsView({ webPreferences: { session: this.deps.session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    page.webContents.setAudioMuted(true);
    void page.webContents.loadURL(`chrome-extension://${ext.id}/manifest.json`).catch(() => {});
    this.hostPages.set(ext.id, page);
    const manifest = ext.manifest as Manifest;
    // Manifest V2 background: Electron only runs persistent ones. Otherwise the hidden page becomes it.
    const bg = manifest.manifest_version === 2 ? manifest.background : undefined;
    if (bg && (bg.page || bg.scripts?.length)) {
      setTimeout(() => {
        const running = webContents.getAllWebContents().some((wc) => wc.getType() === 'backgroundPage' && wc.getURL().startsWith(`chrome-extension://${ext.id}/`));
        if (!running && this.hostPages.get(ext.id) === page && !page.webContents.isDestroyed()) {
          void page.webContents.loadURL(`chrome-extension://${ext.id}/${(bg.page ?? '_generated_background_page.html').replace(/^\//, '')}`).catch(() => {});
        }
      }, 800);
    }
    const act = actionOf(manifest);
    const loaded: Loaded = {
      ext,
      info,
      manifest,
      dir: ext.path,
      name: localize(ext.path, manifest, manifest.name),
      hosts: hostPatterns(manifest),
      permissions: new Set([...(manifest.permissions ?? []), ...info.granted].filter((p): p is string => typeof p === 'string')),
    };
    this.loaded.set(ext.id, loaded);
    this.actions.set(ext.id, {
      global: {
        title: localize(ext.path, manifest, act?.default_title) || loaded.name,
        icon: iconDataUrl(ext.path, iconPath(act?.default_icon, 32) ?? iconPath(manifest.icons, 32)),
        badgeText: '',
        badgeBg: '#d1242f',
        badgeColor: '#ffffff',
        popup: act?.default_popup ?? '',
        enabled: true,
      },
      tabs: new Map(),
    });
    const side = (manifest as { side_panel?: { default_path?: string } }).side_panel;
    if (side?.default_path) this.sidePanel.set(ext.id, { path: side.default_path, openOnAction: false });
    this.refreshButtons();
  }

  private onUnloaded(id: string): void {
    const page = this.hostPages.get(id);
    this.hostPages.delete(id);
    if (page && !page.webContents.isDestroyed()) page.webContents.close();
    this.loaded.delete(id);
    this.actions.delete(id);
    this.menus.delete(id);
    this.workers.delete(id);
    this.workerEvents.delete(id);
    this.frames.delete(id);
    for (const [wid, p] of this.popupWindows) if (p.extId === id && !p.win.isDestroyed()) p.win.close(), this.popupWindows.delete(wid);
    for (const popup of this.popups.values()) if (popup.extId === id) popup.close();
    this.refreshButtons();
  }

  /** Called after an installation from the extensions page. */
  installed(): void {
    this.deps.firstInstall();
  }

  /** Installed extensions for the extensions page. */
  summary(): ExtensionSummary[] {
    return this.registry.list().map((info) => {
      const manifest = this.registry.manifest(info.id);
      const l = this.loaded.get(info.id);
      const dir = info.path;
      return {
        id: info.id,
        name: manifest ? localize(dir, manifest, manifest.name) : info.id,
        description: manifest ? localize(dir, manifest, manifest.description) : '',
        version: info.version,
        icon: manifest ? iconDataUrl(dir, iconPath(manifest.icons, 48) ?? iconPath(actionOf(manifest)?.default_icon, 48)) : null,
        source: info.source,
        path: info.source === 'unpacked' ? info.path : null,
        enabled: info.enabled,
        running: Boolean(l),
        pinned: info.pinned,
        error: this.registry.errors.get(info.id) ?? (manifest ? null : 'File dell’estensione mancanti'),
        hasOptions: Boolean(manifest?.options_ui?.page || manifest?.options_page),
        homepage: manifest?.homepage_url ?? (info.source === 'store' ? `https://chromewebstore.google.com/detail/${info.id}` : null),
        warnings: manifest ? describePermissions(manifest).warnings : [],
        unsupported: manifest ? describePermissions(manifest).unsupported : [],
        pendingUpdate: info.pendingUpdate,
        installedAt: info.installedAt,
      };
    });
  }

  isLoaded(id: string): boolean {
    return this.loaded.has(id);
  }

  // ---------- Events to extensions ----------

  /** onInstalled (first run of a version) or onStartup (first run in this browser session). */
  private lifecycle(extId: string): void {
    const install = this.registry.takeInstallEvent(extId);
    if (install) {
      this.started.add(extId);
      this.emitWhenListening(extId, 'runtime.onInstalled', [install]);
    } else if (!this.started.has(extId)) {
      this.started.add(extId);
      this.emitWhenListening(extId, 'runtime.onStartup', []);
    }
  }

  private emitWhenListening(extId: string, name: string, args: unknown[]): void {
    const worker = Boolean(this.loaded.get(extId)?.manifest.background?.service_worker);
    if (this.workerEvents.get(extId)?.has(name) || (!worker && this.frames.get(extId)?.size)) {
      this.emit(extId, name, args);
      return;
    }
    const list = this.awaiting.get(extId) ?? [];
    list.push({ name, args, until: Date.now() + 5000 });
    this.awaiting.set(extId, list);
  }

  private deliverAwaiting(extId: string, name: string): void {
    const list = this.awaiting.get(extId);
    if (!list) return;
    const now = Date.now();
    const keep = list.filter((e) => e.until > now && e.name !== name);
    for (const e of list) if (e.name === name && e.until > now) this.emit(extId, e.name, e.args);
    if (keep.length) this.awaiting.set(extId, keep);
    else this.awaiting.delete(extId);
  }

  /** Sends an event to an extension's pages and service worker (waking it if it listens). */
  private emit(extId: string, name: string, args: unknown[]): void {
    for (const wc of this.frames.get(extId) ?? []) if (!wc.isDestroyed()) wc.send('crx:event', name, args);
    const worker = this.workers.get(extId);
    if (worker && !worker.isDestroyed()) {
      worker.send('crx:event', name, args);
      return;
    }
    if (!this.workerEvents.get(extId)?.has(name)) return;
    // A stopped Manifest V3 worker is started again for the events it listens to.
    const queue = this.pending.get(extId) ?? [];
    queue.push([name, args]);
    this.pending.set(extId, queue);
    if (queue.length > 1) return;
    void this.deps.session.serviceWorkers.startWorkerForScope(`chrome-extension://${extId}/`).then(
      async (w) => {
        this.wireWorker(w);
        // Its listeners are registered while its script runs: give it a moment, then deliver.
        await Deferred.wait(300);
        const items = this.pending.get(extId) ?? [];
        this.pending.delete(extId);
        for (const [n, a] of items) if (!w.isDestroyed()) w.send('crx:event', n, a);
      },
      () => this.pending.delete(extId),
    );
  }

  private emitAll(name: string, build: (l: Loaded) => unknown[] | null): void {
    for (const l of this.loaded.values()) {
      const args = build(l);
      if (args) this.emit(l.ext.id, name, args);
    }
  }

  // ---------- Windows and tabs as extensions see them ----------

  private windowId(w: BrowserWindowController): number {
    return w.win.id;
  }

  private extTabId(w: BrowserWindowController, tabId: number): number {
    return w.tabs.contents(tabId)?.id ?? SLEEPING_ID_BASE + tabId;
  }

  /** Finds a tab from the ID an extension uses. */
  private resolveTab(extTabId: number): { w: BrowserWindowController; tabId: number; state: TabState; index: number } | null {
    for (const w of this.deps.windows()) {
      const states = w.tabs.states();
      for (const [index, state] of states.entries()) {
        if (this.extTabId(w, state.id) === extTabId) return { w, tabId: state.id, state, index };
      }
    }
    return null;
  }

  private hostAccess(l: Loaded, url: string): boolean {
    return matchesAny(l.hosts, url) || matchesAny(l.info.granted.filter((g) => g.includes('://') || g === '<all_urls>'), url);
  }

  private canSeeTab(l: Loaded, url: string, extTabId: number): boolean {
    return l.permissions.has('tabs') || this.hostAccess(l, url) || Boolean(this.activeTab.get(l.ext.id)?.has(extTabId)) || url.startsWith(`chrome-extension://${l.ext.id}/`);
  }

  private tabInfo(l: Loaded, w: BrowserWindowController, state: TabState, index: number): chrome.tabs.Tab {
    const id = this.extTabId(w, state.id);
    const visible = this.canSeeTab(l, state.url, id);
    const wc = w.tabs.contents(state.id);
    const bounds = w.tabs.pageArea();
    return {
      id,
      index,
      windowId: this.windowId(w),
      openerTabId: undefined,
      active: state.active,
      highlighted: state.active,
      selected: state.active,
      pinned: state.pinned,
      audible: state.audible,
      discarded: state.sleeping,
      autoDiscardable: true,
      frozen: false,
      incognito: false,
      mutedInfo: { muted: state.muted },
      status: state.loading ? 'loading' : state.sleeping ? 'unloaded' : 'complete',
      width: bounds.width,
      height: bounds.height,
      groupId: -1,
      lastAccessed: state.lastActiveAt,
      ...(visible ? { url: state.url, title: state.title, favIconUrl: state.favicon ?? undefined } : {}),
      ...(wc && visible && wc.getURL() !== state.url ? { pendingUrl: wc.getURL() } : {}),
    } as chrome.tabs.Tab;
  }

  private popupTab(l: Loaded, windowId: number, win: BrowserWindow): chrome.tabs.Tab {
    const wc = win.webContents;
    const url = wc.getURL();
    const visible = this.canSeeTab(l, url, wc.id);
    return {
      id: wc.id, index: 0, windowId, active: true, highlighted: true, selected: true, pinned: false, discarded: false, autoDiscardable: false,
      frozen: false, incognito: false, mutedInfo: { muted: wc.isAudioMuted() }, status: wc.isLoading() ? 'loading' : 'complete', groupId: -1,
      ...(visible ? { url, title: wc.getTitle() } : {}),
    } as chrome.tabs.Tab;
  }

  private windowInfo(l: Loaded, w: BrowserWindowController, populate: boolean): chrome.windows.Window {
    const b = w.win.getBounds();
    return {
      id: this.windowId(w),
      focused: w.win.isFocused(),
      top: b.y, left: b.x, width: b.width, height: b.height,
      incognito: false,
      type: 'normal',
      state: w.win.isFullScreen() ? 'fullscreen' : w.win.isMinimized() ? 'minimized' : w.win.isMaximized() ? 'maximized' : 'normal',
      alwaysOnTop: w.win.isAlwaysOnTop(),
      ...(populate ? { tabs: w.tabs.states().map((s, i) => this.tabInfo(l, w, s, i)) } : {}),
    } as chrome.windows.Window;
  }

  private popupWindowInfo(l: Loaded, id: number, win: BrowserWindow, populate: boolean): chrome.windows.Window {
    const b = win.getBounds();
    return {
      id, focused: win.isFocused(), top: b.y, left: b.x, width: b.width, height: b.height, incognito: false, type: 'popup', state: 'normal', alwaysOnTop: false,
      ...(populate ? { tabs: [this.popupTab(l, id, win)] } : {}),
    } as chrome.windows.Window;
  }

  /** The window a call comes from: the tab's window, the popup's window, or the focused one. */
  private callerWindow(ctx: CallContext): BrowserWindowController | null {
    const wc = ctx.sender;
    if (wc) {
      for (const w of this.deps.windows()) if (w.tabs.idOf(wc) !== null) return w;
      for (const [w, popup] of this.popups) if (popup.contents === wc) return w;
    }
    return this.deps.focused();
  }

  private callerPopupWindow(ctx: CallContext): number | null {
    if (!ctx.sender) return null;
    for (const [id, p] of this.popupWindows) if (!p.win.isDestroyed() && p.win.webContents === ctx.sender) return id;
    return null;
  }

  // ---------- Tab and window changes → events ----------

  /** Called whenever the tabs of a window change: works out the chrome.tabs events. */
  tabsChanged(w: BrowserWindowController): void {
    if (w.isPrivate || this.loaded.size === 0 && this.snapshots.size === 0) return;
    const windowId = this.windowId(w);
    const prev = this.snapshots.get(windowId) ?? new Map<number, SnapTab>();
    const next = new Map<number, SnapTab>();
    const states = w.tabs.states();
    states.forEach((s, index) => {
      next.set(s.id, {
        extId: this.extTabId(w, s.id), windowId, index, url: s.url, title: s.title, status: s.loading ? 'loading' : 'complete',
        favIconUrl: s.favicon ?? '', pinned: s.pinned, audible: s.audible, muted: s.muted, discarded: s.sleeping, active: s.active,
      });
    });
    this.snapshots.set(windowId, next);
    if (this.loaded.size === 0) return;

    for (const [tabId, now] of next) {
      const before = prev.get(tabId);
      const state = states[now.index];
      if (!before) {
        // From another window, or new.
        let from: SnapTab | undefined;
        for (const [wid, snap] of this.snapshots) {
          if (wid === windowId) continue;
          const t = snap.get(tabId);
          if (t) {
            from = t;
            snap.delete(tabId);
          }
        }
        if (from) {
          this.emitAll('tabs.onDetached', () => [from!.extId, { oldWindowId: from!.windowId, oldPosition: from!.index }]);
          this.emitAll('tabs.onAttached', () => [now.extId, { newWindowId: windowId, newPosition: now.index }]);
        } else {
          this.emitAll('tabs.onCreated', (l) => [this.tabInfo(l, w, state, now.index)]);
        }
        if (now.active) this.activated(now);
        continue;
      }
      if (before.extId !== now.extId) {
        this.emitAll('tabs.onReplaced', () => [now.extId, before.extId]);
        this.emitAll('webNavigation.onTabReplaced', (l) => (l.permissions.has('webNavigation') ? [{ replacedTabId: before.extId, tabId: now.extId, timeStamp: Date.now() }] : null));
        this.forgetTab(before.extId);
      }
      const change: Record<string, unknown> = {};
      if (before.status !== now.status) change.status = now.status;
      if (before.url !== now.url) change.url = now.url;
      if (before.title !== now.title) change.title = now.title;
      if (before.favIconUrl !== now.favIconUrl) change.favIconUrl = now.favIconUrl;
      if (before.pinned !== now.pinned) change.pinned = now.pinned;
      if (before.audible !== now.audible) change.audible = now.audible;
      if (before.muted !== now.muted) change.mutedInfo = { muted: now.muted };
      if (before.discarded !== now.discarded) change.discarded = now.discarded;
      if (Object.keys(change).length) {
        this.emitAll('tabs.onUpdated', (l) => {
          const tab = this.tabInfo(l, w, state, now.index);
          const visible = this.canSeeTab(l, now.url, now.extId);
          const info = { ...change };
          if (!visible) for (const k of ['url', 'title', 'favIconUrl']) delete info[k];
          return Object.keys(info).length ? [now.extId, info, tab] : null;
        });
        if (change.url) this.activeTab.forEach((set) => set.delete(now.extId));
      }
      if (before.index !== now.index) this.emitAll('tabs.onMoved', () => [now.extId, { windowId, fromIndex: before.index, toIndex: now.index }]);
      if (now.active && !before.active) this.activated(now);
    }
    for (const [tabId, before] of prev) {
      if (next.has(tabId)) continue;
      // Moved to another window: onDetached/onAttached come from that window.
      if (this.deps.windows().some((x) => x !== w && x.tabs.ids().includes(tabId))) continue;
      this.emitAll('tabs.onRemoved', () => [before.extId, { windowId, isWindowClosing: false }]);
      this.forgetTab(before.extId);
    }
    if (this.buttonsDependOnTab()) this.sendButtons(w);
  }

  private activated(tab: SnapTab): void {
    this.emitAll('tabs.onActivated', () => [{ tabId: tab.extId, windowId: tab.windowId }]);
    this.emitAll('tabs.onActiveChanged', () => [tab.extId, { windowId: tab.windowId }]);
    this.emitAll('tabs.onHighlighted', () => [{ tabIds: [tab.extId], windowId: tab.windowId }]);
  }

  private forgetTab(extTabId: number): void {
    for (const a of this.actions.values()) a.tabs.delete(extTabId);
    for (const set of this.activeTab.values()) set.delete(extTabId);
  }

  windowCreated(w: BrowserWindowController): void {
    if (w.isPrivate) return;
    this.emitAll('windows.onCreated', (l) => [this.windowInfo(l, w, false)]);
    w.win.on('focus', () => {
      this.emitAll('windows.onFocusChanged', () => [w.win.id]);
    });
    w.win.on('blur', () => setTimeout(() => {
      if (!BrowserWindow.getFocusedWindow()) this.emitAll('windows.onFocusChanged', () => [-1]);
    }, 50));
    w.win.on('resized', () => this.emitAll('windows.onBoundsChanged', (l) => [this.windowInfo(l, w, false)]));
    this.sendButtons(w);
  }

  windowClosed(w: BrowserWindowController): void {
    if (w.isPrivate) return;
    const windowId = w.win.id;
    for (const tab of this.snapshots.get(windowId)?.values() ?? []) {
      this.emitAll('tabs.onRemoved', () => [tab.extId, { windowId, isWindowClosing: true }]);
      this.forgetTab(tab.extId);
    }
    this.snapshots.delete(windowId);
    this.emitAll('windows.onRemoved', () => [windowId]);
    this.popups.get(w)?.close();
    this.popups.delete(w);
  }

  /** webNavigation events of a page (tabs of normal windows). */
  attachPage(wc: WebContents): void {
    const send = (name: string, url: string, extra: Record<string, unknown>) => {
      this.emitAll(`webNavigation.${name}`, (l) =>
        l.permissions.has('webNavigation') && this.hostAccess(l, url) || l.permissions.has('webNavigation') && l.permissions.has('tabs')
          ? [{ tabId: wc.id, url, processId: -1, timeStamp: Date.now(), ...extra }]
          : null,
      );
    };
    const frameId = (isMain: boolean, routingId: number) => (isMain ? 0 : routingId);
    wc.on('did-start-navigation', (d) => {
      if (this.loaded.size && !d.isSameDocument) send('onBeforeNavigate', d.url, { frameId: frameId(d.isMainFrame, d.frame?.routingId ?? 0), parentFrameId: d.isMainFrame ? -1 : 0 });
    });
    wc.on('did-frame-navigate', (_e, url, _code, _status, isMain, _pid, routingId) => {
      if (this.loaded.size) send('onCommitted', url, { frameId: frameId(isMain, routingId), parentFrameId: isMain ? -1 : 0, transitionType: 'link', transitionQualifiers: [] });
    });
    wc.on('dom-ready', () => {
      if (this.loaded.size) send('onDOMContentLoaded', wc.getURL(), { frameId: 0, parentFrameId: -1 });
    });
    wc.on('did-frame-finish-load', (_e, isMain, _pid, routingId) => {
      if (this.loaded.size) send('onCompleted', isMain ? wc.getURL() : wc.mainFrame.frames.find((f) => f.routingId === routingId)?.url ?? '', { frameId: frameId(isMain, routingId), parentFrameId: isMain ? -1 : 0 });
    });
    wc.on('did-fail-load', (_e, code, description, url, isMain, _pid, routingId) => {
      if (this.loaded.size && code !== -3) send('onErrorOccurred', url, { frameId: frameId(isMain, routingId), parentFrameId: isMain ? -1 : 0, error: `net::${description}` });
    });
    wc.on('did-navigate-in-page', (_e, url, isMain, _pid, routingId) => {
      if (this.loaded.size) send(url.includes('#') ? 'onReferenceFragmentUpdated' : 'onHistoryStateUpdated', url, { frameId: frameId(isMain, routingId), parentFrameId: isMain ? -1 : 0, transitionType: 'link', transitionQualifiers: [] });
    });
  }

  // ---------- The API ----------

  private async call(ctx: CallContext, name: string, args: unknown[]): Promise<{ value?: unknown; error?: string }> {
    const l = this.loaded.get(ctx.extId);
    if (!l) return { error: 'Estensione non attiva' };
    try {
      return { value: await this.run(l, ctx, name, args) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  private need(l: Loaded, permission: string): void {
    if (!l.permissions.has(permission)) throw new Error(`Serve il permesso "${permission}" nel manifest`);
  }

  private async run(l: Loaded, ctx: CallContext, name: string, args: unknown[]): Promise<unknown> {
    const id = l.ext.id;
    const a0 = args[0] as Record<string, any> | undefined;
    switch (name) {
      case 'subscribe': {
        if (ctx.worker) {
          const set = this.workerEvents.get(id) ?? new Set<string>();
          set.add(String(args[0]));
          this.workerEvents.set(id, set);
        }
        // Give it a moment to add the other listeners of the same run, then deliver what waited.
        setTimeout(() => this.deliverAwaiting(id, String(args[0])), 30);
        return undefined;
      }
      case 'ready': {
        // Manifest V2 background page.
        if (args[0] === 'background') this.lifecycle(id);
        return undefined;
      }

      // ----- action -----
      case 'action.setTitle': return this.setAction(id, a0?.tabId, { title: String(a0?.title ?? '') });
      case 'action.getTitle': return this.getAction(id, a0?.tabId).title;
      case 'action.setBadgeText': return this.setAction(id, a0?.tabId, { badgeText: String(a0?.text ?? '') });
      case 'action.getBadgeText': return this.getAction(id, a0?.tabId).badgeText;
      case 'action.setBadgeBackgroundColor': return this.setAction(id, a0?.tabId, { badgeBg: hex(a0?.color) });
      case 'action.getBadgeBackgroundColor': return this.getAction(id, a0?.tabId).badgeBg;
      case 'action.setBadgeTextColor': return this.setAction(id, a0?.tabId, { badgeColor: hex(a0?.color) });
      case 'action.getBadgeTextColor': return this.getAction(id, a0?.tabId).badgeColor;
      case 'action.setPopup': return this.setAction(id, a0?.tabId, { popup: String(a0?.popup ?? '') });
      case 'action.getPopup': {
        const popup = this.getAction(id, a0?.tabId).popup;
        return popup ? `chrome-extension://${id}/${popup.replace(/^\//, '')}` : '';
      }
      case 'action.enable': return this.setAction(id, (args[0] as number | null) ?? undefined, { enabled: true });
      case 'action.disable': return this.setAction(id, (args[0] as number | null) ?? undefined, { enabled: false });
      case 'action.isEnabled': return this.getAction(id, (args[0] as number | null) ?? undefined).enabled;
      case 'action.setIcon': {
        let icon: string | null = null;
        const images = a0?.imageData as Record<string, string> | undefined;
        if (images) icon = images[Object.keys(images).sort((x, y) => Number(y) - Number(x)).find((k) => Number(k) <= 64) ?? Object.keys(images)[0]] ?? null;
        else if (a0?.path) icon = iconDataUrl(l.dir, iconPath(a0.path as string | Record<string, string>, 32));
        return this.setAction(id, a0?.tabId, { icon });
      }
      case 'action.openPopup': {
        const w = this.deps.focused();
        if (w) this.clickAction(w, id, null, true);
        return undefined;
      }
      case 'action.getUserSettings': return { isOnToolbar: l.info.pinned };

      // ----- tabs -----
      case 'tabs.query': return this.queryTabs(l, ctx, (a0 ?? {}) as chrome.tabs.QueryInfo);
      case 'tabs.get': {
        const t = this.resolveTab(Number(args[0]));
        if (t) return this.tabInfo(l, t.w, t.state, t.index);
        const pw = this.popupWindowOfTab(Number(args[0]));
        if (pw) return this.popupTab(l, pw.id, pw.win);
        throw new Error(`Nessuna scheda con id ${args[0]}`);
      }
      case 'tabs.getCurrent': {
        if (!ctx.sender) return undefined;
        for (const w of this.deps.windows()) {
          const tabId = w.tabs.idOf(ctx.sender);
          if (tabId !== null) {
            const states = w.tabs.states();
            const index = states.findIndex((s) => s.id === tabId);
            return this.tabInfo(l, w, states[index], index);
          }
        }
        return undefined;
      }
      case 'tabs.create': {
        const props = (a0 ?? {}) as chrome.tabs.CreateProperties;
        const w = (props.windowId !== undefined && this.deps.windows().find((x) => this.windowId(x) === props.windowId)) || this.callerWindow(ctx) || this.deps.openWindow([]);
        const url = this.resolveUrl(l, props.url);
        const tabId = w.tabs.create(url, { background: props.active === false, index: props.index, pinned: props.pinned });
        if (props.active !== false) {
          w.tabs.activate(tabId);
          w.focus();
        }
        const states = w.tabs.states();
        const index = states.findIndex((s) => s.id === tabId);
        this.tabsChanged(w);
        return this.tabInfo(l, w, states[index], index);
      }
      case 'tabs.update': {
        const props = (args[1] ?? {}) as chrome.tabs.UpdateProperties & { selected?: boolean };
        const t = args[0] === null || args[0] === undefined ? this.activeOf(this.callerWindow(ctx)) : this.resolveTab(Number(args[0]));
        if (!t) throw new Error('Scheda non trovata');
        if (props.url) t.w.tabs.navigate(t.tabId, this.resolveUrl(l, props.url));
        if (props.active || props.highlighted || props.selected) t.w.tabs.activate(t.tabId);
        if (props.pinned !== undefined) t.w.tabs.setPinned(t.tabId, props.pinned);
        if (props.muted !== undefined) t.w.tabs.setMuted(t.tabId, props.muted);
        const again = this.resolveTabByTabId(t.w, t.tabId);
        return again ? this.tabInfo(l, t.w, again.state, again.index) : undefined;
      }
      case 'tabs.remove': {
        const ids = Array.isArray(args[0]) ? (args[0] as number[]) : [Number(args[0])];
        for (const tid of ids) {
          const t = this.resolveTab(tid);
          if (t) t.w.tabs.close(t.tabId);
          else this.popupWindowOfTab(tid)?.win.close();
        }
        return undefined;
      }
      case 'tabs.reload': {
        const t = args[0] === null || args[0] === undefined ? this.activeOf(this.callerWindow(ctx)) : this.resolveTab(Number(args[0]));
        if (!t) throw new Error('Scheda non trovata');
        const wc = t.w.tabs.contents(t.tabId);
        if (wc && (args[1] as { bypassCache?: boolean } | undefined)?.bypassCache) wc.reloadIgnoringCache();
        else t.w.tabs.reload(t.tabId);
        return undefined;
      }
      case 'tabs.duplicate': {
        const t = this.resolveTab(Number(args[0]));
        if (!t) throw new Error('Scheda non trovata');
        t.w.tabs.duplicate(t.tabId);
        return undefined;
      }
      case 'tabs.highlight': {
        const info = (a0 ?? {}) as { tabs: number | number[]; windowId?: number };
        const first = Array.isArray(info.tabs) ? info.tabs[0] : info.tabs;
        const w = this.deps.windows().find((x) => this.windowId(x) === info.windowId) ?? this.callerWindow(ctx);
        const tabId = w?.tabs.ids()[first];
        if (w && tabId !== undefined) w.tabs.activate(tabId);
        return w ? this.windowInfo(l, w, true) : undefined;
      }
      case 'tabs.move': {
        const ids = Array.isArray(args[0]) ? (args[0] as number[]) : [Number(args[0])];
        const props = (args[1] ?? {}) as { index: number };
        for (const tid of ids) {
          const t = this.resolveTab(tid);
          if (t) t.w.tabs.move(t.tabId, props.index < 0 ? t.w.tabs.count() - 1 : props.index);
        }
        return undefined;
      }
      case 'tabs.discard': {
        const t = this.resolveTab(Number(args[0]));
        if (!t) throw new Error('Scheda non trovata');
        t.w.tabs.sleepTab(t.tabId);
        const after = this.resolveTabByTabId(t.w, t.tabId);
        return after ? this.tabInfo(l, t.w, after.state, after.index) : undefined;
      }
      case 'tabs.goBack':
      case 'tabs.goForward': {
        const t = args[0] === null || args[0] === undefined ? this.activeOf(this.callerWindow(ctx)) : this.resolveTab(Number(args[0]));
        const wc = t ? t.w.tabs.contents(t.tabId) : undefined;
        if (!wc) throw new Error('Scheda non trovata');
        if (name === 'tabs.goBack') wc.navigationHistory.goBack();
        else wc.navigationHistory.goForward();
        return undefined;
      }
      case 'tabs.captureVisibleTab': {
        const w = (args[0] !== null && args[0] !== undefined && this.deps.windows().find((x) => this.windowId(x) === args[0])) || this.callerWindow(ctx);
        const t = this.activeOf(w);
        const wc = t ? t.w.tabs.contents(t.tabId) : undefined;
        if (!t || !wc) throw new Error('Nessuna pagina visibile');
        if (!this.hostAccess(l, t.state.url) && !this.activeTab.get(id)?.has(wc.id)) throw new Error('Serve l’accesso alla pagina (activeTab o permesso del sito)');
        const img = await wc.capturePage();
        const opts = (args[1] ?? {}) as { format?: string; quality?: number };
        return opts.format === 'jpeg' ? `data:image/jpeg;base64,${img.toJPEG(opts.quality ?? 92).toString('base64')}` : img.toDataURL();
      }
      case 'tabs.detectLanguage': return 'und';

      // ----- windows -----
      case 'windows.get': {
        const wid = Number(args[0]);
        const w = this.deps.windows().find((x) => this.windowId(x) === wid);
        if (w) return this.windowInfo(l, w, Boolean((args[1] as { populate?: boolean })?.populate));
        const p = this.popupWindows.get(wid);
        if (p && !p.win.isDestroyed()) return this.popupWindowInfo(l, wid, p.win, Boolean((args[1] as { populate?: boolean })?.populate));
        throw new Error(`Nessuna finestra con id ${wid}`);
      }
      case 'windows.getCurrent':
      case 'windows.getLastFocused': {
        const populate = Boolean((a0 as { populate?: boolean } | undefined)?.populate);
        const pid = name === 'windows.getCurrent' ? this.callerPopupWindow(ctx) : null;
        if (pid !== null) return this.popupWindowInfo(l, pid, this.popupWindows.get(pid)!.win, populate);
        const w = name === 'windows.getCurrent' ? this.callerWindow(ctx) : this.deps.focused();
        if (!w) throw new Error('Nessuna finestra');
        return this.windowInfo(l, w, populate);
      }
      case 'windows.getAll': {
        const populate = Boolean((a0 as { populate?: boolean } | undefined)?.populate);
        const types = (a0 as { windowTypes?: string[] } | undefined)?.windowTypes;
        const out: chrome.windows.Window[] = this.deps.windows().map((w) => this.windowInfo(l, w, populate));
        if (!types || types.includes('popup')) for (const [pid, p] of this.popupWindows) if (!p.win.isDestroyed()) out.push(this.popupWindowInfo(l, pid, p.win, populate));
        return out;
      }
      case 'windows.create': return this.createWindow(l, (a0 ?? {}) as chrome.windows.CreateData);
      case 'windows.update': {
        const wid = Number(args[0]);
        const info = (args[1] ?? {}) as chrome.windows.UpdateInfo;
        const bw = this.deps.windows().find((x) => this.windowId(x) === wid)?.win ?? this.popupWindows.get(wid)?.win;
        if (!bw || bw.isDestroyed()) throw new Error(`Nessuna finestra con id ${wid}`);
        if (info.left !== undefined || info.top !== undefined || info.width !== undefined || info.height !== undefined) {
          const b = bw.getBounds();
          bw.setBounds({ x: info.left ?? b.x, y: info.top ?? b.y, width: info.width ?? b.width, height: info.height ?? b.height });
        }
        if (info.state === 'minimized') bw.minimize();
        else if (info.state === 'maximized') bw.maximize();
        else if (info.state === 'fullscreen') bw.setFullScreen(true);
        else if (info.state === 'normal') {
          if (bw.isFullScreen()) bw.setFullScreen(false);
          if (bw.isMaximized()) bw.unmaximize();
          if (bw.isMinimized()) bw.restore();
        }
        if (info.focused) bw.focus();
        if (info.drawAttention) bw.flashFrame(true);
        return this.run(l, ctx, 'windows.get', [wid]);
      }
      case 'windows.remove': {
        const wid = Number(args[0]);
        const bw = this.deps.windows().find((x) => this.windowId(x) === wid)?.win ?? this.popupWindows.get(wid)?.win;
        bw?.close();
        return undefined;
      }

      // ----- context menus -----
      case 'contextMenus.create': {
        this.need(l, 'contextMenus');
        const item = { ...(a0 as MenuItem) };
        const items = this.menus.get(id) ?? new Map<string, MenuItem>();
        items.set(String(item.id), item);
        this.menus.set(id, items);
        return undefined;
      }
      case 'contextMenus.update': {
        const item = this.menus.get(id)?.get(String(args[0]));
        if (!item) throw new Error(`Voce di menu ${args[0]} inesistente`);
        Object.assign(item, args[1]);
        return undefined;
      }
      case 'contextMenus.remove': {
        const items = this.menus.get(id);
        const target = String(args[0]);
        items?.delete(target);
        // Children go with their parent.
        for (const [key, item] of items ?? []) if (item.parentId === target) items!.delete(key);
        return undefined;
      }
      case 'contextMenus.removeAll': {
        this.menus.delete(id);
        return undefined;
      }

      // ----- notifications -----
      case 'notifications.create':
      case 'notifications.update': {
        this.need(l, 'notifications');
        const nid = String(args[0] || `ksuite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
        const o = (args[1] ?? {}) as { title?: string; message?: string; contextMessage?: string; iconUrl?: string; silent?: boolean; buttons?: Array<{ title: string }>; requireInteraction?: boolean };
        const key = `${id}:${nid}`;
        this.notifications.get(key)?.close();
        if (!Notification.isSupported()) return nid;
        const icon = o.iconUrl ? this.imageFor(l, o.iconUrl) : undefined;
        const n = new Notification({
          title: o.title ?? l.name,
          body: [o.message, o.contextMessage].filter(Boolean).join('\n'),
          icon,
          silent: Boolean(o.silent),
          actions: (o.buttons ?? []).slice(0, 2).map((b) => ({ type: 'button' as const, text: b.title })),
          timeoutType: o.requireInteraction ? 'never' : 'default',
        });
        n.on('click', () => this.emit(id, 'notifications.onClicked', [nid]));
        n.on('action', (_e, index) => this.emit(id, 'notifications.onButtonClicked', [nid, index]));
        n.on('close', () => {
          this.notifications.delete(key);
          this.emit(id, 'notifications.onClosed', [nid, true]);
        });
        this.notifications.set(key, n);
        n.show();
        return name === 'notifications.update' ? true : nid;
      }
      case 'notifications.clear': {
        const key = `${id}:${args[0]}`;
        const n = this.notifications.get(key);
        n?.close();
        this.notifications.delete(key);
        return Boolean(n);
      }
      case 'notifications.getAll': {
        const out: Record<string, boolean> = {};
        for (const key of this.notifications.keys()) if (key.startsWith(`${id}:`)) out[key.slice(id.length + 1)] = true;
        return out;
      }
      case 'notifications.getPermissionLevel': return 'granted';

      // ----- cookies -----
      case 'cookies.get':
      case 'cookies.getAll':
      case 'cookies.set':
      case 'cookies.remove':
        return this.cookies(l, name, (a0 ?? {}) as Record<string, any>);
      case 'cookies.getAllCookieStores': {
        const tabIds = this.deps.windows().flatMap((w) => w.tabs.ids().map((t) => this.extTabId(w, t)));
        return [{ id: '0', tabIds }];
      }

      // ----- webNavigation -----
      case 'webNavigation.getFrame':
      case 'webNavigation.getAllFrames': {
        this.need(l, 'webNavigation');
        const t = this.resolveTab(Number(a0?.tabId));
        const wc = t ? t.w.tabs.contents(t.tabId) : undefined;
        if (!wc) return name === 'webNavigation.getFrame' ? null : [];
        const frames = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame)];
        const out = frames.map((f) => ({
          frameId: f === wc.mainFrame ? 0 : f.routingId,
          parentFrameId: f === wc.mainFrame ? -1 : f.parent === wc.mainFrame ? 0 : f.parent?.routingId ?? 0,
          url: f.url,
          errorOccurred: false,
        }));
        return name === 'webNavigation.getFrame' ? out.find((f) => f.frameId === Number(a0?.frameId ?? 0)) ?? null : out;
      }

      // ----- permissions -----
      case 'permissions.getAll': return { permissions: [...l.permissions], origins: [...l.hosts, ...l.info.granted.filter((g) => g.includes('://'))] };
      case 'permissions.contains': {
        const req = (a0 ?? {}) as { permissions?: string[]; origins?: string[] };
        return (req.permissions ?? []).every((p) => l.permissions.has(p)) && (req.origins ?? []).every((o) => this.coversOrigin(l, o));
      }
      case 'permissions.request': return this.requestPermissions(l, (a0 ?? {}) as { permissions?: string[]; origins?: string[] });
      case 'permissions.remove': {
        const req = (a0 ?? {}) as { permissions?: string[]; origins?: string[] };
        const list = [...(req.permissions ?? []), ...(req.origins ?? [])].filter((p) => l.info.granted.includes(p));
        if (!list.length) return false;
        this.registry.revoke(id, list);
        for (const p of list) l.permissions.delete(p);
        this.emit(id, 'permissions.onRemoved', [{ permissions: req.permissions ?? [], origins: req.origins ?? [] }]);
        return true;
      }

      // ----- commands, downloads, side panel -----
      case 'commands.getAll':
        return Object.entries(l.manifest.commands ?? {}).map(([cmd, c]) => ({ name: cmd, description: c.description ?? '', shortcut: this.shortcutOf(c.suggested_key) ?? '' }));
      case 'downloads.download': {
        const url = String(a0?.url ?? '');
        if (!/^(https?|data|blob):/i.test(url)) throw new Error('Indirizzo non scaricabile');
        this.deps.session.downloadURL(url);
        return ++this.downloadId;
      }
      case 'sidePanel.setOptions': {
        const s = this.sidePanel.get(id) ?? { openOnAction: false };
        if (a0?.path) s.path = String(a0.path);
        this.sidePanel.set(id, s);
        return undefined;
      }
      case 'sidePanel.getOptions': return { path: this.sidePanel.get(id)?.path, enabled: Boolean(this.sidePanel.get(id)?.path) };
      case 'sidePanel.setPanelBehavior': {
        const s = this.sidePanel.get(id) ?? { openOnAction: false };
        s.openOnAction = Boolean(a0?.openPanelOnActionClick);
        this.sidePanel.set(id, s);
        return undefined;
      }
      case 'sidePanel.getPanelBehavior': return { openPanelOnActionClick: Boolean(this.sidePanel.get(id)?.openOnAction) };
      case 'sidePanel.open': {
        const path = this.sidePanel.get(id)?.path;
        const w = this.deps.focused();
        if (path && w) this.popupFor(w).show(id, `chrome-extension://${id}/${path.replace(/^\//, '')}`, null);
        return undefined;
      }

      // ----- runtime and helpers -----
      case 'runtime.openOptionsPage': {
        this.openOptions(id);
        return undefined;
      }
      case 'extension.isAllowedIncognitoAccess':
      case 'extension.isAllowedFileSchemeAccess':
        return false;
      case 'window.close': {
        if (!ctx.sender) return undefined;
        for (const popup of this.popups.values()) {
          if (popup.contents === ctx.sender) {
            popup.close();
            return undefined;
          }
        }
        const pid = this.callerPopupWindow(ctx);
        if (pid !== null) return this.popupWindows.get(pid)?.win.close();
        for (const w of this.deps.windows()) {
          const tabId = w.tabs.idOf(ctx.sender);
          if (tabId !== null) return w.tabs.close(tabId);
        }
        return undefined;
      }
    }
    throw new Error(`${name} non è supportato in kSuite Browser`);
  }

  private activeOf(w: BrowserWindowController | null): { w: BrowserWindowController; tabId: number; state: TabState; index: number } | null {
    if (!w) return null;
    const states = w.tabs.states();
    const index = states.findIndex((s) => s.active);
    return index === -1 ? null : { w, tabId: states[index].id, state: states[index], index };
  }

  private resolveTabByTabId(w: BrowserWindowController, tabId: number): { state: TabState; index: number } | null {
    const states = w.tabs.states();
    const index = states.findIndex((s) => s.id === tabId);
    return index === -1 ? null : { state: states[index], index };
  }

  private popupWindowOfTab(extTabId: number): { id: number; win: BrowserWindow } | null {
    for (const [id, p] of this.popupWindows) if (!p.win.isDestroyed() && p.win.webContents.id === extTabId) return { id, win: p.win };
    return null;
  }

  private resolveUrl(l: Loaded, url: string | undefined): string {
    if (!url) return 'ksuite://newtab/';
    if (/^[a-z][\w+.-]*:/i.test(url)) {
      if (/^(javascript|file):/i.test(url)) throw new Error('Indirizzo non consentito');
      if (/^chrome-extension:/i.test(url) && !url.startsWith(`chrome-extension://${l.ext.id}/`)) {
        const other = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1];
        if (!other || !this.loaded.has(other)) throw new Error('Indirizzo non consentito');
      }
      if (/^chrome:\/\/newtab/i.test(url)) return 'ksuite://newtab/';
      if (/^chrome:\/\/extensions/i.test(url)) return 'ksuite://extensions/';
      // Of the browser's own pages, extensions may only open the new tab and the extensions page.
      if (/^(ksuite|chrome):/i.test(url) && !/^ksuite:\/\/(newtab|extensions)\//i.test(url)) throw new Error('Indirizzo non consentito');
      return url;
    }
    return new URL(url, `chrome-extension://${l.ext.id}/`).toString();
  }

  private queryTabs(l: Loaded, ctx: CallContext, q: chrome.tabs.QueryInfo): chrome.tabs.Tab[] {
    const current = this.callerWindow(ctx);
    const focused = this.deps.focused();
    const out: chrome.tabs.Tab[] = [];
    const urlPatterns = q.url ? (Array.isArray(q.url) ? q.url : [q.url]) : null;
    const titleRe = q.title ? new RegExp(`^${q.title.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i') : null;
    const popupCaller = this.callerPopupWindow(ctx);
    for (const w of this.deps.windows()) {
      const wid = this.windowId(w);
      if (q.windowId !== undefined && q.windowId !== -2 && q.windowId !== wid) continue;
      if ((q.currentWindow || q.windowId === -2) && (popupCaller !== null || w !== current)) continue;
      if (q.lastFocusedWindow && w !== focused) continue;
      if (q.windowType && q.windowType !== 'normal') continue;
      w.tabs.states().forEach((s, index) => {
        if (q.active !== undefined && q.active !== s.active) return;
        if (q.highlighted !== undefined && q.highlighted !== s.active) return;
        if (q.pinned !== undefined && q.pinned !== s.pinned) return;
        if (q.audible !== undefined && q.audible !== s.audible) return;
        if (q.muted !== undefined && q.muted !== s.muted) return;
        if (q.discarded !== undefined && q.discarded !== s.sleeping) return;
        if (q.index !== undefined && q.index !== index) return;
        if (q.status && q.status !== (s.loading ? 'loading' : s.sleeping ? 'unloaded' : 'complete')) return;
        const tab = this.tabInfo(l, w, s, index);
        if (urlPatterns && (!tab.url || !urlPatterns.some((p) => matchesPattern(p, tab.url!)))) return;
        if (titleRe && (!tab.title || !titleRe.test(tab.title))) return;
        out.push(tab);
      });
    }
    for (const [pid, p] of this.popupWindows) {
      if (p.win.isDestroyed()) continue;
      const matchesWindow = (q.windowId === undefined || q.windowId === pid || (q.windowId === -2 && popupCaller === pid)) && (!q.currentWindow || popupCaller === pid) && (!q.windowType || q.windowType === 'popup');
      if (matchesWindow && (q.lastFocusedWindow ? p.win.isFocused() : true) && q.pinned !== true) out.push(this.popupTab(l, pid, p.win));
    }
    return out;
  }

  private async createWindow(l: Loaded, data: chrome.windows.CreateData): Promise<chrome.windows.Window> {
    const urls = (Array.isArray(data.url) ? data.url : data.url ? [data.url] : []).map((u) => this.resolveUrl(l, u));
    if (data.type === 'popup' || data.type === 'panel') {
      // A small window with just the page (e.g. a password manager's detached popup).
      const win = new BrowserWindow({
        width: data.width ?? 420, height: data.height ?? 600, x: data.left, y: data.top, show: data.focused !== false,
        autoHideMenuBar: true, title: l.name,
        webPreferences: { session: this.deps.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      const wid = win.id;
      this.popupWindows.set(wid, { win, extId: l.ext.id });
      win.webContents.setWindowOpenHandler(({ url }) => {
        this.deps.focused()?.tabs.create(url);
        return { action: 'deny' };
      });
      win.on('focus', () => this.emitAll('windows.onFocusChanged', () => [wid]));
      win.on('closed', () => {
        this.popupWindows.delete(wid);
        this.emitAll('windows.onRemoved', () => [wid]);
      });
      void win.loadURL(urls[0] ?? 'about:blank');
      const info = this.popupWindowInfo(l, wid, win, true);
      this.emitAll('windows.onCreated', (x) => [this.popupWindowInfo(x, wid, win, false)]);
      return info;
    }
    const w = this.deps.openWindow(urls);
    if (data.width || data.height || data.left !== undefined || data.top !== undefined) {
      const b = w.win.getBounds();
      w.win.setBounds({ x: data.left ?? b.x, y: data.top ?? b.y, width: data.width ?? b.width, height: data.height ?? b.height });
    }
    if (data.state === 'maximized') w.win.maximize();
    return this.windowInfo(l, w, true);
  }

  private async cookies(l: Loaded, name: string, d: Record<string, any>): Promise<unknown> {
    this.need(l, 'cookies');
    const store = this.deps.session.cookies;
    const url = typeof d.url === 'string' ? d.url : '';
    if (url && !this.hostAccess(l, url)) throw new Error(`Nessun accesso ai cookie di ${url}`);
    switch (name) {
      case 'cookies.get': {
        const list = await store.get({ url, name: d.name });
        const best = list.sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0))[0];
        return best ? this.cookieOut(best) : null;
      }
      case 'cookies.getAll': {
        const filter: Electron.CookiesGetFilter = {};
        for (const k of ['url', 'name', 'domain', 'path', 'secure', 'session'] as const) if (d[k] !== undefined) (filter as Record<string, unknown>)[k] = d[k];
        const list = await store.get(filter);
        return list.filter((c) => this.hostAccess(l, `https://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`)).map((c) => this.cookieOut(c));
      }
      case 'cookies.set': {
        await store.set({
          url, name: d.name, value: d.value, domain: d.domain, path: d.path, secure: d.secure, httpOnly: d.httpOnly,
          expirationDate: d.expirationDate, sameSite: d.sameSite,
        });
        const list = await store.get({ url, name: d.name });
        return list[0] ? this.cookieOut(list[0]) : null;
      }
      case 'cookies.remove': {
        await store.remove(url, d.name);
        return { url, name: d.name, storeId: '0' };
      }
    }
    return null;
  }

  private cookieOut(c: Electron.Cookie): chrome.cookies.Cookie {
    return {
      name: c.name, value: c.value, domain: c.domain ?? '', hostOnly: Boolean(c.hostOnly), path: c.path ?? '/', secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly), sameSite: (c.sameSite ?? 'unspecified') as chrome.cookies.SameSiteStatus, session: Boolean(c.session),
      expirationDate: c.expirationDate, storeId: '0',
    };
  }

  private coversOrigin(l: Loaded, origin: string): boolean {
    if (l.hosts.includes(origin) || l.info.granted.includes(origin)) return true;
    if (allSites(l.hosts)) return true;
    const sample = origin.replace('*.', 'x.').replace(/\*$/, '').replace('*://', 'https://');
    return this.hostAccess(l, sample);
  }

  private async requestPermissions(l: Loaded, req: { permissions?: string[]; origins?: string[] }): Promise<boolean> {
    const optional = new Set([...(l.manifest.optional_permissions ?? []), ...(l.manifest.optional_host_permissions ?? [])]);
    const wanted = [...(req.permissions ?? []), ...(req.origins ?? [])];
    const missing = wanted.filter((p) => !l.permissions.has(p) && !(p.includes('://') || p === '<all_urls>' ? this.coversOrigin(l, p) : false));
    if (missing.length === 0) return true;
    if (!missing.every((p) => optional.has(p) || [...optional].some((o) => o === '<all_urls>' || (o.includes('://') && p.includes('://'))))) {
      throw new Error('Si possono chiedere solo i permessi opzionali indicati nel manifest');
    }
    const w = this.deps.focused();
    const detail = missing.map((p) => `• ${p === '<all_urls>' ? 'tutti i siti' : p}`).join('\n');
    const options = { type: 'question' as const, buttons: ['Consenti', 'Rifiuta'], defaultId: 0, cancelId: 1, message: `«${l.name}» chiede altri permessi`, detail };
    const { response } = w ? await dialog.showMessageBox(w.win, options) : await dialog.showMessageBox(options);
    if (response !== 0) return false;
    this.registry.grant(l.ext.id, missing);
    for (const p of missing) if (!p.includes('://')) l.permissions.add(p);
    this.emit(l.ext.id, 'permissions.onAdded', [{ permissions: req.permissions ?? [], origins: req.origins ?? [] }]);
    return true;
  }

  private imageFor(l: Loaded, url: string): Electron.NativeImage | undefined {
    if (url.startsWith('data:')) return nativeImage.createFromDataURL(url);
    const relative = url.startsWith(`chrome-extension://${l.ext.id}/`) ? url.slice(`chrome-extension://${l.ext.id}/`.length) : url;
    const file = extensionFile(l.dir, relative);
    return file ? nativeImage.createFromPath(file) : undefined;
  }

  // ---------- Toolbar buttons ----------

  private setAction(id: string, tabId: number | undefined | null, props: Partial<ActionProps>): undefined {
    const state = this.actions.get(id);
    if (!state) return undefined;
    if (typeof tabId === 'number') state.tabs.set(tabId, { ...state.tabs.get(tabId), ...props });
    else Object.assign(state.global, props);
    this.refreshButtons();
    return undefined;
  }

  private getAction(id: string, tabId?: number | null): ActionProps {
    const state = this.actions.get(id);
    if (!state) throw new Error('Estensione non attiva');
    return { ...state.global, ...(typeof tabId === 'number' ? state.tabs.get(tabId) : {}) };
  }

  private buttonsDependOnTab(): boolean {
    for (const a of this.actions.values()) if (a.tabs.size) return true;
    return false;
  }

  /** Buttons of the installed extensions as seen in a window (badges of its active tab). */
  buttons(w: BrowserWindowController): ExtensionButton[] {
    if (w.isPrivate) return [];
    const active = this.activeOf(w);
    const extTab = active ? this.extTabId(w, active.tabId) : null;
    const out: ExtensionButton[] = [];
    for (const l of this.loaded.values()) {
      const a = this.getAction(l.ext.id, extTab);
      out.push({
        id: l.ext.id, name: l.name, title: a.title || l.name, icon: a.icon, badge: a.badgeText, badgeBg: a.badgeBg, badgeColor: a.badgeColor,
        enabled: a.enabled, pinned: l.info.pinned,
      });
    }
    return out.sort((x, y) => x.name.localeCompare(y.name));
  }

  private sendButtons(w: BrowserWindowController): void {
    if (!w.win.isDestroyed()) w.send('ext:buttons', this.buttons(w));
  }

  private refreshScheduled = false;
  refreshButtons(): void {
    if (this.refreshScheduled) return;
    this.refreshScheduled = true;
    setTimeout(() => {
      this.refreshScheduled = false;
      for (const w of this.deps.windows()) this.sendButtons(w);
    }, 30);
  }

  private popupFor(w: BrowserWindowController): ActionPopup {
    let popup = this.popups.get(w);
    if (!popup) {
      popup = new ActionPopup(w, this.deps.session);
      this.popups.set(w, popup);
    }
    return popup;
  }

  /** Click on an extension's toolbar button: its popup, or action.onClicked. */
  clickAction(w: BrowserWindowController, id: string, anchor: Rect | null, force = false): void {
    const l = this.loaded.get(id);
    const active = this.activeOf(w);
    if (!l || w.isPrivate) return;
    const popup = this.popupFor(w);
    if (!force && (popup.extId === id || (popup.justClosed() && popup.extId === null && this.lastPopupExt === id))) {
      popup.close();
      return;
    }
    const extTab = active ? this.extTabId(w, active.tabId) : null;
    const props = this.getAction(id, extTab);
    if (!props.enabled) return;
    if (extTab !== null) {
      // The user invoked the extension on this tab: it may act on it (activeTab).
      const set = this.activeTab.get(id) ?? new Set<number>();
      set.add(extTab);
      this.activeTab.set(id, set);
    }
    this.lastPopupExt = id;
    const side = this.sidePanel.get(id);
    if (props.popup) {
      popup.show(id, `chrome-extension://${id}/${props.popup.replace(/^\//, '')}`, anchor);
    } else if (side?.path && (side.openOnAction || !this.workerEvents.get(id)?.has('action.onClicked'))) {
      popup.show(id, `chrome-extension://${id}/${side.path.replace(/^\//, '')}`, anchor);
    } else if (active) {
      this.emit(id, 'action.onClicked', [this.tabInfo(l, w, active.state, active.index)]);
    }
  }
  private lastPopupExt: string | null = null;

  /** Right click on an extension's button. */
  actionMenu(w: BrowserWindowController, id: string, manage: (id: string) => void, remove: (id: string) => void): void {
    const l = this.loaded.get(id);
    if (!l) return;
    const items: MenuItemConstructorOptions[] = [{ label: l.name, enabled: false }, { type: 'separator' }];
    const actionItems = this.menuItemsFor(l, ['action', 'browser_action', 'page_action', 'all'], w, null);
    if (actionItems.length) items.push(...actionItems, { type: 'separator' });
    if (l.manifest.options_ui?.page || l.manifest.options_page) items.push({ label: 'Opzioni', click: () => this.openOptions(id) });
    items.push(
      { label: l.info.pinned ? 'Togli dalla barra' : 'Fissa sulla barra', click: () => this.registry.setPinned(id, !l.info.pinned) },
      { label: 'Gestisci l’estensione', click: () => manage(id) },
      { label: 'Rimuovi da kSuite Browser…', click: () => remove(id) },
    );
    Menu.buildFromTemplate(items).popup({ window: w.win });
  }

  openOptions(id: string): void {
    const l = this.loaded.get(id);
    const page = l?.manifest.options_ui?.page ?? l?.manifest.options_page;
    const w = this.deps.focused() ?? this.deps.openWindow([]);
    if (!l || !page) return;
    const url = `chrome-extension://${id}/${page.replace(/^\//, '')}`;
    const existing = w.tabs.states().find((s) => s.url.split('#')[0] === url);
    if (existing) w.tabs.activate(existing.id);
    else w.tabs.activate(w.tabs.create(url));
    w.focus();
  }

  // ---------- Context menu items ----------

  /** Items the extensions add to a page's context menu. */
  contextItems(contents: WebContents, params: Electron.ContextMenuParams): MenuItemConstructorOptions[] {
    if (this.loaded.size === 0) return [];
    const contexts = ['all'];
    if (params.linkURL) contexts.push('link');
    if (params.selectionText) contexts.push('selection');
    if (params.isEditable) contexts.push('editable');
    if (params.mediaType === 'image' || params.mediaType === 'video' || params.mediaType === 'audio') contexts.push(params.mediaType);
    if (params.frame && params.frame !== contents.mainFrame) contexts.push('frame');
    if (contexts.length === 1 || (contexts.length === 2 && contexts[1] === 'frame')) contexts.push('page');
    const w = this.deps.windows().find((x) => x.tabs.idOf(contents) !== null) ?? null;
    const out: MenuItemConstructorOptions[] = [];
    for (const l of this.loaded.values()) {
      const items = this.menuItemsFor(l, contexts, w, { contents, params });
      if (items.length === 0) continue;
      const icon = this.actions.get(l.ext.id)?.global.icon;
      const image = icon ? nativeImage.createFromDataURL(icon).resize({ width: 16, height: 16 }) : undefined;
      if (items.length === 1) out.push({ ...items[0], icon: image });
      else out.push({ label: l.name, icon: image, submenu: items });
    }
    return out;
  }

  private menuItemsFor(l: Loaded, contexts: string[], w: BrowserWindowController | null, page: { contents: WebContents; params: Electron.ContextMenuParams } | null): MenuItemConstructorOptions[] {
    const all = [...(this.menus.get(l.ext.id)?.values() ?? [])];
    const pageUrl = page ? page.params.pageURL || page.contents.getURL() : '';
    const selection = page?.params.selectionText ?? '';
    const shows = (item: MenuItem) => {
      if (item.visible === false) return false;
      const ctx = item.contexts ?? ['page'];
      if (!ctx.some((c) => contexts.includes(c) || (c === 'all' && !contexts.some((x) => ['action', 'browser_action', 'page_action'].includes(x))))) return false;
      if (page && item.documentUrlPatterns?.length && !matchesAny(item.documentUrlPatterns, pageUrl)) return false;
      const target = page?.params.linkURL || page?.params.srcURL;
      if (page && item.targetUrlPatterns?.length && (!target || !matchesAny(item.targetUrlPatterns, target))) return false;
      return true;
    };
    const build = (parentId: string | undefined): MenuItemConstructorOptions[] =>
      all.filter((i) => i.parentId === parentId && shows(i)).map((item) => {
        if (item.type === 'separator') return { type: 'separator' as const };
        const children = build(item.id);
        const label = (item.title ?? '').replace(/%s/g, selection.length > 32 ? `${selection.slice(0, 32)}…` : selection);
        if (children.length) return { label, enabled: item.enabled !== false, submenu: children };
        return {
          label,
          type: item.type === 'checkbox' ? 'checkbox' as const : item.type === 'radio' ? 'radio' as const : 'normal' as const,
          checked: item.checked,
          enabled: item.enabled !== false,
          click: () => {
            const wasChecked = Boolean(item.checked);
            if (item.type === 'checkbox') item.checked = !wasChecked;
            if (item.type === 'radio') {
              for (const other of all) if (other.type === 'radio' && other.parentId === item.parentId) other.checked = other === item;
            }
            const target = page ? this.deps.windows().find((x) => x.tabs.idOf(page.contents) !== null) : w;
            const active = target ? this.activeOf(target) : null;
            const tabInfo = page && target ? (() => {
              const tabId = target.tabs.idOf(page.contents)!;
              const r = this.resolveTabByTabId(target, tabId);
              return r ? this.tabInfo(l, target, r.state, r.index) : undefined;
            })() : active ? this.tabInfo(l, active.w, active.state, active.index) : undefined;
            if (tabInfo?.id !== undefined) {
              const set = this.activeTab.get(l.ext.id) ?? new Set<number>();
              set.add(tabInfo.id);
              this.activeTab.set(l.ext.id, set);
            }
            const p = page?.params;
            this.emit(l.ext.id, 'contextMenus.onClicked', [{
              menuItemId: item.id, parentMenuItemId: item.parentId, editable: Boolean(p?.isEditable), pageUrl: pageUrl || undefined,
              frameUrl: p?.frameURL || undefined, linkUrl: p?.linkURL || undefined, srcUrl: p?.srcURL || undefined,
              mediaType: p && p.mediaType !== 'none' ? p.mediaType : undefined, selectionText: selection || undefined,
              ...(item.type === 'checkbox' || item.type === 'radio' ? { wasChecked, checked: item.checked } : {}),
            }, tabInfo]);
          },
        };
      });
    return build(undefined);
  }

  // ---------- Keyboard shortcuts (manifest "commands") ----------

  private shortcutOf(key: Record<string, string> | string | undefined): string | null {
    if (!key) return null;
    if (typeof key === 'string') return key;
    const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'default';
    return key[platform] ?? key.default ?? null;
  }

  /** Returns true when a key press was an extension's shortcut. */
  handleShortcut(input: Electron.Input): boolean {
    if (input.type !== 'keyDown' || this.loaded.size === 0) return false;
    for (const l of this.loaded.values()) {
      for (const [cmd, c] of Object.entries(l.manifest.commands ?? {})) {
        const shortcut = this.shortcutOf(c.suggested_key);
        if (!shortcut || !matchesShortcut(shortcut, input)) continue;
        const w = this.deps.focused();
        if (!w) return false;
        if (cmd === '_execute_action' || cmd === '_execute_browser_action' || cmd === '_execute_page_action') {
          this.clickAction(w, l.ext.id, null, true);
        } else {
          const active = this.activeOf(w);
          this.emit(l.ext.id, 'commands.onCommand', [cmd, active ? this.tabInfo(l, w, active.state, active.index) : undefined]);
        }
        return true;
      }
    }
    return false;
  }

  /** Confirmation shown before installing (or updating with new permissions). */
  async confirmInstall(w: BrowserWindowController | null, p: InstallPreview): Promise<boolean> {
    const lines = p.permissions.warnings.length ? `Potrà:\n${p.permissions.warnings.map((x) => `• ${x}`).join('\n')}` : 'Non chiede permessi particolari.';
    const missing = p.permissions.unsupported.length ? `\n\nNon disponibile in kSuite Browser (alcune funzioni potrebbero non andare): ${p.permissions.unsupported.join(', ')}.` : '';
    const options = {
      type: 'question' as const,
      buttons: [p.update ? 'Aggiorna' : 'Aggiungi estensione', 'Annulla'],
      defaultId: 0,
      cancelId: 1,
      message: p.update ? `Aggiornare «${p.name}» alla versione ${p.version}?` : `Aggiungere «${p.name}»?`,
      detail: `${lines}${missing}`,
      icon: p.icon ? nativeImage.createFromDataURL(p.icon) : undefined,
    };
    const { response } = w ? await dialog.showMessageBox(w.win, options) : await dialog.showMessageBox(options);
    return response === 0;
  }

  /** Installs from the store with the usual confirmation, reporting errors as messages. */
  async installFromStore(w: BrowserWindowController | null, input: string): Promise<{ ok: boolean; id?: string; error?: string }> {
    try {
      const item = await this.registry.installFromStore(input, (p) => this.confirmInstall(w, p));
      if (item) this.deps.firstInstall();
      return item ? { ok: true, id: item.id } : { ok: false };
    } catch (err) {
      return { ok: false, error: err instanceof InstallError || err instanceof Error ? err.message : String(err) };
    }
  }
}

/** "Ctrl+Shift+Y", "Alt+Shift+L", "MacCtrl+K", "Command+Shift+1" against a key press. */
export function matchesShortcut(shortcut: string, input: { key: string; control: boolean; meta: boolean; alt: boolean; shift: boolean }): boolean {
  const parts = shortcut.split('+').map((p) => p.trim());
  const key = parts.pop()?.toLowerCase() ?? '';
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const mac = process.platform === 'darwin';
  const wantCtrl = mods.has('macctrl') || (!mac && mods.has('ctrl'));
  const wantMeta = mods.has('command') || (mac && mods.has('ctrl'));
  if (wantCtrl !== input.control || wantMeta !== input.meta || mods.has('alt') !== input.alt || mods.has('shift') !== input.shift) return false;
  const names: Record<string, string> = { comma: ',', period: '.', space: ' ', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', ins: 'insert', del: 'delete', pageup: 'pageup', pagedown: 'pagedown' };
  const pressed = input.key.toLowerCase();
  return pressed === (names[key] ?? key);
}
