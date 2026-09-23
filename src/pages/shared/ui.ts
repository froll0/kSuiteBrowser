import { h } from '../../renderer/dom';
import { icon, type IconName } from '../../renderer/icons';

/** Round icon-only button with an accessible name. */
export function iconButton(name: IconName, label: string, onclick: () => void, extra: Record<string, string | boolean> = {}): HTMLButtonElement {
  const button = h('button', { class: 'icon', title: label, 'aria-label': label, onclick, ...extra });
  button.append(icon(name, 17));
  return button;
}

/** Button with an icon before its text. */
export function withIcon<T extends HTMLElement>(el: T, name: IconName, size = 16): T {
  el.prepend(icon(name, size));
  return el;
}

/** Empty state with a large icon. */
export function emptyState(name: IconName, text: string): HTMLElement {
  const badge = h('span', { class: 'big-icon' });
  badge.append(icon(name, 24));
  return h('div', { class: 'empty' }, badge, h('span', {}, text));
}
