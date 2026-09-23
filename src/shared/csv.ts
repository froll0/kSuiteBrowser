/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function toCsv(rows: string[][]): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Reads password exports of Chrome, Edge, Firefox, Safari, Bitwarden and 1Password (CSV with a header row).
 * Returns the rows it could understand.
 */
export function parsePasswordCsv(text: string): Array<{ url: string; username: string; password: string }> {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (...candidates: string[]) => names.findIndex((n) => candidates.includes(n));
  const url = col('url', 'login_uri', 'website', 'origin', 'hostname');
  const user = col('username', 'login_username', 'login', 'user', 'email');
  const pass = col('password', 'login_password');
  if (url < 0 || pass < 0) return [];
  return rows
    .map((r) => ({ url: (r[url] ?? '').trim(), username: user >= 0 ? (r[user] ?? '') : '', password: r[pass] ?? '' }))
    .filter((r) => r.url && r.password);
}
