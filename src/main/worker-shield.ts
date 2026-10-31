import type { WebContents } from 'electron';
import type { ShieldConfig } from '../shared/fingerprint';
import { installWorkerShield } from '../shared/worker-shield';

type AttachedParams = { sessionId?: string; targetInfo?: { type?: string } };

/**
 * Fingerprinting protection in a tab's Web Workers: through the DevTools protocol each new worker (also
 * those of the page's frames) is paused, gets the protection with the page's key, then starts.
 */
export function protectWorkers(contents: WebContents, configFor: (pageUrl: string) => ShieldConfig | null): void {
  const dbg = contents.debugger;
  if (dbg.isAttached()) return;
  try {
    dbg.attach('1.3');
  } catch {
    return; // DevTools protocol busy: the page itself stays protected
  }
  const source = (config: ShieldConfig) => `(${installWorkerShield.toString()})(${JSON.stringify(config)});`;
  const autoAttach = (sessionId?: string) =>
    dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => undefined);
  dbg.on('message', (_e, method, params: AttachedParams) => {
    if (method !== 'Target.attachedToTarget' || !params.sessionId) return;
    const sessionId = params.sessionId;
    const resume = () => dbg.sendCommand('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => undefined);
    const type = params.targetInfo?.type;
    if (type === 'worker' || type === 'shared_worker') {
      const config = contents.isDestroyed() ? null : configFor(contents.getURL());
      if (!config || config.mode === 'off') return void resume();
      void dbg
        .sendCommand('Runtime.evaluate', { expression: source(config), silent: true }, sessionId)
        .catch(() => undefined)
        .finally(resume);
    } else if (type === 'iframe') {
      // Frames of other sites run in their own process: their workers are caught there.
      void autoAttach(sessionId).finally(resume);
    } else {
      void resume();
    }
  });
  void autoAttach();
}
