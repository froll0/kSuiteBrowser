/**
 * Two-factor codes (TOTP, RFC 6238) for the password manager. A secret is stored as given: a base32
 * key ("JBSW Y3DP…") or the otpauth:// address of the QR code shown by the site.
 */
export interface TotpParams {
  secret: Uint8Array;
  digits: number;
  period: number;
  algorithm: 'sha1' | 'sha256' | 'sha512';
}

export function base32Decode(input: string): Uint8Array | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length >= 10 ? new Uint8Array(out) : null;
}

/** Reads a stored secret; null when it isn't a valid key. */
export function parseTotp(input: string): TotpParams | null {
  const text = String(input ?? '').trim();
  if (/^otpauth:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname.toLowerCase() !== 'totp') return null;
    const secret = base32Decode(url.searchParams.get('secret') ?? '');
    const digits = Number(url.searchParams.get('digits') ?? 6);
    const period = Number(url.searchParams.get('period') ?? 30);
    const algorithm = (url.searchParams.get('algorithm') ?? 'SHA1').toLowerCase();
    if (!secret || ![6, 7, 8].includes(digits) || !(period >= 10 && period <= 300) || !['sha1', 'sha256', 'sha512'].includes(algorithm)) return null;
    return { secret, digits, period, algorithm: algorithm as TotpParams['algorithm'] };
  }
  const secret = base32Decode(text);
  return secret ? { secret, digits: 6, period: 30, algorithm: 'sha1' } : null;
}

/** Normal form to store: the otpauth address as given, or the key in upper case without spaces. */
export function normalizeTotp(input: string): string | null {
  const text = String(input ?? '').trim();
  if (!parseTotp(text)) return null;
  return /^otpauth:/i.test(text) ? text : text.toUpperCase().replace(/[\s-]/g, '');
}

export type Hmac = (algorithm: TotpParams['algorithm'], key: Uint8Array, data: Uint8Array) => Uint8Array;

/** The code for a moment, and the seconds it stays valid. */
export function totpCode(params: TotpParams, nowMs: number, hmac: Hmac): { code: string; remaining: number } {
  const counter = Math.floor(nowMs / 1000 / params.period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = hmac(params.algorithm, params.secret, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  const code = String(bin % 10 ** params.digits).padStart(params.digits, '0');
  return { code, remaining: params.period - (Math.floor(nowMs / 1000) % params.period) };
}
