import { BrowserWindow, WebContentsView, dialog, type NavigationEntry, type Session, type WebContents } from 'electron';
import type { Rect, TabState } from '../shared/types';
import { readerOriginal } from './reader';

/** A tab. It can move to another window, so its listeners always go through `owner`. */
export interface Tab {
  id: number;
  /** null while the tab sleeps: its page is closed to free memory. */
  view: WebContentsView | null;
  sleep: SleepState | null;
  /** When the tab was last in front (for sleeping and "recent" ordering). */
  lastActiveAt: number;
  /** The page played sound since it loaded: media controls stay available (also once paused). */
  mediaSeen: boolean;
  favicon: string | null;
  appId: string | null;
  pinned: boolean;
  /** URL that failed to load while the error page is shown. */
  failedUrl: string | null;
  owner: TabManager;
}

/** What a sleeping tab keeps to come back as it was. */
export interface SleepState {
  url: string;
  title: string;
  entries: NavigationEntry[];
  index: number;
  muted: boolean;
}

export interface ClosedTab {
  url: string;
  pinned: boolean;
  entries: NavigationEntry[];
  index: number;
}

export interface TabManagerHooks {
  onChange(tabs: TabState[]): void;
  /** Called once for every new page WebContents, to attach context menus, window handlers, etc. */
  onWebContentsCreated(contents: WebContents, tabs: TabManager): void;
  /** Extra per-tab state shown in the toolbar: shield, zoom badge, bookmark star. */
  extraState(contents: WebContents | null, url: string): Pick<TabState, 'blocked' | 'protectionActive' | 'zoom' | 'bookmarked' | 'readerable'>;
  /** Page to show instead of the generic error page (e.g. the HTTPS-only warning), with the URL to display. */
  failurePage?(contents: WebContents, url: string, code: number): { load: string; display: string } | null;
}

export interface TabManagerOptions {
  session: Session;
  /** Preload for tabs; it only exposes an API to internal ksuite:// pages. */
  preload: string;
}

export interface CreateOptions {
  background?: boolean;
  appId?: string | null;
  pinned?: boolean;
  /** Position in the tab strip; default: at the end. */
  index?: number;
  /** Navigation history to restore instead of loading `url` (reopened or duplicated tabs). */
  history?: { entries: NavigationEntry[]; index: number };
  /** Start asleep: the page loads when the tab is first shown (restored sessions). */
  asleep?: boolean;
  /** Title to show while asleep. */
  title?: string;
}

/** True when the page has form fields changed by the user: sleeping would lose them. */
const HAS_EDITS = `(() => {
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (el.disabled || ['hidden', 'submit', 'button', 'reset', 'image', 'file'].includes(el.type)) continue;
    if (el.tagName === 'SELECT') { if ([...el.options].some((o) => o.selected !== o.defaultSelected)) return true; continue; }
    if (el.type === 'checkbox' || el.type === 'radio') { if (el.checked !== el.defaultChecked) return true; continue; }
    if (el.value !== el.defaultValue) return true;
  }
  return Boolean(document.activeElement && document.activeElement.isContentEditable);
})()`;

// Global so tab ids stay unique when tabs move between windows.
let nextTabId = 1;
const MAX_CLOSED = 25;

/** Owns the page views shown in the content area of a window. */
export class TabManager {
  private tabs: Tab[] = [];
  private activeId: number | null = null;
  private bounds: Rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly closed: ClosedTab[] = [];
  /** Tab showing an element in full screen (HTML fullscreen API), if any. */
  fullscreenId: number | null = null;

  constructor(
    readonly window: BrowserWindow,
    readonly hooks: TabManagerHooks,
    private readonly options: TabManagerOptions,
  ) {
    // Electron puts the window itself in full screen for the page (and restores it): only the layout is ours.
    window.on('resize', () => {
      if (this.fullscreenId !== null) this.layout();
    });
    window.on('leave-full-screen', () => this.exitPageFullscreen());
  }

  get session(): Session {
    return this.options.session;
  }

  create(url: string, options: CreateOptions = {}): number {
    const tab: Tab = {
      id: nextTabId++,
      view: null,
      sleep: null,
      lastActiveAt: Date.now(),
      mediaSeen: false,
      favicon: null,
      appId: options.appId ?? null,
      pinned: Boolean(options.pinned),
      failedUrl: null,
      owner: this,
    };
    this.insert(tab, options.index);
    if (options.asleep) {
      tab.sleep = { url, title: options.title || url, entries: options.history?.entries ?? [], index: options.history?.index ?? 0, muted: false };
    } else {
      const wc = this.attachView(tab).webContents;
      if (options.history?.entries.length) {
        wc.navigationHistory.restore({ entries: options.history.entries, index: options.history.index }).catch(() => void wc.loadURL(url));
      } else {
        void wc.loadURL(url);
      }
    }
    if (!options.background || (this.activeId === null && !options.asleep)) this.activate(tab.id);
    else this.emit();
    return tab.id;
  }

  /** Creates the page of a tab (new, or waking up) with all its listeners. */
  private attachView(tab: Tab): WebContentsView {
    const view = new WebContentsView({
      webPreferences: {
        session: this.options.session,
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
        // Built-in PDF viewer.
        plugins: true,
      },
    });
    tab.view = view;
    const wc = view.webContents;
    const emit = () => tab.owner.emit();
    wc.on('page-title-updated', emit);
    wc.on('did-start-loading', emit);
    wc.on('did-stop-loading', emit);
    wc.on('audio-state-changed', () => {
      if (wc.isCurrentlyAudible()) tab.mediaSeen = true;
      emit();
    });
    wc.on('did-navigate', (_e, navUrl) => {
      if (!navUrl.startsWith('data:') && !navUrl.startsWith('ksuite://https-only') && !navUrl.startsWith('ksuite://blocked')) tab.failedUrl = null;
      tab.favicon = null;
      tab.mediaSeen = false;
      emit();
    });
    wc.on('did-navigate-in-page', emit);
    wc.on('page-favicon-updated', (_e, favicons) => {
      tab.favicon = favicons[0] ?? null;
      emit();
    });
    wc.on('did-fail-load', (_e, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. new navigation)
      const special = tab.owner.hooks.failurePage?.(wc, validatedUrl, code);
      tab.failedUrl = special ? special.display : validatedUrl;
      void wc.loadURL(special ? special.load : errorPage(validatedUrl, code, description));
    });
    wc.on('render-process-gone', (_e, details) => {
      if (wc.isDestroyed() || details.reason === 'clean-exit') return;
      if (tab.owner.fullscreenId === tab.id) tab.owner.leaveFullscreen();
      const url = tab.failedUrl ?? wc.getURL();
      tab.failedUrl = url;
      void wc.loadURL(crashPage(url, details.reason));
    });
    let askingUnresponsive = false;
    wc.on('unresponsive', async () => {
      if (askingUnresponsive) return;
      askingUnresponsive = true;
      const { response } = await dialog.showMessageBox(tab.owner.window, {
        type: 'warning',
        message: 'La pagina non risponde',
        detail: `«${wc.getTitle() || wc.getURL()}» è bloccata. Puoi aspettare che torni a rispondere o chiuderla.`,
        buttons: ['Aspetta', 'Chiudi la pagina'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      askingUnresponsive = false;
      if (response === 1 && !wc.isDestroyed()) wc.forcefullyCrashRenderer();
    });
    // Video and other elements in full screen take the whole window.
    wc.on('enter-html-full-screen', () => tab.owner.enterFullscreen(tab.id));
    wc.on('leave-html-full-screen', () => tab.owner.leaveFullscreen());
    wc.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && tab.owner.fullscreenId === tab.id) {
        e.preventDefault();
        tab.owner.exitPageFullscreen();
      }
    });
    tab.owner.hooks.onWebContentsCreated(wc, tab.owner);
    return view;
  }

  /** Brings a sleeping tab back: same history, same position in it. */
  private wake(tab: Tab): void {
    const state = tab.sleep;
    if (!state) return;
    tab.sleep = null;
    const wc = this.attachView(tab).webContents;
    wc.setAudioMuted(state.muted);
    if (state.entries.length) wc.navigationHistory.restore({ entries: state.entries, index: state.index }).catch(() => void wc.loadURL(state.url));
    else void wc.loadURL(state.url);
  }

  /** Puts a background tab to sleep. Returns false when it can't (active, already asleep). */
  sleepTab(id: number): boolean {
    const tab = this.find(id);
    if (!tab || !tab.view || tab.id === this.activeId) return false;
    const wc = tab.view.webContents;
    const url = tab.failedUrl ?? wc.getURL();
    if (!url) return false;
    tab.sleep = {
      url,
      title: wc.getTitle() || url,
      entries: tab.failedUrl ? [] : wc.navigationHistory.getAllEntries(),
      index: wc.navigationHistory.getActiveIndex(),
      muted: wc.isAudioMuted(),
    };
    if (tab.view && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    tab.view = null;
    tab.failedUrl = null;
    wc.close();
    this.emit();
    return true;
  }

  /** Sleeps background tabs unused for `idleMs`, skipping those that would lose something. */
  async sleepIdle(idleMs: number, now = Date.now()): Promise<number> {
    let count = 0;
    for (const tab of [...this.tabs]) {
      if (!tab.view || tab.id === this.activeId || tab.pinned || tab.appId || now - tab.lastActiveAt < idleMs) continue;
      const wc = tab.view.webContents;
      if (!/^https?:/i.test(wc.getURL()) || wc.isLoading() || wc.isCurrentlyAudible() || wc.isDevToolsOpened() || this.fullscreenId === tab.id) continue;
      const edited = await wc.executeJavaScriptInIsolatedWorld(1998, [{ code: HAS_EDITS }]).catch(() => true);
      if (edited || !tab.view || tab.id === this.activeId) continue;
      if (this.sleepTab(tab.id)) count++;
    }
    return count;
  }

  /** Focuses an existing tab of a kSuite app, or opens it. */
  openApp(appId: string, url: string): void {
    const existing = this.tabs.find((t) => t.appId === appId);
    if (existing) this.activate(existing.id);
    else this.create(url, { appId });
  }

  close(id: number): void {
    const tab = this.detach(id);
    if (!tab) return;
    const wc = tab.view?.webContents;
    const closed: ClosedTab | null = tab.sleep
      ? { url: tab.sleep.url, pinned: tab.pinned, entries: tab.sleep.entries, index: tab.sleep.index }
      : wc
        ? { url: tab.failedUrl ?? wc.getURL(), pinned: tab.pinned, entries: wc.navigationHistory.getAllEntries(), index: wc.navigationHistory.getActiveIndex() }
        : null;
    if (closed?.url && !closed.url.startsWith('data:')) {
      this.closed.push(closed);
      if (this.closed.length > MAX_CLOSED) this.closed.shift();
    }
    wc?.close();
  }

  /** Reopens the last closed tab with its back/forward history. */
  reopenClosed(): boolean {
    const last = this.closed.pop();
    if (!last) return false;
    this.create(last.url, { pinned: last.pinned, history: { entries: last.entries, index: last.index } });
    return true;
  }

  duplicate(id: number): void {
    const tab = this.find(id);
    if (!tab) return;
    const index = this.tabs.indexOf(tab) + 1;
    if (tab.sleep) {
      this.create(tab.sleep.url, { index, history: { entries: tab.sleep.entries, index: tab.sleep.index } });
      return;
    }
    const wc = tab.view!.webContents;
    this.create(tab.failedUrl ?? wc.getURL(), {
      index,
      history: { entries: wc.navigationHistory.getAllEntries(), index: wc.navigationHistory.getActiveIndex() },
    });
  }

  /** Removes a tab from this window without destroying its page (to move it elsewhere). */
  detach(id: number): Tab | undefined {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) return undefined;
    if (this.fullscreenId === id) this.leaveFullscreen();
    const [tab] = this.tabs.splice(index, 1);
    if (tab.view && !this.window.isDestroyed()) this.window.contentView.removeChildView(tab.view);
    if (this.activeId === id) {
      this.activeId = null;
      const next = this.tabs[index] ?? this.tabs[index - 1];
      if (next) this.activate(next.id);
    }
    this.emit();
    return tab;
  }

  /** Takes a tab detached from another window. */
  adopt(tab: Tab, index?: number): void {
    tab.owner = this;
    this.insert(tab, index);
    this.activate(tab.id);
  }

  /** Moves a tab to a new position; pinned tabs always stay before the others. */
  move(id: number, toIndex: number): void {
    const tab = this.find(id);
    if (!tab) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    this.insert(tab, toIndex);
    this.emit();
  }

  setPinned(id: number, pinned: boolean): void {
    const tab = this.find(id);
    if (!tab || tab.pinned === pinned) return;
    this.tabs.splice(this.tabs.indexOf(tab), 1);
    tab.pinned = pinned;
    this.insert(tab, pinned ? this.tabs.filter((t) => t.pinned).length : undefined);
    this.emit();
  }

  setMuted(id: number, muted: boolean): void {
    const tab = this.find(id);
    if (tab?.sleep) tab.sleep.muted = muted;
    else tab?.view?.webContents.setAudioMuted(muted);
    this.emit();
  }

  activate(id: number): void {
    const tab = this.find(id);
    if (!tab) return;
    const previous = this.activeId !== null ? this.find(this.activeId) : undefined;
    if (previous && previous !== tab) {
      previous.lastActiveAt = Date.now();
      if (previous.view) this.window.contentView.removeChildView(previous.view);
    }
    tab.lastActiveAt = Date.now();
    if (tab.sleep) this.wake(tab);
    if (this.fullscreenId !== null && this.fullscreenId !== id) this.exitPageFullscreen();
    this.activeId = id;
    this.window.contentView.addChildView(tab.view!);
    this.layout();
    tab.view!.webContents.focus();
    this.emit();
  }

  /** Activates the tab at a position (Ctrl+1…8); -1 is the last tab (Ctrl+9). */
  activateIndex(index: number): void {
    const tab = index < 0 ? this.tabs[this.tabs.length - 1] : this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  cycle(step: 1 | -1): void {
    if (this.tabs.length < 2 || this.activeId === null) return;
    const index = this.tabs.findIndex((t) => t.id === this.activeId);
    const next = this.tabs[(index + step + this.tabs.length) % this.tabs.length];
    this.activate(next.id);
  }

  setBounds(rect: Rect): void {
    this.bounds = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    };
    this.layout();
  }

  /** Area where the active page is shown (the whole window while a page is in full screen). */
  pageArea(): Rect {
    if (this.fullscreenId !== null && this.fullscreenId === this.activeId) {
      const [width, height] = this.window.getContentSize();
      return { x: 0, y: 0, width, height };
    }
    return this.bounds;
  }

  enterFullscreen(id: number): void {
    if (this.fullscreenId === id) return;
    this.fullscreenId = id;
    this.layout();
  }

  leaveFullscreen(): void {
    if (this.fullscreenId === null) return;
    this.fullscreenId = null;
    this.layout();
  }

  /** Asks the page in full screen to leave it (tab switch, F11). */
  exitPageFullscreen(): void {
    const tab = this.fullscreenId !== null ? this.find(this.fullscreenId) : undefined;
    this.leaveFullscreen();
    if (tab?.view) void tab.view.webContents.executeJavaScript('document.fullscreenElement && document.exitFullscreen()', true).catch(() => {});
  }

  private layout(): void {
    const tab = this.active();
    if (!tab?.view) return;
    if (this.fullscreenId === tab.id) {
      const [width, height] = this.window.getContentSize();
      tab.view.setBounds({ x: 0, y: 0, width, height });
    } else {
      tab.view.setBounds(this.bounds);
    }
  }

  reload(id: number): void {
    const tab = this.find(id);
    if (!tab) return;
    if (tab.sleep) this.wake(tab);
    else if (tab.failedUrl) void tab.view?.webContents.loadURL(tab.failedUrl);
    else tab.view?.webContents.reload();
  }

  navigate(id: number, url: string): void {
    const tab = this.find(id);
    if (!tab) return;
    if (tab.sleep) {
      tab.sleep = { ...tab.sleep, entries: [], url };
      this.wake(tab);
    } else {
      void tab.view?.webContents.loadURL(url);
    }
  }

  active(): Tab | undefined {
    return this.activeId !== null ? this.find(this.activeId) : undefined;
  }

  activeContents(): WebContents | undefined {
    return this.active()?.view?.webContents;
  }

  contents(id: number): WebContents | undefined {
    return this.find(id)?.view?.webContents;
  }

  ids(): number[] {
    return this.tabs.map((t) => t.id);
  }

  count(): number {
    return this.tabs.length;
  }

  /** Recently closed tabs, most recent first, with the index reopenClosedAt() takes. */
  recentlyClosed(): Array<{ index: number; title: string; url: string }> {
    return this.closed
      .map((c, index) => ({ index, url: c.url, title: c.entries[c.index]?.title || c.url }))
      .reverse();
  }

  reopenClosedAt(index: number): boolean {
    const [entry] = Number.isInteger(index) && index >= 0 ? this.closed.splice(index, 1) : [];
    if (!entry) return false;
    this.create(entry.url, { pinned: entry.pinned, history: { entries: entry.entries, index: entry.index } });
    return true;
  }

  hasClosed(): boolean {
    return this.closed.length > 0;
  }

  /** Re-sends the tab states, e.g. when the blocked counter or a setting changed. */
  refresh(): void {
    this.emit();
  }

  /** Tab id owning a WebContents, if any. */
  idOf(contents: WebContents): number | null {
    return this.tabs.find((t) => t.view?.webContents === contents)?.id ?? null;
  }

  /** Tabs to reopen at the next start. */
  saved(): Array<{ url: string; pinned: boolean; title: string }> {
    return this.states()
      .filter((t) => t.url && !t.url.startsWith('data:'))
      .map((t) => ({ url: t.url, pinned: t.pinned, title: t.title }));
  }

  /** Closes every tab; used when the window goes away. */
  destroy(): void {
    for (const tab of this.tabs) if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.tabs = [];
    this.activeId = null;
  }

  states(): TabState[] {
    return this.tabs.map((t) => {
      if (t.sleep || !t.view) {
        const sleep = t.sleep ?? { url: '', title: '', entries: [], index: 0, muted: false };
        return {
          id: t.id,
          title: sleep.title || sleep.url || 'Nuova scheda',
          url: sleep.url,
          favicon: t.favicon,
          loading: false,
          canGoBack: sleep.index > 0,
          canGoForward: sleep.index < sleep.entries.length - 1,
          active: false,
          appId: t.appId,
          pinned: t.pinned,
          audible: false,
          muted: sleep.muted,
          sleeping: true,
          reader: false,
          media: false,
          lastActiveAt: t.lastActiveAt,
          ...this.hooks.extraState(null, sleep.url),
        };
      }
      const wc = t.view.webContents;
      // Reader mode shows the article's own address.
      const original = readerOriginal(wc.getURL());
      const url = t.failedUrl ?? original ?? wc.getURL();
      return {
        id: t.id,
        title: url.startsWith('ksuite://newtab') ? 'Nuova scheda' : wc.getTitle() || url || 'Nuova scheda',
        url,
        favicon: t.favicon,
        loading: wc.isLoading(),
        canGoBack: wc.navigationHistory.canGoBack(),
        canGoForward: wc.navigationHistory.canGoForward(),
        active: t.id === this.activeId,
        appId: t.appId,
        pinned: t.pinned,
        audible: wc.isCurrentlyAudible(),
        muted: wc.isAudioMuted(),
        sleeping: false,
        reader: original !== null,
        media: t.mediaSeen || wc.isCurrentlyAudible(),
        lastActiveAt: t.id === this.activeId ? Date.now() : t.lastActiveAt,
        ...this.hooks.extraState(wc, url),
      };
    });
  }

  private insert(tab: Tab, index?: number): void {
    const pinnedCount = this.tabs.filter((t) => t.pinned).length;
    const min = tab.pinned ? 0 : pinnedCount;
    const max = tab.pinned ? pinnedCount : this.tabs.length;
    const at = Math.min(max, Math.max(min, index ?? max));
    this.tabs.splice(at, 0, tab);
  }

  private find(id: number): Tab | undefined {
    return this.tabs.find((t) => t.id === id);
  }

  emit(): void {
    if (!this.window.isDestroyed()) this.hooks.onChange(this.states());
  }
}

interface ErrorText {
  title: string;
  hint: string;
}

/** Friendly Italian text for the most common network errors (Chromium net error codes). */
export function describeError(code: number): ErrorText {
  if (code === -106) return { title: 'Nessuna connessione a Internet', hint: 'Controlla il Wi-Fi o il cavo di rete, poi riprova.' };
  if (code === -105 || code === -137) return { title: 'Impossibile trovare il sito', hint: 'Controlla di aver scritto bene l’indirizzo. Se è corretto, il sito potrebbe non esistere più o la rete potrebbe avere problemi.' };
  if (code === -102) return { title: 'Il sito ha rifiutato la connessione', hint: 'Il server non accetta connessioni in questo momento. Riprova più tardi.' };
  if (code === -7 || code === -118) return { title: 'Il sito impiega troppo tempo a rispondere', hint: 'Il server potrebbe essere sovraccarico. Riprova tra qualche istante.' };
  if (code === -21) return { title: 'La rete è cambiata', hint: 'La connessione è cambiata durante il caricamento. Riprova.' };
  if (code === -109 || code === -101 || code === -100) return { title: 'Connessione interrotta', hint: 'La connessione al sito si è interrotta. Riprova.' };
  if (code === -324) return { title: 'Il sito non ha inviato dati', hint: 'Il server ha chiuso la connessione senza rispondere. Riprova più tardi.' };
  if (code === -310) return { title: 'Troppi reindirizzamenti', hint: 'Il sito rimanda continuamente a sé stesso. Prova a cancellare i cookie del sito.' };
  if (code <= -200 && code > -300) return { title: 'La connessione non è sicura', hint: 'Il certificato di sicurezza del sito non è valido: qualcuno potrebbe cercare di intercettare i tuoi dati. La pagina non è stata aperta.' };
  if (code === -20) return { title: 'Pagina bloccata', hint: 'Questa pagina è stata bloccata.' };
  return { title: 'Impossibile caricare la pagina', hint: 'Si è verificato un errore di rete.' };
}

const CRASH_REASONS: Record<string, string> = {
  crashed: 'La pagina si è arrestata in modo imprevisto.',
  oom: 'La pagina ha esaurito la memoria.',
  killed: 'La pagina è stata chiusa dal sistema.',
  'launch-failed': 'Non è stato possibile avviare la pagina.',
  'integrity-failure': 'Controllo di integrità non riuscito.',
  'abnormal-exit': 'La pagina si è chiusa in modo anomalo.',
};

function shellPage(title: string, heading: string, hint: string, url: string, glyph: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const retry = /^(https?|file):/i.test(url) ? `<a class="btn" href="${esc(url)}">Riprova</a>` : '';
  const html = `<!doctype html><html lang="it"><meta charset="utf-8"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#1d2330;--muted:#5f6878;--accent:#0f6fff;--soft:#e8f0ff}
@media (prefers-color-scheme:dark){:root{--bg:#15171b;--card:#1d2026;--text:#e7e9ee;--muted:#9aa3b2;--accent:#5b9dff;--soft:#1c2a44}}
body{font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:var(--text);background:var(--bg)}
main{max-width:540px;padding:32px}
.glyph{display:grid;place-items:center;width:56px;height:56px;border-radius:16px;background:var(--soft);color:var(--accent);margin-bottom:18px}
h1{font-size:22px;margin:0 0 8px}p{margin:0 0 14px;color:var(--muted)}
code{display:block;word-break:break-all;color:var(--muted);font-size:12.5px;margin-bottom:22px}
.btn{display:inline-flex;align-items:center;height:36px;padding:0 18px;border-radius:9px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
</style>
<main><div class="glyph">${glyph}</div><h1>${esc(heading)}</h1><p>${esc(hint)}</p><code>${esc(url)}</code>${retry}</main></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

const svg = (paths: string) => `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const GLYPH_OFFLINE = svg('<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.39"/><path d="M2 8.82a15 15 0 0 1 4.18-2.65"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/>');
const GLYPH_WARNING = svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>');
const GLYPH_LOCK = svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m14.5 9.5-5 5"/><path d="m9.5 9.5 5 5"/>');
const GLYPH_CRASH = svg('<circle cx="12" cy="12" r="10"/><path d="M16 16s-1.5-2-4-2-4 2-4 2"/><path d="M9 9h.01"/><path d="M15 9h.01"/>');

function errorPage(url: string, code: number, description: string): string {
  const text = describeError(code);
  const glyph = code === -106 ? GLYPH_OFFLINE : code <= -200 && code > -300 ? GLYPH_LOCK : GLYPH_WARNING;
  return shellPage('Pagina non disponibile', text.title, `${text.hint} (${description || code})`, url, glyph);
}

function crashPage(url: string, reason: string): string {
  return shellPage('Scheda bloccata', 'Questa scheda si è bloccata', `${CRASH_REASONS[reason] ?? 'Si è verificato un problema.'} Ricaricala per riprovare.`, url, GLYPH_CRASH);
}
