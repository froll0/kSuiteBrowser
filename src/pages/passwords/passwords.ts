import { h } from '../../renderer/dom';
import { isWeakPassword } from '../../shared/password-gen';
import { faviconUrl } from '../../shared/top-sites';
import type { AutofillAddress, AutofillCard, BreachReport, SavedLogin, VaultStatus } from '../../shared/types';
import { hydrateIcons, icon } from '../../renderer/icons';
import { internal } from '../shared/bridge';
import { emptyState, iconButton, withIcon } from '../shared/ui';
import { followTheme } from '../shared/theme';
import { localeTag, tr } from '../../shared/i18n';

followTheme();

const content = document.getElementById('content')!;
const search = document.getElementById('search') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const fileInput = document.getElementById('import-file') as HTMLInputElement;
const pw = internal.passwords;

let status: VaultStatus;
let logins: SavedLogin[] = [];
let never: string[] = [];
let breaches: BreachReport = { checkedAt: null, results: {} };
let checking = false;
const revealed = new Set<string>();
let editing: string | null = null;
let adding = false;
let exporting = false;
let addresses: AutofillAddress[] = [];
let cards: AutofillCard[] = [];
/** Address or card being edited ('new' for a new one). */
let editingAddress: string | null = null;
let editingCard: string | null = null;
let codes: Record<string, { code: string; remaining: number }> = {};

function say(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.className = `status${error ? ' danger-text' : ''}`;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function passwordInput(placeholder: string, autocomplete = 'off'): HTMLInputElement {
  return h('input', { type: 'password', placeholder, 'aria-label': placeholder, autocomplete, required: true });
}

function card(title: string, ...body: Array<Node | null>): HTMLElement {
  return h('section', { class: 'group' }, h('h2', {}, title), h('div', { class: 'card-body' }, ...body));
}

// ---------- Locked / setup ----------

function unlockView(): HTMLElement {
  const input = passwordInput(tr('Password principale'), 'current-password');
  const form = h('form', {}, input, h('button', { class: 'primary', type: 'submit' }, tr('Sblocca')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await pw.unlock(input.value);
    if (res.ok) {
      say('');
      void load();
    } else {
      say(res.error, true);
      input.select();
    }
  });
  queueMicrotask(() => input.focus());
  return card(tr('Password bloccate'), h('p', { class: 'hint' }, tr('Inserisci la password principale per vedere e usare le password salvate.')), form);
}

function primaryForm(mode: 'set' | 'change'): HTMLElement {
  const current = mode === 'change' ? passwordInput(tr('Password principale attuale'), 'current-password') : null;
  const next = passwordInput(tr('Nuova password principale'), 'new-password');
  const confirmInput = passwordInput(tr('Ripeti la nuova password'), 'new-password');
  const form = h('form', {}, current, next, confirmInput, h('button', { class: 'primary', type: 'submit' }, mode === 'set' ? tr('Imposta') : tr('Cambia')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (next.value !== confirmInput.value) return say(tr('Le due password non coincidono.'), true);
    const res = await pw.setPrimary(next.value, current?.value);
    if (res.ok) {
      say(mode === 'set' ? tr('Password principale impostata.') : tr('Password principale cambiata.'));
      void load();
    } else {
      say(res.error, true);
    }
  });
  return form;
}

function setupView(): HTMLElement {
  return card(
    tr('Imposta una password principale'),
    h('p', { class: 'hint' }, tr('Il portachiavi del sistema operativo non è disponibile, quindi le password verrebbero salvate senza protezione. Scegli una password principale (almeno 8 caratteri): servirà per sbloccarle. Se la dimentichi, le password salvate non si possono recuperare.')),
    primaryForm('set'),
  );
}

// ---------- Unlocked ----------

function reusedPasswords(): Set<string> {
  const count = new Map<string, number>();
  for (const l of logins) count.set(l.password, (count.get(l.password) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([p]) => p));
}

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    say(tr('{0} copiato negli appunti.', what));
  } catch {
    say(tr('Impossibile copiare negli appunti.'), true);
  }
}

function editRow(login: SavedLogin | null): HTMLElement {
  const url = login ? null : h('input', { type: 'url', placeholder: 'https://sito.com', 'aria-label': tr('Sito'), required: true });
  const user = h('input', { type: 'text', value: login?.username ?? '', placeholder: tr('Nome utente'), 'aria-label': tr('Nome utente') });
  const pass = h('input', { type: 'text', value: login?.password ?? '', placeholder: 'Password', 'aria-label': 'Password', required: true, spellcheck: 'false' });
  const totp = h('input', { type: 'text', value: login?.totp ?? '', placeholder: tr('Chiave 2FA (facoltativa)'), 'aria-label': tr('Chiave per i codici di verifica (2FA)'), spellcheck: 'false', title: tr('Il codice di configurazione o l’indirizzo otpauth:// che il sito mostra accanto al QR code quando attivi la verifica in due passaggi') });
  const form = h('form', { class: 'edit-login' }, url, user, pass, totp,
    h('button', { type: 'button', onclick: async () => (pass.value = await pw.generate()) }, tr('Genera')),
    h('button', { class: 'primary', type: 'submit' }, tr('Salva')),
    h('button', { type: 'button', onclick: () => { editing = null; adding = false; render(); } }, tr('Annulla')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = login
      ? await pw.update(login.id, { username: user.value, password: pass.value, totp: totp.value.trim() || null })
      : await pw.add({ url: url!.value, username: user.value, password: pass.value });
    if (!res.ok) return say(res.error, true);
    if (!login && totp.value.trim() && res.data && typeof res.data === 'object' && 'id' in res.data) {
      const set = await pw.update((res.data as SavedLogin).id, { totp: totp.value.trim() });
      if (!set.ok) return say(set.error, true);
    }
    say(login ? tr('Accesso aggiornato.') : tr('Accesso aggiunto.'));
    editing = null;
    adding = false;
    void load();
  });
  queueMicrotask(() => (url ?? user).focus());
  return h('div', { class: 'entry' }, form);
}

function loginRow(login: SavedLogin, reused: Set<string>): HTMLElement {
  if (editing === login.id) return editRow(login);
  const host = hostOf(login.origin);
  const shown = revealed.has(login.id);
  return h(
    'div',
    { class: 'entry' },
    h('img', { class: 'site-icon', src: faviconUrl(login.origin), alt: '' }),
    h('div', { class: 'main' },
      h('a', { href: login.origin, title: login.origin }, host),
      h('span', { class: 'user' }, login.username || tr('(senza nome utente)')),
    ),
    (breaches.results[login.id] ?? 0) > 0
      ? h('span', { class: 'badge danger', title: tr('Compare {0} volte in violazioni di dati note: cambiala', breaches.results[login.id].toLocaleString(localeTag())) }, 'compromessa')
      : null,
    reused.has(login.password) ? h('span', { class: 'badge warn', title: tr('La stessa password è usata su più siti') }, 'riutilizzata') : null,
    isWeakPassword(login.password) ? h('span', { class: 'badge warn', title: tr('Password corta o facile da indovinare') }, 'debole') : null,
    login.totp ? totpBadge(login) : null,
    h('span', { class: 'secret', 'aria-label': shown ? 'Password' : tr('Password nascosta') }, shown ? login.password : '••••••••••'),
    h('div', { class: 'actions' },
      iconButton(shown ? 'eyeOff' : 'eye', tr('{0} la password di {1}', shown ? 'Nascondi' : 'Mostra', host), () => { shown ? revealed.delete(login.id) : revealed.add(login.id); render(); }),
      iconButton('user', tr('Copia il nome utente di {0}', host), () => void copy(login.username, tr('Nome utente'))),
      iconButton('copy', tr('Copia la password di {0}', host), () => void copy(login.password, 'Password')),
      iconButton('pencil', tr('Modifica l’accesso a {0}', host), () => { editing = login.id; render(); }),
      iconButton('trash', tr('Elimina l’accesso a {0}', host), async () => {
          if (!confirm(tr('Eliminare l’accesso di {0} a {1}?', login.username || 'questo account', host))) return;
        await pw.remove(login.id);
        say(tr('Accesso eliminato.'));
        void load();
      }),
    ),
  );
}

/** The current two-factor code, updated every second; a click copies it. */
function totpBadge(login: SavedLogin): HTMLElement {
  const host = hostOf(login.origin);
  return h('button', {
    class: 'totp', 'data-totp': login.id,
    title: tr('Codice di verifica (2FA) di {0}: clic per copiarlo', host),
    'aria-label': tr('Codice di verifica di {0}', host),
    onclick: () => void copy(codes[login.id]?.code ?? '', tr('Codice di verifica')),
  }, h('span', { class: 'code' }, formatCode(codes[login.id]?.code)), h('span', { class: 'left' }, codes[login.id] ? `${codes[login.id].remaining}s` : ''));
}

const formatCode = (code?: string) => (code ? code.replace(/^(\d{3})(\d{3,})$/, '$1 $2') : '··· ···');

async function refreshCodes(): Promise<void> {
  if (status?.state !== 'unlocked' || !logins.some((l) => l.totp) || document.hidden) return;
  const res = await pw.totp();
  if (!res.ok) return;
  codes = res.data;
  for (const el of content.querySelectorAll<HTMLElement>('[data-totp]')) {
    const c = codes[el.dataset.totp!];
    el.querySelector('.code')!.textContent = formatCode(c?.code);
    el.querySelector('.left')!.textContent = c ? `${c.remaining}s` : '';
    el.classList.toggle('ending', Boolean(c && c.remaining <= 5));
  }
}

// ---------- Addresses and cards ----------

const ADDRESS_LABELS: Array<[keyof Omit<AutofillAddress, 'id'>, string, string]> = [
  ['name', tr('Nome e cognome'), 'name'], ['organization', tr('Azienda'), 'organization'], ['street', tr('Indirizzo'), 'street-address'],
  ['postalCode', tr('CAP'), 'postal-code'], ['city', tr('Città'), 'address-level2'], ['region', tr('Provincia o regione'), 'address-level1'],
  ['country', tr('Paese'), 'country-name'], ['phone', tr('Telefono'), 'tel'], ['email', tr('Email'), 'email'],
];

function addressForm(address: AutofillAddress | null): HTMLElement {
  const inputs = ADDRESS_LABELS.map(([key, label]) => [key, h('input', { type: key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text', value: address?.[key] ?? '', placeholder: label, 'aria-label': label, autocomplete: 'off' })] as const);
  const form = h('form', { class: 'edit-grid' }, ...inputs.map(([, el]) => el),
    h('div', { class: 'buttons' },
      h('button', { class: 'primary', type: 'submit' }, tr('Salva')),
      h('button', { type: 'button', onclick: () => { editingAddress = null; render(); } }, tr('Annulla'))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await internal.autofill.saveAddress({ id: address?.id, ...Object.fromEntries(inputs.map(([k, el]) => [k, el.value])) });
    if (!res.ok) return say(res.error, true);
    editingAddress = null;
    say(tr('Indirizzo salvato.'));
    void load();
  });
  queueMicrotask(() => inputs[0][1].focus());
  return h('div', { class: 'entry' }, form);
}

function cardForm(c: AutofillCard | null): HTMLElement {
  const name = h('input', { type: 'text', value: c?.name ?? '', placeholder: tr('Titolare'), 'aria-label': tr('Titolare'), autocomplete: 'off' });
  const number = h('input', { type: 'text', value: c?.number ?? '', placeholder: tr('Numero della carta'), 'aria-label': tr('Numero della carta'), inputmode: 'numeric', autocomplete: 'off', required: true });
  const exp = h('input', { type: 'text', value: c ? `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}` : '', placeholder: tr('MM/AA'), 'aria-label': tr('Scadenza (MM/AA)'), autocomplete: 'off', required: true });
  const form = h('form', { class: 'edit-grid' }, name, number, exp,
    h('div', { class: 'buttons' },
      h('button', { class: 'primary', type: 'submit' }, tr('Salva')),
      h('button', { type: 'button', onclick: () => { editingCard = null; render(); } }, tr('Annulla'))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [mm, yy] = exp.value.split(/[/\-\s]+/);
    const res = await internal.autofill.saveCard({ id: c?.id, name: name.value, number: number.value, expMonth: Number(mm), expYear: Number(yy) });
    if (!res.ok) return say(res.error, true);
    editingCard = null;
    say(tr('Carta salvata.'));
    void load();
  });
  queueMicrotask(() => number.focus());
  return h('div', { class: 'entry' }, form);
}

function addressesSection(): HTMLElement {
  const rows = addresses.map((a) => editingAddress === a.id ? addressForm(a) : h('div', { class: 'entry' },
    h('span', { class: 'letter' }, (a.name || a.email || '?').slice(0, 1).toUpperCase()),
    h('div', { class: 'main' }, h('span', { class: 'strong' }, a.name || a.email), h('span', { class: 'host' }, [a.street, a.postalCode, a.city, a.country].filter(Boolean).join(', '))),
    h('div', { class: 'actions' },
      iconButton('pencil', tr('Modifica l’indirizzo'), () => { editingAddress = a.id; render(); }),
      iconButton('trash', tr('Elimina l’indirizzo'), async () => { await internal.autofill.removeAddress(a.id); void load(); }))));
  return h('section', { class: 'group', id: 'addresses' },
    h('h2', {}, tr('Indirizzi'), h('button', { class: 'link add', onclick: () => { editingAddress = 'new'; render(); } }, tr('Aggiungi'))),
    ...(editingAddress === 'new' ? [addressForm(null)] : []),
    ...(rows.length ? rows : editingAddress === 'new' ? [] : [emptyState('mapPin', tr('Nessun indirizzo. Quelli salvati compaiono quando fai clic in un modulo di spedizione o di contatto.'))]));
}

function cardsSection(): HTMLElement {
  const rows = cards.map((c) => editingCard === c.id ? cardForm(c) : h('div', { class: 'entry' },
    h('span', { class: 'letter' }, icon('card', 14)),
    h('div', { class: 'main' }, h('span', { class: 'strong' }, `•••• ${c.number.slice(-4)}`), h('span', { class: 'host' }, `${String(c.expMonth).padStart(2, '0')}/${c.expYear}${c.name ? ` · ${c.name}` : ''}`)),
    h('div', { class: 'actions' },
      iconButton('pencil', tr('Modifica la carta'), () => { editingCard = c.id; render(); }),
      iconButton('trash', tr('Elimina la carta'), async () => { await internal.autofill.removeCard(c.id); void load(); }))));
  return h('section', { class: 'group', id: 'cards' },
    h('h2', {}, tr('Carte di pagamento'), h('button', { class: 'link add', onclick: () => { editingCard = 'new'; render(); } }, tr('Aggiungi'))),
    h('p', { class: 'hint pad' }, tr('Il codice di sicurezza (CVC) non viene mai salvato. Le carte si compilano solo sui siti con connessione sicura.')),
    ...(editingCard === 'new' ? [cardForm(null)] : []),
    ...(rows.length ? rows : editingCard === 'new' ? [] : [emptyState('card', tr('Nessuna carta salvata.'))]));
}

function exportForm(): HTMLElement {
  const input = status.hasPrimary ? passwordInput(tr('Password principale'), 'current-password') : null;
  const form = h('form', {},
    h('p', { class: 'hint danger-text' }, tr('Il file conterrà tutte le password in chiaro: chiunque lo apra potrà leggerle. Cancellalo dopo averlo importato altrove.')),
    input,
    h('button', { class: 'primary', type: 'submit' }, tr('Esporta file CSV')),
    h('button', { type: 'button', onclick: () => { exporting = false; render(); } }, tr('Annulla')),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await pw.exportCsv(input?.value);
    if (!res.ok) return say(res.error, true);
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = h('a', { href: url, download: tr('password-velo-{0}.csv', new Date().toISOString().slice(0, 10)) });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    exporting = false;
    say(tr('File esportato nella cartella dei download.'));
    render();
  });
  return card(tr('Esporta password'), form);
}

/** Check against known data breaches (Have I Been Pwned), run on request. */
function breachCard(breachedCount: number): HTMLElement {
  const button = withIcon(h('button', {
    class: breaches.checkedAt ? '' : 'primary',
    disabled: checking,
    onclick: async () => {
      checking = true;
      render();
      const res = await pw.checkBreaches();
      checking = false;
      if (res.ok) {
        breaches = res.data;
        const n = logins.filter((l) => (breaches.results[l.id] ?? 0) > 0).length;
        say(n ? tr('{0} password compaiono in violazioni note.', n) : tr('Nessuna password compare in violazioni note.'));
      } else {
        say(tr('Controllo non riuscito: {0}', res.error), true);
      }
      render();
    },
  }, checking ? tr('Controllo in corso…') : breaches.checkedAt ? tr('Controlla di nuovo') : tr('Controlla ora')), 'shieldCheck');
  const how = h('p', { class: 'hint' }, tr('Il controllo usa Have I Been Pwned: dal computer esce solo l’inizio (5 caratteri) dell’impronta SHA-1 di ogni password, mai la password. Il confronto avviene qui.'));
  let title: string;
  let text: string;
  let tone: string;
  if (!breaches.checkedAt) {
    title = tr('Password compromesse');
    text = tr('Controlla se qualcuna delle tue password compare nei dati rubati durante attacchi informatici noti.');
    tone = '';
  } else if (breachedCount > 0) {
    title = `${breachedCount} ${breachedCount === 1 ? tr('password compromessa') : tr('password compromesse')}`;
    text = tr('Queste password circolano tra i dati rubati: chi attacca le prova per prime. Cambiale sui siti segnati con “compromessa”, scegliendo una password nuova e diversa per ogni sito.');
    tone = ' danger';
  } else {
    title = tr('Nessuna password compromessa');
    text = tr('Nessuna delle tue password compare in violazioni note (controllo delle {0}).', new Date(breaches.checkedAt).toLocaleTimeString(localeTag(), { hour: '2-digit', minute: '2-digit' }));
    tone = ' ok';
  }
  return h('section', { class: `breach-card${tone}` },
    h('div', { class: 'breach-text' }, h('h2', {}, title), h('p', {}, text), how),
    button);
}

function unlockedView(): Node[] {
  const q = search.value.trim().toLowerCase();
  const reused = reusedPasswords();
  const visible = logins.filter((l) => !q || `${l.origin} ${l.username}`.toLowerCase().includes(q));
  const weak = logins.filter((l) => isWeakPassword(l.password)).length;
  const reusedCount = logins.filter((l) => reused.has(l.password)).length;
  const breachedCount = logins.filter((l) => (breaches.results[l.id] ?? 0) > 0).length;

  const nodes: Node[] = [
    h('div', { class: 'toolbar' },
      withIcon(h('button', { class: 'primary', onclick: () => { adding = true; editing = null; render(); } }, tr('Aggiungi')), 'plus'),
      withIcon(h('button', { onclick: () => fileInput.click() }, tr('Importa CSV…')), 'upload'),
      withIcon(h('button', { disabled: logins.length === 0, onclick: () => { exporting = true; render(); } }, tr('Esporta CSV')), 'download'),
      status.hasPrimary ? withIcon(h('button', { onclick: async () => { await pw.lock(); revealed.clear(); void load(); } }, tr('Blocca ora')), 'lock') : null,
    ),
    h('p', { class: 'summary' },
      h('span', {}, h('strong', {}, String(logins.length)), tr(' password salvate')),
      h('span', {}, h('strong', {}, String(reusedCount)), ' riutilizzate'),
      h('span', {}, h('strong', {}, String(weak)), ' deboli'),
      breaches.checkedAt ? h('span', {}, h('strong', {}, String(breachedCount)), ' compromesse') : null,
    ),
  ];
  if (logins.length) nodes.push(breachCard(breachedCount));
  if (exporting) nodes.push(exportForm());
  if (adding) nodes.push(h('section', { class: 'group' }, h('h2', {}, tr('Nuovo accesso')), editRow(null)));
  nodes.push(
    h('section', { class: 'group' },
      h('h2', {}, q ? `Risultati (${visible.length})` : tr('Password salvate')),
      ...(visible.length ? visible.map((l) => loginRow(l, reused)) : [emptyState(q ? 'search' : 'key', q ? tr('Nessun risultato.') : tr('Nessuna password salvata. Accedi a un sito e scegli “Salva” nella barra che compare.'))]),
    ),
  );
  if (never.length) {
    nodes.push(h('section', { class: 'group' },
      h('h2', {}, tr('Siti in cui non salvare mai')),
      ...never.map((origin) => h('div', { class: 'entry' },
        h('div', { class: 'main' }, h('span', {}, hostOf(origin))),
        h('div', { class: 'actions' }, h('button', { class: 'link', onclick: async () => { await pw.removeNever(origin); void load(); } }, tr('Rimuovi'))),
      )),
    ));
  }
  nodes.push(addressesSection(), cardsSection(), primarySection());
  return nodes;
}

function primarySection(): HTMLElement {
  if (!status.hasPrimary) {
    return card(tr('Password principale'),
      h('p', { class: 'hint' }, tr('Aggiunge una protezione: le password restano bloccate finché non inserisci la password principale, e si bloccano da sole dopo 30 minuti di inattività. Se la dimentichi non potrai recuperarle.')),
      primaryForm('set'),
    );
  }
  const current = passwordInput(tr('Password principale attuale'), 'current-password');
  const remove = h('form', {}, current, h('button', { class: 'danger', type: 'submit' }, tr('Rimuovi la password principale')));
  remove.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await pw.removePrimary(current.value);
    if (res.ok) {
      say(tr('Password principale rimossa: le password sono protette dal portachiavi di sistema.'));
      void load();
    } else {
      say(res.error, true);
    }
  });
  return card(tr('Password principale'),
    h('p', { class: 'hint' }, tr('Attiva. Le password si bloccano dopo 30 minuti di inattività.')),
    primaryForm('change'),
    status.keychainAvailable ? remove : null,
  );
}

function render(): void {
  if (status.state === 'locked') content.replaceChildren(unlockView());
  else if (status.state === 'needs-setup') content.replaceChildren(setupView());
  else content.replaceChildren(...unlockedView());
  search.disabled = status.state !== 'unlocked';
}

async function load(): Promise<void> {
  status = await pw.status();
  if (status.state === 'unlocked') {
    const [list, nv] = await Promise.all([pw.list(), pw.never()]);
    if (!list.ok) {
      status = await pw.status();
      say(list.error, true);
    } else {
      logins = list.data;
      never = nv.ok ? nv.data : [];
      breaches = await pw.breaches();
      const af = await internal.autofill.list();
      if (af.ok) ({ addresses, cards } = af.data);
      const c = await pw.totp();
      codes = c.ok ? c.data : {};
    }
  } else {
    logins = [];
    never = [];
    addresses = [];
    cards = [];
    codes = {};
  }
  render();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

setInterval(() => void refreshCodes(), 1000);

hydrateIcons();
search.addEventListener('input', render);
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const res = await pw.importCsv(await file.text());
  if (!res.ok) return say(res.error, true);
  say(res.data ? `Importati ${res.data} accessi.` : tr('Nessun accesso trovato nel file (servono le colonne url, username e password).'), !res.data);
  void load();
});

void load();
