import type { SearchEngineId } from './url';

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
  homePage: string;
  /** null = the system Downloads folder. */
  downloadDir: string | null;
  askDownloadLocation: boolean;

  // Aspetto
  theme: ThemeSource;
  showSidebar: boolean;
  showBookmarksBar: boolean;
  panelOpen: boolean;
  /** Zoom for sites without their own level, in percent. */
  defaultZoom: number;
  /** Zoom chosen by the user per host, in percent. */
  siteZoom: Record<string, number>;

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
