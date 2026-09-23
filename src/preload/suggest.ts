import { contextBridge, ipcRenderer } from 'electron';
import type { Suggestion } from '../shared/types';

contextBridge.exposeInMainWorld('suggest', {
  onItems: (fn: (data: { items: Suggestion[]; selected: number; theme: string }) => void) =>
    ipcRenderer.on('suggest:items', (_e, data) => fn(data)),
  choose: (index: number) => ipcRenderer.send('suggest:choose', index),
});
