import { app, shell, type Session } from 'electron';
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
