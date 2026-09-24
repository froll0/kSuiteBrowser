export type WebSearchEngineId = 'duckduckgo' | 'qwant' | 'ecosia' | 'startpage' | 'google';
/** "ksuite" is the unified search page (your kSuite data + a link to the web engine). */
export type SearchEngineId = WebSearchEngineId | 'ksuite';

export const WEB_SEARCH_ENGINES: Record<WebSearchEngineId, { name: string; template: string }> = {
  duckduckgo: { name: 'DuckDuckGo', template: 'https://duckduckgo.com/?q=%s' },
  qwant: { name: 'Qwant', template: 'https://www.qwant.com/?q=%s' },
  ecosia: { name: 'Ecosia', template: 'https://www.ecosia.org/search?q=%s' },
  startpage: { name: 'Startpage', template: 'https://www.startpage.com/do/search?q=%s' },
  google: { name: 'Google', template: 'https://www.google.com/search?q=%s' },
};

export const SEARCH_ENGINES: Record<SearchEngineId, { name: string; template: string }> = {
  ksuite: { name: 'kSuite (ricerca unificata)', template: 'ksuite://search/?q=%s' },
  ...WEB_SEARCH_ENGINES,
};

export function webSearchUrl(query: string, engine: WebSearchEngineId): string {
  return (WEB_SEARCH_ENGINES[engine] ?? WEB_SEARCH_ENGINES.duckduckgo).template.replace('%s', encodeURIComponent(query));
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'file:', 'about:', 'view-source:', 'ksuite:']);

/**
 * Turns what the user typed in the address bar into a URL:
 * a full URL is kept, something that looks like a host gets https://, anything else becomes a search.
 */
export function resolveOmniboxInput(input: string, engine: SearchEngineId = 'duckduckgo'): string {
  const text = input.trim();
  if (!text) return 'about:blank';

  if (SCHEME_RE.test(text) && !/^[^/:]+:\d+/.test(text)) {
    try {
      const url = new URL(text);
      if (ALLOWED_SCHEMES.has(url.protocol)) return url.href;
    } catch {
      /* fall through to search */
    }
    return searchUrl(text, engine);
  }

  if (!/\s/.test(text) && looksLikeHost(text)) {
    const scheme = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text) ? 'http://' : 'https://';
    try {
      return new URL(scheme + text).href;
    } catch {
      /* fall through */
    }
  }
  return searchUrl(text, engine);
}

function looksLikeHost(text: string): boolean {
  const host = text.split(/[/?#]/)[0];
  if (/^localhost(:\d+)?$/i.test(host)) return true;
  if (/^\[[0-9a-f:]+\](:\d+)?$/i.test(host)) return true;
  return /^([a-z0-9-]+\.)+[a-z0-9-]{2,}(:\d+)?$/i.test(host);
}

export function searchUrl(query: string, engine: SearchEngineId): string {
  const template = (SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.duckduckgo).template;
  return template.replace('%s', encodeURIComponent(query));
}

/** Address as people read it: decoded, without "https://" and a trailing slash. */
export function readableUrl(url: string): string {
  let text = url;
  try {
    text = decodeURI(url);
  } catch {
    /* keep it encoded */
  }
  return text.replace(/^https:\/\//i, '').replace(/^(?=[^/]+\/$)(.*)\/$/, '$1');
}
