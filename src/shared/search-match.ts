/** True when every word of the query appears in one of the fields (case and accent insensitive). */
export function matchesAll(query: string, ...fields: Array<string | null | undefined>): boolean {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const haystack = norm(fields.filter(Boolean).join(' '));
  const words = norm(query).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => haystack.includes(w));
}
