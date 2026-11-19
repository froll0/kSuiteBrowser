import { h } from '../../renderer/dom';
import { exportBookmarksHtml, parseBookmarksHtml } from '../../shared/bookmark-html';
import { faviconUrl } from '../../shared/top-sites';
import type { Bookmark, BookmarkFolder } from '../../shared/types';
import { allFolders, folderCount, folderEntries, folderKey, MAX_FOLDER_DEPTH, parseFolderKey, pathOf } from '../../shared/bookmark-folders';
import { hydrateIcons } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { emptyState, iconButton, withIcon } from '../shared/ui';
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

const ROOTS: Array<{ id: BookmarkFolder; label: string }> = [
  { id: 'bar', label: tr('Barra dei preferiti') },
  { id: 'other', label: tr('Altri preferiti') },
];
const rootLabel = (id: BookmarkFolder) => ROOTS.find((r) => r.id === id)!.label;
const folderLabel = (root: BookmarkFolder, path: string[]) => [rootLabel(root), ...path].join(' › ');
const NEW_FOLDER = '__new__';

let renaming: string | null = null;

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

type Place = { folder: BookmarkFolder; path: string[] };

function editor(initial: { title: string; url: string } & Place, onSave: (v: { title: string; url: string } & Place) => Promise<void>): HTMLElement {
  const title = h('input', { type: 'text', value: initial.title, placeholder: tr('Nome'), 'aria-label': tr('Nome') });
  const url = h('input', { type: 'url', value: initial.url, placeholder: 'https://…', 'aria-label': tr('Indirizzo'), required: true });
  const current = folderKey(initial.folder, initial.path);
  const folder = h('select', { 'aria-label': tr('Cartella') },
    ...allFolders(bookmarks).map((f) => {
      const key = folderKey(f.root, f.path);
      return h('option', { value: key, selected: key === current }, `${'   '.repeat(f.path.length)}${f.path.length ? f.path[f.path.length - 1] : rootLabel(f.root)}`);
    }),
    // A folder that doesn't exist yet (the bookmark being edited may be its last one).
    allFolders(bookmarks).some((f) => folderKey(f.root, f.path) === current) ? null : h('option', { value: current, selected: true }, folderLabel(initial.folder, initial.path)),
    h('option', { value: NEW_FOLDER }, tr('Nuova cartella…')),
  );
  // "New folder": a name, created inside the folder chosen before.
  const newName = h('input', { type: 'text', class: 'new-folder', placeholder: tr('Nome della nuova cartella'), 'aria-label': tr('Nome della nuova cartella'), hidden: true, maxlength: 80 });
  let parent = current;
  folder.addEventListener('change', () => {
    newName.hidden = folder.value !== NEW_FOLDER;
    if (newName.hidden) parent = folder.value;
    else {
      newName.placeholder = tr('Nuova cartella in {0}', (() => { const p = parseFolderKey(parent)!; return folderLabel(p.root, p.path); })());
      newName.focus();
    }
  });
  const form = h('form', { class: 'edit' }, title, url, folder, newName, h('button', { class: 'primary', type: 'submit' }, tr('Salva')),
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
    let place = parseFolderKey(folder.value === NEW_FOLDER ? parent : folder.value) ?? { root: 'bar' as BookmarkFolder, path: [] };
    if (folder.value === NEW_FOLDER) {
      const name = newName.value.trim();
      if (!name) {
        say(tr('Scrivi il nome della nuova cartella.'));
        newName.focus();
        return;
      }
      if (place.path.length >= MAX_FOLDER_DEPTH) {
        say(tr('Troppe cartelle una dentro l’altra.'));
        return;
      }
      place = { root: place.root, path: [...place.path, name] };
    }
    await onSave({ title: title.value, url: url.value.trim(), folder: place.root, path: place.path });
    editing = null;
    adding = false;
  });
  queueMicrotask(() => title.focus());
  return h('div', { class: 'entry' }, form);
}

function row(b: Bookmark, index: number, count: number, depth: number, filtered: boolean): HTMLElement {
  if (editing === b.id) {
    return editor({ title: b.title, url: b.url, folder: b.folder, path: pathOf(b) }, (v) => internal.bookmarks.update(b.id, v));
  }
  const host = hostOf(b.url);
  const entry = h(
    'div',
    { class: 'entry' },
    /^https?:/i.test(b.url) ? h('img', { class: 'site-icon', src: faviconUrl(b.url), alt: '' }) : h('span', { class: 'letter', 'aria-hidden': 'true' }, host.slice(0, 1).toUpperCase()),
    h('div', { class: 'main' }, h('a', { href: b.url, title: b.url }, b.title), h('span', { class: 'host' }, filtered && pathOf(b).length ? `${pathOf(b).join(' › ')} · ${host}` : host)),
    h('div', { class: 'actions' },
      filtered ? null : iconButton('arrowUp', tr('Sposta su {0}', b.title), () => void internal.bookmarks.shift(b.id, -1), { disabled: index === 0 }),
      filtered ? null : iconButton('arrowDown', tr('Sposta giù {0}', b.title), () => void internal.bookmarks.shift(b.id, 1), { disabled: index === count - 1 }),
      iconButton('pencil', tr('Modifica {0}', b.title), () => { editing = b.id; render(); }),
      iconButton('trash', tr('Elimina {0}', b.title), async () => { await internal.bookmarks.remove(b.id); say(tr('“{0}” eliminato.', b.title)); }),
    ),
  );
  entry.style.setProperty('--depth', String(depth));
  return entry;
}

/** A subfolder: a header (rename, delete) and, below, what it holds. */
function folderBlock(root: BookmarkFolder, path: string[], depth: number): HTMLElement[] {
  const name = path[path.length - 1];
  const key = folderKey(root, path);
  const count = folderCount(bookmarks, root, path);
  let header: HTMLElement;
  if (renaming === key) {
    const input = h('input', { type: 'text', value: name, 'aria-label': tr('Nome della cartella'), maxlength: 80 });
    const form = h('form', { class: 'folder-rename' }, input, h('button', { class: 'primary', type: 'submit' }, tr('Salva')),
      h('button', { type: 'button', onclick: () => { renaming = null; render(); } }, tr('Annulla')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      renaming = null;
      if (input.value.trim() && input.value.trim() !== name) await internal.bookmarks.renameFolder(root, path, input.value);
      else render();
    });
    queueMicrotask(() => input.select());
    header = h('div', { class: 'entry folder-head' }, withIcon(h('span', { class: 'folder-icon' }), 'folderOpen', 18), form);
  } else {
    header = h('div', { class: 'entry folder-head' },
      withIcon(h('span', { class: 'folder-icon' }), 'folderOpen', 18),
      h('div', { class: 'main' }, h('strong', {}, name), h('span', { class: 'host' }, count === 1 ? tr('1 preferito') : tr('{0} preferiti', count))),
      h('div', { class: 'actions' },
        iconButton('pencil', tr('Rinomina la cartella {0}', name), () => { renaming = key; render(); }),
        iconButton('trash', tr('Elimina la cartella {0}', name), async () => {
          if (!confirm(tr('Eliminare la cartella “{0}” con i suoi {1} preferiti?', name, count))) return;
          const removed = await internal.bookmarks.removeFolder(root, path);
          say(tr('Cartella “{0}” eliminata ({1} preferiti).', name, removed));
        }),
      ),
    );
  }
  header.style.setProperty('--depth', String(depth));
  return [header, ...level(root, path, depth + 1)];
}

function level(root: BookmarkFolder, path: string[], depth: number): HTMLElement[] {
  const entries = folderEntries(bookmarks, root, path);
  const own = entries.filter((e) => e.kind === 'bookmark');
  return entries.flatMap((e) => (e.kind === 'bookmark' ? [row(e.bookmark, own.indexOf(e), own.length, depth, false)] : folderBlock(root, e.path, depth)));
}

function render(): void {
  const q = search.value.trim().toLowerCase();
  const matches = (b: Bookmark) => !q || `${b.title} ${b.url} ${pathOf(b).join(' ')}`.toLowerCase().includes(q);
  // Nothing saved yet: the empty state offers the same actions as the toolbar.
  document.body.classList.toggle('no-bookmarks', bookmarks.length === 0 && !adding);
  list.replaceChildren(
    ...(adding ? [h('section', { class: 'group' }, h('h2', {}, tr('Nuovo preferito')), editor({ title: '', url: 'https://', folder: 'bar', path: [] }, async (v) => {
      await internal.bookmarks.add(v);
      say(tr('Preferito aggiunto.'));
    }))] : []),
    ...(!q && !adding && bookmarks.length === 0 ? [h('div', { class: 'group' }, emptyState('star', tr('Ancora nessun preferito'),
      tr('Premi la stella nella barra degli indirizzi (o Ctrl+D) per salvare una pagina, oppure porta qui i preferiti del browser che usavi.'),
      withIcon(h('a', { class: 'button primary', href: 'velo://import/' }, tr('Importa da un altro browser')), 'import'),
      withIcon(h('button', { onclick: () => { adding = true; render(); } }, tr('Aggiungi preferito')), 'plus'),
    ))] : ROOTS.map((f) => {
      const count = folderCount(bookmarks, f.id, []);
      if (q) {
        const items = bookmarks.filter((b) => b.folder === f.id && matches(b));
        return h('section', { class: 'group' }, h('h2', {}, `${f.label} (${items.length})`),
          ...(items.length ? items.map((b, i) => row(b, i, items.length, 0, true)) : [h('p', { class: 'folder-empty' }, tr('Nessun risultato.'))]));
      }
      const items = level(f.id, [], 0);
      return h('section', { class: 'group' },
        h('h2', {}, `${f.label} (${count})`),
        ...(items.length ? items : [h('p', { class: 'folder-empty' }, tr('Nessun preferito in questa cartella.'))]),
      );
    })),
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
