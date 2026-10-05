import { h } from '../../renderer/dom';
import { permissionLabel } from '../../shared/external-protocols';
import { SECURE_DNS_PROVIDERS, validDohTemplate, type SecureDnsChoice } from '../../shared/secure-dns';
import { ASKABLE_PERMISSIONS, DEFAULT_SETTINGS, REMINDER_MINUTES, SLEEP_MINUTES } from '../../shared/settings-schema';
import { ACCENT_PRESETS, FONT_SIZES, RADIUS_RANGE, TOOLBAR_ITEMS, TOOLBAR_ITEM_IDS, UI_FONTS, type ToolbarItem, type UiFont } from '../../shared/appearance';
import type { SyncStatus, SyncCollectionOption, AskablePermission, BrowsingDataSelection, Settings, UpdateStatus } from '../../shared/types';
import { SEARCH_ENGINES, WEB_SEARCH_ENGINES } from '../../shared/url';
import { ZOOM_STEPS } from '../../shared/zoom';
import { hydrateIcons, logoMark } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { LOCALES, LOCALE_NAMES, localeTag, tr } from '../../shared/i18n';

const AI_PAGE = 'https://www.infomaniak.com/it/hosting/ai-services';
const TOKEN_PAGE = 'https://manager.infomaniak.com/v3/ng/accounts/token/list';

const PERMISSION_LABELS: Record<string, string> = {
  media: tr('Fotocamera e microfono'),
  notifications: tr('Notifiche'),
  geolocation: tr('Posizione'),
  'clipboard-read': tr('Lettura appunti'),
};

const content = document.getElementById('content')!;
const filter = document.getElementById('filter') as HTMLInputElement;
let settings: Settings;

// ---------- Building blocks ----------

/** Changes made on this page also come back as a broadcast: don't re-render for those. */
let ownUpdates = 0;
const update = (patch: Partial<Settings>) => {
  ownUpdates++;
  return internal.update(patch).then((s) => (settings = s));
};

function section(id: string, title: string, ...rows: Array<Node | null>): HTMLElement {
  return h('section', { id }, h('h2', {}, title), h('div', { class: 'card' }, ...rows));
}

function row(title: string, desc: string | Node | null, control: Node | null, options: { stack?: boolean } = {}): HTMLElement {
  return h(
    'div',
    { class: `row${options.stack ? ' stack' : ''}`, 'data-search': `${title} ${typeof desc === 'string' ? desc : ''}`.toLowerCase() },
    h('div', { class: 'text' }, h('div', { class: 'title' }, title), desc ? h('div', { class: 'desc' }, desc) : null),
    control ? h('div', { class: 'control' }, control) : null,
  );
}

function toggle(key: { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings], label: string): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked: settings[key] });
  input.addEventListener('change', () => void update({ [key]: input.checked } as Partial<Settings>));
  return h('label', { class: 'switch' }, input, h('span', {}));
}

function radios<T extends string>(name: string, value: T, options: Array<{ value: T; title: string; desc?: string }>, onChange: (v: T) => void, cols = false): HTMLElement {
  return h(
    'div',
    { class: `choices${cols ? ' cols' : ''}`, role: 'radiogroup' },
    ...options.map((o) => {
      const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value });
      input.addEventListener('change', () => input.checked && onChange(o.value));
      return h('label', { class: 'choice' }, input, h('div', {}, h('div', { class: 'title' }, o.title), o.desc ? h('div', { class: 'desc muted small' }, o.desc) : null));
    }),
  );
}

function hostList(items: string[], empty: string, onRemove: (host: string) => void): HTMLElement {
  if (items.length === 0) return h('p', { class: 'muted small' }, empty);
  return h('ul', { class: 'list' }, ...items.map((host) => h('li', {}, h('span', {}, host), h('button', { class: 'link', onclick: () => onRemove(host) }, tr('Rimuovi')))));
}

// ---------- Sections ----------

async function generalSection(): Promise<HTMLElement> {
  const home = h('input', { type: 'url', value: settings.homePage, 'aria-label': tr('Pagina iniziale') });
  home.addEventListener('change', () => void update({ homePage: home.value }));

  const engine = h('select', { 'aria-label': tr('Motore di ricerca') }, ...Object.entries(SEARCH_ENGINES).map(([id, e]) => h('option', { value: id, selected: settings.searchEngine === id }, e.name)));
  engine.addEventListener('change', () => void update({ searchEngine: engine.value as Settings['searchEngine'] }));

  const folder = await internal.downloadDir();
  const isDefault = await internal.defaultBrowser.status();
  const defaultMsg = h('span', { class: 'message', role: 'status' });
  const defaultBtn = isDefault
    ? null
    : h('button', {
        onclick: async () => {
          const ok = await internal.defaultBrowser.set();
          defaultMsg.textContent = ok ? tr('Fatto: i link delle altre app si apriranno qui.') : tr('Scegli Velo nelle impostazioni del sistema che si sono aperte (App predefinite › Browser web).');
          defaultMsg.className = `message ${ok ? 'ok' : ''}`;
          if (ok) void render();
        },
      }, tr('Imposta come predefinito'));
  const folderControls = h(
    'div',
    { class: 'control' },
    h('button', { onclick: async () => { if (await internal.chooseDownloadDir()) void render(); } }, tr('Cambia…')),
    settings.downloadDir ? h('button', { onclick: () => void update({ downloadDir: null }).then(render) }, tr('Predefinita')) : null,
  );

  const langInfo = await internal.localeInfo();
  const langMsg = h('span', { class: 'message', role: 'status' });
  const restartBtn = h('button', { onclick: () => void internal.restart() }, tr('Riavvia ora'));
  const showRestart = (value: Settings['language']) => {
    const target = value === 'system' ? langInfo.system : value;
    const same = target === langInfo.current;
    // Through CSSOM: the button styles would override the hidden attribute.
    restartBtn.style.display = same ? 'none' : '';
    langMsg.textContent = same ? '' : tr('La nuova lingua si applica al riavvio.');
  };
  const language = h(
    'select',
    { 'aria-label': tr('Lingua') },
    h('option', { value: 'system', selected: settings.language === 'system' }, tr('Come il sistema ({0})', LOCALE_NAMES[langInfo.system])),
    ...LOCALES.map((l) => h('option', { value: l, selected: settings.language === l }, LOCALE_NAMES[l])),
  );
  language.addEventListener('change', () => {
    const value = language.value as Settings['language'];
    void update({ language: value });
    showRestart(value);
  });
  showRestart(settings.language);

  return section(
    'general',
    tr('Generale'),
    row(tr('Lingua'), h('span', {}, tr('La lingua di menu, pagine e messaggi di Velo. '), langMsg), h('div', { class: 'control' }, language, restartBtn)),
    row(tr('Browser predefinito'), isDefault ? tr('Velo è il tuo browser predefinito: i link delle altre app si aprono qui.') : h('span', {}, tr('I link delle email e delle altre app si aprono in un altro browser. '), defaultMsg), defaultBtn),
    h('div', { class: 'row stack', 'data-search': tr('avvio sessione schede pagina iniziale') },
      h('div', { class: 'title' }, tr('All’avvio')),
      radios('startup', settings.startup, [
        { value: 'restore', title: tr('Riapri le schede della sessione precedente') },
        { value: 'home', title: tr('Apri la pagina iniziale') },
      ], (v) => void update({ startup: v })),
    ),
    row(tr('Pagina iniziale'), tr('Si apre all’avvio (se non riapri la sessione precedente) e nelle nuove schede se scegli così qui sotto.'), home),
    h('div', { class: 'row stack', 'data-search': tr('nuova scheda pagina siti più visitati') },
      h('div', { class: 'title' }, tr('Le nuove schede aprono')),
      radios('newtab', settings.newTabPage, [
        { value: 'newtab', title: tr('La pagina nuova scheda'), desc: tr('Ricerca, siti più visitati e le tue app.') },
        { value: 'home', title: tr('La pagina iniziale') },
      ], (v) => void update({ newTabPage: v }), true),
    ),
    row(tr('Motore di ricerca'), tr('Usato nella barra degli indirizzi. “Velo” cerca insieme in preferiti e cronologia (e, con un account Infomaniak, in file, email, contatti ed eventi) e ti porta sul web con un clic.'), engine),
    row(tr('Motore per il web'), tr('Usato dalla ricerca unificata per i risultati sul web.'), webEngineSelect()),
    row(tr('Metti in pausa le schede inattive'), tr('Le schede non usate da un po’ chiudono la pagina per liberare memoria e si ricaricano quando le apri. Mai quelle fissate, delle app, con audio in riproduzione o con moduli compilati.'), sleepSelect()),
    row(tr('Cartella dei download'), folder, folderControls),
    row(tr('Chiedi dove salvare ogni file'), tr('Mostra la finestra “Salva con nome” per ogni download.'), toggle('askDownloadLocation', tr('Chiedi dove salvare'))),
  );
}

// ---------- Appearance ----------

/** A small drawing of the window that follows every change: layout, colours, shapes. */
function preview(): HTMLElement {
  const el = h('div', { class: 'preview', 'aria-hidden': 'true' });
  const draw = () => {
    const s = settings;
    el.className = `preview layout-${s.tabsLayout} rail-${s.railPosition} canvas-${s.canvasStyle} density-${s.density}`;
    const tabs = h('div', { class: 'p-tabs' }, h('span', { class: 'p-tab active' }), h('span', { class: 'p-tab' }), h('span', { class: 'p-tab' }));
    const bar = h('div', { class: 'p-bar' }, h('span', { class: 'p-dot' }), h('span', { class: 'p-dot' }), h('span', { class: 'p-url' }), h('span', { class: 'p-dot' }));
    const top = h('div', { class: 'p-top' }, s.tabsLayout === 'side' ? null : tabs, s.tabsLayout === 'top' ? null : bar);
    const rows: Node[] = [top];
    if (s.tabsLayout === 'top') rows.push(h('div', { class: 'p-top' }, bar));
    const rail = h('div', { class: 'p-rail' }, ...Array.from({ length: 5 }, () => h('span', { class: 'p-app' })));
    const side = s.tabsLayout === 'side'
      ? h('div', { class: 'p-side' }, ...Array.from({ length: 5 }, (_, i) => h('span', { class: `p-tab${i === 0 ? ' active' : ''}` })))
      : null;
    const canvas = h('div', { class: 'p-canvas' }, h('span', { class: 'p-line wide' }), h('span', { class: 'p-line' }), h('span', { class: 'p-line short' }));
    el.replaceChildren(...rows, h('div', { class: 'p-body' }, s.railPosition === 'hidden' ? null : rail, side, canvas));
  };
  draw();
  redrawPreview = draw;
  return el;
}
let redrawPreview = () => {};

/** Saves an appearance change: the page (and the preview) follow at once through the settings broadcast. */
const look = (patch: Partial<Settings>) =>
  void update(patch).then(() => {
    redrawPreview();
    redrawToolbarEditor();
  });

function segmented<T extends string | number>(label: string, value: T, options: Array<{ value: T; title: string; icon?: string }>, onChange: (v: T) => void): HTMLElement {
  return h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label },
    ...options.map((o) => {
      const button = h('button', { type: 'button', role: 'radio', 'aria-checked': String(o.value === value), class: o.value === value ? 'on' : '' },
        o.icon ? h('span', { 'data-icon': o.icon, 'data-size': '16' }) : null, o.title);
      button.addEventListener('click', () => {
        for (const b of button.parentElement!.children) {
          b.classList.toggle('on', b === button);
          b.setAttribute('aria-checked', String(b === button));
        }
        onChange(o.value);
      });
      return button;
    }));
}

function accentPicker(): HTMLElement {
  const custom = h('input', { type: 'color', value: settings.accentColor, 'aria-label': tr('Colore personalizzato'), title: tr('Scegli un altro colore') });
  const swatches = ACCENT_PRESETS.map((p) => {
    const b = h('button', { type: 'button', class: 'swatch', title: p.name, 'aria-label': p.name });
    // Through the CSSOM: the page's security policy forbids inline style attributes.
    b.style.setProperty('--swatch', p.color);
    b.addEventListener('click', () => pick(p.color));
    return b;
  });
  const mark = () => {
    for (const [i, b] of swatches.entries()) b.classList.toggle('on', ACCENT_PRESETS[i].color === settings.accentColor);
    custom.parentElement?.classList.toggle('on', !ACCENT_PRESETS.some((p) => p.color === settings.accentColor));
  };
  const pick = (color: string) => {
    custom.value = color;
    void update({ accentColor: color }).then(() => {
      mark();
      redrawPreview();
    });
  };
  custom.addEventListener('input', () => pick(custom.value));
  const el = h('div', { class: 'swatches' }, ...swatches, h('label', { class: 'swatch custom', title: tr('Scegli un altro colore') }, custom));
  queueMicrotask(mark);
  return el;
}

function radiusSlider(): HTMLElement {
  const input = h('input', { type: 'range', min: String(RADIUS_RANGE.min), max: String(RADIUS_RANGE.max), step: '1', value: String(settings.cornerRadius), 'aria-label': tr('Arrotondamento degli angoli') });
  const out = h('output', {}, `${settings.cornerRadius} px`);
  let timer: number | undefined;
  input.addEventListener('input', () => {
    out.textContent = `${input.value} px`;
    // The page follows at once; the file is written when the slider rests.
    document.documentElement.style.setProperty('--r-lg', `${input.value}px`);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => look({ cornerRadius: Number(input.value) }), 120);
  });
  return h('div', { class: 'range' }, h('span', { class: 'muted small' }, tr('Squadrati')), input, h('span', { class: 'muted small' }, tr('Tondi')), out);
}

function toolbarEditor(): HTMLElement {
  const lanes: Record<'toolbarStart' | 'toolbarEnd' | 'available', HTMLElement> = {
    toolbarStart: h('div', { class: 'lane', 'data-lane': 'toolbarStart' }),
    toolbarEnd: h('div', { class: 'lane', 'data-lane': 'toolbarEnd' }),
    available: h('div', { class: 'lane available', 'data-lane': 'available' }),
  };
  let dragged: ToolbarItem | null = null;

  const save = (start: ToolbarItem[], end: ToolbarItem[]) => look({ toolbarStart: start, toolbarEnd: end });
  const chip = (id: ToolbarItem, lane: keyof typeof lanes) => {
    const def = TOOLBAR_ITEMS[id];
    const inBar = lane !== 'available';
    // In the two bar lanes the buttons look like in the real toolbar (icon only); the name is in the tooltip.
    const c = h('div', { class: `chip${inBar ? ' in-bar' : ''}`, draggable: 'true', 'data-id': id, title: inBar ? tr('{0} — trascina per spostare', def.label) : tr('Clic o trascina per aggiungere') },
      h('span', { 'data-icon': def.icon, 'data-size': inBar ? '18' : '16' }), inBar ? null : h('span', {}, def.label));
    c.tabIndex = 0;
    if (lane === 'available') {
      c.setAttribute('role', 'button');
      c.addEventListener('click', () => save(settings.toolbarStart, [...settings.toolbarEnd, id]));
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          c.click();
        }
      });
    } else {
      c.setAttribute('aria-label', tr('{0}: Canc per togliere, frecce per spostare', def.label));
      c.addEventListener('keydown', (e) => {
        const start = [...settings.toolbarStart];
        const end = [...settings.toolbarEnd];
        const list = lane === 'toolbarStart' ? start : end;
        const i = list.indexOf(id);
        if (e.key === 'Delete' || e.key === 'Backspace') {
          list.splice(i, 1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const j = i + (e.key === 'ArrowLeft' ? -1 : 1);
          list.splice(i, 1);
          // Past either end of a group the button moves to the other group.
          if (j < 0 && lane === 'toolbarEnd') start.push(id);
          else if (j >= list.length + 1 && lane === 'toolbarStart') end.unshift(id);
          else list.splice(Math.max(0, Math.min(list.length, j)), 0, id);
        } else return;
        e.preventDefault();
        refocus = id;
        save(start, end);
      });
      const remove = h('button', { type: 'button', class: 'chip-x', title: tr('Togli dalla barra'), 'aria-label': tr('Togli {0} dalla barra', def.label), 'data-icon': 'close', 'data-size': '13' });
      remove.addEventListener('click', () => save(settings.toolbarStart.filter((x) => x !== id), settings.toolbarEnd.filter((x) => x !== id)));
      c.append(remove);
    }
    c.addEventListener('dragstart', (e) => {
      dragged = id;
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', id);
      c.classList.add('dragging');
    });
    c.addEventListener('dragend', () => {
      dragged = null;
      c.classList.remove('dragging');
    });
    return c;
  };

  for (const [name, lane] of Object.entries(lanes) as Array<[keyof typeof lanes, HTMLElement]>) {
    lane.addEventListener('dragover', (e) => {
      if (!dragged) return;
      e.preventDefault();
      lane.classList.add('over');
    });
    lane.addEventListener('dragleave', () => lane.classList.remove('over'));
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      lane.classList.remove('over');
      if (!dragged) return;
      const id = dragged;
      const start = settings.toolbarStart.filter((x) => x !== id);
      const end = settings.toolbarEnd.filter((x) => x !== id);
      if (name === 'available') return save(start, end);
      // Dropped before the chip under the pointer (or at the end).
      const target = [...lane.querySelectorAll<HTMLElement>('.chip')].find((el) => {
        const r = el.getBoundingClientRect();
        return el.dataset.id !== id && e.clientX < r.left + r.width / 2 && e.clientY < r.bottom;
      });
      const list = name === 'toolbarStart' ? start : end;
      const at = target ? list.indexOf(target.dataset.id as ToolbarItem) : -1;
      list.splice(at === -1 ? list.length : at, 0, id);
      save(start, end);
    });
  }

  let refocus: ToolbarItem | null = null;
  const draw = () => {
    lanes.toolbarStart.replaceChildren(...settings.toolbarStart.map((id) => chip(id, 'toolbarStart')));
    lanes.toolbarEnd.replaceChildren(...settings.toolbarEnd.map((id) => chip(id, 'toolbarEnd')));
    const unused = TOOLBAR_ITEM_IDS.filter((id) => !settings.toolbarStart.includes(id) && !settings.toolbarEnd.includes(id));
    lanes.available.replaceChildren(...unused.map((id) => chip(id, 'available')));
    if (!unused.length) lanes.available.append(h('span', { class: 'muted small' }, tr('Tutti i pulsanti sono già nella barra.')));
    hydrateIcons(el);
    if (refocus) el.querySelector<HTMLElement>(`.lane-row .chip[data-id="${refocus}"]`)?.focus();
    refocus = null;
  };
  const el = h('div', { class: 'toolbar-editor' },
    h('div', { class: 'lane-row' },
      h('div', { class: 'lane-box' }, h('div', { class: 'lane-title' }, tr('Prima dell’indirizzo')), lanes.toolbarStart),
      h('div', { class: 'omni-stub' }, h('span', { 'data-icon': 'search', 'data-size': '14' }), tr('Indirizzo')),
      h('div', { class: 'lane-box' }, h('div', { class: 'lane-title' }, tr('Dopo l’indirizzo')), lanes.toolbarEnd),
      h('div', { class: 'menu-stub', title: tr('Il menu resta sempre in fondo') }, h('span', { 'data-icon': 'more', 'data-size': '16' }))),
    h('div', { class: 'lane-box' }, h('div', { class: 'lane-title' }, tr('Pulsanti disponibili')), lanes.available));
  draw();
  redrawToolbarEditor = draw;
  return el;
}
let redrawToolbarEditor = () => {};

function appearanceSection(): HTMLElement {
  const font = h('select', { 'aria-label': tr('Carattere dell’interfaccia') },
    ...(Object.entries(UI_FONTS) as Array<[UiFont, { label: string; stack: string }]>).map(([id, f]) => {
      const option = h('option', { value: id, selected: settings.uiFont === id }, f.label);
      option.style.fontFamily = f.stack;
      return option;
    }));
  font.addEventListener('change', () => look({ uiFont: font.value as UiFont }));
  const size = h('select', { 'aria-label': tr('Dimensione del testo dell’interfaccia') },
    ...FONT_SIZES.map((n) => h('option', { value: String(n), selected: settings.uiFontSize === n }, n === 13 ? tr('{0} px (predefinita)', n) : `${n} px`)));
  size.addEventListener('change', () => look({ uiFontSize: Number(size.value) }));

  return section(
    'appearance',
    tr('Aspetto'),
    h('div', { class: 'row stack preview-row', 'data-search': tr('anteprima aspetto') }, preview()),
    row(tr('Tema'), null, segmented(tr('Tema'), settings.theme, [
      { value: 'system', title: tr('Sistema'), icon: 'monitor' },
      { value: 'light', title: tr('Chiaro'), icon: 'sun' },
      { value: 'dark', title: tr('Scuro'), icon: 'moon' },
    ], (v) => look({ theme: v }))),
    row(tr('Colore d’accento'), tr('Pulsanti, selezioni, link e la tinta dello sfondo.'), accentPicker()),
    row(tr('Tavolozza'), tr('I toni neutri di superfici e testi.'), segmented(tr('Tavolozza'), settings.palette, [
      { value: 'standard', title: tr('Neutra') },
      { value: 'warm', title: tr('Calda') },
      { value: 'contrast', title: tr('Alto contrasto') },
    ], (v) => look({ palette: v }))),
    row(tr('Sfondo della finestra'), tr('Il colore intorno alla pagina.'), segmented(tr('Sfondo'), settings.backdrop, [
      { value: 'neutral', title: tr('Neutro') },
      { value: 'tint', title: tr('Tinta') },
      { value: 'gradient', title: tr('Sfumato') },
    ], (v) => look({ backdrop: v }))),
    row(tr('La pagina'), tr('Sospesa come una tela con i bordi arrotondati, oppure da bordo a bordo.'), segmented(tr('Pagina'), settings.canvasStyle, [
      { value: 'floating', title: tr('Tela sospesa') },
      { value: 'flush', title: 'Bordo a bordo' },
    ], (v) => look({ canvasStyle: v }))),
    row(tr('Angoli'), tr('Quanto sono arrotondati pagina, schede, pulsanti e riquadri.'), radiusSlider()),
    row(tr('Densità'), tr('Lo spazio intorno a schede e pulsanti.'), segmented(tr('Densità'), settings.density, [
      { value: 'compact', title: tr('Compatta') },
      { value: 'normal', title: tr('Normale') },
      { value: 'comfortable', title: tr('Ariosa') },
    ], (v) => look({ density: v }))),
    row(tr('Carattere'), tr('Per schede, barre, menu e pagine del browser.'), h('div', { class: 'control' }, font, size)),
    row(tr('Icone delle app'), null, segmented(tr('Icone app'), settings.appIconStyle, [
      { value: 'mono', title: tr('Essenziali') },
      { value: 'color', title: tr('Colorate') },
    ], (v) => look({ appIconStyle: v }))),
    row(tr('Ripristina'), tr('Torna ai colori, alle forme e alla disposizione iniziali.'), h('button', {
      onclick: () => {
        const d = DEFAULT_SETTINGS;
        void update({
          theme: d.theme, accentColor: d.accentColor, palette: d.palette, backdrop: d.backdrop, canvasStyle: d.canvasStyle, cornerRadius: d.cornerRadius,
          density: d.density, uiFont: d.uiFont, uiFontSize: d.uiFontSize, appIconStyle: d.appIconStyle, tabsLayout: d.tabsLayout, railPosition: d.railPosition,
          toolbarStart: d.toolbarStart, toolbarEnd: d.toolbarEnd, showFullUrl: d.showFullUrl, sideTabsWidth: d.sideTabsWidth, sideTabsCollapsed: d.sideTabsCollapsed,
        }).then(render);
      },
    }, tr('Ripristina l’aspetto'))),
  );
}

function layoutSection(): HTMLElement {
  return section(
    'layout',
    tr('Disposizione'),
    h('div', { class: 'row stack', 'data-search': tr('schede posizione disposizione riga laterali verticali') },
      h('div', { class: 'title' }, tr('Schede')),
      radios('tabsLayout', settings.tabsLayout, [
        { value: 'inline', title: tr('Su una riga'), desc: tr('Schede e indirizzo insieme: più spazio alla pagina.') },
        { value: 'top', title: tr('Sopra l’indirizzo'), desc: tr('Due righe, più spazio alle schede.') },
        { value: 'side', title: tr('Di lato'), desc: tr('Una colonna verticale, ridimensionabile e riducibile.') },
      ], (v) => look({ tabsLayout: v }), true),
    ),
    row(tr('Barra delle app'), tr('Compare quando colleghi un account Infomaniak: Mail, kDrive, Calendar e le altre app.'), segmented(tr('Barra delle app'), settings.railPosition, [
      { value: 'left', title: tr('A sinistra') },
      { value: 'right', title: tr('A destra') },
      { value: 'hidden', title: tr('Nascosta') },
    ], (v) => look({ railPosition: v }))),
    row(tr('Barra dei preferiti'), h('span', {}, tr('Sotto la barra degli indirizzi (Ctrl+Shift+B). '), h('a', { href: 'velo://bookmarks/' }, tr('Gestisci preferiti'))), toggle('showBookmarksBar', tr('Mostra barra dei preferiti'))),
    row(tr('Indirizzo completo'), tr('Mostra sempre “https://” e “www.”; altrimenti compaiono solo quando modifichi l’indirizzo.'), toggle('showFullUrl', tr('Mostra l’indirizzo completo'))),
    h('div', { class: 'row stack', 'data-search': tr('barra degli strumenti pulsanti personalizza ordine') },
      h('div', { class: 'text' },
        h('div', { class: 'title' }, tr('Barra degli strumenti')),
        h('div', { class: 'desc' }, tr('Trascina i pulsanti per riordinarli o spostarli; clic su un pulsante disponibile per aggiungerlo. Anche il clic destro sulla barra permette di togliere o aggiungere pulsanti.'))),
      toolbarEditor(),
    ),
    h('div', { class: 'row stack', 'data-search': tr('nuova scheda sfondo saluto app siti') },
      h('div', { class: 'title' }, tr('Pagina nuova scheda')),
      h('div', { class: 'newtab-options' },
        segmented(tr('Sfondo della nuova scheda'), settings.newTabBackground, [
          { value: 'plain', title: tr('Semplice') },
          { value: 'tint', title: tr('Tinta') },
          { value: 'gradient', title: tr('Sfumata') },
        ], (v) => look({ newTabBackground: v })),
        h('label', { class: 'check' }, checkbox('newTabShowGreeting'), tr('Saluto')),
        h('label', { class: 'check' }, checkbox('showTopSites'), tr('Siti più visitati')),
        h('label', { class: 'check' }, checkbox('newTabShowApps'), tr('Le tue app'))),
    ),
  );
}

function checkbox(key: 'newTabShowGreeting' | 'newTabShowApps' | 'showTopSites'): HTMLInputElement {
  const input = h('input', { type: 'checkbox', checked: settings[key] });
  input.addEventListener('change', () => void update({ [key]: input.checked } as Partial<Settings>));
  return input;
}

function zoomSection(): HTMLElement {
  return section(
    'zoom',
    'Zoom',
    row(tr('Zoom predefinito'), tr('Per le pagine senza uno zoom scelto da te. Ctrl + e Ctrl − cambiano lo zoom di un sito, Ctrl+0 lo ripristina.'), zoomSelect()),
    h('div', { class: 'row stack', 'data-search': tr('zoom siti ingrandimento') },
      h('div', { class: 'title' }, tr('Zoom dei siti')),
      Object.keys(settings.siteZoom).length
        ? h('ul', { class: 'list' }, ...Object.entries(settings.siteZoom).sort().map(([host, zoom]) =>
            h('li', {}, h('span', {}, h('strong', {}, host), ` · ${zoom}%`),
              h('button', { class: 'link', onclick: () => {
                const next = { ...settings.siteZoom };
                delete next[host];
                void update({ siteZoom: next }).then(render);
              } }, tr('Rimuovi')))))
        : h('p', { class: 'muted small' }, tr('Nessun sito con uno zoom personalizzato.')),
    ),
  );
}

function webEngineSelect(): HTMLElement {
  const select = h('select', { 'aria-label': tr('Motore per il web') }, ...Object.entries(WEB_SEARCH_ENGINES).map(([id, e]) => h('option', { value: id, selected: settings.webSearchEngine === id }, e.name)));
  select.addEventListener('change', () => void update({ webSearchEngine: select.value as Settings['webSearchEngine'] }));
  return select;
}

function sleepSelect(): HTMLElement {
  const label = (m: number) => (m === 0 ? tr('Mai') : m < 60 ? tr('Dopo {0} minuti', m) : m === 60 ? tr('Dopo 1 ora') : tr('Dopo {0} ore', m / 60));
  const select = h('select', { 'aria-label': tr('Metti in pausa le schede inattive') }, ...SLEEP_MINUTES.map((m) => h('option', { value: String(m), selected: settings.sleepTabsAfter === m }, label(m))));
  select.addEventListener('change', () => void update({ sleepTabsAfter: Number(select.value) }));
  return select;
}

function zoomSelect(): HTMLElement {
  const select = h('select', { 'aria-label': tr('Zoom predefinito') }, ...ZOOM_STEPS.map((z) => h('option', { value: String(z), selected: settings.defaultZoom === z }, `${z}%`)));
  select.addEventListener('change', () => void update({ defaultZoom: Number(select.value) }));
  return select;
}

async function notificationsSection(): Promise<HTMLElement> {
  const status = await internal.tokenStatus();
  const lead = h('select', { 'aria-label': tr('Anticipo del promemoria') }, ...REMINDER_MINUTES.map((m) => h('option', { value: String(m), selected: settings.eventReminderMinutes === m }, m === 60 ? tr('1 ora prima') : tr('{0} minuti prima', m))));
  lead.addEventListener('change', () => void update({ eventReminderMinutes: Number(lead.value) }));
  const message = h('span', { class: 'message', role: 'status' });
  const test = h('button', {
    onclick: async () => {
      const ok = await internal.testNotification();
      message.textContent = ok ? tr('Notifica inviata: se non la vedi, controlla le impostazioni di notifica del sistema operativo.') : tr('Il sistema operativo non supporta le notifiche.');
      message.className = `message ${ok ? 'ok' : 'error'}`;
    },
  }, tr('Prova'));
  return section(
    'notifications',
    tr('Notifiche'),
    status.configured ? null : row(tr('Collega un account Infomaniak'), h('span', {}, tr('Le notifiche usano il token API. '), h('a', { href: '#account' }, tr('Configuralo qui.'))), null),
    row(tr('Nuove email'), tr('Controlla la posta in arrivo ogni 2 minuti e ti avvisa dei nuovi messaggi. Clic sulla notifica per aprire Mail.'), toggle('notifyMail', tr('Notifiche per le nuove email'))),
    row(tr('Promemoria degli eventi'), tr('Avvisa prima dell’inizio degli eventi di Calendar (non per quelli di tutto il giorno).'), toggle('notifyEvents', tr('Promemoria degli eventi'))),
    row(tr('Anticipo del promemoria'), null, lead),
    row(tr('Prova le notifiche'), message, test),
  );
}

async function passwordsSection(): Promise<HTMLElement> {
  const status = await internal.passwordStatus();
  const state =
    status.state === 'needs-setup'
      ? tr('Il portachiavi di sistema non è disponibile: imposta una password principale per poter salvare le password.')
      : status.hasPrimary
        ? tr('Protette dalla password principale.')
        : tr('Cifrate con il portachiavi del sistema operativo.');
  return section(
    'passwords',
    'Password',
    row(tr('Offri di salvare le password'), tr('Dopo un accesso compare una barra per salvare nome utente e password.'), toggle('offerToSavePasswords', tr('Offri di salvare le password'))),
    row(tr('Avvisami se salvo una password violata'), tr('Quando salvi una password il browser controlla se compare in violazioni di dati note (Have I Been Pwned): esce solo l’inizio della sua impronta SHA-1, mai la password.'), toggle('breachCheckOnSave', tr('Avvisa per le password violate'))),
    row(tr('Compila automaticamente'), tr('Se per un sito c’è un solo accesso salvato, il modulo viene compilato all’apertura (solo su pagine HTTPS). Altrimenti clicca nel campo per scegliere.'), toggle('autofillPasswords', tr('Compila automaticamente'))),
    row(tr('Password salvate'), state, h('a', { href: 'velo://passwords/', class: 'button-link' }, tr('Gestisci password'))),
  );
}

function drmRow(): HTMLElement {
  const desc = h('span', {}, tr('Permette ai servizi di streaming (Netflix, Disney+, Prime Video, Spotify…) di riprodurre film e musica protetti con Widevine. Il modulo è di Google e viene scaricato e aggiornato dai suoi server: per questo è spento finché non lo attivi. Vale dal prossimo avvio. '));
  void internal.drmStatus().then((st) => {
    desc.append(h('span', { class: 'muted' }, !st.supported
      ? tr('Non disponibile in questa versione del browser.')
      : st.ready
        ? `Widevine ${st.version ?? ''} pronto.`
        : tr('Widevine non ancora scaricato: serve una connessione a Internet (poi riavvia il browser).')));
  });
  return row('Contenuti protetti (DRM)', desc, toggle('drmOptIn', tr('Consenti contenuti protetti')));
}

function dnsRow(): HTMLElement {
  const options: Array<[SecureDnsChoice, string]> = [
    ['automatic', tr('Automatico (consigliato)')],
    ...(Object.entries(SECURE_DNS_PROVIDERS) as Array<[SecureDnsChoice, { name: string }]>).map(([id, p]): [SecureDnsChoice, string] => [id, p.name]),
    ['custom', tr('Personalizzato…')],
    ['off', tr('Disattivato')],
  ];
  const select = h('select', { 'aria-label': tr('DNS cifrato') }, ...options.map(([id, label]) => h('option', { value: id, selected: settings.secureDns === id }, label)));
  const custom = h('input', { type: 'url', placeholder: 'https://dns.esempio.ch/dns-query', value: settings.secureDnsCustom, 'aria-label': tr('Indirizzo DNS over HTTPS'), spellcheck: false });
  const message = h('span', { class: 'message', role: 'status' });
  const note = h('span', { class: 'muted' });
  const refresh = () => {
    const choice = select.value as SecureDnsChoice;
    custom.hidden = choice !== 'custom';
    const provider = SECURE_DNS_PROVIDERS[choice as keyof typeof SECURE_DNS_PROVIDERS];
    note.textContent = choice === 'automatic'
      ? tr(' Cifrato con Quad9 (fondazione svizzera) quando è raggiungibile, altrimenti il DNS normale della rete: i siti si aprono sempre.')
      : choice === 'off'
        ? tr(' Le richieste DNS viaggiano in chiaro: il provider di rete vede i siti che apri.')
        : tr(' {0} Se il servizio non è raggiungibile (alcune reti aziendali lo bloccano) i siti non si aprono: in quel caso scegli Automatico.', provider?.note ?? '');
  };
  select.addEventListener('change', () => {
    message.textContent = '';
    refresh();
    if (select.value !== 'custom' || validDohTemplate(custom.value)) void update({ secureDns: select.value as SecureDnsChoice });
    else custom.focus();
  });
  custom.addEventListener('change', () => {
    const ok = validDohTemplate(custom.value);
    message.textContent = ok ? tr('Salvato') : tr('Serve un indirizzo https:// completo, per esempio https://dns.quad9.net/dns-query');
    message.className = `message ${ok ? 'ok' : 'error'}`;
    if (ok) void update({ secureDns: 'custom', secureDnsCustom: custom.value.trim() });
  });
  refresh();
  const desc = h('span', {}, tr('Cifra le richieste con cui il browser trova l’indirizzo dei siti, così la rete (Wi-Fi pubblico, provider) non vede quali siti apri.'), note);
  return row('DNS cifrato (DNS over HTTPS)', desc, h('div', { class: 'control stack-control' }, select, custom, message));
}

function privacySection(): HTMLElement {
  const threatDesc = h('span', {}, tr('Blocca i siti che rubano password e dati e i download di malware conosciuti, con gli elenchi pubblici usati da uBlock Origin, controllati sul tuo computer. '));
  void internal.threatStatus().then((st) => {
    threatDesc.append(h('span', { class: 'muted' }, st.entries
      ? tr('{0} siti nell’elenco{1}.', st.entries.toLocaleString(localeTag()), st.loadedAt ? tr(', aggiornato il {0}', new Date(st.loadedAt).toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' })) : '')
      : tr('Elenchi non ancora scaricati.')));
  });
  const selection: BrowsingDataSelection = { history: true, cookies: true, cache: true, downloads: false, permissions: false };
  const check = (key: keyof BrowsingDataSelection, label: string) => {
    const input = h('input', { type: 'checkbox', checked: selection[key] });
    input.addEventListener('change', () => (selection[key] = input.checked));
    return h('label', {}, input, label);
  };
  const message = h('span', { class: 'message', role: 'status' });
  const clearBtn = h('button', { class: 'primary' }, tr('Cancella dati'));
  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true;
    message.textContent = tr('Cancellazione in corso…');
    message.className = 'message';
    const res = await internal.clearData({ ...selection });
    clearBtn.disabled = false;
    message.textContent = res.ok ? tr('Dati cancellati.') : res.error;
    message.className = `message ${res.ok ? 'ok' : 'error'}`;
  });

  return section(
    'privacy',
    tr('Privacy e sicurezza'),
    row(tr('Salva la cronologia'), h('span', {}, tr('Ricorda le pagine visitate (mai nelle finestre private). '), h('a', { href: 'velo://history/' }, tr('Apri la cronologia'))), toggle('saveHistory', tr('Salva la cronologia'))),
    h('div', { class: 'row stack', 'data-search': tr('protezione tracciamento tracker pubblicità blocco annunci cookie banner') },
      h('div', { class: 'title' }, tr('Protezione dal tracciamento')),
      h('div', { class: 'desc muted small' }, tr('Blocca le richieste verso tracker e reti pubblicitarie con le liste di Ghostery (EasyList, EasyPrivacy e altre), aggiornate ogni settimana.')),
      radios('tracking', settings.trackingProtection, [
        { value: 'standard', title: 'Standard', desc: tr('Blocca pubblicità e tracker. Consigliata.') },
        { value: 'strict', title: tr('Rigorosa'), desc: tr('Blocca anche banner dei cookie e altri fastidi. Qualche sito potrebbe non funzionare.') },
        { value: 'off', title: tr('Disattivata'), desc: tr('Nessun blocco.') },
      ], (v) => void update({ trackingProtection: v }), true),
    ),
    h('div', { class: 'row stack', 'data-search': tr('impronta digitale fingerprinting canvas webgl audio anonimato') },
      h('div', { class: 'title' }, tr('Protezione dall’impronta digitale')),
      h('div', { class: 'desc muted small' }, tr('I siti possono riconoscerti senza cookie leggendo le caratteristiche del dispositivo (immagini canvas e WebGL, audio, processore, schermo, caratteri). Velo altera o uniforma questi valori.')),
      radios('fingerprint', settings.fingerprintProtection, [
        { value: 'standard', title: tr('Standard (consigliata)'), desc: tr('Valori leggermente diversi per ogni sito e a ogni avvio: un sito non può collegarti agli altri. Nessun sito smette di funzionare.') },
        { value: 'strict', title: tr('Rigorosa'), desc: tr('Valori uguali per tutti, come Tor Browser: letture canvas vuote, schermo arrotondato, lingua inglese, nessun elenco di dispositivi. Alcuni siti (editor di immagini, videochiamate) possono non funzionare.') },
        { value: 'off', title: tr('Disattivata'), desc: tr('I siti leggono i valori reali.') },
      ], (v) => void update({ fingerprintProtection: v }), true),
    ),
    row(tr('Blocca i cookie di terze parti'), tr('I contenuti di altri siti incorporati in una pagina (pulsanti social, pubblicità, tracker) non ricevono né impostano cookie tramite la rete: è il modo principale in cui ti seguono da un sito all’altro. I servizi del tuo account cloud, se collegato, non sono toccati.'), toggle('blockThirdPartyCookies', tr('Blocca cookie di terze parti'))),
    row(tr('Chiedi ai siti di non tracciarti'), tr('Invia i segnali “Do Not Track” e Global Privacy Control (GPC). In alcuni Paesi il GPC ha valore legale.'), toggle('doNotTrack', tr('Invia DNT e GPC'))),
    drmRow(),
    dnsRow(),
    h('div', { class: 'row stack', 'data-search': tr('webrtc ip indirizzo vpn videochiamate') },
      h('div', { class: 'text' },
        h('div', { class: 'title' }, tr('Protezione dell’indirizzo IP (WebRTC)')),
        h('div', { class: 'desc' }, tr('Le videochiamate nel browser (WebRTC) possono rivelare ai siti il tuo indirizzo IP, anche quello reale quando usi una VPN.'))),
      radios('webrtc', settings.webRtcProtection, [
        { value: 'standard', title: 'Standard', desc: tr('Come Chrome: indirizzi locali nascosti, IP pubblico visibile.') },
        { value: 'public', title: tr('Protetta (consigliata)'), desc: tr('Solo la connessione principale: con una VPN l’IP reale resta nascosto.') },
        { value: 'proxy', title: tr('Massima'), desc: tr('Nessun collegamento diretto: le videochiamate di altri siti potrebbero non funzionare.') },
      ], (v) => void update({ webRtcProtection: v }), true),
    ),
    row(tr('Rimuovi i parametri di tracciamento dai link'), tr('Toglie dagli indirizzi le aggiunte che servono solo a seguirti tra i siti (utm_…, fbclid, gclid, msclkid…) prima di aprire la pagina. Non vale per i siti senza protezioni.'), toggle('stripTrackingParams', tr('Rimuovi i parametri di tracciamento'))),
    row(tr('Protezione da phishing e malware'), threatDesc, toggle('threatProtection', tr('Protezione da phishing e malware'))),
    row(tr('Modalità solo HTTPS'), tr('Carica sempre le pagine in modo cifrato. Se un sito non supporta HTTPS ti viene chiesto prima di continuare.'), toggle('httpsOnly', tr('Modalità solo HTTPS'))),
    h('div', { class: 'row stack', 'data-search': tr('eccezioni siti protezione disattivata scudo') },
      h('div', { class: 'title' }, tr('Siti con protezione disattivata')),
      h('div', { class: 'desc muted small' }, tr('Aggiungili dal pulsante scudo nella barra degli indirizzi.')),
      hostList(settings.protectionExceptions, tr('Nessuna eccezione.'), (host) => void update({ protectionExceptions: settings.protectionExceptions.filter((x) => x !== host) }).then(render)),
    ),
    h('div', { class: 'row stack', 'data-search': tr('http eccezioni non sicuro') },
      h('div', { class: 'title' }, tr('Siti consentiti senza HTTPS')),
      hostList(settings.httpExceptions, tr('Nessuno.'), (host) => void update({ httpExceptions: settings.httpExceptions.filter((x) => x !== host) }).then(render)),
    ),
    h('div', { class: 'row stack', 'data-search': tr('cancella dati navigazione cookie cache cronologia download') },
      h('div', { class: 'title' }, tr('Cancella dati di navigazione')),
      h('div', { class: 'desc muted small' }, tr('Riguarda le finestre normali: le finestre private non salvano nulla. Cancellando i cookie dovrai rifare l’accesso ai siti, anche alle app web.')),
      h('div', { class: 'checks' },
        check('history', tr('Cronologia di navigazione')),
        check('cookies', tr('Cookie e dati dei siti')),
        check('cache', tr('Immagini e file nella cache')),
        check('downloads', tr('Elenco dei download')),
        check('permissions', tr('Permessi dei siti')),
      ),
      h('div', { class: 'control' }, clearBtn, message),
    ),
    row(tr('Cancella i cookie alla chiusura'), tr('Esci da tutti i siti ogni volta che chiudi il browser.'), toggle('clearCookiesOnExit', tr('Cancella cookie alla chiusura'))),
    row(tr('Svuota la cache alla chiusura'), null, toggle('clearCacheOnExit', tr('Svuota cache alla chiusura'))),
    row(tr('Finestre private'), tr('Con Ctrl+Shift+N (⌘+Shift+N su Mac) apri una finestra che non salva cronologia, cookie, cache e permessi: tutto viene eliminato quando la chiudi.'), null),
  );
}

function permissionsSection(): HTMLElement {
  const defaults = ASKABLE_PERMISSIONS.map((p: AskablePermission) => {
    const select = h('select', { 'aria-label': PERMISSION_LABELS[p] },
      h('option', { value: 'ask', selected: settings.permissionDefaults[p] === 'ask' }, tr('Chiedi')),
      h('option', { value: 'block', selected: settings.permissionDefaults[p] === 'block' }, tr('Blocca')),
    );
    select.addEventListener('change', () => void update({ permissionDefaults: { ...settings.permissionDefaults, [p]: select.value as 'ask' | 'block' } }));
    return row(PERMISSION_LABELS[p], p === 'media' ? tr('Con un account Infomaniak collegato, kMeet e kChat sono sempre consentite.') : null, select);
  });

  const decisions = settings.sitePermissions.length
    ? h('ul', { class: 'list' }, ...settings.sitePermissions.map((sp) =>
        h('li', {},
          h('span', {}, h('strong', {}, sp.host), ' · ', permissionLabel(sp.permission), ' ', h('span', { class: `tag ${sp.allowed ? 'allow' : 'block'}` }, sp.allowed ? tr('Consentito') : tr('Bloccato'))),
          h('button', {
            class: 'link',
            onclick: () => void update({ sitePermissions: settings.sitePermissions.filter((x) => !(x.host === sp.host && x.permission === sp.permission)) }).then(render),
          }, tr('Rimuovi')),
        )))
    : h('p', { class: 'muted small' }, tr('Nessuna scelta salvata.'));

  return section(
    'permissions',
    tr('Permessi dei siti'),
    ...defaults,
    h('div', { class: 'row stack', 'data-search': tr('permessi siti scelte salvate fotocamera microfono notifiche posizione') }, h('div', { class: 'title' }, tr('Scelte salvate')), decisions),
  );
}

// ---------- Sync ----------

const SYNC_COLLECTIONS: Array<[SyncCollectionOption, string]> = [
  ['bookmarks', tr('Preferiti')],
  ['logins', 'Password'],
  ['history', tr('Cronologia (ultimi 90 giorni)')],
  ['tabs', tr('Schede aperte (per riaprirle da un altro dispositivo)')],
];

function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today ? tr('oggi alle {0}', d.toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' })) : d.toLocaleString(localeTag(), { dateStyle: 'short', timeStyle: 'short' });
}

/** Encrypted sync through kDrive: the card redraws itself (no full page render while syncing). */
function syncSection(): HTMLElement {
  const card = h('div', { class: 'card' });
  const el = h('section', { id: 'sync' }, h('h2', {}, tr('Sincronizzazione')), card);
  const message = h('p', { class: 'message', role: 'status' });
  let setup: 'none' | 'create' | 'join' = 'none';
  let busy = false;

  const say = (text: string, ok = false) => {
    message.textContent = text;
    message.className = `message${text ? (ok ? ' ok' : ' error') : ''}`;
  };
  const act = async (fn: () => Promise<{ ok: boolean; error?: string } | void>, done?: string) => {
    busy = true;
    say('');
    await draw();
    const res = await fn();
    busy = false;
    if (res && 'ok' in res && !res.ok) say(res.error ?? tr('Operazione non riuscita'));
    else if (done) say(done, true);
    await draw();
  };

  const intro = () => h('div', { class: 'row stack', 'data-search': tr('sincronizzazione kdrive cifrata dispositivi passphrase') },
    h('div', { class: 'text' },
      h('div', { class: 'title' }, tr('Preferiti, password e schede su tutti i tuoi computer')),
      h('div', { class: 'desc' }, tr('I dati vengono cifrati su questo computer con una passphrase che conosci solo tu, poi salvati nella cartella «Velo Sync» del tuo kDrive. Infomaniak vede solo dati illeggibili e non può recuperare la passphrase.'))));

  const passphraseForm = (mode: 'create' | 'join' | 'unlock', status: SyncStatus) => {
    const pass = h('input', { type: 'password', autocomplete: 'new-password', placeholder: tr('Passphrase di sincronizzazione'), 'aria-label': tr('Passphrase di sincronizzazione') });
    const confirm = mode === 'create' ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: tr('Ripeti la passphrase'), 'aria-label': tr('Ripeti la passphrase') }) : null;
    const device = mode === 'unlock' ? null : h('input', { type: 'text', value: status.deviceName, placeholder: tr('Nome di questo computer'), 'aria-label': tr('Nome di questo computer') });
    const form = h('form', { class: 'sync-form' },
      h('p', { class: 'desc' },
        mode === 'create'
          ? tr('Scegli una passphrase di almeno 10 caratteri, diversa dalle altre password. Annotala in un posto sicuro: senza, i dati sincronizzati non si possono recuperare.')
          : mode === 'join'
            ? tr('La sincronizzazione è già attiva su un altro dispositivo: inserisci la stessa passphrase.')
            : tr('Questo computer non ha un portachiavi di sistema: inserisci la passphrase per riprendere la sincronizzazione.')),
      pass, confirm, device,
      h('div', { class: 'control' },
        h('button', { class: 'primary', type: 'submit', disabled: busy }, mode === 'create' ? tr('Attiva la sincronizzazione') : mode === 'join' ? tr('Collega questo computer') : tr('Sblocca')),
        mode === 'unlock' ? null : h('button', { type: 'button', onclick: () => { setup = 'none'; void draw(); } }, tr('Annulla'))));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (confirm && confirm.value !== pass.value) return say(tr('Le due passphrase non coincidono.'));
      if (pass.value.length < 10) return say(tr('La passphrase deve avere almeno 10 caratteri.'));
      void act(() => (mode === 'unlock' ? internal.sync.unlock(pass.value) : internal.sync.enable(pass.value, device?.value)), tr('Sincronizzazione attiva.')).then(() => {
        setup = 'none';
      });
    });
    queueMicrotask(() => pass.focus());
    return form;
  };

  async function draw(): Promise<void> {
    const status = await internal.sync.status();
    const rows: Node[] = [];
    if (!status.available) {
      rows.push(intro(), row(tr('Collega un account Infomaniak'), h('span', {}, tr('La sincronizzazione usa il tuo kDrive. '), h('a', { href: '#account' }, tr('Configura il token.'))), null));
    } else if (!status.enabled) {
      rows.push(intro());
      if (setup === 'none') {
        rows.push(row(tr('Attiva su questo computer'), tr('Serve una passphrase: la stessa su tutti i dispositivi.'), h('button', {
          class: 'primary',
          disabled: busy,
          onclick: () => void act(async () => {
            const res = await internal.sync.probe();
            if (res.ok) setup = res.data.exists ? 'join' : 'create';
            return res;
          }),
        }, busy ? tr('Controllo kDrive…') : tr('Attiva la sincronizzazione'))));
      } else {
        rows.push(passphraseForm(setup, status));
      }
    } else if (status.state === 'needs-passphrase') {
      rows.push(intro(), passphraseForm('unlock', status));
    } else {
      const line = status.state === 'syncing'
        ? tr('Sincronizzazione in corso…')
        : status.state === 'error'
          ? `Errore: ${status.lastError ?? 'sconosciuto'}`
          : status.lastSync ? tr('Ultima sincronizzazione {0}', when(status.lastSync)) : tr('Non ancora sincronizzato');
      rows.push(row(tr('Stato'), h('span', { class: status.state === 'error' ? 'danger-text' : '' }, line),
        h('button', { disabled: busy || status.state === 'syncing', onclick: () => void act(() => internal.sync.now(), tr('Sincronizzato.')) }, tr('Sincronizza ora'))));
      if (status.passwordsWaiting) rows.push(row(tr('Password in attesa'), tr('Le password sono bloccate dalla password principale: si sincronizzano dopo averle sbloccate.'), null));
      rows.push(h('div', { class: 'row stack', 'data-search': tr('cosa sincronizzare preferiti password cronologia schede') },
        h('div', { class: 'title' }, tr('Cosa sincronizzare')),
        h('div', { class: 'checks' }, ...SYNC_COLLECTIONS.map(([key, label]) => {
          const input = h('input', { type: 'checkbox', checked: status.collections[key] });
          input.addEventListener('change', () => void internal.sync.options({ collections: { [key]: input.checked } }));
          return h('label', {}, input, label);
        }))));
      const name = h('input', { type: 'text', value: status.deviceName, 'aria-label': tr('Nome di questo computer') });
      name.addEventListener('change', () => void internal.sync.options({ deviceName: name.value }));
      rows.push(row(tr('Nome di questo computer'), tr('Come appare sugli altri dispositivi.'), name));
      rows.push(h('div', { class: 'row stack' },
        h('div', { class: 'title' }, tr('Dispositivi collegati')),
        status.devices.length
          ? h('ul', { class: 'list' }, ...status.devices.map((d) => h('li', {},
              h('span', {}, h('strong', {}, d.name), d.current ? tr(' (questo computer)') : '', ` · ${when(d.updatedAt)}${d.tabs ? tr(' · {0} schede aperte', d.tabs) : ''}`))))
          : h('p', { class: 'muted small' }, tr('Compariranno dopo la prima sincronizzazione.'))));
      rows.push(row(tr('Disattiva su questo computer'), tr('I dati restano su questo computer e sugli altri dispositivi.'), h('button', { disabled: busy, onclick: () => void act(() => internal.sync.disable(), tr('Sincronizzazione disattivata.')) }, tr('Disattiva'))));
      rows.push(row(tr('Elimina i dati da kDrive'), tr('Cancella i file sincronizzati (vanno nel cestino di kDrive). Tutti i dispositivi dovranno riattivarla, anche con una nuova passphrase.'), h('button', {
        class: 'danger',
        disabled: busy,
        onclick: () => {
          if (confirm(tr('Eliminare i dati sincronizzati da kDrive? I dati su questo computer restano.'))) void act(() => internal.sync.reset(), tr('Dati eliminati da kDrive.'));
        },
      }, tr('Elimina'))));
    }
    rows.push(message);
    card.replaceChildren(...rows);
    applyFilter();
  }

  void draw();
  // Syncs in the background (or from another page) update the card.
  const off = internal.sync.onChange(() => {
    if (!el.isConnected) return off();
    // Don't redraw under the user's typing (a form is open).
    const typing = card.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT';
    if (!busy && !typing) void draw();
  });
  return el;
}

async function aiSection(): Promise<HTMLElement> {
  const status = await internal.tokenStatus();
  const enable = h('input', { type: 'checkbox', role: 'switch', 'aria-label': tr('Attiva assistente IA'), checked: settings.aiEnabled });
  // The rest of the section depends on this switch.
  enable.addEventListener('change', () => void update({ aiEnabled: enable.checked }).then(render));
  const rows: Array<Node | null> = [
    row(tr('Assistente IA'), tr('Attiva il pannello IA, le azioni “Chiedi all’IA” nel menu contestuale, le domande con “?” nella barra degli indirizzi e la bozza delle email.'), h('label', { class: 'switch' }, enable, h('span', {}))),
  ];
  if (!status.configured) {
    rows.push(row(tr('Collega un account Infomaniak'), h('span', {}, tr('L’assistente usa il token API. '), h('a', { href: '#account' }, tr('Configuralo qui.'))), null));
  } else if (settings.aiEnabled) {
    const message = h('span', { class: 'message', role: 'status' });
    const product = h('select', { 'aria-label': tr('Prodotto AI Services'), disabled: true }, h('option', { value: '' }, tr('Caricamento…')));
    const model = h('select', { 'aria-label': tr('Modello'), disabled: true }, h('option', { value: '' }, tr('Caricamento…')));
    product.addEventListener('change', () => void update({ aiProductId: product.value ? Number(product.value) : null }));
    model.addEventListener('change', () => void update({ aiModel: model.value || null }));
    void internal.ai.products().then((res) => {
      if (!res.ok) {
        product.replaceChildren(h('option', { value: '' }, tr('Non disponibile')));
        message.textContent = res.error;
        message.className = 'message error';
        return;
      }
      if (res.data.length === 0) {
        product.replaceChildren(h('option', { value: '' }, tr('Nessun prodotto')));
        message.textContent = tr('AI Services non è attivo su questo account: attivalo nel Manager Infomaniak.');
        message.className = 'message error';
        return;
      }
      product.replaceChildren(h('option', { value: '', selected: settings.aiProductId === null }, tr('Automatico (il primo)')),
        ...res.data.map((p) => h('option', { value: String(p.id), selected: settings.aiProductId === p.id }, `${p.name} (#${p.id})`)));
      product.disabled = false;
    });
    void internal.ai.models().then((res) => {
      const list = res.ok ? res.data : [];
      model.replaceChildren(h('option', { value: '', selected: settings.aiModel === null }, tr('Automatico (consigliato)')),
        ...list.map((m) => h('option', { value: m.name, selected: settings.aiModel === m.name, title: m.description ?? '' }, m.name)));
      // Keep a saved model visible even if the catalogue doesn't list it.
      if (settings.aiModel && !list.some((m) => m.name === settings.aiModel)) model.append(h('option', { value: settings.aiModel, selected: true }, settings.aiModel));
      model.disabled = false;
    });
    const test = h('button', {
      onclick: async () => {
        test.disabled = true;
        message.textContent = tr('Prova in corso…');
        message.className = 'message';
        const res = await internal.ai.test();
        test.disabled = false;
        message.textContent = res.ok ? `Funziona: ${res.data}` : res.error;
        message.className = `message ${res.ok ? 'ok' : 'error'}`;
      },
    }, tr('Prova'));
    rows.push(
      row(tr('Prodotto AI Services'), tr('Il prodotto del Manager Infomaniak a cui vengono addebitate le richieste.'), product),
      row(tr('Modello'), tr('Il modello linguistico usato per le risposte.'), model),
      row(tr('Risposta IA nella ricerca unificata'), tr('Mostra subito una risposta dell’IA in cima ai risultati, senza premere “Chiedi all’IA”. Ogni ricerca consuma crediti.'), toggle('aiAutoAnswer', tr('Risposta automatica nella ricerca'))),
      row(tr('Verifica la connessione'), message, test),
    );
  }
  rows.push(row(tr('Come si attiva'),
    h('span', {}, tr('Serve AI Services attivo nel Manager Infomaniak e un token API con lo scope per l’IA. '),
      h('a', { href: AI_PAGE, target: '_blank' }, tr('Scopri AI Services')), ' · ', h('a', { href: TOKEN_PAGE, target: '_blank' }, tr('Crea un token'))), null));
  rows.push(row('Privacy', tr('Il testo che scegli (una selezione, la pagina o la tua domanda) viene inviato ai server di Infomaniak in Svizzera solo quando chiedi qualcosa. Nelle finestre private la risposta automatica nella ricerca resta spenta.'), null));
  return section('ai', tr('Intelligenza artificiale'), ...rows);
}

async function accountSection(): Promise<HTMLElement> {
  const status = await internal.tokenStatus();
  const rows: Array<Node | null> = [
    h('div', { class: 'row stack', 'data-search': tr('account cloud facoltativo infomaniak kdrive mail calendario') },
      h('div', { class: 'text' },
        h('div', { class: 'title' }, tr('Facoltativo')),
        h('div', { class: 'desc' }, tr('Velo funziona del tutto senza account. Se usi i servizi di Infomaniak puoi collegarli: compaiono la barra delle app, il pannello con posta, file e calendario, il salvataggio su kDrive, la ricerca nei tuoi dati, la sincronizzazione e l’assistente IA. Il token resta su questo computer, cifrato con il portachiavi di sistema.')))),
  ];

  if (status.fromEnv) {
    rows.push(row(tr('Token API'), tr('Fornito dalla variabile d’ambiente VELO_API_TOKEN.'), null));
  } else {
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: status.configured ? tr('•••••••• (token salvato)') : tr('Incolla qui il token API'), 'aria-label': tr('Token API') });
    const message = h('span', { class: 'message', role: 'status' });
    const save = h('button', { class: 'primary', type: 'submit' }, tr('Salva e verifica'));
    const form = h('form', { class: 'control' }, input, save,
      status.configured ? h('button', { type: 'button', class: 'danger', onclick: async () => { await internal.clearToken(); void render(); } }, tr('Scollega')) : null);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      message.textContent = tr('Verifica…');
      message.className = 'message';
      const res = await internal.setToken(input.value);
      save.disabled = false;
      if (res.ok) {
        void render();
      } else {
        message.textContent = res.error;
        message.className = 'message error';
      }
    });
    rows.push(
      h('div', { class: 'row stack', 'data-search': tr('token api account cloud infomaniak scope') },
        h('div', { class: 'title' }, status.configured ? tr('Account collegato') : tr('Collega il tuo account')),
        h('ol', { class: 'steps small' },
          h('li', {}, tr('Apri la '), h('a', { href: TOKEN_PAGE, target: '_blank' }, tr('pagina dei token API')), tr(' del Manager Infomaniak.')),
          h('li', {}, tr('Crea un token con gli scope '), h('code', {}, 'user_info'), ' ', h('code', {}, 'drive'), ' ', h('code', {}, 'workspace:mail'), ' ', h('code', {}, 'workspace:calendar'), '.'),
          h('li', {}, tr('Incollalo qui sotto.')),
        ),
        form,
        message,
        status.configured && !status.encrypted ? h('p', { class: 'warning' }, tr('Il portachiavi di sistema non è disponibile: il token è salvato in chiaro nel profilo utente.')) : null,
      ),
    );
  }

  if (status.configured) {
    const drives = await internal.drives();
    if (drives.ok) {
      const select = h('select', { 'aria-label': 'kDrive' },
        h('option', { value: '' }, tr('Automatico (primo kDrive)')),
        ...drives.data.map((d) => h('option', { value: String(d.id), selected: settings.driveId === d.id }, `${d.name} (#${d.id})`)),
      );
      select.addEventListener('change', () => void update({ driveId: select.value ? Number(select.value) : null, driveUploadFolderId: 1, driveUploadFolderName: 'kDrive' }));
      rows.push(row('kDrive', tr('Quello usato dal pannello e da “Salva su kDrive”.'), select));
    } else {
      const input = h('input', { type: 'text', inputmode: 'numeric', value: settings.driveId ?? '', placeholder: tr('ID dall’URL dell’app web'), 'aria-label': tr('ID kDrive') });
      input.addEventListener('change', () => void update({ driveId: input.value ? Number(input.value) : null }));
      rows.push(row('kDrive', h('span', { class: 'message error' }, drives.error), input));
    }
    rows.push(
      row(tr('Cartella di destinazione'), tr('{0} — cambiala dal pannello kDrive con “Usa come destinazione”.', settings.driveUploadFolderName), null),
      row(tr('Carica i download su kDrive'), tr('Ogni download completato viene copiato anche nella cartella di destinazione (non nelle finestre private).'), toggle('uploadDownloadsToDrive', tr('Carica i download su kDrive'))),
    );
  }
  return section('account', tr('Account cloud'), ...rows);
}

function platformNote(): string {
  return /Mac/i.test(navigator.userAgent)
    ? tr('Su macOS l’installazione automatica richiede un’app firmata da Apple: quando esce una nuova versione ricevi un avviso e la scarichi dalla pagina della release.')
    : tr('Il pacchetto .deb non si aggiorna da solo: quando esce una nuova versione ricevi un avviso e la scarichi dalla pagina della release (oppure usa l’AppImage, che si aggiorna automaticamente).');
}

function updateRow(status: UpdateStatus): HTMLElement {
  const busy = status.state === 'checking' || status.state === 'downloading';
  let text: string;
  switch (status.state) {
    case 'checking':
      text = tr('Ricerca di aggiornamenti…');
      break;
    case 'available':
      text = status.mode === 'auto' ? tr('È disponibile la versione {0}.', status.version) : tr('È disponibile la versione {0}: scaricala dalla pagina della release.', status.version);
      break;
    case 'downloading':
      text = tr('Download della versione {0} in corso… {1}%', status.version ?? '', status.percent ?? 0);
      break;
    case 'downloaded':
      text = tr('La versione {0} è pronta: verrà installata al riavvio.', status.version);
      break;
    case 'not-available':
      text = tr('Stai usando la versione più recente.');
      break;
    case 'error':
      text = status.message ?? tr('Errore durante la ricerca di aggiornamenti.');
      break;
    default:
      text = status.mode === 'disabled' ? tr('Gli aggiornamenti funzionano solo nella versione installata (non avviando con npm start).') : tr('Controllo automatico ogni 6 ore.');
  }
  const actions = h('div', { class: 'control' });
  if (status.mode !== 'disabled') {
    if (status.state === 'downloaded') actions.append(h('button', { class: 'primary', onclick: () => void internal.updates.install() }, tr('Riavvia e aggiorna')));
    else if (status.state === 'available') actions.append(h('button', { class: 'primary', onclick: () => void internal.updates.download() }, status.mode === 'auto' ? tr('Scarica') : tr('Apri la pagina di download')));
    else actions.append(h('button', { disabled: busy, onclick: () => void internal.updates.check() }, tr('Controlla ora')));
  }
  const desc = h('span', { class: status.state === 'error' ? 'message error' : '' }, text);
  return h('div', { class: 'row', id: 'update-row', 'data-search': tr('aggiornamenti versione update') },
    h('div', { class: 'text' }, h('div', { class: 'title' }, `Versione ${status.current}`), h('div', { class: 'desc' }, desc)),
    actions,
  );
}

async function aboutSection(): Promise<HTMLElement> {
  const status = await internal.updates.status();
  const modeNote =
    status.mode === 'notify'
      ? row(tr('Aggiornamenti manuali'), platformNote(), null)
      : null;
  const autoRow = status.mode === 'auto' ? row(tr('Scarica e installa automaticamente'), tr('Gli aggiornamenti vengono scaricati in background e installati al successivo riavvio del browser.'), toggle('autoUpdate', tr('Aggiornamenti automatici'))) : null;
  const updatesCard = section('updates', tr('Aggiornamenti'), updateRow(status), autoRow, modeNote);
  const a = await internal.about();
  const item = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
  const aboutCard = section(
    'about',
    tr('Informazioni'),
    h('div', { class: 'row stack' },
      h('dl', { class: 'about' },
        ...item('Velo', a.version),
        ...item('Chromium', a.chrome),
        ...item('Electron', a.electron),
        ...item('Node.js', a.node),
        ...item(tr('Sistema'), a.platform),
        ...item(tr('Liste di blocco'), a.blockerLists ?? tr('non caricate')),
        ...item(tr('Profilo'), a.userData),
      ),
    ),
  );
  return h('div', {}, updatesCard, aboutCard);
}

// ---------- Page ----------

async function render(): Promise<void> {
  settings = await internal.settings();
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  const scroll = content.scrollTop || document.scrollingElement?.scrollTop || 0;
  const sections = [await generalSection(), appearanceSection(), layoutSection(), zoomSection(), await notificationsSection(), await passwordsSection(), privacySection(), permissionsSection(), await accountSection(), syncSection(), await aiSection(), await aboutSection()];
  content.replaceChildren(...sections);
  hydrateIcons(content);
  applyFilter();
  if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
}

function applyFilter(): void {
  const q = filter.value.trim().toLowerCase();
  for (const sectionEl of content.querySelectorAll('section')) {
    let visible = 0;
    for (const r of sectionEl.querySelectorAll<HTMLElement>('.row')) {
      const text = `${r.dataset.search ?? ''} ${r.textContent ?? ''}`.toLowerCase();
      const match = !q || text.includes(q);
      r.classList.toggle('hidden-by-filter', !match);
      if (match) visible++;
    }
    sectionEl.classList.toggle('hidden-by-filter', !!q && visible === 0);
  }
}

function highlightNav(): void {
  const id = location.hash.slice(1) || 'general';
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.nav a')) a.classList.toggle('active', a.hash === `#${id}`);
}

function scrollToHash(): void {
  highlightNav();
  const target = location.hash ? document.getElementById(location.hash.slice(1)) : null;
  target?.scrollIntoView({ block: 'start' });
}

hydrateIcons();
document.getElementById('logo')?.append(logoMark(28));
filter.addEventListener('input', applyFilter);
window.addEventListener('hashchange', scrollToHash);

// Settings changed elsewhere (another window, the shield button): refresh unless the user is typing here.
internal.onSettings(() => {
  if (ownUpdates > 0) {
    ownUpdates--;
    return;
  }
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && (active.type === 'text' || active.type === 'url' || active.type === 'password' || active.type === 'search')) return;
  void render();
});

// Live progress of update checks and downloads.
internal.updates.onChange((status) => document.getElementById('update-row')?.replaceWith(updateRow(status)));

void render().then(scrollToHash);
