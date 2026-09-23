import { JsonFile } from './json-file';

interface Favicon {
  /** Where the icon was downloaded from. */
  source: string;
  mime: string;
  data: string;
  savedAt: number;
}

const MAX_ICONS = 3000;
const MAX_BYTES = 100 * 1024;
const REFRESH_MS = 7 * 24 * 3600 * 1000;

/** Site icons (one per origin), so history, bookmarks and suggestions can show them offline. */
export class FaviconStore {
  private readonly file: JsonFile<{ icons: Record<string, Favicon> }>;
  private readonly inFlight = new Set<string>();

  constructor(path: string) {
    this.file = new JsonFile(path, (raw) => {
      const icons = (raw as { icons?: unknown })?.icons;
      return { icons: icons && typeof icons === 'object' ? (icons as Record<string, Favicon>) : {} };
    }, 2000);
  }

  get(origin: string): { mime: string; body: Buffer } | null {
    const icon = this.file.data.icons[origin];
    return icon ? { mime: icon.mime, body: Buffer.from(icon.data, 'base64') } : null;
  }

  /** Downloads and stores the icon of an origin unless a recent copy from the same source exists. */
  async record(origin: string, source: string, fetchIcon: (url: string) => Promise<Response>): Promise<void> {
    const existing = this.file.data.icons[origin];
    if (existing && existing.source === source && Date.now() - existing.savedAt < REFRESH_MS) return;
    if (this.inFlight.has(origin) || !/^(https?|data):/i.test(source)) return;
    this.inFlight.add(origin);
    try {
      const res = await fetchIcon(source);
      const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!res.ok || !/^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|jpeg|webp)$/.test(mime)) return;
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0 || body.length > MAX_BYTES) return;
      this.file.data.icons[origin] = { source, mime, data: body.toString('base64'), savedAt: Date.now() };
      this.prune();
      this.file.changed();
    } catch {
      /* offline or blocked: the letter icon will be used */
    } finally {
      this.inFlight.delete(origin);
    }
  }

  clear(): void {
    this.file.data.icons = {};
    this.file.changed();
  }

  flush(): void {
    this.file.flush();
  }

  private prune(): void {
    const entries = Object.entries(this.file.data.icons);
    if (entries.length <= MAX_ICONS) return;
    entries.sort((a, b) => a[1].savedAt - b[1].savedAt);
    for (const [origin] of entries.slice(0, entries.length - MAX_ICONS)) delete this.file.data.icons[origin];
  }
}
