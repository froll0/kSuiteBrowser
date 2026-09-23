export const API_BASE = 'https://api.infomaniak.com';
export const MAIL_API_BASE = 'https://mail.infomaniak.com/api';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class InfomaniakApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
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

    const res = await this.fetchImpl(url, { ...init, headers });
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
    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok) throw apiError(url, res, await res.text().catch(() => ''));
    return res;
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
  const description = [error?.description ?? (text.slice(0, 200) || res.statusText), ...details].join(' — ');
  return new InfomaniakApiError(describeError(res.status, code, description, endpointOf(url)), res.status, code);
}

function endpointOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

function describeError(status: number, code: string | null, description: string, endpoint: string): string {
  if (status === 401) return 'Token non valido o scaduto (401). Controlla il token API nelle impostazioni.';
  if (status === 403) return `Accesso negato (403) su ${endpoint}: il token non ha lo scope necessario. ${description}`;
  return `Errore API ${status}${code ? ` [${code}]` : ''} su ${endpoint}: ${description}`;
}
