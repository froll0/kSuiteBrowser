import { contextBridge, ipcRenderer } from 'electron';
import type { PageAction, TextAction } from '../shared/ai-prompts';
import { IPC } from '../shared/ipc';
import type {
  AiChatRequest, AiEvent, AiStatus, AuthPrompt, Bookmark, FindResult, PasswordPrompt, Suggestion, UpdateStatus,
  ApiResult, CalendarEvent, DriveFile, DriveListing, DownloadItemState, MailOverview,
  NewEvent, OutgoingMail, Profile, ProfileInfo, Rect, Settings, TabLayout, TabState, TokenStatus,
} from '../shared/types';

// Interface language, before the page's scripts run (see shared/i18n.ts).
contextBridge.exposeInMainWorld('veloLocale', ipcRenderer.sendSync('i18n:locale') as string);

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
    /** Groups and workspace of this window. */
    layout: () => invoke<TabLayout>(IPC.tabLayout),
    groupMenu: (groupId: string) => invoke<void>(IPC.groupMenu, groupId),
    groupUpdate: (groupId: string, patch: { name?: string; collapsed?: boolean }) => invoke<void>(IPC.groupUpdate, groupId, patch),
    workspaceMenu: (anchor?: Rect) => invoke<void>(IPC.workspaceMenu, anchor),
    switchWorkspace: (id: string) => invoke<void>(IPC.workspaceSwitch, id),
    containerMenu: (anchor?: Rect) => invoke<void>(IPC.containerMenu, anchor),
    create: (url?: string) => invoke<void>(IPC.tabsCreate, url),
    close: (id: number) => invoke<void>(IPC.tabsClose, id),
    activate: (id: number) => invoke<void>(IPC.tabsActivate, id),
    /** Switches to an open tab, also in another window. */
    switchTo: (id: number) => invoke<boolean>(IPC.tabsSwitch, id),
    /** Shows the hover card of a tab under `rect`, or hides it (null). */
    hover: (id: number | null, rect?: Rect) => invoke<void>(IPC.tabHover, id, rect),
    /** Enters or leaves reader mode in a tab. */
    reader: (id: number) => invoke<void>(IPC.readerToggle, id),
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
  /** Where the page goes, and the radius of its corners. */
  setContentBounds: (rect: Rect & { radius: number }) => invoke<void>(IPC.setContentBounds, rect),
  /** Auto-hiding toolbar: the system window buttons follow the browser bar. */
  setChromeVisible: (visible: boolean) => invoke<void>(IPC.chromeVisible, visible),
  /** Velo's own window buttons (Linux). */
  windowControl: (action: 'minimize' | 'maximize' | 'close') => invoke<void>(IPC.windowControl, action),
  toolbarMenu: (item: string | null) => invoke<void>(IPC.toolbarMenu, item),
  /** Turns protected content (Widevine) on and restarts the browser. */
  enableDrm: () => invoke<void>(IPC.drmEnable),
  showAppMenu: () => invoke<void>(IPC.showAppMenu),
  showShieldMenu: (tabId: number) => invoke<void>(IPC.showShieldMenu, tabId),
  showSiteMenu: (tabId: number) => invoke<void>(IPC.showSiteMenu, tabId),
  /** Opens the tab search under `anchor` (a button), or centred at the top. */
  tabSearch: (anchor?: Rect) => invoke<void>(IPC.tabSearch, anchor),
  mediaMenu: () => invoke<void>(IPC.mediaMenu),
  openSettingsPage: (section?: string) => invoke<void>(IPC.openSettingsPage, section),
  windowInfo: () => invoke<{ isPrivate: boolean; windowId: number; platform: string; profile: ProfileInfo | null }>(IPC.windowInfo),
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
    onTabLayout: (fn: (layout: TabLayout) => void) => on(IPC.evTabLayout, fn),
    /** "Rename" was chosen in a group's menu. */
    onGroupRename: (fn: (groupId: string) => void) => on(IPC.evGroupRename, fn),
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
    /** A site wants protected content while Widevine is off. */
    onDrmOffer: (fn: (offer: { host: string }) => void) => on(IPC.evDrmOffer, fn),
    /** The page took the keyboard focus. */
    onPageFocus: (fn: () => void) => on(IPC.evPageFocus, fn),
    /** Velo crashed since the last start. */
    onCrashOffer: (fn: (info: { count: number }) => void) => on(IPC.evCrashOffer, fn),
    /** F6: move the keyboard focus to the next part of the window. */
    onCycleFocus: (fn: () => void) => on(IPC.evCycleFocus, fn),
    /** The page was scrolled up (true) or down, for the auto-hiding bar. */
    onScrollReveal: (fn: (up: boolean) => void) => on(IPC.evScrollReveal, fn),
    onWindowState: (fn: (state: { maximized: boolean; fullscreen: boolean }) => void) => on(IPC.evWindowState, fn),
  },
};

export type VeloBridge = typeof api;

contextBridge.exposeInMainWorld('velo', api);
