import { Menu, type MenuItemConstructorOptions } from 'electron';

export interface AppMenuActions {
  newTab(): void;
  newWindow(): void;
  newPrivateWindow(): void;
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
  find(): void;
  findNext(backwards: boolean): void;
  zoom(direction: 'in' | 'out' | 'reset'): void;
  toggleBookmarksBar(): void;
  bookmarkPage(): void;
  openHistory(): void;
  openBookmarks(): void;
  clearData(): void;
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
        { label: 'Nuova finestra', accelerator: 'CmdOrCtrl+N', click: a.newWindow },
        { label: 'Nuova finestra privata', accelerator: 'CmdOrCtrl+Shift+N', click: a.newPrivateWindow },
        { label: 'Chiudi scheda', accelerator: 'CmdOrCtrl+W', click: a.closeTab },
        { type: 'separator' },
        { label: 'Salva pagina come PDF su kDrive', accelerator: 'CmdOrCtrl+Shift+S', click: a.savePageToDrive },
        { label: 'Invia pagina via Mail…', accelerator: 'CmdOrCtrl+Shift+M', click: a.mailPage },
        { type: 'separator' },
        { label: 'Impostazioni', accelerator: 'CmdOrCtrl+,', click: a.openSettings },
        { label: 'Cancella dati di navigazione…', accelerator: 'CmdOrCtrl+Shift+Delete', click: a.clearData },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Esci' },
      ],
    },
    {
      label: 'Modifica',
      submenu: [
        { role: 'undo', label: 'Annulla' },
        { role: 'redo', label: 'Ripeti' },
        { type: 'separator' },
        { role: 'cut', label: 'Taglia' },
        { role: 'copy', label: 'Copia' },
        { role: 'paste', label: 'Incolla' },
        { role: 'selectAll', label: 'Seleziona tutto' },
        { type: 'separator' },
        { label: 'Trova nella pagina…', accelerator: 'CmdOrCtrl+F', click: a.find },
        { label: 'Trova successivo', accelerator: 'F3', click: () => a.findNext(false) },
        { label: 'Trova successivo', accelerator: 'CmdOrCtrl+G', click: () => a.findNext(false), visible: false },
        { label: 'Trova precedente', accelerator: 'Shift+F3', click: () => a.findNext(true) },
        { label: 'Trova precedente', accelerator: 'CmdOrCtrl+Shift+G', click: () => a.findNext(true), visible: false },
      ],
    },
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
        { label: 'Zoom avanti', accelerator: 'CmdOrCtrl+Plus', click: () => a.zoom('in') },
        { label: 'Zoom avanti', accelerator: 'CmdOrCtrl+=', click: () => a.zoom('in'), visible: false },
        { label: 'Zoom avanti', accelerator: 'CmdOrCtrl+numadd', click: () => a.zoom('in'), visible: false },
        { label: 'Zoom indietro', accelerator: 'CmdOrCtrl+-', click: () => a.zoom('out') },
        { label: 'Zoom indietro', accelerator: 'CmdOrCtrl+numsub', click: () => a.zoom('out'), visible: false },
        { label: 'Dimensioni reali', accelerator: 'CmdOrCtrl+0', click: () => a.zoom('reset') },
        { label: 'Dimensioni reali', accelerator: 'CmdOrCtrl+num0', click: () => a.zoom('reset'), visible: false },
        { type: 'separator' },
        { label: 'Mostra/nascondi barra dei preferiti', accelerator: 'CmdOrCtrl+Shift+B', click: a.toggleBookmarksBar },
        { label: 'Mostra/nascondi pannello kSuite', accelerator: 'CmdOrCtrl+Shift+K', click: a.togglePanel },
        { label: 'Strumenti per sviluppatori', accelerator: 'F12', click: a.devTools },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
      ],
    },
    {
      label: 'Cronologia',
      submenu: [
        { label: 'Mostra tutta la cronologia', accelerator: isMac ? 'Cmd+Y' : 'Ctrl+H', click: a.openHistory },
        { label: 'Cancella dati di navigazione…', click: a.clearData },
      ],
    },
    {
      label: 'Preferiti',
      submenu: [
        { label: 'Aggiungi pagina ai preferiti', accelerator: 'CmdOrCtrl+D', click: a.bookmarkPage },
        { label: 'Gestisci preferiti', accelerator: 'CmdOrCtrl+Shift+O', click: a.openBookmarks },
        { label: 'Mostra/nascondi barra dei preferiti', click: a.toggleBookmarksBar },
      ],
    },
    { role: 'windowMenu', label: 'Finestra' },
  ];
  return Menu.buildFromTemplate(template);
}
