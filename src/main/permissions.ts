import { type WebContents, desktopCapturer, dialog, type BrowserWindow, type Session } from 'electron';
import { isTrustedSuiteHost } from '../shared/infomaniak-apps';
import { externalAppName, externalScheme, externalVerdict } from '../shared/external-protocols';
import { ASKABLE_PERMISSIONS } from '../shared/settings-schema';
import type { AskablePermission } from '../shared/types';
import type { SettingsStore } from './settings';
import { tr } from '../shared/i18n';

const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const DESCRIPTIONS: Record<string, string> = {
  media: tr('usare fotocamera e microfono'),
  notifications: tr('mostrare notifiche'),
  geolocation: tr('conoscere la tua posizione'),
  'clipboard-read': tr('leggere gli appunti'),
};

/** Where site decisions are remembered: the settings file, or memory only for private windows. */
export interface PermissionMemory {
  get(host: string, permission: string): boolean | undefined;
  set(host: string, permission: string, allowed: boolean): void;
}

export function persistentMemory(settings: SettingsStore): PermissionMemory {
  return {
    get: (host, permission) => settings.get().sitePermissions.find((p) => p.host === host && p.permission === permission)?.allowed,
    set: (host, permission, allowed) => {
      const others = settings.get().sitePermissions.filter((p) => !(p.host === host && p.permission === permission));
      settings.update({ sitePermissions: [...others, { host, permission, allowed }] });
    },
  };
}

export function memoryOnly(): PermissionMemory {
  const map = new Map<string, boolean>();
  return {
    get: (host, permission) => map.get(`${host}|${permission}`),
    set: (host, permission, allowed) => void map.set(`${host}|${permission}`, allowed),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const isAskable = (p: string): p is AskablePermission => (ASKABLE_PERMISSIONS as readonly string[]).includes(p);

/**
 * Infomaniak apps (kMeet, kChat, Mail…) get camera, microphone and notifications directly.
 * Other sites follow the remembered decision, then the default chosen in the settings (ask or block).
 */
/** Never granted in Tor windows: position, notifications (they outlive the page), protected content (Google module), and device or idle state. */
const TOR_DENIED = new Set(['geolocation', 'notifications', 'mediaKeySystem', 'idle-detection', 'hid', 'serial', 'usb', 'bluetooth', 'window-management', 'storage-access', 'top-level-storage-access']);

export function configurePermissions(
  session: Session,
  settings: SettingsStore,
  memory: PermissionMemory,
  getWindow: () => BrowserWindow | null,
  onDrmWanted?: (contents: WebContents) => void,
  /** Tor windows: nothing that reveals where you are or ties you to an account. */
  tor = false,
): void {
  const decide = (host: string, permission: string): boolean | 'ask' => {
    if (ALWAYS_ALLOWED.has(permission)) return true;
    if (tor && TOR_DENIED.has(permission)) return false;
    // Protected content (Widevine): on/off from the privacy settings, no question per site.
    if (permission === 'mediaKeySystem') return settings.get().drmOptIn;
    if (!DESCRIPTIONS[permission]) return false;
    if (!tor && isTrustedSuiteHost(host) && settings.tokenStatus().configured) return true;
    const remembered = memory.get(host, permission);
    if (remembered !== undefined) return remembered;
    if (isAskable(permission) && settings.get().permissionDefaults[permission] === 'block') return false;
    return 'ask';
  };

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const host = hostOf(details.requestingUrl || contents.getURL());
    // A site wants protected content while Widevine is off: offer to turn it on.
    if (permission === 'mediaKeySystem' && !settings.get().drmOptIn && !tor) onDrmWanted?.(contents);
    if (permission === 'openExternal') {
      void confirmExternal(host, 'externalURL' in details ? String(details.externalURL ?? '') : '').then(callback);
      return;
    }
    const decision = decide(host, permission);
    if (decision !== 'ask') return callback(decision);

    const win = getWindow();
    const options = {
      type: 'question' as const,
      buttons: [tr('Consenti'), tr('Blocca')],
      defaultId: 1,
      cancelId: 1,
      message: `${host || tr('Questo sito')} vuole ${DESCRIPTIONS[permission]}.`,
      checkboxLabel: tr('Ricorda la scelta per questo sito'),
      checkboxChecked: true,
    };
    const prompt = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
    void prompt.then(({ response, checkboxChecked }) => {
      const allowed = response === 0;
      if (checkboxChecked && host) memory.set(host, permission, allowed);
      callback(allowed);
    });
  });

  /** Links to other programs: dangerous schemes never open, the others after a question (remembered per site). */
  async function confirmExternal(host: string, url: string): Promise<boolean> {
    const scheme = externalScheme(url);
    if (!scheme || externalVerdict(url) === 'blocked') {
      console.warn('[sicurezza] link a programma esterno bloccato:', url.slice(0, 200));
      return false;
    }
    const key = `external:${scheme}`;
    const remembered = host ? memory.get(host, key) : undefined;
    if (remembered !== undefined) return remembered;
    const win = getWindow();
    const options = {
      type: 'question' as const,
      buttons: [tr('Apri'), tr('Annulla')],
      defaultId: 1,
      cancelId: 1,
      message: tr('{0} vuole aprire {1}.', host || tr('Questa pagina'), externalAppName(scheme)),
      detail: url.length > 300 ? `${url.slice(0, 300)}…` : url,
      checkboxLabel: tr('Ricorda la scelta per questo sito'),
      checkboxChecked: false,
    };
    const { response, checkboxChecked } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    const allowed = response === 0;
    if (checkboxChecked && host) memory.set(host, key, allowed);
    return allowed;
  }

  // Synchronous checks (e.g. Notification.permission): only a remembered or trusted "allow" counts.
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    if (permission === 'mediaKeySystem') return !tor && settings.get().drmOptIn;
    if (tor && TOR_DENIED.has(permission)) return false;
    if (!isAskable(permission)) return true;
    return decide(hostOf(requestingOrigin), permission) === true;
  });

  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const choices = sources.slice(0, 10);
      if (choices.length === 0) return callback({});
      const win = getWindow();
      const options = {
        type: 'question' as const,
        buttons: [...choices.map((s) => s.name), tr('Annulla')],
        cancelId: choices.length,
        message: tr('{0} vuole condividere lo schermo. Cosa vuoi condividere?', hostOf(request.securityOrigin) || tr('La pagina')),
      };
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      const source = choices[response];
      callback(source ? { video: source } : {});
    },
    { useSystemPicker: true },
  );
}
