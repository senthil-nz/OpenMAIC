/**
 * Fork-only (FORK_CHANGES.md): `PATCH /api/admin/users/[id]`.
 * Change an account's name, role, password or whether it is active. Admin only.
 */
import {
  adminError,
  adminJson,
  parseUserInput,
  requireUserManager,
  userSummary,
} from '@/lib/server/accounts/admin';
import { hashPassword } from '@/lib/server/accounts/password';
import { countAdmins, findUser, updateUser } from '@/lib/server/accounts/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireUserManager(request);
  if (admin instanceof Response) return admin;
  const { id } = await context.params;
  const input = parseUserInput(await request.json().catch(() => null));
  if (typeof input === 'string') return adminError(400, input);
  if (input.username !== undefined) return adminError(400, 'A username cannot be changed');

  const target = await findUser(id);
  if (!target) return adminError(404, 'No such account');

  // Never leave the site without an active admin.
  const losesAdmin =
    target.role === 'admin' &&
    target.active &&
    ((input.role !== undefined && input.role !== 'admin') || input.active === false);
  if (losesAdmin && (await countAdmins()) <= 1) {
    return adminError(409, 'This is the only active admin; make another admin first');
  }

  const updated = await updateUser(id, {
    displayName: input.displayName,
    role: input.role,
    active: input.active,
    passwordHash: input.password === undefined ? undefined : await hashPassword(input.password),
  });
  if (!updated) return adminError(404, 'No such account');
  return adminJson({ success: true, user: userSummary(updated) });
}
