/**
 * Fork-only (FORK_CHANGES.md): write a viewer snapshot from an authoring
 * deployment's database. See `./snapshot-format.ts` for the file.
 *
 * `source` must be one session (a checked-out client, not a pool): the export
 * reads every table inside one REPEATABLE READ transaction, so the snapshot is
 * the database at one moment even while teachers keep working.
 */
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Writable } from 'node:stream';

import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_TABLES,
  SNAPSHOT_VERSION,
  quoteIdentifier,
  readPrimaryKey,
  readSchemaVersions,
  readTableColumns,
  type SnapshotHeader,
  type SnapshotQueryable,
  type SnapshotTable,
  type SnapshotValue,
} from './snapshot-format';

const DEFAULT_BATCH_ROWS = 500;

export interface SnapshotExportSummary {
  readonly id: string;
  readonly tables: { name: string; rows: number }[];
  /** Tables of the list the source database does not have. */
  readonly missing: string[];
}

export interface SnapshotExportOptions {
  readonly tables?: readonly SnapshotTable[];
  readonly onTable?: (name: string, rows: number) => void;
}

async function writeLine(output: Writable, value: unknown): Promise<void> {
  if (!output.write(`${JSON.stringify(value)}\n`)) await once(output, 'drain');
}

async function exportTable(
  source: SnapshotQueryable,
  output: Writable,
  table: SnapshotTable,
): Promise<number | undefined> {
  const columns = (await readTableColumns(source, table.name))?.filter(
    (column) => !column.generated,
  );
  if (!columns) return undefined;
  const primaryKey = await readPrimaryKey(source, table.name);
  if (primaryKey.length === 0) {
    throw new Error(`Table ${table.name} has no primary key; a snapshot cannot carry it`);
  }
  const typeOf = new Map(columns.map((column) => [column.name, column.type]));
  const names = columns.map((column) => column.name);
  await writeLine(output, { table: table.name, columns: names, primaryKey });

  // Every value as text, so the file does not depend on a driver's idea of a
  // type; read in primary key order, a page at a time, so no table has to fit
  // in memory.
  const selectList = names
    .map((name) => `${quoteIdentifier(name)}::text AS ${quoteIdentifier(name)}`)
    .join(', ');
  const keyList = primaryKey.map(quoteIdentifier).join(', ');
  const keyParams = primaryKey
    .map((name, index) => `$${index + 1}::text::${typeOf.get(name)}`)
    .join(', ');
  const limit = table.batchRows ?? DEFAULT_BATCH_ROWS;
  const from = `FROM ${quoteIdentifier(table.name)}`;
  const firstPage = `SELECT ${selectList} ${from} ORDER BY ${keyList} LIMIT ${limit}`;
  const nextPage = `SELECT ${selectList} ${from} WHERE (${keyList}) > (${keyParams}) ORDER BY ${keyList} LIMIT ${limit}`;

  let rows = 0;
  let after: SnapshotValue[] | undefined;
  for (;;) {
    const page = await source.query<Record<string, SnapshotValue>>(
      after ? nextPage : firstPage,
      after,
    );
    for (const row of page.rows) {
      await writeLine(
        output,
        names.map((name) => row[name] ?? null),
      );
    }
    rows += page.rows.length;
    if (page.rows.length < limit) break;
    const last = page.rows[page.rows.length - 1]!;
    after = primaryKey.map((name) => last[name] ?? null);
  }
  await writeLine(output, { end: table.name, rows });
  return rows;
}

/** Write a snapshot of `source` to `output` (uncompressed lines; the caller gzips). */
export async function exportViewerSnapshot(
  source: SnapshotQueryable,
  output: Writable,
  options: SnapshotExportOptions = {},
): Promise<SnapshotExportSummary> {
  const tables = options.tables ?? SNAPSHOT_TABLES;
  const summary: SnapshotExportSummary = { id: randomUUID(), tables: [], missing: [] };
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    // Timestamps are printed with the session's zone; pin it.
    await source.query("SET LOCAL TIME ZONE 'UTC'");
    const header: SnapshotHeader = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      id: summary.id,
      createdAt: new Date().toISOString(),
      migrations: await readSchemaVersions(source),
    };
    await writeLine(output, header);
    for (const table of tables) {
      const rows = await exportTable(source, output, table);
      if (rows === undefined) {
        summary.missing.push(table.name);
        continue;
      }
      summary.tables.push({ name: table.name, rows });
      options.onTable?.(table.name, rows);
    }
    await writeLine(output, { done: true, tables: summary.tables.length });
  } finally {
    await source.query('ROLLBACK');
  }
  return summary;
}
