import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
// Built into Electron's Node (24): no native module to ship.
import { DatabaseSync } from 'node:sqlite';

/**
 * Runs `fn` on a read-only copy of a browser database: the browser may be open and keep it locked,
 * and its write-ahead log (-wal) holds the latest changes, so both are copied first.
 */
export function withDatabaseCopy<T>(file: string, fn: (db: DatabaseSync) => T): T | null {
  if (!existsSync(file)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'velo-import-'));
  try {
    const copy = join(dir, basename(file));
    copyFileSync(file, copy);
    for (const suffix of ['-wal', '-shm']) if (existsSync(file + suffix)) copyFileSync(file + suffix, copy + suffix);
    const db = new DatabaseSync(copy);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
