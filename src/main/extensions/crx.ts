import { createHash, sign, verify, type KeyLike } from 'node:crypto';

/**
 * Chrome extension packages (CRX3): "Cr24", version 3, a protobuf header with the signatures,
 * then the ZIP archive. The extension ID is derived from the developer's public key, and the
 * archive must be signed with that key: a package altered on the way doesn't install.
 * https://source.chromium.org/chromium/chromium/src/+/main:components/crx_file/crx3.proto
 */

export interface CrxPackage {
  id: string;
  /** DER (SubjectPublicKeyInfo) of the developer key; goes into the manifest as "key" to keep the ID. */
  publicKey: Buffer;
  zip: Buffer;
}

export class CrxError extends Error {}

/** Extension ID from a public key: first 128 bits of its SHA-256, as letters a–p. */
export function extensionId(publicKey: Buffer): string {
  return idFromBytes(createHash('sha256').update(publicKey).digest().subarray(0, 16));
}

function idFromBytes(bytes: Buffer): string {
  return [...bytes.toString('hex')].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// ---------- Minimal protobuf reader (only length-delimited fields are used) ----------

function readVarint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new CrxError('Intestazione del pacchetto troncata');
    const byte = buf[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, pos];
    shift += 7;
    if (shift > 49) throw new CrxError('Intestazione del pacchetto non valida');
  }
}

/** Fields of a message: field number → list of byte values (only wire type 2 is kept). */
function fields(buf: Buffer): Map<number, Buffer[]> {
  const out = new Map<number, Buffer[]>();
  let pos = 0;
  while (pos < buf.length) {
    const [tag, next] = readVarint(buf, pos);
    pos = next;
    const field = Math.floor(tag / 8);
    const wire = tag & 7;
    if (wire === 0) {
      pos = readVarint(buf, pos)[1];
    } else if (wire === 2) {
      const [len, start] = readVarint(buf, pos);
      if (start + len > buf.length) throw new CrxError('Intestazione del pacchetto troncata');
      const list = out.get(field) ?? [];
      list.push(buf.subarray(start, start + len));
      out.set(field, list);
      pos = start + len;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      throw new CrxError('Intestazione del pacchetto non valida');
    }
  }
  return out;
}

export function parseCrx(data: Buffer): CrxPackage {
  if (data.length < 12 || data.toString('latin1', 0, 4) !== 'Cr24') throw new CrxError('Non è un pacchetto di estensione (.crx)');
  const version = data.readUInt32LE(4);
  if (version !== 3) throw new CrxError(`Formato del pacchetto non supportato (CRX${version})`);
  const headerSize = data.readUInt32LE(8);
  if (12 + headerSize > data.length) throw new CrxError('Pacchetto troncato');
  const header = fields(data.subarray(12, 12 + headerSize));
  const zip = data.subarray(12 + headerSize);

  const signedData = header.get(10000)?.[0];
  const crxId = signedData ? fields(signedData).get(1)?.[0] : undefined;
  if (!signedData || !crxId || crxId.length !== 16) throw new CrxError('Il pacchetto non indica la propria identità');
  const id = idFromBytes(crxId);

  // What every signature covers.
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedData.length);
  const signed = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), length, signedData, zip]);

  const proofs: Array<{ key: Buffer; signature: Buffer; ecdsa: boolean }> = [];
  for (const [field, ecdsa] of [[2, false], [3, true]] as const) {
    for (const proof of header.get(field) ?? []) {
      const p = fields(proof);
      const key = p.get(1)?.[0];
      const signature = p.get(2)?.[0];
      if (key && signature) proofs.push({ key, signature, ecdsa });
    }
  }
  // The developer's key is the one the ID comes from; its signature is required.
  const own = proofs.find((p) => extensionId(p.key) === id);
  if (!own) throw new CrxError('Il pacchetto non è firmato dal suo sviluppatore');
  const ok = verify('sha256', signed, { key: own.key, format: 'der', type: 'spki', ...(own.ecdsa ? { dsaEncoding: 'der' as const } : {}) }, own.signature);
  if (!ok) throw new CrxError('La firma del pacchetto non è valida: il file è stato modificato');
  return { id, publicKey: own.key, zip };
}

// ---------- Writing (tests and development tools) ----------

function varint(n: number): Buffer {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

function field(num: number, value: Buffer): Buffer {
  return Buffer.concat([varint(num * 8 + 2), varint(value.length), value]);
}

/** Builds a signed CRX3 from a ZIP and an RSA key (PEM or KeyObject). */
export function buildCrx(zip: Buffer, privateKey: KeyLike, publicKeyDer: Buffer): Buffer {
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedData = field(1, crxId);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedData.length);
  const signature = sign('sha256', Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), length, signedData, zip]), privateKey);
  const header = Buffer.concat([field(2, Buffer.concat([field(1, publicKeyDer), field(2, signature)])), field(10000, signedData)]);
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'latin1');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return Buffer.concat([prefix, header, zip]);
}
