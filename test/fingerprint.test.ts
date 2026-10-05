import { describe, expect, it } from 'vitest';
import { shieldConfig } from '../src/shared/fingerprint';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings-schema';

const key = Buffer.alloc(32, 7);
const base = { setting: 'standard' as const, exceptions: [], sessionKey: key, cpus: 16 };

describe('fingerprinting protection', () => {
  it('is on by default and keeps unknown values out', () => {
    expect(DEFAULT_SETTINGS.fingerprintProtection).toBe('standard');
    expect(sanitizeSettings({ fingerprintProtection: 'max' }).fingerprintProtection).toBe('standard');
    expect(sanitizeSettings({ fingerprintProtection: 'strict' }).fingerprintProtection).toBe('strict');
  });

  it('gives a site stable values, other sites and other sessions different ones', () => {
    const a = shieldConfig({ ...base, site: 'example.com' });
    expect(shieldConfig({ ...base, site: 'example.com' })).toEqual(a);
    expect(shieldConfig({ ...base, site: 'other.org' }).seed).not.toBe(a.seed);
    expect(shieldConfig({ ...base, site: 'example.com', sessionKey: Buffer.alloc(32, 8) }).seed).not.toBe(a.seed);
  });

  it('reports a plausible CPU count, never more than the real one (strict: always 4)', () => {
    for (const site of ['a.com', 'b.com', 'c.com', 'd.com', 'e.com']) {
      const { cores } = shieldConfig({ ...base, site });
      expect(cores).toBeGreaterThanOrEqual(2);
      expect(cores).toBeLessThanOrEqual(16);
    }
    expect(shieldConfig({ ...base, site: 'a.com', setting: 'strict' }).cores).toBe(4);
  });

  it('turns off on the sites without protections, but never in Tor windows', () => {
    expect(shieldConfig({ ...base, site: 'bank.it', exceptions: ['bank.it'] }).mode).toBe('off');
    expect(shieldConfig({ ...base, site: 'bank.it', exceptions: ['bank.it'], forceStrict: true }).mode).toBe('strict');
  });
});
