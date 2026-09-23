import { desktopCapturer, dialog, type BrowserWindow, type Session } from 'electron';
import { isTrustedSuiteHost } from '../shared/ksuite-apps';

const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
const ASKABLE: Record<string, string> = {
  media: 'usare fotocamera e microfono',
  notifications: 'mostrare notifiche',
  geolocation: 'conoscere la tua posizione',
  'clipboard-read': 'leggere gli appunti',
  'display-capture': 'condividere lo schermo',
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * kSuite apps (kMeet, kChat, Mail…) get camera, microphone, notifications and screen sharing directly;
 * any other site has to ask the user first.
 */
export function configurePermissions(session: Session, getWindow: () => BrowserWindow | null): void {
  const decisions = new Map<string, boolean>();

  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (ALWAYS_ALLOWED.has(permission)) return callback(true);
    const description = ASKABLE[permission];
    if (!description) return callback(false);

    const host = hostOf(details.requestingUrl || contents.getURL());
    if (isTrustedSuiteHost(host)) return callback(true);

    const key = `${host}|${permission}`;
    const remembered = decisions.get(key);
    if (remembered !== undefined) return callback(remembered);

    const win = getWindow();
    const options = {
      type: 'question' as const,
      buttons: ['Consenti', 'Blocca'],
      defaultId: 1,
      cancelId: 1,
      message: `${host || 'Questo sito'} vuole ${description}.`,
    };
    const prompt = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
    void prompt.then(({ response }) => {
      const allowed = response === 0;
      decisions.set(key, allowed);
      callback(allowed);
    });
  });

  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const choices = sources.slice(0, 10);
      if (choices.length === 0) return callback({});
      const win = getWindow();
      const options = {
        type: 'question' as const,
        buttons: [...choices.map((s) => s.name), 'Annulla'],
        cancelId: choices.length,
        message: `${hostOf(request.securityOrigin) || 'La pagina'} vuole condividere lo schermo. Cosa vuoi condividere?`,
      };
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
      const source = choices[response];
      callback(source ? { video: source } : {});
    },
    { useSystemPicker: true },
  );
}
