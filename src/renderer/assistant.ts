import { PAGE_ACTIONS, TEXT_ACTIONS, textActionMessages, type PageAction, type TextAction } from '../shared/ai-prompts';
import type { AiEvent, AiMessage, TabState } from '../shared/types';
import { ks } from './bridge';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { renderMarkdown } from './markdown-dom';

interface Turn {
  role: 'user' | 'assistant';
  /** Sent to the model. */
  content: string;
  /** Shown in the chat (short label for long prompts). */
  display: string;
  error?: string;
  pending?: boolean;
}

export type AiAsk = { action?: TextAction; text?: string; page?: PageAction; question?: string };

const PAGE_ICONS: Record<PageAction, IconName> = { summary: 'fileText', keypoints: 'check', translate: 'globe' };

/** The AI assistant view of the side panel. State survives switching views and re-renders. */
export class Assistant {
  private turns: Turn[] = [];
  private runningId: string | null = null;
  private usePage = false;
  private container: HTMLElement | null = null;
  private liveBubble: HTMLElement | null = null;
  private readonly handlers = new Map<string, (e: AiEvent) => void>();

  constructor(
    private readonly activeTab: () => TabState | undefined,
    private readonly notify: (kind: 'info' | 'success' | 'error', message: string) => void,
  ) {
    ks.events.onAi((e) => this.handlers.get(e.id)?.(e));
  }

  /** Runs a one-off completion (e.g. mail draft) and streams it to `onText`. */
  async complete(messages: AiMessage[], onText: (full: string) => void): Promise<string | null> {
    const id = await ks.ai.chat({ messages });
    let full = '';
    return new Promise((resolve) => {
      this.handlers.set(id, (e) => {
        if (e.delta) {
          full += e.delta;
          onText(full);
        }
        if (e.done) {
          this.handlers.delete(id);
          if (e.error) this.notify('error', e.error);
          resolve(e.error ? null : full);
        }
      });
    });
  }

  ask(req: AiAsk): void {
    if (req.action && req.text) {
      const content = textActionMessages(req.action, req.text)[0].content;
      const preview = req.text.length > 140 ? `${req.text.slice(0, 140)}…` : req.text;
      void this.send(content, `${TEXT_ACTIONS[req.action].label}: «${preview}»`, false);
    } else if (req.page) {
      void this.send(PAGE_ACTIONS[req.page].prompt, PAGE_ACTIONS[req.page].label, true);
    } else if (req.question) {
      void this.send(req.question, req.question, this.usePage);
    }
  }

  private pageTab(): TabState | undefined {
    const t = this.activeTab();
    return t && /^(https?|file):/i.test(t.url) ? t : undefined;
  }

  private async send(content: string, display: string, withPage: boolean): Promise<void> {
    if (this.runningId) await this.stop();
    const tab = withPage ? this.pageTab() : undefined;
    if (withPage && !tab) {
      this.notify('info', 'Apri una pagina web per usare questa azione.');
      return;
    }
    this.turns.push({ role: 'user', content, display });
    const reply: Turn = { role: 'assistant', content: '', display: '', pending: true };
    this.turns.push(reply);
    this.redraw();

    const history: AiMessage[] = this.turns.filter((t) => t !== reply && !t.error).map((t) => ({ role: t.role, content: t.content }));
    const id = await ks.ai.chat({ messages: history, pageTabId: tab?.id ?? null });
    this.runningId = id;
    this.redraw();
    this.handlers.set(id, (e) => {
      if (e.delta) {
        reply.content += e.delta;
        reply.display = reply.content;
        this.updateLive(reply);
      }
      if (e.done) {
        this.handlers.delete(id);
        reply.pending = false;
        if (e.error) reply.error = e.error;
        if (!reply.content && !e.error) reply.error = 'Risposta interrotta.';
        this.runningId = null;
        this.redraw();
      }
    });
  }

  private async stop(): Promise<void> {
    if (this.runningId) await ks.ai.cancel(this.runningId);
  }

  /** Renders the view into `container` (the panel body). */
  async render(container: HTMLElement): Promise<void> {
    this.container = container;
    const status = await ks.ai.status();
    if (!status.enabled) {
      container.replaceChildren(
        h('div', { class: 'empty-state' },
          withIcon(h('span', { class: 'big-icon' }), 'sparkles', 26),
          h('h2', {}, 'Assistente IA'),
          h('p', {}, 'Riassumi e traduci pagine, spiega testi, scrivi email: con i modelli di Infomaniak AI Services, ospitati in Svizzera.'),
          h('button', { class: 'primary', onclick: () => void ks.openSettingsPage('ai') }, 'Configura l’assistente')));
      return;
    }
    this.redraw();
  }

  private redraw(): void {
    const container = this.container;
    if (!container || !container.isConnected) return;
    this.liveBubble = null;
    const tab = this.pageTab();

    const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    if (this.turns.length === 0) {
      log.append(
        h('div', { class: 'chat-intro' },
          withIcon(h('span', { class: 'big-icon' }), 'sparkles', 24),
          h('p', {}, 'Chiedimi qualcosa, oppure usa un’azione rapida sulla pagina aperta.')),
        h('div', { class: 'quick-actions' },
          ...(Object.keys(PAGE_ACTIONS) as PageAction[]).map((a) =>
            withIcon(h('button', { class: 'quick', disabled: !tab, onclick: () => this.ask({ page: a }) }, PAGE_ACTIONS[a].label), PAGE_ICONS[a], 16))),
      );
    }
    for (const turn of this.turns) log.append(this.bubble(turn));

    const input = h('textarea', { rows: 2, placeholder: 'Scrivi un messaggio… (Invio per inviare)', 'aria-label': 'Messaggio per l’assistente' });
    const pageToggle = h('input', { type: 'checkbox', checked: this.usePage && Boolean(tab), disabled: !tab });
    pageToggle.addEventListener('change', () => (this.usePage = pageToggle.checked));
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      void this.send(text, text, this.usePage);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    });
    const sendBtn = this.runningId
      ? withIcon(h('button', { class: 'icon-btn send stop', title: 'Interrompi', 'aria-label': 'Interrompi la risposta', onclick: () => void this.stop() }), 'close', 18)
      : withIcon(h('button', { class: 'icon-btn send', title: 'Invia', 'aria-label': 'Invia', onclick: submit }), 'send', 18);

    const composer = h('div', { class: 'composer' },
      h('label', { class: 'page-toggle', title: tab ? tab.url : 'Nessuna pagina web aperta' }, pageToggle,
        h('span', { class: 'ellipsis' }, tab ? `Usa la pagina: ${tab.title}` : 'Nessuna pagina da usare')),
      h('div', { class: 'composer-row' }, input, sendBtn),
    );
    const header = h('div', { class: 'row spread chat-head' },
      h('span', { class: 'muted small' }, 'Infomaniak AI · Svizzera'),
      this.turns.length ? withIcon(h('button', { class: 'link', onclick: () => { void this.stop(); this.turns = []; this.redraw(); } }, 'Nuova chat'), 'plus', 14) : null);

    container.replaceChildren(h('div', { class: 'assistant' }, header, log, composer));
    log.scrollTop = log.scrollHeight;
    if (!this.runningId) input.focus();
  }

  private bubble(turn: Turn): HTMLElement {
    if (turn.role === 'user') return h('div', { class: 'bubble user' }, turn.display);
    const body = h('div', { class: 'bubble-body' });
    if (turn.display) body.append(renderMarkdown(turn.display, (url) => void ks.tabs.create(url)));
    if (turn.pending && !turn.display) body.append(h('span', { class: 'typing', 'aria-label': 'Sto scrivendo' }, h('i'), h('i'), h('i')));
    if (turn.error) body.append(h('div', { class: 'error', role: 'alert' }, icon('alert', 15), h('span', {}, turn.error)));
    const el = h('div', { class: 'bubble assistant' }, withIcon(h('span', { class: 'bot' }), 'sparkles', 15), body);
    if (!turn.pending && turn.content) {
      el.append(withIcon(h('button', {
        class: 'icon-btn small copy', title: 'Copia la risposta', 'aria-label': 'Copia la risposta',
        onclick: async () => {
          await navigator.clipboard.writeText(turn.content);
          this.notify('success', 'Risposta copiata');
        },
      }), 'copy', 14));
    }
    if (turn.pending) this.liveBubble = body;
    return el;
  }

  private updateLive(turn: Turn): void {
    if (!this.liveBubble?.isConnected) return this.redraw();
    this.liveBubble.replaceChildren(renderMarkdown(turn.display, (url) => void ks.tabs.create(url)));
    const log = this.liveBubble.closest('.chat-log');
    if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 120) log.scrollTop = log.scrollHeight;
  }
}

function withIcon<T extends HTMLElement>(el: T, name: IconName, size = 16): T {
  el.prepend(icon(name, size));
  return el;
}
