/**
 * Browser commands: the menu, the keyboard shortcuts and the command palette (Ctrl+K) share this list.
 * Labels are Italian keys (see i18n.ts). Shortcuts use Electron's accelerator syntax; the user can
 * change them (settings.shortcuts: id → accelerator, '' = no shortcut).
 */
// The renderers have no `process`: they get the shortcuts from the main process.
const IS_MAC = typeof process !== 'undefined' && process.platform === 'darwin';

export const COMMANDS = [
  { id: 'newTab', label: 'Nuova scheda', group: 'Schede', keys: 'CmdOrCtrl+T' },
  { id: 'newWindow', label: 'Nuova finestra', group: 'Finestre', keys: 'CmdOrCtrl+N' },
  { id: 'newPrivateWindow', label: 'Nuova finestra privata', group: 'Finestre', keys: 'CmdOrCtrl+Shift+N' },
  { id: 'closeTab', label: 'Chiudi scheda', group: 'Schede', keys: 'CmdOrCtrl+W' },
  { id: 'reopenClosed', label: 'Riapri scheda chiusa', group: 'Schede', keys: 'CmdOrCtrl+Shift+T' },
  { id: 'duplicateTab', label: 'Duplica scheda', group: 'Schede', keys: '' },
  { id: 'pinTab', label: 'Fissa o sblocca la scheda', group: 'Schede', keys: '' },
  { id: 'muteTab', label: 'Disattiva o riattiva l’audio della scheda', group: 'Schede', keys: '' },
  { id: 'nextTab', label: 'Scheda successiva', group: 'Schede', keys: 'Ctrl+Tab' },
  { id: 'previousTab', label: 'Scheda precedente', group: 'Schede', keys: 'Ctrl+Shift+Tab' },
  { id: 'searchTabs', label: 'Cerca tra le schede…', group: 'Schede', keys: 'CmdOrCtrl+Shift+A' },
  { id: 'commandPalette', label: 'Tavolozza dei comandi', group: 'Generale', keys: 'CmdOrCtrl+K' },
  { id: 'savePageAs', label: 'Salva pagina con nome…', group: 'Pagina', keys: 'CmdOrCtrl+S' },
  { id: 'print', label: 'Stampa…', group: 'Pagina', keys: 'CmdOrCtrl+P' },
  { id: 'savePageToDrive', label: 'Salva pagina come PDF su kDrive', group: 'Cloud', keys: 'CmdOrCtrl+Shift+S' },
  { id: 'mailPage', label: 'Invia pagina via Mail…', group: 'Cloud', keys: 'CmdOrCtrl+Shift+M' },
  { id: 'openSettings', label: 'Impostazioni', group: 'Generale', keys: 'CmdOrCtrl+,' },
  { id: 'siteSettings', label: 'Impostazioni di questo sito', group: 'Pagina', keys: '' },
  { id: 'customize', label: 'Personalizza l’aspetto…', group: 'Generale', keys: '' },
  { id: 'openPasswords', label: 'Password', group: 'Generale', keys: '' },
  { id: 'clearData', label: 'Cancella dati di navigazione…', group: 'Generale', keys: 'CmdOrCtrl+Shift+Delete' },
  { id: 'find', label: 'Trova nella pagina…', group: 'Pagina', keys: 'CmdOrCtrl+F' },
  { id: 'focusAddress', label: 'Vai all’indirizzo', group: 'Pagina', keys: 'CmdOrCtrl+L' },
  { id: 'reload', label: 'Ricarica', group: 'Pagina', keys: 'CmdOrCtrl+R' },
  { id: 'back', label: 'Indietro', group: 'Pagina', keys: 'Alt+Left' },
  { id: 'forward', label: 'Avanti', group: 'Pagina', keys: 'Alt+Right' },
  { id: 'zoomIn', label: 'Zoom avanti', group: 'Pagina', keys: 'CmdOrCtrl+Plus' },
  { id: 'zoomOut', label: 'Zoom indietro', group: 'Pagina', keys: 'CmdOrCtrl+-' },
  { id: 'zoomReset', label: 'Dimensioni reali', group: 'Pagina', keys: 'CmdOrCtrl+0' },
  { id: 'toggleBookmarksBar', label: 'Mostra/nascondi barra dei preferiti', group: 'Aspetto', keys: 'CmdOrCtrl+Shift+B' },
  { id: 'toggleAutoHide', label: 'Barra a scomparsa', group: 'Aspetto', keys: 'CmdOrCtrl+Shift+F' },
  { id: 'togglePanel', label: 'Mostra/nascondi pannello cloud', group: 'Cloud', keys: 'CmdOrCtrl+Shift+K' },
  { id: 'reader', label: 'Modalità lettura', group: 'Pagina', keys: 'F9' },
  { id: 'pictureInPicture', label: 'Picture-in-picture', group: 'Pagina', keys: 'CmdOrCtrl+Shift+P' },
  { id: 'viewSource', label: 'Sorgente pagina', group: 'Pagina', keys: 'CmdOrCtrl+U' },
  { id: 'devTools', label: 'Strumenti per sviluppatori', group: 'Pagina', keys: 'F12' },
  { id: 'openHistory', label: 'Mostra tutta la cronologia', group: 'Generale', keys: IS_MAC ? 'Cmd+Y' : 'Ctrl+H' },
  { id: 'bookmarkPage', label: 'Aggiungi pagina ai preferiti', group: 'Pagina', keys: 'CmdOrCtrl+D' },
  { id: 'openBookmarks', label: 'Gestisci preferiti', group: 'Generale', keys: 'CmdOrCtrl+Shift+O' },
  { id: 'checkUpdates', label: 'Controlla aggiornamenti…', group: 'Generale', keys: '' },
  { id: 'about', label: 'Informazioni su Velo', group: 'Generale', keys: '' },
] as const;

export type CommandId = (typeof COMMANDS)[number]['id'];
export const COMMAND_IDS: readonly CommandId[] = COMMANDS.map((c) => c.id);

/** Shortcuts the user may not take: system ones and those Velo keeps fixed (Ctrl+1…9). */
const RESERVED = /^(CmdOrCtrl|Ctrl|Cmd)\+[1-9]$|^(Alt\+F4|Cmd\+Q|CmdOrCtrl\+Q)$/;

const NAMED_KEYS = ['Plus', 'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Escape', 'Enter', 'numadd', 'numsub', ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`), ...Array.from({ length: 10 }, (_, i) => `num${i}`)];
const MODIFIERS = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Shift'];
const KEY = /^([A-Z0-9]|F([1-9]|1[0-9]|2[0-4])|Plus|-|=|,|\.|\/|;|'|\[|\]|\\|`|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Escape|Enter|num[0-9]|numadd|numsub)$/;

/** Normalizes an accelerator ("ctrl+shift+k" → "CmdOrCtrl+Shift+K"); null when invalid or reserved. */
export function normalizeAccelerator(value: string): string | null {
  const parts = value.split('+').map((p) => p.trim()).filter(Boolean);
  // "Ctrl++" → the key is "+".
  if (value.trim().endsWith('++')) parts.push('Plus');
  if (!parts.length) return null;
  const key = parts.pop()!;
  const mods = new Set<string>();
  for (const p of parts) {
    const m = MODIFIERS.find((x) => x.toLowerCase() === p.toLowerCase()) ?? (/^(control|command|cmd|meta|super)$/i.test(p) ? 'CmdOrCtrl' : /^option$/i.test(p) ? 'Alt' : null);
    if (!m) return null;
    mods.add(m === 'Cmd' || m === 'Ctrl' ? 'CmdOrCtrl' : m);
  }
  const lower = key.toLowerCase().replace(/^arrow/, '');
  const aliases: Record<string, string> = { '+': 'Plus', esc: 'Escape', return: 'Enter', del: 'Delete' };
  const fixed = key.length === 1 && key !== '+' ? key.toUpperCase() : aliases[lower] ?? NAMED_KEYS.find((n) => n.toLowerCase() === lower) ?? key;
  if (!KEY.test(fixed)) return null;
  // A plain letter or digit would break typing in pages: a modifier (other than Shift) is needed, except for F keys.
  const hasMod = [...mods].some((m) => m !== 'Shift');
  if (!hasMod && !/^F\d+$/.test(fixed)) return null;
  const out = [...MODIFIERS.filter((m) => mods.has(m)), fixed].join('+');
  return RESERVED.test(out) ? null : out;
}

/** The shortcut of a command for the user's overrides ('' = none). */
export function shortcutFor(id: CommandId, overrides: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
  return COMMANDS.find((c) => c.id === id)?.keys ?? '';
}

/** Keeps only valid overrides different from the defaults; a shortcut taken twice keeps the later one. */
export function sanitizeShortcuts(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const def = COMMANDS.find((c) => c.id === id);
    if (!def || typeof raw !== 'string') continue;
    const keys = raw === '' ? '' : normalizeAccelerator(raw);
    if (keys === null || keys === def.keys) continue;
    out[id] = keys;
  }
  return out;
}

/** Commands whose shortcut equals another's (to warn the user). */
export function shortcutConflicts(overrides: Record<string, string>): Map<string, CommandId[]> {
  const byKeys = new Map<string, CommandId[]>();
  for (const c of COMMANDS) {
    const keys = shortcutFor(c.id, overrides);
    if (!keys) continue;
    byKeys.set(keys, [...(byKeys.get(keys) ?? []), c.id]);
  }
  return new Map([...byKeys].filter(([, ids]) => ids.length > 1));
}

/** "CmdOrCtrl+Shift+K" as shown to the user on this system ("Ctrl+Maiusc+K", "⌘⇧K"). */
export function displayShortcut(keys: string, platform: string): string {
  if (!keys) return '';
  const mac = platform === 'darwin';
  const names: Record<string, string> = mac
    ? { CmdOrCtrl: '⌘', Cmd: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Plus: '+', Left: '←', Right: '→', Up: '↑', Down: '↓' }
    : { CmdOrCtrl: 'Ctrl', Cmd: 'Ctrl', Plus: '+', Left: '←', Right: '→', Up: '↑', Down: '↓' };
  const parts = keys.split('+').map((p) => names[p] ?? p);
  return mac ? parts.join('') : parts.join('+');
}

/** The accelerator for a keydown event (as the settings page records it). */
export function acceleratorFromEvent(e: { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift', 'AltGraph'].includes(e.key)) return null;
  const mods = [e.ctrlKey || e.metaKey ? 'CmdOrCtrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : ''].filter(Boolean);
  // The physical key, so Shift or Alt don't change it ("Shift+1" stays 1, not "!").
  const code = e.code;
  let key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^Numpad\d$/.test(code) ? `num${code.slice(6)}` : e.key;
  const map: Record<string, string> = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Equal: '=', Minus: '-', '+': 'Plus', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', Comma: ',', Period: '.' };
  key = map[code] ?? map[key] ?? key;
  return normalizeAccelerator([...mods, key].join('+'));
}

/** Sections of velo://settings (anchors), searchable in the command palette. */
export const SETTINGS_SECTIONS: ReadonlyArray<{ id: string; label: string; keywords: string }> = [
  { id: 'general', label: 'Generale', keywords: 'pagina iniziale motore di ricerca download lingua browser predefinito' },
  { id: 'appearance', label: 'Aspetto', keywords: 'tema scuro chiaro colore caratteri' },
  { id: 'layout', label: 'Disposizione', keywords: 'schede laterali barra degli strumenti pulsanti preferiti barra a scomparsa' },
  { id: 'zoom', label: 'Zoom', keywords: 'ingrandimento dimensioni' },
  { id: 'shortcuts', label: 'Scorciatoie da tastiera', keywords: 'tasti tastiera comandi' },
  { id: 'notifications', label: 'Notifiche', keywords: 'mail eventi schede in pausa memoria' },
  { id: 'passwords', label: 'Password', keywords: 'compilazione automatica indirizzi carte' },
  { id: 'privacy', label: 'Privacy e sicurezza', keywords: 'tracker cookie impronta dns https livello di sicurezza cancella dati' },
  { id: 'permissions', label: 'Permessi dei siti', keywords: 'fotocamera microfono posizione notifiche' },
  { id: 'account', label: 'Account cloud', keywords: 'infomaniak token kdrive' },
  { id: 'sync', label: 'Sincronizzazione', keywords: 'dispositivi cifrata' },
  { id: 'ai', label: 'Intelligenza artificiale', keywords: 'assistente ai' },
  { id: 'updates', label: 'Aggiornamenti', keywords: 'versione' },
  { id: 'about', label: 'Informazioni', keywords: 'versione licenza' },
];
