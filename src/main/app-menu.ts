import { Menu, type MenuItemConstructorOptions } from 'electron';
import { tr } from '../shared/i18n';

export interface AppMenuActions {
  newTab(): void;
  newWindow(): void;
  newPrivateWindow(): void;
  newTorWindow(): void;
  newTorIdentity(): void;
  reopenClosed(): void;
  selectTab(index: number): void;
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
  print(): void;
  savePageAs(): void;
  viewSource(): void;
  openSettings(): void;
  customize(): void;
  openExtensions(): void;
  searchTabs(): void;
  reader(): void;
  pictureInPicture(): void;
  find(): void;
  findNext(backwards: boolean): void;
  zoom(direction: 'in' | 'out' | 'reset'): void;
  toggleBookmarksBar(): void;
  toggleAutoHide(): void;
  autoHide(): boolean;
  bookmarkPage(): void;
  openHistory(): void;
  openBookmarks(): void;
  openPasswords(): void;
  checkUpdates(): void;
  about(): void;
  clearData(): void;
  devTools(): void;
}

export function buildAppMenu(a: AppMenuActions): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    // Written out: for profiles moved from the old version the app keeps its old internal name (keychain).
    ...(isMac
      ? [{
          label: 'Velo',
          submenu: [
            { role: 'about', label: tr('Informazioni su Velo') },
            { type: 'separator' },
            { role: 'services', label: tr('Servizi') },
            { type: 'separator' },
            { role: 'hide', label: tr('Nascondi Velo') },
            { role: 'hideOthers', label: tr('Nascondi altre') },
            { role: 'unhide', label: tr('Mostra tutte') },
            { type: 'separator' },
            { role: 'quit', label: tr('Esci da Velo') },
          ],
        } as MenuItemConstructorOptions]
      : []),
    {
      label: 'File',
      submenu: [
        { label: tr('Nuova scheda'), accelerator: 'CmdOrCtrl+T', click: a.newTab },
        { label: tr('Nuova finestra'), accelerator: 'CmdOrCtrl+N', click: a.newWindow },
        { label: tr('Nuova finestra privata'), accelerator: 'CmdOrCtrl+Shift+N', click: a.newPrivateWindow },
        { label: tr('Nuova finestra Tor'), accelerator: 'Alt+Shift+N', click: a.newTorWindow },
        { label: tr('Nuova identità Tor'), click: a.newTorIdentity },
        { label: tr('Chiudi scheda'), accelerator: 'CmdOrCtrl+W', click: a.closeTab },
        { label: tr('Riapri scheda chiusa'), accelerator: 'CmdOrCtrl+Shift+T', click: a.reopenClosed },
        { type: 'separator' },
        { label: tr('Salva pagina con nome…'), accelerator: 'CmdOrCtrl+S', click: a.savePageAs },
        { label: tr('Stampa…'), accelerator: 'CmdOrCtrl+P', click: a.print },
        { type: 'separator' },
        { label: tr('Salva pagina come PDF su kDrive'), accelerator: 'CmdOrCtrl+Shift+S', click: a.savePageToDrive },
        { label: tr('Invia pagina via Mail…'), accelerator: 'CmdOrCtrl+Shift+M', click: a.mailPage },
        { type: 'separator' },
        { label: tr('Impostazioni'), accelerator: 'CmdOrCtrl+,', click: a.openSettings },
        { label: tr('Personalizza l’aspetto…'), click: a.customize },
        { label: tr('Estensioni'), click: a.openExtensions },
        { label: 'Password', click: a.openPasswords },
        { label: tr('Cancella dati di navigazione…'), accelerator: 'CmdOrCtrl+Shift+Delete', click: a.clearData },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: tr('Esci') },
      ],
    },
    {
      label: tr('Modifica'),
      submenu: [
        { role: 'undo', label: tr('Annulla') },
        { role: 'redo', label: tr('Ripeti') },
        { type: 'separator' },
        { role: 'cut', label: tr('Taglia') },
        { role: 'copy', label: tr('Copia') },
        { role: 'paste', label: tr('Incolla') },
        { role: 'selectAll', label: tr('Seleziona tutto') },
        { type: 'separator' },
        { label: tr('Trova nella pagina…'), accelerator: 'CmdOrCtrl+F', click: a.find },
        { label: tr('Trova successivo'), accelerator: 'F3', click: () => a.findNext(false) },
        { label: tr('Trova successivo'), accelerator: 'CmdOrCtrl+G', click: () => a.findNext(false), visible: false },
        { label: tr('Trova precedente'), accelerator: 'Shift+F3', click: () => a.findNext(true) },
        { label: tr('Trova precedente'), accelerator: 'CmdOrCtrl+Shift+G', click: () => a.findNext(true), visible: false },
      ],
    },
    {
      label: tr('Visualizza'),
      submenu: [
        { label: tr('Vai all’indirizzo'), accelerator: 'CmdOrCtrl+L', click: a.focusAddress },
        { label: tr('Ricarica'), accelerator: 'CmdOrCtrl+R', click: a.reload },
        { label: tr('Ricarica'), accelerator: 'F5', click: a.reload, visible: false },
        { label: tr('Indietro'), accelerator: 'Alt+Left', click: a.back },
        { label: tr('Avanti'), accelerator: 'Alt+Right', click: a.forward },
        { type: 'separator' },
        { label: tr('Cerca tra le schede…'), accelerator: 'CmdOrCtrl+Shift+A', click: a.searchTabs },
        { label: tr('Scheda successiva'), accelerator: 'Ctrl+Tab', click: a.nextTab },
        { label: tr('Scheda precedente'), accelerator: 'Ctrl+Shift+Tab', click: a.previousTab },
        { label: tr('Scheda successiva'), accelerator: 'CmdOrCtrl+PageDown', click: a.nextTab, visible: false },
        { label: tr('Scheda precedente'), accelerator: 'CmdOrCtrl+PageUp', click: a.previousTab, visible: false },
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: tr('Scheda {0}', n), accelerator: `CmdOrCtrl+${n}`, click: () => a.selectTab(n - 1), visible: false })),
        { label: tr('Ultima scheda'), accelerator: 'CmdOrCtrl+9', click: () => a.selectTab(-1), visible: false },
        { type: 'separator' },
        { label: tr('Zoom avanti'), accelerator: 'CmdOrCtrl+Plus', click: () => a.zoom('in') },
        { label: tr('Zoom avanti'), accelerator: 'CmdOrCtrl+=', click: () => a.zoom('in'), visible: false },
        { label: tr('Zoom avanti'), accelerator: 'CmdOrCtrl+numadd', click: () => a.zoom('in'), visible: false },
        { label: tr('Zoom indietro'), accelerator: 'CmdOrCtrl+-', click: () => a.zoom('out') },
        { label: tr('Zoom indietro'), accelerator: 'CmdOrCtrl+numsub', click: () => a.zoom('out'), visible: false },
        { label: tr('Dimensioni reali'), accelerator: 'CmdOrCtrl+0', click: () => a.zoom('reset') },
        { label: tr('Dimensioni reali'), accelerator: 'CmdOrCtrl+num0', click: () => a.zoom('reset'), visible: false },
        { type: 'separator' },
        { label: tr('Mostra/nascondi barra dei preferiti'), accelerator: 'CmdOrCtrl+Shift+B', click: a.toggleBookmarksBar },
        { label: tr('Barra a scomparsa'), type: 'checkbox', checked: a.autoHide(), accelerator: 'CmdOrCtrl+Shift+F', click: a.toggleAutoHide },
        { label: tr('Mostra/nascondi pannello cloud'), accelerator: 'CmdOrCtrl+Shift+K', click: a.togglePanel },
        { label: tr('Modalità lettura'), accelerator: 'F9', click: a.reader },
        { label: 'Picture-in-picture', accelerator: 'CmdOrCtrl+Shift+P', click: a.pictureInPicture },
        { label: tr('Sorgente pagina'), accelerator: 'CmdOrCtrl+U', click: a.viewSource },
        { label: tr('Strumenti per sviluppatori'), accelerator: 'F12', click: a.devTools },
        { type: 'separator' },
        { role: 'togglefullscreen', label: tr('Schermo intero') },
      ],
    },
    {
      label: tr('Cronologia'),
      submenu: [
        { label: tr('Mostra tutta la cronologia'), accelerator: isMac ? 'Cmd+Y' : 'Ctrl+H', click: a.openHistory },
        { label: tr('Cancella dati di navigazione…'), click: a.clearData },
      ],
    },
    {
      label: tr('Preferiti'),
      submenu: [
        { label: tr('Aggiungi pagina ai preferiti'), accelerator: 'CmdOrCtrl+D', click: a.bookmarkPage },
        { label: tr('Gestisci preferiti'), accelerator: 'CmdOrCtrl+Shift+O', click: a.openBookmarks },
        { label: tr('Mostra/nascondi barra dei preferiti'), click: a.toggleBookmarksBar },
      ],
    },
    { role: 'windowMenu', label: tr('Finestra') },
    {
      label: tr('Aiuto'),
      submenu: [
        { label: tr('Controlla aggiornamenti…'), click: a.checkUpdates },
        { label: tr('Informazioni su Velo'), click: a.about },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
