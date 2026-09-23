import { internal } from '../shared/bridge';

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
