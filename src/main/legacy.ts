import { app } from 'electron';
import { cpSync, existsSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Name of the browser before it became Velo: its profile folder and keychain entry. */
const LEGACY_NAME = 'kSuite Browser';
const MARKER = 'legacy-profile.json';

/**
 * Moves the profile of the old version to Velo's folder (tabs, passwords, settings, cookies…).
 * Secrets protected by the system keychain (macOS Keychain, Linux Secret Service) are stored under
 * the application name: for a moved profile the old name stays in use for the keychain, so nothing
 * becomes unreadable. Must run before anything touches the profile (single instance lock included).
 */
export function adoptLegacyProfile(): void {
  const appData = app.getPath('appData');
  const current = join(appData, 'Velo');
  const legacy = join(appData, LEGACY_NAME);
  const marker = join(current, MARKER);
  try {
    if (!existsSync(current) && existsSync(legacy)) {
      try {
        renameSync(legacy, current);
      } catch {
        cpSync(legacy, current, { recursive: true });
      }
      writeFileSync(marker, JSON.stringify({ from: LEGACY_NAME, movedAt: Date.now() }));
    }
  } catch (err) {
    console.error('[profilo] trasferimento dalla versione precedente non riuscito:', err);
  }
  app.setPath('userData', current);
  if (existsSync(marker)) app.setName(LEGACY_NAME);
}
