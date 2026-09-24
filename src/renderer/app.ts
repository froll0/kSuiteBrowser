import { KSUITE_APPS } from '../shared/ksuite-apps';
import { faviconUrl } from '../shared/top-sites';
import { inlineCompletion } from '../shared/suggest';
import type { Bookmark, Settings, Suggestion, TabState } from '../shared/types';
import { ks } from './bridge';
import { h } from './dom';
import { hydrateIcons, icon, logoMark, type IconName } from './icons';
import { Panel } from './panel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tabstrip = $('tabstrip');
const omnibox = $<HTMLInputElement>('omnibox');
const content = $('content');
const sidebarApps = $('sidebar-apps');
const siteInfo = $<HTMLButtonElement>('site-info');
const downloadsBtn = $<HTMLButtonElement>('btn-downloads');
const toastEl = $('toast');
const backBtn = $<HTMLButtonElement>('btn-back');
const forwardBtn = $<HTMLButtonElement>('btn-forward');
const reloadBtn = $<HTMLButtonElement>('btn-reload');
const shieldBtn = $<HTMLButtonElement>('btn-shield');
const starBtn = $<HTMLButtonElement>('btn-star');
const readerBtn = $<HTMLButtonElement>('btn-reader');
const mediaBtn = $<HTMLButtonElement>('btn-media');
const zoomBtn = $<HTMLButtonElement>('btn-zoom');
const bookmarkItems = $('bookmarks-items');
const findbar = $('findbar');
const findInput = $<HTMLInputElement>('find-input');
const findCount = $('find-count');
const findCase = $<HTMLInputElement>('find-case');

hydrateIcons();

let tabs: TabState[] = [];
let unread: number | null = null;
let currentSettings: Settings | null = null;
let bookmarks: Bookmark[] = [];
let lastActiveId: number | null = null;

const activeTab = () => tabs.find((t) => t.active);

// ---------- Toasts ----------

let toastTimer: number | undefined;
const TOAST_ICONS: Record<'info' | 'success' | 'error', IconName> = { info: 'info', success: 'check', error: 'alert' };
function toast(kind: 'info' | 'success' | 'error', message: string): void {
  toastEl.hidden = false;
  toastEl.className = `toast-${kind}`;
  toastEl.replaceChildren(icon(TOAST_ICONS[kind], 16), h('span', {}, message));
  toastEl.title = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 8000 : 4000);
}
toastEl.addEventListener('click', () => (toastEl.hidden = true));

// ---------- Panel ----------

const panel = new Panel($('panel-tabs'), $('panel-body'), toast, (count) => {
  unread = count;
  renderSidebar();
}, () => activeTab());

async function setPanelOpen(open: boolean): Promise<void> {
  document.body.classList.toggle('panel-open', open);
  await ks.settings.set({ panelOpen: open });
  if (open) void panel.render();
  syncBounds();
}

const togglePanel = () => void setPanelOpen(!document.body.classList.contains('panel-open'));

// The main process checks the inbox every few minutes, even with the panel closed.
ks.events.onUnread((count) => {
  unread = count;
  renderSidebar();
});

// ---------- Tabs ----------

const TAB_MIME = 'application/x-ksuite-tab';
let windowId = 0;

function placeholderIcon(): HTMLElement {
  const span = h('span', { class: 'favicon placeholder' });
  span.append(icon('globe', 16));
  return span;
}

function tabIcon(t: TabState): Element {
  if (t.loading) return h('span', { class: 'spinner', role: 'progressbar', 'aria-label': 'Caricamento' });
  if (t.url.startsWith('ksuite://')) {
    const span = h('span', { class: 'favicon internal' });
    span.append(logoMark(16));
    return span;
  }
  const src = t.favicon ?? (/^https?:/i.test(t.url) ? faviconUrl(t.url) : null);
  if (!src) return placeholderIcon();
  const img = h('img', { class: 'favicon', src, alt: '' });
  img.addEventListener('error', () => {
    if (/^https?:/i.test(t.url) && img.src !== faviconUrl(t.url)) img.src = faviconUrl(t.url);
    else img.replaceWith(placeholderIcon());
  });
  return img;
}

function iconButton(name: IconName, attrs: Record<string, string | EventListener>, size = 14): HTMLButtonElement {
  const button = h('button', attrs);
  button.append(icon(name, size));
  return button;
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

// ---------- Tab hover card ----------

let hoverTimer: number | undefined;
let hoverShown = false;

/** Shows the card after a short rest on a tab; moving to the next tab while it's up updates it at once. */
function hoverTab(id: number, el: HTMLElement): void {
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (!el.isConnected || el.classList.contains('dragging')) return;
    hoverShown = true;
    void ks.tabs.hover(id, { x: r.left, y: r.top, width: r.width, height: r.height });
  }, hoverShown ? 0 : 650);
}

function unhoverTab(): void {
  window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(hideHoverCard, 100);
}

function hideHoverCard(): void {
  window.clearTimeout(hoverTimer);
  if (!hoverShown) return;
  hoverShown = false;
  void ks.tabs.hover(null);
}

window.addEventListener('blur', hideHoverCard);

function renderTabs(): void {
  tabstrip.replaceChildren(
    ...tabs.map((t) => {
      const audio = t.audible || t.muted
        ? iconButton(t.muted ? 'volumeOff' : 'volume', {
            class: 'tab-audio',
            title: t.muted ? 'Riattiva audio' : 'Disattiva audio',
            'aria-label': t.muted ? 'Riattiva audio della scheda' : 'Disattiva audio della scheda',
            onclick: (e: Event) => { e.stopPropagation(); void ks.tabs.mute(t.id); },
          })
        : null;
      const el = h(
        'div',
        {
          class: `tab${t.active ? ' active' : ''}${t.loading ? ' loading' : ''}${t.pinned ? ' pinned' : ''}${t.sleeping ? ' sleeping' : ''}`,
          role: 'tab',
          'aria-selected': String(t.active),
          title: `${t.title}\n${t.url}${t.sleeping ? '\nIn pausa per risparmiare memoria: si ricarica quando la apri' : ''}`,
          draggable: 'true',
          'data-id': String(t.id),
        },
        tabIcon(t),
        t.pinned ? null : h('span', { class: 'tab-title' }, t.title),
        audio,
        t.pinned ? null : iconButton('close', { class: 'tab-close', title: 'Chiudi scheda (Ctrl+W)', 'aria-label': 'Chiudi scheda', onclick: (e: Event) => { e.stopPropagation(); void ks.tabs.close(t.id); } }),
      );
      el.addEventListener('click', () => void ks.tabs.activate(t.id));
      el.addEventListener('mouseenter', () => hoverTab(t.id, el));
      el.addEventListener('mouseleave', unhoverTab);
      el.addEventListener('mousedown', hideHoverCard);
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
    iconButton('plus', { class: 'icon-btn small new-tab', title: 'Nuova scheda (Ctrl+T)', 'aria-label': 'Nuova scheda', onclick: () => void ks.tabs.create() }, 18),
  );
  tabstrip.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// With more tabs than fit, the mouse wheel scrolls the tab strip.
tabstrip.addEventListener('wheel', (e) => {
  if (tabstrip.scrollWidth <= tabstrip.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  e.preventDefault();
  tabstrip.scrollLeft += e.deltaY;
}, { passive: false });

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
  reloadBtn.replaceChildren(icon(tab?.loading ? 'close' : 'reload', 18));
  reloadBtn.title = tab?.loading ? 'Interrompi' : 'Ricarica (Ctrl+R)';
  reloadBtn.setAttribute('aria-label', tab?.loading ? 'Interrompi' : 'Ricarica');
  renderSiteInfo(tab);
  if (document.activeElement !== omnibox) omnibox.value = tab && tab.url !== 'about:blank' && !tab.url.startsWith('ksuite://newtab') ? tab.url : '';
  renderShield(tab);

  const bookmarkable = Boolean(tab && /^(https?|file|ksuite):/i.test(tab.url) && !tab.url.startsWith('ksuite://newtab'));
  // Media controls: shown while a tab of this window plays (or played) sound.
  const media = tabs.filter((t) => t.media || t.audible);
  mediaBtn.hidden = media.length === 0;
  mediaBtn.classList.toggle('playing', media.some((t) => t.audible));
  mediaBtn.title = media.some((t) => t.audible) ? 'Audio in riproduzione: controlli e picture-in-picture' : 'Audio e video delle schede';
  readerBtn.hidden = !tab || !(tab.readerable || tab.reader);
  readerBtn.classList.toggle('on', Boolean(tab?.reader));
  readerBtn.setAttribute('aria-pressed', String(Boolean(tab?.reader)));
  readerBtn.title = tab?.reader ? 'Esci dalla modalità lettura (F9)' : 'Modalità lettura (F9)';
  starBtn.disabled = !bookmarkable;
  starBtn.classList.toggle('on', Boolean(tab?.bookmarked));
  starBtn.title = tab?.bookmarked ? 'Modifica preferito (Ctrl+D)' : 'Aggiungi ai preferiti (Ctrl+D)';

  const defaultZoom = currentSettings?.defaultZoom ?? 100;
  zoomBtn.hidden = !tab || tab.zoom === defaultZoom;
  zoomBtn.textContent = tab ? `${tab.zoom}%` : '';
  const suffix = document.body.classList.contains('private') ? 'kSuite Browser (privata)' : 'kSuite Browser';
  document.title = tab ? `${tab.title} — ${suffix}` : suffix;
}

/** Lock, "not secure" warning or kSuite mark at the start of the address bar. */
function renderSiteInfo(tab: TabState | undefined): void {
  const url = tab?.url ?? '';
  siteInfo.className = 'site-info';
  if (!tab || !url || url.startsWith('ksuite://newtab') || url === 'about:blank') {
    siteInfo.replaceChildren(icon('search', 16));
    siteInfo.title = 'Cerca o inserisci un indirizzo';
  } else if (url.startsWith('ksuite://')) {
    siteInfo.classList.add('internal');
    siteInfo.replaceChildren(logoMark(16), h('span', {}, 'kSuite Browser'));
    siteInfo.title = 'Pagina del browser';
  } else if (url.startsWith('https://')) {
    siteInfo.replaceChildren(icon('lock', 15));
    siteInfo.title = 'Connessione sicura — clic per permessi e dati del sito';
  } else if (url.startsWith('http://')) {
    siteInfo.classList.add('insecure');
    siteInfo.replaceChildren(icon('warning', 15), h('span', {}, 'Non sicuro'));
    siteInfo.title = 'La connessione a questo sito non è cifrata — clic per permessi e dati del sito';
  } else {
    siteInfo.replaceChildren(icon('info', 15));
    siteInfo.title = url;
  }
}

function renderShield(tab: TabState | undefined): void {
  const web = Boolean(tab && /^https?:/i.test(tab.url));
  shieldBtn.disabled = !web;
  const off = web && !tab!.protectionActive;
  shieldBtn.classList.toggle('off', off);
  shieldBtn.querySelector('svg')?.remove();
  shieldBtn.prepend(icon(off ? 'shieldOff' : 'shieldCheck', 18));
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
  sidebarApps.replaceChildren(
    ...KSUITE_APPS.map((app) => {
      const tile = h('span', { class: `tile app-${app.id}` });
      tile.append(icon(app.icon, 19));
      const label = app.id === 'mail' && unread ? `${app.name} — ${unread} non lette` : app.name;
      return h(
        'button',
        { class: `app${activeApp === app.id ? ' active' : ''}`, title: label, 'aria-label': label, onclick: () => void ks.openApp(app.id) },
        tile,
        app.id === 'mail' && unread ? h('span', { class: 'badge', 'aria-hidden': 'true' }, unread > 99 ? '99+' : String(unread)) : null,
      );
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

omnibox.addEventListener('input', async (e) => {
  typed = omnibox.value;
  // Complete inline only while typing at the end, never after deleting.
  const typing = (e as InputEvent).inputType?.startsWith('insert') && omnibox.selectionStart === typed.length;
  const seq = ++suggestSeq;
  const items = await ks.suggest.query(typed);
  if (seq !== suggestSeq || document.activeElement !== omnibox || omnibox.value !== typed) return;
  const completion = typing ? inlineCompletion(typed, items) : null;
  if (completion) {
    omnibox.value = completion.text;
    omnibox.setSelectionRange(typed.length, completion.text.length, 'backward');
    // What Enter opens now is the completed site.
    items.splice(0, 1, { kind: 'url', title: completion.url, url: completion.url });
    const dup = items.findIndex((s, i) => i > 0 && s.url === completion.url);
    if (dup > 0) items.splice(dup, 1);
  }
  suggestions = items;
  selected = items.length ? 0 : -1;
  showSuggestions();
});

omnibox.addEventListener('blur', () => window.setTimeout(hideSuggestions, 200));

// ---------- Toolbar ----------

$('omnibox-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const tab = activeTab();
  const picked = selected;
  const choice = picked >= 0 ? suggestions[picked] : undefined;
  hideSuggestions();
  const typed = omnibox.value.trim();
  // "? question" asks the AI assistant instead of searching (unless a suggestion was picked with the arrows).
  if (picked <= 0 && typed.startsWith('?') && typed.length > 1 && currentSettings?.aiEnabled) {
    renderToolbar();
    omnibox.blur();
    void setPanelOpen(true).then(() => panel.askAi({ question: typed.slice(1).trim() }));
    return;
  }
  if (choice?.kind === 'tab' && choice.tabId !== undefined) {
    omnibox.blur();
    void ks.tabs.switchTo(choice.tabId).then((ok) => {
      if (!ok) void (tab ? ks.tabs.navigate(tab.id, choice.url) : ks.tabs.create(choice.url));
      renderToolbar();
    });
    return;
  }
  const value = choice ? choice.url : typed;
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
    const hint = h('span', { class: 'bookmarks-hint' }, 'Premi la stella nella barra degli indirizzi (o Ctrl+D) per aggiungere qui una pagina.');
    hint.prepend(icon('star', 14));
    bookmarkItems.replaceChildren(hint);
    return;
  }
  bookmarkItems.replaceChildren(
    ...bar.map((b) => {
      const el = h(
        'button',
        { class: 'bookmark', title: `${b.title}\n${b.url}` },
        /^https?:/i.test(b.url) ? h('img', { class: 'bm-icon', src: faviconUrl(b.url), alt: '' }) : b.url.startsWith('ksuite://') ? logoMark(16) : icon('globe', 16),
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
mediaBtn.addEventListener('click', () => void ks.mediaMenu());
readerBtn.addEventListener('click', () => {
  const t = activeTab();
  if (t) void ks.tabs.reader(t.id);
});
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

function barIcon(name: IconName): Element {
  const span = h('span', { class: 'bar-icon' });
  span.append(icon(name, 18));
  return span;
}

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
    barIcon('key'),
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
  infobar.replaceChildren(barIcon('lock'), h('span', { class: 'msg' }, 'Le password salvate sono bloccate.'), form);
  infobar.hidden = false;
  input.focus();
});

// ---------- HTTP authentication ----------

let authShown: string | null = null;

ks.events.onAuthPrompt((prompt) => {
  if (prompt.cancelled) {
    if (authShown === prompt.id) {
      authShown = null;
      hideInfobar();
    }
    return;
  }
  // A newer request replaces the one on screen.
  if (authShown) void ks.auth.answer(authShown, null);
  authShown = prompt.id;
  const user = h('input', { type: 'text', placeholder: 'Nome utente', 'aria-label': 'Nome utente', autocomplete: 'off' });
  const pass = h('input', { type: 'password', placeholder: 'Password', 'aria-label': 'Password', autocomplete: 'off' });
  const done = (credentials: { username: string; password: string } | null) => {
    authShown = null;
    void ks.auth.answer(prompt.id, credentials);
    hideInfobar();
  };
  const form = h('form', { class: 'row' }, user, pass,
    h('button', { class: 'primary', type: 'submit' }, 'Accedi'),
    h('button', { type: 'button', onclick: () => done(null) }, 'Annulla'));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    done({ username: user.value, password: pass.value });
  });
  const who = prompt.isProxy ? `Il proxy ${prompt.host}` : prompt.host;
  infobar.replaceChildren(
    barIcon('lock'),
    h('span', { class: 'msg' }, `${who} richiede l’accesso${prompt.realm ? ` («${prompt.realm}»)` : ''}`),
    form,
  );
  infobar.hidden = false;
  user.focus();
});

// ---------- Updates ----------

let announcedUpdate: string | null = null;

ks.events.onUpdate((status) => {
  const ready = status.state === 'downloaded';
  const notifyOnly = status.mode === 'notify' && status.state === 'available';
  if ((!ready && !notifyOnly) || !status.version || announcedUpdate === `${status.state}:${status.version}`) return;
  announcedUpdate = `${status.state}:${status.version}`;
  infobar.replaceChildren(
    barIcon('download'),
    h('span', { class: 'msg' }, ready ? `kSuite Browser ${status.version} è pronto: verrà installato al prossimo riavvio.` : `È disponibile kSuite Browser ${status.version}.`),
    h('span', { class: 'spacer' }),
    ready
      ? h('button', { class: 'primary', onclick: () => void ks.updates.install() }, 'Riavvia ora')
      : h('button', { class: 'primary', onclick: () => { hideInfobar(); void ks.openSettingsPage('updates'); } }, 'Dettagli'),
    h('button', { onclick: hideInfobar }, 'Più tardi'),
  );
  infobar.hidden = false;
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
$('btn-panel').addEventListener('click', togglePanel);
$('btn-tab-search').addEventListener('click', () => void ks.tabSearch());
$('panel-close').addEventListener('click', () => void setPanelOpen(false));
$('btn-settings').addEventListener('click', () => void ks.openSettingsPage());
siteInfo.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  if (/^https?:/i.test(t.url)) void ks.showSiteMenu(t.id);
  else omnibox.focus();
});
downloadsBtn.addEventListener('click', () => {
  if (document.body.classList.contains('panel-open') && panel.current() === 'downloads') void setPanelOpen(false);
  else void setPanelOpen(true).then(() => panel.show('downloads'));
});
ks.events.onDownloads((items) => {
  downloadsBtn.querySelector<HTMLElement>('.dot')!.hidden = !items.some((d) => d.state === 'progressing' || d.drive === 'uploading');
});
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
  const aiChanged = currentSettings?.aiEnabled !== settings.aiEnabled;
  currentSettings = settings;
  // The assistant and the mail compose form show different controls with the AI on or off.
  if (aiChanged && (panel.current() === 'assistant' || panel.current() === 'mail')) void panel.render();
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
ks.events.onAiAsk((ask) => void setPanelOpen(true).then(() => panel.askAi(ask)));
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
  document.body.classList.add(`platform-${info.platform}`);
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
