import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allFolders, cleanPath, folderEntries, parseFolderKey, folderKey } from '../src/shared/bookmark-folders';
import { BookmarksStore } from '../src/main/stores/bookmarks';

const store = () => new BookmarksStore(join(mkdtempSync(join(tmpdir(), 'bm-')), 'bookmarks.json'));

describe('bookmark folders', () => {
  it('cleans paths', () => {
    expect(cleanPath(['  A  b ', 'C', '', 'D'])).toEqual(['A b', 'C']);
    expect(cleanPath('x')).toEqual([]);
    expect(cleanPath(Array.from({ length: 20 }, (_, i) => `f${i}`))).toHaveLength(8);
    expect(parseFolderKey(folderKey('other', ['A', 'B']))).toEqual({ root: 'other', path: ['A', 'B'] });
    expect(parseFolderKey('["evil"]')).toBeNull();
  });

  it('lists bookmarks and subfolders in order, moves, renames and deletes folders', () => {
    const s = store();
    const a = s.add({ title: 'A', url: 'https://a.test/' });
    const b = s.add({ title: 'B', url: 'https://b.test/', path: ['Lavoro'] });
    s.add({ title: 'C', url: 'https://c.test/', path: ['Lavoro', 'Progetti'] });
    s.add({ title: 'D', url: 'https://d.test/', folder: 'other' });
    expect(folderEntries(s.list(), 'bar', []).map((e) => (e.kind === 'folder' ? `[${e.name}]` : e.bookmark.title))).toEqual(['A', '[Lavoro]']);
    expect(folderEntries(s.list(), 'bar', ['Lavoro']).map((e) => (e.kind === 'folder' ? `[${e.name}]` : e.bookmark.title))).toEqual(['B', '[Progetti]']);
    expect(allFolders(s.list()).map((f) => [f.root, ...f.path].join('/'))).toEqual(['bar', 'bar/Lavoro', 'bar/Lavoro/Progetti', 'other']);

    s.renameFolder('bar', ['Lavoro'], 'Ufficio');
    expect(s.list().map((x) => x.path ?? [])).toEqual([[], ['Ufficio'], ['Ufficio', 'Progetti'], []]);

    // Moving to the other root without a path: to its root; with a path: into that folder.
    s.update(b.id, { folder: 'other' });
    expect(s.list().find((x) => x.id === b.id)).not.toHaveProperty('path');
    s.update(a.id, { path: ['Nuova'] });
    expect(s.list().find((x) => x.id === a.id)?.path).toEqual(['Nuova']);

    expect(s.removeFolder('bar', ['Ufficio'])).toBe(1);
    expect(s.list().map((x) => x.title).sort()).toEqual(['A', 'B', 'D']);
    expect(s.removeFolder('bar', [])).toBe(0);
  });
});
