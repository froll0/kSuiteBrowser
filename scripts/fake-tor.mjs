#!/usr/bin/env node
// Stand-in for the tor executable in tests (no Tor network needed): prints the bootstrap lines and
// serves SOCKS5 with username/password authentication on --SocksPort, connecting directly. Each
// connection is logged to FAKE_TOR_LOG as "username password host:port".
import { appendFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';

const arg = (name) => process.argv[process.argv.indexOf(name) + 1];
const port = Number(/:(\d+)/.exec(arg('--SocksPort'))[1]);
const log = process.env.FAKE_TOR_LOG;

createServer((c) => {
  let buf = Buffer.alloc(0);
  let stage = 0;
  let user = '';
  let pass = '';
  c.on('data', function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (stage === 0) {
        if (buf.length < 2 || buf.length < 2 + buf[1]) return;
        const methods = buf.subarray(2, 2 + buf[1]);
        buf = buf.subarray(2 + buf[1]);
        if (!methods.includes(2)) return c.end(Buffer.from([5, 0xff]));
        c.write(Buffer.from([5, 2]));
        stage = 1;
      } else if (stage === 1) {
        if (buf.length < 2) return;
        const ul = buf[1];
        if (buf.length < 3 + ul) return;
        const pl = buf[2 + ul];
        if (buf.length < 3 + ul + pl) return;
        user = buf.subarray(2, 2 + ul).toString();
        pass = buf.subarray(3 + ul, 3 + ul + pl).toString();
        buf = buf.subarray(3 + ul + pl);
        c.write(Buffer.from([1, 0]));
        stage = 2;
      } else if (stage === 2) {
        if (buf.length < 5) return;
        let host, len;
        if (buf[3] === 3) {
          len = 5 + buf[4] + 2;
          if (buf.length < len) return;
          host = buf.subarray(5, 5 + buf[4]).toString();
        } else if (buf[3] === 1) {
          len = 10;
          if (buf.length < len) return;
          host = [...buf.subarray(4, 8)].join('.');
        } else return c.destroy();
        const p = buf.readUInt16BE(len - 2);
        const rest = buf.subarray(len);
        stage = 3;
        c.off('data', onData);
        if (log) appendFileSync(log, `${user} ${pass} ${host}:${p}\n`);
        const target = host.endsWith('.onion') ? null : connect(p, host === 'localhost' ? '127.0.0.1' : host.endsWith('.example') ? '127.0.0.1' : host);
        if (!target) return c.end(Buffer.from([5, 4, 0, 1, 0, 0, 0, 0, 0, 0]));
        target.once('connect', () => {
          c.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length) target.write(rest);
          c.pipe(target);
          target.pipe(c);
        });
        target.once('error', () => c.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])));
        c.on('error', () => target.destroy());
        return;
      } else return;
    }
  });
}).listen(port, '127.0.0.1', async () => {
  for (const [p, s] of [[5, 'Connecting to a relay'], [50, 'Loading relay descriptors'], [100, 'Done']]) {
    console.log(`Oct 05 20:00:00.000 [notice] Bootstrapped ${p}% (x): ${s}`);
    await new Promise((r) => setTimeout(r, Number(process.env.FAKE_TOR_DELAY ?? 50)));
  }
});
