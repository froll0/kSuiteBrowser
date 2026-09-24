import { h } from '../../renderer/dom';
import { ASKABLE_PERMISSIONS, REMINDER_MINUTES } from '../../shared/settings-schema';
import type { AskablePermission, BrowsingDataSelection, Settings, UpdateStatus } from '../../shared/types';
import { SEARCH_ENGINES, WEB_SEARCH_ENGINES } from '../../shared/url';
import { ZOOM_STEPS } from '../../shared/zoom';
import { hydrateIcons, logoMark } from '../../renderer/icons';
import { internal } from '../shared/bridge';

const AI_PAGE = 'https://www.infomaniak.com/it/hosting/ai-services';
const TOKEN_PAGE = 'https://manager.infomaniak.com/v3/ng/accounts/token/list';

const PERMISSION_LABELS: Record<string, string> = {
  media: 'Fotocamera e microfono',
  notifications: 'Notifiche',
  geolocation: 'Posizione',
  'clipboard-read': 'Lettura appunti',
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
  return h('ul', { class: 'list' }, ...items.map((host) => h('li', {}, h('span', {}, host), h('button', { class: 'link', onclick: () => onRemove(host) }, 'Rimuovi'))));
}

// ---------- Sections ----------

async function generalSection(): Promise<HTMLElement> {
  const home = h('input', { type: 'url', value: settings.homePage, 'aria-label': 'Pagina iniziale' });
  home.addEventListener('change', () => void update({ homePage: home.value }));

  const engine = h('select', { 'aria-label': 'Motore di ricerca' }, ...Object.entries(SEARCH_ENGINES).map(([id, e]) => h('option', { value: id, selected: settings.searchEngine === id }, e.name)));
  engine.addEventListener('change', () => void update({ searchEngine: engine.value as Settings['searchEngine'] }));

  const folder = await internal.downloadDir();
  const isDefault = await internal.defaultBrowser.status();
  const defaultMsg = h('span', { class: 'message', role: 'status' });
  const defaultBtn = isDefault
    ? null
    : h('button', {
        onclick: async () => {
          const ok = await internal.defaultBrowser.set();
          defaultMsg.textContent = ok ? 'Fatto: i link delle altre app si apriranno qui.' : 'Scegli kSuite Browser nelle impostazioni del sistema che si sono aperte (App predefinite › Browser web).';
          defaultMsg.className = `message ${ok ? 'ok' : ''}`;
          if (ok) void render();
        },
      }, 'Imposta come predefinito');
  const folderControls = h(
    'div',
    { class: 'control' },
    h('button', { onclick: async () => { if (await internal.chooseDownloadDir()) void render(); } }, 'Cambia…'),
    settings.downloadDir ? h('button', { onclick: () => void update({ downloadDir: null }).then(render) }, 'Predefinita') : null,
  );

  return section(
    'general',
    'Generale',
    row('Browser predefinito', isDefault ? 'kSuite Browser è il tuo browser predefinito: i link delle altre app si aprono qui.' : h('span', {}, 'I link delle email e delle altre app si aprono in un altro browser. ', defaultMsg), defaultBtn),
    h('div', { class: 'row stack', 'data-search': 'avvio sessione schede pagina iniziale' },
      h('div', { class: 'title' }, 'All’avvio'),
      radios('startup', settings.startup, [
        { value: 'restore', title: 'Riapri le schede della sessione precedente' },
        { value: 'home', title: 'Apri la pagina iniziale' },
      ], (v) => void update({ startup: v })),
    ),
    row('Pagina iniziale', 'Si apre all’avvio (se non riapri la sessione precedente) e nelle nuove schede se scegli così qui sotto.', home),
    h('div', { class: 'row stack', 'data-search': 'nuova scheda pagina siti più visitati' },
      h('div', { class: 'title' }, 'Le nuove schede aprono'),
      radios('newtab', settings.newTabPage, [
        { value: 'newtab', title: 'La pagina nuova scheda', desc: 'Ricerca, siti più visitati e app kSuite.' },
        { value: 'home', title: 'La pagina iniziale' },
      ], (v) => void update({ newTabPage: v }), true),
    ),
    row('Siti più visitati nella nuova scheda', 'Calcolati dalla cronologia, solo su questo computer.', toggle('showTopSites', 'Mostra siti più visitati')),
    row('Motore di ricerca', 'Usato nella barra degli indirizzi. “kSuite” cerca insieme nei tuoi dati (kDrive, email, contatti, eventi, preferiti, cronologia) e ti porta sul web con un clic.', engine),
    row('Motore per il web', 'Usato dalla ricerca kSuite per i risultati sul web.', webEngineSelect()),
    row('Cartella dei download', folder, folderControls),
    row('Chiedi dove salvare ogni file', 'Mostra la finestra “Salva con nome” per ogni download.', toggle('askDownloadLocation', 'Chiedi dove salvare')),
  );
}

function appearanceSection(): HTMLElement {
  return section(
    'appearance',
    'Aspetto',
    h('div', { class: 'row stack', 'data-search': 'tema chiaro scuro sistema' },
      h('div', { class: 'title' }, 'Tema'),
      radios('theme', settings.theme, [
        { value: 'system', title: 'Come il sistema' },
        { value: 'light', title: 'Chiaro' },
        { value: 'dark', title: 'Scuro' },
      ], (v) => {
        if (v === 'system') delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = v;
        void update({ theme: v });
      }, true),
    ),
    row('Barra laterale kSuite', 'Le icone di Mail, kDrive, Calendar e delle altre app.', toggle('showSidebar', 'Mostra barra laterale')),
    row('Barra dei preferiti', h('span', {}, 'Sotto la barra degli indirizzi (Ctrl+Shift+B). ', h('a', { href: 'ksuite://bookmarks/' }, 'Gestisci preferiti')), toggle('showBookmarksBar', 'Mostra barra dei preferiti')),
    row('Zoom predefinito', 'Per le pagine senza uno zoom scelto da te. Ctrl + e Ctrl − cambiano lo zoom di un sito, Ctrl+0 lo ripristina.', zoomSelect()),
    h('div', { class: 'row stack', 'data-search': 'zoom siti ingrandimento' },
      h('div', { class: 'title' }, 'Zoom dei siti'),
      Object.keys(settings.siteZoom).length
        ? h('ul', { class: 'list' }, ...Object.entries(settings.siteZoom).sort().map(([host, zoom]) =>
            h('li', {}, h('span', {}, h('strong', {}, host), ` · ${zoom}%`),
              h('button', { class: 'link', onclick: () => {
                const next = { ...settings.siteZoom };
                delete next[host];
                void update({ siteZoom: next }).then(render);
              } }, 'Rimuovi'))))
        : h('p', { class: 'muted small' }, 'Nessun sito con uno zoom personalizzato.'),
    ),
  );
}

function webEngineSelect(): HTMLElement {
  const select = h('select', { 'aria-label': 'Motore per il web' }, ...Object.entries(WEB_SEARCH_ENGINES).map(([id, e]) => h('option', { value: id, selected: settings.webSearchEngine === id }, e.name)));
  select.addEventListener('change', () => void update({ webSearchEngine: select.value as Settings['webSearchEngine'] }));
  return select;
}

function zoomSelect(): HTMLElement {
  const select = h('select', { 'aria-label': 'Zoom predefinito' }, ...ZOOM_STEPS.map((z) => h('option', { value: String(z), selected: settings.defaultZoom === z }, `${z}%`)));
  select.addEventListener('change', () => void update({ defaultZoom: Number(select.value) }));
  return select;
}

async function notificationsSection(): Promise<HTMLElement> {
  const status = await internal.tokenStatus();
  const lead = h('select', { 'aria-label': 'Anticipo del promemoria' }, ...REMINDER_MINUTES.map((m) => h('option', { value: String(m), selected: settings.eventReminderMinutes === m }, m === 60 ? '1 ora prima' : `${m} minuti prima`)));
  lead.addEventListener('change', () => void update({ eventReminderMinutes: Number(lead.value) }));
  const message = h('span', { class: 'message', role: 'status' });
  const test = h('button', {
    onclick: async () => {
      const ok = await internal.testNotification();
      message.textContent = ok ? 'Notifica inviata: se non la vedi, controlla le impostazioni di notifica del sistema operativo.' : 'Il sistema operativo non supporta le notifiche.';
      message.className = `message ${ok ? 'ok' : 'error'}`;
    },
  }, 'Prova');
  return section(
    'notifications',
    'Notifiche',
    status.configured ? null : row('Collega l’account kSuite', h('span', {}, 'Le notifiche usano il token API. ', h('a', { href: '#ksuite' }, 'Configuralo qui.')), null),
    row('Nuove email', 'Controlla la posta in arrivo ogni 2 minuti e ti avvisa dei nuovi messaggi. Clic sulla notifica per aprire Mail.', toggle('notifyMail', 'Notifiche per le nuove email')),
    row('Promemoria degli eventi', 'Avvisa prima dell’inizio degli eventi di Calendar (non per quelli di tutto il giorno).', toggle('notifyEvents', 'Promemoria degli eventi')),
    row('Anticipo del promemoria', null, lead),
    row('Prova le notifiche', message, test),
  );
}

async function passwordsSection(): Promise<HTMLElement> {
  const status = await internal.passwordStatus();
  const state =
    status.state === 'needs-setup'
      ? 'Il portachiavi di sistema non è disponibile: imposta una password principale per poter salvare le password.'
      : status.hasPrimary
        ? 'Protette dalla password principale.'
        : 'Cifrate con il portachiavi del sistema operativo.';
  return section(
    'passwords',
    'Password',
    row('Offri di salvare le password', 'Dopo un accesso compare una barra per salvare nome utente e password.', toggle('offerToSavePasswords', 'Offri di salvare le password')),
    row('Compila automaticamente', 'Se per un sito c’è un solo accesso salvato, il modulo viene compilato all’apertura (solo su pagine HTTPS). Altrimenti clicca nel campo per scegliere.', toggle('autofillPasswords', 'Compila automaticamente')),
    row('Password salvate', state, h('a', { href: 'ksuite://passwords/', class: 'button-link' }, 'Gestisci password')),
  );
}

function privacySection(): HTMLElement {
  const selection: BrowsingDataSelection = { history: true, cookies: true, cache: true, downloads: false, permissions: false };
  const check = (key: keyof BrowsingDataSelection, label: string) => {
    const input = h('input', { type: 'checkbox', checked: selection[key] });
    input.addEventListener('change', () => (selection[key] = input.checked));
    return h('label', {}, input, label);
  };
  const message = h('span', { class: 'message', role: 'status' });
  const clearBtn = h('button', { class: 'primary' }, 'Cancella dati');
  clearBtn.addEventListener('click', async () => {
    clearBtn.disabled = true;
    message.textContent = 'Cancellazione in corso…';
    message.className = 'message';
    const res = await internal.clearData({ ...selection });
    clearBtn.disabled = false;
    message.textContent = res.ok ? 'Dati cancellati.' : res.error;
    message.className = `message ${res.ok ? 'ok' : 'error'}`;
  });

  return section(
    'privacy',
    'Privacy e sicurezza',
    row('Salva la cronologia', h('span', {}, 'Ricorda le pagine visitate (mai nelle finestre private). ', h('a', { href: 'ksuite://history/' }, 'Apri la cronologia')), toggle('saveHistory', 'Salva la cronologia')),
    h('div', { class: 'row stack', 'data-search': 'protezione tracciamento tracker pubblicità blocco annunci cookie banner' },
      h('div', { class: 'title' }, 'Protezione dal tracciamento'),
      h('div', { class: 'desc muted small' }, 'Blocca le richieste verso tracker e reti pubblicitarie con le liste di Ghostery (EasyList, EasyPrivacy e altre), aggiornate ogni settimana.'),
      radios('tracking', settings.trackingProtection, [
        { value: 'standard', title: 'Standard', desc: 'Blocca pubblicità e tracker. Consigliata.' },
        { value: 'strict', title: 'Rigorosa', desc: 'Blocca anche banner dei cookie e altri fastidi. Qualche sito potrebbe non funzionare.' },
        { value: 'off', title: 'Disattivata', desc: 'Nessun blocco.' },
      ], (v) => void update({ trackingProtection: v }), true),
    ),
    row('Blocca i cookie di terze parti', 'I contenuti di altri siti incorporati in una pagina (pulsanti social, pubblicità, tracker) non ricevono né impostano cookie tramite la rete: è il modo principale in cui ti seguono da un sito all’altro. I servizi Infomaniak non sono toccati.', toggle('blockThirdPartyCookies', 'Blocca cookie di terze parti')),
    row('Chiedi ai siti di non tracciarti', 'Invia i segnali “Do Not Track” e Global Privacy Control (GPC). In alcuni Paesi il GPC ha valore legale.', toggle('doNotTrack', 'Invia DNT e GPC')),
    row('Modalità solo HTTPS', 'Carica sempre le pagine in modo cifrato. Se un sito non supporta HTTPS ti viene chiesto prima di continuare.', toggle('httpsOnly', 'Modalità solo HTTPS')),
    h('div', { class: 'row stack', 'data-search': 'eccezioni siti protezione disattivata scudo' },
      h('div', { class: 'title' }, 'Siti con protezione disattivata'),
      h('div', { class: 'desc muted small' }, 'Aggiungili dal pulsante scudo nella barra degli indirizzi.'),
      hostList(settings.protectionExceptions, 'Nessuna eccezione.', (host) => void update({ protectionExceptions: settings.protectionExceptions.filter((x) => x !== host) }).then(render)),
    ),
    h('div', { class: 'row stack', 'data-search': 'http eccezioni non sicuro' },
      h('div', { class: 'title' }, 'Siti consentiti senza HTTPS'),
      hostList(settings.httpExceptions, 'Nessuno.', (host) => void update({ httpExceptions: settings.httpExceptions.filter((x) => x !== host) }).then(render)),
    ),
    h('div', { class: 'row stack', 'data-search': 'cancella dati navigazione cookie cache cronologia download' },
      h('div', { class: 'title' }, 'Cancella dati di navigazione'),
      h('div', { class: 'desc muted small' }, 'Riguarda le finestre normali: le finestre private non salvano nulla. Cancellando i cookie dovrai rifare l’accesso ai siti, anche alle app kSuite.'),
      h('div', { class: 'checks' },
        check('history', 'Cronologia di navigazione'),
        check('cookies', 'Cookie e dati dei siti'),
        check('cache', 'Immagini e file nella cache'),
        check('downloads', 'Elenco dei download'),
        check('permissions', 'Permessi dei siti'),
      ),
      h('div', { class: 'control' }, clearBtn, message),
    ),
    row('Cancella i cookie alla chiusura', 'Esci da tutti i siti ogni volta che chiudi il browser.', toggle('clearCookiesOnExit', 'Cancella cookie alla chiusura')),
    row('Svuota la cache alla chiusura', null, toggle('clearCacheOnExit', 'Svuota cache alla chiusura')),
    row('Finestre private', 'Con Ctrl+Shift+N (⌘+Shift+N su Mac) apri una finestra che non salva cronologia, cookie, cache e permessi: tutto viene eliminato quando la chiudi.', null),
  );
}

function permissionsSection(): HTMLElement {
  const defaults = ASKABLE_PERMISSIONS.map((p: AskablePermission) => {
    const select = h('select', { 'aria-label': PERMISSION_LABELS[p] },
      h('option', { value: 'ask', selected: settings.permissionDefaults[p] === 'ask' }, 'Chiedi'),
      h('option', { value: 'block', selected: settings.permissionDefaults[p] === 'block' }, 'Blocca'),
    );
    select.addEventListener('change', () => void update({ permissionDefaults: { ...settings.permissionDefaults, [p]: select.value as 'ask' | 'block' } }));
    return row(PERMISSION_LABELS[p], p === 'media' ? 'Le app kSuite (kMeet, kChat) sono sempre consentite.' : null, select);
  });

  const decisions = settings.sitePermissions.length
    ? h('ul', { class: 'list' }, ...settings.sitePermissions.map((sp) =>
        h('li', {},
          h('span', {}, h('strong', {}, sp.host), ' · ', PERMISSION_LABELS[sp.permission] ?? sp.permission, ' ', h('span', { class: `tag ${sp.allowed ? 'allow' : 'block'}` }, sp.allowed ? 'Consentito' : 'Bloccato')),
          h('button', {
            class: 'link',
            onclick: () => void update({ sitePermissions: settings.sitePermissions.filter((x) => !(x.host === sp.host && x.permission === sp.permission)) }).then(render),
          }, 'Rimuovi'),
        )))
    : h('p', { class: 'muted small' }, 'Nessuna scelta salvata.');

  return section(
    'permissions',
    'Permessi dei siti',
    ...defaults,
    h('div', { class: 'row stack', 'data-search': 'permessi siti scelte salvate fotocamera microfono notifiche posizione' }, h('div', { class: 'title' }, 'Scelte salvate'), decisions),
  );
}

async function aiSection(): Promise<HTMLElement> {
  const status = await internal.tokenStatus();
  const enable = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Attiva assistente IA', checked: settings.aiEnabled });
  // The rest of the section depends on this switch.
  enable.addEventListener('change', () => void update({ aiEnabled: enable.checked }).then(render));
  const rows: Array<Node | null> = [
    row('Assistente IA', 'Attiva il pannello IA, le azioni “Chiedi all’IA” nel menu contestuale, le domande con “?” nella barra degli indirizzi e la bozza delle email.', h('label', { class: 'switch' }, enable, h('span', {}))),
  ];
  if (!status.configured) {
    rows.push(row('Collega l’account kSuite', h('span', {}, 'L’assistente usa il token API. ', h('a', { href: '#ksuite' }, 'Configuralo qui.')), null));
  } else if (settings.aiEnabled) {
    const message = h('span', { class: 'message', role: 'status' });
    const product = h('select', { 'aria-label': 'Prodotto AI Services', disabled: true }, h('option', { value: '' }, 'Caricamento…'));
    const model = h('select', { 'aria-label': 'Modello', disabled: true }, h('option', { value: '' }, 'Caricamento…'));
    product.addEventListener('change', () => void update({ aiProductId: product.value ? Number(product.value) : null }));
    model.addEventListener('change', () => void update({ aiModel: model.value || null }));
    void internal.ai.products().then((res) => {
      if (!res.ok) {
        product.replaceChildren(h('option', { value: '' }, 'Non disponibile'));
        message.textContent = res.error;
        message.className = 'message error';
        return;
      }
      if (res.data.length === 0) {
        product.replaceChildren(h('option', { value: '' }, 'Nessun prodotto'));
        message.textContent = 'AI Services non è attivo su questo account: attivalo nel Manager Infomaniak.';
        message.className = 'message error';
        return;
      }
      product.replaceChildren(h('option', { value: '', selected: settings.aiProductId === null }, 'Automatico (il primo)'),
        ...res.data.map((p) => h('option', { value: String(p.id), selected: settings.aiProductId === p.id }, `${p.name} (#${p.id})`)));
      product.disabled = false;
    });
    void internal.ai.models().then((res) => {
      const list = res.ok ? res.data : [];
      model.replaceChildren(h('option', { value: '', selected: settings.aiModel === null }, 'Automatico (consigliato)'),
        ...list.map((m) => h('option', { value: m.name, selected: settings.aiModel === m.name, title: m.description ?? '' }, m.name)));
      // Keep a saved model visible even if the catalogue doesn't list it.
      if (settings.aiModel && !list.some((m) => m.name === settings.aiModel)) model.append(h('option', { value: settings.aiModel, selected: true }, settings.aiModel));
      model.disabled = false;
    });
    const test = h('button', {
      onclick: async () => {
        test.disabled = true;
        message.textContent = 'Prova in corso…';
        message.className = 'message';
        const res = await internal.ai.test();
        test.disabled = false;
        message.textContent = res.ok ? `Funziona: ${res.data}` : res.error;
        message.className = `message ${res.ok ? 'ok' : 'error'}`;
      },
    }, 'Prova');
    rows.push(
      row('Prodotto AI Services', 'Il prodotto del Manager Infomaniak a cui vengono addebitate le richieste.', product),
      row('Modello', 'Il modello linguistico usato per le risposte.', model),
      row('Risposta IA nella ricerca kSuite', 'Mostra subito una risposta dell’IA in cima ai risultati, senza premere “Chiedi all’IA”. Ogni ricerca consuma crediti.', toggle('aiAutoAnswer', 'Risposta automatica nella ricerca')),
      row('Verifica la connessione', message, test),
    );
  }
  rows.push(row('Come si attiva',
    h('span', {}, 'Serve AI Services attivo nel Manager Infomaniak e un token API con lo scope per l’IA. ',
      h('a', { href: AI_PAGE, target: '_blank' }, 'Scopri AI Services'), ' · ', h('a', { href: TOKEN_PAGE, target: '_blank' }, 'Crea un token')), null));
  rows.push(row('Privacy', 'Il testo che scegli (una selezione, la pagina o la tua domanda) viene inviato ai server di Infomaniak in Svizzera solo quando chiedi qualcosa. Nelle finestre private la risposta automatica nella ricerca resta spenta.', null));
  return section('ai', 'Intelligenza artificiale', ...rows);
}

async function ksuiteSection(): Promise<HTMLElement> {
  const status = await internal.tokenStatus();
  const rows: Array<Node | null> = [];

  if (status.fromEnv) {
    rows.push(row('Token API', 'Fornito dalla variabile d’ambiente KSUITE_API_TOKEN.', null));
  } else {
    const input = h('input', { type: 'password', autocomplete: 'off', placeholder: status.configured ? '•••••••• (token salvato)' : 'Incolla qui il token API', 'aria-label': 'Token API' });
    const message = h('span', { class: 'message', role: 'status' });
    const save = h('button', { class: 'primary', type: 'submit' }, 'Salva e verifica');
    const form = h('form', { class: 'control' }, input, save,
      status.configured ? h('button', { type: 'button', class: 'danger', onclick: async () => { await internal.clearToken(); void render(); } }, 'Scollega') : null);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      message.textContent = 'Verifica…';
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
      h('div', { class: 'row stack', 'data-search': 'token api account kSuite infomaniak scope' },
        h('div', { class: 'title' }, status.configured ? 'Account collegato' : 'Collega il tuo account'),
        h('ol', { class: 'steps small' },
          h('li', {}, 'Apri la ', h('a', { href: TOKEN_PAGE, target: '_blank' }, 'pagina dei token API'), ' del Manager Infomaniak.'),
          h('li', {}, 'Crea un token con gli scope ', h('code', {}, 'user_info'), ' ', h('code', {}, 'drive'), ' ', h('code', {}, 'workspace:mail'), ' ', h('code', {}, 'workspace:calendar'), '.'),
          h('li', {}, 'Incollalo qui sotto.'),
        ),
        form,
        message,
        status.configured && !status.encrypted ? h('p', { class: 'warning' }, 'Il portachiavi di sistema non è disponibile: il token è salvato in chiaro nel profilo utente.') : null,
      ),
    );
  }

  if (status.configured) {
    const drives = await internal.drives();
    if (drives.ok) {
      const select = h('select', { 'aria-label': 'kDrive' },
        h('option', { value: '' }, 'Automatico (primo kDrive)'),
        ...drives.data.map((d) => h('option', { value: String(d.id), selected: settings.driveId === d.id }, `${d.name} (#${d.id})`)),
      );
      select.addEventListener('change', () => void update({ driveId: select.value ? Number(select.value) : null, driveUploadFolderId: 1, driveUploadFolderName: 'kDrive' }));
      rows.push(row('kDrive', 'Quello usato dal pannello e da “Salva su kDrive”.', select));
    } else {
      const input = h('input', { type: 'text', inputmode: 'numeric', value: settings.driveId ?? '', placeholder: 'ID dall’URL dell’app web', 'aria-label': 'ID kDrive' });
      input.addEventListener('change', () => void update({ driveId: input.value ? Number(input.value) : null }));
      rows.push(row('kDrive', h('span', { class: 'message error' }, drives.error), input));
    }
    rows.push(
      row('Cartella di destinazione', `${settings.driveUploadFolderName} — cambiala dal pannello kDrive con “Usa come destinazione”.`, null),
      row('Carica i download su kDrive', 'Ogni download completato viene copiato anche nella cartella di destinazione (non nelle finestre private).', toggle('uploadDownloadsToDrive', 'Carica i download su kDrive')),
    );
  }
  return section('ksuite', 'Account kSuite', ...rows);
}

function platformNote(): string {
  return /Mac/i.test(navigator.userAgent)
    ? 'Su macOS l’installazione automatica richiede un’app firmata da Apple: quando esce una nuova versione ricevi un avviso e la scarichi dalla pagina della release.'
    : 'Il pacchetto .deb non si aggiorna da solo: quando esce una nuova versione ricevi un avviso e la scarichi dalla pagina della release (oppure usa l’AppImage, che si aggiorna automaticamente).';
}

function updateRow(status: UpdateStatus): HTMLElement {
  const busy = status.state === 'checking' || status.state === 'downloading';
  let text: string;
  switch (status.state) {
    case 'checking':
      text = 'Ricerca di aggiornamenti…';
      break;
    case 'available':
      text = status.mode === 'auto' ? `È disponibile la versione ${status.version}.` : `È disponibile la versione ${status.version}: scaricala dalla pagina della release.`;
      break;
    case 'downloading':
      text = `Download della versione ${status.version ?? ''} in corso… ${status.percent ?? 0}%`;
      break;
    case 'downloaded':
      text = `La versione ${status.version} è pronta: verrà installata al riavvio.`;
      break;
    case 'not-available':
      text = 'Stai usando la versione più recente.';
      break;
    case 'error':
      text = status.message ?? 'Errore durante la ricerca di aggiornamenti.';
      break;
    default:
      text = status.mode === 'disabled' ? 'Gli aggiornamenti funzionano solo nella versione installata (non avviando con npm start).' : 'Controllo automatico ogni 6 ore.';
  }
  const actions = h('div', { class: 'control' });
  if (status.mode !== 'disabled') {
    if (status.state === 'downloaded') actions.append(h('button', { class: 'primary', onclick: () => void internal.updates.install() }, 'Riavvia e aggiorna'));
    else if (status.state === 'available') actions.append(h('button', { class: 'primary', onclick: () => void internal.updates.download() }, status.mode === 'auto' ? 'Scarica' : 'Apri la pagina di download'));
    else actions.append(h('button', { disabled: busy, onclick: () => void internal.updates.check() }, 'Controlla ora'));
  }
  const desc = h('span', { class: status.state === 'error' ? 'message error' : '' }, text);
  return h('div', { class: 'row', id: 'update-row', 'data-search': 'aggiornamenti versione update' },
    h('div', { class: 'text' }, h('div', { class: 'title' }, `Versione ${status.current}`), h('div', { class: 'desc' }, desc)),
    actions,
  );
}

async function aboutSection(): Promise<HTMLElement> {
  const status = await internal.updates.status();
  const modeNote =
    status.mode === 'notify'
      ? row('Aggiornamenti manuali', platformNote(), null)
      : null;
  const autoRow = status.mode === 'auto' ? row('Scarica e installa automaticamente', 'Gli aggiornamenti vengono scaricati in background e installati al successivo riavvio del browser.', toggle('autoUpdate', 'Aggiornamenti automatici')) : null;
  const updatesCard = section('updates', 'Aggiornamenti', updateRow(status), autoRow, modeNote);
  const a = await internal.about();
  const item = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
  const aboutCard = section(
    'about',
    'Informazioni',
    h('div', { class: 'row stack' },
      h('dl', { class: 'about' },
        ...item('kSuite Browser', a.version),
        ...item('Chromium', a.chrome),
        ...item('Electron', a.electron),
        ...item('Node.js', a.node),
        ...item('Sistema', a.platform),
        ...item('Liste di blocco', a.blockerLists ?? 'non caricate'),
        ...item('Profilo', a.userData),
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
  const sections = [await generalSection(), appearanceSection(), await notificationsSection(), await passwordsSection(), privacySection(), permissionsSection(), await ksuiteSection(), await aiSection(), await aboutSection()];
  content.replaceChildren(...sections);
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
    sectionEl.classList.toggle('hidden-by-filter', visible === 0);
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
