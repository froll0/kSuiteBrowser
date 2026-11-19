import { h } from '../../renderer/dom';
import { INTERNAL } from '../../shared/ipc';
import { INFOMANIAK_APPS } from '../../shared/infomaniak-apps';
import { faviconUrl, letterColor } from '../../shared/top-sites';
import { MAX_NEWTAB_SHORTCUTS } from '../../shared/settings-schema';
import type { NewTabData, Settings, Suggestion, TopSite } from '../../shared/types';
import { hydrateIcons, icon, logoMark } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { followTheme, refreshTheme } from '../shared/theme';
import { tr } from '../../shared/i18n';

followTheme();
hydrateIcons();
document.getElementById('logo')!.append(logoMark(44));

const call = <T>(channel: string, ...args: unknown[]) => window.veloInternal!.invoke(channel, ...args) as Promise<T>;

const hour = new Date().getHours();
document.getElementById('greeting')!.textContent = hour < 5 ? tr('Buonanotte') : hour < 13 ? tr('Buongiorno') : hour < 18 ? tr('Buon pomeriggio') : tr('Buonasera');

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
  if (data.isPrivate) document.getElementById('greeting')!.textContent = tr('Finestra privata');
  search.placeholder = tr('Cerca sul web o scrivi un indirizzo');
  if (document.activeElement === document.body) search.focus();
  const grid = document.getElementById('top-sites')!;
  grid.hidden = !data.showTopSites || (data.isPrivate && data.topSites.length === 0);
  const tiles = data.topSites.map((site) =>
    h('a', { class: site.pinned ? 'tile pinned' : 'tile', href: site.url, title: `${site.title}\n${site.url}` },
      h('span', { class: 'icon' }, siteIcon(site.url)),
      h('span', { class: 'name' }, site.title),
      h('span', { class: 'tile-actions' }, editButton(site), removeButton(site)),
    ),
  );
  if (!data.isPrivate && data.topSites.filter((s) => s.pinned).length < MAX_NEWTAB_SHORTCUTS && data.topSites.length < 8) {
    const add = h('button', { class: 'tile add', type: 'button', onclick: () => openShortcutDialog(null) });
    add.append(h('span', { class: 'icon' }, icon('plus', 22)), h('span', { class: 'name' }, tr('Aggiungi')));
    tiles.push(add as unknown as HTMLAnchorElement);
  }
  grid.replaceChildren(...tiles);
  const recent = document.getElementById('recent')!;
  recent.hidden = data.closed.length === 0;
  document.getElementById('recent-list')!.replaceChildren(
    ...data.closed.map((tab) => {
      const button = h('button', { type: 'button', title: tab.url, onclick: async () => call(INTERNAL.newtabReopen, tab.index) });
      button.append(h('img', { class: 'favicon', src: faviconUrl(tab.url), alt: '' }), h('span', { class: 'title' }, tab.title), h('span', { class: 'host' }, hostOf(tab.url)));
      return h('li', {}, button);
    }),
  );
  // The apps belong to the optional Infomaniak account.
  document.querySelector<HTMLElement>('section[aria-labelledby="apps-title"]')!.classList.toggle('no-account', !data.cloud);
  const restore = document.getElementById('restore')!;
  restore.hidden = data.hiddenCount === 0 || !data.showTopSites;
}

document.getElementById('restore-btn')!.addEventListener('click', async () => {
  await call(INTERNAL.newtabRestore);
  void render();
});

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The favicon, or the first letter of the site while it loads or when there is none. */
function siteIcon(url: string): HTMLElement {
  const host = hostOf(url);
  const letter = h('span', { class: 'letter' }, (host[0] ?? '?').toUpperCase());
  // Through CSSOM: the page's CSP doesn't allow style attributes.
  letter.style.background = letterColor(host);
  const img = h('img', { src: faviconUrl(url), alt: '' }) as HTMLImageElement;
  img.addEventListener('load', () => letter.replaceWith(img));
  return letter;
}

function tileButton(label: string, glyph: 'close' | 'pencil', onclick: () => void): HTMLButtonElement {
  const button = h('button', {
    type: 'button',
    title: label,
    'aria-label': label,
    onclick: (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      onclick();
    },
  });
  button.append(icon(glyph, 13));
  return button;
}

function removeButton(site: TopSite): HTMLButtonElement {
  return tileButton(site.pinned ? tr('Rimuovi la scorciatoia {0}', site.title) : tr('Rimuovi {0} dai siti più visitati', site.title), 'close', async () => {
    await call(INTERNAL.newtabHide, site.url);
    void render();
  });
}

function editButton(site: TopSite): HTMLButtonElement {
  return tileButton(tr('Modifica {0}', site.title), 'pencil', () => openShortcutDialog(site));
}

// ---------- Shortcut dialog ----------

const dialog = document.getElementById('shortcut-dialog') as HTMLDialogElement;
const nameField = document.getElementById('shortcut-name') as HTMLInputElement;
const urlField = document.getElementById('shortcut-url') as HTMLInputElement;
const errorText = document.getElementById('shortcut-error')!;
let editing: TopSite | null = null;

function openShortcutDialog(site: TopSite | null): void {
  editing = site;
  document.getElementById('shortcut-title')!.textContent = site ? tr('Modifica la scorciatoia') : tr('Aggiungi una scorciatoia');
  nameField.value = site?.title ?? '';
  urlField.value = site?.url ?? '';
  errorText.textContent = '';
  dialog.showModal();
  (site ? nameField : urlField).focus();
}

document.getElementById('shortcut-cancel')!.addEventListener('click', () => dialog.close());
document.getElementById('shortcut-form')!.addEventListener('submit', async (e) => {
  e.preventDefault();
  const result = await call<{ ok: boolean; full?: boolean }>(INTERNAL.newtabSaveShortcut, editing?.url ?? null, { url: urlField.value, title: nameField.value });
  if (!result.ok) {
    errorText.textContent = result.full ? tr('Hai già il numero massimo di scorciatoie.') : tr('Scrivi un indirizzo web valido, ad esempio example.com.');
    return;
  }
  dialog.close();
  void render();
});

// Recently closed tabs change while the page is in the background.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void render();
});

document.getElementById('apps')!.replaceChildren(
  ...INFOMANIAK_APPS.map((app) => {
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
