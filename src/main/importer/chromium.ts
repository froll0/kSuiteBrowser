import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withDatabaseCopy } from './sqlite';
import { tr } from '../../shared/i18n';
import type { ImportedBookmark, ImportedCookie, ImportedData, ImportedLogin, ImportedVisit, ImportKind, ImportSource } from './types';

/** Chromium times: microseconds since 1601-01-01. */
const EPOCH_DELTA_US = 11_644_473_600_000_000n;

export function chromeTimeToMs(value: number | bigint | string): number {
  const v = BigInt(value);
  if (v <= 0n) return 0;
  return Number((v - EPOCH_DELTA_US) / 1000n);
}

// ---------- Bookmarks ----------

interface BookmarkNode {
  type?: string;
  name?: string;
  url?: string;
  children?: BookmarkNode[];
}

/** The "Bookmarks" JSON file: the bar keeps its place, everything else goes to "other". */
export function parseChromiumBookmarks(json: string): ImportedBookmark[] {
  const out: ImportedBookmark[] = [];
  let data: { roots?: Record<string, BookmarkNode> };
  try {
    data = JSON.parse(json);
  } catch {
    return out;
  }
  const walk = (node: BookmarkNode | undefined, folder: 'bar' | 'other') => {
    if (!node) return;
    if (node.type === 'url' && node.url && /^(https?|file):/i.test(node.url)) out.push({ title: node.name ?? node.url, url: node.url, folder });
    for (const child of node.children ?? []) walk(child, folder);
  };
  walk(data.roots?.bookmark_bar, 'bar');
  for (const [key, node] of Object.entries(data.roots ?? {})) if (key !== 'bookmark_bar') walk(node, 'other');
  return out;
}

// ---------- Decryption of passwords and cookies ----------

/** Key that decrypts "v10"/"v11" values; null when the system keeps it out of reach. */
export interface ChromiumKeys {
  v10: Buffer | null;
  v11: Buffer | null;
  /** Windows: the AES-256-GCM key from "Local State". */
  gcm: Buffer | null;
}

const KEYCHAIN_NAMES: Record<string, { mac: string; linux: string }> = {
  chrome: { mac: 'Chrome', linux: 'chrome' },
  chromium: { mac: 'Chromium', linux: 'chromium' },
  edge: { mac: 'Microsoft Edge', linux: 'chromium' },
  brave: { mac: 'Brave', linux: 'brave' },
  vivaldi: { mac: 'Vivaldi', linux: 'vivaldi' },
  opera: { mac: 'Opera', linux: 'chromium' },
};

/** Linux and macOS: AES-128-CBC with a key derived from a password ("peanuts" when no keyring was used). */
export function cbcKey(password: string, iterations: number): Buffer {
  return pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1');
}

function tryRun(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/** Reads the keys of a browser, asking the system where it holds them (macOS shows its own permission prompt). */
export function chromiumKeys(source: ImportSource): ChromiumKeys {
  const names = KEYCHAIN_NAMES[source.key] ?? KEYCHAIN_NAMES.chromium;
  if (process.platform === 'darwin') {
    const password = tryRun('security', ['find-generic-password', '-w', '-s', `${names.mac} Safe Storage`]);
    return { v10: password ? cbcKey(password, 1003) : null, v11: null, gcm: null };
  }
  if (process.platform === 'linux') {
    const secret = tryRun('secret-tool', ['lookup', 'application', names.linux]) ?? tryRun('secret-tool', ['lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2', 'application', names.linux]);
    return { v10: cbcKey('peanuts', 1), v11: secret ? cbcKey(secret, 1) : null, gcm: null };
  }
  if (process.platform === 'win32') return { v10: null, v11: null, gcm: windowsKey(join(source.path, '..', 'Local State')) };
  return { v10: null, v11: null, gcm: null };
}

/** Windows: the browser's key, protected by the user's Windows account (DPAPI), unwrapped with PowerShell. */
function windowsKey(localStatePath: string): Buffer | null {
  try {
    const state = JSON.parse(readFileSync(localStatePath, 'utf8')) as { os_crypt?: { encrypted_key?: string } };
    const wrapped = Buffer.from(state.os_crypt?.encrypted_key ?? '', 'base64');
    if (wrapped.subarray(0, 5).toString() !== 'DPAPI') return null;
    const script = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${wrapped.subarray(5).toString('base64')}'), $null, 'CurrentUser'))`;
    const out = tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    return out ? Buffer.from(out, 'base64') : null;
  } catch {
    return null;
  }
}

export type DecryptResult = { ok: true; value: Buffer } | { ok: false; reason: 'app-bound' | 'no-key' | 'corrupt' };

/** Decrypts a value from "Login Data" or "Cookies". */
export function decryptChromium(blob: Uint8Array, keys: ChromiumKeys): DecryptResult {
  const data = Buffer.from(blob);
  const prefix = data.subarray(0, 3).toString('latin1');
  try {
    if (prefix === 'v20') return { ok: false, reason: 'app-bound' };
    if ((prefix === 'v10' || prefix === 'v11') && keys.gcm) {
      const nonce = data.subarray(3, 15);
      const tag = data.subarray(data.length - 16);
      const decipher = createDecipheriv('aes-256-gcm', keys.gcm, nonce);
      decipher.setAuthTag(tag);
      return { ok: true, value: Buffer.concat([decipher.update(data.subarray(15, data.length - 16)), decipher.final()]) };
    }
    const key = prefix === 'v11' ? keys.v11 : prefix === 'v10' ? keys.v10 : null;
    if (prefix !== 'v10' && prefix !== 'v11') return data.length ? { ok: true, value: data } : { ok: true, value: Buffer.alloc(0) };
    if (!key) return { ok: false, reason: 'no-key' };
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    return { ok: true, value: Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]) };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

const reasons = (): Record<string, string> => ({
  'app-bound': tr('protetti dalla crittografia legata all’app (Chrome 127 e successivi su Windows): esportali in un file CSV dal browser'),
  'no-key': tr('il sistema non ha dato la chiave del browser'),
  corrupt: tr('non leggibili'),
});

// ---------- Reading a profile ----------

export function readChromiumProfile(source: ImportSource, kinds: ImportKind[]): ImportedData {
  const result: ImportedData = { skipped: [] };
  const dir = source.path;
  if (kinds.includes('bookmarks') && existsSync(join(dir, 'Bookmarks'))) result.bookmarks = parseChromiumBookmarks(readFileSync(join(dir, 'Bookmarks'), 'utf8'));
  if (kinds.includes('history')) {
    result.history = withDatabaseCopy(join(dir, 'History'), (db) =>
      (db.prepare('SELECT url, title, CAST(last_visit_time AS TEXT) AS t FROM urls WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT 50000').all() as Array<{ url: string; title: string; t: string }>)
        .filter((r) => /^https?:/i.test(r.url))
        .map((r): ImportedVisit => ({ url: r.url, title: r.title ?? '', visitedAt: chromeTimeToMs(r.t) })),
    ) ?? [];
  }
  const needKeys = kinds.includes('logins') || kinds.includes('cookies');
  const keys = needKeys ? chromiumKeys(source) : { v10: null, v11: null, gcm: null };
  const failures = new Map<string, Map<string, number>>();
  const fail = (what: string, reason: string) => {
    const m = failures.get(what) ?? new Map<string, number>();
    m.set(reason, (m.get(reason) ?? 0) + 1);
    failures.set(what, m);
  };
  if (kinds.includes('logins')) {
    result.logins = withDatabaseCopy(join(dir, 'Login Data'), (db) => {
      const out: ImportedLogin[] = [];
      for (const r of db.prepare("SELECT origin_url AS url, username_value AS username, password_value AS pw FROM logins WHERE blacklisted_by_user = 0 AND origin_url LIKE 'http%'").all() as Array<{ url: string; username: string; pw: Uint8Array }>) {
        const d = decryptChromium(r.pw, keys);
        if (d.ok) out.push({ url: r.url, username: r.username ?? '', password: d.value.toString('utf8') });
        else fail('logins', d.reason);
      }
      return out;
    }) ?? [];
  }
  if (kinds.includes('cookies')) {
    const file = existsSync(join(dir, 'Network', 'Cookies')) ? join(dir, 'Network', 'Cookies') : join(dir, 'Cookies');
    result.cookies = withDatabaseCopy(file, (db) => {
      // From version 24 the decrypted value starts with a SHA-256 of the cookie's domain.
      let version = 0;
      try {
        version = Number((db.prepare("SELECT value FROM meta WHERE key = 'version'").get() as { value?: string } | undefined)?.value ?? 0);
      } catch {
        /* old database */
      }
      const now = Date.now() / 1000;
      const out: ImportedCookie[] = [];
      const rows = db.prepare('SELECT host_key AS host, name, value, encrypted_value AS enc, path, CAST(expires_utc AS TEXT) AS exp, is_secure AS secure, is_httponly AS httponly, samesite FROM cookies').all() as Array<{
        host: string; name: string; value: string; enc: Uint8Array; path: string; exp: string; secure: number; httponly: number; samesite: number;
      }>;
      for (const r of rows) {
        let value = r.value ?? '';
        if (!value && r.enc?.length) {
          const d = decryptChromium(r.enc, keys);
          if (!d.ok) {
            fail('cookies', d.reason);
            continue;
          }
          value = (version >= 24 ? d.value.subarray(32) : d.value).toString('utf8');
        }
        const expires = BigInt(r.exp || 0) > 0n ? chromeTimeToMs(r.exp) / 1000 : undefined;
        if (expires !== undefined && expires < now) continue;
        out.push({
          domain: r.host, name: r.name, value, path: r.path || '/', secure: Boolean(r.secure), httpOnly: Boolean(r.httponly), expires,
          sameSite: r.samesite === 0 ? 'no_restriction' : r.samesite === 1 ? 'lax' : r.samesite === 2 ? 'strict' : 'unspecified',
        });
      }
      return out;
    }) ?? [];
  }
  const why = reasons();
  for (const [what, counts] of failures) for (const [reason, count] of counts) result.skipped.push({ what: what as 'logins' | 'cookies', count, reason: why[reason] ?? reason });
  return result;
}
