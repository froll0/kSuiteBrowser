/**
 * Sync model: every device keeps a full copy of the state and writes it (encrypted) to its own file
 * in kDrive. States merge record by record: the most recent change wins, deletions travel as
 * tombstones. No device ever overwrites another's file, so there are no write conflicts.
 */

export interface SyncRecord<T> {
  updatedAt: number;
  deleted?: boolean;
  data?: T;
}

export interface BookmarkData {
  title: string;
  url: string;
  folder: 'bar' | 'other';
  position: number;
  createdAt: number;
}

export interface LoginData {
  origin: string;
  username: string;
  password: string;
  createdAt: number;
}

export interface HistoryData {
  url: string;
  title: string;
  lastVisit: number;
}

export interface SyncState {
  bookmarks: Record<string, SyncRecord<BookmarkData>>;
  logins: Record<string, SyncRecord<LoginData>>;
  history: Record<string, SyncRecord<HistoryData>>;
}

export type Collection = keyof SyncState;
export const COLLECTIONS: Collection[] = ['bookmarks', 'logins', 'history'];

/** Deletions are forgotten after 90 days (every device has seen them by then, or never will). */
export const TOMBSTONE_TTL_MS = 90 * 24 * 3600 * 1000;
/** Only recent history travels, to keep the files small. */
export const HISTORY_WINDOW_MS = 90 * 24 * 3600 * 1000;

export function emptyState(): SyncState {
  return { bookmarks: {}, logins: {}, history: {} };
}

// ---------- Keys ----------

/** Same bookmark on two devices = same address (without fragment and trailing slash). */
export function bookmarkKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch {
    return url;
  }
}

export function loginKey(origin: string, username: string): string {
  return `${origin}\n${username}`;
}

// ---------- Merge ----------

/** Deterministic winner: newest change; on a tie a deletion wins, then the larger content. */
function newer<T>(a: SyncRecord<T> | undefined, b: SyncRecord<T> | undefined): SyncRecord<T> | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (Boolean(a.deleted) !== Boolean(b.deleted)) return a.deleted ? a : b;
  return JSON.stringify(a.data ?? null) >= JSON.stringify(b.data ?? null) ? a : b;
}

export function mergeStates(...states: Array<Partial<SyncState> | undefined>): SyncState {
  const out = emptyState();
  for (const state of states) {
    if (!state) continue;
    for (const c of COLLECTIONS) {
      const target = out[c] as Record<string, SyncRecord<unknown>>;
      for (const [key, record] of Object.entries(state[c] ?? {})) {
        if (!record || typeof record.updatedAt !== 'number') continue;
        target[key] = newer(target[key], record as SyncRecord<unknown>)!;
      }
    }
  }
  return out;
}

/** Drops old tombstones and history older than the window. */
export function compact(state: SyncState, now: number): SyncState {
  const out = emptyState();
  for (const c of COLLECTIONS) {
    const target = out[c] as Record<string, SyncRecord<unknown>>;
    for (const [key, record] of Object.entries(state[c])) {
      if (record.deleted && now - record.updatedAt > TOMBSTONE_TTL_MS) continue;
      if (c === 'history' && !record.deleted && now - ((record.data as HistoryData | undefined)?.lastVisit ?? 0) > HISTORY_WINDOW_MS) continue;
      target[key] = record;
    }
  }
  return out;
}

// ---------- Local changes ----------

/**
 * The local state as sync records: unchanged items keep the date of the last sync, changed or new
 * ones get `now` (or their own, later, modification date), items gone since the last sync become
 * tombstones. A collection left out (a locked password vault) keeps the last synced records.
 *
 * On the very first sync of a collection, items carry their own date (`changedAt`) instead of
 * `now`: a computer joining with old copies must not overwrite newer changes made elsewhere.
 */
export function localState(
  previous: SyncState,
  current: { [C in Collection]?: Record<string, { data: NonNullable<SyncState[C][string]['data']>; changedAt?: number }> },
  now: number,
): SyncState {
  const out = emptyState();
  for (const c of COLLECTIONS) {
    const items = current[c];
    const prev = previous[c] as Record<string, SyncRecord<unknown>>;
    const target = out[c] as Record<string, SyncRecord<unknown>>;
    const first = Object.keys(prev).length === 0;
    if (!items) {
      // Not readable now: keep what was synced, don't invent deletions.
      Object.assign(target, prev);
      continue;
    }
    for (const [key, item] of Object.entries(items)) {
      const before = prev[key];
      const same = before && !before.deleted && JSON.stringify(before.data) === JSON.stringify(item.data);
      const stamp = first ? (item.changedAt ?? now) : Math.max(now, (before?.updatedAt ?? 0) + 1, item.changedAt ?? 0);
      target[key] = same ? before : { updatedAt: stamp, data: item.data };
    }
    for (const [key, before] of Object.entries(prev)) {
      if (key in items) continue;
      if (before.deleted) target[key] = before;
      // History that simply aged out locally is not a deletion.
      else if (c === 'history' && now - ((before.data as HistoryData | undefined)?.lastVisit ?? 0) > HISTORY_WINDOW_MS) continue;
      else target[key] = { updatedAt: Math.max(now, before.updatedAt + 1), deleted: true };
    }
  }
  return out;
}

/** What to change locally so it matches the merged state. */
export function plan<T>(local: Record<string, T>, merged: Record<string, SyncRecord<T>>): { upsert: Array<[string, T]>; remove: string[] } {
  const upsert: Array<[string, T]> = [];
  const remove: string[] = [];
  for (const [key, record] of Object.entries(merged)) {
    if (record.deleted) {
      if (key in local) remove.push(key);
    } else if (record.data !== undefined && JSON.stringify(local[key]) !== JSON.stringify(record.data)) {
      upsert.push([key, record.data]);
    }
  }
  return { upsert, remove };
}

/**
 * The snapshot to keep after applying `merged` locally: same dates, but with the data the local
 * stores really hold now (applying can shift bookmark positions or fold history visits). Without
 * this, the next sync would see those side effects as local edits and restamp them, which could
 * resurrect an item deleted meanwhile on another device. Records the stores couldn't take are left
 * out, so they are neither republished as edits nor turned into deletions.
 */
export function rebase(merged: SyncState, applied: { [C in Collection]?: Record<string, { data: unknown }> }): SyncState {
  const out = emptyState();
  for (const c of COLLECTIONS) {
    const items = applied[c];
    const source = merged[c] as Record<string, SyncRecord<unknown>>;
    const target = out[c] as Record<string, SyncRecord<unknown>>;
    for (const [key, record] of Object.entries(source)) {
      if (!items || record.deleted) target[key] = record;
      else if (items[key]) target[key] = { updatedAt: record.updatedAt, data: items[key].data };
    }
  }
  return out;
}
