/**
 * Who may call the internal pages' privileged channels: only the top frame of a velo:// page, and only
 * the pages listed for each channel. Kept apart from Electron so it can be tested.
 */
export function isAllowedInternalSender(frameUrl: string | null | undefined, hosts: readonly string[], isMainFrame: boolean): boolean {
  if (!isMainFrame || !frameUrl) return false;
  try {
    const url = new URL(frameUrl);
    return url.protocol === 'velo:' && hosts.includes(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Content Security Policy of every internal page: own scripts and styles only, never framed. */
export const INTERNAL_PAGE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https: velo:; font-src 'self' velo:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

/**
 * File of an internal page for a request path, or null when the path would leave the page's folder
 * (path traversal). Paths use "/" whatever the system; the caller joins them to the folder.
 */
export function internalPagePath(pathname: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname === '/' || pathname === '' ? '/index.html' : pathname);
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const part of relative.split(/[\\/]+/)) {
    if (!part || part === '.') continue;
    if (part === '..' || part.includes('\0') || /^[a-zA-Z]:$/.test(part)) return null;
    parts.push(part);
  }
  return parts.length ? parts.join('/') : null;
}
