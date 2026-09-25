import { existsSync, readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { allSites, hostPatterns } from '../../shared/match-pattern';

/** The parts of manifest.json the browser uses. */
export interface Manifest {
  manifest_version: number;
  name: string;
  version: string;
  description?: string;
  default_locale?: string;
  key?: string;
  icons?: Record<string, string>;
  action?: ActionManifest;
  browser_action?: ActionManifest;
  page_action?: ActionManifest;
  options_page?: string;
  options_ui?: { page?: string };
  permissions?: string[];
  optional_permissions?: string[];
  host_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: Array<{ matches?: string[] }>;
  commands?: Record<string, { suggested_key?: Record<string, string> | string; description?: string }>;
  homepage_url?: string;
  background?: { service_worker?: string; scripts?: string[]; page?: string; type?: string };
  update_url?: string;
}

export interface ActionManifest {
  default_popup?: string;
  default_title?: string;
  default_icon?: string | Record<string, string>;
}

export class ManifestError extends Error {}

/** Reads and checks manifest.json (a byte order mark is allowed, as in Chrome). */
export function readManifest(dir: string): Manifest {
  let raw: string;
  try {
    raw = readFileSync(join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, '');
  } catch {
    throw new ManifestError('Manca il file manifest.json');
  }
  let m: Manifest;
  try {
    m = JSON.parse(raw) as Manifest;
  } catch {
    throw new ManifestError('Il file manifest.json non è valido');
  }
  if (m.manifest_version !== 2 && m.manifest_version !== 3) throw new ManifestError('Versione del manifest non supportata');
  if (typeof m.name !== 'string' || typeof m.version !== 'string') throw new ManifestError('Il manifest non indica nome e versione');
  return m;
}

/** A file inside the extension, never outside of it. */
export function extensionFile(dir: string, relative: string): string | null {
  const clean = relative.replace(/^\/+/, '').split(/[?#]/)[0];
  if (!clean) return null;
  const full = normalize(join(dir, clean));
  return full.startsWith(normalize(dir) + sep) ? full : null;
}

/** Resolves "__MSG_name__" placeholders with the extension's messages (Italian first, then the default locale). */
export function localize(dir: string, manifest: Manifest, text: string | undefined): string {
  if (!text) return '';
  const m = /^__MSG_(\w+)__$/.exec(text);
  if (!m) return text;
  const key = m[1].toLowerCase();
  for (const locale of ['it', 'it_IT', manifest.default_locale, 'en', 'en_US']) {
    if (!locale) continue;
    try {
      const messages = JSON.parse(readFileSync(join(dir, '_locales', locale, 'messages.json'), 'utf8').replace(/^﻿/, '')) as Record<string, { message?: string }>;
      const entry = Object.entries(messages).find(([k]) => k.toLowerCase() === key)?.[1];
      if (entry?.message) return entry.message;
    } catch {
      /* next locale */
    }
  }
  return text;
}

export function actionOf(manifest: Manifest): ActionManifest | null {
  return manifest.action ?? manifest.browser_action ?? manifest.page_action ?? null;
}

/** Path of the best icon for `size` px (the smallest one at least that big, else the biggest). */
export function iconPath(icons: string | Record<string, string> | undefined, size: number): string | null {
  if (!icons) return null;
  if (typeof icons === 'string') return icons;
  const sizes = Object.keys(icons).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
  if (!sizes.length) return null;
  return icons[String(sizes.find((s) => s >= size) ?? sizes[sizes.length - 1])];
}

/** Icon as a data: URL (for the toolbar, menus and the extensions page). */
export function iconDataUrl(dir: string, relative: string | null): string | null {
  if (!relative) return null;
  const file = extensionFile(dir, relative);
  if (!file || !existsSync(file)) return null;
  const ext = file.split('.').pop()?.toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png';
  try {
    return `data:${mime};base64,${readFileSync(file).toString('base64')}`;
  } catch {
    return null;
  }
}

// ---------- Permissions, explained ----------

const PERMISSION_TEXT: Record<string, string> = {
  tabs: 'Leggere la cronologia di navigazione',
  webNavigation: 'Leggere la cronologia di navigazione',
  history: 'Leggere e modificare la cronologia di navigazione',
  bookmarks: 'Leggere e modificare i preferiti',
  notifications: 'Mostrare notifiche',
  clipboardRead: 'Leggere i dati copiati negli appunti',
  clipboardWrite: 'Modificare i dati copiati negli appunti',
  downloads: 'Gestire i download',
  nativeMessaging: 'Comunicare con applicazioni installate sul computer',
  privacy: 'Modificare le impostazioni sulla privacy',
  management: 'Gestire le altre estensioni',
  proxy: 'Leggere e modificare le impostazioni del proxy',
  declarativeNetRequest: 'Bloccare contenuti su qualsiasi pagina',
  declarativeNetRequestWithHostAccess: 'Bloccare contenuti sulle pagine a cui ha accesso',
  geolocation: 'Rilevare la tua posizione',
  identity: 'Conoscere il tuo account',
  topSites: 'Leggere l’elenco dei siti più visitati',
  sessions: 'Leggere le schede aperte sugli altri dispositivi',
  debugger: 'Accedere agli strumenti di sviluppo delle pagine',
  pageCapture: 'Salvare il contenuto delle pagine',
  desktopCapture: 'Registrare lo schermo',
  tabCapture: 'Registrare il contenuto delle schede',
  cookies: 'Leggere e modificare i cookie',
};

/** API that kSuite Browser doesn't offer (the extension may partly not work). */
const UNSUPPORTED = new Set([
  'bookmarks', 'history', 'downloads', 'nativeMessaging', 'proxy', 'identity', 'topSites', 'sessions', 'debugger', 'pageCapture',
  'desktopCapture', 'tabCapture', 'tabGroups', 'sidePanel', 'search', 'fontSettings', 'contentSettings', 'browsingData', 'tts', 'ttsEngine',
  'gcm', 'declarativeContent', 'readingList', 'enterprise.platformKeys', 'platformKeys', 'certificateProvider', 'documentScan', 'printing',
  'printerProvider', 'system.cpu', 'system.memory', 'system.storage', 'system.display', 'wallpaper', 'loginState', 'vpnProvider', 'favicon',
]);

export interface PermissionSummary {
  /** Sentences shown before installing ("Potrà: …"). */
  warnings: string[];
  /** Permission names not implemented here. */
  unsupported: string[];
  hosts: string[];
  allSites: boolean;
}

export function describePermissions(manifest: Manifest): PermissionSummary {
  const hosts = hostPatterns(manifest);
  const everywhere = allSites(hosts);
  const warnings: string[] = [];
  if (everywhere) {
    warnings.push('Leggere e modificare tutti i dati sui siti web che visiti');
  } else if (hosts.length) {
    const names = [...new Set(hosts.map((p) => p.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')))];
    warnings.push(`Leggere e modificare i dati su ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` e altri ${names.length - 5} siti` : ''}`);
  }
  const perms = (manifest.permissions ?? []).filter((p): p is string => typeof p === 'string');
  for (const p of perms) {
    const text = PERMISSION_TEXT[p];
    // Cookies are covered by the site access sentence.
    if (text && !(p === 'cookies' && hosts.length) && !warnings.includes(text)) warnings.push(text);
  }
  return { warnings, unsupported: perms.filter((p) => UNSUPPORTED.has(p)), hosts, allSites: everywhere };
}
