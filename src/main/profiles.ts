import { app } from 'electron';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PROFILE as DEFAULT, tagList } from '../shared/settings-schema';
import type { ProfileInfo } from '../shared/types';
import { tr } from '../shared/i18n';
import { PROFILE_ID, PROFILES_ROOT } from './profile-boot';

const FILE = join(PROFILES_ROOT, 'profiles.json');

/** The profiles (the default one always first). */
export function listProfiles(): ProfileInfo[] {
  let stored: unknown = [];
  try {
    stored = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    /* only the default profile */
  }
  const list = tagList<ProfileInfo>(stored, [DEFAULT], 20);
  return list.some((p) => p.id === 'default') ? [list.find((p) => p.id === 'default')!, ...list.filter((p) => p.id !== 'default')] : [DEFAULT, ...list];
}

function save(list: ProfileInfo[]): void {
  writeFileSync(FILE, JSON.stringify(list, null, 2), { mode: 0o600 });
}

export function currentProfile(): ProfileInfo {
  return listProfiles().find((p) => p.id === PROFILE_ID) ?? { id: PROFILE_ID, name: PROFILE_ID, color: 'grey' };
}

export function createProfile(name: string, color: ProfileInfo['color']): ProfileInfo {
  const list = listProfiles();
  const profile: ProfileInfo = { id: `p-${randomBytes(4).toString('hex')}`, name: name.trim().slice(0, 40) || tr('Nuovo profilo'), color };
  save([...list, profile]);
  return profile;
}

export function updateProfile(id: string, patch: Partial<Pick<ProfileInfo, 'name' | 'color'>>): void {
  save(listProfiles().map((p) => (p.id === id ? { ...p, ...(patch.name?.trim() ? { name: patch.name.trim().slice(0, 40) } : {}), ...(patch.color ? { color: patch.color } : {}) } : p)));
}

/** Deletes a profile and all its data. Not the default one, nor the one running. */
export function removeProfile(id: string): void {
  if (id === 'default' || id === PROFILE_ID || !/^[a-z0-9-]{1,40}$/.test(id)) throw new Error(tr('Questo profilo non si può eliminare.'));
  save(listProfiles().filter((p) => p.id !== id));
  const dir = join(PROFILES_ROOT, 'Profiles', id);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

/** Starts Velo with a profile (if it's already running, that instance opens a window). */
export function openProfile(id: string): void {
  if (!listProfiles().some((p) => p.id === id)) return;
  const args = [
    ...(app.isPackaged ? [] : [app.getAppPath()]),
    ...(id === 'default' ? [] : [`--profile=${id}`]),
    // Development and tests run as root without the sandbox: the new instance needs the same.
    ...process.argv.filter((a) => a === '--no-sandbox'),
  ];
  const child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
  child.unref();
}
