// Downloads the Tor Expert Bundle (the tor client of Tor Browser) for this system from torproject.org,
// checks it and unpacks it into build/tor/<win|mac|linux>/, which the installer ships. Run by the CI.
//
// Checks: the archive's SHA-256 must appear in the version's sha256sums-signed-build.txt, and that file
// must carry a valid signature of the Tor Browser developers' key (fingerprint pinned below). The
// signature check needs gpg; it is required when VELO_REQUIRE_TOR_SIGNATURE=1 (the CI sets it).
//
// TOR_BROWSER_VERSION=14.5.8 picks a version; by default the newest stable one on the server.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.TOR_DIST_BASE || 'https://dist.torproject.org/torbrowser/';
/** Tor Browser Developers (signing key), https://support.torproject.org/tbb/how-to-verify-signature/ */
const SIGNING_KEY = 'EF6E286DDA85EA2A4BA7DE684E2C6E8793298290';
/** Web key directory entry of torbrowser@torproject.org (z-base32 SHA-1 of "torbrowser"). */
const WKD_URL = 'https://openpgpkey.torproject.org/.well-known/openpgpkey/torproject.org/hu/kounek7zrdx745qydx6p59t9mqjpuhdf?l=torbrowser';
const requireSignature = process.env.VELO_REQUIRE_TOR_SIGNATURE === '1';

const platform = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
/** Folder name: electron-builder's ${os} (see extraResources in package.json). */
const osDir = { win32: 'win', darwin: 'mac', linux: 'linux' }[process.platform];
const arch = process.arch === 'arm64' ? 'aarch64' : process.arch === 'x64' ? 'x86_64' : null;
if (!platform || !arch) throw new Error(`Sistema non supportato: ${process.platform}-${process.arch}`);

async function get(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Stable versions listed on the server, newest first (alphas have a letter: 15.0a3). */
async function stableVersions() {
  const html = (await get(BASE)).toString('utf8');
  const versions = [...new Set([...html.matchAll(/href="(\d+(?:\.\d+){1,3})\/"/g)].map((m) => m[1]))];
  const key = (v) => v.split('.').map((n) => n.padStart(5, '0')).join('.');
  return versions.sort((a, b) => key(b).localeCompare(key(a)));
}

const fileFor = (version) => `tor-expert-bundle-${platform}-${arch}-${version}.tar.gz`;

let version = process.env.TOR_BROWSER_VERSION;
if (!version) {
  for (const candidate of await stableVersions()) {
    const res = await fetch(`${BASE}${candidate}/${fileFor(candidate)}`, { method: 'HEAD' });
    if (res.ok) {
      version = candidate;
      break;
    }
  }
  if (!version) throw new Error('Nessuna versione di Tor trovata su dist.torproject.org');
}

const file = fileFor(version);
console.log(`Tor Expert Bundle ${version} (${platform}-${arch})`);
const archive = await get(`${BASE}${version}/${file}`);
const sums = await get(`${BASE}${version}/sha256sums-signed-build.txt`);
const signature = await get(`${BASE}${version}/sha256sums-signed-build.txt.asc`);

// 1. The archive is the one listed in the signed checksums.
const hash = createHash('sha256').update(archive).digest('hex');
const listed = sums
  .toString('utf8')
  .split('\n')
  .some((line) => {
    const [sum, name] = line.trim().split(/\s+/);
    return sum === hash && name?.replace(/^\*/, '').split('/').pop() === file;
  });
if (!listed) throw new Error(`${file}: SHA-256 ${hash} non presente in sha256sums-signed-build.txt`);
console.log(`SHA-256 verificato: ${hash}`);

// 2. The checksums are signed by the Tor Browser developers.
const work = mkdtempSync(join(tmpdir(), 'velo-tor-'));
try {
  writeFileSync(join(work, 'sums.txt'), sums);
  writeFileSync(join(work, 'sums.txt.asc'), signature);
  const gpg = (args) => execFileSync('gpg', ['--homedir', join(work, 'gnupg'), '--batch', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  let verified = false;
  try {
    mkdirSync(join(work, 'gnupg'), { recursive: true, mode: 0o700 });
    // The key from Tor's own web key directory (torbrowser@torproject.org, as their instructions
    // say), then a key server; whatever the source, only a signature by the pinned fingerprint counts.
    try {
      writeFileSync(join(work, 'key.gpg'), await get(WKD_URL));
      gpg(['--import', join(work, 'key.gpg')]);
    } catch {
      try {
        gpg(['--auto-key-locate', 'nodefault,wkd', '--locate-keys', 'torbrowser@torproject.org']);
      } catch {
        gpg(['--keyserver', 'hkps://keys.openpgp.org', '--recv-keys', SIGNING_KEY]);
      }
    }
    const status = gpg(['--status-fd', '1', '--verify', join(work, 'sums.txt.asc'), join(work, 'sums.txt')]);
    // VALIDSIG <signing subkey> … <primary key fingerprint>
    verified = status.split('\n').some((line) => line.startsWith('[GNUPG:] VALIDSIG ') && line.trim().endsWith(SIGNING_KEY));
    if (!verified) throw new Error('firma non valida o di un\'altra chiave');
    console.log(`Firma verificata (chiave ${SIGNING_KEY})`);
  } catch (e) {
    const message = `Firma dei checksum non verificata: ${e.message?.split('\n')[0] ?? e}`;
    if (requireSignature) throw new Error(message);
    console.warn(`${message} (solo il checksum è stato controllato)`);
  }

  // 3. Unpacked into build/tor/<os>/: tor/ (executable and libraries) and data/ (geoip).
  const dest = join('build', 'tor', osDir);
  rmSync(dest, { recursive: true, force: true });
  // Relative names only: GNU tar on Windows reads "C:" as a remote host.
  mkdirSync(join(work, 'out'));
  writeFileSync(join(work, 'out', file), archive);
  execFileSync('tar', ['-xzf', file], { cwd: join(work, 'out'), stdio: 'inherit' });
  rmSync(join(work, 'out', file));
  cpSync(join(work, 'out'), dest, { recursive: true });
  const exe = join(dest, 'tor', platform === 'windows' ? 'tor.exe' : 'tor');
  if (!existsSync(exe)) throw new Error(`${exe} non trovato nell'archivio`);
  writeFileSync(join(dest, 'VERSION'), `Tor Expert Bundle ${version} (${platform}-${arch})\nSHA-256 ${hash}\n`);
  console.log(`${exe} pronto`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
