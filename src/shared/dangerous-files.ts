import { tr } from './i18n';
/** File types that can run code when opened: downloading them needs a confirmation. */
const KINDS: Array<[string, string[]]> = [
  [tr('un programma'), ['exe', 'msi', 'msix', 'msixbundle', 'appx', 'appxbundle', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'app', 'apk', 'appimage', 'run', 'bin']],
  [tr('un pacchetto di installazione'), ['dmg', 'pkg', 'mpkg', 'deb', 'rpm', 'snap', 'flatpakref']],
  [tr('uno script'), ['bat', 'cmd', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'sh', 'command', 'jar', 'py', 'reg', 'scf', 'inf']],
  [tr('un collegamento a un programma'), ['lnk', 'url', 'desktop', 'webloc']],
  [tr('un’immagine disco'), ['iso', 'img', 'vhd', 'vhdx']],
  [tr('un documento con macro'), ['docm', 'xlsm', 'pptm', 'dotm', 'xltm', 'xlam', 'ppam']],
];

/** How to describe a dangerous file ("un programma"…), or null for ordinary files. */
export function dangerousFileKind(filename: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(filename.trim())?.[1]?.toLowerCase();
  if (!ext) return null;
  for (const [kind, exts] of KINDS) if (exts.includes(ext)) return kind;
  return null;
}
