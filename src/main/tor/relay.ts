import { connect, createServer, type Server, type Socket } from 'node:net';

/**
 * Local SOCKS5 relay in front of Tor. Chromium can't send SOCKS credentials, but Tor uses them to keep
 * streams apart (IsolateSOCKSAuth): every listener of the relay adds its own username and password,
 * so each site gets its own circuit. Chromium sends hostnames, never resolves them: DNS goes through Tor.
 */
export class SocksRelay {
  private readonly listeners = new Map<string, { server: Server; port: number }>();
  private readonly sockets = new Set<Socket>();

  constructor(
    /** Tor's SocksPort, once Tor is ready to carry traffic (connections wait for it). */
    private readonly upstream: () => Promise<{ host: string; port: number }>,
  ) {}

  /** Port of the listener for an isolation key (created on first use). */
  async listen(key: string, credentials: () => { username: string; password: string }): Promise<number> {
    const existing = this.listeners.get(key);
    if (existing) return existing.port;
    const server = createServer((client) => this.serve(client, credentials()));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    this.listeners.set(key, { server, port });
    return port;
  }

  /** Closes the listener of a key (existing connections are dropped too, see closeAll). */
  close(key: string): void {
    this.listeners.get(key)?.server.close();
    this.listeners.delete(key);
  }

  /** Drops every listener and connection (new identity, quit). */
  closeAll(): void {
    for (const key of [...this.listeners.keys()]) this.close(key);
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
  }

  private track(socket: Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  }

  private serve(client: Socket, creds: { username: string; password: string }): void {
    this.track(client);
    client.pause();
    void (async () => {
      const read = reader(client);
      // Greeting: VER, NMETHODS, METHODS. We only offer "no authentication" to Chromium.
      const [ver, n] = await read(2);
      if (ver !== 5) {
        client.destroy();
        return;
      }
      await read(n);
      client.write(Buffer.from([5, 0]));
      // Request: VER CMD RSV ATYP DST.ADDR DST.PORT. Only CONNECT.
      const head = await read(4);
      if (head[1] !== 1) {
        client.end(Buffer.from([5, 7, 0, 1, 0, 0, 0, 0, 0, 0]));
        return;
      }
      let addr: Buffer;
      if (head[3] === 1) addr = await read(4);
      else if (head[3] === 4) addr = await read(16);
      else if (head[3] === 3) {
        const [len] = await read(1);
        addr = Buffer.concat([Buffer.from([len]), await read(len)]);
      } else {
        client.destroy();
        return;
      }
      const port = await read(2);
      const request = Buffer.concat([Buffer.from([5, 1, 0, head[3]]), addr, port]);

      const target = await this.upstream();
      const tor = connect(target.port, target.host);
      this.track(tor);
      await new Promise<void>((resolve, reject) => {
        tor.once('connect', resolve);
        tor.once('error', reject);
      });
      const fromTor = reader(tor);
      // Username/password authentication (RFC 1929) carries the isolation key.
      tor.write(Buffer.from([5, 1, 2]));
      const choice = await fromTor(2);
      if (choice[1] !== 2) throw new Error('Tor rejected authentication');
      const user = Buffer.from(creds.username).subarray(0, 255);
      const pass = Buffer.from(creds.password).subarray(0, 255);
      tor.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([pass.length]), pass]));
      const auth = await fromTor(2);
      if (auth[1] !== 0) throw new Error('Tor rejected credentials');
      tor.write(request);
      // Reply: VER REP RSV ATYP BND.ADDR BND.PORT, passed on to Chromium as is.
      const reply = await fromTor(4);
      let bound: Buffer;
      if (reply[3] === 1) bound = await fromTor(6);
      else if (reply[3] === 4) bound = await fromTor(18);
      else {
        const [len] = await fromTor(1);
        bound = Buffer.concat([Buffer.from([len]), await fromTor(len + 2)]);
      }
      client.write(Buffer.concat([reply, bound]));
      if (reply[1] !== 0) {
        client.end();
        tor.destroy();
        return;
      }
      const restClient = read.rest();
      const restTor = fromTor.rest();
      if (restTor.length) client.write(restTor);
      if (restClient.length) tor.write(restClient);
      client.pipe(tor);
      tor.pipe(client);
      client.resume();
      tor.resume();
    })().catch(() => {
      // General failure: Chromium shows its proxy error page.
      if (!client.destroyed) client.end(Buffer.from([5, 1, 0, 1, 0, 0, 0, 0, 0, 0]));
    });
  }
}

/** Reads exact byte counts from a paused socket. */
function reader(socket: Socket) {
  let buffered = Buffer.alloc(0);
  let waiting: { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void } | null = null;
  let ended = false;
  const flush = () => {
    if (!waiting) return;
    if (buffered.length >= waiting.n) {
      const out = buffered.subarray(0, waiting.n);
      buffered = buffered.subarray(waiting.n);
      const w = waiting;
      waiting = null;
      socket.pause();
      w.resolve(out);
    } else if (ended) {
      const w = waiting;
      waiting = null;
      w.reject(new Error('Connection closed'));
    }
  };
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    flush();
  };
  socket.on('data', onData);
  socket.once('end', () => {
    ended = true;
    flush();
  });
  socket.once('close', () => {
    ended = true;
    flush();
  });
  const read = (n: number): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (n === 0) return resolve(Buffer.alloc(0));
      waiting = { n, resolve, reject };
      socket.resume();
      flush();
    });
  /** Stops reading: returns what arrived beyond the handshake. */
  read.rest = () => {
    socket.off('data', onData);
    socket.pause();
    const out = buffered;
    buffered = Buffer.alloc(0);
    return out;
  };
  return read;
}
