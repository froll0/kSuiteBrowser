import { h } from '../../renderer/dom';
import { ASKABLE_PERMISSIONS } from '../../shared/settings-schema';
import type { AskablePermission, BrowsingDataSelection, Settings } from '../../shared/types';
import { SEARCH_ENGINES } from '../../shared/url';
import { ZOOM_STEPS } from '../../shared/zoom';
import { internal } from '../shared/bridge';

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
  const folderControls = h(
    'div',
    { class: 'control' },
    h('button', { onclick: async () => { if (await internal.chooseDownloadDir()) void render(); } }, 'Cambia…'),
    settings.downloadDir ? h('button', { onclick: () => void update({ downloadDir: null }).then(render) }, 'Predefinita') : null,
  );

  return section(
    'general',
    'Generale',
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
    row('Motore di ricerca', 'Usato nella barra degli indirizzi.', engine),
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

function zoomSelect(): HTMLElement {
  const select = h('select', { 'aria-label': 'Zoom predefinito' }, ...ZOOM_STEPS.map((z) => h('option', { value: String(z), selected: settings.defaultZoom === z }, `${z}%`)));
  select.addEventListener('change', () => void update({ defaultZoom: Number(select.value) }));
  return select;
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

async function aboutSection(): Promise<HTMLElement> {
  const a = await internal.about();
  const item = (k: string, v: string) => [h('dt', {}, k), h('dd', {}, v)];
  return section(
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
}

// ---------- Page ----------

async function render(): Promise<void> {
  settings = await internal.settings();
  if (settings.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = settings.theme;
  const scroll = content.scrollTop || document.scrollingElement?.scrollTop || 0;
  const sections = [await generalSection(), appearanceSection(), await passwordsSection(), privacySection(), permissionsSection(), await ksuiteSection(), await aboutSection()];
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

void render().then(scrollToHash);
