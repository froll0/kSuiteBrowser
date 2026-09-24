import { INTERNAL } from '../../shared/ipc';
import type { AiEvent, AboutInfo, ReaderArticle, ApiResult, Bookmark, BookmarkFolder, BrowsingDataSelection, Drive, HistoryVisit, Profile, SavedLogin, Settings, TokenStatus, UpdateStatus, VaultStatus } from '../../shared/types';

interface InternalBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  onSettings(listener: (settings: Settings) => void): () => void;
  onBookmarks(listener: (list: Bookmark[]) => void): () => void;
  onUpdate(listener: (status: UpdateStatus) => void): () => void;
  onAi(listener: (event: AiEvent) => void): () => void;
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
  threatContinue: (url: string) => call<void>(INTERNAL.threatContinue, url),
  reader: {
    article: (url: string) => call<ReaderArticle | null>(INTERNAL.readerArticle, url),
    prefs: (patch: Partial<Settings>) => call<Settings>(INTERNAL.readerPrefs, patch),
    exit: () => call<void>(INTERNAL.readerExit),
    askAi: (action: 'summary' | 'keypoints') => call<void>(INTERNAL.readerAskAi, action),
  },
  threatStatus: () => call<{ entries: number; loadedAt: number | null }>(INTERNAL.threatStatus),
  testNotification: () => call<boolean>(INTERNAL.testNotification),
  defaultBrowser: {
    status: () => call<boolean>(INTERNAL.defaultBrowserStatus),
    set: () => call<boolean>(INTERNAL.defaultBrowserSet),
  },
  updates: {
    status: () => call<UpdateStatus>(INTERNAL.updateStatus),
    check: () => call<UpdateStatus>(INTERNAL.updateCheck),
    download: () => call<void>(INTERNAL.updateDownload),
    install: () => call<void>(INTERNAL.updateInstall),
    openRelease: () => call<void>(INTERNAL.updateOpenRelease),
    onChange: (fn: (s: UpdateStatus) => void) => bridge().onUpdate(fn),
  },
  ai: {
    products: () => call<ApiResult<Array<{ id: number; name: string }>>>(INTERNAL.aiProducts),
    models: () => call<ApiResult<Array<{ name: string; description: string | null }>>>(INTERNAL.aiModels),
    test: () => call<ApiResult<string>>(INTERNAL.aiTest),
    /** Answer for the search page: returns the stream id, deltas arrive via onEvent. */
    searchAnswer: (query: string) => call<string>(INTERNAL.searchAi, query),
    cancel: (id: string) => call<void>(INTERNAL.aiCancel, id),
    onEvent: (fn: (e: AiEvent) => void) => bridge().onAi(fn),
  },
  passwordStatus: () => call<VaultStatus>(INTERNAL.pwStatus),
  passwords: {
    status: () => call<VaultStatus>(INTERNAL.pwStatus),
    unlock: (primary: string) => call<ApiResult<void>>(INTERNAL.pwUnlock, primary),
    lock: () => call<void>(INTERNAL.pwLock),
    list: () => call<ApiResult<SavedLogin[]>>(INTERNAL.pwList),
    never: () => call<ApiResult<string[]>>(INTERNAL.pwNever),
    add: (entry: { url: string; username: string; password: string }) => call<ApiResult<SavedLogin>>(INTERNAL.pwAdd, entry),
    update: (id: string, patch: { username?: string; password?: string }) => call<ApiResult<void>>(INTERNAL.pwUpdate, id, patch),
    remove: (id: string) => call<ApiResult<void>>(INTERNAL.pwRemove, id),
    removeNever: (origin: string) => call<ApiResult<void>>(INTERNAL.pwRemoveNever, origin),
    setPrimary: (next: string, current?: string) => call<ApiResult<void>>(INTERNAL.pwSetPrimary, next, current),
    removePrimary: (current: string) => call<ApiResult<void>>(INTERNAL.pwRemovePrimary, current),
    importCsv: (csv: string) => call<ApiResult<number>>(INTERNAL.pwImport, csv),
    exportCsv: (primary?: string) => call<ApiResult<string>>(INTERNAL.pwExport, primary),
    generate: () => call<string>(INTERNAL.pwGenerate),
  },
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
