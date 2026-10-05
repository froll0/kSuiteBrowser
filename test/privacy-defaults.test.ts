import { describe, expect, it } from 'vitest';
import { secureDnsConfig } from '../src/shared/secure-dns';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings-schema';

describe('privacy defaults', () => {
  it('never lets the system pick the encrypted DNS (often Google): automatic means Quad9 with fallback', () => {
    expect(secureDnsConfig('automatic', '')).toEqual({ secureDnsMode: 'automatic', secureDnsServers: ['https://dns.quad9.net/dns-query'] });
    expect(secureDnsConfig('custom', 'not a url').secureDnsServers).toEqual(['https://dns.quad9.net/dns-query']);
  });

  it('keeps Widevine (downloaded from Google) off until asked for, also for old profiles', () => {
    expect(DEFAULT_SETTINGS.drmOptIn).toBe(false);
    expect(sanitizeSettings({ drmEnabled: true }).drmOptIn).toBe(false);
    expect(sanitizeSettings({ drmOptIn: true }).drmOptIn).toBe(true);
  });

  it('adopts the settings of the old version', () => {
    const s = sanitizeSettings({ searchEngine: 'ksuite', homePage: 'https://ksuite.infomaniak.com/' });
    expect(s.searchEngine).toBe('velo');
    expect(s.homePage).toBe('velo://newtab/');
    expect(sanitizeSettings({ homePage: 'https://example.ch/' }).homePage).toBe('https://example.ch/');
  });
});
