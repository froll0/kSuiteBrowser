import type { SearchEngineId, WebSearchEngineId } from './url';
import type { SecureDnsChoice } from './secure-dns';
import type { WebRtcProtection } from './webrtc';

export interface TabState {
  id: number;
  title: string;
  url: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
  /** Set when the tab was opened from the kSuite sidebar. */
  appId: string | null;
  /** Requests blocked by tracking protection on the current page. */
  blocked: number;
  /** False when the user turned tracking protection off for this site. */
  protectionActive: boolean;
  /** Zoom of the page, in percent. */
  zoom: number;
  bookmarked: boolean;
  pinned: boolean;
  audible: boolean;
  muted: boolean;
  /** Page closed to save memory; it reloads when shown. */
  sleeping: boolean;
  /** The page looks like an article: reader mode is offered. */
  readerable: boolean;
  /** Showing the page in reader mode (url is then the article's address). */
  reader: boolean;
  /** Played sound since the page loaded: shown in the media controls. */
  media: boolean;
  lastActiveAt: number;
}

export interface UpdateStatus {
  /** auto: download and install; notify: only tells about new versions (macOS unsigned, .deb); disabled: development build. */
  mode: 'auto' | 'notify' | 'disabled';
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'not-available' | 'error';
  current: string;
  version?: string;
  percent?: number;
  message?: string;
  releaseUrl?: string;
  checkedAt?: number;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiStatus {
  enabled: boolean;
  configured: boolean;
  productId: number | null;
  model: string | null;
}

export interface AiChatRequest {
  messages: AiMessage[];
  /** Tab whose visible text is added as context. */
  pageTabId?: number | null;
}

export interface AiEvent {
  id: string;
  delta?: string;
  done?: boolean;
  error?: string;
}

export interface TopSite {
  url: string;
  title: string;
}

export interface NewTabData {
  topSites: TopSite[];
  searchEngine: SearchEngineId;
  showTopSites: boolean;
  hiddenCount: number;
  /** Shown in a private window: nothing is suggested from history. */
  isPrivate: boolean;
}

export interface HistoryVisit {
  id: string;
  url: string;
  title: string;
  /** Epoch milliseconds. */
  visitedAt: number;
}

export type BookmarkFolder = 'bar' | 'other';

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  folder: BookmarkFolder;
  createdAt: number;
}

/** An article extracted for reader mode. `content` is the page's HTML: untrusted, sanitized before display. */
export interface ReaderArticle {
  url: string;
  title: string;
  byline: string | null;
  siteName: string | null;
  lang: string | null;
  dir: string | null;
  publishedTime: string | null;
  excerpt: string | null;
  content: string;
  length: number;
}

export type ReaderFont = 'serif' | 'sans';
export type ReaderTheme = 'auto' | 'light' | 'sepia' | 'dark';
export type ReaderWidth = 'narrow' | 'medium' | 'wide';

export interface Suggestion {
  kind: 'search' | 'url' | 'history' | 'bookmark' | 'tab';
  title: string;
  url: string;
  /** For kind 'tab': the open tab to switch to. */
  tabId?: number;
}

/** Result of the breached-password check: times each saved login's password appears in known breaches. */
export interface BreachReport {
  checkedAt: number | null;
  /** Login id → count (0 = not found). Logins changed since the check are missing. */
  results: Record<string, number>;
}

export interface SavedLogin {
  id: string;
  /** scheme://host[:port] the login belongs to. */
  origin: string;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  timesUsed: number;
}

export interface VaultStatus {
  /** needs-setup: no OS keychain and no primary password yet, so nothing can be stored safely. */
  state: 'unlocked' | 'locked' | 'needs-setup';
  hasPrimary: boolean;
  keychainAvailable: boolean;
  count: number | null;
}

/** A site (or proxy) asking for HTTP authentication. */
export interface AuthPrompt {
  id: string;
  tabId: number | null;
  host: string;
  realm: string;
  isProxy: boolean;
  /** true when the prompt was withdrawn (tab closed or navigated away). */
  cancelled?: boolean;
}

export interface PasswordPrompt {
  id: string;
  tabId: number;
  origin: string;
  username: string;
  kind: 'save' | 'update';
}

export interface FindResult {
  tabId: number;
  active: number;
  total: number;
}

export type TrackingProtection = 'off' | 'standard' | 'strict';
export type ThemeSource = 'system' | 'light' | 'dark';
export type StartupMode = 'home' | 'restore';
export type AskablePermission = 'media' | 'notifications' | 'geolocation';
export type PermissionDefault = 'ask' | 'block';

export interface SitePermission {
  host: string;
  permission: string;
  allowed: boolean;
}

export interface Settings {
  // Generale
  startup: StartupMode;
  searchEngine: SearchEngineId;
  /** Engine for the web part of the kSuite search (and when kSuite search is off). */
  webSearchEngine: WebSearchEngineId;
  homePage: string;
  /** null = the system Downloads folder. */
  downloadDir: string | null;
  askDownloadLocation: boolean;

  // Aspetto
  theme: ThemeSource;
  showSidebar: boolean;
  showBookmarksBar: boolean;
  panelOpen: boolean;
  /** What Ctrl+T and the + button open. */
  newTabPage: 'newtab' | 'home';
  showTopSites: boolean;
  /** Origins removed from the new tab page by the user. */
  hiddenTopSites: string[];
  /** Zoom for sites without their own level, in percent. */
  defaultZoom: number;
  /** Zoom chosen by the user per host, in percent. */
  siteZoom: Record<string, number>;

  // Intelligenza artificiale (Infomaniak AI Services)
  aiEnabled: boolean;
  /** AI product of the account; null = the first one returned by the API. */
  aiProductId: number | null;
  /** Model name; null = a sensible default from the catalogue. */
  aiModel: string | null;
  /** Generate the AI answer on the search page without clicking (uses credits on every search). */
  aiAutoAnswer: boolean;

  // Aggiornamenti
  /** Download updates in the background and install them at the next restart. */
  autoUpdate: boolean;

  // Notifiche
  notifyMail: boolean;
  notifyEvents: boolean;
  /** Minutes before an event starts when the reminder shows up. */
  eventReminderMinutes: number;
  /** Minutes before an unused background tab sleeps (0 = never). */
  sleepTabsAfter: number;

  // Password
  offerToSavePasswords: boolean;
  /** Fill the login form when a page has exactly one saved login. */
  autofillPasswords: boolean;

  // Privacy e sicurezza
  /** Record visited pages (never in private windows). */
  saveHistory: boolean;
  trackingProtection: TrackingProtection;
  blockThirdPartyCookies: boolean;
  /** Sends the DNT and Sec-GPC headers. */
  doNotTrack: boolean;
  /** Stop known phishing and malware sites and downloads. */
  threatProtection: boolean;
  /** Warn when a password being saved appears in known data breaches. */
  breachCheckOnSave: boolean;
  /** Let streaming services play DRM-protected content (Widevine). */
  drmEnabled: boolean;
  /** What WebRTC may reveal about the network (see shared/webrtc.ts). */
  webRtcProtection: WebRtcProtection;
  /** Remove utm_*, fbclid, gclid… from the addresses of the pages opened. */
  stripTrackingParams: boolean;
  /** DNS over HTTPS provider. */
  secureDns: SecureDnsChoice;
  /** DoH address when secureDns is 'custom'. */
  secureDnsCustom: string;
  /** Reader mode typography. */
  readerFontSize: number;
  readerFont: ReaderFont;
  readerTheme: ReaderTheme;
  readerWidth: ReaderWidth;
  httpsOnly: boolean;
  clearCookiesOnExit: boolean;
  clearCacheOnExit: boolean;
  /** Sites (registrable domains) where tracking protection is turned off. */
  protectionExceptions: string[];
  /** Hosts allowed to load over plain HTTP despite HTTPS-only mode. */
  httpExceptions: string[];
  permissionDefaults: Record<AskablePermission, PermissionDefault>;
  sitePermissions: SitePermission[];

  // kSuite
  /** kDrive used by the integration; null = first drive returned by the API. */
  driveId: number | null;
  /** Destination folder for "save to kDrive" actions (1 = drive root). */
  driveUploadFolderId: number;
  driveUploadFolderName: string;
  /** Upload every completed download to kDrive. */
  uploadDownloadsToDrive: boolean;
}

export interface TokenStatus {
  configured: boolean;
  /** False when the OS keychain is unavailable and the token is stored in clear text. */
  encrypted: boolean;
  fromEnv: boolean;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Profile {
  id: number;
  displayName: string;
  email: string;
  avatar: string | null;
  timezone: string | null;
}

export interface Drive {
  id: number;
  name: string;
}

export interface DriveFile {
  id: number;
  name: string;
  type: 'dir' | 'file' | string;
  size: number | null;
  lastModified: number | null;
  mimeType: string | null;
  parentId: number | null;
}

export interface DriveListing {
  files: DriveFile[];
  cursor: string | null;
  hasMore: boolean;
}

export interface Mailbox {
  uuid: string;
  email: string;
}

export interface MailThread {
  uid: string;
  subject: string;
  from: string;
  date: string;
  preview: string;
  unseen: number;
}

export interface MailOverview {
  mailbox: Mailbox;
  inboxUnread: number;
  threads: MailThread[];
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  fullday: boolean;
  location: string | null;
}

export interface NewEvent {
  title: string;
  /** ISO datetime strings. */
  start: string;
  end: string;
  description?: string;
}

export interface BrowsingDataSelection {
  history: boolean;
  cookies: boolean;
  cache: boolean;
  downloads: boolean;
  permissions: boolean;
}

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userData: string;
  blockerLists: string | null;
}

export interface DownloadItemState {
  id: string;
  filename: string;
  path: string;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  received: number;
  total: number;
  drive: 'idle' | 'uploading' | 'uploaded' | 'error';
  driveError?: string;
  /** Why the browser stopped it (known malware, refused dangerous file). */
  blocked?: string;
}

/** Result envelope used by every API call exposed to the renderer. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** An open tab in the tab search popup. */
export interface TabSearchItem {
  tabId: number;
  title: string;
  url: string;
  favicon: string | null;
  active: boolean;
  sleeping: boolean;
  audible: boolean;
  /** In another window than the one searching. */
  otherWindow: boolean;
  lastActiveAt: number;
}

export interface TabSearchData {
  tabs: TabSearchItem[];
  /** Recently closed tabs of this window, most recent first; `index` is what reopen() takes. */
  closed: Array<{ index: number; title: string; url: string }>;
  /** Open tabs of the other devices (sync). */
  remote: RemoteTabs[];
  theme: string;
  /** Focus the search field (first open) or keep the current query (refresh after closing a tab). */
  reset: boolean;
}

export type SyncCollectionOption = 'bookmarks' | 'logins' | 'history' | 'tabs';

/** State of the encrypted kDrive sync, for the settings page. */
export interface SyncStatus {
  /** kSuite account connected (sync needs kDrive). */
  available: boolean;
  enabled: boolean;
  /** off · needs-passphrase (key not stored on this computer) · idle · syncing · error */
  state: 'off' | 'needs-passphrase' | 'idle' | 'syncing' | 'error';
  deviceName: string;
  collections: Record<SyncCollectionOption, boolean>;
  lastSync: number | null;
  lastError: string | null;
  devices: Array<{ id: string; name: string; updatedAt: number; current: boolean; tabs: number }>;
  /** Password vault locked: passwords wait for the next sync after unlocking. */
  passwordsWaiting: boolean;
}

/** Open tabs of another device, from the last sync. */
export interface RemoteTabs {
  device: string;
  updatedAt: number;
  tabs: Array<{ title: string; url: string }>;
}
