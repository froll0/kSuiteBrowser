import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import type { ReaderArticle } from '../shared/types';

const WORLD = 1997;
const READER_PREFIX = 'ksuite://reader/';
let scripts: { readerable: string; readability: string } | null = null;

/** WebContents ids of pages that look like articles (shared: tabs move between windows). */
export const readerableIds = new Set<number>();

function injected(): { readerable: string; readability: string } {
  scripts ??= {
    readerable: readFileSync(join(__dirname, '../inject/readerable.js'), 'utf8'),
    readability: readFileSync(join(__dirname, '../inject/readability.js'), 'utf8'),
  };
  return scripts;
}

export function readerUrl(original: string): string {
  return `${READER_PREFIX}?url=${encodeURIComponent(original)}`;
}

/** The article address behind a ksuite://reader page, or null. */
export function readerOriginal(url: string): string | null {
  if (!url.startsWith(READER_PREFIX)) return null;
  try {
    const original = new URL(url).searchParams.get('url') ?? '';
    return /^https?:\/\//i.test(original) ? original : null;
  } catch {
    return null;
  }
}

/** Whether the page looks like an article (Readability's quick check, in an isolated world). */
export async function isReaderable(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed() || !/^https?:/i.test(contents.getURL())) return false;
  try {
    const result = await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `${injected().readerable}\n;__ksReaderable()` }]);
    return result === true;
  } catch {
    return false;
  }
}

/** Extracts the article of a page with Readability; null when there is none. */
export async function extractArticle(contents: WebContents): Promise<ReaderArticle | null> {
  const url = contents.getURL();
  if (!/^https?:/i.test(url)) return null;
  try {
    const raw = (await contents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `${injected().readability}\n;__ksReadability()` }])) as Omit<ReaderArticle, 'url'> | null;
    if (!raw || typeof raw.content !== 'string' || raw.content.length < 50) return null;
    const text = (v: unknown, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    return {
      url,
      title: text(raw.title, 300) ?? contents.getTitle(),
      byline: text(raw.byline, 200),
      siteName: text(raw.siteName, 100),
      lang: text(raw.lang, 20),
      dir: raw.dir === 'rtl' ? 'rtl' : null,
      publishedTime: text(raw.publishedTime, 60),
      excerpt: text(raw.excerpt),
      content: raw.content.slice(0, 2_000_000),
      length: Number(raw.length) || 0,
    };
  } catch {
    return null;
  }
}

/** Articles waiting to be shown (or re-shown on reload), most recent last. */
export class ReaderCache {
  private readonly items = new Map<string, ReaderArticle>();

  set(article: ReaderArticle): void {
    this.items.delete(article.url);
    this.items.set(article.url, article);
    while (this.items.size > 30) this.items.delete(this.items.keys().next().value!);
  }

  get(url: string): ReaderArticle | null {
    return this.items.get(url) ?? null;
  }
}
