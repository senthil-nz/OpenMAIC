/**
 * Fork-only (FORK_CHANGES.md): `GET /api/auth/course?id=<course id>`.
 *
 * Whether a course is public, for the access gate. It answers only that one
 * boolean, and `false` for a course that does not exist or was deleted, so it
 * is not an oracle for anything a guest could not learn by opening the course.
 */
import { accountsEnabled } from '@/lib/server/accounts/bootstrap';
import { isCoursePublic } from '@/lib/server/accounts/courses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const isPublic = id.length > 0 && id.length <= 256 ? await isCoursePublic(id) : false;
  return Response.json({ isPublic }, { headers: { 'Cache-Control': 'no-store' } });
}
