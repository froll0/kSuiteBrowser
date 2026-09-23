import { h } from '../../renderer/dom';
import { isWeakPassword } from '../../shared/password-gen';
import type { SavedLogin, VaultStatus } from '../../shared/types';
import { internal } from '../shared/bridge';

const content = document.getElementById('content')!;
const search = document.getElementById('search') as HTMLInputElement;
const statusEl = document.getElementById('status')!;
const fileInput = document.getElementById('import-file') as HTMLInputElement;
const pw = internal.passwords;

let status: VaultStatus;
let logins: SavedLogin[] = [];
let never: string[] = [];
const revealed = new Set<string>();
let editing: string | null = null;
let adding = false;
let exporting = false;

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
  const input = passwordInput('Password principale', 'current-password');
  const form = h('form', {}, input, h('button', { class: 'primary', type: 'submit' }, 'Sblocca'));
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
  return card('Password bloccate', h('p', { class: 'hint' }, 'Inserisci la password principale per vedere e usare le password salvate.'), form);
}

function primaryForm(mode: 'set' | 'change'): HTMLElement {
  const current = mode === 'change' ? passwordInput('Password principale attuale', 'current-password') : null;
  const next = passwordInput('Nuova password principale', 'new-password');
  const confirmInput = passwordInput('Ripeti la nuova password', 'new-password');
  const form = h('form', {}, current, next, confirmInput, h('button', { class: 'primary', type: 'submit' }, mode === 'set' ? 'Imposta' : 'Cambia'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (next.value !== confirmInput.value) return say('Le due password non coincidono.', true);
    const res = await pw.setPrimary(next.value, current?.value);
    if (res.ok) {
      say(mode === 'set' ? 'Password principale impostata.' : 'Password principale cambiata.');
      void load();
    } else {
      say(res.error, true);
    }
  });
  return form;
}

function setupView(): HTMLElement {
  return card(
    'Imposta una password principale',
    h('p', { class: 'hint' }, 'Il portachiavi del sistema operativo non è disponibile, quindi le password verrebbero salvate senza protezione. Scegli una password principale (almeno 8 caratteri): servirà per sbloccarle. Se la dimentichi, le password salvate non si possono recuperare.'),
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
    say(`${what} copiato negli appunti.`);
  } catch {
    say('Impossibile copiare negli appunti.', true);
  }
}

function editRow(login: SavedLogin | null): HTMLElement {
  const url = login ? null : h('input', { type: 'url', placeholder: 'https://sito.com', 'aria-label': 'Sito', required: true });
  const user = h('input', { type: 'text', value: login?.username ?? '', placeholder: 'Nome utente', 'aria-label': 'Nome utente' });
  const pass = h('input', { type: 'text', value: login?.password ?? '', placeholder: 'Password', 'aria-label': 'Password', required: true, spellcheck: 'false' });
  const form = h('form', { class: 'edit-login' }, url, user, pass,
    h('button', { type: 'button', onclick: async () => (pass.value = await pw.generate()) }, 'Genera'),
    h('button', { class: 'primary', type: 'submit' }, 'Salva'),
    h('button', { type: 'button', onclick: () => { editing = null; adding = false; render(); } }, 'Annulla'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = login
      ? await pw.update(login.id, { username: user.value, password: pass.value })
      : await pw.add({ url: url!.value, username: user.value, password: pass.value });
    if (!res.ok) return say(res.error, true);
    say(login ? 'Accesso aggiornato.' : 'Accesso aggiunto.');
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
    h('span', { class: 'letter', 'aria-hidden': 'true' }, host.replace(/^www\./, '').slice(0, 1).toUpperCase()),
    h('div', { class: 'main' },
      h('a', { href: login.origin, title: login.origin }, host),
      h('span', { class: 'user' }, login.username || '(senza nome utente)'),
    ),
    reused.has(login.password) ? h('span', { class: 'badge warn', title: 'La stessa password è usata su più siti' }, 'riutilizzata') : null,
    isWeakPassword(login.password) ? h('span', { class: 'badge warn', title: 'Password corta o facile da indovinare' }, 'debole') : null,
    h('span', { class: 'secret', 'aria-label': shown ? 'Password' : 'Password nascosta' }, shown ? login.password : '••••••••••'),
    h('div', { class: 'actions' },
      h('button', { class: 'icon', title: shown ? 'Nascondi' : 'Mostra', 'aria-label': `${shown ? 'Nascondi' : 'Mostra'} la password di ${host}`, onclick: () => { shown ? revealed.delete(login.id) : revealed.add(login.id); render(); } }, shown ? '🙈' : '👁'),
      h('button', { class: 'icon', title: 'Copia nome utente', 'aria-label': `Copia il nome utente di ${host}`, onclick: () => void copy(login.username, 'Nome utente') }, '👤'),
      h('button', { class: 'icon', title: 'Copia password', 'aria-label': `Copia la password di ${host}`, onclick: () => void copy(login.password, 'Password') }, '⧉'),
      h('button', { class: 'icon', title: 'Modifica', 'aria-label': `Modifica l’accesso a ${host}`, onclick: () => { editing = login.id; render(); } }, '✎'),
      h('button', {
        class: 'icon',
        title: 'Elimina',
        'aria-label': `Elimina l’accesso a ${host}`,
        onclick: async () => {
          if (!confirm(`Eliminare l’accesso di ${login.username || 'questo account'} a ${host}?`)) return;
          await pw.remove(login.id);
          say('Accesso eliminato.');
          void load();
        },
      }, '✕'),
    ),
  );
}

function exportForm(): HTMLElement {
  const input = status.hasPrimary ? passwordInput('Password principale', 'current-password') : null;
  const form = h('form', {},
    h('p', { class: 'hint danger-text' }, 'Il file conterrà tutte le password in chiaro: chiunque lo apra potrà leggerle. Cancellalo dopo averlo importato altrove.'),
    input,
    h('button', { class: 'primary', type: 'submit' }, 'Esporta file CSV'),
    h('button', { type: 'button', onclick: () => { exporting = false; render(); } }, 'Annulla'),
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await pw.exportCsv(input?.value);
    if (!res.ok) return say(res.error, true);
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
    const a = h('a', { href: url, download: `password-ksuite-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    exporting = false;
    say('File esportato nella cartella dei download.');
    render();
  });
  return card('Esporta password', form);
}

function unlockedView(): Node[] {
  const q = search.value.trim().toLowerCase();
  const reused = reusedPasswords();
  const visible = logins.filter((l) => !q || `${l.origin} ${l.username}`.toLowerCase().includes(q));
  const weak = logins.filter((l) => isWeakPassword(l.password)).length;
  const reusedCount = logins.filter((l) => reused.has(l.password)).length;

  const nodes: Node[] = [
    h('div', { class: 'toolbar' },
      h('button', { class: 'primary', onclick: () => { adding = true; editing = null; render(); } }, 'Aggiungi'),
      h('button', { onclick: () => fileInput.click() }, 'Importa CSV…'),
      h('button', { disabled: logins.length === 0, onclick: () => { exporting = true; render(); } }, 'Esporta CSV'),
      status.hasPrimary ? h('button', { onclick: async () => { await pw.lock(); revealed.clear(); void load(); } }, 'Blocca ora') : null,
    ),
    h('p', { class: 'summary' },
      h('span', {}, h('strong', {}, String(logins.length)), ' password salvate'),
      h('span', {}, h('strong', {}, String(reusedCount)), ' riutilizzate'),
      h('span', {}, h('strong', {}, String(weak)), ' deboli'),
    ),
  ];
  if (exporting) nodes.push(exportForm());
  if (adding) nodes.push(h('section', { class: 'group' }, h('h2', {}, 'Nuovo accesso'), editRow(null)));
  nodes.push(
    h('section', { class: 'group' },
      h('h2', {}, q ? `Risultati (${visible.length})` : 'Password salvate'),
      ...(visible.length ? visible.map((l) => loginRow(l, reused)) : [h('p', { class: 'empty' }, q ? 'Nessun risultato.' : 'Nessuna password salvata. Accedi a un sito e scegli “Salva” nella barra che compare.')]),
    ),
  );
  if (never.length) {
    nodes.push(h('section', { class: 'group' },
      h('h2', {}, 'Siti in cui non salvare mai'),
      ...never.map((origin) => h('div', { class: 'entry' },
        h('div', { class: 'main' }, h('span', {}, hostOf(origin))),
        h('div', { class: 'actions' }, h('button', { class: 'link', onclick: async () => { await pw.removeNever(origin); void load(); } }, 'Rimuovi')),
      )),
    ));
  }
  nodes.push(primarySection());
  return nodes;
}

function primarySection(): HTMLElement {
  if (!status.hasPrimary) {
    return card('Password principale',
      h('p', { class: 'hint' }, 'Aggiunge una protezione: le password restano bloccate finché non inserisci la password principale, e si bloccano da sole dopo 30 minuti di inattività. Se la dimentichi non potrai recuperarle.'),
      primaryForm('set'),
    );
  }
  const current = passwordInput('Password principale attuale', 'current-password');
  const remove = h('form', {}, current, h('button', { class: 'danger', type: 'submit' }, 'Rimuovi la password principale'));
  remove.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await pw.removePrimary(current.value);
    if (res.ok) {
      say('Password principale rimossa: le password sono protette dal portachiavi di sistema.');
      void load();
    } else {
      say(res.error, true);
    }
  });
  return card('Password principale',
    h('p', { class: 'hint' }, 'Attiva. Le password si bloccano dopo 30 minuti di inattività.'),
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
    }
  } else {
    logins = [];
    never = [];
  }
  render();
}

search.addEventListener('input', render);
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  const res = await pw.importCsv(await file.text());
  if (!res.ok) return say(res.error, true);
  say(res.data ? `Importati ${res.data} accessi.` : 'Nessun accesso trovato nel file (servono le colonne url, username e password).', !res.data);
  void load();
});

void load();
