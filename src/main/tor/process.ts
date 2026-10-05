import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, dirname, join } from 'node:path';
import { tr } from '../../shared/i18n';

export type TorStatus =
  | { state: 'off' }
  | { state: 'starting'; progress: number; summary: string }
  | { state: 'ready' }
  | { state: 'error'; message: string };

/** Where the tor executable is: bundled with Velo, then VELO_TOR_PATH, then the system's (development). */
export function findTor(resourcesPath: string, appPath: string): { exe: string; dataDir: string | null } | null {
  const exe = process.platform === 'win32' ? 'tor.exe' : 'tor';
  const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  for (const base of [join(resourcesPath, 'tor'), join(appPath, 'build', 'tor', platform)]) {
    const candidate = join(base, 'tor', exe);
    if (existsSync(candidate)) return { exe: candidate, dataDir: existsSync(join(base, 'data')) ? join(base, 'data') : null };
  }
  if (process.env.VELO_TOR_PATH && existsSync(process.env.VELO_TOR_PATH)) return { exe: process.env.VELO_TOR_PATH, dataDir: null };
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir && existsSync(join(dir, exe))) return { exe: join(dir, exe), dataDir: null };
  }
  return null;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

/** Parses Tor's "Bootstrapped NN% (tag): Summary" log lines. */
export function parseBootstrap(line: string): { progress: number; summary: string } | null {
  const m = /Bootstrapped (\d{1,3})%(?: \([^)]*\))?: (.*)$/.exec(line);
  return m ? { progress: Math.min(100, Number(m[1])), summary: m[2].trim() } : null;
}

/** Runs the Tor client that carries the Tor windows. Started on first use, stopped with Velo. */
export class TorProcess {
  private child: ChildProcess | null = null;
  private socksPort = 0;
  private current: TorStatus = { state: 'off' };
  private readyWaiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  private readonly listeners = new Set<(s: TorStatus) => void>();

  constructor(
    private readonly locate: () => { exe: string; dataDir: string | null } | null,
    /** Tor's own state (guard relays, consensus cache): kept between runs, like Tor Browser. */
    private readonly stateDir: string,
  ) {}

  get status(): TorStatus {
    return this.current;
  }

  available(): boolean {
    return this.locate() !== null;
  }

  onStatus(listener: (s: TorStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(status: TorStatus): void {
    this.current = status;
    for (const l of this.listeners) l(status);
    if (status.state === 'ready') for (const w of this.readyWaiters.splice(0)) w.resolve();
    if (status.state === 'error') for (const w of this.readyWaiters.splice(0)) w.reject(new Error(status.message));
  }

  /** Starts Tor if needed. */
  async start(): Promise<void> {
    if (this.child || this.current.state === 'starting' || this.current.state === 'ready') return;
    const found = this.locate();
    if (!found) {
      this.set({ state: 'error', message: tr('Tor non è incluso in questa installazione.') });
      return;
    }
    this.set({ state: 'starting', progress: 0, summary: tr('Avvio di Tor') });
    try {
      this.socksPort = await freePort();
    } catch (e) {
      this.set({ state: 'error', message: (e as Error).message });
      return;
    }
    mkdirSync(this.stateDir, { recursive: true });
    const args = [
      '--ignore-missing-torrc',
      '-f', join(this.stateDir, 'torrc-none'),
      '--DataDirectory', this.stateDir,
      // Each relay listener has its own credentials: one circuit per site (IsolateSOCKSAuth is on by default).
      '--SocksPort', `127.0.0.1:${this.socksPort} KeepAliveIsolateSOCKSAuth`,
      '--ClientOnly', '1',
      '--AvoidDiskWrites', '1',
      // Tor exits by itself if Velo dies without stopping it.
      '--__OwningControllerProcess', String(process.pid),
      '--Log', 'notice stdout',
    ];
    if (found.dataDir) {
      args.push('--GeoIPFile', join(found.dataDir, 'geoip'), '--GeoIPv6File', join(found.dataDir, 'geoip6'));
    }
    const env = { ...process.env };
    // Bundled libraries (libevent, OpenSSL) sit next to the executable.
    if (process.platform === 'linux') env.LD_LIBRARY_PATH = [dirname(found.exe), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    const child = spawn(found.exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    let tail = '';
    let lastError = '';
    const onLine = (line: string) => {
      const boot = parseBootstrap(line);
      if (boot) this.set(boot.progress >= 100 ? { state: 'ready' } : { state: 'starting', ...boot });
      else if (/\[(err|warn)\]/.test(line)) lastError = line.replace(/^.*\[(err|warn)\]\s*/, '');
    };
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      tail += chunk;
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() ?? '';
      for (const line of lines) onLine(line);
    });
    child.stderr?.on('data', () => undefined);
    child.once('error', (e) => {
      this.child = null;
      this.set({ state: 'error', message: e.message });
    });
    child.once('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      this.set(code === 0 || code === null ? { state: 'off' } : { state: 'error', message: lastError || tr('Tor si è chiuso (codice {0}).', code) });
    });
  }

  /** Resolves once Tor carries traffic (starting it if needed). */
  async ready(): Promise<{ host: string; port: number }> {
    if (this.current.state !== 'ready') {
      const waiting = new Promise<void>((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
      waiting.catch(() => undefined);
      if (this.current.state !== 'starting') await this.start();
      if (this.current.state === 'error') throw new Error(this.current.message);
      await waiting;
    }
    return { host: '127.0.0.1', port: this.socksPort };
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null) child.kill();
    for (const w of this.readyWaiters.splice(0)) w.reject(new Error(tr('Tor fermato')));
    this.set({ state: 'off' });
  }
}
