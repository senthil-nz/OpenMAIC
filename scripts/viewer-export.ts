/**
 * Fork-only (FORK_CHANGES.md): export a viewer snapshot from this authoring
 * deployment's PostgreSQL database.
 *
 *   pnpm viewer:export                      # writes viewer-snapshot.ndjson.gz
 *   pnpm viewer:export --out path/to/file   # another place
 *   pnpm viewer:export --database-url postgres://...
 *
 * The database is DATABASE_URL from the environment or .env.local. Copy the
 * file to the viewer server as data/viewer-snapshot.ndjson.gz and restart the
 * viewer; it imports the snapshot as it starts. See VIEWER_DEPLOYMENT.md.
 */
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import { Client } from 'pg';

import { EMBEDDED_DATABASE_SCHEME } from '../lib/persistence/embedded-database';
import { exportViewerSnapshot } from '../lib/server/viewer/snapshot-export';

const DEFAULT_OUTPUT = 'viewer-snapshot.ndjson.gz';

function readArguments(argv: string[]): { out: string; databaseUrl?: string } {
  let out = DEFAULT_OUTPUT;
  let databaseUrl: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--out' || argument === '--database-url') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} needs a value`);
      if (argument === '--out') out = value;
      else databaseUrl = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument ${argument}. Usage: pnpm viewer:export [--out <file>]`);
  }
  return { out, databaseUrl };
}

async function main(): Promise<void> {
  const { out, databaseUrl: fromArgument } = readArguments(process.argv.slice(2));
  if (!fromArgument && !process.env.DATABASE_URL?.trim() && existsSync('.env.local')) {
    process.loadEnvFile('.env.local');
  }
  const databaseUrl = (fromArgument ?? process.env.DATABASE_URL)?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set (environment, .env.local or --database-url).');
  }
  if (databaseUrl.toLowerCase().startsWith(EMBEDDED_DATABASE_SCHEME)) {
    throw new Error(
      'DATABASE_URL names an embedded viewer database. Export from the authoring ' +
        "deployment's PostgreSQL database.",
    );
  }

  const file = path.resolve(out);
  const partial = `${file}.partial`;
  await mkdir(path.dirname(file), { recursive: true });

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const gzip = createGzip();
    const written = pipeline(gzip, createWriteStream(partial));
    const summary = await exportViewerSnapshot(client, gzip, {
      onTable: (name, rows) => console.log(`  ${name}: ${rows} rows`),
    });
    gzip.end();
    await written;
    // Renamed only when complete, so a failed export never leaves a file that
    // looks like a snapshot.
    await rename(partial, file);
    for (const name of summary.missing) {
      console.log(`  ${name}: not in this database, skipped`);
    }
    const { size } = await stat(file);
    console.log(`Snapshot ${summary.id} written to ${file} (${(size / 1024).toFixed(1)} KiB).`);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
