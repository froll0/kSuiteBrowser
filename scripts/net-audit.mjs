// Network audit: starts Velo with a fresh profile, leaves it idle, and checks with Chromium's network log
// that it only contacted the expected hosts (block lists, encrypted DNS). Fails on anything else, Google
// above all. Run by the CI (under xvfb on Linux): node scripts/net-audit.mjs [seconds]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');
const seconds = Number(process.argv[2] ?? 30);

/** Who Velo may talk to on its own (see README › Nessun contatto con Google). */
const ALLOWED = [
  /(^|\.)githubusercontent\.com$/, // tracker block lists (Ghostery)
  /(^|\.)github\.io$/, /(^|\.)gitlab\.io$/, /(^|\.)pages\.dev$/, // malware-filter lists (mirrors)
  /^dns\.quad9\.net$/, // encrypted DNS
  /^localhost$/, /^127\.0\.0\.1$/,
];
const FORBIDDEN = /(google|gstatic|googleapis|gvt1|gvt2|doubleclick|googlesyndication|youtube|ggpht)\./;

const dir = mkdtempSync(join(tmpdir(), 'velo-audit-'));
const log = join(dir, 'netlog.json');
const child = spawn(electron, ['.', '--no-sandbox', `--log-net-log=${log}`, '--net-log-capture-mode=Default'], {
  env: { ...process.env, XDG_CONFIG_HOME: join(dir, 'config'), HOME: join(dir, 'home'), APPDATA: join(dir, 'appdata'), VELO_AUDIT: '1' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
child.stderr.on('data', () => undefined);
await new Promise((r) => setTimeout(r, seconds * 1000));
child.kill('SIGTERM');
await new Promise((r) => child.once('exit', r));
await new Promise((r) => setTimeout(r, 500));

if (!existsSync(log)) throw new Error('Nessun registro di rete: Velo non si è avviato?');
// One event per line after the constants: read line by line (a log cut by the shutdown is still readable).
const lines = readFileSync(log, 'utf8').split('\n');
const constants = JSON.parse(lines[0].replace(/,\s*$/, '') + '}').constants;
const types = Object.fromEntries(Object.entries(constants.logEventTypes).map(([k, v]) => [v, k]));
const events = [];
for (const line of lines.slice(1)) {
  const text = line.trim().replace(/^\]?,?/, '').replace(/,$/, '').replace(/\]\}?$/, '');
  if (!text.startsWith('{')) continue;
  try {
    events.push(JSON.parse(text));
  } catch {
    /* partial last line */
  }
}
const hosts = new Set();
for (const e of events) {
  const type = types[e.type];
  const p = e.params ?? {};
  // Requests actually made, and connections opened (name or proxy host).
  if (type === 'URL_REQUEST_START_JOB' && typeof p.url === 'string') {
    try {
      const u = new URL(p.url);
      if (/^(https?|wss?):$/.test(u.protocol)) hosts.add(u.hostname);
    } catch {
      /* ignore */
    }
  }
  if (type === 'TCP_CONNECT' && typeof p.address_list === 'object') {
    /* addresses only: names come from the requests above */
  }
}
rmSync(dir, { recursive: true, force: true });

const list = [...hosts].sort();
console.log(`Host contattati in ${seconds} s: ${list.join(', ') || '(nessuno)'}`);
const forbidden = list.filter((h) => FORBIDDEN.test(`${h}.`));
const unexpected = list.filter((h) => !ALLOWED.some((re) => re.test(h)));
if (forbidden.length || unexpected.length) {
  console.error(`Contatti non previsti: ${[...new Set([...forbidden, ...unexpected])].join(', ')}`);
  process.exit(1);
}
console.log('Nessun contatto non previsto.');
