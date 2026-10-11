import { PassThrough } from 'node:stream';

import { PGlite } from '@electric-sql/pglite';
import { ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { ensureDocumentSchema } from '@openmaic/storage/document/pg';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import { ensureSchema as ensureRuntimeSchema } from '@openmaic/storage/runtime/pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMBEDDED_PARSERS } from '@/lib/persistence/embedded-database';
import { ensureStageMetaSchema } from '@/lib/persistence/stage-meta';
import { ACCOUNTS_MIGRATIONS } from '@/lib/server/accounts/store';
import { ensureOwnerAgentSchema } from '@/lib/server/agents/store';
import { exportViewerSnapshot } from '@/lib/server/viewer/snapshot-export';
import { SNAPSHOT_TABLES, VIEWER_OWNED_TABLES } from '@/lib/server/viewer/snapshot-format';
import { SnapshotRefusedError, importViewerSnapshot } from '@/lib/server/viewer/snapshot-import';

// Each test opens an embedded PostgreSQL, which takes seconds on a busy machine.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 });

/** A database with the schema a deployment provisions for the carried tables. */
async function createDatabase(): Promise<PGlite> {
  const db = new PGlite({ parsers: EMBEDDED_PARSERS });
  await db.waitReady;
  await ensureRuntimeSchema(db);
  await ensureDocumentSchema(db);
  await ensureStageMetaSchema(db);
  await ensureAssetSchema(db);
  await ensureOwnerAgentSchema(db);
  await applySchemaMigrations(db, ACCOUNTS_MIGRATIONS);
  return db;
}

async function addCourse(db: PGlite, id: string, name: string, scenes: number): Promise<void> {
  await db.query(
    `INSERT INTO document_stages (id, name, created_at, updated_at, data)
     VALUES ($1, $2, 1, 2, $3::jsonb)`,
    [id, name, JSON.stringify({ id, name, note: 'quote " and \\ backslash, ünïcode' })],
  );
  for (let index = 0; index < scenes; index += 1) {
    await db.query(
      `INSERT INTO document_scenes (stage_id, id, scene_order, data) VALUES ($1, $2, $3, $4::jsonb)`,
      [id, `scene-${index}`, index, JSON.stringify({ title: `Scene ${index}` })],
    );
  }
  await db.query(
    `INSERT INTO stage_meta (stage_id, owner_id, is_public) VALUES ($1, 'user:teacher', true)`,
    [id],
  );
}

async function addAccount(db: PGlite, id: string, role: string): Promise<void> {
  await db.query(
    `INSERT INTO account_users (id, username, display_name, password_hash, role)
     VALUES ($1, $1, $1, 'hash', $2)`,
    [id, role],
  );
}

async function exportLines(source: PGlite): Promise<string[]> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(chunk));
  await exportViewerSnapshot(source, output);
  output.end();
  return Buffer.concat(chunks).toString('utf8').split('\n');
}

async function* linesOf(lines: string[]): AsyncGenerator<string> {
  yield* lines;
}

async function column(db: PGlite, sql: string): Promise<unknown[]> {
  const result = await db.query<Record<string, unknown>>(sql);
  return result.rows.map((row) => Object.values(row)[0]);
}

describe('viewer snapshot', () => {
  let source: PGlite;
  let target: PGlite;

  beforeEach(async () => {
    source = await createDatabase();
    target = await createDatabase();
  });

  afterEach(async () => {
    await source.close();
    await target.close();
  });

  it('never carries a table the viewer owns', () => {
    for (const table of SNAPSHOT_TABLES) expect(VIEWER_OWNED_TABLES.has(table.name)).toBe(false);
  });

  it('copies content exactly and leaves learner data alone', async () => {
    await addCourse(source, 'algebra', 'Algebra', 3);
    await addCourse(source, 'biology', 'Biology', 1);
    await addAccount(source, 'student-1', 'student');
    const bytes = Buffer.from([0, 1, 2, 254, 255]);
    await source.query(
      `INSERT INTO asset_blobs (content_hash, byte_size, bytes) VALUES ('hash-1', 5, $1)`,
      [bytes],
    );

    // What the viewer already has: an old course, a learner's progress, a
    // login session of an account that stays and one of an account that is
    // gone from the authoring deployment.
    await addCourse(target, 'retired', 'Retired course', 2);
    await addAccount(target, 'student-1', 'student');
    await addAccount(target, 'removed', 'student');
    await target.query(
      `INSERT INTO account_sessions (id, user_id, expires_at)
       VALUES ('s-kept', 'student-1', now() + interval '1 day'),
              ('s-gone', 'removed', now() + interval '1 day')`,
    );
    await target.query(
      `INSERT INTO runtime_sessions (id, stage_id, learner_key, kind, status, created_at, updated_at, data)
       VALUES ('progress-1', 'algebra', 'user:student-1', 'playback', 'active', 't', 't', '{"at":7}'::jsonb)`,
    );
    const revisionsBefore = await column(
      source,
      'SELECT rev FROM document_stage_revision ORDER BY 1',
    );

    const summary = await importViewerSnapshot(target, linesOf(await exportLines(source)));

    expect(summary.skipped).toBe(false);
    expect(summary.orphansRemoved).toBe(1);
    expect(await column(target, 'SELECT id FROM document_stages ORDER BY id')).toEqual([
      'algebra',
      'biology',
    ]);
    expect(await column(target, 'SELECT count(*) FROM document_scenes')).toEqual(['4']);
    expect(await column(target, "SELECT data FROM document_stages WHERE id = 'algebra'")).toEqual(
      await column(source, "SELECT data FROM document_stages WHERE id = 'algebra'"),
    );
    // The copy is not an edit: revision counters arrive as they were.
    expect(await column(target, 'SELECT rev FROM document_stage_revision ORDER BY 1')).toEqual(
      revisionsBefore,
    );
    expect(await column(target, 'SELECT bytes FROM asset_blobs')).toEqual([bytes]);
    expect(await column(target, 'SELECT id FROM account_users ORDER BY id')).toEqual(['student-1']);
    // Learner data survives; the session of the removed account went with it.
    expect(await column(target, 'SELECT data FROM runtime_sessions')).toEqual([{ at: 7 }]);
    expect(await column(target, 'SELECT id FROM account_sessions')).toEqual(['s-kept']);
  });

  it('imports a snapshot once, and a newer one over it', async () => {
    await addCourse(source, 'algebra', 'Algebra', 1);
    const first = await exportLines(source);
    expect((await importViewerSnapshot(target, linesOf(first))).skipped).toBe(false);
    expect((await importViewerSnapshot(target, linesOf(first))).skipped).toBe(true);

    await source.query("UPDATE document_stages SET name = 'Algebra II' WHERE id = 'algebra'");
    await source.query(
      `INSERT INTO asset_blobs (content_hash, byte_size, bytes) VALUES ('hash-1', 1, '\\x01')`,
    );
    const second = await exportLines(source);
    await importViewerSnapshot(target, linesOf(second));
    expect(await column(target, 'SELECT name FROM document_stages')).toEqual(['Algebra II']);

    // A blob the viewer already holds is not written again.
    await source.query("UPDATE document_stages SET name = 'Algebra III' WHERE id = 'algebra'");
    const third = await importViewerSnapshot(target, linesOf(await exportLines(source)));
    expect(third.tables.find((table) => table.name === 'asset_blobs')).toMatchObject({
      rows: 1,
      written: 0,
    });
  });

  it('changes nothing when the file is cut short', async () => {
    await addCourse(target, 'kept', 'Kept', 1);
    await addCourse(source, 'algebra', 'Algebra', 2);
    const lines = (await exportLines(source)).filter((line) => line !== '');
    const cut = lines.slice(0, lines.length - 3);

    await expect(importViewerSnapshot(target, linesOf(cut))).rejects.toBeInstanceOf(
      SnapshotRefusedError,
    );
    expect(await column(target, 'SELECT id FROM document_stages')).toEqual(['kept']);
    // The same snapshot, complete, still imports afterwards.
    expect((await importViewerSnapshot(target, linesOf(lines))).skipped).toBe(false);
    expect(await column(target, 'SELECT id FROM document_stages')).toEqual(['algebra']);
  });

  it('refuses a snapshot of another schema version or with a table it does not import', async () => {
    await addCourse(source, 'algebra', 'Algebra', 1);
    const lines = await exportLines(source);

    const header = JSON.parse(lines[0]!) as { migrations: { store: string; version: number }[] };
    const ahead = {
      ...header,
      migrations: header.migrations.map((row) =>
        row.store === 'document' ? { ...row, version: row.version + 1 } : row,
      ),
    };
    await expect(
      importViewerSnapshot(target, linesOf([JSON.stringify(ahead), ...lines.slice(1)])),
    ).rejects.toThrow(/different schema versions: document/);

    const foreign = [
      lines[0]!,
      JSON.stringify({ table: 'runtime_sessions', columns: ['id'], primaryKey: ['id'] }),
      JSON.stringify({ end: 'runtime_sessions', rows: 0 }),
      JSON.stringify({ done: true, tables: 1 }),
    ];
    await expect(importViewerSnapshot(target, linesOf(foreign))).rejects.toThrow(
      /a viewer does not import/,
    );
    await expect(importViewerSnapshot(target, linesOf(['{"format":"other"}']))).rejects.toThrow(
      /not an OpenMAIC viewer snapshot/,
    );
  });
});
