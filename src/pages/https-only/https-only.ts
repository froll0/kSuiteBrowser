import { hydrateIcons } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';

hydrateIcons();
followTheme();

const target = new URLSearchParams(location.search).get('url') ?? '';
let host = target;
try {
  host = new URL(target).host;
} catch {
  /* keep raw */
}
document.getElementById('host')!.textContent = host;
document.getElementById('back')!.addEventListener('click', () => {
  if (history.length > 1) history.back();
  else location.href = 'about:blank';
});
document.getElementById('continue')!.addEventListener('click', () => void internal.httpsContinue(target));
