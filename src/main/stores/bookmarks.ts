import { randomUUID } from 'node:crypto';
import type { Bookmark, BookmarkFolder } from '../../shared/types';
import { JsonFile } from './json-file';

function parse(raw: unknown): Bookmark[] {
  const list = (raw as { bookmarks?: unknown })?.bookmarks;
  if (!Array.isArray(list)) return [];
  return list
    .filter((b): b is Bookmark => !!b && typeof b.id === 'string' && typeof b.url === 'string' && typeof b.title === 'string')
    .map((b) => ({ ...b, folder: b.folder === 'other' ? 'other' : 'bar', createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now() }));
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

/** Bookmarks in two folders: the bookmarks bar and "other bookmarks", in display order. */
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

  add(input: { title: string; url: string; folder?: BookmarkFolder }): Bookmark {
    const bookmark: Bookmark = {
      id: randomUUID(),
      title: input.title.trim() || input.url,
      url: input.url,
      folder: input.folder ?? 'bar',
      createdAt: Date.now(),
    };
    this.file.data.bookmarks = [...this.list(), bookmark];
    this.changed();
    return bookmark;
  }

  update(id: string, patch: Partial<Pick<Bookmark, 'title' | 'url' | 'folder'>>): void {
    this.file.data.bookmarks = this.list().map((b) => {
      if (b.id !== id) return b;
      const next = { ...b };
      if (typeof patch.title === 'string') next.title = patch.title.trim() || b.url;
      if (typeof patch.url === 'string' && isValidUrl(patch.url)) next.url = patch.url.trim();
      if (patch.folder === 'bar' || patch.folder === 'other') next.folder = patch.folder;
      return next;
    });
    this.changed();
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
    const folder = list[index].folder;
    let target = index + direction;
    while (target >= 0 && target < list.length && list[target].folder !== folder) target += direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.file.data.bookmarks = list;
    this.changed();
  }

  /** Adds imported bookmarks, skipping addresses already present; returns how many were added. */
  import(items: Array<{ title: string; url: string; folder: BookmarkFolder }>): number {
    let added = 0;
    const list = [...this.list()];
    for (const item of items) {
      if (!isValidUrl(item.url) || list.some((b) => sameBookmarkUrl(b.url, item.url))) continue;
      list.push({ id: randomUUID(), title: item.title?.trim() || item.url, url: item.url, folder: item.folder === 'bar' ? 'bar' : 'other', createdAt: Date.now() });
      added++;
    }
    this.file.data.bookmarks = list;
    if (added) this.changed();
    return added;
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
    return ['http:', 'https:', 'file:', 'ksuite:'].includes(new URL(url.trim()).protocol);
  } catch {
    return false;
  }
}
