import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS helper shared with the build scripts
import { collectKeys } from '../scripts/i18n-keys.mjs';
import { en } from '../src/shared/locales/en';
import { pickLocale, plural, resolveLocale, setLocale, tr } from '../src/shared/i18n';

describe('translations', () => {
  it('has an English text for every key used in the sources', () => {
    const keys = collectKeys('src') as Map<string, string>;
    const missing = [...keys].filter(([k]) => !(k in en)).map(([k, file]) => `${file}: ${JSON.stringify(k)}`);
    expect(missing).toEqual([]);
  });

  it('keeps the placeholders of each text', () => {
    const marks = (s: string) => (s.match(/\{\d+\}|\{n\}/g) ?? []).sort().join(',');
    const broken = Object.entries(en).filter(([k, v]) => marks(k) !== marks(v)).map(([k]) => k);
    expect(broken).toEqual([]);
  });

  it('follows the system language, falling back to English', () => {
    expect(resolveLocale('system', ['it-CH', 'en-US'])).toBe('it');
    expect(resolveLocale('system', ['de-DE', 'fr-FR'])).toBe('en');
    expect(resolveLocale('system', ['de-DE', 'it-IT'])).toBe('it');
    expect(resolveLocale('en', ['it-IT'])).toBe('en');
    expect(pickLocale('it_IT')).toBe('it');
  });

  it('translates and fills in the arguments', () => {
    setLocale('en');
    expect(tr('Nuova scheda')).toBe('New tab');
    expect(tr('Nessuna scheda con id {0}', 7)).toBe('No tab with id 7');
    expect(plural(3, 'Una scheda', '{n} schede')).toBe('3 tabs');
    expect(tr('testo sconosciuto')).toBe('testo sconosciuto');
    setLocale('it');
    expect(tr('Nessuna scheda con id {0}', 7)).toBe('Nessuna scheda con id 7');
  });
});
