import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface AppMenuActions {
  newTab(): void;
  closeTab(): void;
  focusAddress(): void;
  reload(): void;
  back(): void;
  forward(): void;
  nextTab(): void;
  previousTab(): void;
  togglePanel(): void;
  savePageToDrive(): void;
  mailPage(): void;
  openSettings(): void;
  devTools(): void;
}

export function buildAppMenu(a: AppMenuActions): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Nuova scheda', accelerator: 'CmdOrCtrl+T', click: a.newTab },
        { label: 'Chiudi scheda', accelerator: 'CmdOrCtrl+W', click: a.closeTab },
        { type: 'separator' },
        { label: 'Salva pagina come PDF su kDrive', accelerator: 'CmdOrCtrl+Shift+S', click: a.savePageToDrive },
        { label: 'Invia pagina via Mail…', accelerator: 'CmdOrCtrl+Shift+M', click: a.mailPage },
        { type: 'separator' },
        { label: 'Impostazioni…', accelerator: 'CmdOrCtrl+,', click: a.openSettings },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Esci' },
      ],
    },
    { role: 'editMenu', label: 'Modifica' },
    {
      label: 'Visualizza',
      submenu: [
        { label: 'Vai all’indirizzo', accelerator: 'CmdOrCtrl+L', click: a.focusAddress },
        { label: 'Ricarica', accelerator: 'CmdOrCtrl+R', click: a.reload },
        { label: 'Ricarica', accelerator: 'F5', click: a.reload, visible: false },
        { label: 'Indietro', accelerator: 'Alt+Left', click: a.back },
        { label: 'Avanti', accelerator: 'Alt+Right', click: a.forward },
        { type: 'separator' },
        { label: 'Scheda successiva', accelerator: 'Ctrl+Tab', click: a.nextTab },
        { label: 'Scheda precedente', accelerator: 'Ctrl+Shift+Tab', click: a.previousTab },
        { type: 'separator' },
        { label: 'Mostra/nascondi pannello kSuite', accelerator: 'CmdOrCtrl+Shift+K', click: a.togglePanel },
        { label: 'Strumenti per sviluppatori', accelerator: 'F12', click: a.devTools },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    { role: 'windowMenu', label: 'Finestra' },
  ];
  return Menu.buildFromTemplate(template);
}
