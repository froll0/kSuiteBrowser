import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { listAiModels, listAiProducts, pickDefaultModel, streamChat, type AiModel, type AiProduct } from '../api/ai';
import { InfomaniakApiError, InfomaniakClient } from '../api/client';
import { SYSTEM_PROMPT, quoted } from '../shared/ai-prompts';
import type { AiEvent, AiMessage, AiStatus } from '../shared/types';
import { readerOriginal } from './reader';
import type { SettingsStore } from './settings';

const PAGE_TEXT_LIMIT = 15_000;

/** Page title, address and visible text, read in an isolated world so the page can't interfere. */
export async function readPage(contents: WebContents): Promise<{ title: string; url: string; text: string } | null> {
  // In reader mode the article is read from the reader page (cleaner), with the article's address.
  const url = readerOriginal(contents.getURL()) ?? contents.getURL();
  if (!/^(https?|file):/i.test(url)) return null;
  const text = (await contents.executeJavaScriptInIsolatedWorld(1999, [
    { code: `((document.getElementById('ks-reader-article') || document.body) ? (document.getElementById('ks-reader-article') || document.body).innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${PAGE_TEXT_LIMIT})` },
  ])) as string;
  return { title: contents.getTitle(), url, text: String(text ?? '') };
}

/** Chat with the Infomaniak AI Services models, streaming answers to the page that asked. */
export class AiService {
  private readonly running = new Map<string, AbortController>();
  private product: AiProduct | null = null;
  private models: AiModel[] | null = null;

  constructor(private readonly settings: SettingsStore) {}

  reset(): void {
    this.product = null;
    this.models = null;
  }

  private client(): InfomaniakClient {
    const token = this.settings.getToken();
    if (!token) throw new InfomaniakApiError('Collega prima l’account kSuite (Impostazioni › Account kSuite).', 401);
    return new InfomaniakClient(token);
  }

  status(): AiStatus {
    const s = this.settings.get();
    return { enabled: s.aiEnabled, configured: this.settings.tokenStatus().configured, productId: s.aiProductId ?? this.product?.id ?? null, model: s.aiModel };
  }

  listProducts(): Promise<AiProduct[]> {
    return listAiProducts(this.client());
  }

  async listModels(): Promise<AiModel[]> {
    this.models ??= await listAiModels(this.client());
    return this.models;
  }

  private async target(): Promise<{ productId: number; model: string }> {
    const s = this.settings.get();
    let productId = s.aiProductId;
    if (!productId) {
      this.product ??= (await this.listProducts())[0] ?? null;
      if (!this.product) throw new InfomaniakApiError('Nessun prodotto AI Services trovato: attivalo nel Manager Infomaniak, poi riprova.', 404);
      productId = this.product.id;
    }
    const model = s.aiModel ?? pickDefaultModel(await this.listModels());
    if (!model) throw new InfomaniakApiError('Nessun modello IA disponibile.', 404);
    return { productId, model };
  }

  /**
   * Starts a chat and returns its id; deltas go to `target` on `channel` as AiEvent.
   * `page` (optional) is added as context, clearly marked as untrusted material.
   */
  start(messages: AiMessage[], target: WebContents, channel: string, page?: { title: string; url: string; text: string } | null): string {
    const id = randomUUID();
    const controller = new AbortController();
    this.running.set(id, controller);
    const send = (event: AiEvent) => {
      if (!target.isDestroyed()) target.send(channel, event);
    };
    const system: AiMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    if (page) system.push({ role: 'system', content: `L'utente sta guardando la pagina «${page.title}» (${page.url}).\n${quoted('Contenuto della pagina', page.text, PAGE_TEXT_LIMIT)}` });

    void (async () => {
      try {
        if (!this.settings.get().aiEnabled) throw new InfomaniakApiError('L’assistente IA è disattivato: attivalo in Impostazioni › Intelligenza artificiale.', 400);
        const { productId, model } = await this.target();
        await streamChat(this.client(), productId, model, [...system, ...messages.slice(-20)], (delta) => send({ id, delta }), controller.signal);
        send({ id, done: true });
      } catch (err) {
        if (controller.signal.aborted) send({ id, done: true });
        else send({ id, done: true, error: aiError(err) });
      } finally {
        this.running.delete(id);
      }
    })();
    return id;
  }

  cancel(id: string): void {
    this.running.get(id)?.abort();
  }

  /** Short round-trip used by the "Prova" button in the settings. */
  async test(): Promise<string> {
    const { productId, model } = await this.target();
    let text = '';
    await streamChat(this.client(), productId, model, [{ role: 'user', content: 'Rispondi solo con: OK' }], (d) => (text += d));
    return `${model} · prodotto ${productId} · risposta: ${text.trim().slice(0, 40) || '(vuota)'}`;
  }
}

function aiError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof InfomaniakApiError && err.status === 403) return 'Il token API non può usare AI Services: crea un token che includa lo scope relativo all’IA (AI Services) e salvalo in Impostazioni › Account kSuite.';
  return message;
}
