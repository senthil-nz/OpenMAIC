/**
 * Fork-only (FORK_CHANGES.md): the viewer snapshot, the file that carries
 * course content from an authoring deployment (PostgreSQL) to a viewer
 * deployment (embedded database).
 *
 * A snapshot is gzip-compressed JSON lines:
 *
 *   {"format":"openmaic-viewer-snapshot","version":1,"id":...,"migrations":[...]}
 *   {"table":"document_stages","columns":[...],"primaryKey":["id"]}
 *   ["stage-1","Algebra",null,...]          one line per row, every value as
 *   ...                                      PostgreSQL prints it (or null)
 *   {"end":"document_stages","rows":3}
 *   ...
 *   {"done":true,"tables":14}
 *
 * The last line is what tells a complete file from one cut short in transit.
 *
 * This module has no server imports: the export command and the import at
 * boot both read the table list from here, so the two cannot disagree.
 */

export const SNAPSHOT_FORMAT = 'openmaic-viewer-snapshot';
export const SNAPSHOT_VERSION = 1;

/**
 * How a table's rows from the snapshot meet the rows the viewer already has.
 *
 * - `replace`: the viewer's rows become exactly the snapshot's. For tables only
 *   an authoring deployment writes.
 * - `merge`: snapshot rows are inserted or overwrite the row with the same
 *   primary key; rows the viewer has and the snapshot lacks stay. For tables a
 *   viewer writes too.
 * - `insert-missing`: rows whose primary key the viewer already has are left
 *   alone. For immutable rows keyed by their content, so a large blob is
 *   written once and never again.
 */
export type SnapshotTableMode = 'replace' | 'merge' | 'insert-missing';

export interface SnapshotTable {
  readonly name: string;
  readonly mode: SnapshotTableMode;
  /** The schema store whose migrations own the table. */
  readonly store: string;
  /** Rows read per query on export; small for tables with large values. */
  readonly batchRows?: number;
}

/**
 * The tables a snapshot carries. Everything else in a viewer's database is the
 * viewer's own and an import never touches it: learner progress and chat
 * history (`runtime_sessions`, `runtime_records`), login sessions
 * (`account_sessions`), and the model settings saved on the viewer
 * (`workspace_model_config`, which also holds keys sealed with the authoring
 * deployment's instance secret and so is deliberately not shipped).
 */
export const SNAPSHOT_TABLES: readonly SnapshotTable[] = [
  { name: 'document_stages', mode: 'replace', store: 'document' },
  { name: 'document_scenes', mode: 'replace', store: 'document' },
  { name: 'document_outlines', mode: 'replace', store: 'document' },
  { name: 'document_stage_revision', mode: 'replace', store: 'document' },
  { name: 'document_scene_revision', mode: 'replace', store: 'document' },
  { name: 'document_folders', mode: 'replace', store: 'document' },
  { name: 'stage_meta', mode: 'replace', store: 'stage-meta' },
  // Bytes are keyed by their hash and never change. Entries may also be
  // created on the viewer (media a lesson stores for a learner), so the
  // viewer's own are kept.
  { name: 'asset_blobs', mode: 'insert-missing', store: 'asset', batchRows: 1 },
  { name: 'asset_entries', mode: 'merge', store: 'asset' },
  { name: 'document_asset_refs', mode: 'replace', store: 'asset' },
  { name: 'document_asset_withdrawals', mode: 'replace', store: 'asset' },
  { name: 'owner_agents', mode: 'replace', store: 'owner-agents' },
  // A learner who used the viewer before logging in is merged into their
  // account on the viewer; those rows are the viewer's.
  { name: 'owner_merges', mode: 'merge', store: 'owner-merges' },
  // Accounts are managed on the authoring deployment; a viewer refuses user
  // management, so its accounts are exactly the snapshot's.
  { name: 'account_users', mode: 'replace', store: 'fork-accounts' },
];

/** Tables an import refuses to write whatever a snapshot says. */
export const VIEWER_OWNED_TABLES: ReadonlySet<string> = new Set([
  'runtime_sessions',
  'runtime_records',
  'account_sessions',
  'workspace_model_config',
  'openmaic_schema_migrations',
]);

export interface SnapshotMigration {
  readonly store: string;
  readonly version: number;
}

export interface SnapshotHeader {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly version: number;
  /** Unique per export; a viewer imports each snapshot once. */
  readonly id: string;
  readonly createdAt: string;
  /** The newest schema version of each store in the source database. */
  readonly migrations: readonly SnapshotMigration[];
}

export interface SnapshotTableStart {
  readonly table: string;
  readonly columns: readonly string[];
  readonly primaryKey: readonly string[];
}

export interface SnapshotTableEnd {
  readonly end: string;
  readonly rows: number;
}

export interface SnapshotDone {
  readonly done: true;
  readonly tables: number;
}

/** A value as PostgreSQL prints it, or SQL NULL. */
export type SnapshotValue = string | null;
export type SnapshotRow = readonly SnapshotValue[];

export const SCHEMA_MIGRATIONS_TABLE = 'openmaic_schema_migrations';

/** A double-quoted SQL identifier. */
export function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** The minimal query surface the export and the import need. */
export interface SnapshotQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: TRow[] }>;
}

export interface TableColumn {
  readonly name: string;
  /** The type as `format_type` prints it, usable in a cast. */
  readonly type: string;
  readonly generated: boolean;
}

/** A table's columns in order, or `undefined` when it does not exist. */
export async function readTableColumns(
  db: SnapshotQueryable,
  table: string,
): Promise<TableColumn[] | undefined> {
  const result = await db.query<{ name: string; type: string; generated: boolean }>(
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS type,
            a.attgenerated <> '' AS generated
       FROM pg_attribute a
      WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`,
    [`public.${quoteIdentifier(table)}`],
  );
  return result.rows.length === 0 ? undefined : result.rows;
}

/** A table's primary key columns in key order (empty when it has none). */
export async function readPrimaryKey(db: SnapshotQueryable, table: string): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `SELECT a.attname AS name
       FROM pg_index i
       JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE i.indrelid = to_regclass($1) AND i.indisprimary
      ORDER BY k.ord`,
    [`public.${quoteIdentifier(table)}`],
  );
  return result.rows.map((row) => row.name);
}

/** The newest recorded version of each schema store (none when nothing ran). */
export async function readSchemaVersions(db: SnapshotQueryable): Promise<SnapshotMigration[]> {
  const present = await db.query<{ present: boolean }>(
    `SELECT to_regclass('public.${SCHEMA_MIGRATIONS_TABLE}') IS NOT NULL AS present`,
  );
  if (present.rows[0]?.present !== true) return [];
  const result = await db.query<{ store: string; version: number | string }>(
    `SELECT store, max(version) AS version FROM ${SCHEMA_MIGRATIONS_TABLE}
      GROUP BY store ORDER BY store`,
  );
  return result.rows.map((row) => ({ store: row.store, version: Number(row.version) }));
}
