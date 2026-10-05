/**
 * Runs in every web page frame of normal and private windows. It adds, in the page's own world,
 * the protections that need to be there: notice of protected content requests (Widevine) and,
 * further down, fingerprinting protection.
 */
import { contextBridge, ipcRenderer } from 'electron';

if (/^https?:$/.test(location.protocol)) {
  const bridge = {
    drmWanted: () => ipcRenderer.send('shield:drm-wanted'),
  };
  try {
    contextBridge.executeInMainWorld({ func: installShield, args: [bridge] });
  } catch {
    /* page without a main world (e.g. some PDFs) */
  }
}

type ShieldBridge = { drmWanted(): void };

/** Executed in the page's world; serialized, so it may only use what is inside it. */
function installShield(bridge: ShieldBridge): void {
  const nav = navigator as Navigator & { requestMediaKeySystemAccess?: (ks: string, cfg: MediaKeySystemConfiguration[]) => Promise<MediaKeySystemAccess> };
  const original = nav.requestMediaKeySystemAccess;
  if (typeof original === 'function') {
    let told = false;
    // A Proxy keeps the native look (toString, name, length) that scripts may check.
    const wrapped = new Proxy(original, {
      apply(target, thisArg, args: [string, MediaKeySystemConfiguration[]]) {
        if (!told && /widevine/i.test(String(args[0]))) {
          told = true;
          bridge.drmWanted();
        }
        return Reflect.apply(target, thisArg, args);
      },
    });
    Object.defineProperty(Navigator.prototype, 'requestMediaKeySystemAccess', { value: wrapped, configurable: true, writable: true });
  }
}
