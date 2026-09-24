import type { HistorySummary } from './suggest';
import type { TopSite } from './types';

/**
 * Most visited sites for the new tab page: one tile per origin (its most visited page),
 * ordered by total visits, skipping sites the user removed.
 */
export function topSites(history: HistorySummary[], hidden: readonly string[], limit = 8): TopSite[] {
  const byOrigin = new Map<string, { total: number; last: number; best: HistorySummary }>();
  for (const h of history) {
    let origin: string;
    try {
      const u = new URL(h.url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
      origin = u.origin;
    } catch {
      continue;
    }
    if (hidden.includes(origin)) continue;
    const entry = byOrigin.get(origin);
    if (!entry) byOrigin.set(origin, { total: h.visits, last: h.lastVisit, best: h });
    else {
      entry.total += h.visits;
      entry.last = Math.max(entry.last, h.lastVisit);
      if (h.visits > entry.best.visits) entry.best = h;
    }
  }
  return [...byOrigin.values()]
    .sort((a, b) => b.total - a.total || b.last - a.last)
    .slice(0, limit)
    .map(({ best }) => ({ url: best.url, title: best.title || new URL(best.url).hostname.replace(/^www\./, '') }));
}

/** Colour of the letter icon of a site, stable for a given host. */
export function letterColor(host: string): string {
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 45%)`;
}

/** Letter icon used when a site has no favicon. */
export function letterIconSvg(host: string): string {
  const letter = (host.replace(/^www\./, '')[0] ?? '?').toUpperCase().replace(/[<&>"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${letterColor(host)}"/><text x="16" y="22" text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="17" font-weight="700" fill="#fff">${letter}</text></svg>`;
}

/**
 * A saved favicon inside a 32×32 SVG, the same shape as the letter icons: a web page that loads
 * ksuite://favicon/ URLs can't tell a visited site (real icon) from an unknown one by size or type.
 */
export function framedIconSvg(mime: string, body: Uint8Array): string {
  const safeMime = /^image\/[a-z0-9.+-]+$/i.test(mime) ? mime : 'image/png';
  const data = Buffer.from(body).toString('base64');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><image href="data:${safeMime};base64,${data}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/></svg>`;
}

/** URL of a site's icon, served by the browser (cached favicon, or a letter icon). */
export function faviconUrl(pageUrl: string): string {
  return `ksuite://favicon/?url=${encodeURIComponent(pageUrl)}`;
}
