import type { Contact } from '../../api/contacts';
import type { MailSearchHit } from '../../api/mail';
import { formatDateTime, h } from '../../renderer/dom';
import { fileIcon, hydrateIcons, icon, logoMark, type IconName } from '../../renderer/icons';
import { calculate, formatNumber } from '../../shared/calc';
import { INTERNAL } from '../../shared/ipc';
import { faviconUrl } from '../../shared/top-sites';
import type { ApiResult, Bookmark, CalendarEvent, DriveFile, HistoryVisit } from '../../shared/types';
import { WEB_SEARCH_ENGINES, webSearchUrl, type WebSearchEngineId } from '../../shared/url';
import { followTheme } from '../shared/theme';

followTheme();
hydrateIcons();
document.getElementById('logo')!.append(logoMark(34));

const call = <T>(channel: string, ...args: unknown[]) => window.ksuiteInternal!.invoke(channel, ...args) as Promise<T>;
const results = document.getElementById('results')!;
const side = document.getElementById('side')!;
const input = document.getElementById('q') as HTMLInputElement;
const query = new URLSearchParams(location.search).get('q')?.trim() ?? '';

interface Meta {
  tokenConfigured: boolean;
  webSearchEngine: WebSearchEngineId;
  isDefault: boolean;
}

// ---------- Helpers ----------

/** Text with the searched words highlighted (built from text nodes, never HTML). */
function highlight(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) {
    frag.append(text);
    return frag;
  }
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index), h('mark', {}, m[0]));
    last = (m.index ?? 0) + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function lead(content: Node | string, accent = false): HTMLElement {
  const el = h('span', { class: `lead${accent ? ' accent' : ''}`, 'aria-hidden': 'true' });
  el.append(content);
  return el;
}

function row(opts: { href?: string; onclick?: () => void; lead: HTMLElement; title: string; sub?: string; meta?: string; unread?: boolean; action?: Element | null }): HTMLElement {
  const title = h('div', { class: 'title' });
  title.append(highlight(opts.title));
  const sub = opts.sub ? h('div', { class: 'sub' }) : null;
  sub?.append(highlight(opts.sub!));
  const children = [opts.lead, h('div', { class: 'body' }, title, sub), opts.meta ? h('span', { class: 'meta' }, opts.meta) : null, opts.action ?? null];
  const cls = `result${opts.unread ? ' unread' : ''}`;
  if (opts.href) return h('a', { class: cls, href: opts.href }, ...children);
  return h('button', { class: cls, type: 'button', onclick: opts.onclick }, ...children);
}

interface SectionDef {
  id: string;
  title: string;
  icon: IconName;
  more?: { label: string; onclick: () => void };
}

/** A results section: skeleton rows while loading, then the rows (or nothing when empty). */
function section(def: SectionDef): { el: HTMLElement; fill(rows: HTMLElement[]): void; fail(message: string): void } {
  const count = h('span', { class: 'count', hidden: true });
  const head = h('div', { class: 'section-head' }, h('h2', {}, icon(def.icon, 15), def.title), count);
  if (def.more) head.append(h('button', { class: 'link more', type: 'button', onclick: def.more.onclick }, def.more.label));
  const cards = h('div', { class: 'cards' }, ...[0, 1].map(() => h('div', { class: 'skeleton', 'aria-hidden': 'true' }, h('span', { class: 'sq' }), h('span', { class: 'ln' }))));
  const el = h('section', { class: 'section', id: `sec-${def.id}`, 'aria-busy': 'true' }, head, cards);
  return {
    el,
    fill(rows) {
      el.removeAttribute('aria-busy');
      if (rows.length === 0) {
        el.remove();
        checkEmpty();
        return;
      }
      count.textContent = String(rows.length);
      count.hidden = false;
      cards.replaceChildren(...rows);
    },
    fail(message) {
      el.removeAttribute('aria-busy');
      cards.replaceChildren(h('div', { class: 'section-error' }, icon('alert', 16), message));
    },
  };
}

let pending = 0;
function checkEmpty(): void {
  if (pending > 0 || results.querySelector('.section')) return;
  const badge = h('span', { class: 'big-icon' });
  badge.append(icon('search', 24));
  results.append(h('div', { class: 'nothing' }, badge, h('div', {}, `Nessun risultato in kSuite per «${query}».`), h('div', {}, 'Prova con il web: trovi i collegamenti qui a fianco.')));
}

function track<T>(promise: Promise<T>, done: (value: T) => void): void {
  pending++;
  void promise.then(done).finally(() => {
    pending--;
    checkEmpty();
  });
}

function eventChip(start: Date): HTMLElement {
  return h('span', { class: 'date-chip', 'aria-hidden': 'true' },
    h('span', { class: 'd' }, String(start.getDate())),
    h('span', { class: 'm' }, start.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// ---------- Side column ----------

function renderSide(meta: Meta): void {
  const engine = WEB_SEARCH_ENGINES[meta.webSearchEngine];
  const main = h('a', { class: 'button web-main', href: webSearchUrl(query, meta.webSearchEngine) }, icon('globe', 16), h('span', {}, `Cerca su ${engine.name}`));
  const chips = h('div', { class: 'chips' },
    ...(Object.keys(WEB_SEARCH_ENGINES) as WebSearchEngineId[])
      .filter((id) => id !== meta.webSearchEngine)
      .map((id) => h('a', { class: 'chip', href: webSearchUrl(query, id) }, WEB_SEARCH_ENGINES[id].name)));
  side.replaceChildren(h('div', { class: 'side-card' }, h('h3', {}, icon('globe', 16), 'Sul web'), h('p', {}, `«${query}»`), main, chips));

  if (!meta.tokenConfigured) {
    side.append(h('div', { class: 'side-card' },
      h('h3', {}, icon('key', 16), 'Cerca anche nei tuoi dati'),
      h('p', {}, 'Collega l’account kSuite per trovare qui anche file di kDrive, email, contatti ed eventi.'),
      h('a', { class: 'button', href: 'ksuite://settings/#ksuite' }, 'Collega l’account')));
  }
  if (!meta.isDefault) {
    side.append(h('div', { class: 'side-card' },
      h('h3', {}, icon('search', 16), 'Usala dalla barra degli indirizzi'),
      h('p', {}, 'Fai della ricerca kSuite il motore predefinito: cerchi in kSuite e sul web in un colpo solo.'),
      h('button', {
        type: 'button',
        onclick: async (e: Event) => {
          await call(INTERNAL.searchSetDefault);
          (e.currentTarget as HTMLElement).closest('.side-card')?.remove();
        },
      }, 'Imposta come predefinita')));
  }
}

// ---------- Results ----------

async function run(): Promise<void> {
  input.value = query;
  if (!query) {
    results.replaceChildren(h('div', { class: 'welcome' }, h('h1', {}, 'Ricerca kSuite'), h('p', {}, 'Cerca in una volta sola tra preferiti, cronologia, file di kDrive, email, contatti ed eventi, con i collegamenti per continuare sul web.')));
    input.focus();
    return;
  }
  document.title = `${query} — Ricerca kSuite`;
  const meta = await call<Meta>(INTERNAL.searchMeta);
  renderSide(meta);

  const value = calculate(query);
  if (value !== null) {
    results.append(h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', {}, icon('calculator', 15), 'Calcolo')),
      h('div', { class: 'cards calc' }, h('span', { class: 'expr' }, `${query} =`), h('span', { class: 'value' }, formatNumber(value)))));
  }

  const local = section({ id: 'local', title: 'Preferiti e cronologia', icon: 'history' });
  results.append(local.el);
  track(call<{ bookmarks: Bookmark[]; history: HistoryVisit[] }>(INTERNAL.searchLocal, query), (r) =>
    local.fill([
      ...r.bookmarks.map((b) => row({ href: b.url, lead: lead(h('img', { src: faviconUrl(b.url), alt: '' })), title: b.title, sub: b.url, action: icon('star', 15, 'kind') })),
      ...r.history.map((v) => row({ href: v.url, lead: lead(h('img', { src: faviconUrl(v.url), alt: '' })), title: v.title || v.url, sub: v.url, meta: formatDateTime(v.visitedAt / 1000) })),
    ]));

  if (!meta.tokenConfigured) return;
  const openApp = (appId: string) => () => void call(INTERNAL.searchOpenApp, appId);

  const drive = section({ id: 'drive', title: 'kDrive', icon: 'cloud', more: { label: 'Apri kDrive', onclick: openApp('drive') } });
  const mail = section({ id: 'mail', title: 'Email', icon: 'mail', more: { label: 'Apri Mail', onclick: openApp('mail') } });
  const contacts = section({ id: 'contacts', title: 'Contatti', icon: 'bookUser', more: { label: 'Apri Contacts', onclick: openApp('contacts') } });
  const events = section({ id: 'events', title: 'Eventi', icon: 'calendar', more: { label: 'Apri Calendar', onclick: openApp('calendar') } });
  results.append(drive.el, mail.el, contacts.el, events.el);

  const settle = <T>(s: ReturnType<typeof section>, channel: string, rows: (data: T) => HTMLElement[]) =>
    track(call<ApiResult<T>>(channel, query), (res) => (res.ok ? s.fill(rows(res.data)) : s.fail(res.error)));

  settle<DriveFile[]>(drive, INTERNAL.searchDrive, (files) =>
    files.map((f) => row({
      lead: lead(icon(fileIcon(f), 18), f.type === 'dir'),
      title: f.name,
      sub: f.type === 'dir' ? 'Cartella' : f.mimeType ?? 'File',
      meta: f.lastModified ? formatDateTime(f.lastModified, false) : undefined,
      onclick: async () => {
        const res = await call<ApiResult<string>>(INTERNAL.searchOpenDrive, f);
        if (res.ok) location.href = res.data;
      },
    })));
  settle<MailSearchHit[]>(mail, INTERNAL.searchMail, (hits) =>
    hits.map((m) => row({ lead: lead(initials(m.from)), title: m.subject, sub: `${m.from}${m.preview ? ` — ${m.preview}` : ''}`, meta: formatDateTime(m.date, false), unread: m.unseen, onclick: openApp('mail') })));
  settle<Contact[]>(contacts, INTERNAL.searchContacts, (list) =>
    list.map((c) => {
      const email = c.emails[0];
      const write = email
        ? h('span', { class: 'action' }, h('span', { class: 'chip', title: `Scrivi a ${email}` }, icon('pencil', 13), ' Scrivi'))
        : null;
      return row({ lead: lead(initials(c.name || email || '?'), true), title: c.name || email || '(senza nome)', sub: c.emails.join(', '), action: write, onclick: email ? () => void call(INTERNAL.searchCompose, email) : openApp('contacts') });
    }));
  settle<CalendarEvent[]>(events, INTERNAL.searchEvents, (list) =>
    list.map((e) => {
      const start = new Date(e.start);
      const when = e.fullday ? 'Tutto il giorno' : start.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      return row({ lead: eventChip(start), title: e.title, sub: `${start.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })} · ${when}${e.location ? ` · ${e.location}` : ''}`, onclick: openApp('calendar') });
    }));
}

document.getElementById('search-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (text && text !== query) location.search = `?q=${encodeURIComponent(text)}`;
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
    input.select();
  }
});

void run();
