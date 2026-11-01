import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ dialog: {}, shell: {} }));

import { persistentMemory } from '../src/main/permissions';
import { sanitizeSettings } from '../src/shared/settings-schema';
import type { Settings } from '../src/shared/types';

/** A settings store in memory, enough for the permission memory. */
function store() {
  let current = sanitizeSettings({});
  return { get: () => current, update: (patch: Partial<Settings>) => (current = sanitizeSettings({ ...current, ...patch })) };
}

describe('containers', () => {
  it('keep their own site permissions', () => {
    const s = store();
    const normal = persistentMemory(s as never);
    const work = persistentMemory(s as never, 'work');
    normal.set('meet.example', 'media', true);
    work.set('meet.example', 'media', false);
    expect(normal.get('meet.example', 'media')).toBe(true);
    expect(work.get('meet.example', 'media')).toBe(false);
    expect(persistentMemory(s as never, 'personal').get('meet.example', 'media')).toBeUndefined();
    expect(s.get().sitePermissions).toHaveLength(2);
    // Survives a settings round trip.
    expect(sanitizeSettings(JSON.parse(JSON.stringify(s.get()))).sitePermissions.find((p) => p.container === 'work')?.allowed).toBe(false);
  });
});
