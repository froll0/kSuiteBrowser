import { webContents as allWebContents, type Session } from 'electron';
import { deleteHeader, httpsUpgrade, isThirdParty, siteOf } from '../shared/privacy-rules';
import type { TrackerBlocker } from './blocker';
import type { ThreatKind } from '../shared/threat-match';
import type { SettingsStore } from './settings';

/**
 * Installs the privacy filters on one session: tracker blocking, third-party cookie blocking,
 * DNT/GPC headers and HTTPS-only upgrades. Electron allows a single listener per webRequest event,
 * so everything goes through here.
 */
export class PrivacyGuard {
  /** Blocked request counts per WebContents id, reset on every main-frame navigation. */
  private readonly blocked = new Map<number, number>();
  /** https:// URLs we upgraded from http://, per WebContents id, to offer the HTTP fallback on failure. */
  private readonly upgraded = new Map<number, { https: string; http: string }>();
  /** Main-frame loads stopped as phishing or malware, per WebContents id, to show the warning page. */
  private readonly threats = new Map<number, { url: string; kind: ThreatKind }>();

  constructor(
    private readonly session: Session,
    private readonly settings: SettingsStore,
    private readonly blocker: TrackerBlocker,
    private readonly onBlockedChange: (webContentsId: number) => void,
    private readonly threatCheck: (url: string) => ThreatKind | null = () => null,
  ) {}

  install(): void {
    const filter = { urls: ['<all_urls>'] };
    const ses = this.session;

    ses.webRequest.onBeforeRequest(filter, (details, callback) => {
      const s = this.settings.get();
      const wcId = details.webContentsId;

      // Known phishing and malware sites never load, in the page or in a frame.
      if ((details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') && s.threatProtection) {
        const kind = this.threatCheck(details.url);
        if (kind) {
          if (details.resourceType === 'mainFrame' && wcId !== undefined) this.threats.set(wcId, { url: details.url, kind });
          return callback({ cancel: true });
        }
      }

      if (details.resourceType === 'mainFrame') {
        if (wcId !== undefined) this.resetCount(wcId);
        if (s.httpsOnly) {
          const target = httpsUpgrade(details.url, s.httpExceptions);
          if (target) {
            if (wcId !== undefined) this.upgraded.set(wcId, { https: target, http: details.url });
            return callback({ redirectURL: target });
          }
        }
        return callback({});
      }

      const pageUrl = this.pageUrl(wcId, details.referrer);
      if (!this.protectionActiveFor(pageUrl)) return callback({});
      const decision = this.blocker.check(details, pageUrl);
      if (decision && wcId !== undefined) this.increment(wcId);
      callback(decision ?? {});
    });

    ses.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
      const s = this.settings.get();
      const headers = details.requestHeaders;
      if (s.doNotTrack) {
        headers['DNT'] = '1';
        headers['Sec-GPC'] = '1';
      }
      if (s.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
        const pageUrl = this.pageUrl(details.webContentsId, details.referrer);
        if (!this.isExempt(pageUrl) && isThirdParty(details.url, pageUrl)) deleteHeader(headers, 'Cookie');
      }
      callback({ requestHeaders: headers });
    });

    ses.webRequest.onHeadersReceived(filter, (details, callback) => {
      const s = this.settings.get();
      const headers = { ...(details.responseHeaders ?? {}) };
      let changed = false;

      if (s.blockThirdPartyCookies && details.resourceType !== 'mainFrame') {
        const pageUrl = this.pageUrl(details.webContentsId, details.referrer);
        if (!this.isExempt(pageUrl) && isThirdParty(details.url, pageUrl)) changed = deleteHeader(headers, 'Set-Cookie') || changed;
      }

      const pageUrl = details.resourceType === 'mainFrame' ? details.url : this.pageUrl(details.webContentsId, details.referrer);
      const csp = this.protectionActiveFor(pageUrl) ? this.blocker.cspFor(details) : undefined;
      if (csp) {
        const existing = Object.entries(headers).filter(([k]) => k.toLowerCase() === 'content-security-policy').flatMap(([, v]) => v);
        deleteHeader(headers, 'Content-Security-Policy');
        headers['Content-Security-Policy'] = [[...csp.split(';').map((d) => d.trim()), ...existing].join(';')];
        changed = true;
      }
      callback(changed ? { responseHeaders: headers } : {});
    });
  }

  blockedCount(webContentsId: number): number {
    return this.blocked.get(webContentsId) ?? 0;
  }

  /** Tracking protection is on and the site is not in the user's exception list. */
  protectionActiveFor(pageUrl: string | null): boolean {
    return this.settings.get().trackingProtection !== 'off' && !this.isExempt(pageUrl);
  }

  /** The user turned protections off for this site (tracker and third-party cookie blocking). */
  isExempt(pageUrl: string | null): boolean {
    const site = pageUrl ? siteOf(pageUrl) : null;
    return site !== null && this.settings.get().protectionExceptions.includes(site);
  }

  /**
   * When an upgraded https:// page fails to load, the http:// URL the user asked for
   * (to show the HTTPS-only warning), otherwise null.
   */
  httpFallbackFor(webContentsId: number, failedUrl: string): string | null {
    const entry = this.upgraded.get(webContentsId);
    if (!entry || !sameUrl(entry.https, failedUrl)) return null;
    this.upgraded.delete(webContentsId);
    return entry.http;
  }

  /** When a page load was stopped as dangerous, what it was: the tab then shows the warning page. */
  threatFor(webContentsId: number, failedUrl: string): { url: string; kind: ThreatKind } | null {
    const entry = this.threats.get(webContentsId);
    if (!entry || !sameUrl(entry.url, failedUrl)) return null;
    this.threats.delete(webContentsId);
    return entry;
  }

  private pageUrl(webContentsId: number | undefined, referrer: string | undefined): string | null {
    if (webContentsId !== undefined) {
      const wc = allWebContents.fromId(webContentsId);
      const url = wc && !wc.isDestroyed() ? wc.getURL() : '';
      if (url) return url;
    }
    return referrer || null;
  }

  private resetCount(id: number): void {
    if (this.blocked.delete(id)) this.onBlockedChange(id);
  }

  private increment(id: number): void {
    this.blocked.set(id, (this.blocked.get(id) ?? 0) + 1);
    this.onBlockedChange(id);
  }
}

function sameUrl(a: string, b: string): boolean {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}
