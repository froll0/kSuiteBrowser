import { applyTokens } from '../shared/appearance';
import type { MainMenuData, MainMenuEntry } from '../shared/types';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { tr, translateDom } from '../shared/i18n';

translateDom(document.documentElement);

interface Bridge {
  onData(fn: (data: MainMenuData) => void): void;
  run(id: string, keepOpen?: boolean): void;
  resize(height: number): void;
  dismiss(): void;
}

const bridge = (window as unknown as { mainMenu: Bridge }).mainMenu;
const menu = document.getElementById('menu')!;
let data: MainMenuData | null = null;
/** Folded sections that are open, by label. */
const open = new Set<string>();

function glyph(name: string): Element {
  const span = h('span', { class: 'icon' });
  span.append(icon(name as IconName, 17));
  return span;
}

function itemRow(e: Extract<MainMenuEntry, { kind: 'item' }>, nested: boolean): HTMLElement {
  const el = h('button', { class: `item${nested ? ' nested' : ''}`, role: e.checked === undefined ? 'menuitem' : 'menuitemcheckbox', tabindex: '-1', 'data-id': e.id },
    glyph(e.icon),
    h('span', { class: 'label' }, e.label),
    e.checked !== undefined ? h('span', { class: `check${e.checked ? ' on' : ''}`, 'aria-hidden': 'true' }) : null,
    // Long shortcuts in the folded sections would cut the labels: those stay in the tooltip.
    e.keys && !(nested && e.keys.length > 12) ? h('span', { class: 'keys' }, e.keys) : null);
  if (e.keys) el.title = e.keys;
  if (e.checked !== undefined) el.setAttribute('aria-checked', String(e.checked));
  el.addEventListener('click', () => bridge.run(e.id));
  return el;
}

function zoomRow(d: MainMenuData): HTMLElement {
  const disabled = d.zoom === null;
  const button = (id: string, glyphName: IconName, label: string) => {
    const b = h('button', { class: 'zbtn', role: 'menuitem', tabindex: '-1', title: label, 'aria-label': label, disabled, 'data-id': id });
    b.append(icon(glyphName, 16));
    b.addEventListener('click', () => bridge.run(id, true));
    return b;
  };
  const value = h('button', { class: 'zvalue', role: 'menuitem', tabindex: '-1', title: tr('Dimensioni reali'), 'aria-label': tr('Zoom {0}%, ripristina', d.zoom ?? 100), disabled, 'data-id': 'zoomReset' }, `${d.zoom ?? 100}%`);
  value.addEventListener('click', () => bridge.run('zoomReset', true));
  const full = h('button', { class: `zbtn full${d.fullscreen ? ' on' : ''}`, role: 'menuitemcheckbox', 'aria-checked': String(d.fullscreen), tabindex: '-1', title: tr('Schermo intero'), 'aria-label': tr('Schermo intero'), 'data-id': 'fullscreen' });
  full.append(icon('monitor', 16));
  full.addEventListener('click', () => bridge.run('fullscreen'));
  return h('div', { class: 'zoom', role: 'group', 'aria-label': 'Zoom' },
    glyph('search'), h('span', { class: 'label' }, 'Zoom'),
    h('div', { class: 'zoom-controls' }, button('zoomOut', 'minus', tr('Zoom indietro')), value, button('zoomIn', 'plus', tr('Zoom avanti'))),
    full);
}

function render(): void {
  if (!data) return;
  const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.id;
  const nodes: Node[] = [];
  if (data.profile) {
    const badge = h('span', { class: 'avatar' }, data.profile.name.slice(0, 1).toUpperCase());
    badge.style.background = data.profile.color;
    nodes.push(h('div', { class: 'profile' }, badge, h('span', {}, data.profile.name)), h('div', { class: 'sep', role: 'separator' }));
  }
  for (const e of data.entries) {
    if (e.kind === 'separator') nodes.push(h('div', { class: 'sep', role: 'separator' }));
    else if (e.kind === 'zoom') nodes.push(zoomRow(data));
    else if (e.kind === 'item') nodes.push(itemRow(e, false));
    else {
      const isOpen = open.has(e.label);
      const head = h('button', { class: `item more${isOpen ? ' open' : ''}`, role: 'menuitem', tabindex: '-1', 'aria-haspopup': 'true', 'aria-expanded': String(isOpen), 'data-id': `more:${e.label}` },
        glyph(e.icon), h('span', { class: 'label' }, e.label), h('span', { class: 'chev' }, icon('chevronDown', 15)));
      head.addEventListener('click', () => toggle(e.label));
      nodes.push(head);
      if (isOpen) nodes.push(h('div', { class: 'nested-group', role: 'group', 'aria-label': e.label }, ...e.items.map((x) => (x.kind === 'item' ? itemRow(x, true) : h('div', { class: 'sep', role: 'separator' })))));
    }
  }
  menu.replaceChildren(...nodes);
  const again = focusedId ? menu.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusedId)}"]`) : null;
  // Opened with the mouse: no item looks selected until the keyboard is used (arrows start from the top).
  if (again && !again.matches(':disabled')) again.focus();
  else menu.focus();
  // Content height (the card itself fills the view, whatever its size).
  requestAnimationFrame(() => bridge.resize((menu.lastElementChild?.getBoundingClientRect().bottom ?? 0) + menu.scrollTop + 12));
}

function toggle(label: string): void {
  if (open.has(label)) open.delete(label);
  else open.add(label);
  render();
}

const items = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];

bridge.onData((next) => {
  const first = data === null || !menu.contains(document.activeElement);
  data = next;
  applyTokens(document.documentElement, next.look.vars, next.look.dark);
  if (first) open.clear();
  render();
});

document.addEventListener('keydown', (e) => {
  const list = items();
  const current = document.activeElement as HTMLButtonElement | null;
  const i = current ? list.indexOf(current) : -1;
  const move = (to: number) => list[(to + list.length) % list.length]?.focus();
  if (i === -1 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    move(e.key === 'ArrowDown' ? 0 : list.length - 1);
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    // Down from the zoom row leaves it (instead of walking its buttons).
    let j = i + 1;
    if (current?.closest('.zoom')) while (list[j]?.closest('.zoom')) j++;
    move(j);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    let j = i - 1;
    if (current?.closest('.zoom')) while (list[j]?.closest('.zoom')) j--;
    else if (list[j]?.closest('.zoom')) while (list[j - 1]?.closest('.zoom')) j--;
    move(j);
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    move(e.key === 'Home' ? 0 : list.length - 1);
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (current?.closest('.zoom')) {
      e.preventDefault();
      const row = [...current.closest('.zoom')!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const k = row.indexOf(current) + (e.key === 'ArrowRight' ? 1 : -1);
      row[Math.max(0, Math.min(row.length - 1, k))]?.focus();
    } else if (current?.classList.contains('more')) {
      e.preventDefault();
      const label = current.dataset.id!.slice(5);
      if ((e.key === 'ArrowRight') !== open.has(label)) toggle(label);
    } else if (e.key === 'ArrowLeft' && current?.classList.contains('nested')) {
      e.preventDefault();
      const head = current.closest('.nested-group')?.previousElementSibling as HTMLElement | null;
      if (head) {
        head.focus();
        toggle(head.dataset.id!.slice(5));
      }
    }
  } else if (e.key === 'Escape' || e.key === 'Tab') {
    e.preventDefault();
    bridge.dismiss();
  }
});
