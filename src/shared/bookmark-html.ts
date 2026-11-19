import type { Bookmark, BookmarkFolder } from './types';
import { folderEntries } from './bookmark-folders';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

function decode(text: string): string {
  return text
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e: string) => {
      const key = e.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return m;
    })
    .trim();
}

function encode(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const BAR_NAMES = /^(barra dei preferiti|bookmarks bar|bookmarks toolbar|barra degli strumenti dei segnalibri|barra dei segnalibri|favorites bar|barra preferiti|lesezeichenleiste|barre de favoris|barre personnelle)$/i;
/** Top folders that are another browser's "other bookmarks" or menu: their content goes to the root of ours. */
const OTHER_NAMES = /^(altri preferiti|other bookmarks|other favorites|altri segnalibri|segnalibri non catalogati|unsorted bookmarks|bookmarks menu|menu dei segnalibri|weitere lesezeichen|autres favoris|preferiti su dispositivi mobili|mobile bookmarks)$/i;

type Parsed = { title: string; url: string; folder: BookmarkFolder; path?: string[] };

/**
 * Reads a bookmarks file exported by Chrome, Edge, Firefox or Safari (Netscape bookmark format).
 * Everything in the browser's toolbar folder goes to our bookmarks bar, the rest to "other bookmarks",
 * with their subfolders.
 */
export function parseBookmarksHtml(html: string): Parsed[] {
  const out: Parsed[] = [];
  // The folders open at this point: name, and whether it is the toolbar or another browser's root.
  const stack: Array<{ name: string; bar: boolean; root: boolean }> = [];
  let pending: { name: string; bar: boolean; root: boolean } | null = null;
  const re = /<h3([^>]*)>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, 3).toLowerCase();
    if (m[2] !== undefined) {
      const name = decode(m[2].replace(/<[^>]+>/g, '')) || '…';
      const bar = /personal_toolbar_folder\s*=\s*"true"/i.test(m[1]) || BAR_NAMES.test(name);
      // Only a top folder can be a root (a subfolder called "Other bookmarks" stays a subfolder).
      const top = !stack.some((f) => f.name);
      pending = { name, bar, root: top && (bar || /unfiled_bookmarks_folder\s*=\s*"true"/i.test(m[1]) || OTHER_NAMES.test(name)) };
    } else if (m[3] !== undefined) {
      const href = /href\s*=\s*"([^"]*)"/i.exec(m[3])?.[1];
      if (!href) continue;
      const url = decode(href);
      if (!/^(https?|file):/i.test(url)) continue;
      const barAt = stack.findIndex((f) => f.bar);
      const path = stack.slice(barAt + 1).filter((f) => f.name && !f.root).map((f) => f.name).slice(0, 8);
      out.push({ title: decode(m[4].replace(/<[^>]+>/g, '')) || url, url, folder: barAt >= 0 ? 'bar' : 'other', ...(path.length ? { path } : {}) });
    } else if (tag === '<dl') {
      // The outermost list has no folder heading.
      stack.push(pending ?? { name: '', bar: false, root: true });
      pending = null;
    } else {
      stack.pop();
    }
  }
  return out;
}

/** Bookmarks file that every browser can import, subfolders included. */
export function exportBookmarksHtml(bookmarks: Bookmark[], now = Date.now()): string {
  const stamp = Math.floor(now / 1000);
  const level = (root: BookmarkFolder, path: string[], indent: string): string =>
    folderEntries(bookmarks, root, path)
      .map((e) =>
        e.kind === 'bookmark'
          ? `${indent}<DT><A HREF="${encode(e.bookmark.url)}" ADD_DATE="${Math.floor(e.bookmark.createdAt / 1000)}">${encode(e.bookmark.title)}</A>`
          : `${indent}<DT><H3 ADD_DATE="${stamp}">${encode(e.name)}</H3>\n${indent}<DL><p>\n${level(root, e.path, indent + '    ')}\n${indent}</DL><p>`,
      )
      .join('\n');
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="${stamp}" PERSONAL_TOOLBAR_FOLDER="true">Barra dei preferiti</H3>
    <DL><p>
${level('bar', [], '        ')}
    </DL><p>
    <DT><H3 ADD_DATE="${stamp}">Altri preferiti</H3>
    <DL><p>
${level('other', [], '        ')}
    </DL><p>
</DL><p>
`;
}
