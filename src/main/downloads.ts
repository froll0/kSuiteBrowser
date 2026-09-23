import { app, shell, type Session } from 'electron';
import { basename } from 'node:path';
import type { DownloadItemState } from '../shared/types';
import { uniquePath } from './files';
import type { KSuiteServices } from './services';
import type { SettingsStore } from './settings';

/** Saves browser downloads into the Downloads folder and optionally mirrors them to kDrive. */
export class DownloadManager {
  private items: DownloadItemState[] = [];
  private seq = 0;

  constructor(
    private readonly settings: SettingsStore,
    private readonly services: KSuiteServices,
    private readonly onChange: (items: DownloadItemState[]) => void,
  ) {}

  attach(session: Session): void {
    session.on('will-download', (_event, item) => {
      const path = uniquePath(app.getPath('downloads'), item.getFilename());
      item.setSavePath(path);
      const state: DownloadItemState = {
        id: String(++this.seq),
        filename: basename(path),
        path,
        state: 'progressing',
        received: 0,
        total: item.getTotalBytes(),
        drive: 'idle',
      };
      this.items.unshift(state);
      this.items = this.items.slice(0, 50);
      this.emit();

      item.on('updated', (_e, s) => {
        state.state = s;
        state.received = item.getReceivedBytes();
        state.total = item.getTotalBytes();
        this.emit();
      });
      item.once('done', (_e, s) => {
        state.state = s;
        state.received = item.getReceivedBytes();
        this.emit();
        if (s === 'completed' && this.settings.get().uploadDownloadsToDrive && this.settings.tokenStatus().configured) {
          void this.uploadToDrive(state);
        }
      });
    });
  }

  list(): DownloadItemState[] {
    return this.items;
  }

  open(id: string, reveal: boolean): void {
    const item = this.items.find((i) => i.id === id);
    if (!item) return;
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
