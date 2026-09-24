import { describe, expect, it } from 'vitest';
import { chromeUserAgent, popupTitle, readableUrl, resolveOmniboxInput } from '../src/shared/url';

describe('resolveOmniboxInput', () => {
  it('keeps full URLs', () => {
    expect(resolveOmniboxInput('https://mail.infomaniak.com/inbox')).toBe('https://mail.infomaniak.com/inbox');
    expect(resolveOmniboxInput('http://example.org')).toBe('http://example.org/');
  });

  it('adds https to bare hosts', () => {
    expect(resolveOmniboxInput('infomaniak.com')).toBe('https://infomaniak.com/');
    expect(resolveOmniboxInput('kdrive.infomaniak.com/app')).toBe('https://kdrive.infomaniak.com/app');
  });

  it('uses http for localhost', () => {
    expect(resolveOmniboxInput('localhost:3000')).toBe('http://localhost:3000/');
  });

  it('searches for free text', () => {
    expect(resolveOmniboxInput('meteo lugano')).toBe('https://duckduckgo.com/?q=meteo%20lugano');
    expect(resolveOmniboxInput('ksuite', 'qwant')).toBe('https://www.qwant.com/?q=ksuite');
  });

  it('does not navigate to dangerous schemes', () => {
    expect(resolveOmniboxInput('javascript:alert(1)')).toMatch(/^https:\/\/duckduckgo\.com\/\?q=/);
  });

  it('opens a blank page for empty input', () => {
    expect(resolveOmniboxInput('   ')).toBe('about:blank');
  });
});

describe('readableUrl', () => {
  it('decodes and shortens addresses for display', () => {
    expect(readableUrl('https://github.com/')).toBe('github.com');
    expect(readableUrl('https://it.wikipedia.org/wiki/Caff%C3%A8')).toBe('it.wikipedia.org/wiki/Caffè');
    expect(readableUrl('http://example.com/a/')).toBe('http://example.com/a/');
    expect(readableUrl('https://x.com/%E0%A4%A')).toBe('x.com/%E0%A4%A');
  });
});

describe('chromeUserAgent', () => {
  it('drops the Electron and app tokens', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) kSuiteBrowser/0.1.0 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';
    expect(chromeUserAgent(ua)).toBe('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36');
  });
});

describe('popupTitle', () => {
  it('puts the site and the connection state first', () => {
    expect(popupTitle('https://accounts.google.com/signin?x=1', 'Accedi – Account Google')).toBe('🔒 accounts.google.com — Accedi – Account Google');
    expect(popupTitle('http://login.example.com/', 'Login')).toBe('⚠ Non sicuro: login.example.com — Login');
    expect(popupTitle('https://a.example/', '')).toBe('🔒 a.example');
  });
});
