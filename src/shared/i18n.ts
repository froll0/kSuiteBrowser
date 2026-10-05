/**
 * Translations. The Italian text is the key (gettext style), so the source stays readable; each other
 * language has a catalog that maps it (src/shared/locales/). A test checks every key is translated.
 *
 *   tr('Nuova scheda')                       → "New tab"
 *   tr('Salva {0} su kDrive', name)          → "Save … to kDrive"
 *   plural(n, 'Una scheda', '{n} schede')   → "One tab" / "3 tabs"
 */
import { en } from './locales/en';

export const LOCALES = ['it', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** Language setting: follow the system, or a fixed one. */
export type LanguageSetting = 'system' | Locale;

export const LOCALE_NAMES: Record<Locale, string> = { it: 'Italiano', en: 'English' };

const CATALOGS: Record<Exclude<Locale, 'it'>, Record<string, string>> = { en };

/** The supported language closest to a BCP 47 tag ('it-CH' → it); English for the others. */
export function pickLocale(tag: string | null | undefined): Locale {
  const base = String(tag ?? '').toLowerCase().split(/[-_]/)[0];
  return (LOCALES as readonly string[]).includes(base) ? (base as Locale) : 'en';
}

/** Effective language for a setting and the system's preferred languages. */
export function resolveLocale(setting: LanguageSetting | undefined, systemLanguages: readonly string[]): Locale {
  if (setting && setting !== 'system') return setting;
  for (const tag of systemLanguages) {
    const base = String(tag).toLowerCase().split(/[-_]/)[0];
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return 'en';
}

let current: Locale | null = null;

/**
 * The language in use. The main process sets it at startup; the browser UI and its internal pages
 * receive it from their preload (window.veloLocale) before any of their scripts run.
 */
export function locale(): Locale {
  if (current) return current;
  const g = globalThis as { veloLocale?: string; __veloLocale?: string };
  const hint = g.__veloLocale ?? g.veloLocale;
  if (hint) current = pickLocale(hint);
  return current ?? 'it';
}

export function setLocale(value: Locale): void {
  current = value;
  (globalThis as { __veloLocale?: string }).__veloLocale = value;
}

/** BCP 47 tag for dates and numbers. */
export function localeTag(): string {
  return locale() === 'it' ? 'it-IT' : 'en-US';
}

function fill(text: string, args: ReadonlyArray<unknown>): string {
  return args.length ? text.replace(/\{(\d+)\}/g, (m, i: string) => (Number(i) < args.length ? String(args[Number(i)]) : m)) : text;
}

/** The text in the current language; {0}, {1}… are replaced by the arguments. */
export function tr(key: string, ...args: unknown[]): string {
  const lang = locale();
  const text = lang === 'it' ? key : (CATALOGS[lang][key] ?? key);
  return fill(text, args);
}

/** Singular or plural text; {n} is the count. */
export function plural(n: number, one: string, other: string): string {
  return tr(n === 1 ? one : other).replace(/\{n\}/g, String(n));
}

/**
 * Translates the static text of an HTML page (text nodes and the title, placeholder and aria-label
 * attributes) whose content is a key of the catalog.
 */
export function translateDom(root: ParentNode & Node): void {
  if (locale() === 'it') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue ?? '';
    const key = raw.trim().replace(/\s+/g, ' ');
    if (key && key !== tr(key)) node.nodeValue = raw.replace(raw.trim(), tr(key));
  }
  for (const el of (root as ParentNode).querySelectorAll('[title], [placeholder], [aria-label], [alt]')) {
    for (const attr of ['title', 'placeholder', 'aria-label', 'alt']) {
      const value = el.getAttribute(attr);
      if (value) el.setAttribute(attr, tr(value.replace(/\s+/g, ' ').trim()));
    }
  }
  if (root === document.documentElement || root === document.body) {
    document.title = tr(document.title);
    document.documentElement.lang = locale();
  }
}
