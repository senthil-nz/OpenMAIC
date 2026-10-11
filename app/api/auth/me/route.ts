/**
 * Fork-only (FORK_CHANGES.md): `GET /api/auth/me`.
 *
 * Who is logged in, for the interface. `account` is `null` for a guest. A
 * session cookie that no longer works is cleared here, so the browser stops
 * presenting it (owner-scoped routes refuse an unusable cookie with 401).
 */
import type { AccountSummary } from '@/lib/accounts/policy';
import { viewerModeEnabled } from '@/lib/accounts/route-policy';
import { accountFromCookieHeader } from '@/lib/server/accounts/auth-method';
import { accountsEnabled } from '@/lib/server/accounts/bootstrap';
import { sessionClearCookie } from '@/lib/server/accounts/session-token';
import { apiSuccess } from '@/lib/server/api-response';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!accountsEnabled()) return apiSuccess({ enabled: false, viewer: false, account: null });
  const user = await accountFromCookieHeader(request.headers.get('cookie'));
  const account: AccountSummary | null = user
    ? { id: user.id, username: user.username, displayName: user.displayName, role: user.role }
    : null;
  const response = apiSuccess({ enabled: true, viewer: viewerModeEnabled(), account });
  response.headers.set('Cache-Control', 'no-store');
  if (user === null) {
    response.headers.append('Set-Cookie', sessionClearCookie(cookiesAreSecure()));
  }
  return response;
}
