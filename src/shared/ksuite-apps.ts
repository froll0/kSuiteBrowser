/** Web apps of the kSuite, opened as tabs from the sidebar. */
export interface KSuiteApp {
  id: string;
  name: string;
  url: string;
  /** Icon name from src/renderer/icons.ts (generic pictograms, not Infomaniak's trademarks). */
  icon: 'grid' | 'mail' | 'cloud' | 'calendar' | 'bookUser' | 'chat' | 'video' | 'sparkles' | 'send';
}

export const KSUITE_APPS: readonly KSuiteApp[] = [
  { id: 'home', name: 'kSuite', url: 'https://ksuite.infomaniak.com/', icon: 'grid' },
  { id: 'mail', name: 'Mail', url: 'https://mail.infomaniak.com/', icon: 'mail' },
  { id: 'drive', name: 'kDrive', url: 'https://kdrive.infomaniak.com/', icon: 'cloud' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.infomaniak.com/', icon: 'calendar' },
  { id: 'contacts', name: 'Contacts', url: 'https://contacts.infomaniak.com/', icon: 'bookUser' },
  { id: 'kchat', name: 'kChat', url: 'https://kchat.infomaniak.com/', icon: 'chat' },
  { id: 'kmeet', name: 'kMeet', url: 'https://kmeet.infomaniak.com/', icon: 'video' },
  { id: 'euria', name: 'Euria', url: 'https://euria.infomaniak.com/', icon: 'sparkles' },
  { id: 'swisstransfer', name: 'SwissTransfer', url: 'https://www.swisstransfer.com/', icon: 'send' },
];

/** Hosts that belong to the suite: they get media/notification permissions without prompting. */
export function isTrustedSuiteHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'infomaniak.com' || h.endsWith('.infomaniak.com') || h === 'swisstransfer.com' || h.endsWith('.swisstransfer.com');
}
