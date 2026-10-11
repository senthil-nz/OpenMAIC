/**
 * Fork-only: user accounts and login sessions in PostgreSQL (see
 * FORK_CHANGES.md). Two tables of its own; it touches no upstream table.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import { applySchemaMigrations, type SchemaMigrationSet } from '@openmaic/storage/pg-migrations';

import { isAccountRole, type AccountRole, type AccountSummary } from '@/lib/accounts/policy';

import { SESSION_MAX_AGE_SECONDS } from './session-token';

export const ACCOUNTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS account_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS account_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES account_users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS account_sessions_user_idx ON account_sessions (user_id);
`;

export const ACCOUNTS_MIGRATIONS: SchemaMigrationSet = {
  store: 'fork-accounts',
  migrations: [{ version: 1, name: 'baseline', up: ACCOUNTS_SCHEMA, transaction: false }],
};

interface AccountQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: TRow[]; rowCount?: number | null }>;
}

export interface AccountUser extends AccountSummary {
  readonly active: boolean;
}

interface UserRow extends Record<string, unknown> {
  id: string;
  username: string;
  display_name: string;
  role: string;
  active: boolean;
}

function toUser(row: UserRow): AccountUser {
  if (!isAccountRole(row.role)) throw new Error(`account ${row.id} has an unknown role`);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
  };
}

/** The owner id an account's courses are stored under. */
export const ACCOUNT_OWNER_PREFIX = 'user:';
export function accountOwnerId(userId: string): string {
  return `${ACCOUNT_OWNER_PREFIX}${userId}`;
}

let ready: Promise<AccountQueryable> | undefined;

/** The persistence pool, with the accounts tables provisioned once per process. */
async function db(): Promise<AccountQueryable> {
  ready ??= (async () => {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) throw new Error('DATABASE_URL is not set');
    const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
    const { pool } = await getServerPersistenceProvider(connectionString);
    await applySchemaMigrations(
      pool as unknown as Parameters<typeof applySchemaMigrations>[0],
      ACCOUNTS_MIGRATIONS,
    );
    return pool as unknown as AccountQueryable;
  })().catch((error) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export async function findUserWithHash(
  username: string,
): Promise<{ user: AccountUser; passwordHash: string } | null> {
  const pool = await db();
  const { rows } = await pool.query<UserRow & { password_hash: string }>(
    'SELECT id, username, display_name, role, active, password_hash FROM account_users WHERE username = $1',
    [normalizeUsername(username)],
  );
  return rows[0] ? { user: toUser(rows[0]), passwordHash: rows[0].password_hash } : null;
}

export async function countAdmins(): Promise<number> {
  const pool = await db();
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM account_users WHERE role = 'admin' AND active",
  );
  return Number(rows[0]?.n ?? 0);
}

export async function createUser(input: {
  username: string;
  displayName: string;
  passwordHash: string;
  role: AccountRole;
}): Promise<AccountUser> {
  const pool = await db();
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO account_users (id, username, display_name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, username, display_name, role, active`,
    [
      randomUUID(),
      normalizeUsername(input.username),
      input.displayName,
      input.passwordHash,
      input.role,
    ],
  );
  return toUser(rows[0]);
}

/** Start a session for a user; the id is 32 random bytes, unguessable. */
export async function createSession(
  userId: string,
): Promise<{ sessionId: string; expiresAtSeconds: number }> {
  const pool = await db();
  const sessionId = randomBytes(32).toString('base64url');
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  await pool.query(
    'INSERT INTO account_sessions (id, user_id, expires_at) VALUES ($1, $2, to_timestamp($3))',
    [sessionId, userId, expiresAtSeconds],
  );
  // Opportunistic cleanup; a failure here must not fail the login.
  void pool.query('DELETE FROM account_sessions WHERE expires_at < now()').catch(() => {});
  return { sessionId, expiresAtSeconds };
}

/** The active user behind a live session, or `null` (expired, deleted, or the user is disabled). */
export async function findSessionUser(sessionId: string): Promise<AccountUser | null> {
  const pool = await db();
  const { rows } = await pool.query<UserRow>(
    `SELECT u.id, u.username, u.display_name, u.role, u.active
       FROM account_sessions s
       JOIN account_users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.expires_at > now() AND u.active`,
    [sessionId],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const pool = await db();
  await pool.query('DELETE FROM account_sessions WHERE id = $1', [sessionId]);
}
