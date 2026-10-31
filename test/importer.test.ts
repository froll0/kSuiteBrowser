import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({}));

import { cbcKey, chromeTimeToMs, decryptChromium, parseChromiumBookmarks } from '../src/main/importer/chromium';
import { decryptLoginField, firefoxMasterKey, readFirefoxProfile } from '../src/main/importer/firefox';

// ---------- DER writer for the Firefox fixtures ----------
const len = (n: number) => (n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]));
const tlv = (tag: number, value: Buffer) => Buffer.concat([Buffer.from([tag]), len(value.length), value]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const octet = (b: Buffer) => tlv(0x04, b);
const int = (n: number) => tlv(0x02, Buffer.from(n.toString(16).padStart(n > 255 ? 4 : 2, '0'), 'hex'));
function oid(dotted: string): Buffer {
  const p = dotted.split('.').map(Number);
  const bytes = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const enc = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) enc.unshift((v & 0x7f) | 0x80);
    bytes.push(...enc);
  }
  return tlv(0x06, Buffer.from(bytes));
}
const pad = (b: Buffer, block: number) => Buffer.concat([b, Buffer.alloc(block - (b.length % block), block - (b.length % block))]);

/** An NSS PBES2 item (what key4.db holds), encrypted with an empty primary password. */
function pbes2(plain: Buffer, globalSalt: Buffer): Buffer {
  const salt = randomBytes(32);
  const iv14 = randomBytes(14);
  const key = pbkdf2Sync(createHash('sha1').update(globalSalt).digest(), salt, 1000, 32, 'sha256');
  const c = createCipheriv('aes-256-cbc', key, Buffer.concat([Buffer.from([4, 14]), iv14]));
  c.setAutoPadding(false);
  const ct = Buffer.concat([c.update(pad(plain, 16)), c.final()]);
  return seq(
    seq(oid('1.2.840.113549.1.5.13'), seq(seq(oid('1.2.840.113549.1.5.12'), seq(octet(salt), int(1000), int(32), seq(oid('1.2.840.113549.2.9')))), seq(oid('2.16.840.1.101.3.4.1.42'), octet(iv14)))),
    octet(ct),
  );
}

function loginField(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-256-cbc', key, iv);
  c.setAutoPadding(false);
  const ct = Buffer.concat([c.update(pad(Buffer.from(text), 16)), c.final()]);
  return seq(octet(Buffer.from('f8000000000000000000000000000001', 'hex')), seq(oid('2.16.840.1.101.3.4.1.42'), octet(iv)), octet(ct)).toString('base64');
}

describe('import from Chromium browsers', () => {
  it('reads bookmarks, keeping the bar apart', () => {
    const json = JSON.stringify({ roots: {
      bookmark_bar: { children: [{ type: 'url', name: 'A', url: 'https://a.example/' }, { type: 'folder', children: [{ type: 'url', name: 'B', url: 'https://b.example/' }] }] },
      other: { children: [{ type: 'url', name: 'C', url: 'https://c.example/' }, { type: 'url', name: 'J', url: 'javascript:alert(1)' }] },
      synced: { children: [] },
    } });
    expect(parseChromiumBookmarks(json)).toEqual([
      { title: 'A', url: 'https://a.example/', folder: 'bar' },
      { title: 'B', url: 'https://b.example/', folder: 'bar' },
      { title: 'C', url: 'https://c.example/', folder: 'other' },
    ]);
  });

  it('converts Chromium times', () => {
    // 1601-01-01 + 369 years = 1970-01-01.
    expect(chromeTimeToMs(11_644_473_600_000_000n + 1_500_000n)).toBe(1500);
    expect(chromeTimeToMs(0)).toBe(0);
  });

  it('decrypts v10 values (Linux "peanuts" key) and leaves plain ones', () => {
    const key = cbcKey('peanuts', 1);
    const c = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    const blob = Buffer.concat([Buffer.from('v10'), c.update('s3cret!'), c.final()]);
    const res = decryptChromium(blob, { v10: key, v11: null, gcm: null });
    expect(res.ok && res.value.toString()).toBe('s3cret!');
    expect(decryptChromium(Buffer.from('v11xxxxxxxxxxxxxxxx'), { v10: key, v11: null, gcm: null })).toEqual({ ok: false, reason: 'no-key' });
    expect(decryptChromium(Buffer.from('v20xxxxxxxxxxxxxxxx'), { v10: key, v11: null, gcm: null })).toEqual({ ok: false, reason: 'app-bound' });
  });

  it('decrypts Windows AES-GCM values', () => {
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, nonce);
    const ct = Buffer.concat([c.update('pässword'), c.final()]);
    const blob = Buffer.concat([Buffer.from('v10'), nonce, ct, c.getAuthTag()]);
    const res = decryptChromium(blob, { v10: null, v11: null, gcm: key });
    expect(res.ok && res.value.toString()).toBe('pässword');
  });
});

describe('import from Firefox', () => {
  it('unlocks key4.db and decrypts logins.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-'));
    const globalSalt = randomBytes(20);
    const master = randomBytes(32);
    const db = new DatabaseSync(join(dir, 'key4.db'));
    db.exec('CREATE TABLE metaData (id PRIMARY KEY UNIQUE ON CONFLICT REPLACE, item1, item2); CREATE TABLE nssPrivate (id PRIMARY KEY UNIQUE ON CONFLICT ABORT, a11, a102)');
    db.prepare("INSERT INTO metaData VALUES ('password', ?, ?)").run(globalSalt, pbes2(Buffer.from('password-check'), globalSalt));
    db.prepare('INSERT INTO nssPrivate VALUES (1, ?, ?)').run(pbes2(master, globalSalt), Buffer.from('f8000000000000000000000000000001', 'hex'));
    expect(firefoxMasterKey(db)?.equals(master)).toBe(true);
    db.close();

    writeFileSync(join(dir, 'logins.json'), JSON.stringify({ logins: [
      { hostname: 'https://example.org', encryptedUsername: loginField('anna', master), encryptedPassword: loginField('pw-ü-1', master) },
    ] }));
    const places = new DatabaseSync(join(dir, 'places.sqlite'));
    places.exec("CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0); CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT)");
    const now = Date.now() * 1000;
    places.prepare('INSERT INTO moz_places VALUES (1, ?, ?, ?, 0)').run('https://example.org/', 'Example', now);
    places.prepare('INSERT INTO moz_places VALUES (2, ?, ?, ?, 0)').run('https://news.example/', 'News', now - 1000);
    places.exec("INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, 'root', 'root________'), (3, 2, NULL, 1, 0, 'toolbar', 'toolbar_____'), (4, 2, NULL, 3, 0, 'sub', 'subfolder___'), (5, 1, 1, 4, 0, 'Ex', 'b1'), (6, 2, NULL, 1, 1, 'menu', 'menu________'), (7, 1, 2, 6, 0, 'News', 'b2')");
    places.close();

    const data = readFirefoxProfile({ id: 'firefox:x', browser: 'Firefox', key: 'firefox', family: 'firefox', profileName: 'x', path: dir }, ['logins', 'bookmarks', 'history']);
    expect(data.logins).toEqual([{ url: 'https://example.org', username: 'anna', password: 'pw-ü-1' }]);
    expect(data.bookmarks).toEqual([{ title: 'Ex', url: 'https://example.org/', folder: 'bar' }, { title: 'News', url: 'https://news.example/', folder: 'other' }]);
    expect(data.history?.map((v) => v.url)).toEqual(['https://example.org/', 'https://news.example/']);
    expect(decryptLoginField(loginField('x', master), master)).toBe('x');
  });

  it('reports logins protected by a primary password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ff-'));
    const globalSalt = randomBytes(20);
    const db = new DatabaseSync(join(dir, 'key4.db'));
    db.exec('CREATE TABLE metaData (id, item1, item2); CREATE TABLE nssPrivate (id, a11, a102)');
    // Encrypted with another password: the check fails.
    db.prepare("INSERT INTO metaData VALUES ('password', ?, ?)").run(globalSalt, pbes2(Buffer.from('password-check'), randomBytes(20)));
    db.close();
    writeFileSync(join(dir, 'logins.json'), JSON.stringify({ logins: [{ hostname: 'https://a.example', encryptedUsername: 'AA==', encryptedPassword: 'AA==' }] }));
    const data = readFirefoxProfile({ id: 'f', browser: 'Firefox', key: 'firefox', family: 'firefox', profileName: 'x', path: dir }, ['logins']);
    expect(data.logins).toEqual([]);
    expect(data.skipped[0]).toMatchObject({ what: 'logins', count: 1 });
  });
});
