import { h } from '../../renderer/dom';
import { exportBookmarksHtml, parseBookmarksHtml } from '../../shared/bookmark-html';
import type { Bookmark, BookmarkFolder } from '../../shared/types';
import { internal } from '../shared/bridge';

const list = document.getElementById('list')!;
const search = document.getElementById('search') as HTMLInputElement;
const status = document.getElementById('status')!;
const fileInput = document.getElementById('import-file') as HTMLInputElement;

let bookmarks: Bookmark[] = [];
let editing: string | null = null;
let adding = false;

const FOLDERS: Array<{ id: BookmarkFolder; label: string }> = [
  { id: 'bar', label: 'Barra dei preferiti' },
  { id: 'other', label: 'Altri preferiti' },
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
  const title = h('input', { type: 'text', value: initial.title, placeholder: 'Nome', 'aria-label': 'Nome' });
  const url = h('input', { type: 'url', value: initial.url, placeholder: 'https://…', 'aria-label': 'Indirizzo', required: true });
  const folder = h('select', { 'aria-label': 'Cartella' }, ...FOLDERS.map((f) => h('option', { value: f.id, selected: f.id === initial.folder }, f.label)));
  const form = h('form', { class: 'edit' }, title, url, folder, h('button', { class: 'primary', type: 'submit' }, 'Salva'),
    h('button', { type: 'button', onclick: () => { editing = null; adding = false; render(); } }, 'Annulla'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const parsed = new URL(url.value.trim());
      if (!['http:', 'https:', 'file:', 'ksuite:'].includes(parsed.protocol)) throw new Error();
    } catch {
      say('Indirizzo non valido.');
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
    h('span', { class: 'letter', 'aria-hidden': 'true' }, host.slice(0, 1).toUpperCase()),
    h('div', { class: 'main' }, h('a', { href: b.url, title: b.url }, b.title), h('span', { class: 'host' }, host)),
    h('div', { class: 'actions' },
      filtered ? null : h('button', { class: 'icon', title: 'Sposta su', 'aria-label': `Sposta su ${b.title}`, disabled: index === 0, onclick: () => void internal.bookmarks.shift(b.id, -1) }, '↑'),
      filtered ? null : h('button', { class: 'icon', title: 'Sposta giù', 'aria-label': `Sposta giù ${b.title}`, disabled: index === count - 1, onclick: () => void internal.bookmarks.shift(b.id, 1) }, '↓'),
      h('button', { class: 'icon', title: 'Modifica', 'aria-label': `Modifica ${b.title}`, onclick: () => { editing = b.id; render(); } }, '✎'),
      h('button', { class: 'icon', title: 'Elimina', 'aria-label': `Elimina ${b.title}`, onclick: async () => { await internal.bookmarks.remove(b.id); say(`“${b.title}” eliminato.`); } }, '✕'),
    ),
  );
}

function render(): void {
  const q = search.value.trim().toLowerCase();
  const matches = (b: Bookmark) => !q || `${b.title} ${b.url}`.toLowerCase().includes(q);
  list.replaceChildren(
    ...(adding ? [h('section', { class: 'group' }, h('h2', {}, 'Nuovo preferito'), editor({ title: '', url: 'https://', folder: 'bar' }, async (v) => {
      await internal.bookmarks.add(v);
      say('Preferito aggiunto.');
    }))] : []),
    ...FOLDERS.map((f) => {
      const items = bookmarks.filter((b) => b.folder === f.id && matches(b));
      return h('section', { class: 'group' },
        h('h2', {}, `${f.label} (${items.length})`),
        ...(items.length ? items.map((b, i) => row(b, i, items.length, Boolean(q))) : [h('p', { class: 'empty' }, q ? 'Nessun risultato.' : 'Nessun preferito.')]),
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
  if (items.length === 0) return say('Nessun preferito trovato nel file.');
  const added = await internal.bookmarks.import(items);
  say(`Importati ${added} preferiti${added < items.length ? ` (${items.length - added} già presenti)` : ''}.`);
});
document.getElementById('export')!.addEventListener('click', () => {
  const blob = new Blob([exportBookmarksHtml(bookmarks)], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `preferiti-ksuite-${new Date().toISOString().slice(0, 10)}.html` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  say('File esportato nella cartella dei download.');
});

void internal.bookmarks.list().then((b) => {
  bookmarks = b;
  render();
});
