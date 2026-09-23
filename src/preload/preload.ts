import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type {
  ApiResult, CalendarEvent, Drive, DriveFile, DriveListing, DownloadItemState, MailOverview,
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
  },
  openApp: (appId: string) => invoke<void>(IPC.openApp, appId),
  setContentBounds: (rect: Rect) => invoke<void>(IPC.setContentBounds, rect),
  showAppMenu: () => invoke<void>(IPC.showAppMenu),
  settings: {
    get: () => invoke<Settings>(IPC.settingsGet),
    set: (patch: Partial<Settings>) => invoke<Settings>(IPC.settingsSet, patch),
  },
  token: {
    status: () => invoke<TokenStatus>(IPC.tokenStatus),
    set: (token: string) => invoke<ApiResult<Profile>>(IPC.tokenSet, token),
    clear: () => invoke<void>(IPC.tokenClear),
  },
  api: {
    profile: () => invoke<ApiResult<Profile>>(IPC.apiProfile),
    drives: () => invoke<ApiResult<Drive[]>>(IPC.apiDrives),
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
    onOpenSettings: (fn: () => void) => on(IPC.evOpenSettings, fn),
    onComposeMail: (fn: (mail: OutgoingMail) => void) => on(IPC.evComposeMail, fn),
    onToast: (fn: (toast: { kind: 'info' | 'success' | 'error'; message: string }) => void) => on(IPC.evToast, fn),
  },
};

export type KSuiteBridge = typeof api;

contextBridge.exposeInMainWorld('ksuite', api);
