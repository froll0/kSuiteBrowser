import { generateKeyPairSync } from 'node:crypto';
import { zipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildCrx, extensionId, parseCrx } from '../src/main/extensions/crx';
import { allSites, hostPatterns, matchesPattern } from '../src/shared/match-pattern';

describe('match patterns', () => {
  it('matches like Chrome', () => {
    expect(matchesPattern('<all_urls>', 'https://a.ch/x')).toBe(true);
    expect(matchesPattern('<all_urls>', 'chrome-extension://abc/x')).toBe(false);
    expect(matchesPattern('*://*/*', 'http://a.ch/')).toBe(true);
    expect(matchesPattern('*://*/*', 'file:///tmp/a')).toBe(false);
    expect(matchesPattern('https://*.infomaniak.com/*', 'https://mail.infomaniak.com/inbox')).toBe(true);
    expect(matchesPattern('https://*.infomaniak.com/*', 'https://infomaniak.com/')).toBe(true);
    expect(matchesPattern('https://*.infomaniak.com/*', 'https://evilinfomaniak.com/')).toBe(false);
    expect(matchesPattern('https://*.infomaniak.com/*', 'http://mail.infomaniak.com/')).toBe(false);
    expect(matchesPattern('https://a.ch/docs/*', 'https://a.ch/docs/1?q=2')).toBe(true);
    expect(matchesPattern('https://a.ch/docs/*', 'https://a.ch/other')).toBe(false);
    expect(matchesPattern('nonsense', 'https://a.ch/')).toBe(false);
  });

  it('collects host access from a manifest', () => {
    const hosts = hostPatterns({ permissions: ['storage', 'https://a.ch/*'], host_permissions: ['*://*.b.ch/*'], content_scripts: [{ matches: ['<all_urls>'] }] });
    expect(hosts).toEqual(['*://*.b.ch/*', 'https://a.ch/*', '<all_urls>']);
    expect(allSites(hosts)).toBe(true);
    expect(allSites(['https://a.ch/*'])).toBe(false);
  });
});

describe('crx packages', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const zip = Buffer.from(zipSync({ 'manifest.json': strToU8('{"manifest_version":3,"name":"T","version":"1"}') }));

  it('reads a signed package and derives the extension id', () => {
    const pkg = parseCrx(buildCrx(zip, privateKey, der));
    expect(pkg.id).toMatch(/^[a-p]{32}$/);
    expect(pkg.id).toBe(extensionId(der));
    expect(pkg.zip.equals(zip)).toBe(true);
    expect(pkg.publicKey.equals(der)).toBe(true);
  });

  it('refuses altered or foreign packages', () => {
    const crx = buildCrx(zip, privateKey, der);
    const tampered = Buffer.from(crx);
    tampered[tampered.length - 5] ^= 0xff;
    expect(() => parseCrx(tampered)).toThrow(/firma/);
    expect(() => parseCrx(Buffer.from('PK\x03\x04 not a crx'))).toThrow(/crx/);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    // Signed by another key than the one the ID is derived from.
    const forged = buildCrx(zip, other.privateKey, der);
    expect(() => parseCrx(forged)).toThrow(/firma/);
  });
});

describe('extension helpers', () => {
  it('reads Chrome Web Store addresses', async () => {
    const { storeIdFrom, compareVersions } = await import('../src/main/extensions/registry');
    expect(storeIdFrom('https://chromewebstore.google.com/detail/bitwarden/nngceckbapebfimnlniiiahkandclblb?hl=it')).toBe('nngceckbapebfimnlniiiahkandclblb');
    expect(storeIdFrom('nngceckbapebfimnlniiiahkandclblb')).toBe('nngceckbapebfimnlniiiahkandclblb');
    expect(storeIdFrom('https://example.com/estensione')).toBeNull();
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2.3', '1.3')).toBeLessThan(0);
  });

  it('matches extension keyboard shortcuts', async () => {
    const { matchesShortcut } = await import('../src/main/extensions/host');
    const key = (k: string, mods: Partial<{ control: boolean; meta: boolean; alt: boolean; shift: boolean }> = {}) => ({ key: k, control: false, meta: false, alt: false, shift: false, ...mods });
    const mac = process.platform === 'darwin';
    expect(matchesShortcut('Alt+Shift+K', key('K', { alt: true, shift: true }))).toBe(true);
    expect(matchesShortcut('Alt+Shift+K', key('K', { alt: true }))).toBe(false);
    expect(matchesShortcut('Ctrl+Shift+Y', key('Y', mac ? { meta: true, shift: true } : { control: true, shift: true }))).toBe(true);
    expect(matchesShortcut('MacCtrl+Comma', key(',', { control: true }))).toBe(true);
  });
});
