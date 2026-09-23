import { safeStorage } from 'electron';

/**
 * True when the OS keychain really protects data. On Linux without a secret service Electron falls back
 * to "basic_text", a hard-coded key identical on every machine: that counts as no keychain.
 */
export function keychainAvailable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux') {
    try {
      return safeStorage.getSelectedStorageBackend() !== 'basic_text' && safeStorage.getSelectedStorageBackend() !== 'unknown';
    } catch {
      return false;
    }
  }
  return true;
}
