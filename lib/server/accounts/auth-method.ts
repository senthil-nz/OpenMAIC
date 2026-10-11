/**
 * Fork-only: the owner auth method for account sessions (see FORK_CHANGES.md).
 *
 * Registered through the documented host hook (`configureOwnerAuthentication`,
 * hosting docs "Registering owner auth methods"). A request with a valid
 * session cookie resolves to the account's owner with the permissions of its
 * role; a request without one falls through to the anonymous cookie (a guest).
 */
import { permissionsOf } from '@/lib/accounts/policy';
import type {
  OwnerAuthMethod,
  OwnerAuthMethodResult,
  OwnerAuthRequest,
} from '@/lib/server/identity/types';

import { readSessionCookie, sessionSecret, verifySessionToken } from './session-token';
import { ACCOUNT_OWNER_PREFIX, accountOwnerId, findSessionUser, type AccountUser } from './store';

/** The account a request's session cookie names, `null` when the cookie is unusable, `undefined` when absent. */
export async function accountFromCookieHeader(
  cookieHeader: string | null,
): Promise<AccountUser | null | undefined> {
  const token = readSessionCookie(cookieHeader);
  if (token === undefined) return undefined;
  const claims = await verifySessionToken(token, sessionSecret());
  if (!claims) return null;
  return findSessionUser(claims.sessionId);
}

async function authenticate(req: OwnerAuthRequest): Promise<OwnerAuthMethodResult> {
  const user = await accountFromCookieHeader(req.headers.get('cookie'));
  if (user === undefined) return { status: 'not-applicable' };
  // Present but unusable is `invalid`, never a silent downgrade to a guest.
  if (user === null) return { status: 'invalid', reason: 'expired or revoked account session' };
  return {
    status: 'authenticated',
    principal: {
      ownerId: accountOwnerId(user.id),
      kind: 'user',
      roles: permissionsOf(user.role),
      assurance: 'verified',
      channel: 'web',
    },
  };
}

export function accountSessionAuthMethod(): OwnerAuthMethod {
  return {
    name: 'account-session',
    authenticate,
    // Roles depend on the account's current role, so none are claimed here.
    describeStoredOwner: (ownerId) =>
      ownerId.startsWith(ACCOUNT_OWNER_PREFIX) ? { kind: 'user' } : undefined,
  };
}
