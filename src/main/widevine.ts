import { components } from 'electron';

/**
 * Widevine, Google's DRM used by Netflix, Spotify, Disney+, Prime Video… It comes with the
 * castlabs build of Electron: Chromium's component updater downloads the module from Google
 * on first start and keeps it up to date.
 */

export interface WidevineStatus {
  /** This build of Electron can use Widevine. */
  supported: boolean;
  /** Installed and ready. */
  ready: boolean;
  version: string | null;
  status: string;
}

const api = components as Electron.Components | undefined;

/** Waits for the module (at most `timeoutMs`, so a first start offline isn't blocked). */
export async function widevineReady(timeoutMs: number): Promise<void> {
  if (!api) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      api.whenReady(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch (err) {
    console.warn('[widevine] installazione non riuscita:', err instanceof Error ? err.message : err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function widevineStatus(): WidevineStatus {
  if (!api) return { supported: false, ready: false, version: null, status: 'unsupported' };
  const entry = Object.values(api.status()).find((c) => /widevine/i.test(c.title ?? ''));
  if (!entry) return { supported: true, ready: false, version: null, status: 'missing' };
  return { supported: true, ready: entry.status === 'up-to-date' || entry.status === 'updated', version: entry.version, status: entry.status };
}
