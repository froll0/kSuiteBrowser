import type { Session } from 'electron';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Removes what earlier versions installed and Velo no longer supports, for security: Chrome extensions
 * (their files, list and the data they saved in the browser) and the Tor client's state.
 */
export async function purgeRemovedFeatures(userData: string, session: Session): Promise<void> {
  // Ids of the installed extensions, to wipe the data their pages and workers saved.
  const ids = new Set<string>();
  try {
    const raw = JSON.parse(readFileSync(join(userData, 'extensions.json'), 'utf8')) as unknown;
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: unknown[] }).items : [];
    for (const item of list) {
      const id = (item as { id?: unknown })?.id;
      if (typeof id === 'string' && /^[a-p]{32}$/.test(id)) ids.add(id);
    }
  } catch {
    /* no list */
  }
  for (const ext of session.extensions?.getAllExtensions?.() ?? []) {
    ids.add(ext.id);
    session.extensions.removeExtension(ext.id);
  }
  for (const id of ids) await session.clearStorageData({ origin: `chrome-extension://${id}` }).catch(() => undefined);

  for (const name of [
    'Extensions',
    'extensions.json',
    'Local Extension Settings',
    'Sync Extension Settings',
    'Managed Extension Settings',
    'Extension State',
    'Extension Rules',
    'Extension Scripts',
    'tor',
  ]) {
    const path = join(userData, name);
    if (existsSync(path)) rmSync(path, { recursive: true, force: true });
  }
}
