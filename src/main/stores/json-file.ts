import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A JSON document on disk, loaded once, saved shortly after each change and flushed on exit. */
export class JsonFile<T> {
  data: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly path: string,
    parse: (raw: unknown) => T,
    private readonly delayMs = 800,
  ) {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      raw = undefined;
    }
    this.data = parse(raw);
  }

  changed(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      // Write then rename, so a crash never leaves a half-written file.
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this.path);
    } catch (err) {
      console.error(`[store] salvataggio di ${this.path} non riuscito:`, err);
    }
  }
}
