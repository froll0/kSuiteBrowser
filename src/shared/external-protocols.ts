/**
 * Links that open another program (mailto:, zoommtg:, tel:…). Some schemes have been used to run code
 * or open files from a web page (Follina with ms-msdt:, search-ms:, ms-appinstaller:…): those are
 * always refused. Every other one asks first, like other browsers.
 */
const BLOCKED = new Set([
  'file', 'smb', 'nfs', 'afp', 'ftp', 'sftp', 'javascript', 'vbscript', 'data', 'jar',
  'ms-msdt', 'search-ms', 'search', 'ms-search', 'ms-officecmd', 'ms-appinstaller', 'ms-cxh', 'ms-cxh-full',
  'ms-settings', 'ms-excel', 'ms-word', 'ms-powerpoint', 'ms-access', 'ms-visio', 'ms-publisher', 'ms-project', 'ms-infopath',
  'ms-spd', 'ms-its', 'mk', 'its', 'hcp', 'help', 'res', 'shell', 'library-ms', 'ldap', 'ldaps', 'mhtml',
  'msi', 'ms-installer', 'ie.http', 'microsoft-edge', 'ms-browser-extension', 'vscode', 'vscode-insiders',
]);

export type ExternalVerdict = 'blocked' | 'ask';

export function externalScheme(url: string): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return m ? m[1].toLowerCase() : null;
}

export function externalVerdict(url: string): ExternalVerdict {
  const scheme = externalScheme(url);
  return !scheme || BLOCKED.has(scheme) ? 'blocked' : 'ask';
}

/** Name shown to the user for a scheme. */
export function externalAppName(scheme: string): string {
  const names: Record<string, string> = {
    mailto: 'l’app di posta', tel: 'l’app per le chiamate', sms: 'l’app dei messaggi', zoommtg: 'Zoom', zoomus: 'Zoom',
    msteams: 'Microsoft Teams', slack: 'Slack', spotify: 'Spotify', skype: 'Skype', tg: 'Telegram', whatsapp: 'WhatsApp',
    webcal: 'il calendario', magnet: 'il client torrent', steam: 'Steam', discord: 'Discord',
  };
  return names[scheme] ?? `l’app per i link «${scheme}:»`;
}

/** Label of a remembered site permission, including "open external app" decisions. */
export function permissionLabel(permission: string): string {
  if (permission.startsWith('external:')) return `Aprire ${externalAppName(permission.slice('external:'.length))}`;
  const labels: Record<string, string> = {
    media: 'Fotocamera e microfono',
    notifications: 'Notifiche',
    geolocation: 'Posizione',
    'clipboard-read': 'Lettura appunti',
  };
  return labels[permission] ?? permission;
}
