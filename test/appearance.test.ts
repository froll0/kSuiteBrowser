import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, chromeColors, contrast, mix, tokens } from '../src/shared/appearance';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/shared/settings-schema';

describe('appearance', () => {
  it('keeps the accent readable on every palette, light and dark', () => {
    for (const palette of ['standard', 'warm', 'contrast'] as const) {
      for (const dark of [false, true]) {
        for (const { color } of [...ACCENT_PRESETS, { color: '#ffff00' }, { color: '#101010' }]) {
          const t = tokens({ ...DEFAULT_SETTINGS, palette, accentColor: color }, dark);
          expect(contrast(t['--accent'], t['--surface'])).toBeGreaterThanOrEqual(palette === 'contrast' ? 4.5 : 3);
          expect(contrast(t['--accent'], t['--on-accent'])).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('derives shapes and spacing from the settings', () => {
    const round = tokens({ ...DEFAULT_SETTINGS, cornerRadius: 16 }, false);
    expect(round['--r-canvas']).toBe('16px');
    expect(round['--r-pill']).toBe('999px');
    const square = tokens({ ...DEFAULT_SETTINGS, cornerRadius: 0 }, false);
    expect(square['--r-pill']).toBe('0px');
    const flush = tokens({ ...DEFAULT_SETTINGS, canvasStyle: 'flush' }, false);
    expect(flush['--inset']).toBe('0px');
    expect(flush['--r-canvas']).toBe('0px');
    expect(tokens({ ...DEFAULT_SETTINGS, density: 'compact' }, false)['--row-h']).toBe('38px');
  });

  it('tints the backdrop with the accent unless neutral, and the window uses the same colour', () => {
    const tinted = tokens(DEFAULT_SETTINGS, false);
    const neutral = tokens({ ...DEFAULT_SETTINGS, backdrop: 'neutral' }, false);
    expect(tinted['--titlebar']).not.toBe(neutral['--titlebar']);
    expect(chromeColors(DEFAULT_SETTINGS, false).backdrop).toBe(tinted['--titlebar']);
    expect(tokens({ ...DEFAULT_SETTINGS, backdrop: 'gradient' }, true)['--backdrop']).toMatch(/^linear-gradient/);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('sanitizes appearance settings', () => {
    const s = sanitizeSettings({
      accentColor: 'red', cornerRadius: 99, uiFontSize: 30, tabsLayout: 'diagonal',
      toolbarStart: ['back', 'nope', 'back', 'panel'], toolbarEnd: ['panel', 'downloads'], showSidebar: false,
    });
    expect(s.accentColor).toBe(DEFAULT_SETTINGS.accentColor);
    expect(s.cornerRadius).toBe(24);
    expect(s.uiFontSize).toBe(13);
    expect(s.tabsLayout).toBe('inline');
    expect(s.toolbarStart).toEqual(['back', 'panel']);
    expect(s.toolbarEnd).toEqual(['downloads']);
    expect(s.railPosition).toBe('hidden');
    expect(sanitizeSettings({}).railPosition).toBe('left');
  });
});
