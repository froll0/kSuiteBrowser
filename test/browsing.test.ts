import { describe, expect, it } from 'vitest';
import { exportBookmarksHtml, parseBookmarksHtml } from '../src/shared/bookmark-html';
import { buildSuggestions, inlineCompletion } from '../src/shared/suggest';
import type { Bookmark } from '../src/shared/types';
import { stepZoom, withSiteZoom, zoomFor } from '../src/shared/zoom';

const NOW = Date.parse('2026-09-24T12:00:00Z');
const DAY = 24 * 3600 * 1000;

describe('buildSuggestions', () => {
  const history = [
    { url: 'https://www.infomaniak.com/it/ksuite', title: 'kSuite — Infomaniak', visits: 12, lastVisit: NOW - 1000 },
    { url: 'https://example.org/infomaniak-review', title: 'Recensione', visits: 1, lastVisit: NOW - 30 * DAY },
    { url: 'https://news.ycombinator.com/', title: 'Hacker News', visits: 3, lastVisit: NOW - 2 * DAY },
  ];
  const bookmarks: Bookmark[] = [{ id: 'b1', title: 'Mail Infomaniak', url: 'https://mail.infomaniak.com/', folder: 'bar', createdAt: NOW }];

  it('starts with what Enter would do', () => {
    expect(buildSuggestions('meteo lugano', 'duckduckgo', [], [], { now: NOW })[0]).toEqual({
      kind: 'search',
      title: 'meteo lugano — Cerca con DuckDuckGo',
      url: 'https://duckduckgo.com/?q=meteo%20lugano',
    });
    expect(buildSuggestions('example.org', 'duckduckgo', [], [], { now: NOW })[0]).toMatchObject({ kind: 'url', url: 'https://example.org/' });
  });

  it('ranks bookmarks and frequent, prefix-matching history first', () => {
    const urls = buildSuggestions('infomaniak', 'duckduckgo', history, bookmarks, { now: NOW }).map((s) => s.url);
    expect(urls.slice(1)).toEqual(['https://www.infomaniak.com/it/ksuite', 'https://mail.infomaniak.com/', 'https://example.org/infomaniak-review']);
  });

  it('requires every word to match', () => {
    const titles = buildSuggestions('hacker news', 'duckduckgo', history, bookmarks, { now: NOW }).map((s) => s.title);
    expect(titles).toContain('Hacker News');
    expect(buildSuggestions('hacker mail', 'duckduckgo', history, bookmarks, { now: NOW })).toHaveLength(1);
  });

  it('returns nothing for empty input', () => {
    expect(buildSuggestions('  ', 'duckduckgo', history, bookmarks, { now: NOW })).toEqual([]);
  });
});

describe('zoom', () => {
  it('steps through the standard levels', () => {
    expect(stepZoom(100, 'in')).toBe(110);
    expect(stepZoom(100, 'out')).toBe(90);
    expect(stepZoom(104, 'in')).toBe(110);
    expect(stepZoom(500, 'in')).toBe(500);
    expect(stepZoom(25, 'out')).toBe(25);
  });

  it('remembers levels per site and forgets the default', () => {
    const map = withSiteZoom({}, 'Example.org', 125, 100);
    expect(map).toEqual({ 'example.org': 125 });
    expect(zoomFor('example.org', map, 100)).toBe(125);
    expect(zoomFor('other.org', map, 90)).toBe(90);
    expect(withSiteZoom(map, 'example.org', 100, 100)).toEqual({});
  });
});

describe('bookmark files', () => {
  const chromeExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://mail.infomaniak.com/" ADD_DATE="1">Mail &amp; Calendar</A>
        <DT><H3>Lavoro</H3>
        <DL><p>
            <DT><A HREF="https://kdrive.infomaniak.com/">kDrive</A>
        </DL><p>
    </DL><p>
    <DT><H3>Other bookmarks</H3>
    <DL><p>
        <DT><A HREF="https://example.org/?a=1&amp;b=2">Esempio</A>
        <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
    </DL><p>
</DL><p>`;

  it('imports Chrome/Firefox exports, keeping the toolbar folder', () => {
    expect(parseBookmarksHtml(chromeExport)).toEqual([
      { title: 'Mail & Calendar', url: 'https://mail.infomaniak.com/', folder: 'bar' },
      { title: 'kDrive', url: 'https://kdrive.infomaniak.com/', folder: 'bar' },
      { title: 'Esempio', url: 'https://example.org/?a=1&b=2', folder: 'other' },
    ]);
  });

  it('round-trips its own export', () => {
    const list: Bookmark[] = [
      { id: '1', title: 'A <b>', url: 'https://a.example/?x=1&y=2', folder: 'bar', createdAt: NOW },
      { id: '2', title: 'B', url: 'https://b.example/', folder: 'other', createdAt: NOW },
    ];
    expect(parseBookmarksHtml(exportBookmarksHtml(list, NOW))).toEqual([
      { title: 'A <b>', url: 'https://a.example/?x=1&y=2', folder: 'bar' },
      { title: 'B', url: 'https://b.example/', folder: 'other' },
    ]);
  });
});

describe('new tab page', () => {
  it('lists one tile per site, most visited first, without removed sites', async () => {
    const { topSites } = await import('../src/shared/top-sites');
    const history = [
      { url: 'https://a.example/x', title: 'A x', visits: 3, lastVisit: NOW },
      { url: 'https://a.example/y', title: 'A y', visits: 5, lastVisit: NOW },
      { url: 'https://b.example/', title: 'B', visits: 7, lastVisit: NOW },
      { url: 'https://c.example/', title: '', visits: 1, lastVisit: NOW },
      { url: 'ksuite://settings/', title: 'Impostazioni', visits: 50, lastVisit: NOW },
    ];
    expect(topSites(history, [])).toEqual([
      { url: 'https://a.example/y', title: 'A y' },
      { url: 'https://b.example/', title: 'B' },
      { url: 'https://c.example/', title: 'c.example' },
    ]);
    expect(topSites(history, ['https://a.example']).map((s) => s.url)).toEqual(['https://b.example/', 'https://c.example/']);
  });

  it('draws a stable, escaped letter icon', async () => {
    const { letterIconSvg, letterColor, faviconUrl } = await import('../src/shared/top-sites');
    expect(letterIconSvg('www.example.org')).toContain('>E</text>');
    expect(letterColor('example.org')).toBe(letterColor('example.org'));
    expect(letterIconSvg('<script>')).not.toContain('<script');
    expect(faviconUrl('https://a.example/?q=1')).toBe('ksuite://favicon/?url=https%3A%2F%2Fa.example%2F%3Fq%3D1');
  });
});

describe('buildSuggestions with open tabs', () => {
  it('offers to switch to a matching open tab instead of its history entry', () => {
    const history = [{ url: 'https://github.com/froll0', title: 'froll0 · GitHub', visits: 5, lastVisit: NOW }];
    const tabs = [{ id: 7, title: 'froll0 · GitHub', url: 'https://github.com/froll0' }, { id: 8, title: 'Meteo', url: 'https://meteo.ch/' }];
    const list = buildSuggestions('github', 'duckduckgo', history, [], { now: NOW, tabs });
    expect(list[1]).toEqual({ kind: 'tab', title: 'froll0 · GitHub', url: 'https://github.com/froll0', tabId: 7 });
    expect(list.filter((s) => s.url === 'https://github.com/froll0')).toHaveLength(1);
    expect(list.some((s) => s.tabId === 8)).toBe(false);
  });
});

describe('inlineCompletion', () => {
  const h = (url: string) => ({ kind: 'history' as const, title: '', url });
  it('completes to the site first', () => {
    expect(inlineCompletion('git', [h('https://www.github.com/froll0/kSuiteBrowser')])).toEqual({ text: 'github.com/', url: 'https://www.github.com/' });
    expect(inlineCompletion('Git', [h('https://github.com/x')])?.text).toBe('Github.com/');
  });
  it('completes to a full address once the site is typed', () => {
    expect(inlineCompletion('github.com/fr', [h('https://github.com/froll0')])).toEqual({ text: 'github.com/froll0', url: 'https://github.com/froll0' });
  });
  it('never completes searches or non-matching input', () => {
    expect(inlineCompletion('come fare', [h('https://come.it/')])).toBeNull();
    expect(inlineCompletion('hub', [h('https://github.com/')])).toBeNull();
    expect(inlineCompletion('git', [{ kind: 'search', title: '', url: 'https://github.com/' }])).toBeNull();
  });
});
