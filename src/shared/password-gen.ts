// Letters and digits that can't be confused with each other (no l/1/I, O/0).
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '-_.!?@#$%+=';

function randomIndex(max: number): number {
  // Rejection sampling: no modulo bias.
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  do globalThis.crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return buf[0] % max;
}

/** Random password with lower and upper case letters, digits and symbols (at least one of each). */
export function generatePassword(length = 20): string {
  const sets = [LOWER, UPPER, DIGITS, SYMBOLS];
  const all = sets.join('');
  const chars = sets.map((set) => set[randomIndex(set.length)]);
  while (chars.length < length) chars.push(all[randomIndex(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Rough strength check used to flag weak saved passwords. */
export function isWeakPassword(password: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((re) => re.test(password)).length;
  if (password.length < 8) return true;
  if (password.length < 12 && classes < 3) return true;
  return /^(.)\1+$/.test(password) || /^(password|qwerty|123456|abc123|letmein|admin)/i.test(password);
}
