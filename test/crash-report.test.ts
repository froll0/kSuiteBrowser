import { describe, expect, it } from 'vitest';
import { addCrash, issueUrl, MAX_CRASHES, scrub, type CrashEntry } from '../src/shared/crash-report';

const entry = (over: Partial<CrashEntry> = {}): CrashEntry => ({ at: Date.UTC(2026, 10, 1, 10, 30), process: 'renderer', reason: 'crashed', exitCode: 11, version: '0.7.0', electron: '44.1.0', os: 'linux 6.8 x64', ...over });

describe('crash reports', () => {
  it('remove anything personal from the details', () => {
    const text = scrub('TypeError: cannot read https://bank.example/account?id=7 in /home/anna/.config/Velo/session.json for anna@example.org token 0123456789abcdef0123');
    expect(text).not.toMatch(/bank|anna|session\.json|0123456789abcdef/);
    expect(text).toContain('<url>');
    expect(text).toContain('<path>');
    expect(text).toContain('<email>');
    expect(scrub('C:\\Users\\Anna\\AppData\\Local\\Velo')).toBe('<path>');
  });

  it('keep the latest entries and build an issue to read before sending', () => {
    let list: CrashEntry[] = [];
    for (let i = 0; i < MAX_CRASHES + 5; i++) list = addCrash(list, entry({ at: i, detail: 'Error: at file:///x/y/z.js' }));
    expect(list).toHaveLength(MAX_CRASHES);
    expect(list[0].detail).toBe('Error: at <url>');
    const url = new URL(issueUrl({ owner: 'froll0', repo: 'kSuiteBrowser' }, [entry()]));
    expect(url.pathname).toBe('/froll0/kSuiteBrowser/issues/new');
    expect(url.searchParams.get('title')).toBe('Crash: renderer crashed');
    expect(url.searchParams.get('body')).toContain('2026-11-01 10:30 UTC · renderer · crashed (11)');
    expect(url.searchParams.get('body')).toContain('Velo 0.7.0 · Electron 44.1.0 · linux 6.8 x64');
  });
});
