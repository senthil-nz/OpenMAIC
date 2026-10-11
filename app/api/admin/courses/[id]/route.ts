/**
 * Fork-only (FORK_CHANGES.md): `PATCH /api/admin/courses/[id]`.
 *
 * An admin makes any course public or private, whoever owns it. (Upstream's
 * `/api/stages/[id]/publish` stays owner-only; teachers use that for their
 * own courses.)
 */
import { adminError, adminJson, requireUserManager } from '@/lib/server/accounts/admin';
import { setStagePublished } from '@/lib/persistence/stage-meta';
import { getStageAccessDb, resolveStageAccess } from '@/lib/server/stage-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireUserManager(request);
  if (admin instanceof Response) return admin;
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { isPublic?: unknown } | null;
  if (typeof body?.isPublic !== 'boolean') return adminError(400, 'isPublic: true or false');

  const access = await resolveStageAccess(id);
  if (!access) return adminError(404, 'No such course');
  const db = await getStageAccessDb();
  await setStagePublished(db, id, body.isPublic, body.isPublic ? Date.now() : null);
  console.info('Course visibility changed by admin', {
    stageId: id,
    isPublic: body.isPublic,
    admin: admin.username,
  });
  return adminJson({ success: true, isPublic: body.isPublic });
}
