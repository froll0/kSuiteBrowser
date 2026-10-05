import { contextBridge, ipcRenderer } from 'electron';
import type { TabSearchData } from '../shared/types';

// Interface language, before the page's scripts run (see shared/i18n.ts).
contextBridge.exposeInMainWorld('veloLocale', ipcRenderer.sendSync('i18n:locale') as string);

contextBridge.exposeInMainWorld('tabSearch', {
  onData: (fn: (data: TabSearchData) => void) => ipcRenderer.on('tabsearch:data', (_e, data) => fn(data)),
  choose: (tabId: number) => ipcRenderer.send('tabsearch:choose', tabId),
  close: (tabId: number) => ipcRenderer.send('tabsearch:close', tabId),
  reopen: (index: number) => ipcRenderer.send('tabsearch:reopen', index),
  open: (url: string) => ipcRenderer.send('tabsearch:open', url),
  dismiss: () => ipcRenderer.send('tabsearch:dismiss'),
});
