import { h } from '../../renderer/dom';
import { hydrateIcons } from '../../renderer/icons';
import type { ExtensionSummary } from '../../shared/types';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';
import { tr } from '../../shared/i18n';

followTheme();
hydrateIcons();

const list = document.getElementById('list')!;
const statusEl = document.getElementById('status')!;
const dev = document.getElementById('dev') as HTMLInputElement;
const unpackedBtn = document.getElementById('unpacked') as HTMLButtonElement;
const storeInput = document.getElementById('store-input') as HTMLInputElement;

const SOURCES: Record<ExtensionSummary['source'], string> = { store: 'Chrome Web Store', file: tr('Da file'), unpacked: tr('Cartella (sviluppo)') };

function say(text: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function act(label: string, fn: () => Promise<{ ok: boolean; error?: string } | unknown>, done?: string): Promise<void> {
  say(label);
  const res = (await fn()) as { ok?: boolean; error?: string } | undefined;
  if (res && res.ok === false) say(res.error ?? '', res.error ? 'error' : '');
  else say(done ?? '', done ? 'ok' : '');
  await render();
}

function card(e: ExtensionSummary, developer: boolean): HTMLElement {
  const enabled = h('input', { type: 'checkbox', role: 'switch', checked: e.enabled, 'aria-label': tr('Attiva {0}', e.name) });
  enabled.addEventListener('change', () => void internal.extensions.setEnabled(e.id, enabled.checked).then(render));
  const pinned = h('input', { type: 'checkbox', checked: e.pinned, disabled: !e.enabled });
  pinned.addEventListener('change', () => void internal.extensions.setPinned(e.id, pinned.checked));

  const tags = h('div', { class: 'tags' }, h('span', { class: 'tag' }, SOURCES[e.source]));
  if (e.error) tags.append(h('span', { class: 'tag err' }, `Errore: ${e.error}`));
  if (e.pendingUpdate) tags.append(h('span', { class: 'tag warn' }, tr('Versione {0} disponibile: chiede nuovi permessi', e.pendingUpdate)));
  if (e.unsupported.length) tags.append(h('span', { class: 'tag warn', title: e.unsupported.join(', ') }, tr('Alcune funzioni non disponibili: {0}', e.unsupported.join(', '))));

  const actions = h('div', { class: 'ext-actions' },
    h('label', {}, pinned, tr('Sulla barra')),
    e.hasOptions ? h('button', { disabled: !e.running, onclick: () => void internal.extensions.options(e.id) }, tr('Opzioni')) : null,
    e.source === 'unpacked' || developer ? h('button', { disabled: !e.enabled, onclick: () => void act(tr('Ricarico…'), () => internal.extensions.reload(e.id), tr('Ricaricata.')) }, tr('Ricarica')) : null,
    e.pendingUpdate ? h('button', { class: 'primary', onclick: () => void act(tr('Aggiorno…'), () => internal.extensions.applyUpdate(e.id), tr('Aggiornata.')) }, tr('Aggiorna')) : null,
    e.homepage ? h('a', { class: 'button-link', href: e.homepage, target: '_blank', rel: 'noopener' }, tr('Sito')) : null,
    h('button', { class: 'danger', onclick: () => void internal.extensions.remove(e.id).then(async (ok) => { if (ok) await render(); }) }, tr('Rimuovi')),
  );

  const perms = e.warnings.length
    ? h('details', {}, h('summary', {}, tr('Permessi')), h('ul', {}, ...e.warnings.map((w) => h('li', {}, w))))
    : null;

  return h('article', { class: `ext-card${e.enabled ? '' : ' off'}${location.hash === `#${e.id}` ? ' highlight' : ''}`, id: e.id },
    e.icon ? h('img', { class: 'ext-icon', src: e.icon, alt: '' }) : h('span', { class: 'ext-icon letter' }, e.name.slice(0, 1).toUpperCase()),
    h('div', { class: 'ext-main' },
      h('h3', {}, e.name, h('span', { class: 'version' }, e.version)),
      e.description ? h('p', { class: 'desc' }, e.description) : null,
      tags,
      perms,
      developer ? h('div', { class: 'id' }, `ID ${e.id}${e.path ? ` · ${e.path}` : ''}`) : null,
      actions,
    ),
    h('div', { class: 'ext-side' }, h('label', { class: 'switch', title: e.enabled ? tr('Disattiva') : tr('Attiva') }, enabled, h('span', {}))),
  );
}

async function render(): Promise<void> {
  const { items, developerMode } = await internal.extensions.list();
  dev.checked = developerMode;
  unpackedBtn.hidden = !developerMode;
  if (items.length === 0) {
    list.replaceChildren(h('div', { class: 'group' }, h('div', { class: 'empty' },
      h('span', { class: 'big-icon', 'data-icon': 'puzzle', 'data-size': '26' }),
      h('strong', {}, tr('Nessuna estensione installata')),
      h('span', {}, tr('Cerca nel Chrome Web Store: gestori di password, blocco della pubblicità, traduzione, strumenti di scrittura…')))));
  } else {
    const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(h('section', { class: 'group' }, h('h2', {}, `Installate · ${items.length}`), ...sorted.map((e) => card(e, developerMode))));
  }
  hydrateIcons(list);
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
}

document.getElementById('store-form')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = storeInput.value.trim();
  if (!value) return;
  void act(tr('Scarico dal Chrome Web Store…'), () => internal.extensions.installFromStore(value), tr('Estensione installata.')).then(() => {
    if (statusEl.classList.contains('ok')) storeInput.value = '';
  });
});
document.getElementById('from-file')!.addEventListener('click', () => void act('', () => internal.extensions.installFile(), tr('Estensione installata.')));
unpackedBtn.addEventListener('click', () => void act('', () => internal.extensions.loadUnpacked(), tr('Cartella caricata.')));
document.getElementById('updates')!.addEventListener('click', async () => {
  say(tr('Cerco aggiornamenti…'));
  const res = await internal.extensions.checkUpdates();
  say(res.ok ? (res.data ? `Aggiornate: ${res.data}.` : tr('Nessun aggiornamento.')) : res.error, res.ok ? 'ok' : 'error');
  await render();
});
dev.addEventListener('change', () => void internal.extensions.setDeveloperMode(dev.checked).then(render));
internal.extensions.onChange(() => void render());
window.addEventListener('hashchange', () => void render());
void render();
