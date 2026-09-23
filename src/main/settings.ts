import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sanitizeSettings } from '../shared/settings-schema';
import type { Settings, TokenStatus } from '../shared/types';

interface StoredFile {
  settings?: Partial<Settings>;
  /** API token encrypted with the OS keychain (base64). */
  tokenCipher?: string;
  /** Fallback when no keychain is available (e.g. Linux without secret service). */
  tokenPlain?: string;
}

/** Persists user settings and the Infomaniak API token in the user data directory. */
export class SettingsStore {
  private readonly file = join(app.getPath('userData'), 'settings.json');
  private stored: StoredFile;
  /** Read on every network request by the privacy filters, so keep it ready. */
  private current: Settings;
  private readonly listeners = new Set<(settings: Settings, previous: Settings) => void>();

  constructor() {
    try {
      this.stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredFile;
    } catch {
      this.stored = {};
    }
    this.current = sanitizeSettings(this.stored.settings);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: Partial<Settings>): Settings {
    const previous = this.current;
    this.current = sanitizeSettings({ ...previous, ...patch });
    this.stored.settings = this.current;
    this.save();
    for (const listener of this.listeners) listener(this.current, previous);
    return this.current;
  }

  onChange(listener: (settings: Settings, previous: Settings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getToken(): string | null {
    const env = process.env.KSUITE_API_TOKEN?.trim();
    if (env) return env;
    if (this.stored.tokenCipher && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(this.stored.tokenCipher, 'base64'));
      } catch {
        return null;
      }
    }
    return this.stored.tokenPlain ?? null;
  }

  setToken(token: string): void {
    const clean = token.trim();
    delete this.stored.tokenCipher;
    delete this.stored.tokenPlain;
    if (safeStorage.isEncryptionAvailable()) {
      this.stored.tokenCipher = safeStorage.encryptString(clean).toString('base64');
    } else {
      this.stored.tokenPlain = clean;
    }
    this.save();
  }

  clearToken(): void {
    delete this.stored.tokenCipher;
    delete this.stored.tokenPlain;
    this.save();
  }

  tokenStatus(): TokenStatus {
    return {
      configured: this.getToken() !== null,
      encrypted: !this.stored.tokenPlain,
      fromEnv: Boolean(process.env.KSUITE_API_TOKEN?.trim()),
    };
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.stored, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}
