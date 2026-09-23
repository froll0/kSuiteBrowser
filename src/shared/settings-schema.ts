import type { AskablePermission, PermissionDefault, Settings, SitePermission } from './types';
import { SEARCH_ENGINES } from './url';
import { ZOOM_STEPS } from './zoom';

export const REMINDER_MINUTES = [5, 10, 15, 30, 60] as const;

export const ASKABLE_PERMISSIONS: readonly AskablePermission[] = ['media', 'notifications', 'geolocation'];

export const DEFAULT_SETTINGS: Settings = {
  startup: 'restore',
  searchEngine: 'duckduckgo',
  homePage: 'https://ksuite.infomaniak.com/',
  downloadDir: null,
  askDownloadLocation: false,

  theme: 'system',
  showSidebar: true,
  showBookmarksBar: true,
  panelOpen: true,
  newTabPage: 'newtab',
  showTopSites: true,
  hiddenTopSites: [],
  defaultZoom: 100,
  siteZoom: {},

  notifyMail: true,
  notifyEvents: true,
  eventReminderMinutes: 10,
  offerToSavePasswords: true,
  autofillPasswords: true,
  saveHistory: true,
  trackingProtection: 'standard',
  blockThirdPartyCookies: true,
  doNotTrack: true,
  httpsOnly: true,
  clearCookiesOnExit: false,
  clearCacheOnExit: false,
  protectionExceptions: [],
  httpExceptions: [],
  permissionDefaults: { media: 'ask', notifications: 'ask', geolocation: 'ask' },
  sitePermissions: [],

  driveId: null,
  driveUploadFolderId: 1,
  driveUploadFolderName: 'kDrive',
  uploadDownloadsToDrive: false,
};

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

function hostList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const hosts = value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return [...new Set(hosts)].sort();
}

function siteZoom(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [host, zoom] of Object.entries(value as Record<string, unknown>)) {
    if (host && typeof zoom === 'number' && (ZOOM_STEPS as readonly number[]).includes(zoom)) out[host.toLowerCase()] = zoom;
  }
  return out;
}

function sitePermissions(value: unknown): SitePermission[] {
  if (!Array.isArray(value)) return [];
  const seen = new Map<string, SitePermission>();
  for (const v of value) {
    if (!v || typeof v !== 'object') continue;
    const { host, permission, allowed } = v as Partial<SitePermission>;
    if (typeof host !== 'string' || !host || typeof permission !== 'string' || typeof allowed !== 'boolean') continue;
    seen.set(`${host}|${permission}`, { host: host.toLowerCase(), permission, allowed });
  }
  return [...seen.values()].sort((a, b) => a.host.localeCompare(b.host) || a.permission.localeCompare(b.permission));
}

/** Fills in defaults and drops invalid values, so a hand-edited or old settings file never breaks the app. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const defaults = (s.permissionDefaults && typeof s.permissionDefaults === 'object' ? s.permissionDefaults : {}) as Record<string, unknown>;
  const positiveInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);

  return {
    startup: oneOf(s.startup, ['home', 'restore'] as const, d.startup),
    searchEngine: oneOf(s.searchEngine, Object.keys(SEARCH_ENGINES) as Array<keyof typeof SEARCH_ENGINES>, d.searchEngine),
    homePage: typeof s.homePage === 'string' && s.homePage.trim() ? s.homePage.trim() : d.homePage,
    downloadDir: typeof s.downloadDir === 'string' && s.downloadDir ? s.downloadDir : null,
    askDownloadLocation: bool(s.askDownloadLocation, d.askDownloadLocation),

    theme: oneOf(s.theme, ['system', 'light', 'dark'] as const, d.theme),
    showSidebar: bool(s.showSidebar, d.showSidebar),
    showBookmarksBar: bool(s.showBookmarksBar, d.showBookmarksBar),
    panelOpen: bool(s.panelOpen, d.panelOpen),
    newTabPage: oneOf(s.newTabPage, ['newtab', 'home'] as const, d.newTabPage),
    showTopSites: bool(s.showTopSites, d.showTopSites),
    hiddenTopSites: hostList(s.hiddenTopSites),
    defaultZoom: (ZOOM_STEPS as readonly number[]).includes(s.defaultZoom as number) ? (s.defaultZoom as number) : d.defaultZoom,
    siteZoom: siteZoom(s.siteZoom),

    notifyMail: bool(s.notifyMail, d.notifyMail),
    notifyEvents: bool(s.notifyEvents, d.notifyEvents),
    eventReminderMinutes: (REMINDER_MINUTES as readonly number[]).includes(s.eventReminderMinutes as number) ? (s.eventReminderMinutes as number) : d.eventReminderMinutes,
    offerToSavePasswords: bool(s.offerToSavePasswords, d.offerToSavePasswords),
    autofillPasswords: bool(s.autofillPasswords, d.autofillPasswords),
    saveHistory: bool(s.saveHistory, d.saveHistory),
    trackingProtection: oneOf(s.trackingProtection, ['off', 'standard', 'strict'] as const, d.trackingProtection),
    blockThirdPartyCookies: bool(s.blockThirdPartyCookies, d.blockThirdPartyCookies),
    doNotTrack: bool(s.doNotTrack, d.doNotTrack),
    httpsOnly: bool(s.httpsOnly, d.httpsOnly),
    clearCookiesOnExit: bool(s.clearCookiesOnExit, d.clearCookiesOnExit),
    clearCacheOnExit: bool(s.clearCacheOnExit, d.clearCacheOnExit),
    protectionExceptions: hostList(s.protectionExceptions),
    httpExceptions: hostList(s.httpExceptions),
    permissionDefaults: Object.fromEntries(
      ASKABLE_PERMISSIONS.map((p) => [p, oneOf<PermissionDefault>(defaults[p], ['ask', 'block'], d.permissionDefaults[p])]),
    ) as Settings['permissionDefaults'],
    sitePermissions: sitePermissions(s.sitePermissions),

    driveId: positiveInt(s.driveId),
    driveUploadFolderId: positiveInt(s.driveUploadFolderId) ?? d.driveUploadFolderId,
    driveUploadFolderName: typeof s.driveUploadFolderName === 'string' && s.driveUploadFolderName ? s.driveUploadFolderName : d.driveUploadFolderName,
    uploadDownloadsToDrive: bool(s.uploadDownloadsToDrive, d.uploadDownloadsToDrive),
  };
}
