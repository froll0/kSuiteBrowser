import { BrowserWindow, Menu, screen, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { MainMenuEntry, PopupLook, Rect } from '../shared/types';
import { displayShortcut } from '../shared/commands';
import type { MainMenuPopup, MenuPlace } from './main-menu';

/**
 * Every popup menu of Velo (right click, tab and toolbar buttons, autofill…) is drawn by Velo, in the
 * same style as the ⋮ menu, from the same templates Electron's native menus take.
 */

interface Host {
  popup: MainMenuPopup;
  look: () => PopupLook;
}

const hosts = new Map<BrowserWindow, Host>();
/** What each item of the menu open in a window does. */
const actions = new Map<BrowserWindow, Map<string, () => void>>();

export function registerMenuHost(win: BrowserWindow, host: Host): void {
  hosts.set(win, host);
  win.once('closed', () => {
    hosts.delete(win);
    actions.delete(win);
  });
}

type Role = NonNullable<MenuItemConstructorOptions['role']>;
const EDIT_ROLES: Partial<Record<Role, (wc: WebContents) => void>> = {
  undo: (wc) => wc.undo(),
  redo: (wc) => wc.redo(),
  cut: (wc) => wc.cut(),
  copy: (wc) => wc.copy(),
  paste: (wc) => wc.paste(),
  pasteAndMatchStyle: (wc) => wc.pasteAndMatchStyle(),
  delete: (wc) => wc.delete(),
  selectAll: (wc) => wc.selectAll(),
};
const ROLE_KEYS: Partial<Record<Role, string>> = {
  undo: 'CmdOrCtrl+Z', redo: 'CmdOrCtrl+Shift+Z', cut: 'CmdOrCtrl+X', copy: 'CmdOrCtrl+C', paste: 'CmdOrCtrl+V', selectAll: 'CmdOrCtrl+A',
};

export interface PopupOptions {
  /** Under this element (window coordinates); otherwise at the mouse pointer. */
  anchor?: Rect;
  align?: 'start' | 'end';
  /** A point in window coordinates (instead of the pointer). */
  point?: { x: number; y: number };
  /** The page that edit roles (copy, paste…) act on. */
  contents?: WebContents;
  /** Called when the menu closes, chosen or not. */
  onClose?: () => void;
}

/** Shows an Electron-style menu template as a Velo menu. */
export function popupMenu(win: BrowserWindow, template: MenuItemConstructorOptions[], options: PopupOptions = {}): void {
  // e2e tests capture menus to choose their items (see e2e/helpers.cjs).
  if ((globalThis as { __captureMenus?: boolean }).__captureMenus) {
    (globalThis as { __menu?: Menu }).__menu = Menu.buildFromTemplate(template);
    return;
  }
  const host = hosts.get(win);
  if (!host || win.isDestroyed()) return;
  // A second click on the button that opened it closes it (the click outside already hid it).
  if (options.anchor && host.popup.justHidden()) return;
  const table = new Map<string, () => void>();
  let next = 0;
  const convert = (items: MenuItemConstructorOptions[]): MainMenuEntry[] => {
    const out: MainMenuEntry[] = [];
    for (const item of items) {
      if (item.visible === false) continue;
      if (item.type === 'separator') {
        // No double, leading or trailing lines.
        if (out.length && out[out.length - 1].kind !== 'separator') out.push({ kind: 'separator' });
        continue;
      }
      const label = item.label ?? '';
      if (item.submenu) {
        const sub = Array.isArray(item.submenu) ? item.submenu : [];
        out.push({ kind: 'more', label, icon: '', items: convert(sub), ...(item.enabled === false ? { enabled: false } : {}) });
        continue;
      }
      const role = item.role as Role | undefined;
      const click = role && EDIT_ROLES[role] ? () => options.contents && !options.contents.isDestroyed() && EDIT_ROLES[role]!(options.contents) : item.click;
      // Items without an action and without a role are titles.
      if (!click && item.enabled === false && !item.type) {
        out.push({ kind: 'header', label });
        continue;
      }
      const id = `p${next++}`;
      if (click) table.set(id, () => (click as (...a: unknown[]) => void)(item, undefined, undefined));
      const keys = typeof item.accelerator === 'string' ? item.accelerator : role ? ROLE_KEYS[role] ?? '' : '';
      out.push({
        kind: 'item', id, label, icon: '', ...(item.sublabel ? { sub: item.sublabel } : {}),
        keys: keys ? displayShortcut(keys, process.platform) : '',
        ...(item.type === 'checkbox' || item.type === 'radio' ? { checked: Boolean(item.checked) } : {}),
        ...(item.enabled === false || !click ? { enabled: false } : {}),
      });
    }
    while (out.length && out[out.length - 1].kind === 'separator') out.pop();
    return out;
  };
  const entries = convert(template);
  if (!entries.length) return;
  let place: MenuPlace;
  if (options.anchor) place = { anchor: options.anchor, align: options.align ?? 'start' };
  else if (options.point) place = { point: options.point };
  else {
    const cursor = screen.getCursorScreenPoint();
    const area = win.getContentBounds();
    place = { point: { x: cursor.x - area.x, y: cursor.y - area.y } };
  }
  const closing = options.onClose ?? null;
  void host.popup.show({ variant: 'context', entries, zoom: null, fullscreen: false, profile: null, look: host.look() }, place).then(() => {
    actions.set(win, table);
    host.popup.onHide = () => {
      actions.delete(win);
      closing?.();
    };
  });
}

/** Runs an item of the popup menu open in `win`; false when it isn't one of these menus. */
export function runPopupItem(win: BrowserWindow, id: string): boolean {
  const table = actions.get(win);
  const host = hosts.get(win);
  if (!table || !host || host.popup.kind !== 'context') return false;
  const action = table.get(id);
  host.popup.hide();
  action?.();
  return true;
}
