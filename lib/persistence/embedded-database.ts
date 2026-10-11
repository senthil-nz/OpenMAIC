/**
 * Fork-only (FORK_CHANGES.md): an embedded database for viewer deployments.
 *
 * `DATABASE_URL=pglite:<directory>` runs PostgreSQL inside the server process
 * (PGlite, PostgreSQL compiled to WebAssembly) with its data in a directory,
 * so a viewer server needs no database service. Every statement the stores
 * issue is the PostgreSQL they already issue; nothing is translated.
 *
 * PGlite is one session, where a node-postgres `Pool` is many. {@link
 * EmbeddedPool} gives that one session the surface the application uses of a
 * pool and takes turns on it: a checked-out client (`connect()`) holds the
 * session until it is released, so the statements of one transaction never
 * interleave with another request's, and a plain `query()` waits for its turn.
 * That is serial execution, which is the price of the single session and fine
 * for a deployment that mostly reads.
 *
 * A caller that holds a client and then awaits a query on the pool itself
 * would wait for its own release. On PostgreSQL that takes a second
 * connection; here it cannot be served, so the wait is bounded
 * ({@link EMBEDDED_LOCK_WAIT_ENV}) and fails with an error naming the cause
 * instead of hanging the request.
 */
import path from 'node:path';

import { Pool, type PoolConfig } from 'pg';

export const EMBEDDED_DATABASE_SCHEME = 'pglite:';
export const EMBEDDED_LOCK_WAIT_ENV = 'OPENMAIC_EMBEDDED_DB_LOCK_WAIT_MS';
const DEFAULT_LOCK_WAIT_MS = 60_000;

/**
 * The data directory a `pglite:` connection string names, resolved against
 * the working directory, or `undefined` for any other connection string.
 * `pglite:./data/viewer-db`, `pglite:///var/lib/openmaic/db` and
 * `pglite:C:\openmaic\db` are all accepted.
 */
export function embeddedDatabaseDirectory(
  connectionString: string | undefined = process.env.DATABASE_URL,
): string | undefined {
  const value = connectionString?.trim();
  if (!value || !value.toLowerCase().startsWith(EMBEDDED_DATABASE_SCHEME)) return undefined;
  let location = value.slice(EMBEDDED_DATABASE_SCHEME.length);
  // `pglite://relative` and `pglite:///absolute`: drop the authority slashes.
  if (location.startsWith('//')) location = location.slice(2);
  if (!location) {
    throw new Error(
      `DATABASE_URL=${EMBEDDED_DATABASE_SCHEME} needs a directory, for example ` +
        `${EMBEDDED_DATABASE_SCHEME}./data/viewer-db`,
    );
  }
  return path.resolve(location);
}

export function embeddedDatabaseConfigured(
  connectionString: string | undefined = process.env.DATABASE_URL,
): boolean {
  return embeddedDatabaseDirectory(connectionString) !== undefined;
}

/** The part of PGlite this module uses. */
interface EmbeddedEngine {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; fields: unknown[]; affectedRows?: number }>;
  exec(
    text: string,
  ): Promise<{ rows: Record<string, unknown>[]; fields: unknown[]; affectedRows?: number }[]>;
  close(): Promise<void>;
}

export type EmbeddedEngineFactory = (directory: string) => Promise<EmbeddedEngine>;

interface EmbeddedQueryResult<TRow> {
  rows: TRow[];
  rowCount: number;
  fields: unknown[];
  command: string;
}

interface Waiter {
  grant: () => void;
  refuse: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
}

interface EmbeddedState {
  directory?: string;
  engine?: Promise<EmbeddedEngine>;
  held: boolean;
  waiters: Waiter[];
}

const STATE_KEY = Symbol.for('openmaic.persistence.embedded-database');
const globalState = globalThis as typeof globalThis & { [key: symbol]: EmbeddedState | undefined };
const state = (globalState[STATE_KEY] ??= { held: false, waiters: [] });

// PostgreSQL type OIDs whose values node-postgres hands over differently from
// PGlite's defaults. The application runs against node-postgres everywhere
// else, so the embedded session answers the same way: 64-bit integers and
// numerics as strings, bytea as a Buffer.
const OID_BYTEA = 17;
const OID_INT8 = 20;
const OID_NUMERIC = 1700;

/** How the embedded session reads values, to match node-postgres. */
export const EMBEDDED_PARSERS: Record<number, (value: string) => unknown> = {
  [OID_INT8]: (value) => value,
  [OID_NUMERIC]: (value) => value,
  [OID_BYTEA]: (value) => Buffer.from(value.slice(2), 'hex'),
};

const defaultEngineFactory: EmbeddedEngineFactory = async (directory) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(directory, { parsers: EMBEDDED_PARSERS });
  await db.waitReady;
  return db as unknown as EmbeddedEngine;
};

function lockWaitMs(): number {
  const raw = process.env[EMBEDDED_LOCK_WAIT_ENV]?.trim();
  if (!raw) return DEFAULT_LOCK_WAIT_MS;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_LOCK_WAIT_MS;
}

/** Wait for the session; the returned function passes it to the next waiter. */
function acquireSession(): Promise<() => void> {
  const release = () => {
    const next = state.waiters.shift();
    if (!next) {
      state.held = false;
      return;
    }
    if (next.timer) clearTimeout(next.timer);
    next.grant();
  };
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    release();
  };
  if (!state.held) {
    state.held = true;
    return Promise.resolve(releaseOnce);
  }
  return new Promise((resolve, reject) => {
    const waitMs = lockWaitMs();
    const waiter: Waiter = {
      grant: () => resolve(releaseOnce),
      refuse: reject,
      timer: undefined,
    };
    waiter.timer = setTimeout(() => {
      const index = state.waiters.indexOf(waiter);
      if (index !== -1) state.waiters.splice(index, 1);
      reject(
        new Error(
          `The embedded database stayed busy for ${waitMs}ms. It serves one statement or ` +
            'transaction at a time; a transaction that waits on a query outside itself can ' +
            `never finish here. Raise ${EMBEDDED_LOCK_WAIT_ENV} if a long operation is expected.`,
        ),
      );
    }, waitMs);
    waiter.timer.unref?.();
    state.waiters.push(waiter);
  });
}

type QueryInput = string | { text: string; values?: unknown[] };

function readQuery(input: QueryInput, params?: unknown[]): { text: string; params?: unknown[] } {
  if (typeof input === 'string') return { text: input, params };
  return { text: input.text, params: params ?? input.values };
}

async function runStatement<TRow>(
  engine: EmbeddedEngine,
  input: QueryInput,
  values?: unknown[],
): Promise<EmbeddedQueryResult<TRow>> {
  const { text, params } = readQuery(input, values);
  // node-postgres sends `undefined` as NULL.
  const bound = params?.map((value) => (value === undefined ? null : value));
  let result;
  try {
    result = await engine.query(text, bound);
  } catch (error) {
    // node-postgres runs several statements in one parameterless query; the
    // extended protocol PGlite's `query` speaks takes one.
    const multiple =
      (error as { code?: unknown } | null)?.code === '42601' &&
      /multiple commands/i.test((error as Error).message) &&
      (bound === undefined || bound.length === 0);
    if (!multiple) throw error;
    const results = await engine.exec(text);
    result = results[results.length - 1] ?? { rows: [], fields: [] };
  }
  return {
    rows: result.rows as TRow[],
    // node-postgres counts the rows a SELECT returned as well.
    rowCount: result.affectedRows || result.rows.length,
    fields: result.fields,
    command: '',
  };
}

export interface EmbeddedClient {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: QueryInput,
    params?: unknown[],
  ): Promise<EmbeddedQueryResult<TRow>>;
  release(): void;
}

/**
 * The surface of a node-postgres `Pool` the application uses, over the one
 * embedded session of this process. Every instance shares that session, so
 * `end()` closes nothing: {@link closeEmbeddedDatabase} does, at shutdown.
 */
export class EmbeddedPool {
  // What `@openmaic/storage` reads to tell a pool from a single connection.
  readonly totalCount = 1;
  readonly idleCount = 1;

  constructor(
    readonly directory: string,
    private readonly engineFactory: EmbeddedEngineFactory = defaultEngineFactory,
  ) {
    if (state.directory !== undefined && state.directory !== directory) {
      throw new Error(
        `The embedded database is already open at ${state.directory}; one process serves one ` +
          `directory (asked for ${directory}).`,
      );
    }
    state.directory = directory;
  }

  get waitingCount(): number {
    return state.waiters.length;
  }

  private engine(): Promise<EmbeddedEngine> {
    if (!state.engine) {
      const opening = this.engineFactory(this.directory);
      state.engine = opening;
      opening.catch(() => {
        if (state.engine === opening) state.engine = undefined;
      });
    }
    return state.engine;
  }

  async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: QueryInput,
    params?: unknown[],
  ): Promise<EmbeddedQueryResult<TRow>> {
    const release = await acquireSession();
    try {
      return await runStatement<TRow>(await this.engine(), text, params);
    } finally {
      release();
    }
  }

  async connect(): Promise<EmbeddedClient> {
    const release = await acquireSession();
    let engine: EmbeddedEngine;
    try {
      engine = await this.engine();
    } catch (error) {
      release();
      throw error;
    }
    let released = false;
    return {
      query: <TRow extends Record<string, unknown>>(text: QueryInput, params?: unknown[]) => {
        if (released) {
          return Promise.reject(new Error('This embedded database client was already released'));
        }
        return runStatement<TRow>(engine, text, params);
      },
      release: () => {
        if (released) return;
        released = true;
        release();
      },
    };
  }

  on(): this {
    return this;
  }

  async end(): Promise<void> {}
}

/**
 * The pool of a connection string: the embedded session for `pglite:`, a
 * node-postgres pool for anything else. Every place that opened a pool from
 * `DATABASE_URL` goes through this.
 */
export function createDatabasePool(connectionString: string, config: PoolConfig = {}): Pool {
  const directory = embeddedDatabaseDirectory(connectionString);
  if (directory !== undefined) return new EmbeddedPool(directory) as unknown as Pool;
  return new Pool({ ...config, connectionString });
}

/** Close the embedded session, once in-flight work has released it. */
export async function closeEmbeddedDatabase(): Promise<void> {
  const opening = state.engine;
  if (!opening) return;
  const release = await acquireSession().catch(() => undefined);
  try {
    state.engine = undefined;
    state.directory = undefined;
    const engine = await opening.catch(() => undefined);
    await engine?.close();
  } finally {
    release?.();
  }
}
