import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { safeStorage } from 'electron';
import { downloadFile, ensureDirectory, listAll, trashFile, uploadFile } from '../../api/drive';
import {
  COLLECTIONS, bookmarkKey, compact, emptyState, localState, loginKey, mergeStates, plan, rebase,
  type BookmarkData, type Collection, type HistoryData, type LoginData, type SyncState,
} from '../../shared/sync-model';
import type { Bookmark, RemoteTabs, SyncCollectionOption, SyncStatus } from '../../shared/types';
import { keychainAvailable } from '../keychain';
import { deriveKey, newKdfParams, open, seal, type KdfParams, type Sealed } from '../passwords/crypto';
import type { Vault } from '../passwords/vault';
import type { KSuiteServices } from '../services';
import type { BookmarksStore } from '../stores/bookmarks';
import type { HistoryStore } from '../stores/history';

const FOLDER = 'kSuite Browser Sync';
const META = 'sync-key.json';
const DEVICE_PREFIX = 'device-';
const DEVICE_SUFFIX = '.ksync';
const AAD = 'ksuite-sync-v1';
const CHECK = 'ksuite-sync-check';
const INTERVAL_MS = 10 * 60_000;
const DEBOUNCE_MS = 15_000;
export const MIN_PASSPHRASE = 10;

interface RemoteMeta {
  format: 1;
  kdf: KdfParams;
  check: Sealed;
}

interface DeviceFile {
  format: 1;
  deviceId: string;
  name: string;
  updatedAt: number;
  tabs?: Array<{ title: string; url: string }>;
  state: Partial<SyncState>;
}

/** What stays on this computer: the key only encrypted by the system keychain, the snapshot by the key. */
interface LocalFile {
  enabled: boolean;
  deviceId: string;
  deviceName: string;
  collections: Record<SyncCollectionOption, boolean>;
  keyCipher: string | null;
  snapshot: Sealed | null;
  lastSync: number | null;
}

export interface SyncDeps {
  userData: string;
  services: KSuiteServices;
  tokenConfigured: () => boolean;
  bookmarks: BookmarksStore;
  history: HistoryStore;
  vault: Vault;
  /** Open tabs of the normal windows. */
  openTabs: () => Array<{ title: string; url: string }>;
  onStatus: (status: SyncStatus) => void;
}

export class SyncError extends Error {}

/** End-to-end encrypted sync of bookmarks, passwords, history and open tabs through kDrive. */
export class SyncEngine {
  private local: LocalFile;
  private key: Buffer | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private state: SyncStatus['state'] = 'off';
  private lastError: string | null = null;
  private devices: DeviceFile[] = [];
  private passwordsWaiting = false;
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private applying = false;

  constructor(private readonly deps: SyncDeps) {
    this.local = this.readLocal();
    if (this.local.enabled) {
      this.key = this.loadKey();
      this.state = this.key ? 'idle' : 'needs-passphrase';
    }
  }

  // ---------- Local file ----------

  private path(): string {
    return join(this.deps.userData, 'sync.json');
  }

  private readLocal(): LocalFile {
    const defaults: LocalFile = {
      enabled: false,
      deviceId: randomUUID(),
      deviceName: hostname() || 'Questo computer',
      collections: { bookmarks: true, logins: true, history: true, tabs: true },
      keyCipher: null,
      snapshot: null,
      lastSync: null,
    };
    try {
      const raw = JSON.parse(readFileSync(this.path(), 'utf8')) as Partial<LocalFile>;
      return { ...defaults, ...raw, collections: { ...defaults.collections, ...(raw.collections ?? {}) } };
    } catch {
      return defaults;
    }
  }

  private writeLocal(): void {
    writeFileSync(this.path(), JSON.stringify(this.local), { mode: 0o600 });
  }

  private loadKey(): Buffer | null {
    if (!this.local.keyCipher || !keychainAvailable()) return null;
    try {
      return Buffer.from(safeStorage.decryptString(Buffer.from(this.local.keyCipher, 'base64')), 'base64');
    } catch {
      return null;
    }
  }

  private storeKey(key: Buffer): void {
    this.key = key;
    // Without a real keychain the key stays in memory only: the passphrase is asked at each start.
    this.local.keyCipher = keychainAvailable() ? safeStorage.encryptString(key.toString('base64')).toString('base64') : null;
  }

  private snapshot(): SyncState {
    if (!this.key || !this.local.snapshot) return emptyState();
    try {
      return mergeStates(JSON.parse(open(this.key, this.local.snapshot, AAD).toString('utf8')) as SyncState);
    } catch {
      return emptyState();
    }
  }

  // ---------- Status ----------

  status(): SyncStatus {
    return {
      available: this.deps.tokenConfigured(),
      enabled: this.local.enabled,
      state: this.local.enabled ? this.state : 'off',
      deviceName: this.local.deviceName,
      collections: { ...this.local.collections },
      lastSync: this.local.lastSync,
      lastError: this.lastError,
      devices: this.devices
        .map((d) => ({ id: d.deviceId, name: d.name, updatedAt: d.updatedAt, current: d.deviceId === this.local.deviceId, tabs: d.tabs?.length ?? 0 }))
        .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt - a.updatedAt),
      passwordsWaiting: this.passwordsWaiting,
    };
  }

  /** Open tabs of the other devices, most recent device first. */
  remoteTabs(): RemoteTabs[] {
    if (!this.local.enabled || !this.local.collections.tabs) return [];
    return this.devices
      .filter((d) => d.deviceId !== this.local.deviceId && d.tabs?.length)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((d) => ({ device: d.name, updatedAt: d.updatedAt, tabs: d.tabs! }));
  }

  private emit(): void {
    this.deps.onStatus(this.status());
  }

  // ---------- kDrive ----------

  private async drive() {
    if (!this.deps.tokenConfigured()) throw new SyncError('Collega l’account kSuite per usare la sincronizzazione.');
    const { client, driveId } = await this.deps.services.driveContext();
    const folder = await ensureDirectory(client, driveId, 1, FOLDER);
    return { client, driveId, folderId: folder.id };
  }

  private async readRemote(): Promise<{ meta: RemoteMeta | null; devices: Array<{ id: number; name: string }>; files: Map<string, number> }> {
    const { client, driveId, folderId } = await this.drive();
    const files = await listAll(client, driveId, folderId);
    const byName = new Map(files.filter((f) => f.type !== 'dir').map((f) => [f.name, f.id]));
    let meta: RemoteMeta | null = null;
    const metaId = byName.get(META);
    if (metaId) {
      const res = await downloadFile(client, driveId, metaId);
      meta = (await res.json()) as RemoteMeta;
    }
    const devices = [...byName].filter(([name]) => name.startsWith(DEVICE_PREFIX) && name.endsWith(DEVICE_SUFFIX)).map(([name, id]) => ({ id, name }));
    return { meta, devices, files: byName };
  }

  /** Whether another device already set sync up (then the same passphrase is needed). */
  async probe(): Promise<{ exists: boolean }> {
    const { meta } = await this.readRemote();
    return { exists: Boolean(meta) };
  }

  // ---------- Setup ----------

  /** Turns sync on: creates the encrypted space with this passphrase, or joins the existing one. */
  async enable(passphrase: string, deviceName?: string): Promise<void> {
    if (passphrase.length < MIN_PASSPHRASE) throw new SyncError(`La passphrase deve avere almeno ${MIN_PASSPHRASE} caratteri.`);
    const { client, driveId, folderId } = await this.drive();
    const { meta } = await this.readRemote();
    let key: Buffer;
    if (meta) {
      key = await deriveKey(passphrase, meta.kdf);
      try {
        if (open(key, meta.check, CHECK).toString('utf8') !== CHECK) throw new Error('mismatch');
      } catch {
        throw new SyncError('Passphrase sbagliata: usa quella scelta sul primo dispositivo.');
      }
    } else {
      const kdf = newKdfParams();
      key = await deriveKey(passphrase, kdf);
      const created: RemoteMeta = { format: 1, kdf, check: seal(key, Buffer.from(CHECK), CHECK) };
      await uploadFile(client, driveId, folderId, META, Buffer.from(JSON.stringify(created)), 'version');
    }
    this.storeKey(key);
    this.local.enabled = true;
    this.local.snapshot = null;
    if (deviceName?.trim()) this.local.deviceName = deviceName.trim().slice(0, 60);
    this.writeLocal();
    this.state = 'idle';
    this.lastError = null;
    this.start();
    await this.syncNow();
  }

  /** Passphrase entered again on a computer without a keychain. */
  async unlock(passphrase: string): Promise<void> {
    const { meta } = await this.readRemote();
    if (!meta) throw new SyncError('La sincronizzazione è stata azzerata da un altro dispositivo: riattivala.');
    const key = await deriveKey(passphrase, meta.kdf);
    try {
      open(key, meta.check, CHECK);
    } catch {
      throw new SyncError('Passphrase sbagliata.');
    }
    this.storeKey(key);
    this.state = 'idle';
    this.writeLocal();
    await this.syncNow();
  }

  /** Turns sync off on this computer and removes its file from kDrive (local data stays). */
  async disable(): Promise<void> {
    this.stop();
    try {
      const { client, driveId } = await this.drive();
      const { files } = await this.readRemote();
      const own = files.get(this.deviceFileName());
      if (own) await trashFile(client, driveId, own);
    } catch {
      /* offline: the file is simply left behind */
    }
    this.local = { ...this.local, enabled: false, keyCipher: null, snapshot: null, lastSync: null };
    this.key = null;
    this.devices = [];
    this.writeLocal();
    this.emit();
  }

  /** Deletes every sync file from kDrive (all devices must set it up again). Local data stays. */
  async resetRemote(): Promise<void> {
    const { client, driveId } = await this.drive();
    const { files } = await this.readRemote();
    for (const id of files.values()) await trashFile(client, driveId, id);
    await this.disable();
  }

  setOptions(options: { deviceName?: string; collections?: Partial<Record<SyncCollectionOption, boolean>> }): void {
    if (typeof options.deviceName === 'string' && options.deviceName.trim()) this.local.deviceName = options.deviceName.trim().slice(0, 60);
    for (const [k, v] of Object.entries(options.collections ?? {})) {
      if (k in this.local.collections && typeof v === 'boolean') this.local.collections[k as SyncCollectionOption] = v;
    }
    this.writeLocal();
    this.emit();
    this.soon();
  }

  // ---------- Scheduling ----------

  start(): void {
    if (!this.local.enabled || this.timer) return;
    this.timer = setInterval(() => void this.syncNow().catch(() => {}), INTERVAL_MS);
    this.timer.unref();
    setTimeout(() => void this.syncNow().catch(() => {}), 20_000).unref();
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
  }

  /** A local change: sync shortly after (several changes in a row make one sync). */
  soon(): void {
    if (!this.local.enabled || !this.key || this.applying) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.syncNow().catch(() => {}), DEBOUNCE_MS);
    this.debounce.unref();
  }

  syncNow(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.run()
      .finally(() => {
        this.running = null;
        if (this.again) {
          this.again = false;
          void this.syncNow().catch(() => {});
        }
      });
    return this.running;
  }

  // ---------- The sync itself ----------

  private deviceFileName(): string {
    return `${DEVICE_PREFIX}${this.local.deviceId}${DEVICE_SUFFIX}`;
  }

  private async run(): Promise<void> {
    if (!this.local.enabled) return;
    if (!this.key) {
      this.state = 'needs-passphrase';
      this.emit();
      return;
    }
    this.state = 'syncing';
    this.emit();
    try {
      const key = this.key;
      const { client, driveId, folderId } = await this.drive();
      const { meta, devices } = await this.readRemote();
      if (!meta) {
        await this.disable();
        throw new SyncError('La sincronizzazione è stata azzerata da un altro dispositivo: riattivala con una nuova passphrase.');
      }
      try {
        open(key, meta.check, CHECK);
      } catch {
        // The space was recreated with another passphrase.
        this.key = null;
        this.local.keyCipher = null;
        this.writeLocal();
        this.state = 'needs-passphrase';
        throw new SyncError('La passphrase è cambiata su un altro dispositivo: inseriscila di nuovo.');
      }

      // Everyone's files (including ours, possibly written by an earlier run).
      const remote: DeviceFile[] = [];
      for (const d of devices) {
        try {
          const res = await downloadFile(client, driveId, d.id);
          const sealed = (await res.json()) as Sealed;
          remote.push(JSON.parse(gunzipSync(open(key, sealed, AAD)).toString('utf8')) as DeviceFile);
        } catch (err) {
          console.warn('[sync] file non leggibile:', d.name, err instanceof Error ? err.message : err);
        }
      }

      const now = Date.now();
      const previous = this.snapshot();
      const current = this.collect();
      const mine = localState(previous, current, now);
      const merged = compact(mergeStates(mine, ...remote.map((d) => d.state)), now);
      this.apply(merged, current);

      // What we publish: the merged state, without the collections this device doesn't sync.
      const published: Partial<SyncState> = {};
      for (const c of COLLECTIONS) if (this.syncs(c)) (published as Record<Collection, unknown>)[c] = merged[c];
      const file: DeviceFile = {
        format: 1,
        deviceId: this.local.deviceId,
        name: this.local.deviceName,
        updatedAt: now,
        tabs: this.local.collections.tabs ? this.deps.openTabs().slice(0, 200) : [],
        state: published,
      };
      const body = Buffer.from(JSON.stringify(seal(key, gzipSync(Buffer.from(JSON.stringify(file))), AAD)));
      await uploadFile(client, driveId, folderId, this.deviceFileName(), body, 'version');

      this.local.snapshot = seal(key, Buffer.from(JSON.stringify(rebase(merged, this.collect()))), AAD);
      this.local.lastSync = now;
      this.writeLocal();
      this.devices = [file, ...remote.filter((d) => d.deviceId !== this.local.deviceId)];
      this.state = 'idle';
      this.lastError = null;
    } catch (err) {
      if ((this.state as SyncStatus['state']) !== 'needs-passphrase') this.state = 'error';
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      this.emit();
    }
  }

  private syncs(c: Collection): boolean {
    return this.local.collections[c];
  }

  /** The local items as sync data; a collection left out is not synced (or can't be read now). */
  private collect(): Parameters<typeof localState>[1] {
    const out: Parameters<typeof localState>[1] = {};
    if (this.syncs('bookmarks')) {
      const positions = { bar: 0, other: 0 };
      out.bookmarks = {};
      for (const b of this.deps.bookmarks.list()) {
        if (!/^(https?|file):/i.test(b.url)) continue;
        const data: BookmarkData = { title: b.title, url: b.url, folder: b.folder, position: positions[b.folder]++, createdAt: b.createdAt };
        out.bookmarks[bookmarkKey(b.url)] = { data, changedAt: b.createdAt };
      }
    }
    this.passwordsWaiting = false;
    if (this.syncs('logins')) {
      if (this.deps.vault.tryAutoUnlock()) {
        out.logins = {};
        for (const l of this.deps.vault.list()) {
          const data: LoginData = { origin: l.origin, username: l.username, password: l.password, createdAt: l.createdAt };
          out.logins[loginKey(l.origin, l.username)] = { data, changedAt: l.updatedAt };
        }
      } else {
        this.passwordsWaiting = true;
      }
    }
    if (this.syncs('history')) {
      out.history = {};
      const since = Date.now() - 90 * 24 * 3600 * 1000;
      for (const h of this.deps.history.summaries()) {
        if (h.lastVisit < since || !/^https?:/i.test(h.url)) continue;
        const data: HistoryData = { url: h.url, title: h.title, lastVisit: h.lastVisit };
        out.history[h.url] = { data, changedAt: h.lastVisit };
      }
    }
    return out;
  }

  /** Brings the local stores in line with the merged state. */
  private apply(merged: SyncState, current: Parameters<typeof localState>[1]): void {
    this.applying = true;
    try {
      if (current.bookmarks) {
        const local = Object.fromEntries(Object.entries(current.bookmarks).map(([k, v]) => [k, v.data]));
        const { upsert, remove } = plan(local, merged.bookmarks);
        if (upsert.length || remove.length) {
          const byKey = new Map(this.deps.bookmarks.list().map((b) => [bookmarkKey(b.url), b] as const));
          const next: Array<Bookmark & { position: number }> = [];
          for (const [key, record] of Object.entries(merged.bookmarks)) {
            if (record.deleted || !record.data) continue;
            const existing = byKey.get(key);
            next.push({ id: existing?.id ?? randomUUID(), title: record.data.title, url: record.data.url, folder: record.data.folder, createdAt: record.data.createdAt, position: record.data.position });
          }
          // Local bookmarks that aren't synced (internal pages) stay where they are, at the end.
          for (const b of this.deps.bookmarks.list()) if (!/^(https?|file):/i.test(b.url)) next.push({ ...b, position: Number.MAX_SAFE_INTEGER });
          next.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
          this.deps.bookmarks.replaceAll(next.map(({ position: _p, ...b }) => b));
        }
      }
      if (current.logins) {
        const local = Object.fromEntries(Object.entries(current.logins).map(([k, v]) => [k, v.data]));
        const { upsert, remove } = plan(local, merged.logins);
        for (const [key, data] of upsert) this.deps.vault.putSynced(data.origin, data.username, data.password, data.createdAt, merged.logins[key].updatedAt);
        for (const key of remove) {
          const [origin, username] = key.split('\n');
          this.deps.vault.removeSynced(origin, username ?? '');
        }
      }
      if (current.history) {
        const local = Object.fromEntries(Object.entries(current.history).map(([k, v]) => [k, v.data]));
        for (const [key, record] of Object.entries(merged.history)) {
          if (record.deleted) {
            if (key in local) this.deps.history.removeUrl(key);
          } else if (record.data && (!local[key] || record.data.lastVisit > local[key].lastVisit)) {
            this.deps.history.importVisit(record.data.url, record.data.title, record.data.lastVisit);
          }
        }
      }
    } finally {
      this.applying = false;
    }
  }
}
