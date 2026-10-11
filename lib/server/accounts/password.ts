/**
 * Fork-only: password hashing with scrypt from the standard library (see
 * FORK_CHANGES.md). Stored as `scrypt$<N>$<r>$<p>$<salt>$<hash>` (base64url),
 * so the cost can be raised later without invalidating existing hashes.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const COST = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, keyLength, cost, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, COST, KEY_LENGTH);
  return [
    'scrypt',
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const expected = Buffer.from(parts[5], 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await derive(password, salt, { N, r, p }, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A hash nobody's password matches, verified when the username is unknown so
 * a wrong username and a wrong password take the same time.
 */
let decoy: Promise<string> | undefined;
export function decoyPasswordHash(): Promise<string> {
  decoy ??= hashPassword(randomBytes(24).toString('base64url'));
  return decoy;
}
