export type BrowserFamily = 'chromium' | 'firefox';

/** A profile of another browser found on this computer. */
export interface ImportSource {
  /** Stable id for the UI: browser key + profile folder. */
  id: string;
  browser: string;
  /** chrome, edge, brave, vivaldi, chromium, opera, firefox… (for the keychain and the icon). */
  key: string;
  family: BrowserFamily;
  profileName: string;
  path: string;
}

export interface ImportedBookmark {
  title: string;
  url: string;
  folder: 'bar' | 'other';
}

export interface ImportedVisit {
  url: string;
  title: string;
  visitedAt: number;
}

export interface ImportedLogin {
  url: string;
  username: string;
  password: string;
}

export interface ImportedCookie {
  domain: string;
  name: string;
  value: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  /** Seconds since 1970; undefined for session cookies. */
  expires?: number;
  sameSite: 'unspecified' | 'no_restriction' | 'lax' | 'strict';
}

export interface ImportedData {
  bookmarks?: ImportedBookmark[];
  history?: ImportedVisit[];
  logins?: ImportedLogin[];
  cookies?: ImportedCookie[];
  /** Items that could not be read (e.g. passwords protected by the system), with why. */
  skipped: Array<{ what: 'logins' | 'cookies' | 'history' | 'bookmarks'; count: number; reason: string }>;
}

export type ImportKind = 'bookmarks' | 'history' | 'logins' | 'cookies';
