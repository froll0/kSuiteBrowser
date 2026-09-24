import { h } from '../../renderer/dom';
import { INTERNAL } from '../../shared/ipc';
import { KSUITE_APPS } from '../../shared/ksuite-apps';
import { faviconUrl } from '../../shared/top-sites';
import type { NewTabData, Settings, Suggestion } from '../../shared/types';
import { hydrateIcons, icon, logoMark } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { followTheme, refreshTheme } from '../shared/theme';

followTheme();
hydrateIcons();
document.getElementById('logo')!.append(logoMark(44));

const call = <T>(channel: string, ...args: unknown[]) => window.ksuiteInternal!.invoke(channel, ...args) as Promise<T>;

const hour = new Date().getHours();
document.getElementById('greeting')!.textContent = hour < 5 ? 'Buonanotte' : hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';

// ---------- Search box ----------
// A real search field: suggestions from bookmarks and history come from the browser, the first one is
// what Enter does (open the address or search with the chosen engine).

const search = document.getElementById('search') as HTMLInputElement;
const list = document.getElementById('suggestions') as HTMLUListElement;
let items: Suggestion[] = [];
let selected = 0;
let seq = 0;

function renderSuggestions(): void {
  list.hidden = items.length === 0;
  search.setAttribute('aria-expanded', String(!list.hidden));
  list.replaceChildren(
    ...items.map((item, i) => {
      const li = h('li', { role: 'option', id: `s${i}`, 'aria-selected': String(i === selected), class: i === selected ? 'selected' : '' });
      if (item.kind === 'history' || item.kind === 'bookmark') li.append(h('img', { class: 'icon', src: faviconUrl(item.url), alt: '' }));
      else li.append(icon(item.kind === 'search' ? 'search' : 'globe', 16, 'icon'));
      li.append(h('span', { class: 'title' }, item.title));
      if (item.kind === 'bookmark') li.append(icon('star', 13, 'kind'));
      if (item.kind === 'history' || item.kind === 'bookmark') li.append(h('span', { class: 'url' }, item.url));
      // mousedown: runs before the field loses focus and the list closes.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        go(item.url);
      });
      return li;
    }),
  );
  if (!list.hidden) search.setAttribute('aria-activedescendant', `s${selected}`);
  else search.removeAttribute('aria-activedescendant');
}

function go(url: string): void {
  items = [];
  renderSuggestions();
  location.href = url;
}

search.addEventListener('input', async () => {
  const current = ++seq;
  const result = await call<Suggestion[]>(INTERNAL.newtabSuggest, search.value);
  if (current !== seq) return;
  items = result;
  selected = 0;
  renderSuggestions();
});
search.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length) {
    e.preventDefault();
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    renderSuggestions();
  } else if (e.key === 'Escape') {
    items = [];
    renderSuggestions();
  }
});
search.addEventListener('blur', () => {
  items = [];
  renderSuggestions();
});
document.getElementById('search-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = search.value.trim();
  if (!text) return;
  const choice = items[selected] ?? (await call<Suggestion[]>(INTERNAL.newtabSuggest, text))[0];
  if (choice) go(choice.url);
});

async function render(): Promise<void> {
  const data = await call<NewTabData>(INTERNAL.newtabData);
  if (document.body.classList.contains('private') !== data.isPrivate) {
    document.body.classList.toggle('private', data.isPrivate);
    refreshTheme();
  }
  document.getElementById('private-note')!.hidden = !data.isPrivate;
  if (data.isPrivate) document.getElementById('greeting')!.textContent = 'Finestra privata';
  search.placeholder = 'Cerca sul web o scrivi un indirizzo';
  if (document.activeElement === document.body) search.focus();
  const grid = document.getElementById('top-sites')!;
  grid.hidden = !data.showTopSites || data.topSites.length === 0;
  grid.replaceChildren(
    ...data.topSites.map((site) =>
      h('a', { class: 'tile', href: site.url, title: `${site.title}\n${site.url}` },
        h('span', { class: 'icon' }, h('img', { src: faviconUrl(site.url), alt: '' })),
        h('span', { class: 'name' }, site.title),
        removeButton(site),
      ),
    ),
  );
  const restore = document.getElementById('restore')!;
  restore.hidden = data.hiddenCount === 0 || !data.showTopSites;
}

document.getElementById('restore-btn')!.addEventListener('click', async () => {
  await call(INTERNAL.newtabRestore);
  void render();
});

function removeButton(site: { url: string; title: string }): HTMLButtonElement {
  const button = h('button', {
    class: 'remove',
    title: 'Rimuovi',
    'aria-label': `Rimuovi ${site.title} dai siti più visitati`,
    onclick: async (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      await call(INTERNAL.newtabHide, site.url);
      void render();
    },
  });
  button.append(icon('close', 13));
  return button;
}

document.getElementById('apps')!.replaceChildren(
  ...KSUITE_APPS.map((app) => {
    const tile = h('span', { class: `glyph app-${app.id}` });
    tile.append(icon(app.icon, 20));
    return h('a', { class: 'app', href: app.url }, tile, app.name);
  }),
);

/** Background and blocks chosen in Settings › Aspetto. */
function applyLayout(settings: Settings): void {
  document.body.dataset.background = settings.newTabBackground;
  document.querySelector<HTMLElement>('.brand h1')!.hidden = !settings.newTabShowGreeting;
  document.querySelector<HTMLElement>('section[aria-labelledby="apps-title"]')!.hidden = !settings.newTabShowApps;
}

internal.onSettings((settings) => {
  applyLayout(settings);
  void render();
});
void internal.settings().then(applyLayout);
void render();
