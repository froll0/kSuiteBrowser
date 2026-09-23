import { h } from '../../renderer/dom';
import { INTERNAL } from '../../shared/ipc';
import { KSUITE_APPS } from '../../shared/ksuite-apps';
import { faviconUrl } from '../../shared/top-sites';
import type { NewTabData } from '../../shared/types';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';

followTheme();

const call = <T>(channel: string, ...args: unknown[]) => window.ksuiteInternal!.invoke(channel, ...args) as Promise<T>;
const COLORS: Record<string, string> = { '#0098ff': 'c0', '#3cb371': 'c1', '#8e44ad': 'c2', '#f06a2c': 'c3', '#e91e63': 'c4', '#5c6bc0': 'c5', '#e53935': 'c6' };

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
  search.placeholder = 'Cerca sul web o scrivi un indirizzo';
  const grid = document.getElementById('top-sites')!;
  grid.hidden = !data.showTopSites || data.topSites.length === 0;
  grid.replaceChildren(
    ...data.topSites.map((site) =>
      h('a', { class: 'tile', href: site.url, title: `${site.title}\n${site.url}` },
        h('span', { class: 'icon' }, h('img', { src: faviconUrl(site.url), alt: '' })),
        h('span', { class: 'name' }, site.title),
        h('button', {
          class: 'remove',
          title: 'Rimuovi',
          'aria-label': `Rimuovi ${site.title} dai siti più visitati`,
          onclick: async (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            await call(INTERNAL.newtabHide, site.url);
            void render();
          },
        }, '✕'),
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

document.getElementById('apps')!.replaceChildren(
  ...KSUITE_APPS.map((app) =>
    h('a', { class: 'app', href: app.url }, h('span', { class: `glyph ${COLORS[app.color] ?? 'c0'}` }, app.glyph), app.name),
  ),
);

internal.onSettings(() => void render());
void render();
