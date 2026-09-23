import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { originOf, Vault, VaultLockedError, WrongPasswordError, type Keychain } from '../src/main/passwords/vault';
import { parseCsv, parsePasswordCsv, toCsv } from '../src/shared/csv';
import { generatePassword, isWeakPassword } from '../src/shared/password-gen';

/** Stand-in for the OS keychain: XOR is enough to prove the vault never stores the key in clear. */
function fakeKeychain(available = true): Keychain {
  const x = (b: Buffer) => Buffer.from(b.map((v) => v ^ 0x5a));
  return { available: () => available, encrypt: x, decrypt: x };
}

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'vault-')), 'passwords.json');

describe('Vault', () => {
  it('stores logins encrypted and reads them back with the keychain', () => {
    const path = tmpFile();
    const vault = new Vault(path, fakeKeychain());
    vault.save('https://mail.example', 'ada', 'S3gret0!Lungo');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('S3gret0');
    expect(raw).not.toContain('ada');
    expect(raw).not.toContain('mail.example');

    const reopened = new Vault(path, fakeKeychain());
    expect(reopened.forOrigin('https://mail.example').map((l) => [l.username, l.password])).toEqual([['ada', 'S3gret0!Lungo']]);
    expect(reopened.forOrigin('https://other.example')).toEqual([]);
  });

  it('updates the password of an existing username instead of duplicating', () => {
    const vault = new Vault(tmpFile(), fakeKeychain());
    vault.save('https://a.example', 'ada', 'one');
    vault.save('https://a.example', 'ada', 'two');
    expect(vault.list()).toHaveLength(1);
    expect(vault.list()[0].password).toBe('two');
  });

  it('refuses to store anything without keychain nor primary password', () => {
    const vault = new Vault(tmpFile(), fakeKeychain(false));
    expect(vault.status().state).toBe('needs-setup');
    expect(() => vault.save('https://a.example', 'ada', 'x')).toThrow(VaultLockedError);
  });

  it('protects the vault with a primary password', async () => {
    const path = tmpFile();
    const vault = new Vault(path, fakeKeychain());
    vault.save('https://a.example', 'ada', 'pw-1');
    await vault.setPrimary('principale-123');
    expect(JSON.parse(readFileSync(path, 'utf8')).keychain).toBeUndefined();

    const reopened = new Vault(path, fakeKeychain());
    expect(reopened.status()).toMatchObject({ state: 'locked', hasPrimary: true });
    expect(() => reopened.list()).toThrow(VaultLockedError);
    await expect(reopened.unlock('sbagliata')).rejects.toBeInstanceOf(WrongPasswordError);
    await reopened.unlock('principale-123');
    expect(reopened.list()[0].password).toBe('pw-1');

    reopened.lock();
    expect(reopened.status().state).toBe('locked');
    await expect(reopened.removePrimary('sbagliata')).rejects.toBeInstanceOf(WrongPasswordError);
    await reopened.removePrimary('principale-123');
    expect(new Vault(path, fakeKeychain()).list()[0].password).toBe('pw-1');
  }, 20_000);

  it('works without a keychain once a primary password is set', async () => {
    const path = tmpFile();
    const vault = new Vault(path, fakeKeychain(false));
    await vault.setPrimary('principale-123');
    vault.save('https://a.example', 'ada', 'pw');
    const reopened = new Vault(path, fakeKeychain(false));
    await reopened.unlock('principale-123');
    expect(reopened.list()).toHaveLength(1);
  }, 20_000);

  it('detects tampering', () => {
    const path = tmpFile();
    new Vault(path, fakeKeychain()).save('https://a.example', 'ada', 'pw');
    const file = JSON.parse(readFileSync(path, 'utf8'));
    const data = Buffer.from(file.payload.data, 'base64');
    data[0] ^= 1;
    file.payload.data = data.toString('base64');
    require('node:fs').writeFileSync(path, JSON.stringify(file));
    expect(() => new Vault(path, fakeKeychain()).list()).toThrow();
  });

  it('imports and exports CSV, and remembers "never save" sites', () => {
    const vault = new Vault(tmpFile(), fakeKeychain());
    const added = vault.importCsv('name,url,username,password,note\nMail,https://mail.example/login,ada,"p,w""1",\nBad,,x,y,\n');
    expect(added).toBe(1);
    expect(vault.forOrigin('https://mail.example')[0].password).toBe('p,w"1');
    expect(parsePasswordCsv(vault.exportCsv())).toEqual([{ url: 'https://mail.example', username: 'ada', password: 'p,w"1' }]);
    vault.setNever('https://x.example', true);
    expect(vault.isNever('https://x.example')).toBe(true);
  });
});

describe('helpers', () => {
  it('computes origins only for http(s)', () => {
    expect(originOf('https://Example.org:443/login?a=1')).toBe('https://example.org');
    expect(originOf('http://example.org:8080/')).toBe('http://example.org:8080');
    expect(originOf('ksuite://settings')).toBeNull();
  });

  it('generates strong random passwords', () => {
    const a = generatePassword();
    expect(a).toHaveLength(20);
    expect(a).toMatch(/[a-z]/);
    expect(a).toMatch(/[A-Z]/);
    expect(a).toMatch(/\d/);
    expect(a).toMatch(/[^a-zA-Z\d]/);
    expect(generatePassword()).not.toBe(a);
    expect(isWeakPassword(a)).toBe(false);
    expect(isWeakPassword('password1')).toBe(true);
    expect(isWeakPassword('abc')).toBe(true);
  });

  it('parses CSV exports of other managers', () => {
    expect(parseCsv('a,"b\nc",d\r\n1,2,3')).toEqual([['a', 'b\nc', 'd'], ['1', '2', '3']]);
    expect(toCsv([['x', 'a,b', 'q"q']])).toBe('x,"a,b","q""q"\r\n');
    const firefox = '"url","username","password","httpRealm"\n"https://a.example","u","p",""';
    expect(parsePasswordCsv(firefox)).toEqual([{ url: 'https://a.example', username: 'u', password: 'p' }]);
    const bitwarden = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,A,,,0,https://b.example,bob,pw,';
    expect(parsePasswordCsv(bitwarden)).toEqual([{ url: 'https://b.example', username: 'bob', password: 'pw' }]);
  });
});
