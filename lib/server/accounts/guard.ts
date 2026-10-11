/**
 * Fork-only (FORK_CHANGES.md): a second check inside the few routes where a
 * mistake in the rule table would matter most. The access gate in the
 * middleware is the main enforcement; this repeats it against the principal
 * the database resolved.
 */
import { accountsEnabled, type Permission } from '@/lib/accounts/policy';
import type { OwnerPrincipal } from '@/lib/server/identity/types';

/** A `403` when accounts are on and the principal lacks `permission`; else `undefined`. */
export function refuseWithout(
  principal: OwnerPrincipal,
  permission: Permission,
  headers?: Headers,
): Response | undefined {
  if (!accountsEnabled() || principal.roles.has(permission)) return undefined;
  return Response.json(
    { success: false, errorCode: 'INVALID_REQUEST', error: 'Your account cannot do this' },
    { status: 403, headers },
  );
}
