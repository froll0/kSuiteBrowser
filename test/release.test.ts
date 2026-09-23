import { describe, expect, it } from 'vitest';
import { releaseUrl, updateMode } from '../src/shared/release';

describe('update mode', () => {
  it('is disabled when running from sources', () => {
    expect(updateMode({ packaged: false, platform: 'win32', appImage: false })).toBe('disabled');
  });
  it('installs automatically on Windows and AppImage', () => {
    expect(updateMode({ packaged: true, platform: 'win32', appImage: false })).toBe('auto');
    expect(updateMode({ packaged: true, platform: 'linux', appImage: true })).toBe('auto');
  });
  it('only notifies on unsigned macOS builds and .deb installs', () => {
    expect(updateMode({ packaged: true, platform: 'darwin', appImage: false })).toBe('notify');
    expect(updateMode({ packaged: true, platform: 'linux', appImage: false })).toBe('notify');
  });
  it('links to the release of a version', () => {
    expect(releaseUrl('1.2.3')).toBe('https://github.com/froll0/kSuiteBrowser/releases/tag/v1.2.3');
    expect(releaseUrl('v1.2.3')).toBe('https://github.com/froll0/kSuiteBrowser/releases/tag/v1.2.3');
  });
});
