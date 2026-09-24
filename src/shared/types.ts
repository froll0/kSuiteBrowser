import type { SearchEngineId, WebSearchEngineId } from './url';

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

export interface Suggestion {
  kind: 'search' | 'url' | 'history' | 'bookmark';
  title: string;
  url: string;
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
  theme: string;
  /** Focus the search field (first open) or keep the current query (refresh after closing a tab). */
  reset: boolean;
}
