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
}

export interface Settings {
  searchEngine: SearchEngineId;
  homePage: string;
  /** kDrive used by the integration; null = first drive returned by the API. */
  driveId: number | null;
  /** Destination folder for "save to kDrive" actions (1 = drive root). */
  driveUploadFolderId: number;
  driveUploadFolderName: string;
  /** Upload every completed download to kDrive. */
  uploadDownloadsToDrive: boolean;
  panelOpen: boolean;
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
