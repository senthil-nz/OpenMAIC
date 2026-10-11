/**
 * Fork-only (FORK_CHANGES.md): bring a viewer snapshot into a viewer's
 * database. See `./snapshot-format.ts` for the file and for which tables it
 * carries.
 *
 * The import is one transaction: the viewer serves either the content it had
 * or the whole new snapshot, never half of one, and a file cut short in
 * transit changes nothing. Tables the snapshot does not carry are never
 * written, which is what keeps learner progress, chat history and login
 * sessions across an update.
 */
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';

import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_TABLES,
  SNAPSHOT_VERSION,
  VIEWER_OWNED_TABLES,
  quoteIdentifier,
  readPrimaryKey,
  readSchemaVersions,
  readTableColumns,
  type SnapshotHeader,
  type SnapshotQueryable,
  type SnapshotRow,
  type SnapshotTable,
  type SnapshotTableStart,
} from './snapshot-format';

export const SNAPSHOT_LOG_TABLE = 'fork_viewer_snapshots';

const SNAPSHOT_LOG_SCHEMA = `
CREATE TABLE IF NOT EXISTS ${SNAPSHOT_LOG_TABLE} (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tables JSONB NOT NULL
)`;

/** The snapshot is not one this release can import; nothing was changed. */
export class SnapshotRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotRefusedError';
  }
}

export interface SnapshotImportSummary {
  readonly id: string;
  readonly createdAt: string;
  /** `true` when this snapshot was imported before; nothing was changed. */
  readonly skipped: boolean;
  readonly tables: { name: string; rows: number; written: number }[];
  /** Rows of the viewer's own tables removed because what they belonged to is gone. */
  readonly orphansRemoved: number;
}

export interface SnapshotImportOptions {
  readonly tables?: readonly SnapshotTable[];
}

function refuse(message: string): never {
  throw new SnapshotRefusedError(message);
}

function parseLine(line: string, lineNumber: number): unknown {
  try {
    return JSON.parse(line);
  } catch {
    refuse(`Line ${lineNumber} of the snapshot is not valid JSON; the file is damaged`);
  }
}

function readHeader(value: unknown): SnapshotHeader {
  const header = value as Partial<SnapshotHeader> | null;
  if (!header || header.format !== SNAPSHOT_FORMAT) {
    refuse('The file is not an OpenMAIC viewer snapshot');
  }
  if (header.version !== SNAPSHOT_VERSION) {
    refuse(
      `The snapshot has format version ${String(header.version)}; this release reads ` +
        `version ${SNAPSHOT_VERSION}. Export it again with the release the viewer runs.`,
    );
  }
  if (typeof header.id !== 'string' || !header.id || typeof header.createdAt !== 'string') {
    refuse('The snapshot header is incomplete');
  }
  return header as SnapshotHeader;
}

/**
 * The stores of the carried tables must be at the same schema version on both
 * sides: rows are copied column by column, so a difference would silently
 * drop or default data a migration was meant to carry.
 */
async function assertSameSchemaVersions(
  target: SnapshotQueryable,
  header: SnapshotHeader,
  tables: readonly SnapshotTable[],
): Promise<void> {
  const mine = new Map((await readSchemaVersions(target)).map((row) => [row.store, row.version]));
  const theirs = new Map(header.migrations.map((row) => [row.store, row.version]));
  const differences: string[] = [];
  for (const store of new Set(tables.map((table) => table.store))) {
    const sourceVersion = theirs.get(store);
    const targetVersion = mine.get(store);
    if (sourceVersion === undefined || targetVersion === undefined) continue;
    if (sourceVersion !== targetVersion) {
      differences.push(`${store} (snapshot ${sourceVersion}, viewer ${targetVersion})`);
    }
  }
  if (differences.length > 0) {
    refuse(
      `The snapshot and this viewer are at different schema versions: ${differences.join(', ')}. ` +
        'Build the viewer and export the snapshot from the same release, and start the ' +
        'authoring server once on that release before exporting so its database is migrated.',
    );
  }
}

interface TableWriter {
  readonly table: SnapshotTable;
  write(row: SnapshotRow): Promise<boolean>;
}

async function openTable(
  target: SnapshotQueryable,
  table: SnapshotTable,
  start: SnapshotTableStart,
): Promise<TableWriter> {
  const columns = await readTableColumns(target, table.name);
  if (!columns) {
    refuse(`The snapshot carries ${table.name}, which this viewer's database does not have`);
  }
  const typeOf = new Map(
    columns.filter((column) => !column.generated).map((column) => [column.name, column.type]),
  );
  const unknown = start.columns.filter((name) => !typeOf.has(name));
  if (unknown.length > 0) {
    refuse(`${table.name} has no column ${unknown.join(', ')} on this viewer`);
  }
  const primaryKey = await readPrimaryKey(target, table.name);
  if (primaryKey.join(',') !== start.primaryKey.join(',')) {
    refuse(`${table.name} has a different primary key on this viewer`);
  }

  const name = quoteIdentifier(table.name);
  const columnList = start.columns.map(quoteIdentifier).join(', ');
  // Text in, cast to the column's own type: the values are PostgreSQL's
  // printed form, which every type reads back.
  const valueList = start.columns
    .map((column, index) => `$${index + 1}::text::${typeOf.get(column)}`)
    .join(', ');
  const keyList = primaryKey.map(quoteIdentifier).join(', ');
  const rest = start.columns.filter((column) => !primaryKey.includes(column));
  const insert = `INSERT INTO ${name} (${columnList}) VALUES (${valueList})`;

  if (table.mode === 'replace') {
    // DELETE, not TRUNCATE: a table the viewer keeps may reference this one,
    // and TRUNCATE would refuse or (with CASCADE) empty it.
    await target.query(`DELETE FROM ${name}`);
    return {
      table,
      write: async (row) => {
        await target.query(insert, [...row]);
        return true;
      },
    };
  }

  if (table.mode === 'merge') {
    const update =
      rest.length === 0
        ? 'DO NOTHING'
        : `DO UPDATE SET ${rest
            .map((column) => `${quoteIdentifier(column)} = EXCLUDED.${quoteIdentifier(column)}`)
            .join(', ')}`;
    const upsert = `${insert} ON CONFLICT (${keyList}) ${update}`;
    return {
      table,
      write: async (row) => {
        await target.query(upsert, [...row]);
        return true;
      },
    };
  }

  // insert-missing: look before sending the row, so a blob the viewer already
  // holds is not pushed through the database again.
  const keyIndexes = primaryKey.map((column) => start.columns.indexOf(column));
  const exists = `SELECT 1 FROM ${name} WHERE ${primaryKey
    .map(
      (column, index) => `${quoteIdentifier(column)} = $${index + 1}::text::${typeOf.get(column)}`,
    )
    .join(' AND ')}`;
  const insertMissing = `${insert} ON CONFLICT (${keyList}) DO NOTHING`;
  return {
    table,
    write: async (row) => {
      const found = await target.query(
        exists,
        keyIndexes.map((index) => row[index] ?? null),
      );
      if (found.rows.length > 0) return false;
      await target.query(insertMissing, [...row]);
      return true;
    },
  };
}

interface ForeignKeyRow extends Record<string, unknown> {
  child: string;
  parent: string;
  child_columns: string[];
  parent_columns: string[];
}

/**
 * The import runs with foreign key actions off (see below), so a row of a
 * viewer-owned table that cascades from a replaced one is not removed with its
 * parent. Do what the cascade would have done: a login session of an account
 * that no longer exists goes.
 */
async function removeOrphans(target: SnapshotQueryable, replaced: string[]): Promise<number> {
  if (replaced.length === 0) return 0;
  const constraints = await target.query<ForeignKeyRow>(
    `SELECT child.relname AS child,
            parent.relname AS parent,
            ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
                   ORDER BY k.ord) AS child_columns,
            ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
                    JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
                   ORDER BY k.ord) AS parent_columns
       FROM pg_constraint c
       JOIN pg_class child ON child.oid = c.conrelid
       JOIN pg_class parent ON parent.oid = c.confrelid
      WHERE c.contype = 'f' AND c.confdeltype = 'c' AND parent.relname = ANY($1::text[])`,
    [replaced],
  );
  let removed = 0;
  for (const constraint of constraints.rows) {
    const match = constraint.child_columns
      .map(
        (column, index) =>
          `p.${quoteIdentifier(constraint.parent_columns[index]!)} = c.${quoteIdentifier(column)}`,
      )
      .join(' AND ');
    const result = await target.query<{ n: string | number }>(
      `WITH gone AS (
         DELETE FROM ${quoteIdentifier(constraint.child)} c
          WHERE NOT EXISTS (SELECT 1 FROM ${quoteIdentifier(constraint.parent)} p WHERE ${match})
          RETURNING 1
       ) SELECT count(*) AS n FROM gone`,
    );
    removed += Number(result.rows[0]?.n ?? 0);
  }
  return removed;
}

/**
 * Import a snapshot, given as its lines, into `target`.
 *
 * `target` must be one session that is not inside a transaction (a checked-out
 * client): the import opens its own. A snapshot already imported is skipped;
 * one that cannot be imported throws {@link SnapshotRefusedError} and leaves
 * the database as it was.
 */
export async function importViewerSnapshot(
  target: SnapshotQueryable,
  lines: AsyncIterable<string>,
  options: SnapshotImportOptions = {},
): Promise<SnapshotImportSummary> {
  const policy = new Map((options.tables ?? SNAPSHOT_TABLES).map((table) => [table.name, table]));
  const iterator = lines[Symbol.asyncIterator]();
  let lineNumber = 0;
  const nextLine = async (): Promise<string | undefined> => {
    for (;;) {
      const next = await iterator.next();
      if (next.done) return undefined;
      lineNumber += 1;
      if (next.value !== '') return next.value;
    }
  };

  const first = await nextLine();
  if (first === undefined) refuse('The snapshot file is empty');
  const header = readHeader(parseLine(first, lineNumber));

  await target.query(SNAPSHOT_LOG_SCHEMA);
  const seen = await target.query(`SELECT 1 FROM ${SNAPSHOT_LOG_TABLE} WHERE id = $1`, [header.id]);
  if (seen.rows.length > 0) {
    return {
      id: header.id,
      createdAt: header.createdAt,
      skipped: true,
      tables: [],
      orphansRemoved: 0,
    };
  }
  await assertSameSchemaVersions(target, header, [...policy.values()]);

  const tables: { name: string; rows: number; written: number }[] = [];
  await target.query('BEGIN');
  try {
    // Rows are copied exactly as the source holds them: no revision trigger
    // may count the copy as an edit, and no foreign key action may reach from
    // a replaced table into one the viewer owns. Both are what the replica
    // role turns off, for this transaction only.
    await target.query("SET LOCAL session_replication_role = 'replica'");

    let writer: TableWriter | undefined;
    let rows = 0;
    let written = 0;
    let done = false;
    for (let line = await nextLine(); line !== undefined; line = await nextLine()) {
      if (done) refuse('The snapshot has content after its end marker; the file is damaged');
      const value = parseLine(line, lineNumber);
      if (Array.isArray(value)) {
        if (!writer) refuse(`Line ${lineNumber} of the snapshot is a row outside any table`);
        if (await writer.write(value as SnapshotRow)) written += 1;
        rows += 1;
        continue;
      }
      const record = value as Record<string, unknown> | null;
      if (record && typeof record.table === 'string') {
        if (writer) refuse(`${writer.table.name} is not closed before ${record.table} starts`);
        const start = record as unknown as SnapshotTableStart;
        const table = policy.get(start.table);
        if (!table || VIEWER_OWNED_TABLES.has(start.table)) {
          refuse(`The snapshot carries ${start.table}, which a viewer does not import`);
        }
        if (tables.some((entry) => entry.name === start.table)) {
          refuse(`The snapshot carries ${start.table} twice`);
        }
        writer = await openTable(target, table, start);
        rows = 0;
        written = 0;
        continue;
      }
      if (record && typeof record.end === 'string') {
        if (!writer || writer.table.name !== record.end) {
          refuse(`The snapshot closes ${record.end} without having opened it`);
        }
        if (record.rows !== rows) {
          refuse(`${record.end} should have ${String(record.rows)} rows but the file has ${rows}`);
        }
        tables.push({ name: writer.table.name, rows, written });
        writer = undefined;
        continue;
      }
      if (record && record.done === true) {
        if (writer) refuse(`${writer.table.name} is not closed before the end of the snapshot`);
        done = true;
        continue;
      }
      refuse(`Line ${lineNumber} of the snapshot is not something this release understands`);
    }
    if (!done) {
      refuse('The snapshot ends before its end marker: the file is incomplete. Copy it again.');
    }

    const orphansRemoved = await removeOrphans(
      target,
      tables.map((entry) => entry.name).filter((name) => policy.get(name)?.mode === 'replace'),
    );
    await target.query(
      `INSERT INTO ${SNAPSHOT_LOG_TABLE} (id, created_at, tables) VALUES ($1, $2::text::timestamptz, $3::text::jsonb)`,
      [header.id, header.createdAt, JSON.stringify(tables)],
    );
    await target.query('COMMIT');
    return { id: header.id, createdAt: header.createdAt, skipped: false, tables, orphansRemoved };
  } catch (error) {
    await target.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

/** The lines of a gzip-compressed snapshot file. Call `close` when done. */
export function openSnapshotFile(file: string): {
  lines: AsyncIterable<string>;
  close: () => void;
} {
  const input = createReadStream(file);
  const gunzip = createGunzip();
  input.on('error', (error) => gunzip.destroy(error));
  const reader = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  return {
    lines: reader,
    close: () => {
      reader.close();
      input.destroy();
      gunzip.destroy();
    },
  };
}
