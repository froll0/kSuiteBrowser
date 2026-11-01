import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, contrast, tokens } from '../src/shared/appearance';
import { sanitizeSettings } from '../src/shared/settings-schema';
import { TAG_COLOR_INFO } from '../src/shared/settings-schema';

/** WCAG AA: 4.5:1 for normal text, 3:1 for large text and UI parts (icons, borders of controls, focus). */
describe('contrast in every theme', () => {
  const failures: string[] = [];
  for (const palette of ['standard', 'warm', 'contrast'] as const) {
    for (const dark of [false, true]) {
      for (const backdrop of ['neutral', 'tint', 'gradient'] as const) {
        for (const { color } of ACCENT_PRESETS) {
          const s = sanitizeSettings({ palette, backdrop, accentColor: color });
          const t = tokens(s, dark);
          const name = `${palette}/${dark ? 'dark' : 'light'}/${backdrop}/${color}`;
          const check = (what: string, fg: string, bg: string, min: number) => {
            const ratio = contrast(fg, bg);
            if (ratio < min) failures.push(`${name}: ${what} ${ratio.toFixed(2)} < ${min}`);
          };
          for (const bg of ['--surface', '--surface-2', '--titlebar'] as const) {
            check(`text on ${bg}`, t['--text'], t[bg], 4.5);
            check(`text-2 on ${bg}`, t['--text-2'], t[bg], 4.5);
            check(`muted on ${bg}`, t['--muted'], t[bg], 4.5);
            check(`accent on ${bg}`, t['--accent'], t[bg], 4.5);
          }
          check('text on accent buttons', t['--on-accent'], t['--accent-fill'], 4.5);
          check('text on hovered accent buttons', t['--on-accent'], t['--accent-hover'], 4.5);
        }
      }
    }
  }
  const priv = tokens(sanitizeSettings({}), true, true);

  it('meets WCAG AA for text and controls', () => {
    expect(failures).toEqual([]);
  });

  it('private windows too', () => {
    expect(contrast(priv['--text'], priv['--surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(priv['--muted'], priv['--surface'])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(priv['--on-accent'], priv['--accent-fill'])).toBeGreaterThanOrEqual(4.5);
  });

  it('white text reads on group and container colours', () => {
    const weak = Object.entries(TAG_COLOR_INFO).filter(([, c]) => contrast('#ffffff', c.light) < 3).map(([k]) => k);
    expect(weak).toEqual([]);
  });
});
