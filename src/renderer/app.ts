import { KSUITE_APPS } from '../shared/ksuite-apps';
import { faviconUrl } from '../shared/top-sites';
import type { Bookmark, Settings, Suggestion, TabState } from '../shared/types';
import { ks } from './bridge';
import { h } from './dom';
import { Panel } from './panel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tabstrip = $('tabstrip');
const omnibox = $<HTMLInputElement>('omnibox');
const content = $('content');
const sidebar = $('sidebar');
const toastEl = $('toast');
const backBtn = $<HTMLButtonElement>('btn-back');
const forwardBtn = $<HTMLButtonElement>('btn-forward');
const reloadBtn = $<HTMLButtonElement>('btn-reload');
const shieldBtn = $<HTMLButtonElement>('btn-shield');
const starBtn = $<HTMLButtonElement>('btn-star');
const zoomBtn = $<HTMLButtonElement>('btn-zoom');
const bookmarkItems = $('bookmarks-items');
const findbar = $('findbar');
const findInput = $<HTMLInputElement>('find-input');
const findCount = $('find-count');
const findCase = $<HTMLInputElement>('find-case');

let tabs: TabState[] = [];
let unread: number | null = null;
let currentSettings: Settings | null = null;
let bookmarks: Bookmark[] = [];
let lastActiveId: number | null = null;

const activeTab = () => tabs.find((t) => t.active);

// ---------- Toasts ----------

let toastTimer: number | undefined;
function toast(kind: 'info' | 'success' | 'error', message: string): void {
  toastEl.hidden = false;
  toastEl.className = `toast-${kind}`;
  toastEl.textContent = message;
  toastEl.title = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 8000 : 4000);
}
toastEl.addEventListener('click', () => (toastEl.hidden = true));

// ---------- Panel ----------

const panel = new Panel($('panel-tabs'), $('panel-body'), toast, (count) => {
  unread = count;
  renderSidebar();
});

async function setPanelOpen(open: boolean): Promise<void> {
  document.body.classList.toggle('panel-open', open);
  await ks.settings.set({ panelOpen: open });
  if (open) void panel.render();
  syncBounds();
}

const togglePanel = () => void setPanelOpen(!document.body.classList.contains('panel-open'));

// ---------- Tabs ----------

const TAB_MIME = 'application/x-ksuite-tab';
let windowId = 0;

function tabIcon(t: TabState): HTMLElement {
  if (t.url.startsWith('ksuite://')) return h('span', { class: 'favicon internal', 'aria-hidden': 'true' }, 'k');
  const src = t.favicon ?? (/^https?:/i.test(t.url) ? faviconUrl(t.url) : null);
  if (!src) return h('span', { class: 'favicon placeholder' });
  const img = h('img', { class: 'favicon', src, alt: '' });
  img.addEventListener('error', () => {
    if (/^https?:/i.test(t.url) && img.src !== faviconUrl(t.url)) img.src = faviconUrl(t.url);
    else img.replaceWith(h('span', { class: 'favicon placeholder' }));
  });
  return img;
}

/** Insertion index for a drop at clientX: before the first tab whose middle is to the right. */
function dropIndex(clientX: number): number {
  const els = [...tabstrip.querySelectorAll<HTMLElement>('.tab')];
  const i = els.findIndex((el) => {
    const r = el.getBoundingClientRect();
    return clientX < r.left + r.width / 2;
  });
  return i === -1 ? els.length : i;
}

function clearDropMarks(): void {
  for (const el of tabstrip.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
}

function renderTabs(): void {
  tabstrip.replaceChildren(
    ...tabs.map((t) => {
      const audio = t.audible || t.muted
        ? h('button', {
            class: 'tab-audio',
            title: t.muted ? 'Riattiva audio' : 'Disattiva audio',
            'aria-label': t.muted ? 'Riattiva audio della scheda' : 'Disattiva audio della scheda',
            onclick: (e: Event) => { e.stopPropagation(); void ks.tabs.mute(t.id); },
          }, t.muted ? '🔇' : '🔊')
        : null;
      const el = h(
        'div',
        {
          class: `tab${t.active ? ' active' : ''}${t.loading ? ' loading' : ''}${t.pinned ? ' pinned' : ''}`,
          role: 'tab',
          'aria-selected': String(t.active),
          title: `${t.title}\n${t.url}`,
          draggable: 'true',
          'data-id': String(t.id),
        },
        tabIcon(t),
        t.pinned ? null : h('span', { class: 'tab-title' }, t.title),
        audio,
        t.pinned ? null : h('button', { class: 'tab-close', 'aria-label': 'Chiudi scheda', onclick: (e: Event) => { e.stopPropagation(); void ks.tabs.close(t.id); } }, '×'),
      );
      el.addEventListener('click', () => void ks.tabs.activate(t.id));
      el.addEventListener('auxclick', (e) => {
        if ((e as MouseEvent).button === 1) void ks.tabs.close(t.id);
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        void ks.tabs.menu(t.id);
      });
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData(TAB_MIME, JSON.stringify({ windowId, tabId: t.id }));
        e.dataTransfer!.setData('text/uri-list', t.url);
        e.dataTransfer!.setData('text/plain', t.url);
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', (e) => {
        el.classList.remove('dragging');
        clearDropMarks();
        const dropped = e.dataTransfer!.dropEffect !== 'none';
        if (dropped) return;
        // Released away from the tab strip: move the tab to a new window there.
        const strip = tabstrip.getBoundingClientRect();
        const outside = e.clientY < strip.top - 40 || e.clientY > strip.bottom + 40 || e.clientX < 0 || e.clientX > window.innerWidth;
        if (outside && tabs.length > 1) void ks.tabs.detach(t.id, e.screenX, e.screenY);
      });
      return el;
    }),
    h('button', { class: 'new-tab', title: 'Nuova scheda (Ctrl+T)', 'aria-label': 'Nuova scheda', onclick: () => void ks.tabs.create() }, '+'),
  );
}

tabstrip.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes(TAB_MIME)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  clearDropMarks();
  const els = [...tabstrip.querySelectorAll<HTMLElement>('.tab')];
  const index = dropIndex(e.clientX);
  if (els[index]) els[index].classList.add('drop-before');
  else els[els.length - 1]?.classList.add('drop-after');
});
tabstrip.addEventListener('dragleave', (e) => {
  if (!tabstrip.contains(e.relatedTarget as Node)) clearDropMarks();
});
tabstrip.addEventListener('drop', (e) => {
  const raw = e.dataTransfer?.getData(TAB_MIME);
  clearDropMarks();
  if (!raw) return;
  e.preventDefault();
  const { windowId: from, tabId } = JSON.parse(raw) as { windowId: number; tabId: number };
  let index = dropIndex(e.clientX);
  if (from === windowId) {
    const current = tabs.findIndex((t) => t.id === tabId);
    if (current !== -1 && current < index) index--;
    if (current !== index) void ks.tabs.move(tabId, index);
  } else {
    void ks.tabs.adopt(from, tabId, index);
  }
});

function renderToolbar(): void {
  const tab = activeTab();
  backBtn.disabled = !tab?.canGoBack;
  forwardBtn.disabled = !tab?.canGoForward;
  reloadBtn.innerHTML = tab?.loading ? '&#10005;' : '&#8635;';
  reloadBtn.title = tab?.loading ? 'Interrompi' : 'Ricarica (Ctrl+R)';
  if (document.activeElement !== omnibox) omnibox.value = tab && tab.url !== 'about:blank' && !tab.url.startsWith('ksuite://newtab') ? tab.url : '';
  renderShield(tab);

  const bookmarkable = Boolean(tab && /^(https?|file|ksuite):/i.test(tab.url));
  starBtn.disabled = !bookmarkable;
  starBtn.classList.toggle('on', Boolean(tab?.bookmarked));
  starBtn.textContent = tab?.bookmarked ? '★' : '☆';
  starBtn.title = tab?.bookmarked ? 'Modifica preferito (Ctrl+D)' : 'Aggiungi ai preferiti (Ctrl+D)';

  const defaultZoom = currentSettings?.defaultZoom ?? 100;
  zoomBtn.hidden = !tab || tab.zoom === defaultZoom;
  zoomBtn.textContent = tab ? `${tab.zoom}%` : '';
  const suffix = document.body.classList.contains('private') ? 'kSuite Browser (privata)' : 'kSuite Browser';
  document.title = tab ? `${tab.title} — ${suffix}` : suffix;
}

function renderShield(tab: TabState | undefined): void {
  const web = Boolean(tab && /^https?:/i.test(tab.url));
  shieldBtn.disabled = !web;
  shieldBtn.classList.toggle('off', web && !tab!.protectionActive);
  const count = shieldBtn.querySelector('.count')!;
  count.textContent = web && tab!.blocked > 0 ? (tab!.blocked > 999 ? '999+' : String(tab!.blocked)) : '';
  shieldBtn.title = !web
    ? 'Protezioni'
    : tab!.protectionActive
      ? `Protezione attiva: ${tab!.blocked} richieste bloccate`
      : 'Protezione disattivata per questo sito';
}

function renderSidebar(): void {
  const activeApp = activeTab()?.appId;
  sidebar.replaceChildren(
    ...KSUITE_APPS.map((app) => {
      const button = h(
        'button',
        { class: `app${activeApp === app.id ? ' active' : ''}`, title: app.name, 'aria-label': app.name, onclick: () => void ks.openApp(app.id) },
        h('span', { class: 'glyph' }, app.glyph),
        app.id === 'mail' && unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : String(unread)) : null,
        h('span', { class: 'app-name' }, app.name),
      );
      // Set through CSSOM: the CSP forbids inline style attributes.
      button.style.setProperty('--app-color', app.color);
      return button;
    }),
  );
}

ks.events.onTabs((next) => {
  tabs = next;
  renderTabs();
  renderToolbar();
  renderSidebar();
  const active = activeTab()?.id ?? null;
  if (active !== lastActiveId) {
    lastActiveId = active;
    hideSuggestions();
    if (!findbar.hidden) runFind(false, false, true);
  }
});

// ---------- Address bar suggestions ----------

let suggestions: Suggestion[] = [];
let selected = -1;
let typed = '';
let suggestSeq = 0;

function showSuggestions(): void {
  if (suggestions.length === 0) return hideSuggestions();
  const r = omnibox.getBoundingClientRect();
  void ks.suggest.show(suggestions, { x: r.left, y: r.top, width: r.width, height: r.height }, selected);
  omnibox.setAttribute('aria-expanded', 'true');
}

function hideSuggestions(): void {
  suggestSeq++;
  if (suggestions.length === 0 && omnibox.getAttribute('aria-expanded') !== 'true') return;
  suggestions = [];
  selected = -1;
  omnibox.setAttribute('aria-expanded', 'false');
  void ks.suggest.hide();
}

omnibox.addEventListener('input', async () => {
  typed = omnibox.value;
  const seq = ++suggestSeq;
  const items = await ks.suggest.query(typed);
  if (seq !== suggestSeq || document.activeElement !== omnibox) return;
  suggestions = items;
  selected = items.length ? 0 : -1;
  showSuggestions();
});

omnibox.addEventListener('blur', () => window.setTimeout(hideSuggestions, 200));

// ---------- Toolbar ----------

$('omnibox-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const tab = activeTab();
  const choice = selected >= 0 ? suggestions[selected] : undefined;
  hideSuggestions();
  const value = choice ? choice.url : omnibox.value.trim();
  if (!value) return;
  if (tab) void ks.tabs.navigate(tab.id, value);
  else void ks.tabs.create(value);
  omnibox.blur();
});
omnibox.addEventListener('focus', () => omnibox.select());
omnibox.addEventListener('keydown', (e) => {
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length) {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    selected = (selected + step + suggestions.length) % suggestions.length;
    const item = suggestions[selected];
    omnibox.value = item.kind === 'search' ? typed : item.url;
    showSuggestions();
  } else if (e.key === 'Escape') {
    if (suggestions.length) {
      hideSuggestions();
      omnibox.value = typed;
    } else {
      renderToolbar();
      omnibox.blur();
    }
  }
});

// ---------- Bookmarks ----------

function renderBookmarksBar(): void {
  const bar = bookmarks.filter((b) => b.folder === 'bar');
  if (bar.length === 0) {
    bookmarkItems.replaceChildren(h('span', { class: 'bookmarks-hint' }, 'Premi ☆ nella barra degli indirizzi (o Ctrl+D) per aggiungere qui una pagina.'));
    return;
  }
  bookmarkItems.replaceChildren(
    ...bar.map((b) => {
      let host = '';
      try {
        host = new URL(b.url).hostname.replace(/^www\./, '');
      } catch {
        /* ignore */
      }
      const el = h(
        'button',
        { class: 'bookmark', title: `${b.title}\n${b.url}` },
        /^https?:/i.test(b.url) ? h('img', { class: 'bm-icon', src: faviconUrl(b.url), alt: '' }) : h('span', { class: 'letter' }, (host || b.title || '?').slice(0, 1).toUpperCase()),
        h('span', { class: 'label' }, b.title),
      );
      el.addEventListener('click', () => void ks.bookmarks.open(b.id, 'current'));
      el.addEventListener('auxclick', (e) => {
        if ((e as MouseEvent).button === 1) void ks.bookmarks.open(b.id, 'background');
      });
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        void ks.bookmarks.menu(b.id);
      });
      return el;
    }),
  );
}

ks.events.onBookmarks((list) => {
  bookmarks = list;
  renderBookmarksBar();
});
$('btn-all-bookmarks').addEventListener('click', () => void ks.bookmarks.all());
starBtn.addEventListener('click', () => {
  const t = activeTab();
  if (t) void ks.bookmarks.toggle(t.id);
});
zoomBtn.addEventListener('click', () => {
  const t = activeTab();
  if (t) void ks.zoomReset(t.id);
});

// ---------- Passwords ----------

const infobar = $('infobar');

function hideInfobar(): void {
  infobar.hidden = true;
  infobar.replaceChildren();
}

ks.events.onPasswordPrompt((prompt) => {
  let host = prompt.origin;
  try {
    host = new URL(prompt.origin).host;
  } catch {
    /* keep origin */
  }
  const user = h('input', { type: 'text', value: prompt.username, placeholder: 'Nome utente', 'aria-label': 'Nome utente' });
  const answer = (action: 'save' | 'never' | 'dismiss') => {
    void ks.passwords.answer(prompt.id, action, user.value);
    hideInfobar();
  };
  infobar.replaceChildren(
    h('span', { class: 'key', 'aria-hidden': 'true' }, '🔑'),
    h('span', { class: 'msg' }, prompt.kind === 'update' ? `Aggiornare la password salvata per ${host}?` : `Salvare la password per ${host}?`),
    user,
    h('span', { class: 'spacer' }),
    h('button', { class: 'primary', onclick: () => answer('save') }, prompt.kind === 'update' ? 'Aggiorna' : 'Salva'),
    h('button', { onclick: () => answer('dismiss') }, 'Non ora'),
  );
  if (prompt.kind === 'save') infobar.append(h('button', { onclick: () => answer('never') }, 'Mai per questo sito'));
  infobar.hidden = false;
});

ks.events.onPasswordUnlock(() => {
  const input = h('input', { type: 'password', placeholder: 'Password principale', 'aria-label': 'Password principale', autocomplete: 'off' });
  const error = h('span', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'row' }, input, h('button', { class: 'primary', type: 'submit' }, 'Sblocca'), h('button', { type: 'button', onclick: hideInfobar }, 'Annulla'), error);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await ks.passwords.unlock(input.value);
    if (res.ok) hideInfobar();
    else {
      error.textContent = res.error;
      input.select();
    }
  });
  infobar.replaceChildren(h('span', { class: 'key', 'aria-hidden': 'true' }, '🔒'), h('span', { class: 'msg' }, 'Le password salvate sono bloccate.'), form);
  infobar.hidden = false;
  input.focus();
});

// ---------- Find in page ----------

let lastQuery = '';
let findTabId: number | null = null;

function runFind(next: boolean, backwards: boolean, restart = false): void {
  const t = activeTab();
  if (!t) return;
  if (findTabId !== null && findTabId !== t.id) void ks.find.stop(findTabId);
  findTabId = t.id;
  const text = findInput.value;
  const continuing = next && !restart && text === lastQuery;
  lastQuery = text;
  void ks.find.start(t.id, text, { forward: !backwards, newSearch: !continuing, matchCase: findCase.checked });
}

function openFind(): void {
  findbar.hidden = false;
  findInput.focus();
  findInput.select();
  if (findInput.value) runFind(false, false, true);
}

function closeFind(): void {
  findbar.hidden = true;
  findCount.textContent = '';
  findInput.classList.remove('notfound');
  if (findTabId !== null) void ks.find.stop(findTabId);
  findTabId = null;
  lastQuery = '';
}

findInput.addEventListener('input', () => runFind(false, false, true));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runFind(true, e.shiftKey);
  } else if (e.key === 'Escape') {
    closeFind();
  }
});
findCase.addEventListener('change', () => runFind(false, false, true));
$('find-next').addEventListener('click', () => runFind(true, false));
$('find-prev').addEventListener('click', () => runFind(true, true));
$('find-close').addEventListener('click', closeFind);
ks.events.onFind(openFind);
ks.events.onFindNext(({ backwards }) => {
  if (findbar.hidden) openFind();
  else runFind(true, backwards);
});
ks.events.onFindResult((r) => {
  if (r.tabId !== activeTab()?.id || findbar.hidden) return;
  const empty = !findInput.value;
  findCount.textContent = empty ? '' : r.total ? `${r.active} di ${r.total}` : 'Nessun risultato';
  findInput.classList.toggle('notfound', !empty && r.total === 0);
});

backBtn.addEventListener('click', () => { const t = activeTab(); if (t) void ks.tabs.back(t.id); });
forwardBtn.addEventListener('click', () => { const t = activeTab(); if (t) void ks.tabs.forward(t.id); });
reloadBtn.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  void (t.loading ? ks.tabs.stop(t.id) : ks.tabs.reload(t.id));
});
$('btn-save-pdf').addEventListener('click', async () => {
  const res = await ks.api.savePageToDrive();
  if (!res.ok) toast('error', res.error);
});
$('btn-mail-page').addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  void setPanelOpen(true).then(() => panel.compose({ to: '', subject: t.title, body: `${t.title}\n${t.url}` }));
});
$('btn-panel').addEventListener('click', togglePanel);
shieldBtn.addEventListener('click', () => {
  const t = activeTab();
  if (t) void ks.showShieldMenu(t.id);
});
$('btn-menu').addEventListener('click', () => void ks.showAppMenu());

ks.events.onFocusAddress(() => {
  omnibox.focus();
  omnibox.select();
});
ks.events.onTogglePanel(togglePanel);
let tokenConfigured = false;
ks.events.onSettings(async (settings) => {
  currentSettings = settings;
  document.body.classList.toggle('bookmarks-bar', settings.showBookmarksBar);
  renderToolbar();
  applyTheme(settings.theme);
  applyLayoutSettings(settings.showSidebar);
  const status = await ks.token.status();
  if (status.configured !== tokenConfigured) {
    tokenConfigured = status.configured;
    if (!tokenConfigured) unread = null;
    renderSidebar();
    if (document.body.classList.contains('panel-open')) void panel.render();
  }
});
ks.events.onComposeMail((mail) => void setPanelOpen(true).then(() => panel.compose(mail)));
ks.events.onToast((t) => toast(t.kind, t.message));

// ---------- Layout ----------

/** Explicit theme choice; "system" falls back to the prefers-color-scheme media query. */
function applyTheme(theme: Settings['theme']): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function applyLayoutSettings(showSidebar: boolean): void {
  if (document.body.classList.contains('no-sidebar') === !showSidebar) return;
  document.body.classList.toggle('no-sidebar', !showSidebar);
  syncBounds();
}

/** The page views are native overlays: keep them aligned with the #content placeholder. */
function syncBounds(): void {
  const r = content.getBoundingClientRect();
  void ks.setContentBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(syncBounds).observe(content);
window.addEventListener('resize', syncBounds);

// ---------- Boot ----------

async function boot(): Promise<void> {
  const [settings, status, initialTabs, info, bookmarkList] = await Promise.all([
    ks.settings.get(), ks.token.status(), ks.tabs.list(), ks.windowInfo(), ks.bookmarks.list(),
  ]);
  tabs = initialTabs;
  windowId = info.windowId;
  currentSettings = settings;
  bookmarks = bookmarkList;
  document.body.classList.toggle('bookmarks-bar', settings.showBookmarksBar);
  renderBookmarksBar();
  tokenConfigured = status.configured;
  document.body.classList.toggle('private', info.isPrivate);
  document.body.classList.toggle('no-sidebar', !settings.showSidebar);
  applyTheme(settings.theme);
  renderTabs();
  renderToolbar();
  renderSidebar();
  document.body.classList.toggle('panel-open', settings.panelOpen || !status.configured);
  panel.show('home');
  syncBounds();
}

void boot();
