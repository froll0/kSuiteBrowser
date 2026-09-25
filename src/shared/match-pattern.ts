/**
 * Chrome extension match patterns (e.g. https://*.example.com/ followed by a path glob, or <all_urls>), used to
 * check an extension's host permissions and the pages its context menu items apply to.
 * https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns
 */

const SCHEMES = ['http', 'https', 'ws', 'wss', 'file', 'ftp'];

export interface MatchPattern {
  scheme: string;
  host: string;
  path: string;
}

export function parsePattern(pattern: string): MatchPattern | 'all' | null {
  if (pattern === '<all_urls>') return 'all';
  const m = /^(\*|[a-z-]+):\/\/(\*|\*\.[^/*]+|[^/*]*)(\/.*)$/.exec(pattern);
  if (!m) return null;
  const [, scheme, host, path] = m;
  if (scheme !== '*' && !SCHEMES.includes(scheme)) return null;
  if (scheme !== 'file' && !host) return null;
  return { scheme, host, path };
}

function globToRegExp(glob: string): RegExp {
  return new RegExp(`^${glob.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
}

/** True when `url` is matched by `pattern`. */
export function matchesPattern(pattern: string, url: string): boolean {
  const p = parsePattern(pattern);
  if (!p) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const scheme = u.protocol.slice(0, -1);
  if (p === 'all') return SCHEMES.includes(scheme);
  if (p.scheme === '*' ? !['http', 'https', 'ws', 'wss'].includes(scheme) : p.scheme !== scheme) return false;
  const host = u.hostname.toLowerCase();
  if (p.host !== '*') {
    if (p.host.startsWith('*.')) {
      const base = p.host.slice(2).toLowerCase();
      if (host !== base && !host.endsWith(`.${base}`)) return false;
    } else if (host !== p.host.toLowerCase()) {
      return false;
    }
  }
  return globToRegExp(p.path).test(`${u.pathname}${u.search}`);
}

export function matchesAny(patterns: readonly string[] | undefined, url: string): boolean {
  return Boolean(patterns?.some((p) => matchesPattern(p, url)));
}

/** Host access asked for by a manifest, V2 ("permissions") or V3 ("host_permissions"), plus content scripts. */
export function hostPatterns(manifest: { permissions?: unknown[]; host_permissions?: unknown[]; content_scripts?: Array<{ matches?: unknown[] }> }): string[] {
  const out = new Set<string>();
  for (const p of [...(manifest.host_permissions ?? []), ...(manifest.permissions ?? [])]) if (typeof p === 'string' && parsePattern(p)) out.add(p);
  for (const cs of manifest.content_scripts ?? []) for (const p of cs.matches ?? []) if (typeof p === 'string' && parsePattern(p)) out.add(p);
  return [...out];
}

/** True when the patterns reach (almost) every site. */
export function allSites(patterns: readonly string[]): boolean {
  return patterns.some((p) => {
    const parsed = parsePattern(p);
    return parsed === 'all' || (parsed !== null && parsed.host === '*');
  });
}
