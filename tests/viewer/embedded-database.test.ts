import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMBEDDED_LOCK_WAIT_ENV,
  EMBEDDED_PARSERS,
  EmbeddedPool,
  closeEmbeddedDatabase,
  createDatabasePool,
  embeddedDatabaseDirectory,
} from '@/lib/persistence/embedded-database';
import { assertEmbeddedDatabaseConfiguration } from '@/lib/server/viewer/embedded-boot';

// Each test opens an embedded PostgreSQL, which takes seconds on a busy machine.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 120_000 });

const inMemory = async () => {
  const db = new PGlite({ parsers: EMBEDDED_PARSERS });
  await db.waitReady;
  return db as never;
};

describe('embedded database connection strings', () => {
  it('reads the directory of a pglite: connection string', () => {
    expect(embeddedDatabaseDirectory('postgres://u:p@localhost/db')).toBeUndefined();
    expect(embeddedDatabaseDirectory(undefined)).toBeUndefined();
    expect(embeddedDatabaseDirectory('pglite:./data/viewer-db')).toMatch(/data[\\/]viewer-db$/);
    expect(embeddedDatabaseDirectory(' PGLITE://data/viewer-db ')).toMatch(/data[\\/]viewer-db$/);
    expect(() => embeddedDatabaseDirectory('pglite:')).toThrow(/needs a directory/);
  });

  it('opens a node-postgres pool for anything else', async () => {
    const pool = createDatabasePool('postgres://u:p@127.0.0.1:1/none', { max: 1 });
    expect(pool).not.toBeInstanceOf(EmbeddedPool);
    await pool.end();
  });

  it('is refused outside a viewer deployment', () => {
    const viewer = {
      DATABASE_URL: 'pglite:./data/viewer-db',
      OPENMAIC_VIEWER_MODE: 'true',
      OPENMAIC_ACCOUNTS_ENABLED: 'true',
    };
    expect(() => assertEmbeddedDatabaseConfiguration(viewer)).not.toThrow();
    expect(() =>
      assertEmbeddedDatabaseConfiguration({ ...viewer, OPENMAIC_VIEWER_MODE: undefined }),
    ).toThrow(/OPENMAIC_VIEWER_MODE=true/);
    expect(() =>
      assertEmbeddedDatabaseConfiguration({ ...viewer, OPENMAIC_ACCOUNTS_ENABLED: 'false' }),
    ).toThrow(/OPENMAIC_ACCOUNTS_ENABLED=true/);
    expect(() =>
      assertEmbeddedDatabaseConfiguration({ DATABASE_URL: 'postgres://u:p@localhost/db' }),
    ).not.toThrow();
  });
});

describe('EmbeddedPool', () => {
  let pool: EmbeddedPool;

  beforeEach(async () => {
    pool = new EmbeddedPool('test-directory', inMemory);
    await pool.query('CREATE TABLE t (id TEXT PRIMARY KEY, n BIGINT, b BYTEA, data JSONB)');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await closeEmbeddedDatabase();
  });

  it('answers values the way node-postgres does', async () => {
    await pool.query('INSERT INTO t (id, n, b, data) VALUES ($1, $2, $3, $4::jsonb)', [
      'a',
      '9007199254740993',
      Buffer.from('bytes'),
      JSON.stringify({ k: [1, 2] }),
    ]);
    const result = await pool.query<{ n: unknown; b: unknown; data: unknown; total: unknown }>(
      'SELECT n, b, data, count(*) OVER () AS total FROM t',
    );
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]!.n).toBe('9007199254740993');
    expect(result.rows[0]!.total).toBe('1');
    expect(Buffer.isBuffer(result.rows[0]!.b)).toBe(true);
    expect((result.rows[0]!.b as Buffer).toString()).toBe('bytes');
    expect(result.rows[0]!.data).toEqual({ k: [1, 2] });

    const updated = await pool.query('UPDATE t SET n = 1 WHERE id = ANY($1::text[])', [['a', 'z']]);
    expect(updated.rowCount).toBe(1);
    expect(
      (await pool.query({ text: 'SELECT id FROM t WHERE id = $1', values: ['a'] })).rows,
    ).toEqual([{ id: 'a' }]);
    // `undefined` is NULL, as node-postgres sends it.
    await pool.query('INSERT INTO t (id, n) VALUES ($1, $2)', ['b', undefined]);
    expect((await pool.query("SELECT n FROM t WHERE id = 'b'")).rows[0]).toEqual({ n: null });
  });

  it('runs several statements in one parameterless query', async () => {
    await pool.query("INSERT INTO t (id) VALUES ('x'); INSERT INTO t (id) VALUES ('y')");
    expect((await pool.query('SELECT count(*) AS n FROM t')).rows[0]).toEqual({ n: '2' });
  });

  it('keeps other statements out of a transaction until it is released', async () => {
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query("INSERT INTO t (id) VALUES ('in-transaction')");

    let answered = false;
    const outside = pool.query<{ n: string }>('SELECT count(*) AS n FROM t').then((result) => {
      answered = true;
      return result.rows[0]!.n;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(answered).toBe(false);
    expect(pool.waitingCount).toBe(1);

    await client.query('ROLLBACK');
    client.release();
    // The waiting statement ran after the rollback, not inside the transaction.
    await expect(outside).resolves.toBe('0');
    await expect(client.query('SELECT 1')).rejects.toThrow(/already released/);
  });

  it('serves waiting clients in order', async () => {
    const order: string[] = [];
    const first = await pool.connect();
    const second = pool.connect().then(async (client) => {
      order.push('second');
      client.release();
    });
    const third = pool.query('SELECT 1').then(() => order.push('third'));
    order.push('first');
    first.release();
    await Promise.all([second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('fails a statement that waits on a transaction that never ends', async () => {
    vi.stubEnv(EMBEDDED_LOCK_WAIT_ENV, '40');
    const client = await pool.connect();
    await expect(pool.query('SELECT 1')).rejects.toThrow(/stayed busy for 40ms/);
    // The timed-out waiter left the queue; the session is still usable.
    expect(pool.waitingCount).toBe(0);
    client.release();
    await expect(pool.query('SELECT 1 AS one')).resolves.toMatchObject({ rows: [{ one: 1 }] });
  });

  it('shares one session between pools and refuses a second directory', async () => {
    const other = new EmbeddedPool('test-directory', inMemory);
    await other.end();
    expect((await other.query('SELECT count(*) AS n FROM t')).rows[0]).toEqual({ n: '0' });
    expect(() => new EmbeddedPool('another-directory', inMemory)).toThrow(/already open/);
  });
});
