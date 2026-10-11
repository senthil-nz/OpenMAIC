/**
 * Fork-only (FORK_CHANGES.md): which courses an account may see.
 *
 * Reads upstream's `stage_meta` (owner, public flag, deletion) and
 * `document_stages` (name, timestamps); it writes nothing.
 */
import { PERMISSIONS, roleCan, type AccountRole } from '@/lib/accounts/policy';

interface CourseQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: TRow[] }>;
}

async function db(): Promise<CourseQueryable> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
  const { pool } = await getServerPersistenceProvider(connectionString);
  return pool as unknown as CourseQueryable;
}

/** Whether a live course is marked public. `false` for an unknown or deleted course. */
export async function isCoursePublic(courseId: string): Promise<boolean> {
  const pool = await db();
  const { rows } = await pool.query(
    'SELECT 1 FROM stage_meta WHERE stage_id = $1 AND is_public AND deleted_at IS NULL',
    [courseId],
  );
  return rows.length > 0;
}

export interface CatalogueCourse {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isPublic: boolean;
  /** Whether the caller owns it (and so may edit it). */
  readonly mine: boolean;
  readonly sceneCount: number;
  readonly updatedAt: number;
}

interface CourseRow extends Record<string, unknown> {
  id: string;
  name: string | null;
  description: string | null;
  is_public: boolean;
  owner_id: string;
  scene_count: string;
  updated_at: number | string | null;
}

/**
 * The finished courses the caller may open: every course for a role that
 * holds `course:view`, otherwise only the public ones.
 */
export async function listCatalogue(
  role: AccountRole | null,
  ownerId: string | undefined,
): Promise<CatalogueCourse[]> {
  const pool = await db();
  const seeAll = roleCan(role, PERMISSIONS.courseView);
  const { rows } = await pool.query<CourseRow>(
    `SELECT s.id, s.name, s.description, m.is_public, m.owner_id, s.updated_at,
            (SELECT count(*) FROM document_scenes c WHERE c.stage_id = s.id)::text AS scene_count
       FROM document_stages s
       JOIN stage_meta m ON m.stage_id = s.id
      WHERE m.deleted_at IS NULL
        AND m.generation_complete
        AND ($1::boolean OR m.is_public)
      ORDER BY s.updated_at DESC NULLS LAST
      LIMIT 200`,
    [seeAll],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name ?? '',
    description: row.description ?? '',
    isPublic: row.is_public === true,
    mine: ownerId !== undefined && row.owner_id === ownerId,
    sceneCount: Number(row.scene_count),
    updatedAt: Number(row.updated_at ?? 0),
  }));
}
