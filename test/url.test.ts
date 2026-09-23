import { describe, expect, it } from 'vitest';
import { resolveOmniboxInput } from '../src/shared/url';

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
