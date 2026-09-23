import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

/** Removes characters that are invalid in file names on Windows, macOS or Linux. */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 180);
  return cleaned || fallback;
}

/** Returns a path in `dir` that does not exist yet: "name.ext", "name (1).ext", ... */
export function uniquePath(dir: string, name: string): string {
  const ext = extname(name);
  const stem = basename(name, ext);
  let candidate = join(dir, name);
  for (let i = 1; existsSync(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`);
  return candidate;
}

/** Best-effort file name for a URL, used when saving links and images to kDrive. */
export function fileNameFromUrl(url: string, fallback = 'download'): string {
  try {
    const u = new URL(url);
    const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? '');
    return safeFileName(last || u.hostname || fallback, fallback);
  } catch {
    return fallback;
  }
}

export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return safeFileName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')));
    } catch {
      /* ignore malformed encoding */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? safeFileName(plain[1].trim()) : null;
}
