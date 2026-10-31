import { applyTokens } from '../shared/appearance';
import { matchesAll } from '../shared/search-match';
import { faviconUrl } from '../shared/top-sites';
import type { PaletteChoice, PaletteData } from '../shared/types';
import { readableUrl } from '../shared/url';
import { h } from './dom';
import { icon, logoMark, type IconName } from './icons';
import { tr, translateDom } from '../shared/i18n';

translateDom(document.documentElement);

interface PaletteBridge {
  onData(fn: (data: PaletteData) => void): void;
  choose(choice: PaletteChoice): void;
  dismiss(): void;
}

interface Row {
  choice: PaletteChoice;
  title: string;
  sub: string;
  icon: Element;
  trail: string;
  section: string;
}

const bridge = (window as unknown as { palette: PaletteBridge }).palette;
const input = document.getElementById('q') as HTMLInputElement;
const list = document.getElementById('list')!;
document.getElementById('search-icon')!.append(icon('command', 16));

let data: PaletteData = { commands: [], tabs: [], bookmarks: [], sections: [], look: { dark: false, vars: {} } };
let rows: Row[] = [];
let selected = 0;

const GROUP_ICONS: Record<string, IconName> = { Schede: 'layers', Finestre: 'monitor', Pagina: 'fileText', Generale: 'settings', Aspetto: 'palette', Cloud: 'cloud' };

function glyph(name: IconName): Element {
  const span = h('span', { class: 'icon' });
  span.append(icon(name, 16));
  return span;
}

function siteIcon(url: string, favicon: string | null): Element {
  if (url.startsWith('velo://')) {
    const span = h('span', { class: 'icon' });
    span.append(logoMark(16));
    return span;
  }
  if (!/^https?:/i.test(url)) return glyph('globe');
  const img = h('img', { class: 'icon', src: favicon ?? faviconUrl(url), alt: '' });
  img.addEventListener('error', () => img.replaceWith(glyph('globe')));
  return img;
}

/** Address or search for what was typed, when nothing else fits it better. */
function inputRow(text: string): Row {
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(text);
  return {
    choice: { kind: 'input', text },
    title: looksLikeUrl ? tr('Apri {0}', text) : tr('Cerca «{0}»', text),
    sub: '',
    icon: glyph(looksLikeUrl ? 'globe' : 'search'),
    trail: '',
    section: '',
  };
}

function render(): void {
  const query = input.value.trim();
  const matches = (...fields: string[]) => !query || matchesAll(query, ...fields);
  const commands = data.commands.filter((c) => matches(c.label, c.group)).map((c): Row => ({
    choice: { kind: 'command', id: c.id }, title: c.label, sub: '', icon: glyph(GROUP_ICONS[c.group] ?? 'command'), trail: c.keys, section: tr('Comandi'),
  }));
  const tabs = data.tabs.filter((t) => query && matches(t.title, t.url)).sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 8).map((t): Row => ({
    choice: { kind: 'tab', tabId: t.tabId }, title: t.title || t.url, sub: readableUrl(t.url), icon: siteIcon(t.url, t.favicon), trail: t.active && !t.otherWindow ? tr('Attuale') : '', section: tr('Schede aperte'),
  }));
  const sections = data.sections.filter((s) => query && matches(s.label, s.keywords)).map((s): Row => ({
    choice: { kind: 'setting', id: s.id }, title: s.label, sub: tr('Impostazioni'), icon: glyph('settings'), trail: '', section: tr('Impostazioni'),
  }));
  const bookmarks = data.bookmarks.filter((b) => query && matches(b.title, b.url)).slice(0, 6).map((b): Row => ({
    choice: { kind: 'url', url: b.url }, title: b.title || b.url, sub: readableUrl(b.url), icon: siteIcon(b.url, null), trail: '', section: tr('Preferiti'),
  }));
  rows = [...commands, ...tabs, ...sections, ...bookmarks];
  if (query) rows.push(inputRow(query));
  selected = Math.min(selected, Math.max(0, rows.length - 1));

  const nodes: Node[] = [];
  rows.forEach((row, i) => {
    if (row.section && row.section !== rows[i - 1]?.section) nodes.push(h('h2', {}, row.section));
    const el = h('div', { class: `row${i === selected ? ' selected' : ''}`, role: 'option', id: `opt-${i}`, 'aria-selected': String(i === selected) },
      row.icon,
      h('div', { class: 'text' }, h('div', { class: 'title' }, row.title), row.sub ? h('div', { class: 'sub' }, row.sub) : null),
      row.trail ? h('span', { class: row.choice.kind === 'command' ? 'kbd' : 'badge current' }, row.trail) : null);
    el.addEventListener('click', () => bridge.choose(row.choice));
    el.addEventListener('mousemove', () => {
      if (selected === i) return;
      selected = i;
      highlightSelected();
    });
    nodes.push(el);
  });
  if (!rows.length) nodes.push(h('div', { class: 'empty' }, tr('Nessun risultato')));
  list.replaceChildren(...nodes);
  highlightSelected();
}

function highlightSelected(): void {
  for (const [j, node] of [...list.querySelectorAll('.row')].entries()) {
    node.classList.toggle('selected', j === selected);
    node.setAttribute('aria-selected', String(j === selected));
  }
  input.setAttribute('aria-activedescendant', `opt-${selected}`);
  list.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
}

bridge.onData((next) => {
  data = next;
  applyTokens(document.documentElement, next.look.vars, next.look.dark);
  input.value = '';
  selected = 0;
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
    highlightSelected();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const row = rows[selected];
    if (row) bridge.choose(row.choice);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    bridge.dismiss();
  }
});
