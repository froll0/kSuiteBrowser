import type { KSuiteBridge } from '../preload/preload';

declare global {
  interface Window {
    ksuite: KSuiteBridge;
  }
}

export const ks = window.ksuite;
