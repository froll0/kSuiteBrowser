import { contextBridge, ipcRenderer } from 'electron';
import type { MainMenuData } from '../shared/types';

// Interface language, before the page's scripts run (see shared/i18n.ts).
contextBridge.exposeInMainWorld('veloLocale', ipcRenderer.sendSync('i18n:locale') as string);

contextBridge.exposeInMainWorld('mainMenu', {
  onData: (fn: (data: MainMenuData) => void) => ipcRenderer.on('mainmenu:data', (_e, data) => fn(data)),
  /** Runs a command; `keepOpen` for zoom buttons. */
  run: (id: string, keepOpen = false) => ipcRenderer.send('mainmenu:run', id, keepOpen),
  resize: (width: number, height: number) => ipcRenderer.send('mainmenu:resize', width, height),
  dismiss: () => ipcRenderer.send('mainmenu:dismiss'),
});
