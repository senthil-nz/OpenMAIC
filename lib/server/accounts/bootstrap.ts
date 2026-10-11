/**
 * Fork-only: turning accounts on at boot (see FORK_CHANGES.md).
 *
 * Off by default, so without `OPENMAIC_ACCOUNTS_ENABLED=true` the server
 * behaves exactly as upstream.
 */
import { ACCOUNTS_ENABLED_ENV, PASSWORD_MIN_LENGTH, USERNAME_PATTERN } from '@/lib/accounts/policy';

import { SESSION_SECRET_ENV, SESSION_SECRET_MIN_LENGTH, sessionSecret } from './session-token';

export const ADMIN_USERNAME_ENV = 'OPENMAIC_ADMIN_USERNAME';
export const ADMIN_PASSWORD_ENV = 'OPENMAIC_ADMIN_PASSWORD';

export function accountsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const value = env[ACCOUNTS_ENABLED_ENV]?.trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Throws on a configuration the server must not start with, like the other
 * boot checks in `instrumentation.ts` (run through `runConfigurationCheck`).
 */
export function assertAccountsConfiguration(): void {
  if (!accountsEnabled()) return;
  if (sessionSecret().length < SESSION_SECRET_MIN_LENGTH) {
    throw new Error(
      `${ACCOUNTS_ENABLED_ENV}=true needs ${SESSION_SECRET_ENV}: a random value of at least ` +
        `${SESSION_SECRET_MIN_LENGTH} characters that signs login cookies ` +
        "(for example from `node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"`).",
    );
  }
}

/** Register the account session method ahead of owner identity validation. */
export async function registerAccountAuthentication(): Promise<void> {
  if (!accountsEnabled()) return;
  const { configureOwnerAuthentication } = await import('@/lib/server/identity');
  const { accountSessionAuthMethod } = await import('./auth-method');
  configureOwnerAuthentication({ methods: [accountSessionAuthMethod()] });
}

/**
 * Create the first admin from the environment when no active admin exists.
 * Runs in the background after boot: it needs the database, and `register`
 * must not wait on I/O. It never overwrites an existing account.
 */
export async function seedFirstAdmin(): Promise<void> {
  if (!accountsEnabled()) return;
  const username = process.env[ADMIN_USERNAME_ENV]?.trim().toLowerCase();
  const password = process.env[ADMIN_PASSWORD_ENV];
  try {
    const { countAdmins, createUser, findUserWithHash } = await import('./store');
    if ((await countAdmins()) > 0) return;
    if (!username || !password) {
      console.warn(
        `[accounts] No admin account exists. Set ${ADMIN_USERNAME_ENV} and ${ADMIN_PASSWORD_ENV} ` +
          'in the environment and restart to create one.',
      );
      return;
    }
    if (!USERNAME_PATTERN.test(username)) {
      console.warn(`[accounts] ${ADMIN_USERNAME_ENV} must be 3-32 of a-z, 0-9, ".", "_" or "-".`);
      return;
    }
    if (password.length < PASSWORD_MIN_LENGTH) {
      console.warn(
        `[accounts] ${ADMIN_PASSWORD_ENV} must be at least ${PASSWORD_MIN_LENGTH} characters.`,
      );
      return;
    }
    if (await findUserWithHash(username)) {
      console.warn(
        `[accounts] "${username}" exists but is not an active admin; no admin was created.`,
      );
      return;
    }
    const { hashPassword } = await import('./password');
    await createUser({
      username,
      displayName: 'Administrator',
      passwordHash: await hashPassword(password),
      role: 'admin',
    });
    console.info(`[accounts] Created the first admin account "${username}".`);
  } catch (error) {
    console.error('[accounts] Could not create the first admin account', error);
  }
}
