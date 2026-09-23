import { INTERNAL } from '../../shared/ipc';
import type { AboutInfo, ApiResult, Bookmark, BookmarkFolder, BrowsingDataSelection, Drive, HistoryVisit, Profile, Settings, TokenStatus } from '../../shared/types';

interface InternalBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  onSettings(listener: (settings: Settings) => void): () => void;
  onBookmarks(listener: (list: Bookmark[]) => void): () => void;
}

declare global {
  interface Window {
    ksuiteInternal?: InternalBridge;
  }
}

function bridge(): InternalBridge {
  if (!window.ksuiteInternal) throw new Error('Questa pagina funziona solo dentro kSuite Browser.');
  return window.ksuiteInternal;
}

const call = <T>(channel: string, ...args: unknown[]) => bridge().invoke(channel, ...args) as Promise<T>;

/** Typed access to the main process for internal pages. */
export const internal = {
  settings: () => call<Settings>(INTERNAL.settingsGet),
  update: (patch: Partial<Settings>) => call<Settings>(INTERNAL.settingsSet, patch),
  onSettings: (fn: (s: Settings) => void) => bridge().onSettings(fn),
  tokenStatus: () => call<TokenStatus>(INTERNAL.tokenStatus),
  setToken: (token: string) => call<ApiResult<Profile>>(INTERNAL.tokenSet, token),
  clearToken: () => call<void>(INTERNAL.tokenClear),
  drives: () => call<ApiResult<Drive[]>>(INTERNAL.drives),
  clearData: (selection: BrowsingDataSelection) => call<ApiResult<void>>(INTERNAL.clearData, selection),
  chooseDownloadDir: () => call<string | null>(INTERNAL.chooseDownloadDir),
  downloadDir: () => call<string>(INTERNAL.downloadDirInfo),
  about: () => call<AboutInfo>(INTERNAL.about),
  httpsContinue: (url: string) => call<void>(INTERNAL.httpsContinue, url),
  history: {
    search: (query: string, before?: number) => call<HistoryVisit[]>(INTERNAL.historySearch, query, before),
    remove: (ids: string[]) => call<void>(INTERNAL.historyRemove, ids),
    clearSince: (since: number) => call<void>(INTERNAL.historyClear, since),
  },
  bookmarks: {
    list: () => call<Bookmark[]>(INTERNAL.bookmarksList),
    add: (b: { title: string; url: string; folder: BookmarkFolder }) => call<Bookmark>(INTERNAL.bookmarksAdd, b),
    update: (id: string, patch: { title?: string; url?: string; folder?: BookmarkFolder }) => call<void>(INTERNAL.bookmarksUpdate, id, patch),
    remove: (id: string) => call<void>(INTERNAL.bookmarksRemove, id),
    shift: (id: string, direction: -1 | 1) => call<void>(INTERNAL.bookmarksShift, id, direction),
    import: (items: Array<{ title: string; url: string; folder: BookmarkFolder }>) => call<number>(INTERNAL.bookmarksImport, items),
    onChange: (fn: (list: Bookmark[]) => void) => bridge().onBookmarks(fn),
  },
};
