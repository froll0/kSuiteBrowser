import { describe, expect, it } from 'vitest';
import { bookmarkKey, compact, emptyState, localState, mergeStates, plan, rebase, type BookmarkData, type SyncState } from '../src/shared/sync-model';

const DAY = 24 * 3600 * 1000;
const bm = (url: string, title = url, position = 0): BookmarkData => ({ title, url, folder: 'bar', position, createdAt: 1 });
const items = (list: BookmarkData[]) => Object.fromEntries(list.map((b) => [bookmarkKey(b.url), { data: b }]));

describe('sync model', () => {
  it('builds local records: new, unchanged, changed, deleted', () => {
    const first = localState(emptyState(), { bookmarks: items([bm('https://a.ch/'), bm('https://b.ch')]) }, 1000);
    expect(first.bookmarks['https://a.ch'].updatedAt).toBe(1000);
    const second = localState(first, { bookmarks: items([bm('https://a.ch/'), bm('https://c.ch')]) }, 2000);
    expect(second.bookmarks['https://a.ch'].updatedAt).toBe(1000); // unchanged
    expect(second.bookmarks['https://b.ch']).toEqual({ updatedAt: 2000, deleted: true });
    expect(second.bookmarks['https://c.ch'].updatedAt).toBe(2000);
    const third = localState(second, { bookmarks: items([bm('https://a.ch/', 'A nuovo'), bm('https://c.ch')]) }, 3000);
    expect(third.bookmarks['https://a.ch']).toMatchObject({ updatedAt: 3000, data: { title: 'A nuovo' } });
  });

  it('keeps the items own dates on a first sync, so old copies lose against newer changes', () => {
    const joining = localState(emptyState(), { logins: { k: { data: { origin: 'https://x.ch', username: 'u', password: 'vecchia', createdAt: 1 }, changedAt: 100 } } }, 5000);
    expect(joining.logins.k.updatedAt).toBe(100);
    const elsewhere: SyncState = { ...emptyState(), logins: { k: { updatedAt: 3000, data: { origin: 'https://x.ch', username: 'u', password: 'nuova', createdAt: 1 } } } };
    expect(mergeStates(joining, elsewhere).logins.k.data?.password).toBe('nuova');
  });

  it('never invents deletions for a collection that could not be read', () => {
    const prev: SyncState = { ...emptyState(), logins: { k: { updatedAt: 5, data: { origin: 'https://x.ch', username: 'u', password: 'p', createdAt: 1 } } } };
    expect(localState(prev, { bookmarks: {} }, 10).logins).toEqual(prev.logins);
  });

  it('merges devices: newest change wins, deletions travel, result is order independent', () => {
    const laptop: SyncState = { ...emptyState(), bookmarks: { a: { updatedAt: 10, data: bm('https://a.ch', 'vecchio') }, b: { updatedAt: 10, data: bm('https://b.ch') } } };
    const phone: SyncState = { ...emptyState(), bookmarks: { a: { updatedAt: 20, data: bm('https://a.ch', 'nuovo') }, b: { updatedAt: 15, deleted: true } } };
    const merged = mergeStates(laptop, phone);
    expect(merged.bookmarks.a.data?.title).toBe('nuovo');
    expect(merged.bookmarks.b.deleted).toBe(true);
    expect(mergeStates(phone, laptop)).toEqual(merged);
    // Same timestamp: deletion wins on both sides.
    expect(mergeStates({ bookmarks: { x: { updatedAt: 5, data: bm('https://x.ch') } } }, { bookmarks: { x: { updatedAt: 5, deleted: true } } }).bookmarks.x.deleted).toBe(true);
  });

  it('plans local changes', () => {
    const local = { a: bm('https://a.ch', 'uno'), b: bm('https://b.ch') };
    const merged = { a: { updatedAt: 3, data: bm('https://a.ch', 'due') }, b: { updatedAt: 3, deleted: true }, c: { updatedAt: 3, data: bm('https://c.ch') } };
    const p = plan(local, merged);
    expect(p.upsert.map(([k]) => k).sort()).toEqual(['a', 'c']);
    expect(p.remove).toEqual(['b']);
  });

  it('forgets old tombstones and history beyond the window', () => {
    const now = 200 * DAY;
    const state: SyncState = {
      bookmarks: { old: { updatedAt: now - 100 * DAY, deleted: true }, recent: { updatedAt: now - DAY, deleted: true } },
      logins: {},
      history: { 'https://old.ch': { updatedAt: 1, data: { url: 'https://old.ch', title: '', lastVisit: now - 120 * DAY } } },
    };
    const c = compact(state, now);
    expect(Object.keys(c.bookmarks)).toEqual(['recent']);
    expect(c.history).toEqual({});
  });

  it('does not turn history that aged out into deletions', () => {
    const now = 200 * DAY;
    const prev: SyncState = { ...emptyState(), history: { h: { updatedAt: 1, data: { url: 'h', title: '', lastVisit: now - 95 * DAY } } } };
    expect(localState(prev, { history: {} }, now).history).toEqual({});
  });

  it('does not restamp side effects of applying a merge, so a deletion elsewhere is not undone', () => {
    // Device A: two bookmarks; a merge brings in a third that shifts "ricette" one position down.
    const mine = localState(emptyState(), { bookmarks: items([bm('https://lugano.ch', 'L', 0), bm('https://ricette.ch', 'R', 1)]) }, 1000);
    const other = localState(emptyState(), { bookmarks: items([bm('https://meteo.ch', 'M', 1)]) }, 1000);
    const merged = mergeStates(mine, other);
    const applied = items([bm('https://lugano.ch', 'L', 0), bm('https://meteo.ch', 'M', 1), bm('https://ricette.ch', 'R', 2)]);
    const snapshot = rebase(merged, { bookmarks: applied });
    expect(snapshot.bookmarks['https://ricette.ch']).toMatchObject({ updatedAt: 1000, data: { position: 2 } });
    // Meanwhile B deletes "ricette"; A syncs again with nothing changed by the user.
    const deletion = { bookmarks: { 'https://ricette.ch': { updatedAt: 5000, deleted: true } } };
    const next = mergeStates(localState(snapshot, { bookmarks: applied }, 6000), deletion);
    expect(next.bookmarks['https://ricette.ch'].deleted).toBe(true);
  });
});

