/**
 * Chooses the profile folder before anything reads it (imported first by main.ts, before the language).
 * The default profile is Velo's usual folder; the others live in its "Profiles" subfolder and are
 * started with --profile=<id>. Each profile is a separate instance with its own cookies, history,
 * passwords and settings (Chromium's single instance lock is per folder).
 */
import { app } from 'electron';
import { join } from 'node:path';
import { adoptLegacyProfile } from './legacy';

adoptLegacyProfile();

/** Folder of the default profile, where the list of profiles is kept. */
export const PROFILES_ROOT = app.getPath('userData');

export function profileArg(argv: readonly string[]): string | null {
  const arg = argv.find((a) => a.startsWith('--profile='));
  const id = arg?.slice('--profile='.length) ?? '';
  return /^[a-z0-9-]{1,40}$/.test(id) && id !== 'default' ? id : null;
}

/** Profile of this instance ('default' for the usual one). */
export const PROFILE_ID = profileArg(process.argv) ?? 'default';

if (PROFILE_ID !== 'default') app.setPath('userData', join(PROFILES_ROOT, 'Profiles', PROFILE_ID));
