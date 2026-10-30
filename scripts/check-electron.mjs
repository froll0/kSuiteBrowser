// Is there a newer castlabs Electron (Chromium security fixes) than the one in package.json?
// Prints the result; with --issue opens (or updates) a GitHub issue through the gh CLI. Run weekly by CI.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const spec = pkg.devDependencies?.electron ?? pkg.dependencies?.electron ?? '';
const current = /#v(\d+\.\d+\.\d+)\+wvcus/.exec(spec)?.[1];
if (!current) throw new Error(`Versione di Electron non riconosciuta: ${spec}`);

const headers = { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const res = await fetch('https://api.github.com/repos/castlabs/electron-releases/releases?per_page=50', { headers });
if (!res.ok) throw new Error(`GitHub API: HTTP ${res.status}`);
const releases = await res.json();

const parse = (v) => v.split('.').map(Number);
const newer = (a, b) => {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};
// Stable Widevine builds only (no alpha, beta or nightly).
const stable = releases
  .filter((r) => !r.prerelease && !r.draft)
  .map((r) => ({ version: /^v(\d+\.\d+\.\d+)\+wvcus$/.exec(r.tag_name)?.[1], url: r.html_url, date: r.published_at }))
  .filter((r) => r.version);
const sameMajor = stable.filter((r) => parse(r.version)[0] === parse(current)[0] && newer(r.version, current));
const latest = stable.reduce((best, r) => (!best || newer(r.version, best.version) ? r : best), null);

const lines = [`Electron in uso: ${current}`];
if (sameMajor.length) lines.push(`Correzioni nella stessa versione principale: ${sameMajor.map((r) => r.version).join(', ')}`);
if (latest && newer(latest.version, current)) lines.push(`Ultima versione stabile: ${latest.version} (${latest.url})`);
const outdated = latest && newer(latest.version, current);
console.log(lines.join('\n'));
if (!outdated) {
  console.log('Aggiornato.');
  process.exit(0);
}

if (process.argv.includes('--issue')) {
  const title = `Aggiornare Electron a ${latest.version}`;
  const body = [
    ...lines,
    '',
    'Electron porta le correzioni di sicurezza di Chromium: aggiornare presto.',
    '',
    '```',
    `npm i -D "electron@git+https://github.com/castlabs/electron-releases.git#v${latest.version}+wvcus"`,
    'node node_modules/electron/install.js',
    '```',
    '',
    'Poi `npm run typecheck && npm test` e una prova dell’app.',
  ].join('\n');
  const existing = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--search', 'Aggiornare Electron in:title', '--json', 'number,title'], { encoding: 'utf8' }));
  const same = existing.find((i) => i.title === title);
  if (same) console.log(`Issue già aperta: #${same.number}`);
  else execFileSync('gh', ['issue', 'create', '--title', title, '--body', body], { stdio: 'inherit' });
}
// Exit code 2: outdated (the workflow shows it as a warning, not a failure of the code).
process.exit(2);
