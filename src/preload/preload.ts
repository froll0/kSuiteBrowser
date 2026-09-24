import { contextBridge, ipcRenderer } from 'electron';
import type { PageAction, TextAction } from '../shared/ai-prompts';
import { IPC } from '../shared/ipc';
import type {
  AiChatRequest, AiEvent, AiStatus, AuthPrompt, Bookmark, FindResult, PasswordPrompt, Suggestion, UpdateStatus,
  ApiResult, CalendarEvent, DriveFile, DriveListing, DownloadItemState, MailOverview,
  NewEvent, OutgoingMail, Profile, Rect, Settings, TabState, TokenStatus,
} from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function on<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_e: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

/** The only API the browser UI can use; web pages never get it. */
const api = {
  tabs: {
    list: () => invoke<TabState[]>(IPC.tabsList),
    create: (url?: string) => invoke<void>(IPC.tabsCreate, url),
    close: (id: number) => invoke<void>(IPC.tabsClose, id),
    activate: (id: number) => invoke<void>(IPC.tabsActivate, id),
    navigate: (id: number, input: string) => invoke<void>(IPC.tabsNavigate, id, input),
    back: (id: number) => invoke<void>(IPC.tabsBack, id),
    forward: (id: number) => invoke<void>(IPC.tabsForward, id),
    reload: (id: number) => invoke<void>(IPC.tabsReload, id),
    stop: (id: number) => invoke<void>(IPC.tabsStop, id),
    move: (id: number, index: number) => invoke<void>(IPC.tabsMove, id, index),
    menu: (id: number) => invoke<void>(IPC.tabsMenu, id),
    mute: (id: number) => invoke<void>(IPC.tabsMute, id),
    detach: (id: number, screenX: number, screenY: number) => invoke<void>(IPC.tabsDetach, id, screenX, screenY),
    adopt: (fromWindowId: number, tabId: number, index: number) => invoke<void>(IPC.tabsAdopt, fromWindowId, tabId, index),
  },
  openApp: (appId: string) => invoke<void>(IPC.openApp, appId),
  setContentBounds: (rect: Rect) => invoke<void>(IPC.setContentBounds, rect),
  showAppMenu: () => invoke<void>(IPC.showAppMenu),
  showShieldMenu: (tabId: number) => invoke<void>(IPC.showShieldMenu, tabId),
  showSiteMenu: (tabId: number) => invoke<void>(IPC.showSiteMenu, tabId),
  tabSearch: () => invoke<void>(IPC.tabSearch),
  openSettingsPage: (section?: string) => invoke<void>(IPC.openSettingsPage, section),
  windowInfo: () => invoke<{ isPrivate: boolean; windowId: number; platform: string }>(IPC.windowInfo),
  suggest: {
    query: (input: string) => invoke<Suggestion[]>(IPC.suggest, input),
    show: (items: Suggestion[], rect: Rect, selected: number) => invoke<void>(IPC.suggestShow, items, rect, selected),
    hide: () => invoke<void>(IPC.suggestHide),
  },
  find: {
    start: (tabId: number, text: string, options: { forward?: boolean; newSearch?: boolean; matchCase?: boolean }) =>
      invoke<void>(IPC.findStart, tabId, text, options),
    stop: (tabId: number) => invoke<void>(IPC.findStop, tabId),
  },
  zoomReset: (tabId: number) => invoke<void>(IPC.zoomReset, tabId),
  ai: {
    status: () => invoke<AiStatus>(IPC.aiStatus),
    chat: (request: AiChatRequest) => invoke<string>(IPC.aiChat, request),
    cancel: (id: string) => invoke<void>(IPC.aiCancel, id),
  },
  updates: {
    status: () => invoke<UpdateStatus>(IPC.updateStatus),
    install: () => invoke<void>(IPC.updateInstall),
  },
  auth: {
    answer: (id: string, credentials: { username: string; password: string } | null) => invoke<void>(IPC.authAnswer, id, credentials),
  },
  passwords: {
    answer: (id: string, action: 'save' | 'never' | 'dismiss', username?: string) => invoke<void>(IPC.passwordAnswer, id, action, username),
    unlock: (primary: string) => invoke<ApiResult<void>>(IPC.passwordUnlock, primary),
  },
  bookmarks: {
    list: () => invoke<Bookmark[]>(IPC.bookmarksList),
    toggle: (tabId: number) => invoke<void>(IPC.bookmarkToggle, tabId),
    open: (id: string, how: 'current' | 'background') => invoke<void>(IPC.bookmarkOpen, id, how),
    menu: (id: string) => invoke<void>(IPC.bookmarkMenu, id),
    all: () => invoke<void>(IPC.bookmarksMenu),
  },
  settings: {
    get: () => invoke<Settings>(IPC.settingsGet),
    set: (patch: Partial<Settings>) => invoke<Settings>(IPC.settingsSet, patch),
  },
  token: {
    status: () => invoke<TokenStatus>(IPC.tokenStatus),
  },
  api: {
    profile: () => invoke<ApiResult<Profile>>(IPC.apiProfile),
    driveList: (dirId: number, cursor?: string | null) =>
      invoke<ApiResult<DriveListing & { driveId: number }>>(IPC.apiDriveList, dirId, cursor),
    driveSearch: (query: string) => invoke<ApiResult<DriveFile[]>>(IPC.apiDriveSearch, query),
    driveDownload: (fileId: number, name: string) => invoke<ApiResult<string>>(IPC.apiDriveDownload, fileId, name),
    driveUpload: (dirId: number) => invoke<ApiResult<DriveFile[]>>(IPC.apiDriveUpload, dirId),
    driveOpenWeb: (file: DriveFile) => invoke<ApiResult<void>>(IPC.apiDriveOpenWeb, file),
    savePageToDrive: () => invoke<ApiResult<void>>(IPC.apiSavePageToDrive),
    mailOverview: () => invoke<ApiResult<MailOverview>>(IPC.apiMailOverview),
    mailSend: (mail: OutgoingMail) => invoke<ApiResult<void>>(IPC.apiMailSend, mail),
    calendarUpcoming: () => invoke<ApiResult<CalendarEvent[]>>(IPC.apiCalendarUpcoming),
    calendarCreate: (event: NewEvent) => invoke<ApiResult<void>>(IPC.apiCalendarCreate, event),
  },
  downloads: {
    list: () => invoke<DownloadItemState[]>(IPC.downloadsList),
    open: (id: string, reveal: boolean) => invoke<void>(IPC.downloadsOpen, id, reveal),
  },
  events: {
    onTabs: (fn: (tabs: TabState[]) => void) => on(IPC.evTabs, fn),
    onDownloads: (fn: (items: DownloadItemState[]) => void) => on(IPC.evDownloads, fn),
    onFocusAddress: (fn: () => void) => on(IPC.evFocusAddress, fn),
    onTogglePanel: (fn: () => void) => on(IPC.evTogglePanel, fn),
    onSettings: (fn: (settings: Settings) => void) => on(IPC.evSettings, fn),
    onBookmarks: (fn: (list: Bookmark[]) => void) => on(IPC.evBookmarks, fn),
    onFind: (fn: () => void) => on(IPC.evFind, fn),
    onFindNext: (fn: (opts: { backwards: boolean }) => void) => on(IPC.evFindNext, fn),
    onFindResult: (fn: (result: FindResult) => void) => on(IPC.evFindResult, fn),
    onPasswordPrompt: (fn: (prompt: PasswordPrompt) => void) => on(IPC.evPasswordPrompt, fn),
    onAuthPrompt: (fn: (prompt: AuthPrompt) => void) => on(IPC.evAuthPrompt, fn),
    onPasswordUnlock: (fn: (info: { reason: string }) => void) => on(IPC.evPasswordUnlock, fn),
    onUnread: (fn: (count: number | null) => void) => on(IPC.evUnread, fn),
    onUpdate: (fn: (status: UpdateStatus) => void) => on(IPC.evUpdate, fn),
    onAi: (fn: (event: AiEvent) => void) => on(IPC.evAi, fn),
    onAiAsk: (fn: (ask: { action?: TextAction; text?: string; page?: PageAction; question?: string }) => void) => on(IPC.evAiAsk, fn),
    onComposeMail: (fn: (mail: OutgoingMail) => void) => on(IPC.evComposeMail, fn),
    onToast: (fn: (toast: { kind: 'info' | 'success' | 'error'; message: string }) => void) => on(IPC.evToast, fn),
  },
};

export type KSuiteBridge = typeof api;

contextBridge.exposeInMainWorld('ksuite', api);
