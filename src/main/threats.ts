import { app, net } from 'electron';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ThreatIndex, parseThreatList, type ThreatKind } from '../shared/threat-match';

/** Phishing sites change fast: the lists are refreshed twice a day. */
const MAX_AGE_MS = 12 * 3600 * 1000;

/**
 * malware-filter lists (also used by uBlock Origin), with their mirrors. They are downloaded
 * and checked locally: no address you visit is sent anywhere.
 */
const LISTS: Array<{ kind: ThreatKind; urls: string[] }> = [
  {
    kind: 'phishing',
    urls: [
      'https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt',
      'https://curbengh.github.io/malware-filter/phishing-filter.txt',
      'https://malware-filter.pages.dev/phishing-filter.txt',
    ],
  },
  {
    kind: 'malware',
    urls: [
      'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-online.txt',
      'https://curbengh.github.io/malware-filter/urlhaus-filter-online.txt',
      'https://malware-filter.pages.dev/urlhaus-filter-online.txt',
    ],
  },
];

/** Tests can point the lists elsewhere: KSUITE_THREAT_LISTS="phishing=http://…,malware=http://…". */
function configuredLists(): Array<{ kind: ThreatKind; urls: string[] }> {
  const env = process.env.KSUITE_THREAT_LISTS;
  if (!env) return LISTS;
  return env.split(',').map((pair) => {
    const [kind, url] = pair.split('=');
    return { kind: kind === 'malware' ? 'malware' : 'phishing', urls: [url] };
  });
}

export interface ThreatStatus {
  entries: number;
  loadedAt: number | null;
}

/** Phishing and malware protection for pages and downloads. */
export class ThreatProtection {
  private index = new ThreatIndex();
  private loadedAt: number | null = null;
  private loading: Promise<void> | null = null;
  /** Hosts the user chose to open anyway, until the browser restarts. */
  private readonly bypass = new Set<string>();

  start(): void {
    void this.refresh();
    setInterval(() => void this.refresh(), MAX_AGE_MS).unref();
  }

  status(): ThreatStatus {
    return { entries: this.index.size, loadedAt: this.loadedAt };
  }

  match(url: string): ThreatKind | null {
    const kind = this.index.match(url);
    if (!kind) return null;
    try {
      if (this.bypass.has(new URL(url).hostname.toLowerCase())) return null;
    } catch {
      /* not a URL */
    }
    return kind;
  }

  allow(url: string): void {
    this.bypass.add(new URL(url).hostname.toLowerCase());
  }

  refresh(): Promise<void> {
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<void> {
    const dir = join(app.getPath('userData'), 'threats');
    await mkdir(dir, { recursive: true });
    const index = new ThreatIndex();
    let newest = 0;
    for (const list of configuredLists()) {
      const text = await this.listText(join(dir, `${list.kind}.txt`), list.urls);
      if (!text) continue;
      index.add(list.kind, parseThreatList(text.body));
      newest = Math.max(newest, text.at);
    }
    if (index.size > 0 || this.index.size === 0) {
      this.index = index;
      this.loadedAt = newest || null;
    }
  }

  /** Cached copy while fresh, otherwise a new download (the stale copy if every mirror fails). */
  private async listText(path: string, urls: string[]): Promise<{ body: string; at: number } | null> {
    let cached: { body: string; at: number } | null = null;
    try {
      const info = await stat(path);
      cached = { body: await readFile(path, 'utf8'), at: info.mtimeMs };
      if (Date.now() - info.mtimeMs < MAX_AGE_MS) return cached;
    } catch {
      /* no cache yet */
    }
    for (const url of urls) {
      try {
        const res = await net.fetch(url, { cache: 'no-store' });
        if (!res.ok) continue;
        const body = await res.text();
        if (body.length < 20) continue;
        await writeFile(path, body);
        return { body, at: Date.now() };
      } catch (err) {
        console.warn('[sicurezza] lista non scaricata:', url, err instanceof Error ? err.message : err);
      }
    }
    return cached;
  }
}
