import { randomInt } from 'node:crypto';

// 6-digit numeric link code. Crypto-rand keeps it from being predictable, but six
// digits is only 1M values, so we also enforce a 5-min TTL + single-use in the DB.
export function generateLinkCode() {
  const n = randomInt(0, 1_000_000);
  return n.toString().padStart(6, '0');
}
