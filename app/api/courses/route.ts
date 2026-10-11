/**
 * Fork-only (FORK_CHANGES.md): `GET /api/courses`.
 *
 * The course catalogue: every finished course for a logged-in account whose
 * role may view courses, only the public ones for a guest.
 */
import { accountFromCookieHeader } from '@/lib/server/accounts/auth-method';
import { accountsEnabled } from '@/lib/server/accounts/bootstrap';
import { listCatalogue } from '@/lib/server/accounts/courses';
import { accountOwnerId } from '@/lib/server/accounts/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!accountsEnabled()) return new Response('Not found', { status: 404 });
  const user = await accountFromCookieHeader(request.headers.get('cookie'));
  const courses = await listCatalogue(
    user?.role ?? null,
    user ? accountOwnerId(user.id) : undefined,
  );
  return Response.json({ courses }, { headers: { 'Cache-Control': 'no-store' } });
}
