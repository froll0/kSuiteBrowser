import type { Suggestion } from '../shared/types';
import { icon } from './icons';

interface SuggestBridge {
  onItems(fn: (data: { items: Suggestion[]; selected: number; theme: string }) => void): void;
  choose(index: number): void;
}

const bridge = (window as unknown as { suggest: SuggestBridge }).suggest;
const list = document.getElementById('list')!;

bridge.onItems(({ items, selected, theme }) => {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  if (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.dataset.theme = 'dark';

  list.replaceChildren(
    ...items.map((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(i === selected));
      if (i === selected) li.className = 'selected';
      let el: HTMLElement;
      if (item.kind === 'history' || item.kind === 'bookmark') {
        el = document.createElement('img');
        el.className = 'icon';
        (el as HTMLImageElement).src = `ksuite://favicon/?url=${encodeURIComponent(item.url)}`;
        (el as HTMLImageElement).alt = '';
      } else {
        el = document.createElement('span');
        el.className = 'icon';
        el.append(icon(item.kind === 'search' ? 'search' : 'globe', 16));
      }
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = item.title;
      li.append(el, title);
      if (item.kind === 'bookmark') {
        const star = document.createElement('span');
        star.className = 'kind';
        star.append(icon('star', 13));
        li.append(star);
      }
      if (item.kind === 'history' || item.kind === 'bookmark') {
        const url = document.createElement('span');
        url.className = 'url';
        url.textContent = `— ${item.url}`;
        li.append(url);
      }
      // mousedown, not click: the address bar loses focus (and hides this list) before mouseup.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        bridge.choose(i);
      });
      return li;
    }),
  );
});
