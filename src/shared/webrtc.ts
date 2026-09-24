import { isTrustedSuiteHost } from './ksuite-apps';

/**
 * How much WebRTC (video calls, peer-to-peer) may reveal about the network:
 * - standard: Chromium's default (local addresses hidden behind random .local names, public IP visible)
 * - public: only the interface of the default route, so with a VPN the real connection stays hidden
 * - proxy: no direct UDP at all, only through a proxy or relay (calls may not work)
 */
export type WebRtcProtection = 'standard' | 'public' | 'proxy';

export type WebRtcPolicy = 'default' | 'default_public_interface_only' | 'disable_non_proxied_udp';

export function webRtcPolicy(level: WebRtcProtection, pageUrl: string): WebRtcPolicy {
  if (level === 'standard') return 'default';
  // kSuite's own calls (kMeet) keep working at every level: at most the VPN-safe mode.
  let host = '';
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    /* not a URL yet */
  }
  if (level === 'proxy' && !isTrustedSuiteHost(host)) return 'disable_non_proxied_udp';
  return 'default_public_interface_only';
}
