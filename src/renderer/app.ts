import { KSUITE_APPS } from '../shared/ksuite-apps';
import type { TabState } from '../shared/types';
import { ks } from './bridge';
import { h } from './dom';
import { Panel } from './panel';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const tabstrip = $('tabstrip');
const omnibox = $<HTMLInputElement>('omnibox');
const content = $('content');
const sidebar = $('sidebar');
const toastEl = $('toast');
const backBtn = $<HTMLButtonElement>('btn-back');
const forwardBtn = $<HTMLButtonElement>('btn-forward');
const reloadBtn = $<HTMLButtonElement>('btn-reload');

let tabs: TabState[] = [];
let unread: number | null = null;

const activeTab = () => tabs.find((t) => t.active);

// ---------- Toasts ----------

let toastTimer: number | undefined;
function toast(kind: 'info' | 'success' | 'error', message: string): void {
  toastEl.hidden = false;
  toastEl.className = `toast-${kind}`;
  toastEl.textContent = message;
  toastEl.title = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 8000 : 4000);
}
toastEl.addEventListener('click', () => (toastEl.hidden = true));

// ---------- Panel ----------

const panel = new Panel($('panel-tabs'), $('panel-body'), toast, (count) => {
  unread = count;
  renderSidebar();
});

async function setPanelOpen(open: boolean): Promise<void> {
  document.body.classList.toggle('panel-open', open);
  await ks.settings.set({ panelOpen: open });
  if (open) void panel.render();
  syncBounds();
}

const togglePanel = () => void setPanelOpen(!document.body.classList.contains('panel-open'));

// ---------- Tabs ----------

function renderTabs(): void {
  tabstrip.replaceChildren(
    ...tabs.map((t) => {
      const icon = t.favicon ? h('img', { class: 'favicon', src: t.favicon, alt: '' }) : h('span', { class: 'favicon placeholder' });
      const el = h(
        'div',
        { class: `tab${t.active ? ' active' : ''}${t.loading ? ' loading' : ''}`, role: 'tab', 'aria-selected': String(t.active), title: `${t.title}\n${t.url}` },
        icon,
        h('span', { class: 'tab-title' }, t.title),
        h('button', { class: 'tab-close', 'aria-label': 'Chiudi scheda', onclick: (e: Event) => { e.stopPropagation(); void ks.tabs.close(t.id); } }, '×'),
      );
      el.addEventListener('click', () => void ks.tabs.activate(t.id));
      el.addEventListener('auxclick', (e) => {
        if ((e as MouseEvent).button === 1) void ks.tabs.close(t.id);
      });
      icon.addEventListener('error', () => icon.replaceWith(h('span', { class: 'favicon placeholder' })));
      return el;
    }),
    h('button', { class: 'new-tab', title: 'Nuova scheda (Ctrl+T)', 'aria-label': 'Nuova scheda', onclick: () => void ks.tabs.create() }, '+'),
  );
}

function renderToolbar(): void {
  const tab = activeTab();
  backBtn.disabled = !tab?.canGoBack;
  forwardBtn.disabled = !tab?.canGoForward;
  reloadBtn.innerHTML = tab?.loading ? '&#10005;' : '&#8635;';
  reloadBtn.title = tab?.loading ? 'Interrompi' : 'Ricarica (Ctrl+R)';
  if (document.activeElement !== omnibox) omnibox.value = tab && tab.url !== 'about:blank' ? tab.url : '';
  document.title = tab ? `${tab.title} — kSuite Browser` : 'kSuite Browser';
}

function renderSidebar(): void {
  const activeApp = activeTab()?.appId;
  sidebar.replaceChildren(
    ...KSUITE_APPS.map((app) => {
      const button = h(
        'button',
        { class: `app${activeApp === app.id ? ' active' : ''}`, title: app.name, 'aria-label': app.name, onclick: () => void ks.openApp(app.id) },
        h('span', { class: 'glyph' }, app.glyph),
        app.id === 'mail' && unread ? h('span', { class: 'badge' }, unread > 99 ? '99+' : String(unread)) : null,
        h('span', { class: 'app-name' }, app.name),
      );
      // Set through CSSOM: the CSP forbids inline style attributes.
      button.style.setProperty('--app-color', app.color);
      return button;
    }),
  );
}

ks.events.onTabs((next) => {
  tabs = next;
  renderTabs();
  renderToolbar();
  renderSidebar();
});

// ---------- Toolbar ----------

$('omnibox-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const tab = activeTab();
  const value = omnibox.value.trim();
  if (!value) return;
  if (tab) void ks.tabs.navigate(tab.id, value);
  else void ks.tabs.create(value);
  omnibox.blur();
});
omnibox.addEventListener('focus', () => omnibox.select());
omnibox.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    renderToolbar();
    omnibox.blur();
  }
});

backBtn.addEventListener('click', () => { const t = activeTab(); if (t) void ks.tabs.back(t.id); });
forwardBtn.addEventListener('click', () => { const t = activeTab(); if (t) void ks.tabs.forward(t.id); });
reloadBtn.addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  void (t.loading ? ks.tabs.stop(t.id) : ks.tabs.reload(t.id));
});
$('btn-save-pdf').addEventListener('click', async () => {
  const res = await ks.api.savePageToDrive();
  if (!res.ok) toast('error', res.error);
});
$('btn-mail-page').addEventListener('click', () => {
  const t = activeTab();
  if (!t) return;
  void setPanelOpen(true).then(() => panel.compose({ to: '', subject: t.title, body: `${t.title}\n${t.url}` }));
});
$('btn-panel').addEventListener('click', togglePanel);
$('btn-menu').addEventListener('click', () => void ks.showAppMenu());

ks.events.onFocusAddress(() => {
  omnibox.focus();
  omnibox.select();
});
ks.events.onTogglePanel(togglePanel);
ks.events.onOpenSettings(() => void setPanelOpen(true).then(() => panel.show('settings')));
ks.events.onComposeMail((mail) => void setPanelOpen(true).then(() => panel.compose(mail)));
ks.events.onToast((t) => toast(t.kind, t.message));

// ---------- Layout ----------

/** The page views are native overlays: keep them aligned with the #content placeholder. */
function syncBounds(): void {
  const r = content.getBoundingClientRect();
  void ks.setContentBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
}
new ResizeObserver(syncBounds).observe(content);
window.addEventListener('resize', syncBounds);

// ---------- Boot ----------

async function boot(): Promise<void> {
  const [settings, status, initialTabs] = await Promise.all([ks.settings.get(), ks.token.status(), ks.tabs.list()]);
  tabs = initialTabs;
  renderTabs();
  renderToolbar();
  renderSidebar();
  document.body.classList.toggle('panel-open', settings.panelOpen || !status.configured);
  if (!status.configured) panel.show('settings');
  else panel.show('home');
  syncBounds();
}

void boot();
