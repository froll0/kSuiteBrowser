import type { Bookmark, Suggestion } from './types';
import { SEARCH_ENGINES, resolveOmniboxInput, type SearchEngineId } from './url';

export interface HistorySummary {
  url: string;
  title: string;
  visits: number;
  lastVisit: number;
}

const DAY = 24 * 3600 * 1000;

/** URL without scheme and "www.", as people type it. */
function typedForm(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').toLowerCase();
}

function score(entry: { url: string; title: string }, tokens: string[], extra: number): number | null {
  const url = typedForm(entry.url);
  const title = entry.title.toLowerCase();
  const haystack = `${title} ${url}`;
  if (!tokens.every((t) => haystack.includes(t))) return null;
  let s = extra;
  if (url.startsWith(tokens[0])) s += 40;
  else if (url.split('/')[0].includes(tokens[0])) s += 15;
  if (title.startsWith(tokens[0])) s += 10;
  return s;
}

/**
 * Address bar suggestions: first what Enter would do (open the URL or search), then bookmarks and history
 * pages whose title or address contains every word typed, best matches first.
 */
export function buildSuggestions(
  input: string,
  engine: SearchEngineId,
  history: HistorySummary[],
  bookmarks: Bookmark[],
  now = Date.now(),
  limit = 8,
): Suggestion[] {
  const text = input.trim();
  if (!text) return [];
  const target = resolveOmniboxInput(text, engine);
  const isSearch = target.startsWith((SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.duckduckgo).template.split('%s')[0]);
  const first: Suggestion = isSearch
    ? { kind: 'search', title: `${text} — ${engine === 'ksuite' ? 'Cerca in kSuite e sul web' : `Cerca con ${SEARCH_ENGINES[engine]?.name ?? 'DuckDuckGo'}`}`, url: target }
    : { kind: 'url', title: target, url: target };

  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const ranked = new Map<string, { s: Suggestion; score: number }>();
  const offer = (s: Suggestion, value: number | null) => {
    if (value === null || s.url === first.url) return;
    const existing = ranked.get(s.url);
    if (!existing || existing.score < value) ranked.set(s.url, { s, score: value });
  };

  for (const b of bookmarks) offer({ kind: 'bookmark', title: b.title || b.url, url: b.url }, score(b, tokens, 50));
  for (const h of history) {
    const recency = now - h.lastVisit < DAY ? 20 : now - h.lastVisit < 7 * DAY ? 10 : 0;
    const frequency = Math.min(30, h.visits * 3);
    const value = score(h, tokens, recency + frequency);
    const existing = ranked.get(h.url);
    // A visited bookmark keeps the bookmark icon but ranks with its history too.
    if (existing && value !== null) existing.score += recency + frequency;
    else offer({ kind: 'history', title: h.title || h.url, url: h.url }, value);
  }

  const rest = [...ranked.values()].sort((a, b) => b.score - a.score).map((r) => r.s);
  return [first, ...rest].slice(0, limit);
}

/**
 * Inline completion for the address bar: "git" → "github.com/" when a visited or bookmarked site starts
 * with what was typed. Completes to the site first (like other browsers), then to a full address.
 */
export function inlineCompletion(input: string, suggestions: Suggestion[]): { text: string; url: string } | null {
  if (!input || /\s/.test(input) || input.includes('://')) return null;
  const typed = input.toLowerCase();
  for (const s of suggestions) {
    if (s.kind !== 'history' && s.kind !== 'bookmark') continue;
    let parsed: URL;
    try {
      parsed = new URL(s.url);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(parsed.protocol)) continue;
    const host = parsed.host.replace(/^www\./i, '').toLowerCase();
    if (`${host}/`.startsWith(typed) && typed.length <= host.length) {
      return { text: input + `${host}/`.slice(typed.length), url: `${parsed.protocol}//${parsed.host}/` };
    }
    const full = typedForm(s.url);
    if (full.startsWith(typed) && full.length > typed.length) return { text: input + full.slice(typed.length), url: s.url };
  }
  return null;
}
