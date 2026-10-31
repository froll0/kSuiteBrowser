import { createDecipheriv, createHash, createHmac, pbkdf2Sync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withDatabaseCopy } from './sqlite';
import { tr } from '../../shared/i18n';
import type { ImportedBookmark, ImportedCookie, ImportedData, ImportedLogin, ImportedVisit, ImportKind, ImportSource } from './types';

// ---------- A minimal DER reader (what NSS stores is small and well formed) ----------

export interface Der {
  tag: number;
  /** Content bytes. */
  value: Buffer;
  children: Der[];
}

export function parseDer(buf: Buffer, offset = 0, end = buf.length): Der[] {
  const out: Der[] = [];
  let i = offset;
  while (i < end) {
    const tag = buf[i++];
    let len = buf[i++];
    if (len & 0x80) {
      const n = len & 0x7f;
      len = 0;
      for (let k = 0; k < n; k++) len = len * 256 + buf[i++];
    }
    const value = buf.subarray(i, i + len);
    out.push({ tag, value, children: tag & 0x20 ? parseDer(buf, i, i + len) : [] });
    i += len;
  }
  return out;
}

export function oidString(value: Buffer): string {
  const parts = [Math.floor(value[0] / 40), value[0] % 40];
  let n = 0;
  for (const b of value.subarray(1)) {
    n = n * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      parts.push(n);
      n = 0;
    }
  }
  return parts.join('.');
}

const OID = {
  pbes2: '1.2.840.113549.1.5.13',
  pbeSha1TripleDes: '1.2.840.113549.1.12.5.1.3',
  aes256cbc: '2.16.840.1.101.3.4.1.42',
  desEde3cbc: '1.2.840.113549.3.7',
};

function unpad(buf: Buffer): Buffer {
  const n = buf[buf.length - 1];
  return n > 0 && n <= 16 ? buf.subarray(0, buf.length - n) : buf;
}

/** Decrypts an NSS "encrypted private key info" (PBES2 with AES, or the older SHA-1 + 3DES scheme). */
export function nssDecrypt(item: Buffer, globalSalt: Buffer, primaryPassword = ''): Buffer {
  const [top] = parseDer(item);
  const [algo, cipherText] = top.children;
  const oid = oidString(algo.children[0].value);
  if (oid === OID.pbes2) {
    const [kdf, enc] = algo.children[1].children;
    const [salt, iter, keyLen] = kdf.children[1].children;
    const iterations = parseInt(iter.value.toString('hex'), 16);
    const length = keyLen && keyLen.tag === 0x02 ? parseInt(keyLen.value.toString('hex'), 16) : 32;
    const password = createHash('sha1').update(Buffer.concat([globalSalt, Buffer.from(primaryPassword, 'utf8')])).digest();
    const key = pbkdf2Sync(password, salt.value, iterations, length, 'sha256');
    // NSS stores a 14-byte IV: the real one is prefixed with the DER header 04 0e.
    const iv = Buffer.concat([Buffer.from([0x04, 0x0e]), enc.children[1].value]);
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(false);
    return unpad(Buffer.concat([decipher.update(cipherText.value), decipher.final()]));
  }
  if (oid === OID.pbeSha1TripleDes) {
    const entrySalt = algo.children[1].children[0].value;
    const hp = createHash('sha1').update(Buffer.concat([globalSalt, Buffer.from(primaryPassword, 'utf8')])).digest();
    const pes = Buffer.concat([entrySalt, Buffer.alloc(Math.max(0, 20 - entrySalt.length))]);
    const chp = createHash('sha1').update(Buffer.concat([hp, entrySalt])).digest();
    const k1 = createHmac('sha1', chp).update(Buffer.concat([pes, entrySalt])).digest();
    const tk = createHmac('sha1', chp).update(pes).digest();
    const k2 = createHmac('sha1', chp).update(Buffer.concat([tk, entrySalt])).digest();
    const k = Buffer.concat([k1, k2]);
    const decipher = createDecipheriv('des-ede3-cbc', k.subarray(0, 24), k.subarray(k.length - 8));
    decipher.setAutoPadding(false);
    return unpad(Buffer.concat([decipher.update(cipherText.value), decipher.final()]));
  }
  throw new Error(`unsupported ${oid}`);
}

/** The key that encrypts the saved logins, from key4.db; null when a primary password protects it. */
export function firefoxMasterKey(db: { prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } }): Buffer | null {
  const meta = db.prepare("SELECT item1, item2 FROM metaData WHERE id = 'password'").get() as { item1: Uint8Array; item2: Uint8Array } | undefined;
  if (!meta) return null;
  const globalSalt = Buffer.from(meta.item1);
  try {
    if (nssDecrypt(Buffer.from(meta.item2), globalSalt).toString('latin1') !== 'password-check') return null;
  } catch {
    return null;
  }
  for (const row of db.prepare('SELECT a11 FROM nssPrivate').all() as Array<{ a11: Uint8Array }>) {
    try {
      const key = nssDecrypt(Buffer.from(row.a11), globalSalt);
      if (key.length >= 24) return key;
    } catch {
      /* next */
    }
  }
  return null;
}

/** Decrypts a value of logins.json (base64 DER: key id, algorithm and IV, cipher text). */
export function decryptLoginField(b64: string, key: Buffer): string {
  const [top] = parseDer(Buffer.from(b64, 'base64'));
  const [, algo, cipherText] = top.children;
  const oid = oidString(algo.children[0].value);
  const iv = algo.children[1].value;
  const decipher = oid === OID.aes256cbc ? createDecipheriv('aes-256-cbc', key.subarray(0, 32), iv) : createDecipheriv('des-ede3-cbc', key.subarray(0, 24), iv);
  decipher.setAutoPadding(false);
  return unpad(Buffer.concat([decipher.update(cipherText.value), decipher.final()])).toString('utf8');
}

// ---------- Reading a profile ----------

const firefoxTime = (us: number | bigint | string | null) => (us ? Number(BigInt(us) / 1000n) : 0);

export function readFirefoxProfile(source: ImportSource, kinds: ImportKind[]): ImportedData {
  const result: ImportedData = { skipped: [] };
  const dir = source.path;
  if (kinds.includes('bookmarks') || kinds.includes('history')) {
    withDatabaseCopy(join(dir, 'places.sqlite'), (db) => {
      if (kinds.includes('bookmarks')) {
        const toolbar = (db.prepare("SELECT id FROM moz_bookmarks WHERE guid = 'toolbar_____'").get() as { id?: number } | undefined)?.id ?? -1;
        // Folder of each bookmark, to know which ones are in (or under) the toolbar.
        const parents = new Map<number, number>();
        for (const r of db.prepare('SELECT id, parent FROM moz_bookmarks WHERE type = 2').all() as Array<{ id: number; parent: number }>) parents.set(r.id, r.parent);
        const underToolbar = (folder: number) => {
          for (let f: number | undefined = folder, depth = 0; f !== undefined && depth < 50; f = parents.get(f), depth++) if (f === toolbar) return true;
          return false;
        };
        result.bookmarks = (db.prepare('SELECT b.title AS title, p.url AS url, b.parent AS parent FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 ORDER BY b.parent, b.position').all() as Array<{ title: string | null; url: string; parent: number }>)
          .filter((r) => /^(https?|file):/i.test(r.url))
          .map((r): ImportedBookmark => ({ title: r.title || r.url, url: r.url, folder: underToolbar(r.parent) ? 'bar' : 'other' }));
      }
      if (kinds.includes('history')) {
        result.history = (db.prepare('SELECT url, title, CAST(last_visit_date AS TEXT) AS t FROM moz_places WHERE last_visit_date IS NOT NULL AND hidden = 0 ORDER BY last_visit_date DESC LIMIT 50000').all() as Array<{ url: string; title: string | null; t: string }>)
          .filter((r) => /^https?:/i.test(r.url))
          .map((r): ImportedVisit => ({ url: r.url, title: r.title ?? '', visitedAt: firefoxTime(r.t) }));
      }
    });
  }
  if (kinds.includes('cookies')) {
    const now = Date.now() / 1000;
    result.cookies = withDatabaseCopy(join(dir, 'cookies.sqlite'), (db) =>
      (db.prepare('SELECT host, name, value, path, CAST(expiry AS TEXT) AS expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies').all() as Array<{ host: string; name: string; value: string; path: string; expiry: string; isSecure: number; isHttpOnly: number; sameSite: number }>)
        .map((r): ImportedCookie => {
          // Firefox 125+ stores the expiry in milliseconds, older versions in seconds.
          const raw = Number(r.expiry ?? 0);
          const expires = raw > 1e11 ? raw / 1000 : raw;
          return {
            domain: r.host, name: r.name, value: r.value ?? '', path: r.path || '/', secure: Boolean(r.isSecure), httpOnly: Boolean(r.isHttpOnly),
            expires: expires > 0 ? expires : undefined,
            sameSite: r.sameSite === 1 ? 'lax' : r.sameSite === 2 ? 'strict' : r.sameSite === 0 ? 'no_restriction' : 'unspecified',
          };
        })
        .filter((c) => c.expires === undefined || c.expires > now),
    ) ?? [];
  }
  if (kinds.includes('logins') && existsSync(join(dir, 'logins.json'))) {
    let entries: Array<{ hostname?: string; encryptedUsername?: string; encryptedPassword?: string }> = [];
    try {
      entries = (JSON.parse(readFileSync(join(dir, 'logins.json'), 'utf8')) as { logins?: typeof entries }).logins ?? [];
    } catch {
      /* none */
    }
    const key = entries.length ? withDatabaseCopy(join(dir, 'key4.db'), (db) => firefoxMasterKey(db)) : null;
    const logins: ImportedLogin[] = [];
    if (!key && entries.length) {
      result.skipped.push({ what: 'logins', count: entries.length, reason: tr('protette dalla password principale di Firefox: toglila per un momento o esportale in un file CSV') });
    } else if (key) {
      let broken = 0;
      for (const e of entries) {
        try {
          if (!e.hostname || !/^https?:/i.test(e.hostname)) continue;
          logins.push({ url: e.hostname, username: decryptLoginField(e.encryptedUsername ?? '', key), password: decryptLoginField(e.encryptedPassword ?? '', key) });
        } catch {
          broken++;
        }
      }
      if (broken) result.skipped.push({ what: 'logins', count: broken, reason: tr('non leggibili') });
    }
    result.logins = logins;
  }
  return result;
}
