import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload of every tab. Normal web pages get nothing; only the browser's own internal pages
 * (ksuite://settings, ksuite://https-only), in the top frame, get a narrow bridge.
 * The main process checks the sender URL again for every call.
 */
if (window.location.protocol === 'ksuite:' && window === window.top) {
  contextBridge.exposeInMainWorld('ksuiteInternal', {
    invoke: (channel: string, ...args: unknown[]) =>
      channel.startsWith('internal:') ? ipcRenderer.invoke(channel, ...args) : Promise.reject(new Error('Canale non consentito')),
    onSettings: (listener: (settings: unknown) => void) => {
      const wrapped = (_e: unknown, settings: unknown) => listener(settings);
      ipcRenderer.on('internal:ev:settings', wrapped);
      return () => ipcRenderer.removeListener('internal:ev:settings', wrapped);
    },
  });
}
