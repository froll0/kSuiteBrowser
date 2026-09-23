import type { Suggestion } from '../shared/types';

interface SuggestBridge {
  onItems(fn: (data: { items: Suggestion[]; selected: number; theme: string }) => void): void;
  choose(index: number): void;
}

const bridge = (window as unknown as { suggest: SuggestBridge }).suggest;
const list = document.getElementById('list')!;
const ICONS: Record<Suggestion['kind'], string> = { search: '🔍', url: '🌐', history: '🕘', bookmark: '★' };

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
      let icon: HTMLElement;
      if (item.kind === 'history' || item.kind === 'bookmark') {
        icon = document.createElement('img');
        icon.className = 'icon';
        (icon as HTMLImageElement).src = `ksuite://favicon/?url=${encodeURIComponent(item.url)}`;
        (icon as HTMLImageElement).alt = '';
      } else {
        icon = document.createElement('span');
        icon.className = 'icon';
        icon.textContent = ICONS[item.kind];
      }
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = item.title;
      li.append(icon, title);
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
