import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, COMMANDS, displayShortcut, normalizeAccelerator, sanitizeShortcuts, shortcutConflicts, shortcutFor } from '../src/shared/commands';
import { sanitizeSettings } from '../src/shared/settings-schema';

const key = (k: string, code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('keyboard shortcuts', () => {
  it('has unique command ids and default shortcuts', () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    const keys = COMMANDS.map((c) => c.keys).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('normalizes accelerators and refuses unsafe ones', () => {
    expect(normalizeAccelerator('ctrl+shift+k')).toBe('CmdOrCtrl+Shift+K');
    expect(normalizeAccelerator('Shift+Alt+Control+arrowleft')).toBe('CmdOrCtrl+Alt+Shift+Left');
    expect(normalizeAccelerator('F6')).toBe('F6');
    expect(normalizeAccelerator('K')).toBeNull();
    expect(normalizeAccelerator('Shift+K')).toBeNull();
    expect(normalizeAccelerator('Ctrl+1')).toBeNull();
    expect(normalizeAccelerator('Ctrl+Q')).toBeNull();
    expect(normalizeAccelerator('Ctrl+Bogus')).toBeNull();
  });

  it('records the physical key of a keydown', () => {
    expect(acceleratorFromEvent(key('k', 'KeyK', { ctrlKey: true }))).toBe('CmdOrCtrl+K');
    expect(acceleratorFromEvent(key('!', 'Digit1', { ctrlKey: true, shiftKey: true }))).toBe('CmdOrCtrl+Shift+1');
    expect(acceleratorFromEvent(key('ArrowRight', 'ArrowRight', { altKey: true }))).toBe('Alt+Right');
    expect(acceleratorFromEvent(key('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull();
  });

  it('keeps only valid overrides and finds conflicts', () => {
    const s = sanitizeShortcuts({ newTab: 'ctrl+y', closeTab: '', bogus: 'Ctrl+J', reload: 'nope', find: 'CmdOrCtrl+F' });
    expect(s).toEqual({ newTab: 'CmdOrCtrl+Y', closeTab: '' });
    expect(shortcutFor('closeTab', s)).toBe('');
    expect(shortcutFor('find', s)).toBe('CmdOrCtrl+F');
    const clash = shortcutConflicts({ newTab: 'CmdOrCtrl+F' });
    expect(clash.get('CmdOrCtrl+F')).toEqual(['newTab', 'find']);
  });

  it('shows shortcuts the way the system writes them', () => {
    expect(displayShortcut('CmdOrCtrl+Shift+K', 'linux')).toBe('Ctrl+Shift+K');
    expect(displayShortcut('CmdOrCtrl+Shift+K', 'darwin')).toBe('⌘⇧K');
    expect(displayShortcut('Alt+Left', 'win32')).toBe('Alt+←');
  });

  it('shows the welcome page only to new profiles', () => {
    expect(sanitizeSettings({}).onboarded).toBe(false);
    expect(sanitizeSettings({ theme: 'dark' }).onboarded).toBe(true);
    expect(sanitizeSettings({ onboarded: false, theme: 'dark' }).onboarded).toBe(false);
  });
});
