// Prints the CHANGELOG.md section of a version (`node scripts/release-notes.mjs 0.7.0`), used as the text
// of the GitHub release. Exits with 1 when the version has no section.
import { readFileSync } from 'node:fs';

const version = (process.argv[2] ?? '').replace(/^v/, '');
const text = readFileSync('CHANGELOG.md', 'utf8');
const lines = text.split(/\r?\n/);
const start = lines.findIndex((l) => l.trim() === `## ${version}`);
if (!version || start === -1) {
  console.error(`Nessuna sezione "## ${version}" in CHANGELOG.md`);
  process.exit(1);
}
const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
console.log(lines.slice(start + 1, end === -1 ? undefined : end).join('\n').trim());
