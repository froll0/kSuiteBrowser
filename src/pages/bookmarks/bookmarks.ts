import { h } from '../../renderer/dom';
import { exportBookmarksHtml, parseBookmarksHtml } from '../../shared/bookmark-html';
import { faviconUrl } from '../../shared/top-sites';
import type { Bookmark, BookmarkFolder } from '../../shared/types';
import { hydrateIcons } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { emptyState, iconButton } from '../shared/ui';
import { followTheme } from '../shared/theme';
import { tr } from '../../shared/i18n';

followTheme();

const list = document.getElementById('list')!;
const search = document.getElementById('search') as HTMLInputElement;
const status = document.getElementById('status')!;
const fileInput = document.getElementById('import-file') as HTMLInputElement;

let bookmarks: Bookmark[] = [];
let editing: string | null = null;
let adding = false;

const FOLDERS: Array<{ id: BookmarkFolder; label: string }> = [
  { id: 'bar', label: tr('Barra dei preferiti') },
  { id: 'other', label: tr('Altri preferiti') },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function say(text: string): void {
  status.textContent = text;
}

function editor(initial: { title: string; url: string; folder: BookmarkFolder }, onSave: (v: typeof initial) => Promise<void>): HTMLElement {
  const title = h('input', { type: 'text', value: initial.title, placeholder: tr('Nome'), 'aria-label': tr('Nome') });
  const url = h('input', { type: 'url', value: initial.url, placeholder: 'https://…', 'aria-label': tr('Indirizzo'), required: true });
  const folder = h('select', { 'aria-label': tr('Cartella') }, ...FOLDERS.map((f) => h('option', { value: f.id, selected: f.id === initial.folder }, f.label)));
  const form = h('form', { class: 'edit' }, title, url, folder, h('button', { class: 'primary', type: 'submit' }, tr('Salva')),
    h('button', { type: 'button', onclick: () => { editing = null; adding = false; render(); } }, tr('Annulla')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const parsed = new URL(url.value.trim());
      if (!['http:', 'https:', 'file:', 'velo:'].includes(parsed.protocol)) throw new Error();
    } catch {
      say(tr('Indirizzo non valido.'));
      url.focus();
      return;
    }
    await onSave({ title: title.value, url: url.value.trim(), folder: folder.value as BookmarkFolder });
    editing = null;
    adding = false;
  });
  queueMicrotask(() => title.focus());
  return h('div', { class: 'entry' }, form);
}

function row(b: Bookmark, index: number, count: number, filtered: boolean): HTMLElement {
  if (editing === b.id) {
    return editor(b, (v) => internal.bookmarks.update(b.id, v));
  }
  const host = hostOf(b.url);
  return h(
    'div',
    { class: 'entry' },
    /^https?:/i.test(b.url) ? h('img', { class: 'site-icon', src: faviconUrl(b.url), alt: '' }) : h('span', { class: 'letter', 'aria-hidden': 'true' }, host.slice(0, 1).toUpperCase()),
    h('div', { class: 'main' }, h('a', { href: b.url, title: b.url }, b.title), h('span', { class: 'host' }, host)),
    h('div', { class: 'actions' },
      filtered ? null : iconButton('arrowUp', tr('Sposta su {0}', b.title), () => void internal.bookmarks.shift(b.id, -1), { disabled: index === 0 }),
      filtered ? null : iconButton('arrowDown', tr('Sposta giù {0}', b.title), () => void internal.bookmarks.shift(b.id, 1), { disabled: index === count - 1 }),
      iconButton('pencil', tr('Modifica {0}', b.title), () => { editing = b.id; render(); }),
      iconButton('trash', tr('Elimina {0}', b.title), async () => { await internal.bookmarks.remove(b.id); say(`“${b.title}” eliminato.`); }),
    ),
  );
}

function render(): void {
  const q = search.value.trim().toLowerCase();
  const matches = (b: Bookmark) => !q || `${b.title} ${b.url}`.toLowerCase().includes(q);
  list.replaceChildren(
    ...(adding ? [h('section', { class: 'group' }, h('h2', {}, tr('Nuovo preferito')), editor({ title: '', url: 'https://', folder: 'bar' }, async (v) => {
      await internal.bookmarks.add(v);
      say(tr('Preferito aggiunto.'));
    }))] : []),
    ...FOLDERS.map((f) => {
      const items = bookmarks.filter((b) => b.folder === f.id && matches(b));
      return h('section', { class: 'group' },
        h('h2', {}, `${f.label} (${items.length})`),
        ...(items.length ? items.map((b, i) => row(b, i, items.length, Boolean(q))) : [emptyState(q ? 'search' : 'star', q ? tr('Nessun risultato.') : tr('Nessun preferito in questa cartella.'))]),
      );
    }),
  );
}

internal.bookmarks.onChange((next) => {
  bookmarks = next;
  render();
});
search.addEventListener('input', render);
document.getElementById('add')!.addEventListener('click', () => {
  adding = true;
  editing = null;
  render();
});
document.getElementById('import')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const items = parseBookmarksHtml(await file.text());
  if (items.length === 0) return say(tr('Nessun preferito trovato nel file.'));
  const added = await internal.bookmarks.import(items);
  say(tr('Importati {0} preferiti{1}.', added, added < items.length ? ` (${items.length - added} già presenti)` : ''));
});
document.getElementById('export')!.addEventListener('click', () => {
  const blob = new Blob([exportBookmarksHtml(bookmarks)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: tr('preferiti-velo-{0}.html', new Date().toISOString().slice(0, 10)) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  say(tr('File esportato nella cartella dei download.'));
});

hydrateIcons();
void internal.bookmarks.list().then((b) => {
  bookmarks = b;
  render();
});
