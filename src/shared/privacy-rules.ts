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

/** Parameters added to links only to follow people across sites (ads, newsletters, social networks). */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ymclid', 'twclid', 'ttclid', 'igshid', 'igsh',
  'li_fat_id', 'epik', 'srsltid', 'mc_cid', 'mc_eid', 'mkt_tok', '_hsenc', '_hsmi', '__hssc', '__hstc', '__hsfp', 'hsctatracking',
  'oly_anon_id', 'oly_enc_id', 'rb_clickid', 's_cid', 'vero_id', 'vero_conv', 'wickedid', '_openstat', 'ga_source', 'ga_medium',
  'ga_campaign', 'ga_content', 'ga_term', '_ga', '_gl', 'irclickid', 'sc_cid', 'ncid', 'ref_src', 'ref_url', 'cvid', 'oicd',
]);
/** Parameters that only track on specific sites (elsewhere the same name may be needed). */
const SITE_PARAMS: Array<[RegExp, string[]]> = [
  [/(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/, ['si', 'feature', 'pp']],
  [/(^|\.)amazon\.[a-z.]+$/, ['pd_rd_r', 'pd_rd_w', 'pd_rd_wg', 'pd_rd_i', 'pf_rd_p', 'pf_rd_r', 'pf_rd_s', 'pf_rd_t', 'pf_rd_i', 'pf_rd_m', 'content-id', 'ref_', 'qid', 'sprefix', 'crid']],
  [/(^|\.)(twitter\.com|x\.com)$/, ['s', 't']],
  [/(^|\.)instagram\.com$/, ['utm_source', 'img_index']],
  [/(^|\.)linkedin\.com$/, ['trk', 'trackingid', 'refid', 'lipi', 'midtoken', 'midsig', 'trkemail', 'eid']],
];

/**
 * The address without its tracking parameters (utm_*, fbclid, gclid…), or null when there's nothing to
 * remove. Only the query string changes: the page, the fragment and every other parameter stay.
 */
export function stripTrackingParams(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.search) return null;
  const host = parsed.hostname.toLowerCase();
  const siteSpecific = SITE_PARAMS.filter(([re]) => re.test(host)).flatMap(([, names]) => names);
  const keys = [...new Set(parsed.searchParams.keys())];
  const remove = keys.filter((k) => {
    const name = k.toLowerCase();
    return name.startsWith('utm_') || TRACKING_PARAMS.has(name) || siteSpecific.includes(name);
  });
  if (remove.length === 0) return null;
  for (const k of remove) parsed.searchParams.delete(k);
  // "?" alone looks odd: drop it when nothing is left.
  if ([...parsed.searchParams.keys()].length === 0) parsed.search = '';
  return parsed.href;
}
