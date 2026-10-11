/**
 * Fork-only (FORK_CHANGES.md): `POST /api/auth/login`.
 *
 * Checks a username and password and starts a session. Wrong username and
 * wrong password answer the same way and take the same time.
 */
import { PASSWORD_MAX_LENGTH, type AccountSummary } from '@/lib/accounts/policy';
import { accountsEnabled } from '@/lib/server/accounts/bootstrap';
import { decoyPasswordHash, verifyPassword } from '@/lib/server/accounts/password';
import {
  issueSessionToken,
  sessionSecret,
  sessionSetCookie,
} from '@/lib/server/accounts/session-token';
import { createSession, findUserWithHash, normalizeUsername } from '@/lib/server/accounts/store';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { SlidingWindowFailureLimiter } from '@/lib/server/attempt-limiter';
import { cookiesAreSecure } from '@/lib/server/cookie-secure';

export const runtime = 'nodejs';

/** Ten attempts a minute per username; a correct password clears the count. */
const loginLimiter = new SlidingWindowFailureLimiter();

export async function POST(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }
  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown };
  if (
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    !username.trim() ||
    !password ||
    username.length > 64 ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return apiError('INVALID_CREDENTIALS', 401, 'Wrong username or password');
  }

  const key = normalizeUsername(username);
  const limit = loginLimiter.consume(key);
  if (limit.limited) {
    const response = apiError('RATE_LIMITED', 429, 'Too many login attempts');
    response.headers.set('Retry-After', String(limit.retryAfterSeconds));
    return response;
  }

  const found = await findUserWithHash(key);
  const matches = await verifyPassword(
    password,
    found?.passwordHash ?? (await decoyPasswordHash()),
  );
  if (!found || !matches || !found.user.active) {
    return apiError('INVALID_CREDENTIALS', 401, 'Wrong username or password');
  }
  loginLimiter.recordSuccess(key);

  const { user } = found;
  const session = await createSession(user.id);
  const token = await issueSessionToken(session.sessionId, user.role, sessionSecret());
  const account: AccountSummary = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
  const response = apiSuccess({ account });
  response.headers.append('Set-Cookie', sessionSetCookie(token, cookiesAreSecure()));
  return response;
}
