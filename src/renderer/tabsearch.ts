import { applyTokens } from '../shared/appearance';
import { matchesAll } from '../shared/search-match';
import { faviconUrl } from '../shared/top-sites';
import type { TabSearchData, TabSearchItem } from '../shared/types';
import { readableUrl } from '../shared/url';
import { h } from './dom';
import { icon, logoMark } from './icons';

interface TabSearchBridge {
  onData(fn: (data: TabSearchData) => void): void;
  choose(tabId: number): void;
  close(tabId: number): void;
  reopen(index: number): void;
  open(url: string): void;
  dismiss(): void;
}

type Row =
  | { kind: 'tab'; tab: TabSearchItem }
  | { kind: 'closed'; index: number; title: string; url: string }
  | { kind: 'remote'; device: string; title: string; url: string };

const bridge = (window as unknown as { tabSearch: TabSearchBridge }).tabSearch;
const input = document.getElementById('q') as HTMLInputElement;
const list = document.getElementById('list')!;
document.getElementById('search-icon')!.append(icon('search', 16));

let data: TabSearchData = { tabs: [], closed: [], remote: [], look: { dark: false, vars: {} }, reset: true };
let rows: Row[] = [];
let selected = 0;

/** Text with the searched words highlighted, built from text nodes only. */
function highlight(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) {
    frag.append(text);
    return frag;
  }
  let last = 0;
  for (const m of text.matchAll(new RegExp(`(${words.join('|')})`, 'gi'))) {
    frag.append(text.slice(last, m.index), h('mark', {}, m[0]));
    last = (m.index ?? 0) + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

function favicon(url: string, favicon: string | null): Element {
  if (url.startsWith('ksuite://')) {
    const span = h('span', { class: 'icon' });
    span.append(logoMark(16));
    return span;
  }
  if (!/^https?:/i.test(url)) {
    const span = h('span', { class: 'icon' });
    span.append(icon('globe', 16));
    return span;
  }
  const img = h('img', { class: 'icon', src: favicon ?? faviconUrl(url), alt: '' });
  img.addEventListener('error', () => {
    if (img.src !== faviconUrl(url)) img.src = faviconUrl(url);
  });
  return img;
}

function choose(row: Row | undefined): void {
  if (!row) return;
  if (row.kind === 'tab') bridge.choose(row.tab.tabId);
  else if (row.kind === 'closed') bridge.reopen(row.index);
  else bridge.open(row.url);
}

function render(): void {
  const query = input.value.trim();
  const matches = (...fields: string[]) => !query || matchesAll(query, ...fields);
  const tabs = data.tabs
    .filter((t) => matches(t.title, t.url))
    // Most recently used first, like switching back and forth.
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  const closed = data.closed.filter((c) => matches(c.title, c.url)).slice(0, query ? 10 : 5);
  const remote = data.remote.flatMap((d) => d.tabs.filter((t) => matches(t.title, t.url)).slice(0, query ? 20 : 8).map((t): Row => ({ kind: 'remote', device: d.device, ...t })));
  rows = [...tabs.map((tab): Row => ({ kind: 'tab', tab })), ...closed.map((c): Row => ({ kind: 'closed', ...c })), ...remote];
  selected = Math.min(selected, Math.max(0, rows.length - 1));

  const nodes: Node[] = [];
  if (tabs.length) nodes.push(h('h2', {}, `Schede aperte · ${tabs.length}`));
  rows.forEach((row, i) => {
    if (row.kind === 'closed' && (i === 0 || rows[i - 1].kind === 'tab')) nodes.push(h('h2', {}, 'Chiuse di recente'));
    const prev = rows[i - 1];
    if (row.kind === 'remote' && !(prev?.kind === 'remote' && prev.device === row.device)) nodes.push(h('h2', {}, `Su ${row.device}`));
    const title = h('div', { class: 'title' });
    const sub = h('div', { class: 'sub' });
    let el: HTMLElement;
    if (row.kind === 'tab') {
      const t = row.tab;
      title.append(highlight(t.title || t.url));
      sub.append(highlight(readableUrl(t.url)));
      if (t.otherWindow) sub.append(' · Altra finestra');
      if (t.sleeping) sub.append(' · In pausa');
      const close = h('button', { class: 'close', title: 'Chiudi scheda', 'aria-label': `Chiudi ${t.title}` });
      close.append(icon('close', 14));
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        bridge.close(t.tabId);
      });
      el = h('div', { class: `row${t.sleeping ? ' sleeping' : ''}`, role: 'option' },
        favicon(t.url, t.favicon),
        h('div', { class: 'text' }, title, sub),
        t.audible ? (() => { const s = h('span', { class: 'icon' }); s.append(icon('volume', 15)); return s; })() : null,
        t.active && !t.otherWindow ? h('span', { class: 'badge current' }, 'Attuale') : null,
        close);
    } else {
      title.append(highlight(row.title || row.url));
      sub.append(highlight(readableUrl(row.url)));
      const reopen = h('span', { class: 'icon' });
      reopen.append(icon(row.kind === 'remote' ? 'monitor' : 'history', 15));
      el = h('div', { class: 'row', role: 'option' }, favicon(row.url, null), h('div', { class: 'text' }, title, sub), reopen);
    }
    if (i === selected) el.classList.add('selected');
    el.setAttribute('aria-selected', String(i === selected));
    el.addEventListener('click', () => choose(row));
    el.addEventListener('mousemove', () => {
      if (selected === i) return;
      selected = i;
      for (const [j, node] of [...list.querySelectorAll('.row')].entries()) {
        node.classList.toggle('selected', j === i);
        node.setAttribute('aria-selected', String(j === i));
      }
    });
    nodes.push(el);
  });
  if (!rows.length) nodes.push(h('div', { class: 'empty' }, query ? `Nessuna scheda trovata per «${query}»` : 'Nessuna scheda'));
  list.replaceChildren(...nodes);
  list.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
}

bridge.onData((next) => {
  data = next;
  applyTokens(document.documentElement, next.look.vars, next.look.dark);
  if (next.reset) {
    input.value = '';
    selected = 0;
  }
  render();
  input.focus();
});

input.addEventListener('input', () => {
  selected = 0;
  render();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!rows.length) return;
    selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    render();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(rows[selected]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    bridge.dismiss();
  } else if (e.key === 'Delete' && e.shiftKey) {
    // Shift+Canc closes the selected tab without leaving the list.
    const row = rows[selected];
    if (row?.kind === 'tab') bridge.close(row.tab.tabId);
  }
});
