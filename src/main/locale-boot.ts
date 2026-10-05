/**
 * Chooses the interface language before any other module runs (some build their texts when loaded):
 * the one in the settings, or the system's. Imported first by main.ts.
 */
import { app, ipcMain } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLocale, setLocale, type LanguageSetting } from '../shared/i18n';

function savedLanguage(): LanguageSetting | undefined {
  try {
    const raw = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')) as { settings?: { language?: unknown } };
    const value = raw.settings?.language;
    return value === 'it' || value === 'en' || value === 'system' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The language Velo started with (a change applies at the next start). */
export const STARTUP_LOCALE = resolveLocale(savedLanguage(), app.getPreferredSystemLanguages());
setLocale(STARTUP_LOCALE);

// Preloads ask for it synchronously, so pages have their language before their scripts run.
ipcMain.on('i18n:locale', (event) => {
  event.returnValue = STARTUP_LOCALE;
});
