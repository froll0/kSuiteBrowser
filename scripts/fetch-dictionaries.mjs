// Downloads the Hunspell dictionaries that Chromium would otherwise fetch from Google at run time
// (Linux only), so they ship inside the Velo package. Run by the CI before packaging for Linux.
import { mkdirSync, writeFileSync } from 'node:fs';

// Names and versions expected by this Chromium (see spellcheck_common.cc).
const DICTIONARIES = ['it-IT-3-0', 'en-US-10-1'];
mkdirSync('build/dictionaries', { recursive: true });
for (const name of DICTIONARIES) {
  const url = `https://redirector.gvt1.com/edgedl/chrome/dict/${name.toLowerCase()}.bdic`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.toString('latin1', 0, 4) !== 'BDic' || data.length < 50_000) throw new Error(`${url}: non è un dizionario .bdic`);
  writeFileSync(`build/dictionaries/${name}.bdic`, data);
  console.log(`build/dictionaries/${name}.bdic (${data.length} byte)`);
}
