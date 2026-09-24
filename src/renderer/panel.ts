import { draftMailMessages } from '../shared/ai-prompts';
import type { ApiResult, DownloadItemState, DriveFile, OutgoingMail, TabState } from '../shared/types';
import { Assistant, type AiAsk } from './assistant';
import { ks } from './bridge';
import { formatBytes, formatDateTime, h } from './dom';
import { fileIcon, icon, type IconName } from './icons';

export type PanelView = 'home' | 'assistant' | 'drive' | 'mail' | 'calendar' | 'downloads';

const VIEWS: Array<{ id: PanelView; label: string; icon: IconName }> = [
  { id: 'home', label: 'Home', icon: 'grid' },
  { id: 'assistant', label: 'IA', icon: 'sparkles' },
  { id: 'drive', label: 'kDrive', icon: 'cloud' },
  { id: 'mail', label: 'Mail', icon: 'mail' },
  { id: 'calendar', label: 'Agenda', icon: 'calendar' },
  { id: 'downloads', label: 'Download', icon: 'download' },
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
  private readonly assistant: Assistant;

  constructor(
    private readonly tabsEl: HTMLElement,
    private readonly bodyEl: HTMLElement,
    private readonly notify: Notify,
    private readonly onUnreadChange: (count: number | null) => void,
    activeTab: () => TabState | undefined,
  ) {
    this.assistant = new Assistant(activeTab, notify);
    ks.events.onDownloads((items) => {
      this.downloads = items;
      if (this.view === 'downloads') void this.render();
    });
    void ks.downloads.list().then((items) => (this.downloads = items));
  }

  show(view: PanelView): Promise<void> {
    this.view = view;
    return this.render();
  }

  /** Opens the assistant and asks it something (context menu, address bar "?"). */
  async askAi(req: AiAsk): Promise<void> {
    await this.show('assistant');
    this.assistant.ask(req);
  }

  current(): PanelView {
    return this.view;
  }

  compose(mail: OutgoingMail): void {
    this.draft = { ...mail };
    void this.show('mail');
  }

  async render(): Promise<void> {
    const seq = ++this.renderSeq;
    this.tabsEl.replaceChildren(
      ...VIEWS.map((v) =>
        withIcon(h('button', { role: 'tab', 'aria-selected': String(v.id === this.view), class: `seg${v.id === this.view ? ' active' : ''}`, onclick: () => this.show(v.id) }, v.label), v.icon, 17),
      ),
    );

    const status = await ks.token.status();
    if (!status.configured && this.view !== 'downloads') {
      this.mount(seq, this.noTokenView());
      return;
    }

    if (this.view === 'assistant') {
      const box = h('div', { class: 'panel-view assistant-view' });
      this.mount(seq, box);
      if (seq === this.renderSeq) await this.assistant.render(box);
      return;
    }

    const container = h('div', { class: 'panel-view' }, h('div', { class: 'row muted' }, h('span', { class: 'spinner' }), 'Caricamento…'));
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
      case 'assistant':
        return [];
    }
  }

  private noTokenView(): HTMLElement {
    return h(
      'div',
      { class: 'panel-view' },
      h('div', { class: 'empty-state' },
        withIcon(h('span', { class: 'big-icon' }), 'key', 26),
        h('h2', {}, 'Collega il tuo account kSuite'),
        h('p', {}, 'Le app della suite funzionano già dalla barra laterale. Per kDrive, Mail e Agenda qui nel pannello serve un token API personale.'),
        h('button', { class: 'primary', onclick: () => void ks.openSettingsPage('ksuite') }, 'Configura il token'),
      ),
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
        h('button', { class: 'card', onclick: () => this.show('mail') }, withIcon(h('span', { class: 'card-icon' }), 'inbox', 18), h('span', { class: 'big' }, mail.ok ? String(mail.data.inboxUnread) : '–'), 'email non lette'),
        h('button', { class: 'card', onclick: () => this.show('calendar') }, withIcon(h('span', { class: 'card-icon' }), 'calendarClock', 18), h('span', { class: 'big' }, events.ok ? String(countToday(events.data)) : '–'), 'eventi oggi'),
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
        withIcon(h('button', { onclick: () => void this.savePage() }, 'PDF su kDrive'), 'upload', 15),
        withIcon(h('button', { onclick: () => this.compose({ to: '', subject: '', body: '' }) }, 'Nuova email'), 'pencil', 15),
        withIcon(h('button', { onclick: () => void ks.openApp('kmeet') }, 'kMeet'), 'video', 15),
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

    const search = h('input', { type: 'search', placeholder: 'Cerca in kDrive…', value: searchQuery, 'aria-label': 'Cerca in kDrive' });
    const searchForm = h('form', { class: 'search-field' }, icon('search', 15), search);
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
        withIcon(h('span', { class: `file-icon ${isDir ? 'dir' : 'doc'}` }), fileIcon(file), 18),
        h('span', { class: 'file-name' }, file.name),
        h('span', { class: 'muted small' }, isDir ? '' : formatBytes(file.size)),
      ),
      isDir
        ? withIcon(h('button', { class: 'icon-btn small', title: 'Apri nell’app web', 'aria-label': `Apri ${file.name} nell’app web`, onclick: () => void ks.api.driveOpenWeb(file) }), 'external', 15)
        : withIcon(h('button', {
            class: 'icon-btn small',
            title: 'Scarica',
            'aria-label': `Scarica ${file.name}`,
            onclick: async () => {
              this.notify('info', `Download di ${file.name}…`);
              const r = await ks.api.driveDownload(file.id, file.name);
              this.notify(r.ok ? 'success' : 'error', r.ok ? `Scaricato in ${r.data}` : r.error);
            },
          }), 'download', 15),
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
    const aiOn = (await ks.ai.status()).enabled;
    const aiBtn = aiOn
      ? withIcon(h('button', {
          type: 'button',
          title: 'Scrivi il testo con l’IA partendo dall’oggetto e dai tuoi appunti nel messaggio',
          onclick: async () => {
            aiBtn!.disabled = true;
            const notes = body.value;
            const result = await this.assistant.complete(draftMailMessages(subject.value, notes), (text) => (body.value = text));
            if (result === null) body.value = notes;
            aiBtn!.disabled = false;
            syncDraft();
          },
        }, 'Scrivi con l’IA'), 'sparkles', 15)
      : null;
    const form = h('form', { class: 'compose' }, to, subject, body, h('div', { class: 'actions' }, sendBtn, aiBtn, h('button', { type: 'button', onclick: () => { this.draft = { to: '', subject: '', body: '' }; void this.render(); } }, 'Svuota')));
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
    if (this.downloads.length === 0) {
      nodes.push(h('div', { class: 'empty-state' }, withIcon(h('span', { class: 'big-icon' }), 'download', 26), h('p', {}, 'Nessun download in questa sessione.')));
    }
    nodes.push(
      h('div', { class: 'compose' }, ...this.downloads.map((d) =>
        h('div', { class: `dl-item${d.state === 'completed' ? ' done' : ''}` },
          withIcon(h('span', { class: 'dl-icon' }), d.state === 'completed' ? 'check' : d.state === 'progressing' ? 'download' : 'alert', 18),
          h('div', { class: 'item-main compose' },
            h('div', { class: 'row spread' },
              h('strong', { class: 'ellipsis' }, d.filename),
              h('span', { class: 'muted small' }, downloadLabel(d)),
            ),
            d.state === 'progressing' && d.total > 0 ? h('progress', { max: d.total, value: d.received }) : null,
            d.drive !== 'idle' ? h('div', { class: `small drive-${d.drive}` }, driveLabel(d)) : null,
            d.state === 'completed'
              ? h('div', { class: 'actions' },
                  h('button', { onclick: () => void ks.downloads.open(d.id, false) }, 'Apri'),
                  h('button', { onclick: () => void ks.downloads.open(d.id, true) }, 'Mostra nella cartella'))
              : null,
          ),
        ),
      )),
    );
    return nodes;
  }
}

function withIcon<T extends HTMLElement>(el: T, name: IconName, size = 16): T {
  el.prepend(icon(name, size));
  return el;
}

function errorBox(message: string): HTMLElement {
  return h('div', { class: 'error', role: 'alert' }, icon('alert', 16), h('span', {}, message));
}

function initials(name: string): string {
  const parts = name.replace(/<.*>/, '').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

function countToday(events: Array<{ start: string }>): number {
  const today = new Date().toDateString();
  return events.filter((e) => new Date(e.start).toDateString() === today).length;
}

function eventItem(e: { title: string; start: string; end: string; fullday: boolean; location: string | null }): HTMLElement {
  const start = new Date(e.start);
  const time = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const when = e.fullday ? 'Tutto il giorno' : `${time(start)} – ${time(new Date(e.end))}`;
  return h(
    'li',
    {},
    h('div', { class: 'item' },
      h('span', { class: 'date-chip', 'aria-hidden': 'true' },
        h('span', { class: 'd' }, String(start.getDate())),
        h('span', { class: 'm' }, start.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')),
      ),
      h('div', { class: 'item-main' },
        h('strong', { class: 'ellipsis' }, e.title),
        h('div', { class: 'muted small' }, when, e.location ? ` · ${e.location}` : ''),
      ),
    ),
  );
}

function mailItem(t: { subject: string; from: string; date: string; preview: string; unseen: number }): HTMLElement {
  return h(
    'li',
    { class: t.unseen ? 'unread' : '' },
    h('button', { class: 'plain', onclick: () => void ks.openApp('mail') },
      h('span', { class: 'avatar-sm', 'aria-hidden': 'true' }, initials(t.from)),
      h('div', { class: 'item-main' },
        h('div', { class: 'row spread' }, h('span', { class: 'ellipsis from' }, t.from), h('span', { class: 'muted small' }, formatDateTime(t.date))),
        h('div', { class: 'ellipsis subject' }, t.subject),
        h('div', { class: 'muted small ellipsis' }, t.preview),
      ),
    ),
  );
}

function downloadLabel(d: DownloadItemState): string {
  if (d.blocked) return d.blocked;
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
      return 'Salvato su kDrive';
    case 'error':
      return `Errore kDrive: ${d.driveError ?? ''}`;
    default:
      return '';
  }
}
