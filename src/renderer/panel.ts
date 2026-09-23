import type { ApiResult, DownloadItemState, DriveFile, OutgoingMail } from '../shared/types';
import { ks } from './bridge';
import { formatBytes, formatDateTime, h } from './dom';

export type PanelView = 'home' | 'drive' | 'mail' | 'calendar' | 'downloads';

const VIEWS: Array<{ id: PanelView; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'drive', label: 'kDrive' },
  { id: 'mail', label: 'Mail' },
  { id: 'calendar', label: 'Agenda' },
  { id: 'downloads', label: 'Download' },
];

type Notify = (kind: 'info' | 'success' | 'error', message: string) => void;

/** The kSuite side panel: dashboard, kDrive browser, mail, agenda, downloads and settings. */
export class Panel {
  private view: PanelView = 'home';
  private driveStack: Array<{ id: number; name: string }> = [{ id: 1, name: 'kDrive' }];
  private draft: OutgoingMail = { to: '', subject: '', body: '' };
  private downloads: DownloadItemState[] = [];
  /** Incremented on every render so late API answers for an old view are dropped. */
  private renderSeq = 0;

  constructor(
    private readonly tabsEl: HTMLElement,
    private readonly bodyEl: HTMLElement,
    private readonly notify: Notify,
    private readonly onUnreadChange: (count: number | null) => void,
  ) {
    ks.events.onDownloads((items) => {
      this.downloads = items;
      if (this.view === 'downloads') void this.render();
    });
    void ks.downloads.list().then((items) => (this.downloads = items));
  }

  show(view: PanelView): void {
    this.view = view;
    void this.render();
  }

  current(): PanelView {
    return this.view;
  }

  compose(mail: OutgoingMail): void {
    this.draft = { ...mail };
    this.show('mail');
  }

  async render(): Promise<void> {
    const seq = ++this.renderSeq;
    this.tabsEl.replaceChildren(
      ...VIEWS.map((v) =>
        h('button', { role: 'tab', 'aria-selected': String(v.id === this.view), class: v.id === this.view ? 'active' : '', onclick: () => this.show(v.id) }, v.label),
      ),
      h('button', { class: 'settings-link', title: 'Impostazioni kSuite', onclick: () => void ks.openSettingsPage('ksuite') }, '⚙'),
    );

    const status = await ks.token.status();
    if (!status.configured && this.view !== 'downloads') {
      this.mount(seq, this.noTokenView());
      return;
    }

    const container = h('div', { class: 'panel-view' }, h('p', { class: 'muted' }, 'Caricamento…'));
    this.mount(seq, container);
    const content = await this.build(this.view);
    if (seq === this.renderSeq) container.replaceChildren(...content);
  }

  private mount(seq: number, el: HTMLElement): void {
    if (seq === this.renderSeq) this.bodyEl.replaceChildren(el);
  }

  private async build(view: PanelView): Promise<Node[]> {
    switch (view) {
      case 'home':
        return this.homeView();
      case 'drive':
        return this.driveView();
      case 'mail':
        return this.mailView();
      case 'calendar':
        return this.calendarView();
      case 'downloads':
        return this.downloadsView();
    }
  }

  private noTokenView(): HTMLElement {
    return h(
      'div',
      { class: 'panel-view' },
      h('h2', {}, 'Collega il tuo account kSuite'),
      h('p', {}, 'Le app della suite funzionano già dalla barra laterale. Per le funzioni integrate (kDrive, Mail, Agenda nel pannello) serve un token API personale.'),
      h('button', { class: 'primary', onclick: () => void ks.openSettingsPage('ksuite') }, 'Configura il token'),
    );
  }

  // ---------- Home ----------

  private async homeView(): Promise<Node[]> {
    const [profile, mail, events] = await Promise.all([ks.api.profile(), ks.api.mailOverview(), ks.api.calendarUpcoming()]);
    this.onUnreadChange(mail.ok ? mail.data.inboxUnread : null);

    const nodes: Node[] = [];
    if (profile.ok) {
      nodes.push(
        h(
          'div',
          { class: 'profile' },
          profile.data.avatar ? h('img', { src: profile.data.avatar, alt: '' }) : h('div', { class: 'avatar' }, profile.data.displayName.slice(0, 1)),
          h('div', {}, h('strong', {}, profile.data.displayName), h('div', { class: 'muted' }, profile.data.email)),
        ),
      );
    } else {
      nodes.push(errorBox(profile.error));
    }

    nodes.push(
      h(
        'div',
        { class: 'cards' },
        h('button', { class: 'card', onclick: () => this.show('mail') }, h('span', { class: 'big' }, mail.ok ? String(mail.data.inboxUnread) : '–'), 'email non lette'),
        h('button', { class: 'card', onclick: () => this.show('calendar') }, h('span', { class: 'big' }, events.ok ? String(countToday(events.data)) : '–'), 'eventi oggi'),
      ),
    );

    nodes.push(h('h3', {}, 'Prossimi eventi'));
    if (events.ok) {
      const next = events.data.filter((e) => Date.parse(e.end) >= Date.now()).slice(0, 4);
      nodes.push(next.length ? h('ul', { class: 'list' }, ...next.map(eventItem)) : h('p', { class: 'muted' }, 'Nessun evento nei prossimi 7 giorni.'));
    } else {
      nodes.push(errorBox(events.error));
    }

    nodes.push(h('h3', {}, 'Ultime email'));
    if (mail.ok) {
      nodes.push(h('ul', { class: 'list' }, ...mail.data.threads.slice(0, 5).map((t) => mailItem(t))));
    } else {
      nodes.push(errorBox(mail.error));
    }

    nodes.push(
      h('h3', {}, 'Azioni rapide'),
      h(
        'div',
        { class: 'actions' },
        h('button', { onclick: () => void this.savePage() }, 'Salva pagina su kDrive'),
        h('button', { onclick: () => this.compose({ to: '', subject: '', body: '' }) }, 'Nuova email'),
        h('button', { onclick: () => void ks.openApp('kmeet') }, 'Avvia kMeet'),
      ),
    );
    return nodes;
  }

  private async savePage(): Promise<void> {
    const res = await ks.api.savePageToDrive();
    if (!res.ok) this.notify('error', res.error);
  }

  // ---------- kDrive ----------

  private async driveView(searchQuery = ''): Promise<Node[]> {
    const folder = this.driveStack[this.driveStack.length - 1];
    const settings = await ks.settings.get();

    const search = h('input', { type: 'search', placeholder: 'Cerca in kDrive…', value: searchQuery });
    const searchForm = h('form', { class: 'row' }, search);
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.refreshWith(() => this.driveView(search.value.trim()));
    });

    const crumbs = h(
      'div',
      { class: 'breadcrumbs' },
      ...this.driveStack.flatMap((f, i) => [
        i > 0 ? ' › ' : '',
        h('button', { class: 'link', onclick: () => this.openFolder(i) }, f.name),
      ]),
    );

    const toolbar = h(
      'div',
      { class: 'actions' },
      h('button', { onclick: () => void this.upload(folder.id) }, 'Carica file…'),
      h(
        'button',
        {
          disabled: settings.driveUploadFolderId === folder.id,
          title: 'Usa questa cartella per "Salva su kDrive", PDF e download',
          onclick: async () => {
            await ks.settings.set({ driveUploadFolderId: folder.id, driveUploadFolderName: folder.name });
            this.notify('success', `Destinazione impostata: ${folder.name}`);
            void this.render();
          },
        },
        settings.driveUploadFolderId === folder.id ? 'Cartella di destinazione ✓' : 'Usa come destinazione',
      ),
    );

    let listing: ApiResult<{ files: DriveFile[]; hasMore: boolean }>;
    if (searchQuery) {
      const res = await ks.api.driveSearch(searchQuery);
      listing = res.ok ? { ok: true, data: { files: res.data, hasMore: false } } : res;
    } else {
      listing = await ks.api.driveList(folder.id);
    }

    const nodes: Node[] = [searchForm];
    if (!searchQuery) nodes.push(crumbs, toolbar);
    else nodes.push(h('p', {}, h('button', { class: 'link', onclick: () => void this.render() }, '← Torna alla cartella'), ` Risultati per "${searchQuery}"`));

    if (!listing.ok) {
      nodes.push(errorBox(listing.error));
      return nodes;
    }
    if (listing.data.files.length === 0) nodes.push(h('p', { class: 'muted' }, searchQuery ? 'Nessun risultato.' : 'Cartella vuota.'));
    nodes.push(h('ul', { class: 'list files' }, ...listing.data.files.map((f) => this.fileItem(f))));
    if (listing.data.hasMore) nodes.push(h('p', { class: 'muted' }, 'Altri elementi disponibili: apri la cartella nell’app web per vederli tutti.'));
    return nodes;
  }

  private fileItem(file: DriveFile): HTMLElement {
    const isDir = file.type === 'dir';
    const open = () => {
      if (isDir) {
        this.driveStack.push({ id: file.id, name: file.name });
        void this.render();
      } else {
        void ks.api.driveOpenWeb(file).then((r) => !r.ok && this.notify('error', r.error));
      }
    };
    return h(
      'li',
      { class: 'file' },
      h('button', { class: 'file-main', onclick: open, title: isDir ? 'Apri cartella' : 'Apri in kDrive' },
        h('span', { class: `file-icon ${isDir ? 'dir' : 'doc'}` }, isDir ? '▸' : '▫'),
        h('span', { class: 'file-name' }, file.name),
        h('span', { class: 'muted small' }, isDir ? '' : formatBytes(file.size)),
      ),
      isDir
        ? h('button', { class: 'icon small', title: 'Apri nell’app web', onclick: () => void ks.api.driveOpenWeb(file) }, '↗')
        : h('button', {
            class: 'icon small',
            title: 'Scarica',
            onclick: async () => {
              this.notify('info', `Download di ${file.name}…`);
              const r = await ks.api.driveDownload(file.id, file.name);
              this.notify(r.ok ? 'success' : 'error', r.ok ? `Scaricato in ${r.data}` : r.error);
            },
          }, '⤓'),
    );
  }

  private openFolder(index: number): void {
    this.driveStack = this.driveStack.slice(0, index + 1);
    void this.render();
  }

  private async upload(folderId: number): Promise<void> {
    const res = await ks.api.driveUpload(folderId);
    if (!res.ok) return this.notify('error', res.error);
    if (res.data.length) {
      this.notify('success', `${res.data.length} file caricati`);
      void this.render();
    }
  }

  private async refreshWith(builder: () => Promise<Node[]>): Promise<void> {
    const seq = ++this.renderSeq;
    const content = await builder();
    if (seq === this.renderSeq) this.bodyEl.replaceChildren(h('div', { class: 'panel-view' }, ...content));
  }

  // ---------- Mail ----------

  private async mailView(): Promise<Node[]> {
    const to = h('input', { type: 'text', placeholder: 'A (separa più indirizzi con virgola)', value: this.draft.to });
    const subject = h('input', { type: 'text', placeholder: 'Oggetto', value: this.draft.subject });
    const body = h('textarea', { rows: 6, placeholder: 'Messaggio' });
    body.value = this.draft.body;
    const sendBtn = h('button', { class: 'primary', type: 'submit' }, 'Invia');
    const form = h('form', { class: 'compose' }, to, subject, body, h('div', { class: 'actions' }, sendBtn, h('button', { type: 'button', onclick: () => { this.draft = { to: '', subject: '', body: '' }; void this.render(); } }, 'Svuota')));
    const syncDraft = () => (this.draft = { to: to.value, subject: subject.value, body: body.value });
    form.addEventListener('input', syncDraft);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      syncDraft();
      sendBtn.disabled = true;
      const res = await ks.api.mailSend(this.draft);
      sendBtn.disabled = false;
      if (res.ok) {
        this.notify('success', 'Email inviata');
        this.draft = { to: '', subject: '', body: '' };
        void this.render();
      } else {
        this.notify('error', res.error);
      }
    });

    const overview = await ks.api.mailOverview();
    this.onUnreadChange(overview.ok ? overview.data.inboxUnread : null);
    const nodes: Node[] = [h('h3', {}, 'Scrivi'), form, h('h3', {}, 'Posta in arrivo')];
    if (!overview.ok) {
      nodes.push(errorBox(overview.error));
    } else {
      nodes.push(
        h('p', { class: 'muted' }, `${overview.data.mailbox.email} · ${overview.data.inboxUnread} non lette`),
        h('ul', { class: 'list' }, ...overview.data.threads.map((t) => mailItem(t))),
        h('button', { onclick: () => void ks.openApp('mail') }, 'Apri Mail'),
      );
    }
    return nodes;
  }

  // ---------- Calendar ----------

  private async calendarView(): Promise<Node[]> {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const nextHour = pad((now.getHours() + 1) % 24);

    const title = h('input', { type: 'text', placeholder: 'Titolo evento', required: true });
    const date = h('input', { type: 'date', value: today, required: true });
    const start = h('input', { type: 'time', value: `${nextHour}:00`, required: true });
    const end = h('input', { type: 'time', value: `${pad((now.getHours() + 2) % 24)}:00`, required: true });
    const form = h('form', { class: 'compose' }, title, h('div', { class: 'row' }, date, start, end), h('button', { class: 'primary', type: 'submit' }, 'Crea evento'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const startAt = new Date(`${date.value}T${start.value}`);
      const endAt = new Date(`${date.value}T${end.value}`);
      if (endAt <= startAt) endAt.setDate(endAt.getDate() + 1);
      const res = await ks.api.calendarCreate({ title: title.value.trim(), start: startAt.toISOString(), end: endAt.toISOString() });
      if (res.ok) {
        this.notify('success', 'Evento creato');
        void this.render();
      } else {
        this.notify('error', res.error);
      }
    });

    const events = await ks.api.calendarUpcoming();
    const nodes: Node[] = [h('h3', {}, 'Nuovo evento'), form, h('h3', {}, 'Prossimi 7 giorni')];
    if (!events.ok) {
      nodes.push(errorBox(events.error));
    } else if (events.data.length === 0) {
      nodes.push(h('p', { class: 'muted' }, 'Nessun evento.'));
    } else {
      const byDay = new Map<string, typeof events.data>();
      for (const e of events.data) {
        const key = formatDateTime(e.start, false);
        byDay.set(key, [...(byDay.get(key) ?? []), e]);
      }
      for (const [day, list] of byDay) nodes.push(h('h4', {}, day), h('ul', { class: 'list' }, ...list.map(eventItem)));
    }
    nodes.push(h('button', { onclick: () => void ks.openApp('calendar') }, 'Apri Calendar'));
    return nodes;
  }

  // ---------- Downloads ----------

  private async downloadsView(): Promise<Node[]> {
    const settings = await ks.settings.get();
    const toggle = h('input', { type: 'checkbox', checked: settings.uploadDownloadsToDrive });
    toggle.addEventListener('change', () => void ks.settings.set({ uploadDownloadsToDrive: toggle.checked }));

    const nodes: Node[] = [
      h('label', { class: 'check' }, toggle, ` Carica automaticamente i download su kDrive (${settings.driveUploadFolderName})`),
      h('button', { class: 'link', onclick: () => void ks.openSettingsPage('general') }, 'Cartella dei download…'),
    ];
    if (this.downloads.length === 0) nodes.push(h('p', { class: 'muted' }, 'Nessun download in questa sessione.'));
    nodes.push(
      h('ul', { class: 'list' }, ...this.downloads.map((d) =>
        h('li', {},
          h('div', { class: 'row spread' },
            h('strong', { class: 'ellipsis' }, d.filename),
            h('span', { class: 'muted small' }, downloadLabel(d)),
          ),
          d.state === 'progressing' && d.total > 0 ? h('progress', { max: d.total, value: d.received }) : null,
          d.drive !== 'idle' ? h('div', { class: `small drive-${d.drive}` }, driveLabel(d)) : null,
          d.state === 'completed'
            ? h('div', { class: 'actions' },
                h('button', { class: 'small', onclick: () => void ks.downloads.open(d.id, false) }, 'Apri'),
                h('button', { class: 'small', onclick: () => void ks.downloads.open(d.id, true) }, 'Mostra nella cartella'))
            : null,
        ),
      )),
    );
    return nodes;
  }
}

function errorBox(message: string): HTMLElement {
  return h('div', { class: 'error' }, message);
}

function countToday(events: Array<{ start: string }>): number {
  const today = new Date().toDateString();
  return events.filter((e) => new Date(e.start).toDateString() === today).length;
}

function eventItem(e: { title: string; start: string; end: string; fullday: boolean; location: string | null }): HTMLElement {
  const when = e.fullday ? `${formatDateTime(e.start, false)} · tutto il giorno` : `${formatDateTime(e.start)} – ${new Date(e.end).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  return h('li', {}, h('strong', {}, e.title), h('div', { class: 'muted small' }, when, e.location ? ` · ${e.location}` : ''));
}

function mailItem(t: { subject: string; from: string; date: string; preview: string; unseen: number }): HTMLElement {
  return h(
    'li',
    { class: t.unseen ? 'unread' : '' },
    h('button', { class: 'plain', onclick: () => void ks.openApp('mail') },
      h('div', { class: 'row spread' }, h('span', { class: 'ellipsis' }, t.from), h('span', { class: 'muted small' }, formatDateTime(t.date))),
      h('div', { class: 'ellipsis subject' }, t.subject),
      h('div', { class: 'muted small ellipsis' }, t.preview),
    ),
  );
}

function downloadLabel(d: DownloadItemState): string {
  switch (d.state) {
    case 'progressing':
      return d.total > 0 ? `${formatBytes(d.received)} / ${formatBytes(d.total)}` : formatBytes(d.received);
    case 'completed':
      return formatBytes(d.received);
    case 'cancelled':
      return 'Annullato';
    case 'interrupted':
      return 'Interrotto';
  }
}

function driveLabel(d: DownloadItemState): string {
  switch (d.drive) {
    case 'uploading':
      return 'Caricamento su kDrive…';
    case 'uploaded':
      return 'Salvato su kDrive ✓';
    case 'error':
      return `Errore kDrive: ${d.driveError ?? ''}`;
    default:
      return '';
  }
}
