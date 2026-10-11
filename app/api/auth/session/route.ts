/**
 * Fork-only (FORK_CHANGES.md): `POST /api/auth/session`.
 *
 * Renews the short-lived session token. The access gate calls it when a
 * token is past its lifetime: a live session gets a fresh token carrying the
 * account's current role; an ended one (logged out, expired, user disabled)
 * gets none. It needs a correctly signed cookie, so it tells a caller nothing
 * they could not already present.
 */
import { accountFromCookieHeader } from '@/lib/server/accounts/auth-method';
import { accountsEnabled } from '@/lib/server/accounts/bootstrap';
import {
  issueSessionToken,
  readSessionCookie,
  readSessionToken,
  sessionSecret,
} from '@/lib/server/accounts/session-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NONE = { token: null, role: null };

export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  const cookieHeader = request.headers.get('cookie');
  const user = await accountFromCookieHeader(cookieHeader);
  const current = readSessionCookie(cookieHeader);
  const claims = current ? await readSessionToken(current, sessionSecret()) : null;
  const headers = { 'Cache-Control': 'no-store' };
  if (!user || !claims) return Response.json(NONE, { headers });
  const token = await issueSessionToken(claims.sessionId, user.role, sessionSecret());
  return Response.json({ token, role: user.role }, { headers });
}
