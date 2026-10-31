import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { base32Decode, normalizeTotp, parseTotp, totpCode, type Hmac } from '../src/shared/totp';

const hmac: Hmac = (alg, key, data) => new Uint8Array(createHmac(alg, key).update(data).digest());
// RFC 6238 test secrets (ASCII "12345678901234567890" and longer variants).
const ascii = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g)!.map((g) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[parseInt(g.padEnd(5, '0'), 2)]).join('');
};

describe('two-factor codes', () => {
  it('matches the RFC 6238 test vectors', () => {
    const sha1 = parseTotp(`otpauth://totp/x?secret=${ascii('12345678901234567890')}&digits=8`)!;
    expect(totpCode(sha1, 59_000, hmac).code).toBe('94287082');
    expect(totpCode(sha1, 1_111_111_109_000, hmac).code).toBe('07081804');
    const sha256 = parseTotp(`otpauth://totp/x?secret=${ascii('12345678901234567890123456789012')}&digits=8&algorithm=SHA256`)!;
    expect(totpCode(sha256, 59_000, hmac).code).toBe('46119246');
    const sha512 = parseTotp(`otpauth://totp/x?secret=${ascii('1234567890123456789012345678901234567890123456789012345678901234')}&digits=8&algorithm=SHA512`)!;
    expect(totpCode(sha512, 20_000_000_000_000, hmac).code).toBe('47863826');
  });

  it('reads keys typed with spaces and tells how long a code lasts', () => {
    const p = parseTotp('jbsw y3dp ehpk 3pxp')!;
    expect(p.digits).toBe(6);
    expect(totpCode(p, 10_000, hmac).remaining).toBe(20);
    expect(normalizeTotp('jbsw y3dp ehpk 3pxp')).toBe('JBSWY3DPEHPK3PXP');
    expect(parseTotp('not a key!')).toBeNull();
    expect(parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP')).toBeNull();
    expect(base32Decode('AB')).toBeNull();
  });
});
