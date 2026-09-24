import { applyTokens, isDark, tokens } from '../../shared/appearance';
import type { Settings } from '../../shared/types';
import { internal } from './bridge';

const systemDark = matchMedia('(prefers-color-scheme: dark)');
let last: Settings | null = null;

function apply(settings: Settings): void {
  last = settings;
  const isPrivate = document.body?.classList.contains('private') ?? false;
  const dark = isPrivate || isDark(settings.theme, systemDark.matches);
  applyTokens(document.documentElement, tokens(settings, dark, isPrivate), dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** Applies the look chosen in the settings (colours, font, shapes) and follows later changes. */
export function followTheme(): void {
  void internal.settings().then(apply);
  internal.onSettings(apply);
  systemDark.addEventListener('change', () => last && apply(last));
}

/** Re-applies the current look (e.g. once the page knows it's in a private window). */
export function refreshTheme(): void {
  if (last) apply(last);
}
