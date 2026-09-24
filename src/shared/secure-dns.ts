/** DNS over HTTPS: which provider answers "where is example.com?", encrypted instead of in clear text. */

export type SecureDnsChoice = 'off' | 'automatic' | 'quad9' | 'mullvad' | 'cloudflare' | 'custom';

export const SECURE_DNS_PROVIDERS: Record<'quad9' | 'mullvad' | 'cloudflare', { name: string; template: string; note: string }> = {
  quad9: { name: 'Quad9 (Svizzera)', template: 'https://dns.quad9.net/dns-query', note: 'Fondazione svizzera senza scopo di lucro, blocca anche domini malevoli.' },
  mullvad: { name: 'Mullvad (Svezia)', template: 'https://dns.mullvad.net/dns-query', note: 'Nessun registro delle richieste.' },
  cloudflare: { name: 'Cloudflare', template: 'https://cloudflare-dns.com/dns-query', note: 'Molto veloce; registri cancellati entro 24 ore.' },
};

/** A custom provider must be an https:// DoH endpoint (the {?dns} template form is accepted too). */
export function validDohTemplate(value: string): boolean {
  try {
    const u = new URL(value.replace('{?dns}', ''));
    return u.protocol === 'https:' && Boolean(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** What to pass to Electron's host resolver for a choice. */
export function secureDnsConfig(choice: SecureDnsChoice, custom: string): { secureDnsMode: 'off' | 'automatic' | 'secure'; secureDnsServers: string[] } {
  if (choice === 'off') return { secureDnsMode: 'off', secureDnsServers: [] };
  if (choice === 'automatic') return { secureDnsMode: 'automatic', secureDnsServers: [] };
  const template = choice === 'custom' ? (validDohTemplate(custom) ? custom : null) : SECURE_DNS_PROVIDERS[choice].template;
  // An invalid custom address falls back to automatic rather than breaking every connection.
  return template ? { secureDnsMode: 'secure', secureDnsServers: [template] } : { secureDnsMode: 'automatic', secureDnsServers: [] };
}
