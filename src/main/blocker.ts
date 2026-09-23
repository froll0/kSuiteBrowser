import { app, net } from 'electron';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FiltersEngine, Request } from '@ghostery/adblocker';
import { parse } from 'tldts';
import type { TrackingProtection } from '../shared/types';

/** Filter lists are refreshed once a week. */
const MAX_CACHE_AGE_MS = 7 * 24 * 3600 * 1000;

export interface BlockDecision {
  cancel?: boolean;
  redirectURL?: string;
}

/**
 * Ad and tracker blocking with the Ghostery engine (EasyList, EasyPrivacy and friends).
 * "standard" blocks ads and trackers; "strict" also blocks annoyances such as cookie banners.
 */
export class TrackerBlocker {
  private engine: FiltersEngine | null = null;
  private level: TrackingProtection = 'off';
  private loading: Promise<void> | null = null;
  private loadedAt: Date | null = null;

  /** Switches level; the lists are downloaded (or read from cache) in the background. */
  setLevel(level: TrackingProtection): Promise<void> {
    if (level === this.level && (this.engine || level === 'off')) return this.loading ?? Promise.resolve();
    this.level = level;
    if (level === 'off') {
      this.engine = null;
      return Promise.resolve();
    }
    const load = this.load(level)
      .then((engine) => {
        if (this.level === level) {
          this.engine = engine;
          this.loadedAt = new Date();
        }
      })
      .catch((err) => console.error('[blocker] liste non disponibili:', err));
    this.loading = load;
    return load;
  }

  describe(): string | null {
    if (!this.engine || !this.loadedAt) return null;
    const lists = this.level === 'strict' ? 'pubblicità, tracker e fastidi' : 'pubblicità e tracker';
    return `${lists} · caricate il ${this.loadedAt.toLocaleString('it-IT')}`;
  }

  /** Decision for a sub-resource request; main frames are never blocked. */
  check(details: { id: number; url: string; resourceType?: string; referrer?: string; webContentsId?: number }, pageUrl: string | null): BlockDecision | null {
    if (!this.engine || details.resourceType === 'mainFrame') return null;
    const request = Request.fromRawDetails({
      requestId: String(details.id),
      tabId: details.webContentsId,
      url: details.url,
      sourceUrl: pageUrl || details.referrer || undefined,
      type: (details.resourceType || 'other') as never,
    });
    if (request.type === 'other') request.guessTypeOfRequest();
    const { redirect, match } = this.engine.match(request);
    if (redirect) return { redirectURL: redirect.dataUrl };
    if (match) return { cancel: true };
    return null;
  }

  /** Extra CSP directives some filter rules add to documents. */
  cspFor(details: { id: number; url: string; resourceType?: string; referrer?: string }): string | undefined {
    if (!this.engine || (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame')) return undefined;
    const request = Request.fromRawDetails({ requestId: String(details.id), url: details.url, sourceUrl: details.referrer, type: details.resourceType as never });
    return this.engine.getCSPDirectives(request);
  }

  /** Cosmetic filters (element hiding CSS and scriptlets) for a page, used by the adblock preload script. */
  cosmetics(url: string, msg: { classes?: string[]; hrefs?: string[]; ids?: string[]; lifecycle?: string } | undefined, frame: { frameId: number; processId: number }) {
    if (!this.engine || this.level !== 'strict') return null;
    const parsed = parse(url);
    const first = msg === undefined;
    const { active, styles, scripts } = this.engine.getCosmeticsFilters({
      url,
      hostname: parsed.hostname || '',
      domain: parsed.domain || '',
      classes: msg?.classes,
      hrefs: msg?.hrefs,
      ids: msg?.ids,
      getBaseRules: first,
      getInjectionRules: first,
      getExtendedRules: false,
      getRulesFromHostname: first,
      getRulesFromDOM: !first,
      callerContext: { frameId: frame.frameId, processId: frame.processId, lifecycle: msg?.lifecycle },
    });
    return active === false ? null : { styles, scripts };
  }

  private async load(level: Exclude<TrackingProtection, 'off'>): Promise<FiltersEngine> {
    const dir = join(app.getPath('userData'), 'blocker');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${level}.bin`);
    try {
      if (Date.now() - (await stat(path)).mtimeMs > MAX_CACHE_AGE_MS) await unlink(path);
    } catch {
      /* no cache yet */
    }
    const caching = {
      path,
      read: async (p: string) => new Uint8Array(await readFile(p)),
      write: (p: string, data: Uint8Array) => writeFile(p, data),
    };
    const fetchImpl = (url: string) => net.fetch(url);
    return level === 'strict'
      ? FiltersEngine.fromPrebuiltFull(fetchImpl as never, caching)
      : FiltersEngine.fromPrebuiltAdsAndTracking(fetchImpl as never, caching);
  }
}
