// CI guard: the pushed tag (vX.Y.Z) must match package.json, otherwise the updater would compare wrong versions.
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2] ?? '';
if (tag !== `v${version}`) {
  console.error(`Il tag "${tag}" non corrisponde alla versione di package.json (v${version}). Usa: npm version <patch|minor|major> && git push --follow-tags`);
  process.exit(1);
}
console.log(`Release v${version}`);
