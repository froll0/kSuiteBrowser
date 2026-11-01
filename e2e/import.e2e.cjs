const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { launchVelo, serve, until, tempDir } = require('./helpers.cjs');

/** A Chromium profile as Chromium writes it on Linux without a keyring (values encrypted with "peanuts"). */
function chromiumProfile(cfg, port) {
  const dir = path.join(cfg, 'chromium', 'Default');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Preferences'), '{}');
  fs.writeFileSync(path.join(dir, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Da Chromium', url: 'https://from-chromium.example/' }] }, other: { children: [] } } }));
  const key = crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1');
  const encrypt = (text) => {
    const c = crypto.createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
    return Buffer.concat([Buffer.from('v10'), c.update(text), c.final()]);
  };
  const chromeTime = (ms) => (BigInt(ms) * 1000n + 11644473600000000n).toString();
  const history = new DatabaseSync(path.join(dir, 'History'));
  history.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)');
  history.exec(`INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time) VALUES ('https://storia.example/x', 'Pagina importata', 1, 0, ${chromeTime(Date.now())})`);
  history.close();
  const cookies = new DatabaseSync(path.join(dir, 'Cookies'));
  cookies.exec("CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24'); CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)");
  // Version 24: the decrypted value starts with the SHA-256 of the domain.
  const value = Buffer.concat([crypto.createHash('sha256').update('127.0.0.1').digest(), Buffer.from('from-chromium')]);
  cookies.prepare(`INSERT INTO cookies VALUES ('127.0.0.1', 'session', '', ?, '/', ${chromeTime(Date.now() + 86_400_000)}, 0, 0, 1)`).run(encrypt(value));
  cookies.close();
  const logins = new DatabaseSync(path.join(dir, 'Login Data'));
  logins.exec('CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB, blacklisted_by_user INTEGER)');
  logins.prepare("INSERT INTO logins VALUES ('https://login.example/', 'mario', ?, 0)").run(encrypt('pw-da-chromium'));
  logins.close();
  return port;
}

// The profile is written where Chromium keeps it on Linux, with the key Chromium uses there without a
// keyring; on Windows (DPAPI) and macOS (Keychain) the key belongs to the system.
test('imports bookmarks, history, cookies and passwords from a Chromium profile', { skip: process.platform !== 'linux' && 'Linux profile layout' }, async () => {
  const server = await serve((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<title>T</title><script>document.title = "C:" + document.cookie</script>');
  });
  const cfg = tempDir('import');
  chromiumProfile(cfg, server.port);
  const velo = await launchVelo({ cfg, settings: { onboarded: true, httpsOnly: false } });
  try {
    const page = await velo.openTab('velo://import/', 'velo://import');
    await page.waitForSelector('.source');
    assert.match(await page.textContent('.source .title'), /Chromium/);
    // Velo's own vault needs a primary password here (no system keychain in CI).
    const passwords = await velo.openTab('velo://passwords/', 'velo://passwords');
    assert.equal((await passwords.evaluate(() => window.veloInternal.invoke('internal:pw:set-primary', 'Prova-123!'))).ok, true);
    const report = await page.evaluate(() => window.veloInternal.invoke('internal:import:run', 'chromium:Default', ['bookmarks', 'history', 'logins', 'cookies']));
    assert.equal(report.ok, true, JSON.stringify(report));
    assert.deepEqual({ ...report.data, skipped: report.data.skipped.length }, { bookmarks: 1, history: 1, logins: 1, cookies: 1, skipped: 0 });
    assert.deepEqual((await velo.win.evaluate(() => window.velo.bookmarks.list())).map((b) => [b.title, b.folder]), [['Da Chromium', 'bar']]);
    const logins = await passwords.evaluate(() => window.veloInternal.invoke('internal:pw:list'));
    assert.deepEqual(logins.data.map((l) => [l.origin, l.username, l.password]), [['https://login.example', 'mario', 'pw-da-chromium']]);
    await velo.openTab(`http://127.0.0.1:${server.port}/read`, '/read');
    assert.equal(await until(async () => (await velo.tabs()).find((t) => t.url.includes('/read'))?.title === 'C:session=from-chromium'), true);
  } finally {
    await velo.close();
    server.close();
  }
});
