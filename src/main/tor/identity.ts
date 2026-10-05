import { randomBytes } from 'node:crypto';
import { session as electronSession, type Session } from 'electron';
import { siteOf } from '../../shared/privacy-rules';
import type { SessionRouter } from '../tabs';
import type { SocksRelay } from './relay';
import { tr } from '../../shared/i18n';

/**
 * Everything the Tor windows share: one in-memory session per site, each going through its own relay
 * listener (its own Tor circuit). "New identity" throws all of it away, like Tor Browser does.
 */
export class TorIdentity implements SessionRouter {
  private generation = randomBytes(6).toString('hex');
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<Session>>();
  /** Per site: changed by "new circuit for this site". */
  private readonly nonces = new Map<string, string>();
  private readonly all = new Set<Session>();

  constructor(
    private readonly relay: SocksRelay,
    /** Privacy protections, permissions, internal pages… as for private windows. */
    private readonly setup: (ses: Session, key: string) => void,
    private readonly teardown: (ses: Session) => void,
  ) {}

  /** Session of the internal pages (new tab) of the Tor windows. */
  get base(): Session {
    return electronSession.fromPartition(`tor-${this.generation}`);
  }

  isTorSession(ses: Session): boolean {
    return this.all.has(ses);
  }

  keyFor(url: string): string | null {
    if (!/^https?:/i.test(url)) return null;
    try {
      return siteOf(url) ?? new URL(url).hostname;
    } catch {
      return null;
    }
  }

  ready(key: string): Session | null {
    return this.sessions.get(key) ?? null;
  }

  prepare(key: string): Promise<Session> {
    const ready = this.sessions.get(key);
    if (ready) return Promise.resolve(ready);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.create(key).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return pending;
  }

  private async create(key: string): Promise<Session> {
    const generation = this.generation;
    // No "persist:" prefix: nothing is written to disk.
    const ses = key ? electronSession.fromPartition(`tor-${generation}-${key}`) : this.base;
    this.all.add(ses);
    this.setup(ses, key);
    const port = await this.relay.listen(`${generation}|${key}`, () => ({ username: key || 'velo', password: `${generation}:${this.nonces.get(key) ?? ''}` }));
    // Everything through Tor, the computer's own services included (sites can't probe them).
    await ses.setProxy({ mode: 'fixed_servers', proxyRules: `socks5://127.0.0.1:${port}`, proxyBypassRules: '<-loopback>' });
    if (generation !== this.generation) throw new Error(tr('Identità cambiata'));
    this.sessions.set(key, ses);
    return ses;
  }

  /** New circuit for one site: new credentials, open connections closed. */
  async newCircuit(key: string): Promise<void> {
    this.nonces.set(key, randomBytes(6).toString('hex'));
    await this.sessions.get(key)?.closeAllConnections();
  }

  /** New identity: every session is wiped and dropped, the next pages use new circuits. */
  async reset(): Promise<void> {
    const old = [...this.all];
    this.generation = randomBytes(6).toString('hex');
    this.sessions.clear();
    this.pending.clear();
    this.nonces.clear();
    this.all.clear();
    this.relay.closeAll();
    await Promise.all(
      old.map(async (ses) => {
        await ses.closeAllConnections().catch(() => undefined);
        await ses.clearStorageData().catch(() => undefined);
        await ses.clearCache().catch(() => undefined);
        await ses.clearAuthCache().catch(() => undefined);
        this.teardown(ses);
      }),
    );
  }
}
