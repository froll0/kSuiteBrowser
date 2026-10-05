import { readFileSync, rmSync } from 'node:fs';
import { createServer, connect, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SocksRelay } from '../src/main/tor/relay';
import { TorProcess, parseBootstrap } from '../src/main/tor/process';

const log = join(tmpdir(), `velo-fake-tor-${process.pid}.log`);
let echo: Server;
let echoPort = 0;

beforeAll(async () => {
  echo = createServer((s) => s.on('data', (d) => s.write(Buffer.concat([Buffer.from('echo:'), d]))));
  await new Promise<void>((r) => echo.listen(0, '127.0.0.1', () => r()));
  echoPort = (echo.address() as { port: number }).port;
});
afterAll(() => {
  echo.close();
  rmSync(log, { force: true });
});

/** A SOCKS5 CONNECT through the relay, as Chromium does it (hostname, no auth), then one message. */
function viaRelay(port: number, host: string, message: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = connect(port, '127.0.0.1');
    let stage = 0;
    let out = Buffer.alloc(0);
    s.on('connect', () => s.write(Buffer.from([5, 1, 0])));
    s.on('data', (d) => {
      out = Buffer.concat([out, d]);
      if (stage === 0 && out.length >= 2) {
        out = out.subarray(2);
        stage = 1;
        const name = Buffer.from(host);
        const p = Buffer.alloc(2);
        p.writeUInt16BE(echoPort);
        s.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, p]));
      }
      if (stage === 1 && out.length >= 10) {
        if (out[1] !== 0) return reject(new Error(`reply ${out[1]}`));
        out = out.subarray(10);
        stage = 2;
        s.write(message);
      }
      if (stage === 2 && out.length) {
        resolve(out.toString());
        s.destroy();
      }
    });
    s.on('error', reject);
  });
}

describe('Tor windows', () => {
  it('reads the bootstrap progress', () => {
    expect(parseBootstrap('Oct 05 [notice] Bootstrapped 45% (loading_descriptors): Loading relay descriptors')).toEqual({ progress: 45, summary: 'Loading relay descriptors' });
    expect(parseBootstrap('Oct 05 [notice] Opening Socks listener')).toBeNull();
  });

  it('starts Tor, waits for it, and gives each site its own credentials', async () => {
    const tor = new TorProcess(() => ({ exe: join(process.cwd(), 'scripts', 'fake-tor.mjs'), dataDir: null }), join(tmpdir(), `velo-tor-${process.pid}`));
    process.env.FAKE_TOR_LOG = log;
    const states: string[] = [];
    tor.onStatus((s) => states.push(s.state === 'starting' ? `${s.progress}` : s.state));
    const relay = new SocksRelay(() => tor.ready());
    const a = await relay.listen('alpha.example', () => ({ username: 'alpha.example', password: 'n1' }));
    const b = await relay.listen('beta.example', () => ({ username: 'beta.example', password: 'n1' }));
    expect(await relay.listen('alpha.example', () => ({ username: 'x', password: 'y' }))).toBe(a);
    expect(await viaRelay(a, 'alpha.example', 'hi')).toBe('echo:hi');
    expect(await viaRelay(b, 'cdn.example', 'yo')).toBe('echo:yo');
    expect(states).toContain('ready');
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toEqual([`alpha.example n1 alpha.example:${echoPort}`, `beta.example n1 cdn.example:${echoPort}`]);
    relay.closeAll();
    tor.stop();
  });

  it('reports a missing Tor instead of hanging', async () => {
    const tor = new TorProcess(() => null, join(tmpdir(), 'velo-tor-none'));
    await expect(tor.ready()).rejects.toThrow(/non è incluso/);
  });
});

describe('Tor windows: pages', () => {
  it('leaves onion addresses on http (Tor encrypts them)', async () => {
    const { httpsUpgrade } = await import('../src/shared/privacy-rules');
    expect(httpsUpgrade('http://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/', [])).toBeNull();
    expect(httpsUpgrade('http://example.com/', [])).toBe('https://example.com/');
  });

  it('rounds the page area like Tor Browser letterboxing', async () => {
    const { letterbox } = await import('../src/main/tabs');
    expect(letterbox({ x: 10, y: 80, width: 1385, height: 812 })).toEqual({ x: 10 + 92, y: 80, width: 1200, height: 800 });
    expect(letterbox({ x: 0, y: 0, width: 300, height: 150 })).toEqual({ x: 0, y: 0, width: 300, height: 150 });
  });
});
