import { createHash } from 'node:crypto';
import { net } from 'electron';
import { pwnedCount, splitHash } from '../../shared/pwned';

/** Tests can point to a local copy of the API: KSUITE_PWNED_API=http://127.0.0.1:… */
const API = process.env.KSUITE_PWNED_API ?? 'https://api.pwnedpasswords.com';

export function sha1(password: string): string {
  return createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
}

/** Checks passwords against the known data breaches (Have I Been Pwned), sending only hash prefixes. */
export class BreachChecker {
  /** Answers per prefix for this run of the browser. */
  private readonly ranges = new Map<string, Promise<string>>();

  private range(prefix: string): Promise<string> {
    let pending = this.ranges.get(prefix);
    if (!pending) {
      pending = net
        .fetch(`${API}/range/${prefix}`, { headers: { 'Add-Padding': 'true', 'User-Agent': 'kSuite-Browser-password-check' }, cache: 'no-store' })
        .then((res) => {
          if (!res.ok) throw new Error(`Servizio non disponibile (${res.status})`);
          return res.text();
        });
      pending.catch(() => this.ranges.delete(prefix));
      this.ranges.set(prefix, pending);
    }
    return pending;
  }

  /** Times the password appears in known breaches (0 = never seen). */
  async count(password: string): Promise<number> {
    const { prefix, suffix } = splitHash(sha1(password));
    return pwnedCount(await this.range(prefix), suffix);
  }

  /** Counts for many passwords, a few requests at a time; keyed by SHA-1 so no plain password is kept. */
  async countMany(passwords: string[]): Promise<Map<string, number>> {
    const hashes = [...new Set(passwords.map(sha1))];
    const result = new Map<string, number>();
    let next = 0;
    const worker = async () => {
      while (next < hashes.length) {
        const hash = hashes[next++];
        const { prefix, suffix } = splitHash(hash);
        result.set(hash, pwnedCount(await this.range(prefix), suffix));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, hashes.length) }, worker));
    return result;
  }
}
