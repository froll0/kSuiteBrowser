import { describe, expect, it } from 'vitest';
import { deleteHeader, httpsUpgrade, isThirdParty, siteOf } from '../src/shared/privacy-rules';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings-schema';

describe('siteOf / isThirdParty', () => {
  it('uses the registrable domain', () => {
    expect(siteOf('https://mail.infomaniak.com/inbox')).toBe('infomaniak.com');
    expect(siteOf('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
  });

  it('treats subdomains of the same site as first party', () => {
    expect(isThirdParty('https://api.infomaniak.com/2/profile', 'https://ksuite.infomaniak.com/')).toBe(false);
  });

  it('detects cross-site requests', () => {
    expect(isThirdParty('https://www.google-analytics.com/collect', 'https://example.org/page')).toBe(true);
  });

  it('never flags requests without a page', () => {
    expect(isThirdParty('https://tracker.example/x', null)).toBe(false);
  });
});

describe('httpsUpgrade', () => {
  it('upgrades public http URLs', () => {
    expect(httpsUpgrade('http://example.org/a?b=1', [])).toBe('https://example.org/a?b=1');
    expect(httpsUpgrade('http://example.org:80/', [])).toBe('https://example.org/');
  });

  it('leaves https, local addresses and exceptions alone', () => {
    expect(httpsUpgrade('https://example.org/', [])).toBeNull();
    expect(httpsUpgrade('http://localhost:3000/', [])).toBeNull();
    expect(httpsUpgrade('http://192.168.1.1/', [])).toBeNull();
    expect(httpsUpgrade('http://printer.local/', [])).toBeNull();
    expect(httpsUpgrade('http://intranet/', [])).toBeNull();
    expect(httpsUpgrade('http://old.example.org/', ['old.example.org'])).toBeNull();
  });
});

describe('deleteHeader', () => {
  it('removes headers whatever their casing', () => {
    const headers: Record<string, unknown> = { 'set-cookie': ['a=1'], 'Set-Cookie': ['b=2'], Other: 'x' };
    expect(deleteHeader(headers, 'Set-Cookie')).toBe(true);
    expect(headers).toEqual({ Other: 'x' });
    expect(deleteHeader(headers, 'Cookie')).toBe(false);
  });
});

describe('sanitizeSettings', () => {
  it('returns the defaults for missing or broken files', () => {
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('garbage')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and drops invalid ones', () => {
    const s = sanitizeSettings({
      theme: 'dark',
      trackingProtection: 'extreme',
      searchEngine: 'qwant',
      driveId: -4,
      permissionDefaults: { media: 'block', notifications: 'maybe' },
      protectionExceptions: ['Example.org', 'example.org', 42, ''],
      sitePermissions: [
        { host: 'a.com', permission: 'media', allowed: true },
        { host: 'a.com', permission: 'media', allowed: false },
        { host: '', permission: 'media', allowed: true },
      ],
    });
    expect(s.theme).toBe('dark');
    expect(s.trackingProtection).toBe('standard');
    expect(s.searchEngine).toBe('qwant');
    expect(s.driveId).toBeNull();
    expect(s.permissionDefaults).toEqual({ media: 'block', notifications: 'ask', geolocation: 'ask' });
    expect(s.protectionExceptions).toEqual(['example.org']);
    expect(s.sitePermissions).toEqual([{ host: 'a.com', permission: 'media', allowed: false }]);
  });

  it('migrates settings files written by the first version', () => {
    const s = sanitizeSettings({ searchEngine: 'ecosia', homePage: 'https://ik.me', panelOpen: false, driveId: 12 });
    expect(s).toMatchObject({ searchEngine: 'ecosia', homePage: 'https://ik.me', panelOpen: false, driveId: 12, httpsOnly: true });
  });
});
