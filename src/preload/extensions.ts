/**
 * Runs in every frame and service worker of the default session, but only does something in
 * extension contexts (chrome-extension://): it completes the chrome.* API that Electron doesn't
 * implement (toolbar button, tabs and windows, context menus, notifications, cookies…) by forwarding
 * the calls to the browser (src/main/extensions/host.ts), and delivers the browser's events.
 */
import { contextBridge, ipcRenderer } from 'electron';

// In a frame the check is cheap; service worker preloads have no `location`, the main world checks.
const inFrame = typeof (globalThis as { location?: Location }).location !== 'undefined';
const isExtension = !inFrame || (globalThis as { location?: Location }).location?.protocol === 'chrome-extension:';

if (isExtension) {
  const bridge = {
    /** Calls the browser; retries briefly while a just-started service worker is being connected. */
    invoke: async (name: string, args: unknown[]): Promise<unknown> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await ipcRenderer.invoke('crx:call', name, args);
        } catch (err) {
          if (attempt < 40 && /No handler registered/.test(String(err))) {
            await new Promise((r) => setTimeout(r, 25));
            continue;
          }
          return { error: err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err) };
        }
      }
    },
    listen: (fn: (name: string, args: unknown[]) => void) => {
      ipcRenderer.on('crx:event', (_e, name: string, args: unknown[]) => fn(name, args));
    },
  };
  try {
    contextBridge.executeInMainWorld({ func: installShims, args: [bridge] });
  } catch (err) {
    console.error('[kSuite] estensione: API non disponibili', err);
  }
}

type Bridge = { invoke(name: string, args: unknown[]): Promise<unknown>; listen(fn: (name: string, args: unknown[]) => void): void };

/**
 * Executed in the extension's own world. It is serialized: it may not use anything from outside
 * its body (imports, module variables, TypeScript helpers).
 */
function installShims(bridge: Bridge): void {
  const g = globalThis as unknown as { chrome?: Record<string, any>; location: Location; close?: () => void };
  if (g.location.protocol !== 'chrome-extension:' || !g.chrome || g.chrome.__ksuite) return;
  const chrome = g.chrome;
  Object.defineProperty(chrome, '__ksuite', { value: true });

  // ---------- Events ----------
  const listeners = new Map<string, Set<(...a: unknown[]) => unknown>>();
  const subscribed = new Set<string>();
  const subscribe = (name: string) => {
    if (subscribed.has(name)) return;
    subscribed.add(name);
    void bridge.invoke('subscribe', [name]);
  };
  const localClicks = new Map<string, (...a: unknown[]) => void>();
  bridge.listen((name, args) => {
    if (name === 'contextMenus.onClicked') {
      const info = args[0] as { menuItemId?: string };
      const own = info && localClicks.get(String(info.menuItemId));
      if (own) {
        try {
          own(...args);
        } catch (e) {
          console.error(e);
        }
      }
    }
    for (const l of [...(listeners.get(name) ?? [])]) {
      try {
        l(...args);
      } catch (e) {
        console.error(e);
      }
    }
  });
  const event = (name: string) => ({
    addListener(fn: (...a: unknown[]) => unknown) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(fn);
      subscribe(name);
    },
    removeListener(fn: (...a: unknown[]) => unknown) {
      listeners.get(name)?.delete(fn);
    },
    hasListener(fn: (...a: unknown[]) => unknown) {
      return Boolean(listeners.get(name)?.has(fn));
    },
    hasListeners() {
      return (listeners.get(name)?.size ?? 0) > 0;
    },
    addRules() {},
    getRules() {},
    removeRules() {},
  });

  // ---------- Calls: promise, or callback as last argument ----------
  const call = (name: string, prepare?: (args: unknown[]) => unknown[] | Promise<unknown[]>) =>
    function (...args: unknown[]) {
      const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as (v?: unknown) => void) : null;
      const p = Promise.resolve(prepare ? prepare(args) : args)
        .then((a) => bridge.invoke(name, a))
        .then((res) => {
          const r = res as { error?: string; value?: unknown } | undefined;
          if (r && r.error) throw new Error(r.error);
          return r ? r.value : undefined;
        });
      if (cb) {
        p.then(
          (v) => cb(v),
          (e) => {
            console.error(`${name}: ${e.message}`);
            cb(undefined);
          },
        );
        return undefined;
      }
      return p;
    };
  const define = (key: string, value: unknown) => {
    try {
      Object.defineProperty(chrome, key, { value, configurable: true, writable: true, enumerable: true });
    } catch {
      /* read-only in this context */
    }
  };
  const patch = (target: Record<string, unknown>, values: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(values)) {
      try {
        target[k] = v;
      } catch {
        try {
          Object.defineProperty(target, k, { value: v, configurable: true, writable: true });
        } catch {
          /* keep the native one */
        }
      }
    }
  };

  // Images (ImageData, blob: URLs) become data: URLs the browser can show.
  const bytesToDataUrl = (bytes: Uint8Array, type: string) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return `data:${type};base64,${btoa(bin)}`;
  };
  const imageToUrl = async (img: { width: number; height: number; data: Uint8ClampedArray }) => {
    const canvas = new OffscreenCanvas(img.width, img.height);
    const data = img instanceof ImageData ? img : new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    canvas.getContext('2d')!.putImageData(data, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), 'image/png');
  };
  const blobUrlToData = async (url: string) => {
    if (!/^blob:/.test(url)) return url;
    const blob = await (await fetch(url)).blob();
    return bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/png');
  };

  // ---------- action (and browserAction/pageAction of Manifest V2) ----------
  const tabArg = (args: unknown[]) => [typeof args[0] === 'number' ? args[0] : null];
  const action = {
    setTitle: call('action.setTitle'),
    getTitle: call('action.getTitle'),
    setBadgeText: call('action.setBadgeText'),
    getBadgeText: call('action.getBadgeText'),
    setBadgeBackgroundColor: call('action.setBadgeBackgroundColor'),
    getBadgeBackgroundColor: call('action.getBadgeBackgroundColor'),
    setBadgeTextColor: call('action.setBadgeTextColor'),
    getBadgeTextColor: call('action.getBadgeTextColor'),
    setPopup: call('action.setPopup'),
    getPopup: call('action.getPopup'),
    enable: call('action.enable', tabArg),
    disable: call('action.disable', tabArg),
    isEnabled: call('action.isEnabled', tabArg),
    openPopup: call('action.openPopup'),
    getUserSettings: call('action.getUserSettings'),
    setIcon: call('action.setIcon', async (args) => {
      const d = { ...((args[0] as Record<string, unknown>) ?? {}) };
      const img = d.imageData as Record<string, unknown> | undefined;
      if (img) {
        if (typeof (img as { width?: unknown }).width === 'number') {
          d.imageData = { [String((img as { width: number }).width)]: await imageToUrl(img as never) };
        } else {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(img)) out[k] = await imageToUrl(v as never);
          d.imageData = out;
        }
      }
      return [d];
    }),
    onClicked: event('action.onClicked'),
  };
  const manifest = (chrome.runtime?.getManifest?.() ?? {}) as { manifest_version?: number; browser_action?: unknown; page_action?: unknown };
  define('action', action);
  if (manifest.manifest_version === 2 || manifest.browser_action) define('browserAction', action);
  if (manifest.page_action) define('pageAction', { ...action, show: action.enable, hide: action.disable });

  // ---------- tabs (sendMessage, connect and zoom stay native) ----------
  const tabs = (chrome.tabs ?? {}) as Record<string, unknown>;
  const scripting = chrome.scripting as { executeScript?: (d: unknown) => Promise<Array<{ result: unknown }>>; insertCSS?: (d: unknown) => Promise<void> } | undefined;
  const activeTabId = async () => ((await bridge.invoke('tabs.query', [{ active: true, lastFocusedWindow: true }])) as { value?: Array<{ id: number }> }).value?.[0]?.id;
  patch(tabs, {
    TAB_ID_NONE: -1,
    query: call('tabs.query'),
    get: call('tabs.get'),
    getCurrent: call('tabs.getCurrent'),
    create: call('tabs.create'),
    update: call('tabs.update', (args) => (typeof args[0] === 'number' ? args : [null, args[0]])),
    remove: call('tabs.remove'),
    reload: call('tabs.reload', (args) => (typeof args[0] === 'number' ? args : [null, args[0]])),
    duplicate: call('tabs.duplicate'),
    highlight: call('tabs.highlight'),
    move: call('tabs.move'),
    discard: call('tabs.discard'),
    goBack: call('tabs.goBack'),
    goForward: call('tabs.goForward'),
    captureVisibleTab: call('tabs.captureVisibleTab', (args) => (typeof args[0] === 'number' || args[0] === null ? args : [null, args[0]])),
    detectLanguage: call('tabs.detectLanguage'),
    // Manifest V2 script injection, through chrome.scripting.
    executeScript: async (...args: unknown[]) => {
      const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as (v: unknown) => void) : null;
      const tabId = typeof args[0] === 'number' ? (args.shift() as number) : await activeTabId();
      const details = (args[0] ?? {}) as { file?: string; code?: string; allFrames?: boolean };
      let result: unknown[] = [];
      if (details.file && scripting?.executeScript) {
        result = (await scripting.executeScript({ target: { tabId, allFrames: Boolean(details.allFrames) }, files: [details.file] })).map((r) => r.result);
      } else if (details.code) {
        console.error('tabs.executeScript con "code" non è supportato: usa un file.');
      }
      if (cb) cb(result);
      return result;
    },
    insertCSS: async (...args: unknown[]) => {
      const cb = typeof args[args.length - 1] === 'function' ? (args.pop() as () => void) : null;
      const tabId = typeof args[0] === 'number' ? (args.shift() as number) : await activeTabId();
      const details = (args[0] ?? {}) as { file?: string; code?: string; allFrames?: boolean };
      await scripting?.insertCSS?.({ target: { tabId, allFrames: Boolean(details.allFrames) }, ...(details.file ? { files: [details.file] } : { css: details.code ?? '' }) });
      if (cb) cb();
    },
    onCreated: event('tabs.onCreated'),
    onUpdated: event('tabs.onUpdated'),
    onActivated: event('tabs.onActivated'),
    onActiveChanged: event('tabs.onActiveChanged'),
    onSelectionChanged: event('tabs.onActiveChanged'),
    onHighlighted: event('tabs.onHighlighted'),
    onRemoved: event('tabs.onRemoved'),
    onMoved: event('tabs.onMoved'),
    onReplaced: event('tabs.onReplaced'),
    onAttached: event('tabs.onAttached'),
    onDetached: event('tabs.onDetached'),
  });
  if (!chrome.tabs) define('tabs', tabs);

  // ---------- windows ----------
  define('windows', {
    WINDOW_ID_NONE: -1,
    WINDOW_ID_CURRENT: -2,
    get: call('windows.get'),
    getCurrent: call('windows.getCurrent'),
    getLastFocused: call('windows.getLastFocused'),
    getAll: call('windows.getAll'),
    create: call('windows.create'),
    update: call('windows.update'),
    remove: call('windows.remove'),
    onCreated: event('windows.onCreated'),
    onRemoved: event('windows.onRemoved'),
    onFocusChanged: event('windows.onFocusChanged'),
    onBoundsChanged: event('windows.onBoundsChanged'),
  });

  // ---------- contextMenus / menus ----------
  const menus = {
    ACTION_MENU_TOP_LEVEL_LIMIT: 6,
    create(props: Record<string, unknown>, cb?: () => void) {
      const { onclick, ...rest } = props ?? {};
      const id = String(rest.id ?? `ksuite-${Math.random().toString(36).slice(2)}`);
      if (typeof onclick === 'function') {
        localClicks.set(id, onclick as (...a: unknown[]) => void);
        subscribe('contextMenus.onClicked');
      }
      void bridge.invoke('contextMenus.create', [{ ...rest, id }]).then(() => cb?.());
      return rest.id ?? id;
    },
    update: call('contextMenus.update', (args) => {
      const [id, props] = args as [string, Record<string, unknown>];
      const { onclick, ...rest } = props ?? {};
      if (typeof onclick === 'function') localClicks.set(String(id), onclick as (...a: unknown[]) => void);
      return [id, rest];
    }),
    remove: call('contextMenus.remove'),
    removeAll: call('contextMenus.removeAll'),
    onClicked: event('contextMenus.onClicked'),
  };
  define('contextMenus', menus);
  define('menus', menus);

  // ---------- notifications ----------
  define('notifications', {
    create: call('notifications.create', async (args) => {
      const id = typeof args[0] === 'string' ? (args[0] as string) : '';
      const options = { ...((typeof args[0] === 'string' ? args[1] : args[0]) as Record<string, unknown>) };
      if (typeof options.iconUrl === 'string') options.iconUrl = await blobUrlToData(options.iconUrl);
      if (typeof options.imageUrl === 'string') options.imageUrl = await blobUrlToData(options.imageUrl);
      return [id, options];
    }),
    update: call('notifications.update'),
    clear: call('notifications.clear'),
    getAll: call('notifications.getAll'),
    getPermissionLevel: call('notifications.getPermissionLevel'),
    onClicked: event('notifications.onClicked'),
    onClosed: event('notifications.onClosed'),
    onButtonClicked: event('notifications.onButtonClicked'),
    onShowSettings: event('notifications.onShowSettings'),
  });

  // ---------- cookies ----------
  define('cookies', {
    get: call('cookies.get'),
    getAll: call('cookies.getAll'),
    set: call('cookies.set'),
    remove: call('cookies.remove'),
    getAllCookieStores: call('cookies.getAllCookieStores'),
    onChanged: event('cookies.onChanged'),
  });

  // ---------- webNavigation ----------
  define('webNavigation', {
    getFrame: call('webNavigation.getFrame'),
    getAllFrames: call('webNavigation.getAllFrames'),
    onBeforeNavigate: event('webNavigation.onBeforeNavigate'),
    onCommitted: event('webNavigation.onCommitted'),
    onDOMContentLoaded: event('webNavigation.onDOMContentLoaded'),
    onCompleted: event('webNavigation.onCompleted'),
    onErrorOccurred: event('webNavigation.onErrorOccurred'),
    onCreatedNavigationTarget: event('webNavigation.onCreatedNavigationTarget'),
    onReferenceFragmentUpdated: event('webNavigation.onReferenceFragmentUpdated'),
    onHistoryStateUpdated: event('webNavigation.onHistoryStateUpdated'),
    onTabReplaced: event('webNavigation.onTabReplaced'),
  });

  // ---------- permissions, commands, downloads, side panel ----------
  define('permissions', {
    contains: call('permissions.contains'),
    getAll: call('permissions.getAll'),
    request: call('permissions.request'),
    remove: call('permissions.remove'),
    onAdded: event('permissions.onAdded'),
    onRemoved: event('permissions.onRemoved'),
  });
  define('commands', { getAll: call('commands.getAll'), onCommand: event('commands.onCommand') });
  define('downloads', { download: call('downloads.download'), onChanged: event('downloads.onChanged'), onCreated: event('downloads.onCreated') });
  define('sidePanel', {
    setOptions: call('sidePanel.setOptions'),
    getOptions: call('sidePanel.getOptions'),
    setPanelBehavior: call('sidePanel.setPanelBehavior'),
    getPanelBehavior: call('sidePanel.getPanelBehavior'),
    open: call('sidePanel.open'),
  });

  // ---------- runtime and extension helpers ----------
  // Electron never fires onInstalled/onStartup: the browser does (once the worker listens).
  if (chrome.runtime) {
    patch(chrome.runtime as Record<string, unknown>, {
      openOptionsPage: call('runtime.openOptionsPage'),
      onInstalled: event('runtime.onInstalled'),
      onStartup: event('runtime.onStartup'),
    });
  }
  const ext = (chrome.extension ?? {}) as Record<string, unknown>;
  patch(ext, {
    getURL: (path: string) => chrome.runtime.getURL(path),
    isAllowedIncognitoAccess: call('extension.isAllowedIncognitoAccess'),
    isAllowedFileSchemeAccess: call('extension.isAllowedFileSchemeAccess'),
  });
  if (!chrome.extension) define('extension', ext);

  // window.close() in a popup, an options tab or a popup window closes it.
  if (typeof g.close === 'function') g.close = () => void bridge.invoke('window.close', []);
  // A service worker tells the browser its API is complete (see ExtensionHost.checkWorker).
  else void bridge.invoke('ready', ['worker']);
  // A Manifest V2 background page is where onInstalled/onStartup go.
  const bg = (chrome.runtime?.getManifest?.() as { background?: { page?: string; scripts?: string[] } } | undefined)?.background;
  if (typeof g.close === 'function' && bg && (bg.page || bg.scripts) && /\/(_generated_background_page\.html|[^/]*background[^/]*\.html)$/.test(g.location.pathname)) {
    void bridge.invoke('ready', ['background']);
  }
}
