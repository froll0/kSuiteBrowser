/**
 * Redirect pages that only exist to record the click before sending you on ("bounce tracking"): when
 * a link goes through one of them, Velo opens the destination directly.
 */
interface Bouncer {
  /** Host, or a suffix starting with "." (any subdomain). */
  host: string;
  /** Path prefix. */
  path: string;
  /** Query parameters that hold the destination, in order of preference. */
  params: string[];
}

const BOUNCERS: Bouncer[] = [
  { host: 'l.facebook.com', path: '/l.php', params: ['u'] },
  { host: 'lm.facebook.com', path: '/l.php', params: ['u'] },
  { host: 'l.messenger.com', path: '/l.php', params: ['u'] },
  { host: 'l.instagram.com', path: '/', params: ['u'] },
  { host: 'l.threads.net', path: '/', params: ['u'] },
  { host: 'out.reddit.com', path: '/', params: ['url'] },
  { host: 'www.youtube.com', path: '/redirect', params: ['q'] },
  { host: 'youtube.com', path: '/redirect', params: ['q'] },
  { host: 'www.linkedin.com', path: '/redir/redirect', params: ['url'] },
  { host: 'away.vk.com', path: '/away.php', params: ['to'] },
  { host: 'vk.com', path: '/away.php', params: ['to'] },
  { host: 'steamcommunity.com', path: '/linkfilter/', params: ['url', 'u'] },
  { host: 't.umblr.com', path: '/redirect', params: ['z'] },
  { host: 'slack-redir.net', path: '/link', params: ['url'] },
  { host: 'link.zhihu.com', path: '/', params: ['target'] },
  { host: 'getpocket.com', path: '/redirect', params: ['url'] },
  { host: 'www.google.com', path: '/url', params: ['q', 'url'] },
  { host: 'google.com', path: '/url', params: ['q', 'url'] },
  { host: 'www.bing.com', path: '/ck/a', params: [] },
  { host: 'duckduckgo.com', path: '/l/', params: ['uddg'] },
  { host: 'exit.sc', path: '/', params: ['url'] },
  { host: 'href.li', path: '/', params: [] },
];

function matches(b: Bouncer, host: string): boolean {
  return b.host.startsWith('.') ? host.endsWith(b.host) : host === b.host;
}

/** The destination of a bounce link, or null when the address isn't one (or its target isn't a web page). */
export function debounce(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  const rule = BOUNCERS.find((b) => matches(b, host) && parsed.pathname.startsWith(b.path));
  if (!rule) return null;
  let target: string | null = null;
  for (const p of rule.params) {
    target = parsed.searchParams.get(p);
    if (target) break;
  }
  // href.li/?https://… : the destination is the whole query.
  if (!target && rule.params.length === 0 && host === 'href.li') target = decodeURIComponent(parsed.search.slice(1));
  if (!target) return null;
  try {
    const dest = new URL(target);
    if (dest.protocol !== 'https:' && dest.protocol !== 'http:') return null;
    // Never to another bounce page (no loops).
    if (BOUNCERS.some((b) => matches(b, dest.hostname.toLowerCase()) && dest.pathname.startsWith(b.path))) return null;
    return dest.href;
  } catch {
    return null;
  }
}
