/** Phishing and malware lists (malware-filter project, the ones uBlock Origin uses) and matching. */

export type ThreatKind = 'phishing' | 'malware';

export interface ParsedList {
  hosts: string[];
  /** "host/path…" prefixes, for bad pages on otherwise legitimate sites. */
  urls: string[];
}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9_-]+\.)+[a-z0-9-]{2,}$|^\d{1,3}(\.\d{1,3}){3}$/;

/** Reads a list in adblock, hosts or plain-domain format. */
export function parseThreatList(text: string): ParsedList {
  const hosts: string[] = [];
  const urls: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^[!#[]/.test(line) || line.startsWith('@@') || line.includes('##') || line.includes('#@#')) continue;
    line = line.replace(/\s+#.*$/, '');
    const hostsFile = /^(?:0\.0\.0\.0|127\.0\.0\.1)\s+(\S+)$/.exec(line);
    if (hostsFile) {
      if (HOST_RE.test(hostsFile[1].toLowerCase())) hosts.push(hostsFile[1].toLowerCase());
      continue;
    }
    const dollar = line.indexOf('$');
    if (dollar !== -1) {
      if (/badfilter/.test(line.slice(dollar))) continue;
      line = line.slice(0, dollar);
    }
    if (line.startsWith('||')) line = line.slice(2);
    else if (line.startsWith('|')) line = line.slice(1).replace(/^https?:\/\//i, '');
    line = line.replace(/\^\|?$/, '').replace(/\|$/, '');
    if (!line || line.includes('*')) continue;
    const slash = line.indexOf('/');
    if (slash === -1) {
      const host = line.toLowerCase().replace(/\.$/, '');
      if (HOST_RE.test(host)) hosts.push(host);
    } else {
      const host = line.slice(0, slash).toLowerCase();
      if (HOST_RE.test(host)) urls.push(host + line.slice(slash).replace(/\^/g, '').toLowerCase());
    }
  }
  return { hosts, urls };
}

export class ThreatIndex {
  private readonly hosts = new Map<string, ThreatKind>();
  private readonly urls = new Map<string, Array<{ prefix: string; kind: ThreatKind }>>();

  add(kind: ThreatKind, list: ParsedList): void {
    for (const h of list.hosts) if (!this.hosts.has(h)) this.hosts.set(h, kind);
    for (const u of list.urls) {
      const host = u.slice(0, u.indexOf('/'));
      const entries = this.urls.get(host) ?? [];
      entries.push({ prefix: u, kind });
      this.urls.set(host, entries);
    }
  }

  get size(): number {
    let n = this.hosts.size;
    for (const e of this.urls.values()) n += e.length;
    return n;
  }

  /** The kind of threat of a web address, checking the host, its parent domains and bad pages. */
  match(url: string): ThreatKind | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    const labels = host.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      const kind = this.hosts.get(labels.slice(i).join('.'));
      if (kind) return kind;
    }
    const entries = this.urls.get(host) ?? this.urls.get(host.replace(/^www\./, ''));
    if (entries) {
      const target = `${host.replace(/^www\./, '')}${parsed.pathname}${parsed.search}`.toLowerCase();
      const withWww = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
      const found = entries.find((e) => target.startsWith(e.prefix) || withWww.startsWith(e.prefix));
      if (found) return found.kind;
    }
    return null;
  }
}
