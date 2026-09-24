import type { AskablePermission, PermissionDefault, ReaderTheme, ReaderWidth, Settings, SitePermission } from './types';
import type { SecureDnsChoice } from './secure-dns';
import { SEARCH_ENGINES, WEB_SEARCH_ENGINES } from './url';
import { ZOOM_STEPS } from './zoom';
import { DEFAULT_ACCENT, FONT_SIZES, RADIUS_RANGE, SIDE_TABS_RANGE, TOOLBAR_ITEM_IDS, UI_FONTS, validHex, type ToolbarItem, type UiFont } from './appearance';

export const REMINDER_MINUTES = [5, 10, 15, 30, 60] as const;
/** Minutes before an unused tab goes to sleep; 0 = never. */
export const SLEEP_MINUTES = [0, 15, 30, 60, 120, 240] as const;

export const ASKABLE_PERMISSIONS: readonly AskablePermission[] = ['media', 'notifications', 'geolocation'];

export const DEFAULT_SETTINGS: Settings = {
  startup: 'restore',
  searchEngine: 'ksuite',
  webSearchEngine: 'duckduckgo',
  homePage: 'https://ksuite.infomaniak.com/',
  downloadDir: null,
  askDownloadLocation: false,

  theme: 'system',
  accentColor: DEFAULT_ACCENT,
  palette: 'standard',
  backdrop: 'tint',
  density: 'normal',
  cornerRadius: 12,
  uiFont: 'inter',
  uiFontSize: 13,
  tabsLayout: 'inline',
  railPosition: 'left',
  canvasStyle: 'floating',
  appIconStyle: 'mono',
  sideTabsWidth: 240,
  sideTabsCollapsed: false,
  toolbarStart: ['back', 'forward', 'reload'],
  toolbarEnd: ['shield', 'media', 'downloads', 'tabSearch', 'panel'],
  showFullUrl: false,
  newTabBackground: 'plain',
  newTabShowGreeting: true,
  newTabShowApps: true,
  showBookmarksBar: true,
  panelOpen: true,
  newTabPage: 'newtab',
  showTopSites: true,
  hiddenTopSites: [],
  defaultZoom: 100,
  siteZoom: {},

  aiEnabled: false,
  aiProductId: null,
  aiModel: null,
  aiAutoAnswer: false,
  autoUpdate: true,
  notifyMail: true,
  notifyEvents: true,
  eventReminderMinutes: 10,
  sleepTabsAfter: 60,
  offerToSavePasswords: true,
  autofillPasswords: true,
  saveHistory: true,
  trackingProtection: 'standard',
  blockThirdPartyCookies: true,
  doNotTrack: true,
  threatProtection: true,
  breachCheckOnSave: true,
  drmEnabled: true,
  webRtcProtection: 'public',
  stripTrackingParams: true,
  secureDns: 'automatic',
  readerFontSize: 19,
  readerFont: 'serif',
  readerTheme: 'auto',
  readerWidth: 'medium',
  secureDnsCustom: '',
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

/** Known buttons, each at most once across both groups (a button moved to the other group leaves the first). */
function toolbar(value: unknown, fallback: ToolbarItem[], taken: Set<ToolbarItem>): ToolbarItem[] {
  const list = Array.isArray(value) ? value : fallback;
  const out: ToolbarItem[] = [];
  for (const v of list) {
    if (!TOOLBAR_ITEM_IDS.includes(v as ToolbarItem) || taken.has(v as ToolbarItem)) continue;
    taken.add(v as ToolbarItem);
    out.push(v as ToolbarItem);
  }
  return out;
}

const clampInt = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

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
  const taken = new Set<ToolbarItem>();
  const toolbarStart = toolbar(s.toolbarStart, d.toolbarStart, taken);
  const toolbarEnd = toolbar(s.toolbarEnd, d.toolbarEnd, taken);

  return {
    startup: oneOf(s.startup, ['home', 'restore'] as const, d.startup),
    searchEngine: oneOf(s.searchEngine, Object.keys(SEARCH_ENGINES) as Array<keyof typeof SEARCH_ENGINES>, d.searchEngine),
    // Older settings only had searchEngine: reuse it as the web engine.
    webSearchEngine: oneOf(
      s.webSearchEngine,
      Object.keys(WEB_SEARCH_ENGINES) as Array<keyof typeof WEB_SEARCH_ENGINES>,
      oneOf(s.searchEngine, Object.keys(WEB_SEARCH_ENGINES) as Array<keyof typeof WEB_SEARCH_ENGINES>, d.webSearchEngine),
    ),
    homePage: typeof s.homePage === 'string' && s.homePage.trim() ? s.homePage.trim() : d.homePage,
    downloadDir: typeof s.downloadDir === 'string' && s.downloadDir ? s.downloadDir : null,
    askDownloadLocation: bool(s.askDownloadLocation, d.askDownloadLocation),

    theme: oneOf(s.theme, ['system', 'light', 'dark'] as const, d.theme),
    accentColor: validHex(s.accentColor) ? s.accentColor.toLowerCase() : d.accentColor,
    palette: oneOf(s.palette, ['standard', 'warm', 'contrast'] as const, d.palette),
    backdrop: oneOf(s.backdrop, ['neutral', 'tint', 'gradient'] as const, d.backdrop),
    density: oneOf(s.density, ['compact', 'normal', 'comfortable'] as const, d.density),
    cornerRadius: clampInt(s.cornerRadius, RADIUS_RANGE.min, RADIUS_RANGE.max, d.cornerRadius),
    uiFont: oneOf(s.uiFont, Object.keys(UI_FONTS) as UiFont[], d.uiFont),
    uiFontSize: (FONT_SIZES as readonly number[]).includes(s.uiFontSize as number) ? (s.uiFontSize as number) : d.uiFontSize,
    tabsLayout: oneOf(s.tabsLayout, ['inline', 'top', 'side'] as const, d.tabsLayout),
    // Older settings had an on/off switch for the app bar.
    railPosition: oneOf(s.railPosition, ['left', 'right', 'hidden'] as const, (s as { showSidebar?: unknown }).showSidebar === false ? 'hidden' : d.railPosition),
    canvasStyle: oneOf(s.canvasStyle, ['floating', 'flush'] as const, d.canvasStyle),
    appIconStyle: oneOf(s.appIconStyle, ['mono', 'color'] as const, d.appIconStyle),
    sideTabsWidth: clampInt(s.sideTabsWidth, SIDE_TABS_RANGE.min, SIDE_TABS_RANGE.max, d.sideTabsWidth),
    sideTabsCollapsed: bool(s.sideTabsCollapsed, d.sideTabsCollapsed),
    toolbarStart,
    toolbarEnd,
    showFullUrl: bool(s.showFullUrl, d.showFullUrl),
    newTabBackground: oneOf(s.newTabBackground, ['plain', 'tint', 'gradient'] as const, d.newTabBackground),
    newTabShowGreeting: bool(s.newTabShowGreeting, d.newTabShowGreeting),
    newTabShowApps: bool(s.newTabShowApps, d.newTabShowApps),
    showBookmarksBar: bool(s.showBookmarksBar, d.showBookmarksBar),
    panelOpen: bool(s.panelOpen, d.panelOpen),
    newTabPage: oneOf(s.newTabPage, ['newtab', 'home'] as const, d.newTabPage),
    showTopSites: bool(s.showTopSites, d.showTopSites),
    hiddenTopSites: hostList(s.hiddenTopSites),
    defaultZoom: (ZOOM_STEPS as readonly number[]).includes(s.defaultZoom as number) ? (s.defaultZoom as number) : d.defaultZoom,
    siteZoom: siteZoom(s.siteZoom),

    aiEnabled: bool(s.aiEnabled, d.aiEnabled),
    aiProductId: positiveInt(s.aiProductId),
    aiModel: typeof s.aiModel === 'string' && s.aiModel.trim() ? s.aiModel.trim().slice(0, 200) : null,
    aiAutoAnswer: bool(s.aiAutoAnswer, d.aiAutoAnswer),
    autoUpdate: bool(s.autoUpdate, d.autoUpdate),
    notifyMail: bool(s.notifyMail, d.notifyMail),
    notifyEvents: bool(s.notifyEvents, d.notifyEvents),
    sleepTabsAfter: (SLEEP_MINUTES as readonly number[]).includes(s.sleepTabsAfter as number) ? (s.sleepTabsAfter as number) : d.sleepTabsAfter,
    eventReminderMinutes: (REMINDER_MINUTES as readonly number[]).includes(s.eventReminderMinutes as number) ? (s.eventReminderMinutes as number) : d.eventReminderMinutes,
    offerToSavePasswords: bool(s.offerToSavePasswords, d.offerToSavePasswords),
    autofillPasswords: bool(s.autofillPasswords, d.autofillPasswords),
    saveHistory: bool(s.saveHistory, d.saveHistory),
    trackingProtection: oneOf(s.trackingProtection, ['off', 'standard', 'strict'] as const, d.trackingProtection),
    blockThirdPartyCookies: bool(s.blockThirdPartyCookies, d.blockThirdPartyCookies),
    doNotTrack: bool(s.doNotTrack, d.doNotTrack),
    threatProtection: bool(s.threatProtection, d.threatProtection),
    breachCheckOnSave: bool(s.breachCheckOnSave, d.breachCheckOnSave),
    drmEnabled: bool(s.drmEnabled, d.drmEnabled),
    webRtcProtection: s.webRtcProtection === 'standard' || s.webRtcProtection === 'proxy' || s.webRtcProtection === 'public' ? s.webRtcProtection : d.webRtcProtection,
    stripTrackingParams: bool(s.stripTrackingParams, d.stripTrackingParams),
    secureDns: (['off', 'automatic', 'quad9', 'mullvad', 'cloudflare', 'custom'] as const).includes(s.secureDns as SecureDnsChoice) ? (s.secureDns as SecureDnsChoice) : d.secureDns,
    readerFontSize: typeof s.readerFontSize === 'number' && s.readerFontSize >= 14 && s.readerFontSize <= 30 ? Math.round(s.readerFontSize) : d.readerFontSize,
    readerFont: s.readerFont === 'sans' ? 'sans' : 'serif',
    readerTheme: (['auto', 'light', 'sepia', 'dark'] as const).includes(s.readerTheme as ReaderTheme) ? (s.readerTheme as ReaderTheme) : d.readerTheme,
    readerWidth: (['narrow', 'medium', 'wide'] as const).includes(s.readerWidth as ReaderWidth) ? (s.readerWidth as ReaderWidth) : d.readerWidth,
    secureDnsCustom: typeof s.secureDnsCustom === 'string' ? s.secureDnsCustom.trim().slice(0, 300) : d.secureDnsCustom,
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
