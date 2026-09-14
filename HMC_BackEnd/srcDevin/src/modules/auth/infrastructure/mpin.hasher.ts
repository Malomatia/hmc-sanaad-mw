import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Salts + hashes an MPIN for storage using Node's built-in scrypt (no external
 * dependency). Storage format: `scrypt$<saltHex>$<hashHex>`.
 * Used by the (pending) MPIN store adapter; unit-testable in isolation.
 */
export class MpinHasher {
  private static readonly KEYLEN = 64;
  private static readonly SALT_BYTES = 16;

  static hash(mpin: string): string {
    const salt = randomBytes(MpinHasher.SALT_BYTES);
    const derived = scryptSync(mpin, salt, MpinHasher.KEYLEN);
    return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
  }

  static verify(mpin: string, stored: string): boolean {
    const parts = stored.split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const derived = scryptSync(mpin, salt, expected.length);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  }
}
