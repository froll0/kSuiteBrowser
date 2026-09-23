// Bundles main process, preloads, browser UI and internal pages with esbuild, then copies static assets.
import { build, context } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');

const common = { bundle: true, sourcemap: true, logLevel: 'info' };
const node = { ...common, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'] };
const web = { ...common, platform: 'browser', format: 'iife', target: 'chrome130' };

const targets = [
  { ...node, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' },
  { ...node, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js' },
  { ...node, entryPoints: ['src/preload/page.ts'], outfile: 'dist/preload/page.js' },
  { ...web, entryPoints: ['src/renderer/app.ts'], outfile: 'dist/renderer/app.js' },
  { ...web, entryPoints: ['src/pages/settings/settings.ts'], outfile: 'dist/pages/settings/settings.js' },
  { ...web, entryPoints: ['src/pages/https-only/https-only.ts'], outfile: 'dist/pages/https-only/https-only.js' },
];

function copyStatic() {
  for (const dir of ['dist/renderer', 'dist/preload', 'dist/pages/settings', 'dist/pages/https-only']) mkdirSync(dir, { recursive: true });
  cpSync('src/renderer/index.html', 'dist/renderer/index.html');
  cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');
  for (const page of ['settings', 'https-only']) {
    cpSync(`src/pages/${page}/index.html`, `dist/pages/${page}/index.html`);
    cpSync(`src/pages/${page}/${page}.css`, `dist/pages/${page}/${page}.css`);
    cpSync('src/pages/shared/page.css', `dist/pages/${page}/page.css`);
  }
  // Cosmetic filtering script of the tracker blocker (runs in every page frame).
  cpSync(require.resolve('@ghostery/adblocker-electron-preload'), 'dist/preload/adblock.js');
}

copyStatic();
if (watch) {
  for (const t of targets) (await context(t)).watch();
} else {
  await Promise.all(targets.map((t) => build(t)));
}
