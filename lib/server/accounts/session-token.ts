/**
 * Fork-only: the signed session cookie value (see FORK_CHANGES.md).
 *
 * `<sessionId>.<expiresAtSeconds>.<role>.<hmac>`, signed with
 * `OPENMAIC_SESSION_SECRET`. The signature lets the middleware read the role
 * without a database call; route handlers still look the session up, so a
 * deleted session or a disabled user stops working at once.
 *
 * Web Crypto only (no `node:crypto`), so the Edge middleware can import it.
 */
import { isAccountRole, type AccountRole } from '@/lib/accounts/policy';

export const SESSION_COOKIE = 'openmaic_session';
export const SESSION_SECRET_ENV = 'OPENMAIC_SESSION_SECRET';
export const SESSION_SECRET_MIN_LENGTH = 32;
/** Seven days, like the access-code cookie. */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;

export interface SessionTokenClaims {
  readonly sessionId: string;
  readonly expiresAtSeconds: number;
  readonly role: AccountRole;
}

export function sessionSecret(env: Record<string, string | undefined> = process.env): string {
  return env[SESSION_SECRET_ENV]?.trim() ?? '';
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret).buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message).buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function signSessionToken(
  claims: SessionTokenClaims,
  secret: string,
): Promise<string> {
  const payload = `${claims.sessionId}.${claims.expiresAtSeconds}.${claims.role}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

/** The claims of a well-formed, correctly signed, unexpired token; else `null`. */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<SessionTokenClaims | null> {
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [sessionId, expires, role, signature] = parts;
  if (!SESSION_ID_PATTERN.test(sessionId) || !/^\d{1,12}$/.test(expires)) return null;
  if (!isAccountRole(role) || !SIGNATURE_PATTERN.test(signature)) return null;
  const expiresAtSeconds = Number(expires);
  if (expiresAtSeconds * 1000 <= nowMs) return null;

  const expected = await hmacHex(secret, `${sessionId}.${expires}.${role}`);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0 ? { sessionId, expiresAtSeconds, role } : null;
}

/** The session cookie's value in a `Cookie` header, or `undefined` when absent. */
export function readSessionCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

export function sessionSetCookie(token: string, secure: boolean): string {
  return (
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}` +
    (secure ? '; Secure' : '')
  );
}

export function sessionClearCookie(secure: boolean): string {
  return (
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` + (secure ? '; Secure' : '')
  );
}
