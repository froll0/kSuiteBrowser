import { tr } from '../shared/i18n';
// Overridable only through the environment, to run the app against a local mock in tests.
const env = typeof process !== 'undefined' ? process.env : {};
export const API_BASE = env.VELO_API_BASE || 'https://api.infomaniak.com';
export const MAIL_API_BASE = env.VELO_MAIL_API_BASE || 'https://mail.infomaniak.com/api';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class InfomaniakApiError extends Error {
  constructor(
    /** What happened, for anyone: shown in the interface. */
    message: string,
    readonly status: number,
    readonly code: string | null = null,
    /** The technical side (endpoint, API code and description), behind "Details". */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = 'InfomaniakApiError';
  }
}

interface ApiErrorDetail {
  code?: string;
  description?: string;
  context?: Record<string, unknown>;
}

interface Envelope<T> {
  result?: 'success' | 'error' | string;
  data?: T;
  error?: ApiErrorDetail & { errors?: ApiErrorDetail[] };
  cursor?: string | null;
  has_more?: boolean;
}

/**
 * Thin authenticated wrapper around the Infomaniak REST APIs.
 * Every service answers with `{ result, data, error }`; this unwraps it and turns failures into errors.
 */
export class InfomaniakClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async request<T>(url: string, init: RequestInit = {}): Promise<Envelope<T>> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    headers.set('Accept', 'application/json');

    const res = await this.call(url, { ...init, headers });
    const text = await res.text();
    let body: Envelope<T> | null = null;
    try {
      body = text ? (JSON.parse(text) as Envelope<T>) : null;
    } catch {
      body = null;
    }

    if (!res.ok || body?.result === 'error') throw apiError(url, res, text);
    return body ?? {};
  }

  async get<T>(url: string): Promise<T> {
    return (await this.request<T>(url)).data as T;
  }

  async send<T>(method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<T> {
    const init: RequestInit = { method };
    if (payload !== undefined) init.body = JSON.stringify(payload);
    return (await this.request<T>(url, init)).data as T;
  }

  /** Raw authenticated fetch, for binary downloads and uploads. */
  async raw(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    const res = await this.call(url, { ...init, headers });
    if (!res.ok) throw apiError(url, res, await res.text().catch(() => ''));
    return res;
  }

  /** fetch, with "no connection" as a readable error (aborts stay aborts). */
  private async call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, init);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new InfomaniakApiError(tr('Nessuna connessione con Infomaniak: controlla la rete e riprova.'), 0, 'network', `${endpointOf(url)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Builds a readable error naming the endpoint and, for 422s, the fields the API rejected. */
export function apiError(url: string, res: Pick<Response, 'status' | 'statusText'>, text: string): InfomaniakApiError {
  let error: Envelope<unknown>['error'];
  try {
    error = (JSON.parse(text) as Envelope<unknown>).error;
  } catch {
    error = undefined;
  }
  const code = error?.code ?? null;
  const details = (error?.errors ?? [])
    .map((e) => {
      const attribute = e.context?.attribute;
      return [attribute ? `${String(attribute)}:` : '', e.description ?? e.code ?? ''].filter(Boolean).join(' ');
    })
    .filter(Boolean);
  // Without a list of fields, whatever the API says about the request (e.g. which parameter).
  if (!details.length && error?.context && Object.keys(error.context).length) details.push(JSON.stringify(error.context).slice(0, 200));
  // A refused request without any detail: the request and the whole answer, to find out what it wants.
  if (res.status === 422 && !details.length) details.push(tr('richiesta: {0}', queryOf(url)), tr('risposta: {0}', text.slice(0, 400)));
  const description = [error?.description ?? (text.slice(0, 200) || res.statusText), ...details].join(' — ');
  const technical = tr('Errore API {0}{1} su {2}: {3}', res.status, code ? ` [${code}]` : '', endpointOf(url), description);
  return new InfomaniakApiError(humanError(res.status, serviceOf(url)), res.status, code, technical);
}

/** The service an endpoint belongs to, as a subject for the messages. */
function serviceOf(url: string): string {
  const path = endpointOf(url);
  if (/\/calendar\//.test(path)) return tr('Il calendario');
  if (/mail/.test(path)) return tr('La posta');
  if (/\/drive\//.test(path)) return 'kDrive';
  if (/\/ai\b/.test(path)) return tr('L’assistente IA');
  if (/\/profile/.test(path)) return tr('Il profilo Infomaniak');
  return 'Infomaniak';
}

/** What a failed call means for the user, without codes. */
export function humanError(status: number, service: string): string {
  if (status === 401) return tr('Il collegamento con Infomaniak è scaduto: inserisci di nuovo il token in Impostazioni › Account cloud.');
  if (status === 403) return tr('{0}: il token non ha il permesso necessario. Crea un token con questo servizio in Impostazioni › Account cloud.', service);
  if (status === 404) return tr('{0}: non trovato. Forse il servizio non è attivo sul tuo account.', service);
  if (status === 429) return tr('Troppe richieste a Infomaniak in poco tempo: riprova tra un minuto.');
  if (status >= 500) return tr('{0} non risponde in questo momento: riprova tra poco.', service);
  return tr('{0} non ha accettato la richiesta.', service);
}

function queryOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).search.replace(/\+/g, ' ')) || '—';
  } catch {
    return '—';
  }
}

function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

