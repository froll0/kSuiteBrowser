import { protocol, type Session } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export const INTERNAL_SCHEME = 'ksuite';

/** Internal pages: ksuite://settings, ksuite://history, … Each host maps to a folder in dist/pages. */
export const INTERNAL_PAGES = ['settings', 'history', 'bookmarks', 'https-only'] as const;
const PAGES = new Set<string>(INTERNAL_PAGES);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

/** Must run before the app is ready. */
export function registerInternalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: INTERNAL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

export function serveInternalPages(session: Session, pagesDir: string): void {
  if (session.protocol.isProtocolHandled(INTERNAL_SCHEME)) return;
  session.protocol.handle(INTERNAL_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (!PAGES.has(url.hostname)) return new Response('Pagina non trovata', { status: 404 });

    const root = join(pagesDir, url.hostname);
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = normalize(join(root, relative));
    if (!file.startsWith(root + sep)) return new Response('Accesso negato', { status: 403 });

    try {
      const body = await readFile(file);
      return new Response(body, {
        headers: {
          'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
          'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; frame-ancestors 'none'",
          'X-Frame-Options': 'DENY',
          'Cache-Control': 'no-store',
        },
      });
    } catch {
      return new Response('Pagina non trovata', { status: 404 });
    }
  });
}

export function isInternalUrl(url: string): boolean {
  return url.toLowerCase().startsWith(`${INTERNAL_SCHEME}:`);
}
