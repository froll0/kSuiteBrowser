import type { VeloBridge } from '../preload/preload';

declare global {
  interface Window {
    velo: VeloBridge;
  }
}

export const ks = window.velo;
