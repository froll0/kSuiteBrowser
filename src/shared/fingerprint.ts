import { createHash } from 'node:crypto';

export type FingerprintProtection = 'off' | 'standard' | 'strict';

/** What the shield preload applies in a page (see preload/shield.ts). */
export interface ShieldConfig {
  mode: FingerprintProtection;
  /** Key of this site in this session (32-bit). */
  seed: number;
  /** CPU count to report. */
  cores: number;
}

/** Client hints that describe the device in detail: never sent (the low-entropy ones stay). */
export const HIGH_ENTROPY_HINTS = [
  'sec-ch-ua-full-version',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-platform-version',
  'sec-ch-ua-arch',
  'sec-ch-ua-model',
  'sec-ch-ua-bitness',
  'sec-ch-ua-wow64',
  'sec-ch-ua-form-factors',
];

/**
 * Fingerprinting protection for a page. The seed mixes a random key of the browser session with the
 * site of the top page: stable within a site, unrelated across sites and across restarts.
 */
export function shieldConfig(opts: {
  setting: FingerprintProtection;
  /** Site of the top page (siteOf), null when unknown. */
  site: string | null;
  /** Sites where the user turned the protections off. */
  exceptions: readonly string[];
  sessionKey: Buffer;
  /** Tor windows: always strict. */
  forceStrict?: boolean;
  /** Real CPU count. */
  cpus: number;
}): ShieldConfig {
  const digest = createHash('sha256').update(opts.sessionKey).update('\0').update(opts.site ?? '').digest();
  const seed = digest.readUInt32LE(0) || 1;
  const mode: FingerprintProtection = opts.forceStrict
    ? 'strict'
    : opts.site && opts.exceptions.includes(opts.site)
      ? 'off'
      : opts.setting;
  // Standard: a plausible count between 2 and the real one (at least 2..4), different per site.
  const top = Math.max(4, opts.cpus);
  const cores = mode === 'strict' ? 4 : mode === 'off' ? opts.cpus : 2 + (digest.readUInt32LE(4) % (top - 1));
  return { mode, seed, cores };
}
