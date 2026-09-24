/**
 * Have I Been Pwned "Pwned Passwords", k-anonymity model: only the first 5 characters of the password's
 * SHA-1 leave the computer; the service answers with every known suffix for that prefix (padded with
 * fake entries so the answer size says nothing) and the match is made here.
 */

/** How many times a hash suffix appears in a range answer ("SUFFIX:COUNT" per line); 0 when absent. */
export function pwnedCount(rangeBody: string, suffix: string): number {
  const wanted = suffix.toUpperCase();
  for (const line of rangeBody.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon !== 35 || line.slice(0, 35).toUpperCase() !== wanted) continue;
    // Padding entries have a count of 0.
    return Number.parseInt(line.slice(36), 10) || 0;
  }
  return 0;
}

export function splitHash(sha1Hex: string): { prefix: string; suffix: string } {
  const hex = sha1Hex.toUpperCase();
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}
