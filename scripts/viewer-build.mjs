#!/usr/bin/env node
/**
 * Fork-only (FORK_CHANGES.md): build a viewer distribution into dist/viewer.
 *
 *   pnpm viewer:build                    # Docker image + compose file + snapshot
 *   pnpm viewer:build --target folder    # a folder that runs with `node server.js`
 *   pnpm viewer:build --skip-snapshot    # the application only
 *   pnpm viewer:build --skip-app         # a fresh snapshot only (same as viewer:export)
 *
 * The Docker target is the one to use for a server of another operating
 * system than this machine (the image is Linux whatever builds it). The folder
 * target contains native modules of the machine that built it, so build it on
 * the same operating system and CPU as the server. See VIEWER_DEPLOYMENT.md.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT_NAME = 'viewer-snapshot.ndjson.gz';
const IMAGE_ARCHIVE = 'openmaic-viewer-image.tar';
// Inside dist/, which git, Docker and the TypeScript build already ignore.
const FOLDER_DIST_DIR = 'dist/viewer-next';
/** Compiled into the browser bundle, so they are passed to the image build. */
const BUILD_TIME_VARIABLES = [
  'ALLOWED_FRAME_ANCESTORS',
  'NEXT_PUBLIC_MAIC_EDITOR_ENABLED',
  'NEXT_PUBLIC_MAIC_EDITOR_RENDERER_ENABLED',
  'NEXT_PUBLIC_MAIC_PLAYBACK_RENDERER_ENABLED',
  'NEXT_PUBLIC_PI_CHAT_ENABLED',
  'NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED',
  'NEXT_PUBLIC_SHOW_VOCATIONAL_TEST_UI',
  'NEXT_PUBLIC_ENABLE_VIDEO_EXPORT',
  'NEXT_PUBLIC_VIDEO_EXPORT_CTA_DESTINATION',
  'NEXT_PUBLIC_ENABLE_PPTX_IMPORT',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
];

function readArguments(argv) {
  const options = {
    target: 'docker',
    out: 'dist/viewer',
    image: 'openmaic-viewer',
    snapshot: true,
    app: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-snapshot') options.snapshot = false;
    else if (argument === '--skip-app') options.app = false;
    else if (argument === '--target' || argument === '--out' || argument === '--image') {
      const value = argv[index + 1];
      if (!value) throw new Error(`${argument} needs a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(
        `Unknown argument ${argument}. Usage: pnpm viewer:build [--target docker|folder] ` +
          '[--out <directory>] [--image <name>] [--skip-snapshot] [--skip-app]',
      );
    }
  }
  if (options.target !== 'docker' && options.target !== 'folder') {
    throw new Error('--target is docker or folder');
  }
  return options;
}

function run(command, args, env = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args[0] ?? ''} failed with exit code ${result.status}`);
  }
}

function runNode(script, args = [], env = {}) {
  run(process.execPath, [path.join(root, script), ...args], env);
}

function buildDockerImage(out, image) {
  const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const buildArguments = BUILD_TIME_VARIABLES.filter((name) => process.env[name]).flatMap(
    (name) => ['--build-arg', `${name}=${process.env[name]}`],
  );
  run('docker', [
    'build',
    ...buildArguments,
    '-t',
    `${image}:latest`,
    '-t',
    `${image}:${version}`,
    '.',
  ]);
  run('docker', ['save', '-o', path.join(out, IMAGE_ARCHIVE), `${image}:latest`]);
  cpSync(path.join(root, 'docker-compose.viewer.yml'), path.join(out, 'docker-compose.yml'));
}

function buildFolder(out) {
  const env = { OPENMAIC_DIST_DIR: FOLDER_DIST_DIR, NODE_ENV: 'production' };
  // The steps of `pnpm build`, into a build directory of their own.
  runNode('scripts/assert-vendor-maic-importer.mjs');
  runNode('scripts/build-standalone-player.mjs');
  runNode('node_modules/next/dist/bin/next', ['build'], env);

  // Assembled in place first: the standalone tree, the static assets it
  // serves and the public directory, as the Dockerfile lays them out.
  const built = path.join(root, FOLDER_DIST_DIR);
  const standalone = path.join(built, 'standalone');
  // Links are copied as links: the standalone tree relies on pnpm's layout,
  // where a package resolved through two paths must stay one module.
  const copy = { recursive: true, verbatimSymlinks: true };
  cpSync(path.join(built, 'static'), path.join(standalone, FOLDER_DIST_DIR, 'static'), copy);
  cpSync(path.join(root, 'public'), path.join(standalone, 'public'), copy);
  // The build traces files of this checkout into the standalone tree. What
  // belongs to this authoring deployment must not travel to a public server:
  // its model configuration (which may hold keys) and its data directory. The
  // Docker target leaves them out through .dockerignore.
  for (const entry of readdirSync(standalone)) {
    if (entry === 'openmaic.yml' || entry === 'data' || entry.startsWith('.env')) {
      rmSync(path.join(standalone, entry), { recursive: true, force: true });
    }
  }
  mkdirSync(path.join(standalone, 'data'), { recursive: true });

  if (process.platform === 'win32') {
    // On Windows the standalone tree links into this checkout's node_modules
    // (directory junctions hold absolute paths), so it runs only here and
    // cannot be copied to a server.
    console.warn(
      `\nWindows: the folder build stays at ${standalone} and runs only on this machine ` +
        '(for a local check). Build the distribution for a server with --target docker.',
    );
    return { app: standalone, portable: false };
  }
  const app = path.join(out, 'app');
  rmSync(app, { recursive: true, force: true });
  cpSync(standalone, app, copy);
  return { app, portable: true };
}

function main() {
  const options = readArguments(process.argv.slice(2));
  const out = path.resolve(root, options.out);
  mkdirSync(out, { recursive: true });

  let app = path.join(out, 'app');
  let portable = true;
  if (options.app) {
    if (options.target === 'docker') buildDockerImage(out, options.image);
    else ({ app, portable } = buildFolder(out));
  }
  const snapshotFile =
    options.target === 'docker'
      ? path.join(out, 'snapshot', SNAPSHOT_NAME)
      : path.join(app, 'data', SNAPSHOT_NAME);
  mkdirSync(path.dirname(snapshotFile), { recursive: true });
  cpSync(path.join(root, 'viewer.env.example'), path.join(out, 'env.example'));
  cpSync(path.join(root, 'VIEWER_DEPLOYMENT.md'), path.join(out, 'VIEWER_DEPLOYMENT.md'));

  if (options.snapshot) {
    runNode('node_modules/tsx/dist/cli.mjs', ['scripts/viewer-export.ts', '--out', snapshotFile]);
    if (!existsSync(snapshotFile)) {
      throw new Error(`The snapshot was not written to ${snapshotFile}`);
    }
  }

  const contents =
    options.target === 'docker'
      ? [
          `${IMAGE_ARCHIVE}      the application image: docker load -i ${IMAGE_ARCHIVE}`,
          'docker-compose.yml               docker compose up -d',
          `snapshot/${SNAPSHOT_NAME}   the course content, imported at start`,
        ]
      : [
          `${path.relative(out, app) || '.'}   the application: node server.js` +
            (portable ? '' : ' (this machine only, not for a server)'),
          `data/${SNAPSHOT_NAME} inside it is the course content, imported at start`,
        ];
  writeFileSync(
    path.join(out, 'README.txt'),
    [
      'OpenMAIC viewer distribution',
      `Built ${new Date().toISOString()}, target ${options.target}.`,
      '',
      ...contents,
      'env.example                      copy to .env and set OPENMAIC_SESSION_SECRET',
      'VIEWER_DEPLOYMENT.md             how to install and update',
      '',
    ].join('\n'),
  );
  console.log(`\nViewer distribution written to ${out}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
