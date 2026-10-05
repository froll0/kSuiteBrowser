import { contextBridge, ipcRenderer } from 'electron';
import type { Suggestion } from '../shared/types';

// Interface language, before the page's scripts run (see shared/i18n.ts).
contextBridge.exposeInMainWorld('veloLocale', ipcRenderer.sendSync('i18n:locale') as string);

contextBridge.exposeInMainWorld('suggest', {
  onItems: (fn: (data: { items: Suggestion[]; selected: number; look: unknown }) => void) =>
    ipcRenderer.on('suggest:items', (_e, data) => fn(data)),
  choose: (index: number) => ipcRenderer.send('suggest:choose', index),
});
