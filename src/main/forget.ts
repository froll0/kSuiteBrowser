import type { Session } from 'electron';
import { cookieBelongsTo, openSites, sitesToForget } from '../shared/forget-sites';
import { siteOf } from '../shared/privacy-rules';
import type { SettingsStore } from './settings';

/** Time before a closed site is cleared: a page that reopens or redirects meanwhile keeps its data. */
const GRACE_MS = 15_000;

/**
 * "Forget sites when their tabs close" (normal windows): once no tab shows a site any more, its cookies
 * and stored data are deleted, unless the user chose to remember it.
 */
export class SiteForgetter {
  private open = new Set<string>();
  /** Origins seen per site, whose storage is cleared with it. */
  private readonly origins = new Map<string, Set<string>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly session: Session,
    private readonly settings: SettingsStore,
    /** Addresses of every tab of the normal windows, sleeping ones included. */
    private readonly openUrls: () => string[],
  ) {}

  /** Called whenever tabs change (open, close, navigate). */
  update(): void {
    const urls = this.openUrls();
    for (const url of urls) {
      try {
        const u = new URL(url);
        const site = siteOf(url);
        if (site && /^https?:$/.test(u.protocol)) {
          if (!this.origins.has(site)) this.origins.set(site, new Set());
          this.origins.get(site)!.add(u.origin);
        }
      } catch {
        /* not a URL */
      }
    }
    const now = openSites(urls);
    for (const site of now) {
      clearTimeout(this.timers.get(site));
      this.timers.delete(site);
    }
    const s = this.settings.get();
    if (s.forgetSitesOnClose) {
      for (const site of sitesToForget(this.open, now, s.rememberedSites)) {
        clearTimeout(this.timers.get(site));
        this.timers.set(site, setTimeout(() => void this.forgetIfClosed(site), GRACE_MS));
      }
    }
    this.open = now;
  }

  private async forgetIfClosed(site: string): Promise<void> {
    this.timers.delete(site);
    const s = this.settings.get();
    if (!s.forgetSitesOnClose || s.rememberedSites.includes(site) || openSites(this.openUrls()).has(site)) return;
    await this.forget(site);
  }

  /** Deletes a site's cookies and the storage of the origins seen for it. */
  async forget(site: string): Promise<void> {
    const cookies = await this.session.cookies.get({}).catch(() => []);
    await Promise.all(
      cookies
        .filter((c) => c.domain && cookieBelongsTo(c.domain, site))
        .map((c) => this.session.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain!.replace(/^\./, '')}${c.path ?? '/'}`, c.name).catch(() => undefined)),
    );
    const origins = new Set([...(this.origins.get(site) ?? []), `https://${site}`, `https://www.${site}`]);
    for (const origin of origins) await this.session.clearStorageData({ origin }).catch(() => undefined);
    this.origins.delete(site);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
