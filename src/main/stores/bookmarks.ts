import { randomUUID } from 'node:crypto';
import type { Bookmark, BookmarkFolder } from '../../shared/types';
import { JsonFile } from './json-file';
import { cleanPath, inFolder, pathOf, samePath } from '../../shared/bookmark-folders';

/** The path field, left out at the root. */
function withPath<T extends object>(b: T, path: unknown): T & { path?: string[] } {
  const clean = cleanPath(path);
  const { path: _old, ...rest } = b as T & { path?: unknown };
  return (clean.length ? { ...rest, path: clean } : rest) as T & { path?: string[] };
}

function parse(raw: unknown): Bookmark[] {
  const list = (raw as { bookmarks?: unknown })?.bookmarks;
  if (!Array.isArray(list)) return [];
  return list
    .filter((b): b is Bookmark => !!b && typeof b.id === 'string' && typeof b.url === 'string' && typeof b.title === 'string')
    .map((b) => withPath({ ...b, folder: b.folder === 'other' ? 'other' : 'bar', createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now() }, b.path));
}

/** Lets "https://site.com" and "https://site.com/" count as the same bookmark. */
export function sameBookmarkUrl(a: string, b: string): boolean {
  const norm = (u: string) => {
    try {
      const url = new URL(u);
      url.hash = '';
      return url.href.replace(/\/$/, '');
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
}

/** Bookmarks in two root folders (the bookmarks bar, "other bookmarks") and their subfolders, in display order. */
export class BookmarksStore {
  private readonly file: JsonFile<{ bookmarks: Bookmark[] }>;
  private readonly listeners = new Set<(list: Bookmark[]) => void>();

  constructor(path: string) {
    this.file = new JsonFile(path, (raw) => ({ bookmarks: parse(raw) }), 300);
  }

  list(): Bookmark[] {
    return this.file.data.bookmarks;
  }

  find(url: string): Bookmark | undefined {
    return this.list().find((b) => sameBookmarkUrl(b.url, url));
  }

  add(input: { title: string; url: string; folder?: BookmarkFolder; path?: string[] }): Bookmark {
    const bookmark: Bookmark = withPath({
      id: randomUUID(),
      title: input.title.trim() || input.url,
      url: input.url,
      folder: input.folder === 'other' ? 'other' : 'bar',
      createdAt: Date.now(),
    }, input.path);
    this.file.data.bookmarks = [...this.list(), bookmark];
    this.changed();
    return bookmark;
  }

  /** Changes a bookmark; a new root folder without a path moves it to the root of that folder. */
  update(id: string, patch: Partial<Pick<Bookmark, 'title' | 'url' | 'folder' | 'path'>>): void {
    const list = [...this.list()];
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) return;
    const b = list[index];
    let next: Bookmark = { ...b };
    if (typeof patch.title === 'string') next.title = patch.title.trim() || b.url;
    if (typeof patch.url === 'string' && isValidUrl(patch.url)) next.url = patch.url.trim();
    const moved = (patch.folder === 'bar' || patch.folder === 'other') && patch.folder !== b.folder;
    if (patch.folder === 'bar' || patch.folder === 'other') next.folder = patch.folder;
    if (patch.path !== undefined || moved) next = withPath(next, patch.path ?? []);
    if (next.folder !== b.folder || !samePath(pathOf(next), pathOf(b))) {
      // Moved: it goes last in its new folder.
      list.splice(index, 1);
      list.push(next);
    } else list[index] = next;
    this.file.data.bookmarks = list;
    this.changed();
  }

  /** Renames a subfolder (and keeps everything inside it). */
  renameFolder(root: BookmarkFolder, path: string[], name: string): void {
    const clean = cleanPath([name])[0];
    const from = cleanPath(path);
    if (!clean || !from.length) return;
    const to = [...from.slice(0, -1), clean];
    this.file.data.bookmarks = this.list().map((b) => (b.folder === root && inFolder(pathOf(b), from) ? withPath(b, [...to, ...pathOf(b).slice(from.length)]) : b));
    this.changed();
  }

  /** Deletes a subfolder with everything inside it; returns how many bookmarks were removed. */
  removeFolder(root: BookmarkFolder, path: string[]): number {
    const from = cleanPath(path);
    if (!from.length) return 0;
    const before = this.list().length;
    this.file.data.bookmarks = this.list().filter((b) => !(b.folder === root && inFolder(pathOf(b), from)));
    this.changed();
    return before - this.list().length;
  }

  remove(id: string): void {
    this.file.data.bookmarks = this.list().filter((b) => b.id !== id);
    this.changed();
  }

  /** Moves a bookmark one place up or down within its folder. */
  shift(id: string, direction: -1 | 1): void {
    const list = [...this.list()];
    const index = list.findIndex((b) => b.id === id);
    if (index === -1) return;
    const { folder } = list[index];
    const path = pathOf(list[index]);
    const same = (b: Bookmark) => b.folder === folder && samePath(pathOf(b), path);
    let target = index + direction;
    while (target >= 0 && target < list.length && !same(list[target])) target += direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.file.data.bookmarks = list;
    this.changed();
  }

  /** Adds imported bookmarks, skipping addresses already present; returns how many were added. */
  import(items: Array<{ title: string; url: string; folder: BookmarkFolder; path?: string[] }>): number {
    let added = 0;
    const list = [...this.list()];
    for (const item of items) {
      if (!isValidUrl(item.url) || list.some((b) => sameBookmarkUrl(b.url, item.url))) continue;
      list.push(withPath({ id: randomUUID(), title: String(item.title ?? '').trim() || item.url, url: item.url, folder: item.folder === 'bar' ? 'bar' : 'other', createdAt: Date.now() }, item.path));
      added++;
    }
    this.file.data.bookmarks = list;
    if (added) this.changed();
    return added;
  }

  /** Replaces the whole list (sync), keeping the given order. */
  replaceAll(list: Bookmark[]): void {
    this.file.data.bookmarks = list.filter((b) => isValidUrl(b.url)).map((b) => withPath(b, b.path));
    this.changed();
  }

  onChange(listener: (list: Bookmark[]) => void): void {
    this.listeners.add(listener);
  }

  flush(): void {
    this.file.flush();
  }

  private changed(): void {
    this.file.changed();
    for (const l of this.listeners) l(this.list());
  }
}

export function isValidUrl(url: string): boolean {
  try {
    return ['http:', 'https:', 'file:', 'velo:'].includes(new URL(url.trim()).protocol);
  } catch {
    return false;
  }
}
