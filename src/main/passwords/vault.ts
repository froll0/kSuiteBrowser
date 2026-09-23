import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parsePasswordCsv, toCsv } from '../../shared/csv';
import type { SavedLogin, VaultStatus } from '../../shared/types';
import { deriveKey, newKdfParams, newKey, open, seal, type KdfParams, type Sealed } from './crypto';

/** The OS keychain (Electron safeStorage), injected so the vault can be tested without Electron. */
export interface Keychain {
  available(): boolean;
  encrypt(data: Buffer): Buffer;
  decrypt(data: Buffer): Buffer;
}

interface VaultFile {
  version: 1;
  /** Vault key encrypted by the OS keychain; absent when a primary password is set. */
  keychain?: string;
  /** Vault key encrypted with a key derived from the primary password. */
  primary?: KdfParams & Sealed;
  payload: Sealed;
}

interface Payload {
  logins: SavedLogin[];
  /** Origins where the user chose "never save". */
  never: string[];
}

export class VaultLockedError extends Error {
  constructor() {
    super('Le password salvate sono bloccate: inserisci la password principale.');
  }
}

export class WrongPasswordError extends Error {
  constructor() {
    super('Password principale errata.');
  }
}

/** Canonical origin of a URL, or null for anything that is not http(s). */
export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Encrypted store of saved logins. The payload is encrypted with a random key; that key is protected
 * by the OS keychain, or by the primary password when the user sets one.
 */
export class Vault {
  private key: Buffer | null = null;
  private payload: Payload | null = null;
  private file: VaultFile | null;

  constructor(
    private readonly path: string,
    private readonly keychain: Keychain,
  ) {
    try {
      this.file = JSON.parse(readFileSync(path, 'utf8')) as VaultFile;
    } catch {
      this.file = null;
    }
  }

  status(): VaultStatus {
    const keychainAvailable = this.keychain.available();
    const hasPrimary = Boolean(this.file?.primary);
    let state: VaultStatus['state'];
    if (this.payload) state = 'unlocked';
    else if (!this.file) state = keychainAvailable ? 'unlocked' : 'needs-setup';
    else state = hasPrimary || !keychainAvailable ? 'locked' : 'unlocked';
    return { state, hasPrimary, keychainAvailable, count: this.payload ? this.payload.logins.length : null };
  }

  /** Opens the vault with the OS keychain; returns false when the primary password is needed. */
  tryAutoUnlock(): boolean {
    if (this.payload) return true;
    if (!this.file) {
      if (!this.keychain.available()) return false;
      this.key = newKey();
      this.payload = { logins: [], never: [] };
      return true; // written on first save
    }
    if (this.file.primary || !this.file.keychain || !this.keychain.available()) return false;
    const key = this.keychain.decrypt(Buffer.from(this.file.keychain, 'base64'));
    this.payload = JSON.parse(open(key, this.file.payload).toString('utf8')) as Payload;
    this.key = key;
    return true;
  }

  async unlock(primary: string): Promise<void> {
    if (this.payload) return;
    if (!this.file?.primary) {
      if (this.tryAutoUnlock()) return;
      throw new WrongPasswordError();
    }
    const wrapKey = await deriveKey(primary, this.file.primary);
    let key: Buffer;
    try {
      key = open(wrapKey, this.file.primary, 'ksuite-vault-key');
    } catch {
      throw new WrongPasswordError();
    }
    this.payload = JSON.parse(open(key, this.file.payload).toString('utf8')) as Payload;
    this.key = key;
  }

  lock(): void {
    // Only meaningful with a primary password; with the keychain the next use unlocks again.
    this.key?.fill(0);
    this.key = null;
    this.payload = null;
  }

  private data(): Payload {
    if (!this.payload && !this.tryAutoUnlock()) throw new VaultLockedError();
    return this.payload!;
  }

  list(): SavedLogin[] {
    return [...this.data().logins].sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  }

  forOrigin(origin: string): SavedLogin[] {
    return this.data()
      .logins.filter((l) => l.origin === origin)
      .sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt));
  }

  get(id: string): SavedLogin | undefined {
    return this.data().logins.find((l) => l.id === id);
  }

  /** Adds a login, or updates the password of the same origin + username. */
  save(origin: string, username: string, password: string, now = Date.now()): SavedLogin {
    const data = this.data();
    const existing = data.logins.find((l) => l.origin === origin && l.username === username);
    if (existing) {
      if (existing.password !== password) {
        existing.password = password;
        existing.updatedAt = now;
      }
      this.persist();
      return existing;
    }
    const login: SavedLogin = { id: randomUUID(), origin, username, password, createdAt: now, updatedAt: now, lastUsedAt: null, timesUsed: 0 };
    data.logins.push(login);
    data.never = data.never.filter((o) => o !== origin);
    this.persist();
    return login;
  }

  update(id: string, patch: { username?: string; password?: string; origin?: string }): void {
    const login = this.data().logins.find((l) => l.id === id);
    if (!login) return;
    if (typeof patch.username === 'string') login.username = patch.username;
    if (typeof patch.password === 'string' && patch.password) login.password = patch.password;
    if (typeof patch.origin === 'string') login.origin = originOf(patch.origin) ?? login.origin;
    login.updatedAt = Date.now();
    this.persist();
  }

  markUsed(id: string): void {
    const login = this.data().logins.find((l) => l.id === id);
    if (!login) return;
    login.lastUsedAt = Date.now();
    login.timesUsed++;
    this.persist();
  }

  remove(id: string): void {
    const data = this.data();
    data.logins = data.logins.filter((l) => l.id !== id);
    this.persist();
  }

  isNever(origin: string): boolean {
    return this.data().never.includes(origin);
  }

  never(): string[] {
    return [...this.data().never].sort();
  }

  setNever(origin: string, never: boolean): void {
    const data = this.data();
    data.never = never ? [...new Set([...data.never, origin])] : data.never.filter((o) => o !== origin);
    this.persist();
  }

  /** Imports a CSV export from another browser or password manager; returns how many logins were added or updated. */
  importCsv(text: string): number {
    let count = 0;
    for (const row of parsePasswordCsv(text)) {
      const origin = originOf(row.url) ?? originOf(`https://${row.url}`);
      if (!origin) continue;
      this.save(origin, row.username, row.password);
      count++;
    }
    return count;
  }

  /** CSV in the format Chrome and Firefox import (name,url,username,password). */
  exportCsv(): string {
    return toCsv([['name', 'url', 'username', 'password'], ...this.list().map((l) => [new URL(l.origin).host, l.origin, l.username, l.password])]);
  }

  async checkPrimary(password: string): Promise<boolean> {
    if (!this.file?.primary) return true;
    try {
      open(await deriveKey(password, this.file.primary), this.file.primary, 'ksuite-vault-key');
      return true;
    } catch {
      return false;
    }
  }

  /** Sets or changes the primary password (the current one is required to change it). */
  async setPrimary(next: string, current = ''): Promise<void> {
    if (next.length < 8) throw new Error('La password principale deve avere almeno 8 caratteri.');
    if (this.file?.primary) {
      if (!(await this.checkPrimary(current))) throw new WrongPasswordError();
      await this.unlock(current);
    } else if (!this.payload) {
      if (this.file && !this.tryAutoUnlock()) throw new VaultLockedError();
      if (!this.file) {
        this.key = newKey();
        this.payload = { logins: [], never: [] };
      }
    }
    const params = newKdfParams();
    const wrapKey = await deriveKey(next, params);
    this.writeFile({ primary: { ...params, ...seal(wrapKey, this.key!, 'ksuite-vault-key') } });
  }

  /** Removes the primary password; the key goes back to the OS keychain. */
  async removePrimary(current: string): Promise<void> {
    if (!this.file?.primary) return;
    if (!this.keychain.available()) throw new Error('Senza portachiavi di sistema la password principale è obbligatoria.');
    if (!(await this.checkPrimary(current))) throw new WrongPasswordError();
    await this.unlock(current);
    this.writeFile({ keychain: this.keychain.encrypt(this.key!).toString('base64') });
  }

  private persist(): void {
    if (!this.key || !this.payload) throw new VaultLockedError();
    if (this.file?.primary) this.writeFile({ primary: this.file.primary });
    else if (this.keychain.available()) this.writeFile({ keychain: this.keychain.encrypt(this.key).toString('base64') });
    else throw new Error('Imposta una password principale per salvare le password.');
  }

  private writeFile(protection: Pick<VaultFile, 'keychain' | 'primary'>): void {
    const file: VaultFile = { version: 1, ...protection, payload: seal(this.key!, Buffer.from(JSON.stringify(this.payload))) };
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 });
    renameSync(tmp, this.path);
    this.file = file;
  }
}
