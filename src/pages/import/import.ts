import { h } from '../../renderer/dom';
import { hydrateIcons } from '../../renderer/icons';
import type { ImportKindOption, ImportReport, ImportSourceInfo } from '../../shared/types';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';
import { emptyState } from '../shared/ui';
import { plural, tr } from '../../shared/i18n';

followTheme();
hydrateIcons();

const content = document.getElementById('content')!;

const KINDS: Array<{ id: ImportKindOption; label: string }> = [
  { id: 'bookmarks', label: tr('Preferiti') },
  { id: 'history', label: tr('Cronologia') },
  { id: 'logins', label: tr('Password') },
  { id: 'cookies', label: tr('Cookie (resti connesso ai siti)') },
];

/** One line per imported kind, e.g. "120 preferiti". */
export function describeReport(r: ImportReport): string[] {
  const lines = [
    plural(r.bookmarks, 'Un preferito', '{n} preferiti'),
    plural(r.history, 'Una pagina della cronologia', '{n} pagine della cronologia'),
    plural(r.logins, 'Una password', '{n} password'),
    plural(r.cookies, 'Un cookie', '{n} cookie'),
  ];
  return lines.filter((_, i) => [r.bookmarks, r.history, r.logins, r.cookies][i] > 0);
}

function sourceCard(source: ImportSourceInfo): HTMLElement {
  const checks = KINDS.map((k) => {
    // Cookies off by default: they carry sign-ins, the user should choose to bring them.
    const input = h('input', { type: 'checkbox', value: k.id, checked: k.id !== 'cookies' });
    return { input, el: h('label', {}, input, h('span', {}, k.label)) };
  });
  const result = h('div', { class: 'result', role: 'status' });
  const button = h('button', { class: 'primary' }, tr('Importa'));
  button.addEventListener('click', async () => {
    const kinds = checks.filter((c) => c.input.checked).map((c) => c.input.value as ImportKindOption);
    if (!kinds.length) return;
    button.disabled = true;
    button.textContent = tr('Importazione…');
    result.replaceChildren();
    const res = await internal.importer.run(source.id, kinds);
    button.disabled = false;
    button.textContent = tr('Importa');
    if (!res.ok) {
      result.replaceChildren(h('span', { class: 'message error' }, res.error));
      return;
    }
    const done = describeReport(res.data);
    result.replaceChildren(
      h('span', { class: 'message ok' }, done.length ? tr('Importati: {0}.', done.join(', ').toLowerCase()) : tr('Niente di nuovo da importare.')),
      res.data.skipped.length ? h('ul', {}, ...res.data.skipped.map((s) => h('li', {}, tr('{0} non importati: {1}.', s.count, s.reason)))) : '',
    );
  });
  return h('div', { class: 'row stack source' },
    h('div', { class: 'source-head' },
      h('span', { class: 'browser-icon', 'aria-hidden': 'true' }, source.browser.replace(/^(Google|Microsoft|Mozilla) /, '').slice(0, 1)),
      h('div', { class: 'text' }, h('div', { class: 'title' }, source.browser), h('div', { class: 'desc' }, tr('Profilo: {0}', source.profileName))),
      button),
    h('div', { class: 'checks' }, ...checks.map((c) => c.el)),
    result);
}

async function render(): Promise<void> {
  const sources = await internal.importer.sources();
  content.replaceChildren(h('section', {}, h('h2', {}, tr('Browser su questo computer')),
    sources.length ? h('div', { class: 'card' }, ...sources.map(sourceCard)) : h('div', { class: 'card' }, emptyState('import', tr('Nessun altro browser trovato su questo computer.')))));
}

void render();
