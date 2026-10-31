import { h } from '../../renderer/dom';
import { hydrateIcons } from '../../renderer/icons';
import { faviconUrl } from '../../shared/top-sites';
import { ZOOM_STEPS } from '../../shared/zoom';
import type { SiteSettingsInfo, SitePermissionState } from '../../shared/types';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';
import { emptyState } from '../shared/ui';
import { plural, tr } from '../../shared/i18n';

followTheme();
hydrateIcons();

const content = document.getElementById('content')!;
const heading = document.getElementById('heading')!;
const hostInput = document.getElementById('host') as HTMLInputElement;

function section(title: string, ...rows: Array<Node | null>): HTMLElement {
  return h('section', {}, h('h2', {}, title), h('div', { class: 'card' }, ...rows));
}

function row(title: string, desc: string | null, control: Node | null): HTMLElement {
  return h('div', { class: 'row' }, h('div', { class: 'text' }, h('div', { class: 'title' }, title), desc ? h('div', { class: 'desc' }, desc) : null), control ? h('div', { class: 'control' }, control) : null);
}

function toggle(checked: boolean, label: string, onChange: (on: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', {}));
}

function render(info: SiteSettingsInfo): void {
  heading.textContent = info.host;
  document.title = tr('Impostazioni di {0}', info.host);
  const set = async (patch: Parameters<typeof internal.site.set>[1]) => {
    const next = await internal.site.set(info.host, patch);
    if (next) render(next);
  };

  const permissions = info.permissions.map((p) => {
    const select = h(
      'select',
      { 'aria-label': p.label },
      h('option', { value: 'default', selected: p.state === 'default' }, p.fallback === 'block' ? tr('Predefinito (blocca)') : tr('Predefinito (chiedi)')),
      h('option', { value: 'allow', selected: p.state === 'allow' }, tr('Consenti')),
      h('option', { value: 'block', selected: p.state === 'block' }, tr('Blocca')),
    );
    select.addEventListener('change', () => void set({ permission: { name: p.permission, state: select.value as SitePermissionState } }));
    return row(p.label, null, select);
  });

  const zoom = h(
    'select',
    { 'aria-label': tr('Zoom') },
    h('option', { value: '', selected: info.zoom === null }, tr('Predefinito ({0}%)', info.defaultZoom)),
    ...ZOOM_STEPS.map((z) => h('option', { value: String(z), selected: info.zoom === z }, `${z}%`)),
  );
  zoom.addEventListener('change', () => void set({ zoom: zoom.value ? Number(zoom.value) : null }));

  const status = h('span', { class: 'message', role: 'status' });
  const clear = h('button', {
    class: 'danger',
    onclick: async () => {
      const next = await internal.site.clear(info.host);
      if (next) render(next);
    },
  }, tr('Cancella cookie e dati'));

  content.replaceChildren(
    section(tr('Permessi'), ...permissions),
    section(
      tr('Protezioni'),
      row(tr('Protezioni attive'), tr('Blocco dei tracker, protezione dall’impronta e livello di sicurezza valgono per {0}. Spegnile solo se il sito non funziona.', info.site), toggle(!info.protectionOff, tr('Protezioni attive'), (on) => void set({ protectionOff: !on }))),
      row(tr('Consenti le pagine non cifrate (http)'), tr('Senza questa eccezione Velo prova sempre la versione https e avvisa prima di aprire quella non cifrata.'), toggle(info.httpAllowed, tr('Consenti le pagine non cifrate (http)'), (on) => void set({ httpAllowed: on }))),
    ),
    section(tr('Aspetto'), row(tr('Zoom'), null, zoom)),
    section(
      tr('Cookie e dati'),
      row(
        info.cookies ? plural(info.cookies, 'Un cookie salvato', '{n} cookie salvati') : tr('Nessun cookie salvato'),
        tr('Cookie, archiviazione locale e cache di {0} e dei suoi sottodomini.', info.site),
        h('div', { class: 'control' }, clear, status),
      ),
      row(
        tr('Ricorda questo sito'),
        info.forgetSitesOnClose ? tr('Velo dimentica i siti quando chiudi le loro schede: questo resta (per esempio per restare connesso).') : tr('Vale quando attivi «Dimentica i siti alla chiusura delle schede» nelle impostazioni.'),
        toggle(info.remembered, tr('Ricorda questo sito'), (on) => void set({ remembered: on })),
      ),
    ),
  );
}

async function renderList(): Promise<void> {
  heading.textContent = tr('Impostazioni dei siti');
  document.title = tr('Impostazioni dei siti');
  const sites = await internal.site.list();
  const WHAT: Record<string, string> = { permissions: tr('permessi'), zoom: tr('zoom'), protection: tr('protezioni spente'), http: tr('http consentito'), remembered: tr('ricordato') };
  content.replaceChildren(
    sites.length
      ? h('div', { class: 'card' }, h('ul', { class: 'site-list' }, ...sites.map((s) => h('li', {}, h('a', { href: `?host=${encodeURIComponent(s.host)}` }, h('img', { src: faviconUrl(`https://${s.host}/`), alt: '' }), h('span', {}, s.host), h('span', { class: 'what' }, s.what.map((w) => WHAT[w] ?? w).join(' · ')))))))
      : emptyState('globe', tr('Nessun sito ha impostazioni particolari. Cerca un sito qui sopra per cambiarle.')),
  );
}

async function show(): Promise<void> {
  const host = new URLSearchParams(location.search).get('host');
  if (!host) return renderList();
  const info = await internal.site.info(host);
  if (info) render(info);
  else content.replaceChildren(emptyState('alert', tr('«{0}» non è un indirizzo valido.', host)));
}

document.getElementById('pick')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const value = hostInput.value.trim();
  if (value) location.search = `?host=${encodeURIComponent(value)}`;
});

void show();
