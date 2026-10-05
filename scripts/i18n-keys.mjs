// Lists the translation keys used in the sources: tr('…'), plural(n, '…', '…') and the static text of
// the HTML pages (translated at run time by translateDom). Used by the catalog test.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const unescape = (s) => s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, c) => {
  if (c === 'n') return '\n';
  if (c === 't') return '\t';
  if (c[0] === 'u') return String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ''), 16));
  if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
  return c;
});

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Map key -> first file using it. */
export function collectKeys(root = 'src') {
  const keys = new Map();
  const add = (k, file) => {
    const key = k.replace(/\s+/g, ' ').trim() === k ? k : k;
    if (key && !keys.has(key)) keys.set(key, file);
  };
  const STR = String.raw`'((?:[^'\\]|\\.)*)'`;
  for (const file of walk(root)) {
    if (file.includes('/locales/')) continue;
    const src = readFileSync(file, 'utf8');
    if (file.endsWith('.ts')) {
      for (const m of src.matchAll(new RegExp(String.raw`\btr\(\s*` + STR, 'g'))) add(unescape(m[1]), file);
      for (const m of src.matchAll(new RegExp(String.raw`\bplural\([^,]+,\s*` + STR + String.raw`,\s*` + STR, 'g'))) {
        add(unescape(m[1]), file);
        add(unescape(m[2]), file);
      }
    } else if (file.endsWith('.html')) {
      const body = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
      for (const m of body.matchAll(/>([^<>]+)</g)) {
        const text = m[1].replace(/\s+/g, ' ').trim();
        if (/[A-Za-zÀ-ÿ]{2}/.test(text)) add(decode(text), file);
      }
      for (const m of body.matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"]+)"/g)) add(decode(m[1].replace(/\s+/g, ' ').trim()), file);
      const title = /<title>([^<]*)<\/title>/.exec(src);
      if (title && title[1].trim()) add(decode(title[1].trim()), file);
    }
  }
  return keys;
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const [k, f] of collectKeys()) console.log(`${f.replace(/^src\//, '')}\t${JSON.stringify(k)}`);
}
