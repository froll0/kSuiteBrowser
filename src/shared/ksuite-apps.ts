/** Web apps of the kSuite, opened as pinned tabs from the sidebar. */
export interface KSuiteApp {
  id: string;
  name: string;
  url: string;
  /** Short label shown in the sidebar icon. */
  glyph: string;
  color: string;
}

export const KSUITE_APPS: readonly KSuiteApp[] = [
  { id: 'home', name: 'kSuite', url: 'https://ksuite.infomaniak.com/', glyph: 'k', color: '#0098ff' },
  { id: 'mail', name: 'Mail', url: 'https://mail.infomaniak.com/', glyph: 'M', color: '#0098ff' },
  { id: 'drive', name: 'kDrive', url: 'https://kdrive.infomaniak.com/', glyph: 'D', color: '#0098ff' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.infomaniak.com/', glyph: 'C', color: '#3cb371' },
  { id: 'contacts', name: 'Contacts', url: 'https://contacts.infomaniak.com/', glyph: 'R', color: '#8e44ad' },
  { id: 'kchat', name: 'kChat', url: 'https://kchat.infomaniak.com/', glyph: 'Ch', color: '#f06a2c' },
  { id: 'kmeet', name: 'kMeet', url: 'https://kmeet.infomaniak.com/', glyph: 'Me', color: '#e91e63' },
  { id: 'euria', name: 'Euria', url: 'https://euria.infomaniak.com/', glyph: 'AI', color: '#5c6bc0' },
  { id: 'swisstransfer', name: 'SwissTransfer', url: 'https://www.swisstransfer.com/', glyph: 'ST', color: '#e53935' },
];

/** Hosts that belong to the suite: they get media/notification permissions without prompting. */
export function isTrustedSuiteHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'infomaniak.com' || h.endsWith('.infomaniak.com') || h === 'swisstransfer.com' || h.endsWith('.swisstransfer.com');
}
