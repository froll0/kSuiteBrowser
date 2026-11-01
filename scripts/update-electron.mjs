// Moves Velo to another castlabs Electron build: `node scripts/update-electron.mjs 44.2.0`
// (without a version: the latest stable one). Updates package.json and the lock file, then installs it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

let version = process.argv[2];
if (!version) {
  const out = execFileSync(process.execPath, ['scripts/check-electron.mjs', '--json'], { encoding: 'utf8' });
  version = JSON.parse(out).latest;
}
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error(`Versione non valida: ${version}`);

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const spec = `git+https://github.com/castlabs/electron-releases.git#v${version}+wvcus`;
if (pkg.devDependencies.electron === spec) {
  console.log(`Electron è già alla ${version}.`);
  process.exit(0);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--save-dev', `electron@${spec}`], { stdio: 'inherit', shell: process.platform === 'win32' });
execFileSync(process.execPath, ['node_modules/electron/install.js'], { stdio: 'inherit' });
console.log(`Electron aggiornato alla ${version}. Ora: npm run typecheck && npm test && npm run build && npm run e2e`);
