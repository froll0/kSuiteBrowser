import { ChatStreamParser } from '../shared/sse';
import type { AiMessage } from '../shared/types';
import { API_BASE, InfomaniakApiError, type InfomaniakClient } from './client';

export interface AiProduct {
  id: number;
  name: string;
}

export interface AiModel {
  name: string;
  type: string | null;
  description: string | null;
}

/** AI Services products of the account (empty when AI Services is not active). */
export async function listAiProducts(client: InfomaniakClient): Promise<AiProduct[]> {
  const raw = (await client.get<Array<{ id: number; name?: string; customer_name?: string; service_name?: string }>>(`${API_BASE}/1/ai`)) ?? [];
  return raw.map((p) => ({ id: p.id, name: p.customer_name || p.name || p.service_name || `AI #${p.id}` }));
}

/** Public catalogue of the models; only chat (LLM) models are kept. */
export async function listAiModels(client: InfomaniakClient): Promise<AiModel[]> {
  const raw = (await client.get<Array<{ name: string; type?: string; description?: string; info_status?: string }>>(`${API_BASE}/1/ai/models`)) ?? [];
  return raw
    .filter((m) => m.name && (!m.type || /llm|chat|text/i.test(m.type)))
    .map((m) => ({ name: m.name, type: m.type ?? null, description: m.description ?? null }));
}

/** A good general-purpose default: Mistral/Mixtral, then Qwen, then Llama, then the first model. */
export function pickDefaultModel(models: AiModel[]): string | null {
  for (const re of [/mi[sx]tral/i, /qwen/i, /llama/i]) {
    const found = models.find((m) => re.test(m.name));
    if (found) return found.name;
  }
  return models[0]?.name ?? null;
}

export function chatCompletionsUrl(productId: number): string {
  return `${API_BASE}/2/ai/${productId}/openai/v1/chat/completions`;
}

/** Streams a chat completion; calls onDelta with each piece of text and resolves with the whole answer. */
export async function streamChat(
  client: InfomaniakClient,
  productId: number,
  model: string,
  messages: AiMessage[],
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const res = await client.raw(chatCompletionsUrl(productId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.3 }),
    signal,
  });
  let answer = '';
  const emit = (delta: string) => {
    answer += delta;
    onDelta(delta);
  };

  // Some deployments answer with plain JSON even when streaming is requested.
  if ((res.headers.get('content-type') ?? '').includes('application/json')) {
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? '';
    if (text) emit(text);
    return answer;
  }
  if (!res.body) throw new InfomaniakApiError('Risposta vuota dal servizio IA.', 500);

  const parser = new ChatStreamParser();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const d of parser.push(decoder.decode(value, { stream: true }))) emit(d);
    if (parser.done) break;
  }
  for (const d of parser.flush()) emit(d);
  return answer;
}
