export const REPOSITORY = { owner: 'froll0', repo: 'kSuiteBrowser' } as const;

export const RELEASES_URL = `https://github.com/${REPOSITORY.owner}/${REPOSITORY.repo}/releases`;

export function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version.replace(/^v/, '')}`;
}

/** Which kind of update a build supports. */
export function updateMode(opts: { packaged: boolean; platform: string; appImage: boolean }): 'auto' | 'notify' | 'disabled' {
  if (!opts.packaged) return 'disabled';
  // macOS installs updates only for apps signed with an Apple Developer ID; Linux only for AppImage.
  if (opts.platform === 'darwin') return 'notify';
  if (opts.platform === 'linux' && !opts.appImage) return 'notify';
  return 'auto';
}
