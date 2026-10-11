/**
 * Fork-only (FORK_CHANGES.md): `POST /api/auth/logout`.
 *
 * Deletes the session and clears the cookie. Always succeeds, so a stale or
 * tampered cookie can be dropped too.
 */
import { accountsEnabled } from '@/lib/server/accounts/bootstrap';
import {
  readSessionCookie,
  sessionClearCookie,
  sessionSecret,
  verifySessionToken,
} from '@/lib/server/accounts/session-token';
import { deleteSession } from '@/lib/server/accounts/store';
import { apiSuccess } from '@/lib/server/api-response';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  const token = readSessionCookie(request.headers.get('cookie'));
  if (token) {
    const claims = await verifySessionToken(token, sessionSecret());
    if (claims) await deleteSession(claims.sessionId);
  }
  const response = apiSuccess({});
  response.headers.append('Set-Cookie', sessionClearCookie(cookiesAreSecure()));
  return response;
}
