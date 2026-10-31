import { siteOf } from './privacy-rules';

/**
 * "Forget sites when their tabs close": which sites to clear, given the sites that had open tabs
 * before and the ones that have them now. Sites the user wants remembered are never cleared.
 */
export function sitesToForget(before: ReadonlySet<string>, now: ReadonlySet<string>, remembered: readonly string[]): string[] {
  const keep = new Set(remembered.map((s) => s.toLowerCase()));
  return [...before].filter((site) => !now.has(site) && !keep.has(site));
}

/** Sites of the pages open in a set of addresses (web pages only). */
export function openSites(urls: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const url of urls) {
    if (!/^https?:/i.test(url)) continue;
    const site = siteOf(url);
    if (site) out.add(site);
  }
  return out;
}

/** Whether a cookie (by its domain attribute) belongs to a site. */
export function cookieBelongsTo(cookieDomain: string, site: string): boolean {
  const domain = cookieDomain.replace(/^\./, '').toLowerCase();
  return domain === site || domain.endsWith(`.${site}`);
}
