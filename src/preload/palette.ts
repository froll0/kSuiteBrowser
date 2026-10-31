import { contextBridge, ipcRenderer } from 'electron';
import type { PaletteChoice, PaletteData } from '../shared/types';

// Interface language, before the page's scripts run (see shared/i18n.ts).
contextBridge.exposeInMainWorld('veloLocale', ipcRenderer.sendSync('i18n:locale') as string);

contextBridge.exposeInMainWorld('palette', {
  onData: (fn: (data: PaletteData) => void) => ipcRenderer.on('palette:data', (_e, data) => fn(data)),
  choose: (choice: PaletteChoice) => ipcRenderer.send('palette:choose', choice),
  dismiss: () => ipcRenderer.send('palette:dismiss'),
});
