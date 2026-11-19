import type { Bookmark, BookmarkFolder } from './types';

/**
 * Bookmark folders. Every bookmark is in one of the two roots (the bar, "other bookmarks") and,
 * optionally, in a chain of subfolders (`path`). Folders are not stored on their own: a folder exists
 * while it holds bookmarks, in the order its first bookmark appears.
 */

export const MAX_FOLDER_DEPTH = 8;

/** A clean subfolder path: non-empty names (at most 80 characters), at most MAX_FOLDER_DEPTH levels. */
export function cleanPath(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const part of value) {
    if (typeof part !== 'string') break;
    const name = part.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!name) break;
    out.push(name);
    if (out.length >= MAX_FOLDER_DEPTH) break;
  }
  return out;
}

export function pathOf(b: Pick<Bookmark, 'path'>): string[] {
  return b.path ?? [];
}

export function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** `path` starts with `prefix` (a folder and everything inside it). */
export function inFolder(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((x, i) => x === path[i]);
}

/** A string that identifies a folder, for <select> values and maps. */
export function folderKey(root: BookmarkFolder, path: readonly string[]): string {
  return JSON.stringify([root, ...path]);
}

export function parseFolderKey(key: string): { root: BookmarkFolder; path: string[] } | null {
  try {
    const [root, ...path] = JSON.parse(key) as unknown[];
    if (root !== 'bar' && root !== 'other') return null;
    return { root, path: cleanPath(path) };
  } catch {
    return null;
  }
}

/** One level of a folder: its own bookmarks and its subfolders, mixed in list order. */
export type FolderEntry = { kind: 'bookmark'; bookmark: Bookmark } | { kind: 'folder'; name: string; path: string[] };

export function folderEntries(bookmarks: readonly Bookmark[], root: BookmarkFolder, path: readonly string[]): FolderEntry[] {
  const out: FolderEntry[] = [];
  const seen = new Set<string>();
  for (const b of bookmarks) {
    if (b.folder !== root) continue;
    const p = pathOf(b);
    if (!inFolder(p, path)) continue;
    if (p.length === path.length) out.push({ kind: 'bookmark', bookmark: b });
    else if (!seen.has(p[path.length])) {
      seen.add(p[path.length]);
      out.push({ kind: 'folder', name: p[path.length], path: p.slice(0, path.length + 1) });
    }
  }
  return out;
}

/** Every folder (roots included), parents before children. */
export function allFolders(bookmarks: readonly Bookmark[]): Array<{ root: BookmarkFolder; path: string[] }> {
  const out: Array<{ root: BookmarkFolder; path: string[] }> = [];
  const walk = (root: BookmarkFolder, path: string[]) => {
    out.push({ root, path });
    for (const e of folderEntries(bookmarks, root, path)) if (e.kind === 'folder') walk(root, e.path);
  };
  walk('bar', []);
  walk('other', []);
  return out;
}

/** How many bookmarks a folder holds, subfolders included. */
export function folderCount(bookmarks: readonly Bookmark[], root: BookmarkFolder, path: readonly string[]): number {
  return bookmarks.filter((b) => b.folder === root && inFolder(pathOf(b), path)).length;
}
