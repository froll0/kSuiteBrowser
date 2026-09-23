import type { Bookmark, BookmarkFolder } from './types';

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

/**
 * Reads a bookmarks file exported by Chrome, Edge, Firefox or Safari (Netscape bookmark format).
 * Everything in the browser's toolbar folder goes to our bookmarks bar, the rest to "other bookmarks".
 */
export function parseBookmarksHtml(html: string): Array<{ title: string; url: string; folder: BookmarkFolder }> {
  const out: Array<{ title: string; url: string; folder: BookmarkFolder }> = [];
  const stack: boolean[] = []; // true when the folder at that depth is the toolbar
  let pendingFolderIsBar: boolean | null = null;
  const re = /<h3([^>]*)>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>|<dl[^>]*>|<\/dl>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0].slice(0, 3).toLowerCase();
    if (m[2] !== undefined) {
      pendingFolderIsBar = /personal_toolbar_folder\s*=\s*"true"/i.test(m[1]) || BAR_NAMES.test(decode(m[2].replace(/<[^>]+>/g, '')));
    } else if (m[3] !== undefined) {
      const href = /href\s*=\s*"([^"]*)"/i.exec(m[3])?.[1];
      if (!href) continue;
      const url = decode(href);
      if (!/^(https?|file):/i.test(url)) continue;
      out.push({ title: decode(m[4].replace(/<[^>]+>/g, '')) || url, url, folder: stack.includes(true) ? 'bar' : 'other' });
    } else if (tag === '<dl') {
      stack.push(pendingFolderIsBar ?? false);
      pendingFolderIsBar = null;
    } else {
      stack.pop();
    }
  }
  return out;
}

/** Bookmarks file that every browser can import. */
export function exportBookmarksHtml(bookmarks: Bookmark[], now = Date.now()): string {
  const stamp = Math.floor(now / 1000);
  const items = (folder: BookmarkFolder) =>
    bookmarks
      .filter((b) => b.folder === folder)
      .map((b) => `        <DT><A HREF="${encode(b.url)}" ADD_DATE="${Math.floor(b.createdAt / 1000)}">${encode(b.title)}</A>`)
      .join('\n');
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. It will be read and overwritten. DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="${stamp}" PERSONAL_TOOLBAR_FOLDER="true">Barra dei preferiti</H3>
    <DL><p>
${items('bar')}
    </DL><p>
    <DT><H3 ADD_DATE="${stamp}">Altri preferiti</H3>
    <DL><p>
${items('other')}
    </DL><p>
</DL><p>
`;
}
