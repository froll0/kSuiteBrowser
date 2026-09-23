import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Settings, TokenStatus } from '../shared/types';
import { SEARCH_ENGINES } from '../shared/url';

const DEFAULTS: Settings = {
  searchEngine: 'duckduckgo',
  homePage: 'https://ksuite.infomaniak.com/',
  driveId: null,
  driveUploadFolderId: 1,
  driveUploadFolderName: 'kDrive',
  uploadDownloadsToDrive: false,
  panelOpen: true,
};

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

  constructor() {
    try {
      this.stored = JSON.parse(readFileSync(this.file, 'utf8')) as StoredFile;
    } catch {
      this.stored = {};
    }
  }

  get(): Settings {
    return sanitize({ ...DEFAULTS, ...this.stored.settings });
  }

  update(patch: Partial<Settings>): Settings {
    this.stored.settings = sanitize({ ...this.get(), ...patch });
    this.save();
    return this.get();
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

function sanitize(s: Settings): Settings {
  return {
    searchEngine: s.searchEngine in SEARCH_ENGINES ? s.searchEngine : DEFAULTS.searchEngine,
    homePage: typeof s.homePage === 'string' && s.homePage ? s.homePage : DEFAULTS.homePage,
    driveId: Number.isInteger(s.driveId) && (s.driveId as number) > 0 ? s.driveId : null,
    driveUploadFolderId: Number.isInteger(s.driveUploadFolderId) && s.driveUploadFolderId > 0 ? s.driveUploadFolderId : 1,
    driveUploadFolderName: typeof s.driveUploadFolderName === 'string' ? s.driveUploadFolderName : DEFAULTS.driveUploadFolderName,
    uploadDownloadsToDrive: Boolean(s.uploadDownloadsToDrive),
    panelOpen: s.panelOpen !== false,
  };
}
