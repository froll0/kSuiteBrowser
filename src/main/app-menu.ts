import { Menu, type MenuItemConstructorOptions } from 'electron';
import { tr } from '../shared/i18n';
import { COMMANDS, shortcutFor, type CommandId } from '../shared/commands';

export type AppMenuActions = Record<CommandId, () => void> & {
  selectTab(index: number): void;
  findNext(backwards: boolean): void;
  autoHide(): boolean;
  /** One entry per profile, to open it. */
  profileItems(): MenuItemConstructorOptions[];
};

export function buildAppMenu(a: AppMenuActions, shortcuts: Record<string, string>): Menu {
  const isMac = process.platform === 'darwin';
  /** A menu item for a command, with the user's shortcut. */
  const placed = new Set<CommandId>();
  const cmd = (id: CommandId, extra: Partial<MenuItemConstructorOptions> = {}): MenuItemConstructorOptions => {
    placed.add(id);
    const def = COMMANDS.find((c) => c.id === id)!;
    const keys = shortcutFor(id, shortcuts);
    return { label: tr(def.label), ...(keys ? { accelerator: keys } : {}), click: () => a[id](), ...extra };
  };
  /** Extra hidden shortcuts of a command, kept only while its main one is the default. */
  const alias = (id: CommandId, keys: string, click: () => void = () => a[id]()): MenuItemConstructorOptions[] =>
    Object.prototype.hasOwnProperty.call(shortcuts, id) ? [] : [{ label: tr(COMMANDS.find((c) => c.id === id)!.label), accelerator: keys, click, visible: false }];
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
        cmd('newTab'),
        cmd('newWindow'),
        cmd('newPrivateWindow'),
        cmd('closeTab'),
        cmd('reopenClosed'),
        cmd('newContainerTab'),
        {
          label: tr('Profili'),
          submenu: [...a.profileItems(), { type: 'separator' }, cmd('switchProfile', { label: tr('Gestisci profili…') })],
        },
        { type: 'separator' },
        cmd('savePageAs'),
        cmd('print'),
        { type: 'separator' },
        cmd('savePageToDrive'),
        cmd('mailPage'),
        { type: 'separator' },
        cmd('openSettings'),
        cmd('customize'),
        cmd('openPasswords'),
        cmd('importData'),
        cmd('clearData'),
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
        cmd('find'),
        { label: tr('Trova successivo'), accelerator: 'F3', click: () => a.findNext(false) },
        { label: tr('Trova successivo'), accelerator: 'CmdOrCtrl+G', click: () => a.findNext(false), visible: false },
        { label: tr('Trova precedente'), accelerator: 'Shift+F3', click: () => a.findNext(true) },
        { label: tr('Trova precedente'), accelerator: 'CmdOrCtrl+Shift+G', click: () => a.findNext(true), visible: false },
      ],
    },
    {
      label: tr('Visualizza'),
      submenu: [
        cmd('focusAddress'),
        cmd('reload'),
        ...alias('reload', 'F5'),
        cmd('back'),
        cmd('forward'),
        { type: 'separator' },
        cmd('commandPalette'),
        cmd('searchTabs'),
        cmd('nextTab'),
        cmd('previousTab'),
        cmd('nextWorkspace'),
        cmd('previousWorkspace'),
        ...alias('nextTab', 'CmdOrCtrl+PageDown'),
        ...alias('previousTab', 'CmdOrCtrl+PageUp'),
        ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ label: tr('Scheda {0}', n), accelerator: `CmdOrCtrl+${n}`, click: () => a.selectTab(n - 1), visible: false })),
        { label: tr('Ultima scheda'), accelerator: 'CmdOrCtrl+9', click: () => a.selectTab(-1), visible: false },
        { type: 'separator' },
        cmd('zoomIn'),
        ...alias('zoomIn', 'CmdOrCtrl+='),
        ...alias('zoomIn', 'CmdOrCtrl+numadd'),
        cmd('zoomOut'),
        ...alias('zoomOut', 'CmdOrCtrl+numsub'),
        cmd('zoomReset'),
        ...alias('zoomReset', 'CmdOrCtrl+num0'),
        { type: 'separator' },
        cmd('toggleBookmarksBar'),
        cmd('toggleAutoHide', { type: 'checkbox', checked: a.autoHide() }),
        cmd('togglePanel'),
        cmd('reader'),
        cmd('pictureInPicture'),
        cmd('viewSource'),
        cmd('devTools'),
        { type: 'separator' },
        { role: 'togglefullscreen', label: tr('Schermo intero') },
      ],
    },
    {
      label: tr('Cronologia'),
      submenu: [
        cmd('openHistory'),
        cmd('clearData', { accelerator: undefined }),
      ],
    },
    {
      label: tr('Preferiti'),
      submenu: [
        cmd('bookmarkPage'),
        cmd('openBookmarks'),
        cmd('toggleBookmarksBar', { accelerator: undefined }),
      ],
    },
    { role: 'windowMenu', label: tr('Finestra') },
    {
      label: tr('Aiuto'),
      submenu: [
        cmd('checkUpdates'),
        cmd('about'),
      ],
    },
  ];
  // Commands without a menu entry (duplicate tab, pin…) still answer to their shortcut.
  const hidden = COMMANDS.filter((c) => !placed.has(c.id) && shortcutFor(c.id, shortcuts)).map((c) => ({ ...cmd(c.id), visible: false }));
  const view = template.find((m) => m.label === tr('Visualizza'));
  if (view && Array.isArray(view.submenu)) view.submenu.push(...hidden);
  return Menu.buildFromTemplate(template);
}
