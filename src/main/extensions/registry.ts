import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { net, type Extension, type Session } from 'electron';
import { unzipSync } from 'fflate';
import { extensionId, parseCrx } from './crx';
import { actionOf, describePermissions, iconDataUrl, iconPath, localize, readManifest, type Manifest, type PermissionSummary } from './manifest';

export type ExtensionSource = 'store' | 'file' | 'unpacked';

export interface InstalledExtension {
  id: string;
  source: ExtensionSource;
  /** Folder loaded into the session. */
  path: string;
  version: string;
  enabled: boolean;
  /** Button shown in the toolbar (otherwise only in the extensions menu). */
  pinned: boolean;
  installedAt: number;
  /** Optional permissions granted later through chrome.permissions.request. */
  granted: string[];
  /** A newer version from the store that asks for more permissions: waits for the user. */
  pendingUpdate: string | null;
  /** Last version runtime.onInstalled was delivered for (Electron doesn't fire it). */
  notifiedVersion?: string | null;
}

/** What the user sees before confirming an installation. */
export interface InstallPreview {
  id: string;
  name: string;
  version: string;
  description: string;
  icon: string | null;
  permissions: PermissionSummary;
  update: boolean;
}

export class InstallError extends Error {}

const STORE = process.env.KSUITE_WEBSTORE_BASE ?? 'https://clients2.google.com/service/update2/crx';
const ID_RE = /\b([a-p]{32})\b/;

/** Extension ID from a Chrome Web Store address (or the ID itself). */
export function storeIdFrom(input: string): string | null {
  return ID_RE.exec(input.trim())?.[1] ?? null;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

function storeQuery(response: 'redirect' | 'updatecheck', x: string): string {
  return `${STORE}?response=${response}&prodversion=${process.versions.chrome}&acceptformat=crx2,crx3&x=${encodeURIComponent(x)}`;
}

/** Files of a ZIP, with a single top folder removed and unsafe names refused. */
function unzipSafe(zip: Uint8Array): Map<string, Uint8Array> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new InstallError('L’archivio dell’estensione è danneggiato');
  }
  const files = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    const clean = name.replace(/\\/g, '/');
    if (clean.startsWith('/') || /^[a-zA-Z]:/.test(clean) || clean.split('/').some((p) => p === '..')) throw new InstallError('L’archivio contiene percorsi non validi');
    files.set(clean, data);
  }
  if (!files.has('manifest.json')) {
    // Archives made by zipping the folder: one top folder holding manifest.json.
    const tops = new Set([...files.keys()].map((n) => n.split('/')[0]));
    const [top] = [...tops];
    if (tops.size === 1 && files.has(`${top}/manifest.json`)) {
      const stripped = new Map<string, Uint8Array>();
      for (const [n, d] of files) stripped.set(n.slice(top.length + 1), d);
      return stripped;
    }
    throw new InstallError('Manca il file manifest.json');
  }
  return files;
}

/** Installed extensions: files under userData/Extensions, list in extensions.json, loaded into the session. */
export class ExtensionRegistry {
  private readonly root: string;
  private readonly file: string;
  private items: InstalledExtension[] = [];
  private readonly listeners = new Set<() => void>();
  readonly errors = new Map<string, string>();

  constructor(
    userData: string,
    private readonly session: Session,
    private readonly hooks: { loaded(ext: Extension, info: InstalledExtension): void; unloaded(id: string): void },
  ) {
    this.root = join(userData, 'Extensions');
    this.file = join(userData, 'extensions.json');
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: InstalledExtension[] };
      this.items = (raw.items ?? []).filter((i) => i && typeof i.id === 'string' && typeof i.path === 'string').map((i) => ({ ...i, granted: Array.isArray(i.granted) ? i.granted : [], pendingUpdate: i.pendingUpdate ?? null, pinned: Boolean(i.pinned) }));
    } catch {
      this.items = [];
    }
  }

  list(): InstalledExtension[] {
    return this.items;
  }

  get(id: string): InstalledExtension | undefined {
    return this.items.find((i) => i.id === id);
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error('[extensions] salvataggio non riuscito:', err);
    }
    for (const fn of this.listeners) fn();
  }

  /** Loads the enabled extensions (at every start: Electron doesn't remember them). */
  async loadAll(): Promise<void> {
    for (const item of this.items) if (item.enabled) await this.load(item);
  }

  private async load(item: InstalledExtension): Promise<boolean> {
    try {
      const ext = await this.session.extensions.loadExtension(item.path, { allowFileAccess: false });
      if (ext.id !== item.id) {
        // An unpacked folder without a key gets its ID from the path: keep what Electron says.
        if (item.source !== 'unpacked') throw new Error(`ID inatteso (${ext.id})`);
        item.id = ext.id;
      }
      this.errors.delete(item.id);
      this.hooks.loaded(ext, item);
      return true;
    } catch (err) {
      this.errors.set(item.id, err instanceof Error ? err.message : String(err));
      console.error('[extensions] caricamento non riuscito:', item.id, err);
      return false;
    }
  }

  private unload(id: string): void {
    try {
      if (this.session.extensions.getExtension(id)) this.session.extensions.removeExtension(id);
    } catch {
      /* already gone */
    }
    this.hooks.unloaded(id);
  }

  // ---------- Installing ----------

  /** Downloads an extension from the Chrome Web Store and installs it. */
  async installFromStore(input: string, confirm: (p: InstallPreview) => Promise<boolean>): Promise<InstalledExtension | null> {
    const id = storeIdFrom(input);
    if (!id) throw new InstallError('Indirizzo del Chrome Web Store non riconosciuto');
    const data = await this.download(storeQuery('redirect', `id=${id}&uc`));
    return this.installCrx(data, 'store', confirm, id);
  }

  private async download(url: string): Promise<Buffer> {
    let res: Response;
    try {
      res = await net.fetch(url, { redirect: 'follow' });
    } catch {
      throw new InstallError('Chrome Web Store non raggiungibile');
    }
    if (res.status === 204 || res.status === 404) throw new InstallError('Estensione non trovata nel Chrome Web Store (o non disponibile)');
    if (!res.ok) throw new InstallError(`Download non riuscito (HTTP ${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > 200 * 1024 * 1024) throw new InstallError('Estensione troppo grande');
    return data;
  }

  /** Installs a signed .crx package. */
  async installCrx(data: Buffer, source: ExtensionSource, confirm: (p: InstallPreview) => Promise<boolean>, expectedId?: string): Promise<InstalledExtension | null> {
    const pkg = parseCrx(data);
    if (expectedId && pkg.id !== expectedId) throw new InstallError('Il pacchetto scaricato non corrisponde all’estensione richiesta');
    return this.installFiles(unzipSafe(pkg.zip), source, confirm, pkg.publicKey);
  }

  /** Installs a .zip of an extension folder (a key is created if it has none, so its ID stays the same). */
  async installZip(data: Buffer, confirm: (p: InstallPreview) => Promise<boolean>): Promise<InstalledExtension | null> {
    return this.installFiles(unzipSafe(data), 'file', confirm, null);
  }

  private async installFiles(files: Map<string, Uint8Array>, source: ExtensionSource, confirm: (p: InstallPreview) => Promise<boolean>, publicKey: Buffer | null): Promise<InstalledExtension | null> {
    const staging = join(this.root, `.staging-${randomUUID()}`);
    try {
      for (const [name, data] of files) {
        // Reserved names (e.g. _metadata of store packages) are not for Electron; _locales is.
        const top = name.split('/')[0];
        if (top.startsWith('_') && top !== '_locales') continue;
        const target = normalize(join(staging, name));
        if (!target.startsWith(normalize(staging) + sep)) throw new InstallError('L’archivio contiene percorsi non validi');
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
      }
      const manifest = readManifest(staging);
      let key = publicKey;
      if (!key && typeof manifest.key === 'string') key = Buffer.from(manifest.key, 'base64');
      if (!key) key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' });
      manifest.key = key.toString('base64');
      writeFileSync(join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const id = extensionId(key);

      const previous = this.get(id);
      const preview = this.preview(staging, manifest, id, Boolean(previous));
      if (!(await confirm(preview))) return null;

      const dir = join(this.root, id, `${manifest.version.replace(/[^\w.-]/g, '_')}_${Date.now()}`);
      mkdirSync(dirname(dir), { recursive: true });
      renameSync(staging, dir);
      return this.activate(id, dir, manifest.version, source, previous);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  /** Loads a folder in place (developer mode): changes are picked up with "Ricarica". */
  async installUnpacked(path: string, confirm: (p: InstallPreview) => Promise<boolean>): Promise<InstalledExtension | null> {
    const manifest = readManifest(path);
    const existing = this.items.find((i) => i.source === 'unpacked' && i.path === path);
    const preview = this.preview(path, manifest, existing?.id ?? '', Boolean(existing));
    if (!existing && !(await confirm(preview))) return null;
    return this.activate(existing?.id ?? `unpacked-${randomUUID()}`, path, manifest.version, 'unpacked', existing);
  }

  private preview(dir: string, manifest: Manifest, id: string, update: boolean): InstallPreview {
    return {
      id,
      name: localize(dir, manifest, manifest.name),
      version: manifest.version,
      description: localize(dir, manifest, manifest.description),
      icon: iconDataUrl(dir, iconPath(manifest.icons, 48) ?? iconPath(actionOf(manifest)?.default_icon, 48)),
      permissions: describePermissions(manifest),
      update,
    };
  }

  private async activate(id: string, dir: string, version: string, source: ExtensionSource, previous: InstalledExtension | undefined): Promise<InstalledExtension> {
    if (previous) this.unload(previous.id);
    const item: InstalledExtension = previous
      ? { ...previous, path: dir, version, source, enabled: true, pendingUpdate: null }
      : { id, source, path: dir, version, enabled: true, pinned: true, installedAt: Date.now(), granted: [], pendingUpdate: null };
    if (previous) this.items = this.items.map((i) => (i === previous ? item : i));
    else this.items.push(item);
    const ok = await this.load(item);
    if (!ok && !previous) {
      this.items = this.items.filter((i) => i !== item);
      if (source !== 'unpacked') rmSync(dir, { recursive: true, force: true });
      const reason = this.errors.get(item.id);
      this.changed();
      throw new InstallError(`L’estensione non si carica: ${reason ?? 'errore sconosciuto'}`);
    }
    if (previous && previous.path !== dir && previous.source !== 'unpacked') rmSync(previous.path, { recursive: true, force: true });
    this.cleanOldVersions(item);
    this.changed();
    return item;
  }

  private cleanOldVersions(item: InstalledExtension): void {
    if (item.source === 'unpacked') return;
    const base = join(this.root, item.id);
    try {
      for (const d of readdirSync(base)) if (join(base, d) !== item.path) rmSync(join(base, d), { recursive: true, force: true });
    } catch {
      /* nothing to clean */
    }
  }

  // ---------- Managing ----------

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const item = this.get(id);
    if (!item || item.enabled === enabled) return;
    item.enabled = enabled;
    if (enabled) await this.load(item);
    else this.unload(id);
    this.changed();
  }

  setPinned(id: string, pinned: boolean): void {
    const item = this.get(id);
    if (!item || item.pinned === pinned) return;
    item.pinned = pinned;
    this.changed();
  }

  /** Records that onInstalled was delivered; returns what it was about (null: nothing new). */
  takeInstallEvent(id: string): { reason: 'install' | 'update'; previousVersion?: string } | null {
    const item = this.get(id);
    if (!item || item.notifiedVersion === item.version) return null;
    const previous = item.notifiedVersion;
    item.notifiedVersion = item.version;
    this.changed();
    return previous ? { reason: 'update', previousVersion: previous } : { reason: 'install' };
  }

  grant(id: string, permissions: string[]): void {
    const item = this.get(id);
    if (!item) return;
    item.granted = [...new Set([...item.granted, ...permissions])];
    this.changed();
  }

  revoke(id: string, permissions: string[]): void {
    const item = this.get(id);
    if (!item) return;
    item.granted = item.granted.filter((p) => !permissions.includes(p));
    this.changed();
  }

  /** Reloads an extension from disk (unpacked folders during development). */
  async reload(id: string): Promise<void> {
    const item = this.get(id);
    if (!item?.enabled) return;
    this.unload(id);
    await this.load(item);
    this.changed();
  }

  remove(id: string): void {
    const item = this.get(id);
    if (!item) return;
    this.unload(id);
    this.items = this.items.filter((i) => i !== item);
    if (item.source !== 'unpacked') rmSync(join(this.root, item.id), { recursive: true, force: true });
    this.errors.delete(id);
    this.changed();
  }

  // ---------- Updates ----------

  /**
   * Checks the store for newer versions. Updates asking for no new permissions are installed at once;
   * the others wait for the user (pendingUpdate).
   */
  async checkUpdates(): Promise<number> {
    let installed = 0;
    for (const item of this.items.filter((i) => i.source === 'store')) {
      try {
        const res = await net.fetch(storeQuery('updatecheck', `id=${item.id}&v=${item.version}&uc`));
        if (!res.ok) continue;
        const xml = await res.text();
        const tag = /<updatecheck\b[^>]*>/.exec(xml)?.[0] ?? '';
        const codebase = /\bcodebase="([^"]+)"/.exec(tag)?.[1];
        const version = /\bversion="([^"]+)"/.exec(tag)?.[1];
        if (!codebase || !version || compareVersions(version, item.version) <= 0) continue;
        const data = await this.download(codebase.replace(/&amp;/g, '&'));
        const before = describePermissions(readManifest(item.path)).warnings;
        const result = await this.installCrx(data, 'store', async (p) => {
          const more = p.permissions.warnings.filter((w) => !before.includes(w));
          if (more.length === 0) return true;
          item.pendingUpdate = p.version;
          this.changed();
          return false;
        }, item.id);
        if (result) installed++;
      } catch (err) {
        console.error('[extensions] aggiornamento non riuscito:', item.id, err);
      }
    }
    return installed;
  }

  /** Installs a pending update after the user accepted the new permissions. */
  async applyPendingUpdate(id: string, confirm: (p: InstallPreview) => Promise<boolean>): Promise<void> {
    const item = this.get(id);
    if (!item?.pendingUpdate) return;
    await this.installFromStore(id, confirm);
  }

  /** Manifest of an installed extension (null if its files are gone). */
  manifest(id: string): Manifest | null {
    const item = this.get(id);
    if (!item || !existsSync(item.path)) return null;
    try {
      return readManifest(item.path);
    } catch {
      return null;
    }
  }
}
