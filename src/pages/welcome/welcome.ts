import { h } from '../../renderer/dom';
import { logoMark } from '../../renderer/icons';
import { ACCENT_PRESETS } from '../../shared/appearance';
import { LOCALES, LOCALE_NAMES, tr } from '../../shared/i18n';
import type { Settings } from '../../shared/types';
import { internal } from '../shared/bridge';
import { followTheme } from '../shared/theme';

followTheme();
document.getElementById('logo')!.append(logoMark(30));

const stepEl = document.getElementById('step')!;
const dots = document.getElementById('dots')!;
const back = document.getElementById('back') as HTMLButtonElement;
const next = document.getElementById('next') as HTMLButtonElement;
const skip = document.getElementById('skip') as HTMLButtonElement;

let settings: Settings;
let localeInfo: { current: string; system: string };
let index = 0;

const set = async (patch: Partial<Settings>) => {
  settings = await internal.update(patch);
};

function card(...rows: Node[]): HTMLElement {
  return h('div', { class: 'card' }, ...rows);
}

function row(title: string, desc: string | null, control: Node): HTMLElement {
  return h('div', { class: 'row' }, h('div', { class: 'text' }, h('div', { class: 'title' }, title), desc ? h('div', { class: 'desc' }, desc) : null), h('div', { class: 'control' }, control));
}

function select<T extends string>(label: string, value: T, options: Array<[T, string]>, onChange: (v: T) => void): HTMLSelectElement {
  const el = h('select', { 'aria-label': label }, ...options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
  el.addEventListener('change', () => onChange(el.value as T));
  return el;
}

function toggle(checked: boolean, label: string, onChange: (on: boolean) => void): HTMLElement {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, checked });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'switch' }, input, h('span', {}));
}

function radios<T extends string>(name: string, value: T, options: Array<{ value: T; title: string; desc: string }>, onChange: (v: T) => void): HTMLElement {
  return h('div', { class: 'choices', role: 'radiogroup' }, ...options.map((o) => {
    const input = h('input', { type: 'radio', name, value: o.value, checked: o.value === value });
    input.addEventListener('change', () => input.checked && onChange(o.value));
    return h('label', { class: 'choice' }, input, h('div', {}, h('div', { class: 'title' }, o.title), h('div', { class: 'desc muted small' }, o.desc)));
  }));
}

interface Step {
  title: string;
  lead: string;
  body: () => Node[] | Promise<Node[]>;
}

const STEPS: Step[] = [
  {
    title: tr('Benvenuto in Velo'),
    lead: tr('Un browser che protegge la tua privacy fin dal primo clic. Bastano pochi passaggi per sceglierne l’aspetto e il livello di protezione: potrai cambiare tutto più tardi nelle impostazioni.'),
    body: () => {
      const message = h('div', { class: 'desc' });
      const showMessage = (value: Settings['language']) => {
        const target = value === 'system' ? localeInfo.system : value;
        message.textContent = target === localeInfo.current ? '' : tr('La nuova lingua si applica quando Velo si riavvia, alla fine di questi passaggi.');
      };
      const language = select<Settings['language']>(tr('Lingua'), settings.language, [['system', tr('Come il sistema ({0})', LOCALE_NAMES[localeInfo.system as 'it'])], ...LOCALES.map((l) => [l, LOCALE_NAMES[l]] as [Settings['language'], string])], (v) => {
        void set({ language: v });
        showMessage(v);
      });
      showMessage(settings.language);
      return [
        h('ul', { class: 'points' },
          h('li', {}, tr('Tracker e pubblicità invasive bloccati, protezione dall’impronta digitale del browser.')),
          h('li', {}, tr('Nessuna telemetria: Velo non invia dati sul tuo utilizzo.')),
          h('li', {}, tr('Password, cronologia e preferiti restano sul tuo computer, cifrati.'))),
        card(h('div', { class: 'row' }, h('div', { class: 'text' }, h('div', { class: 'title' }, tr('Lingua')), message), h('div', { class: 'control' }, language))),
      ];
    },
  },
  {
    title: tr('Aspetto'),
    lead: tr('Chiaro o scuro, schede in alto o di lato: scegli come preferisci vedere Velo.'),
    body: () => {
      const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': tr('Colore') });
      const renderSwatches = () => swatches.replaceChildren(...ACCENT_PRESETS.map((p) => {
        const b = h('button', {
          class: 'swatch', role: 'radio', title: p.name, 'aria-label': p.name, 'aria-checked': String(settings.accentColor === p.color),
          onclick: () => void set({ accentColor: p.color }).then(renderSwatches),
        });
        // Through CSSOM: the page's CSP doesn't allow style attributes.
        b.style.background = p.color;
        return b;
      }));
      renderSwatches();
      return [
        card(
          row(tr('Tema'), null, select<Settings['theme']>(tr('Tema'), settings.theme, [['system', tr('Come il sistema')], ['light', tr('Chiaro')], ['dark', tr('Scuro')]], (v) => void set({ theme: v }))),
          row(tr('Schede'), null, select<Settings['tabsLayout']>(tr('Schede'), settings.tabsLayout, [['inline', tr('In alto, accanto all’indirizzo')], ['top', tr('In alto, su una riga propria')], ['side', tr('In una colonna laterale')]], (v) => void set({ tabsLayout: v }))),
          h('div', { class: 'row stack' }, h('div', { class: 'title' }, tr('Colore')), swatches),
        ),
      ];
    },
  },
  {
    title: tr('Privacy e sicurezza'),
    lead: tr('Le protezioni sono già attive. Puoi renderle più severe: alcuni siti potrebbero funzionare peggio.'),
    body: () => [
      h('h3', {}, tr('Blocco dei tracker')),
      radios<Settings['trackingProtection']>('tracking', settings.trackingProtection, [
        { value: 'standard', title: tr('Standard'), desc: tr('Blocca tracker e pubblicità invasive senza rompere i siti.') },
        { value: 'strict', title: tr('Rigoroso'), desc: tr('Blocca anche più pubblicità e i tracker meno noti: qualche sito potrebbe non funzionare.') },
      ], (v) => void set({ trackingProtection: v })),
      h('h3', {}, tr('Livello di sicurezza')),
      radios<Settings['securityLevel']>('security', settings.securityLevel, [
        { value: 'standard', title: tr('Standard'), desc: tr('Tutte le funzioni dei siti.') },
        { value: 'safer', title: tr('Più sicuro'), desc: tr('Niente JavaScript sui siti non cifrati, niente WebGL e WebAssembly. Si applica al riavvio.') },
        { value: 'safest', title: tr('Il più sicuro'), desc: tr('JavaScript spento su tutti i siti: molti non funzioneranno. Si applica al riavvio.') },
      ], (v) => void set({ securityLevel: v })),
      card(row(tr('Dimentica i siti alla chiusura delle schede'), tr('Cookie e dati di un sito vengono cancellati quando ne chiudi l’ultima scheda.'), toggle(settings.forgetSitesOnClose, tr('Dimentica i siti alla chiusura delle schede'), (on) => void set({ forgetSitesOnClose: on })))),
    ],
  },
  {
    title: tr('Importa i tuoi dati'),
    lead: tr('Porta in Velo preferiti, cronologia e password dal browser che usavi finora.'),
    body: () => [
      card(
        row(tr('Preferiti'), tr('Da un file HTML esportato da qualsiasi browser.'), h('button', { onclick: () => location.assign('velo://bookmarks/') }, tr('Importa…'))),
        row(tr('Password'), tr('Da un file CSV esportato da Chrome, Firefox, Edge o da un gestore di password.'), h('button', { onclick: () => location.assign('velo://passwords/') }, tr('Importa…'))),
      ),
    ],
  },
  {
    title: tr('Account cloud (facoltativo)'),
    lead: tr('Velo funziona senza account. Se usi Infomaniak puoi collegare kDrive, Mail, Calendario e la sincronizzazione cifrata tra i tuoi computer.'),
    body: () => [
      card(row(tr('Collega un account Infomaniak'), tr('Si fa con un token personale, nelle impostazioni.'), h('button', { onclick: () => void finish('velo://settings/#account') }, tr('Collega…')))),
    ],
  },
];

async function finish(url = 'velo://newtab/'): Promise<void> {
  const target = settings.language === 'system' ? localeInfo.system : settings.language;
  await internal.welcomeFinish(url, target !== localeInfo.current);
}

async function show(i: number): Promise<void> {
  index = Math.max(0, Math.min(STEPS.length - 1, i));
  const step = STEPS[index];
  dots.replaceChildren(...STEPS.map((_, n) => h('li', { class: n < index ? 'done' : n === index ? 'current' : '', 'aria-current': n === index ? 'step' : 'false' })));
  stepEl.replaceChildren(h('h1', {}, step.title), h('p', { class: 'lead' }, step.lead), ...(await step.body()));
  back.hidden = index === 0;
  next.textContent = index === STEPS.length - 1 ? tr('Inizia a navigare') : tr('Avanti');
  skip.hidden = index === STEPS.length - 1;
  stepEl.focus();
}

back.addEventListener('click', () => void show(index - 1));
next.addEventListener('click', () => void (index === STEPS.length - 1 ? finish() : show(index + 1)));
skip.addEventListener('click', () => void finish());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target === document.body) next.click();
});

void Promise.all([internal.settings(), internal.localeInfo()]).then(([s, info]) => {
  settings = s;
  localeInfo = info;
  void show(0);
});
