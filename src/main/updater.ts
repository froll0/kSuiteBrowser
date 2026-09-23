import { app, shell } from 'electron';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { REPOSITORY, releaseUrl, updateMode } from '../shared/release';
import type { UpdateStatus } from '../shared/types';
import type { SettingsStore } from './settings';

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 3600_000;

/**
 * Updates from the GitHub releases of the project (electron-updater). Windows and AppImage builds
 * download in the background and install on restart; the other builds only announce new versions.
 */
export class UpdateService {
  private status: UpdateStatus;
  private updater: AppUpdater | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly onChange: (status: UpdateStatus) => void,
  ) {
    const mode = updateMode({ packaged: app.isPackaged, platform: process.platform, appImage: Boolean(process.env.APPIMAGE) });
    this.status = { mode, state: 'idle', current: app.getVersion() };
  }

  get(): UpdateStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.status.mode === 'disabled') return;
    try {
      // Loaded lazily: development builds never touch the updater.
      const { autoUpdater } = await import('electron-updater');
      this.updater = autoUpdater;
    } catch (err) {
      this.set({ state: 'error', message: `Aggiornamenti non disponibili: ${String(err)}` });
      return;
    }
    const u = this.updater;
    // KSUITE_UPDATE_URL: a folder with latest*.yml and installers (a mirror, or a local server for testing).
    const mirror = process.env.KSUITE_UPDATE_URL;
    if (mirror) u.setFeedURL({ provider: 'generic', url: mirror });
    else u.setFeedURL({ provider: 'github', owner: REPOSITORY.owner, repo: REPOSITORY.repo, releaseType: 'release' });
    u.autoDownload = this.status.mode === 'auto' && this.settings.get().autoUpdate;
    u.autoInstallOnAppQuit = this.status.mode === 'auto';
    u.allowPrerelease = false;
    u.logger = null;

    u.on('checking-for-update', () => this.set({ state: 'checking', message: undefined }));
    u.on('update-available', (info: UpdateInfo) => this.set({ state: 'available', version: info.version, releaseUrl: releaseUrl(info.version) }));
    u.on('update-not-available', () => this.set({ state: 'not-available', version: undefined, checkedAt: Date.now() }));
    u.on('download-progress', (p: ProgressInfo) => this.set({ state: 'downloading', percent: Math.round(p.percent) }));
    u.on('update-downloaded', (info: UpdateInfo) => this.set({ state: 'downloaded', version: info.version, percent: 100, releaseUrl: releaseUrl(info.version) }));
    u.on('error', (err: Error) => this.set({ state: 'error', message: friendlyError(err) }));

    this.settings.onChange((next, prev) => {
      if (next.autoUpdate !== prev.autoUpdate && this.updater) this.updater.autoDownload = this.status.mode === 'auto' && next.autoUpdate;
    });
    setTimeout(() => void this.check(), FIRST_CHECK_MS).unref();
    setInterval(() => void this.check(), CHECK_EVERY_MS).unref();
  }

  async check(): Promise<UpdateStatus> {
    if (!this.updater || this.status.state === 'downloading' || this.status.state === 'downloaded') return this.status;
    try {
      await this.updater.checkForUpdates();
      this.set({ checkedAt: Date.now() });
    } catch (err) {
      this.set({ state: 'error', message: friendlyError(err as Error) });
    }
    return this.status;
  }

  /** Manual download when automatic updates are off; "notify" builds open the release page instead. */
  async download(): Promise<void> {
    if (this.status.mode !== 'auto') return this.openRelease();
    if (!this.updater || this.status.state !== 'available') return;
    try {
      await this.updater.downloadUpdate();
    } catch (err) {
      this.set({ state: 'error', message: friendlyError(err as Error) });
    }
  }

  install(): void {
    if (this.updater && this.status.state === 'downloaded') this.updater.quitAndInstall(false, true);
  }

  openRelease(): void {
    void shell.openExternal(this.status.releaseUrl ?? releaseUrl(this.status.version ?? this.status.current));
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch };
    this.onChange(this.status);
  }
}

function friendlyError(err: Error): string {
  const text = err?.message ?? String(err);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/.test(text)) return 'Impossibile contattare il server degli aggiornamenti. Controlla la connessione.';
  if (/404|No published versions|Cannot find latest/i.test(text)) return 'Nessuna versione pubblicata trovata.';
  return text.split('\n')[0].slice(0, 200);
}
