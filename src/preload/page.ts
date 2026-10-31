import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload of every tab. Normal web pages get nothing; only the browser's own internal pages
 * (velo://settings, velo://https-only), in the top frame, get a narrow bridge.
 * The main process checks the sender URL again for every call.
 */
if (window.location.protocol === 'velo:' && window === window.top) {
  // Interface language, before the page's scripts run (see shared/i18n.ts). Never given to web pages.
  contextBridge.exposeInMainWorld('veloLocale', ipcRenderer.sendSync('i18n:locale') as string);
  contextBridge.exposeInMainWorld('veloInternal', {
    invoke: (channel: string, ...args: unknown[]) =>
      channel.startsWith('internal:') ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('Canale non consentito')),
    onSettings: (listener: (settings: unknown) => void) => {
      const wrapped = (_e: unknown, settings: unknown) => listener(settings);
      ipcRenderer.on('internal:ev:settings', wrapped);
      return () => ipcRenderer.removeListener('internal:ev:settings', wrapped);
    },
    onUpdate: (listener: (status: unknown) => void) => {
      const wrapped = (_e: unknown, status: unknown) => listener(status);
      ipcRenderer.on('internal:ev:update', wrapped);
      return () => ipcRenderer.removeListener('internal:ev:update', wrapped);
    },
    onAi: (listener: (event: unknown) => void) => {
      const wrapped = (_e: unknown, event: unknown) => listener(event);
      ipcRenderer.on('internal:ev:ai', wrapped);
      return () => ipcRenderer.removeListener('internal:ev:ai', wrapped);
    },
    onSync: (listener: (status: unknown) => void) => {
      const wrapped = (_e: unknown, status: unknown) => listener(status);
      ipcRenderer.on('internal:ev:sync', wrapped);
      return () => ipcRenderer.removeListener('internal:ev:sync', wrapped);
    },
    onBookmarks: (listener: (list: unknown) => void) => {
      const wrapped = (_e: unknown, list: unknown) => listener(list);
      ipcRenderer.on('internal:ev:bookmarks', wrapped);
      return () => ipcRenderer.removeListener('internal:ev:bookmarks', wrapped);
    },
  });
}

// Scroll direction of the page (only up or down, only when it changes), for the auto-hiding bar that
// comes back when scrolling up. The main process ignores it unless that option is on.
if (window === window.top) {
  let last: boolean | null = null;
  let lastAt = 0;
  window.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) < 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const up = e.deltaY < 0;
    const now = Date.now();
    if (up === last && now - lastAt < 1500) return;
    last = up;
    lastAt = now;
    ipcRenderer.send('page:scroll-direction', up);
  }, { passive: true, capture: true });
}
