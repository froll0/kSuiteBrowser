import { h } from '../../renderer/dom';
import { faviconUrl } from '../../shared/top-sites';
import type { HistoryVisit } from '../../shared/types';
import { hydrateIcons } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { emptyState, iconButton } from '../shared/ui';
import { followTheme } from '../shared/theme';

followTheme();

const list = document.getElementById('list')!;
const search = document.getElementById('search') as HTMLInputElement;
const more = document.getElementById('more') as HTMLButtonElement;
const status = document.getElementById('status')!;
const PAGE = 300;

let visits: HistoryVisit[] = [];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function dayLabel(time: number): string {
  const date = new Date(time);
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
  const full = date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (date.toDateString() === today.toDateString()) return `Oggi — ${full}`;
  if (date.toDateString() === yesterday.toDateString()) return `Ieri — ${full}`;
  return full.charAt(0).toUpperCase() + full.slice(1);
}

function entry(v: HistoryVisit): HTMLElement {
  const host = hostOf(v.url);
  return h(
    'div',
    { class: 'entry' },
    h('span', { class: 'time' }, new Date(v.visitedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })),
    h('img', { class: 'site-icon', src: faviconUrl(v.url), alt: '' }),
    h('div', { class: 'main' }, h('a', { href: v.url, title: v.url }, v.title || v.url), h('span', { class: 'host' }, host)),
    h('div', { class: 'actions' },
      iconButton('close', `Rimuovi ${v.title || v.url} dalla cronologia`, async () => {
        await internal.history.remove([v.id]);
        visits = visits.filter((x) => x.id !== v.id);
        render();
      }),
    ),
  );
}

function render(): void {
  if (visits.length === 0) {
    list.replaceChildren(h('div', { class: 'group' }, emptyState(search.value ? 'search' : 'history', search.value ? 'Nessuna pagina trovata.' : 'La cronologia è vuota.')));
    return;
  }
  const groups = new Map<string, HistoryVisit[]>();
  for (const v of visits) {
    const key = new Date(v.visitedAt).toDateString();
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  list.replaceChildren(
    ...[...groups.values()].map((items) => h('section', { class: 'group' }, h('h2', {}, dayLabel(items[0].visitedAt)), ...items.map(entry))),
  );
}

async function load(append = false): Promise<void> {
  const before = append && visits.length ? visits[visits.length - 1].visitedAt : undefined;
  const page = await internal.history.search(search.value, before);
  visits = append ? [...visits, ...page] : page;
  more.hidden = page.length < PAGE;
  render();
}

let timer: number | undefined;
search.addEventListener('input', () => {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void load(), 150);
});
more.addEventListener('click', () => void load(true));
document.getElementById('clear')!.addEventListener('click', async () => {
  const select = document.getElementById('range') as HTMLSelectElement;
  const span = Number(select.value);
  const label = select.selectedOptions[0].textContent?.toLowerCase() ?? '';
  if (!confirm(`Cancellare la cronologia (${label})?`)) return;
  await internal.history.clearSince(span === 0 ? 0 : Date.now() - span);
  status.textContent = 'Cronologia cancellata.';
  void load();
});

hydrateIcons();
void load();
search.focus();
