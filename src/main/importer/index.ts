import type { Session } from 'electron';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readChromiumProfile } from './chromium';
import { readFirefoxProfile } from './firefox';
import type { ImportedData, ImportKind, ImportSource } from './types';

interface BrowserDef {
  key: string;
  name: string;
  /** Folder of the user data (Chromium) or of the profiles (Firefox), per system. */
  dirs: Partial<Record<NodeJS.Platform, string[]>>;
  family: 'chromium' | 'firefox';
}

function browsers(): BrowserDef[] {
  const home = homedir();
  const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  const mac = join(home, 'Library', 'Application Support');
  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  return [
    { key: 'chrome', name: 'Google Chrome', family: 'chromium', dirs: { win32: [join(local, 'Google', 'Chrome', 'User Data')], darwin: [join(mac, 'Google', 'Chrome')], linux: [join(config, 'google-chrome')] } },
    { key: 'edge', name: 'Microsoft Edge', family: 'chromium', dirs: { win32: [join(local, 'Microsoft', 'Edge', 'User Data')], darwin: [join(mac, 'Microsoft Edge')], linux: [join(config, 'microsoft-edge')] } },
    { key: 'brave', name: 'Brave', family: 'chromium', dirs: { win32: [join(local, 'BraveSoftware', 'Brave-Browser', 'User Data')], darwin: [join(mac, 'BraveSoftware', 'Brave-Browser')], linux: [join(config, 'BraveSoftware', 'Brave-Browser')] } },
    { key: 'vivaldi', name: 'Vivaldi', family: 'chromium', dirs: { win32: [join(local, 'Vivaldi', 'User Data')], darwin: [join(mac, 'Vivaldi')], linux: [join(config, 'vivaldi')] } },
    { key: 'opera', name: 'Opera', family: 'chromium', dirs: { win32: [join(roaming, 'Opera Software', 'Opera Stable')], darwin: [join(mac, 'com.operasoftware.Opera')], linux: [join(config, 'opera')] } },
    { key: 'chromium', name: 'Chromium', family: 'chromium', dirs: { win32: [join(local, 'Chromium', 'User Data')], darwin: [join(mac, 'Chromium')], linux: [join(config, 'chromium'), join(home, 'snap', 'chromium', 'common', 'chromium')] } },
    {
      key: 'firefox', name: 'Mozilla Firefox', family: 'firefox',
      dirs: { win32: [join(roaming, 'Mozilla', 'Firefox', 'Profiles')], darwin: [join(mac, 'Firefox', 'Profiles')], linux: [join(home, '.mozilla', 'firefox'), join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox'), join(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox')] },
    },
  ];
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Profiles of Chromium browsers: "Default", "Profile 1"… with their names from "Local State". */
function chromiumProfiles(def: BrowserDef, root: string): ImportSource[] {
  let names: Record<string, { name?: string }> = {};
  try {
    names = (JSON.parse(readFileSync(join(root, 'Local State'), 'utf8')) as { profile?: { info_cache?: typeof names } }).profile?.info_cache ?? {};
  } catch {
    /* names unknown */
  }
  // Opera keeps a single profile in the root folder itself.
  const isProfile = (dir: string) => ['Preferences', 'Bookmarks', 'History', 'Login Data', 'Cookies'].some((f) => existsSync(join(dir, f)));
  const folders = isProfile(root) && !existsSync(join(root, 'Default')) ? [''] : readdirSync(root).filter((d) => (d === 'Default' || /^Profile \d+$/.test(d)) && isProfile(join(root, d)));
  return folders.map((folder) => ({
    id: `${def.key}:${folder || '.'}`,
    browser: def.name,
    key: def.key,
    family: 'chromium' as const,
    profileName: names[folder]?.name || folder || def.name,
    path: folder ? join(root, folder) : root,
  }));
}

/** Firefox profiles: folders with a places.sqlite, named after profiles.ini when possible. */
function firefoxProfiles(def: BrowserDef, root: string): ImportSource[] {
  const names = new Map<string, string>();
  const iniDir = root.endsWith('Profiles') ? join(root, '..') : root;
  try {
    let name = '';
    for (const line of readFileSync(join(iniDir, 'profiles.ini'), 'utf8').split(/\r?\n/)) {
      if (line.startsWith('Name=')) name = line.slice(5);
      if (line.startsWith('Path=')) names.set(line.slice(5).replace(/^Profiles\//, ''), name);
    }
  } catch {
    /* names unknown */
  }
  return readdirSync(root)
    .filter((d) => existsSync(join(root, d, 'places.sqlite')))
    .map((d) => ({ id: `${def.key}:${d}`, browser: def.name, key: def.key, family: 'firefox' as const, profileName: names.get(d) || d.replace(/^[a-z0-9]+\./, ''), path: join(root, d) }));
}

/** Other browsers' profiles found on this computer. */
export function detectSources(): ImportSource[] {
  const out: ImportSource[] = [];
  for (const def of browsers()) {
    for (const root of def.dirs[process.platform] ?? []) {
      if (!isDir(root)) continue;
      try {
        out.push(...(def.family === 'chromium' ? chromiumProfiles(def, root) : firefoxProfiles(def, root)));
      } catch {
        /* unreadable folder */
      }
    }
  }
  return out;
}

export function readSource(source: ImportSource, kinds: ImportKind[]): ImportedData {
  return source.family === 'firefox' ? readFirefoxProfile(source, kinds) : readChromiumProfile(source, kinds);
}

/** Puts imported cookies in a session; returns how many were accepted. */
export async function importCookies(session: Session, cookies: NonNullable<ImportedData['cookies']>): Promise<number> {
  let count = 0;
  for (const c of cookies) {
    const host = c.domain.replace(/^\./, '');
    if (!host) continue;
    try {
      await session.cookies.set({
        url: `${c.secure ? 'https' : 'http'}://${host}${c.path.startsWith('/') ? c.path : '/'}`,
        name: c.name,
        value: c.value,
        // A leading dot means "and its subdomains"; without it the cookie is for that host only.
        ...(c.domain.startsWith('.') ? { domain: c.domain } : {}),
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        ...(c.expires ? { expirationDate: c.expires } : {}),
      });
      count++;
    } catch {
      /* refused by Chromium (invalid name, __Host- rules…) */
    }
  }
  return count;
}

export type { ImportSource, ImportKind, ImportedData } from './types';
