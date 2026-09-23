import { INTERNAL } from '../../shared/ipc';
import type { AboutInfo, ApiResult, BrowsingDataSelection, Drive, Profile, Settings, TokenStatus } from '../../shared/types';

interface InternalBridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  onSettings(listener: (settings: Settings) => void): () => void;
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
};
