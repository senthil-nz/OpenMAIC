/**
 * Fork-only (FORK_CHANGES.md): starting a viewer on the embedded database.
 *
 * Called from `instrumentation.ts`. With `DATABASE_URL=pglite:<directory>` the
 * server opens (or creates) the embedded database, provisions the schema, and
 * imports the snapshot file if there is a new one, all before it serves a
 * request: a visitor never sees a half-imported library.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ACCOUNTS_ENABLED_ENV, accountsEnabled } from '@/lib/accounts/policy';
import { VIEWER_MODE_ENV, viewerModeEnabled } from '@/lib/accounts/route-policy';
import {
  EMBEDDED_DATABASE_SCHEME,
  embeddedDatabaseConfigured,
} from '@/lib/persistence/embedded-database';

export const VIEWER_SNAPSHOT_ENV = 'OPENMAIC_VIEWER_SNAPSHOT';
export const DEFAULT_VIEWER_SNAPSHOT = 'data/viewer-snapshot.ndjson.gz';

/** The snapshot file a viewer imports at start, resolved against the working directory. */
export function viewerSnapshotPath(env: Record<string, string | undefined> = process.env): string {
  return path.resolve(env[VIEWER_SNAPSHOT_ENV]?.trim() || DEFAULT_VIEWER_SNAPSHOT);
}

/**
 * The embedded database is one session shared by every request, which suits a
 * deployment that shows courses and nothing else. Authoring on it would put
 * generation workers, the asset collector and every teacher on that one
 * session, so it is refused: both switches that make a deployment a viewer
 * must be on (viewer mode is enforced by the account gate).
 */
export function assertEmbeddedDatabaseConfiguration(
  env: Record<string, string | undefined> = process.env,
): void {
  if (!embeddedDatabaseConfigured(env.DATABASE_URL)) return;
  if (viewerModeEnabled(env) && accountsEnabled(env)) return;
  throw new Error(
    `DATABASE_URL=${EMBEDDED_DATABASE_SCHEME}... is the embedded database of a viewer deployment ` +
      `and needs ${VIEWER_MODE_ENV}=true and ${ACCOUNTS_ENABLED_ENV}=true. ` +
      'A deployment that creates courses needs PostgreSQL.',
  );
}

/**
 * Open the embedded database, provision what a viewer reads, and import a new
 * snapshot. A snapshot that cannot be imported is reported and the viewer
 * starts on the content it already has; a database that cannot be opened is a
 * boot failure.
 */
export async function prepareEmbeddedViewerDatabase(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim() ?? '';
  if (!embeddedDatabaseConfigured(connectionString)) return;

  const started = Date.now();
  const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
  const { pool } = await getServerPersistenceProvider(connectionString);
  // The accounts tables are provisioned by their first use; the snapshot
  // carries accounts, so they have to exist before it is imported.
  const { applySchemaMigrations } = await import('@openmaic/storage/pg-migrations');
  const { ACCOUNTS_MIGRATIONS } = await import('@/lib/server/accounts/store');
  await applySchemaMigrations(
    pool as unknown as Parameters<typeof applySchemaMigrations>[0],
    ACCOUNTS_MIGRATIONS,
  );
  console.info(`[viewer] Embedded database ready in ${Date.now() - started}ms.`);

  const file = viewerSnapshotPath();
  if (!existsSync(file)) {
    console.info(`[viewer] No snapshot at ${file}; serving the content already imported.`);
    return;
  }
  const { importViewerSnapshot, openSnapshotFile } = await import('./snapshot-import');
  const importStarted = Date.now();
  const snapshot = openSnapshotFile(file);
  const client = await pool.connect();
  try {
    const summary = await importViewerSnapshot(client, snapshot.lines);
    if (summary.skipped) {
      console.info(`[viewer] Snapshot ${summary.id} (${summary.createdAt}) is already imported.`);
      return;
    }
    const rows = summary.tables.reduce((total, table) => total + table.rows, 0);
    console.info(
      `[viewer] Imported snapshot ${summary.id} (${summary.createdAt}): ${rows} rows in ` +
        `${summary.tables.length} tables, ${Date.now() - importStarted}ms.` +
        (summary.orphansRemoved > 0
          ? ` Removed ${summary.orphansRemoved} rows that belonged to deleted content.`
          : ''),
    );
  } catch (error) {
    console.error(
      `[viewer] Could not import the snapshot at ${file}; the viewer keeps the content it had. ` +
        (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    client.release();
    snapshot.close();
  }
}
