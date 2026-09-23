import { randomUUID } from 'node:crypto';
import type { HistorySummary } from '../../shared/suggest';
import type { HistoryVisit } from '../../shared/types';
import { JsonFile } from './json-file';

const MAX_VISITS = 50_000;
const MAX_AGE_MS = 180 * 24 * 3600 * 1000;
/** Reloading or coming back to the same page shortly after counts as the same visit. */
const MERGE_WINDOW_MS = 30 * 60 * 1000;

function parse(raw: unknown): HistoryVisit[] {
  const list = (raw as { visits?: unknown })?.visits;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (v): v is HistoryVisit =>
      !!v && typeof v.id === 'string' && typeof v.url === 'string' && typeof v.title === 'string' && typeof v.visitedAt === 'number',
  );
}

/** Pages visited in normal windows, newest last. */
export class HistoryStore {
  private readonly file: JsonFile<{ visits: HistoryVisit[] }>;

  constructor(path: string) {
    this.file = new JsonFile(path, (raw) => ({ visits: parse(raw) }));
    this.prune();
  }

  private get visits(): HistoryVisit[] {
    return this.file.data.visits;
  }

  /** Records a visit and returns its id (to attach the title once the page has one). */
  add(url: string, title: string, now = Date.now()): string {
    const last = this.visits[this.visits.length - 1];
    if (last && last.url === url && now - last.visitedAt < MERGE_WINDOW_MS) {
      last.visitedAt = now;
      if (title) last.title = title;
      this.file.changed();
      return last.id;
    }
    const visit: HistoryVisit = { id: randomUUID(), url, title, visitedAt: now };
    this.visits.push(visit);
    if (this.visits.length > MAX_VISITS) this.visits.splice(0, this.visits.length - MAX_VISITS);
    this.file.changed();
    return visit.id;
  }

  setTitle(id: string, title: string): void {
    for (let i = this.visits.length - 1; i >= 0; i--) {
      if (this.visits[i].id === id) {
        if (this.visits[i].title !== title) {
          this.visits[i].title = title;
          this.file.changed();
        }
        return;
      }
    }
  }

  /** Visits matching a text, newest first, for the history page. */
  search(query: string, limit = 200, before = Infinity): HistoryVisit[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out: HistoryVisit[] = [];
    for (let i = this.visits.length - 1; i >= 0 && out.length < limit; i--) {
      const v = this.visits[i];
      if (v.visitedAt >= before) continue;
      const text = `${v.title} ${v.url}`.toLowerCase();
      if (tokens.every((t) => text.includes(t))) out.push(v);
    }
    return out;
  }

  /** One entry per address, for address bar suggestions. */
  summaries(): HistorySummary[] {
    const map = new Map<string, HistorySummary>();
    for (const v of this.visits) {
      const s = map.get(v.url);
      if (s) {
        s.visits++;
        s.lastVisit = v.visitedAt;
        if (v.title) s.title = v.title;
      } else {
        map.set(v.url, { url: v.url, title: v.title, visits: 1, lastVisit: v.visitedAt });
      }
    }
    return [...map.values()];
  }

  remove(ids: string[]): void {
    const set = new Set(ids);
    this.file.data.visits = this.visits.filter((v) => !set.has(v.id));
    this.file.changed();
  }

  /** Deletes visits made since `from` (epoch ms); 0 deletes everything. */
  clearSince(from: number): void {
    this.file.data.visits = from <= 0 ? [] : this.visits.filter((v) => v.visitedAt < from);
    this.file.changed();
  }

  flush(): void {
    this.file.flush();
  }

  private prune(): void {
    const limit = Date.now() - MAX_AGE_MS;
    const kept = this.visits.filter((v) => v.visitedAt >= limit);
    if (kept.length !== this.visits.length) {
      this.file.data.visits = kept;
      this.file.changed();
    }
  }
}
