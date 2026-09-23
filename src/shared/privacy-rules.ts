import { getDomain, getHostname } from 'tldts';

/** Registrable domain ("site") of a URL: www.example.co.uk -> example.co.uk. Falls back to the hostname. */
export function siteOf(url: string): string | null {
  const hostname = getHostname(url);
  if (!hostname) return null;
  return (getDomain(url) ?? hostname).toLowerCase();
}

/** True when `requestUrl` belongs to a different site than the page that loads it. */
export function isThirdParty(requestUrl: string, pageUrl: string | null | undefined): boolean {
  if (!pageUrl) return false;
  const page = siteOf(pageUrl);
  const request = siteOf(requestUrl);
  if (!page || !request) return false;
  return page !== request;
}

const LOCAL_HOST_RE = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$|\.(localhost|local|internal|lan|home\.arpa)$/i;
const PRIVATE_IP_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

/**
 * HTTPS-only mode: the https:// URL to load instead of an http:// one,
 * or null when the URL must be left alone (not http, local network, or an exception chosen by the user).
 */
export function httpsUpgrade(url: string, exceptions: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.toLowerCase();
  if (LOCAL_HOST_RE.test(host) || PRIVATE_IP_RE.test(host) || !host.includes('.')) return null;
  if (exceptions.includes(host)) return null;
  parsed.protocol = 'https:';
  if (parsed.port === '80') parsed.port = '';
  return parsed.href;
}

/** Removes a header regardless of its casing; returns true when something was removed. */
export function deleteHeader(headers: Record<string, unknown>, name: string): boolean {
  let removed = false;
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete headers[key];
      removed = true;
    }
  }
  return removed;
}
