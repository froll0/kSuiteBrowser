import type { Settings } from '../../shared/types';
import { internal } from './bridge';

function apply(settings: Settings): void {
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
}

/** Applies the theme chosen in the settings (and follows later changes). */
export function followTheme(): void {
  void internal.settings().then(apply);
  internal.onSettings(apply);
}
