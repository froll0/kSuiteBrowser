import { describe, expect, it } from 'vitest';
import { INTERNAL_PAGE_CSP, internalPagePath, isAllowedInternalSender } from '../src/shared/ipc-guard';

describe('internal pages', () => {
  it('accept privileged calls only from the listed velo:// pages, in the top frame', () => {
    expect(isAllowedInternalSender('velo://settings/', ['settings'], true)).toBe(true);
    expect(isAllowedInternalSender('velo://settings/#account', ['settings'], true)).toBe(true);
    // A frame of the page, another internal page, a web page, a lookalike.
    expect(isAllowedInternalSender('velo://settings/', ['settings'], false)).toBe(false);
    expect(isAllowedInternalSender('velo://newtab/', ['settings'], true)).toBe(false);
    expect(isAllowedInternalSender('https://settings/', ['settings'], true)).toBe(false);
    expect(isAllowedInternalSender('https://evil.example/velo://settings/', ['settings'], true)).toBe(false);
    expect(isAllowedInternalSender('velo://user:pw@settings/', ['settings'], true)).toBe(false);
    expect(isAllowedInternalSender('', ['settings'], true)).toBe(false);
    expect(isAllowedInternalSender(null, ['settings'], true)).toBe(false);
  });

  it('never serve files outside the page folder', () => {
    expect(internalPagePath('/')).toBe('index.html');
    expect(internalPagePath('/settings.js')).toBe('settings.js');
    expect(internalPagePath('/../passwords/index.html')).toBeNull();
    expect(internalPagePath('/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(internalPagePath('/..%5c..%5cwindows')).toBeNull();
    expect(internalPagePath('/C:/Windows/win.ini')).toBeNull();
    expect(internalPagePath('/a%00.js')).toBeNull();
    expect(internalPagePath('/%E0%A4%A')).toBeNull();
  });

  it('allow only their own scripts and cannot be framed', () => {
    const directives = Object.fromEntries(INTERNAL_PAGE_CSP.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(directives['default-src']).toEqual(["'none'"]);
    expect(directives['script-src']).toEqual(["'self'"]);
    expect(directives['frame-ancestors']).toEqual(["'none'"]);
    expect(directives['connect-src']).toEqual(["'none'"]);
    expect(INTERNAL_PAGE_CSP).not.toMatch(/unsafe-(inline|eval)/);
  });
});
