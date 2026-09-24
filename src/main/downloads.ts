import { app, dialog, shell, type BrowserWindow, type Session } from 'electron';
import { dangerousFileKind } from '../shared/dangerous-files';
import type { ThreatKind } from '../shared/threat-match';
import { basename, join } from 'node:path';
import type { DownloadItemState } from '../shared/types';
import { uniquePath } from './files';
import type { KSuiteServices } from './services';
import type { SettingsStore } from './settings';

/** Saves browser downloads (folder and "ask where" from the settings) and optionally mirrors them to kDrive. */
export class DownloadManager {
  private items: DownloadItemState[] = [];
  private seq = 0;

  constructor(
    private readonly settings: SettingsStore,
    private readonly services: KSuiteServices,
    private readonly onChange: (items: DownloadItemState[]) => void,
    private readonly safety: { threatCheck(url: string): ThreatKind | null; window(): BrowserWindow | null } = { threatCheck: () => null, window: () => null },
  ) {}

  folder(): string {
    return this.settings.get().downloadDir ?? app.getPath('downloads');
  }

  attach(session: Session, options: { isPrivate: boolean }): void {
    session.on('will-download', (_event, item) => {
      const s = this.settings.get();
      const state: DownloadItemState = {
        id: String(++this.seq),
        filename: item.getFilename(),
        path: '',
        state: 'progressing',
        received: 0,
        total: item.getTotalBytes(),
        drive: 'idle',
      };
      if (s.askDownloadLocation) {
        // Without a save path Electron shows the native "Save as" dialog.
        item.setSaveDialogOptions({ defaultPath: join(this.folder(), item.getFilename()) });
      } else {
        item.setSavePath(uniquePath(this.folder(), item.getFilename()));
      }
      this.items.unshift(state);
      this.items = this.items.slice(0, 50);
      this.emit();

      // Known malware (the download address or any redirect before it) never lands on disk.
      if (s.threatProtection && [...item.getURLChain(), item.getURL()].some((u) => this.safety.threatCheck(u))) {
        item.cancel();
        state.state = 'cancelled';
        state.blocked = 'Bloccato: il file è segnalato come malware';
        this.emit();
        return;
      }
      // Programs and scripts: confirm first, while the download waits.
      const danger = dangerousFileKind(item.getFilename());
      if (danger) {
        item.pause();
        void this.confirmDangerous(item.getFilename(), danger, item.getURL()).then((keep) => {
          if (item.getState() !== 'progressing') return;
          if (keep) item.resume();
          else {
            item.cancel();
            state.blocked = 'Annullato: file potenzialmente pericoloso';
            this.emit();
          }
        });
      }

      const sync = () => {
        state.path = item.getSavePath() || state.path;
        if (state.path) state.filename = basename(state.path);
        state.received = item.getReceivedBytes();
        state.total = item.getTotalBytes();
      };
      item.on('updated', (_e, s2) => {
        state.state = s2;
        sync();
        this.emit();
      });
      item.once('done', (_e, s2) => {
        state.state = s2;
        sync();
        this.emit();
        const current = this.settings.get();
        // Downloads made in private windows never leave the computer automatically.
        if (s2 === 'completed' && !options.isPrivate && current.uploadDownloadsToDrive && this.settings.tokenStatus().configured) {
          void this.uploadToDrive(state);
        }
      });
    });
  }

  private async confirmDangerous(filename: string, kind: string, url: string): Promise<boolean> {
    let source = url;
    let insecure = false;
    try {
      const u = new URL(url);
      source = u.host || u.protocol;
      insecure = u.protocol === 'http:';
    } catch {
      /* keep the raw address */
    }
    const options = {
      type: 'warning' as const,
      buttons: ['Annulla', 'Scarica comunque'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: `«${filename}» è ${kind} e potrebbe danneggiare il computer.`,
      detail: `${insecure ? 'Arriva da una connessione non cifrata, quindi potrebbe essere stato modificato lungo la strada. ' : ''}Scaricalo solo se ti fidi di ${source} e sai cosa contiene.`,
    };
    const win = this.safety.window();
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return response === 1;
  }

  list(): DownloadItemState[] {
    return this.items;
  }

  /** Forgets the list (files stay on disk); in-progress downloads are kept. */
  clear(): void {
    this.items = this.items.filter((i) => i.state === 'progressing');
    this.emit();
  }

  open(id: string, reveal: boolean): void {
    const item = this.items.find((i) => i.id === id);
    if (!item?.path) return;
    if (reveal) shell.showItemInFolder(item.path);
    else void shell.openPath(item.path);
  }

  private async uploadToDrive(state: DownloadItemState): Promise<void> {
    state.drive = 'uploading';
    this.emit();
    try {
      await this.services.uploadLocalFile(state.path);
      state.drive = 'uploaded';
    } catch (err) {
      state.drive = 'error';
      state.driveError = err instanceof Error ? err.message : String(err);
    }
    this.emit();
  }

  private emit(): void {
    this.onChange(this.items);
  }
}
