import { app } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { join } from 'node:path';
import { addCrash, type CrashEntry } from '../shared/crash-report';

interface CrashFile {
  entries: CrashEntry[];
  /** Entries up to this time were already offered for reporting. */
  offeredUntil: number;
}

/**
 * Local list of crashes (see shared/crash-report.ts). A marker file tells whether the last run ended
 * normally: if it is still there at start, Velo itself stopped abruptly (also native crashes).
 */
export class CrashLog {
  private readonly file = join(app.getPath('userData'), 'crashes.json');
  private readonly marker = join(app.getPath('userData'), 'running.lock');
  private data: CrashFile;

  constructor() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CrashFile>;
      this.data = { entries: Array.isArray(raw.entries) ? raw.entries : [], offeredUntil: Number(raw.offeredUntil) || 0 };
    } catch {
      this.data = { entries: [], offeredUntil: 0 };
    }
  }

  /** At start: notes an abrupt end of the previous run, then marks this one as running. */
  start(): void {
    if (existsSync(this.marker)) {
      let at = Date.now();
      try {
        at = Number(readFileSync(this.marker, 'utf8')) || at;
      } catch {
        /* unreadable marker */
      }
      this.record({ process: 'main', reason: 'unclean-exit', exitCode: null }, at);
    }
    try {
      writeFileSync(this.marker, String(Date.now()));
    } catch {
      /* read-only profile */
    }
    app.on('will-quit', () => rmSync(this.marker, { force: true }));
    app.on('child-process-gone', (_e, d) => {
      if (d.reason !== 'clean-exit') this.record({ process: d.type, reason: d.reason, exitCode: d.exitCode ?? null });
    });
    app.on('render-process-gone', (_e, _wc, d) => {
      if (d.reason !== 'clean-exit') this.record({ process: 'renderer', reason: d.reason, exitCode: d.exitCode ?? null });
    });
    // Only watches: Electron's own handling of uncaught errors is unchanged.
    process.on('uncaughtExceptionMonitor', (err) => {
      this.record({ process: 'main', reason: 'exception', exitCode: null, detail: `${err?.name ?? 'Error'}: ${err?.message ?? ''}` });
    });
  }

  record(entry: Pick<CrashEntry, 'process' | 'reason' | 'exitCode' | 'detail'>, at = Date.now()): void {
    this.data.entries = addCrash(this.data.entries, {
      at,
      ...entry,
      version: app.getVersion(),
      electron: process.versions.electron,
      os: `${process.platform} ${release()} ${process.arch}`,
    });
    this.save();
  }

  list(): CrashEntry[] {
    return [...this.data.entries];
  }

  clear(): void {
    this.data = { entries: [], offeredUntil: Date.now() };
    this.save();
  }

  /** Crashes not offered yet; marks them as offered. */
  takeNew(): CrashEntry[] {
    const fresh = this.data.entries.filter((e) => e.at > this.data.offeredUntil);
    if (fresh.length) {
      this.data.offeredUntil = Math.max(...fresh.map((e) => e.at));
      this.save();
    }
    return fresh;
  }

  private save(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.data), { mode: 0o600 });
    } catch {
      /* the next crash will try again */
    }
  }
}
