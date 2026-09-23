import { createCipheriv, createDecipheriv, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

export interface KdfParams {
  salt: string;
  n: number;
  r: number;
  p: number;
}

export const DEFAULT_KDF = { n: 1 << 16, r: 8, p: 1 };

export function newKey(): Buffer {
  return randomBytes(32);
}

/** AES-256-GCM: confidentiality and integrity (a modified file fails to decrypt). */
export function seal(key: Buffer, plaintext: Buffer, aad = 'ksuite-vault-v1'): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

export function open(key: Buffer, sealed: Sealed, aad = 'ksuite-vault-v1'): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
}

/** Key derived from the primary password with scrypt (memory-hard, slow on purpose). */
export function deriveKey(password: string, params: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), Buffer.from(params.salt, 'base64'), 32, { N: params.n, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

export function newKdfParams(): KdfParams {
  return { salt: randomBytes(16).toString('base64'), ...DEFAULT_KDF };
}

export function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
