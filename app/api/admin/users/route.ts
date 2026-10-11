/**
 * Fork-only (FORK_CHANGES.md): `GET` and `POST /api/admin/users`.
 * List the accounts, or create one. Admin only.
 */
import {
  adminError,
  adminJson,
  parseUserInput,
  requireUserManager,
  userSummary,
} from '@/lib/server/accounts/admin';
import { hashPassword } from '@/lib/server/accounts/password';
import { createUser, findUserWithHash, listUsers } from '@/lib/server/accounts/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const admin = await requireUserManager(request);
  if (admin instanceof Response) return admin;
  return adminJson({ success: true, users: (await listUsers()).map(userSummary) });
}

export async function POST(request: Request) {
  const admin = await requireUserManager(request);
  if (admin instanceof Response) return admin;
  const input = parseUserInput(await request.json().catch(() => null));
  if (typeof input === 'string') return adminError(400, input);
  if (!input.username || !input.password || !input.role) {
    return adminError(400, 'Username, password and role are required');
  }
  if (await findUserWithHash(input.username)) {
    return adminError(409, 'That username is already taken');
  }
  const user = await createUser({
    username: input.username,
    displayName: input.displayName ?? input.username,
    passwordHash: await hashPassword(input.password),
    role: input.role,
  });
  return adminJson({ success: true, user: userSummary(user) }, 201);
}
