import { h } from '../../renderer/dom';
import { INTERNAL } from '../../shared/ipc';
import { KSUITE_APPS } from '../../shared/ksuite-apps';
import { faviconUrl } from '../../shared/top-sites';
import type { NewTabData } from '../../shared/types';
import { hydrateIcons, icon, logoMark } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';

followTheme();
hydrateIcons();
document.getElementById('logo')!.append(logoMark(44));

const call = <T>(channel: string, ...args: unknown[]) => window.ksuiteInternal!.invoke(channel, ...args) as Promise<T>;

const hour = new Date().getHours();
document.getElementById('greeting')!.textContent = hour < 5 ? 'Buonanotte' : hour < 13 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';

// The search box hands over to the address bar, which has suggestions from history and bookmarks.
const search = document.getElementById('search') as HTMLInputElement;
search.addEventListener('focus', () => {
  search.blur();
  void call(INTERNAL.newtabFocusOmnibox);
});
document.getElementById('search-form')!.addEventListener('submit', (e) => e.preventDefault());

async function render(): Promise<void> {
  const data = await call<NewTabData>(INTERNAL.newtabData);
  document.body.classList.toggle('private', data.isPrivate);
  document.getElementById('private-note')!.hidden = !data.isPrivate;
  if (data.isPrivate) document.getElementById('greeting')!.textContent = 'Finestra privata';
  search.placeholder = 'Cerca sul web o scrivi un indirizzo';
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

internal.onSettings(() => void render());
void render();
