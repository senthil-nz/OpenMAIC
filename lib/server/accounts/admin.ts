/**
 * Fork-only (FORK_CHANGES.md): shared pieces of the user-management routes.
 */
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PERMISSIONS,
  USERNAME_PATTERN,
  isAccountRole,
  roleCan,
  type AccountRole,
} from '@/lib/accounts/policy';

import { accountFromCookieHeader } from './auth-method';
import { accountsEnabled } from './bootstrap';
import type { AccountUser } from './store';

export function adminJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export function adminError(status: number, error: string): Response {
  return adminJson({ success: false, error }, status);
}

/**
 * The admin making the request, checked against the database, or the response
 * to send instead. The middleware gate already refused everyone else; this is
 * the check that does not depend on it.
 */
export async function requireUserManager(request: Request): Promise<AccountUser | Response> {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  const user = await accountFromCookieHeader(request.headers.get('cookie'));
  if (!user) return adminError(401, 'Log in to continue');
  if (!roleCan(user.role, PERMISSIONS.usersManage)) {
    return adminError(403, 'Your account cannot do this');
  }
  return user;
}

export interface UserInput {
  username?: string;
  displayName?: string;
  password?: string;
  role?: AccountRole;
  active?: boolean;
}

/** The fields of a create or update body that are present and well formed, or a message. */
export function parseUserInput(body: unknown): UserInput | string {
  if (typeof body !== 'object' || body === null) return 'Invalid request';
  const raw = body as Record<string, unknown>;
  const input: UserInput = {};
  if (raw.username !== undefined) {
    const username = typeof raw.username === 'string' ? raw.username.trim().toLowerCase() : '';
    if (!USERNAME_PATTERN.test(username)) {
      return 'Username: 3 to 32 characters of a-z, 0-9, ".", "_" or "-", starting with a letter or digit';
    }
    input.username = username;
  }
  if (raw.displayName !== undefined) {
    const displayName = typeof raw.displayName === 'string' ? raw.displayName.trim() : '';
    if (displayName.length < 1 || displayName.length > 80) return 'Name: 1 to 80 characters';
    input.displayName = displayName;
  }
  if (raw.password !== undefined) {
    if (
      typeof raw.password !== 'string' ||
      raw.password.length < PASSWORD_MIN_LENGTH ||
      raw.password.length > PASSWORD_MAX_LENGTH
    ) {
      return `Password: at least ${PASSWORD_MIN_LENGTH} characters`;
    }
    input.password = raw.password;
  }
  if (raw.role !== undefined) {
    if (!isAccountRole(raw.role)) return 'Role: student, teacher or admin';
    input.role = raw.role;
  }
  if (raw.active !== undefined) {
    if (typeof raw.active !== 'boolean') return 'Active: true or false';
    input.active = raw.active;
  }
  return input;
}

export function userSummary(user: AccountUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    active: user.active,
  };
}
