# Viewer deployment

Fork-only (see [FORK_CHANGES.md](FORK_CHANGES.md)). This describes running OpenMAIC as two servers:

- **Authoring server** — on the local network, with PostgreSQL. Teachers and admins create courses and manage accounts here. Students may use it too.
- **Viewer server** — public, in the cloud. It only shows courses. It has no database service: its data is an embedded database (PGlite, PostgreSQL running inside the Node.js process) in one directory.

Content moves one way, as a file. The authoring server exports a **snapshot**; the viewer imports it when it starts. The viewer never connects to the authoring server.

```
authoring server (LAN)                        viewer server (cloud)
PostgreSQL ── pnpm viewer:export ──► viewer-snapshot.ndjson.gz ──► imported at start
                                                                   embedded database
                                                                   + learner data (kept)
```

## What a snapshot carries, and what stays on the viewer

| Carried from the authoring server | Kept on the viewer, never overwritten |
|---|---|
| Courses, scenes, outlines, folders | Learner progress and chat history |
| Course visibility (public or private) and owners | Login sessions |
| Media stored in the database | Model settings saved on the viewer |
| Accounts: usernames, roles, password hashes | |
| Course agents | |

Each import replaces the course content with exactly what the snapshot holds and leaves the right-hand column alone. So after an update:

- a course deleted on the authoring server is gone from the viewer;
- an account disabled or removed on the authoring server can no longer log in on the viewer;
- every learner's progress on the viewer is still there.

Things to know:

- **Private courses are in the snapshot.** The viewer shows them only to logged-in accounts, as the authoring server does, but the data is on the public server. Do not ship a snapshot containing courses that must never leave the local network.
- **Accounts are managed on the authoring server only.** The viewer refuses user management, and an account created only on the viewer would be removed by the next import.
- **Learner data does not flow back.** Progress made on the viewer stays on the viewer; progress made on the authoring server stays there.
- **Model settings and provider keys are not in the snapshot.** The viewer gets its models from its own `openmaic.yml`.
- **Media in S3 is not in the snapshot.** If the authoring server sets `ASSET_S3_BUCKET`, give the viewer the same bucket settings (read access is enough).
- **Courses from before server storage** that still live as files in `data/classrooms` are not carried. Open and save them on the authoring server first.

## Requirements

- Authoring machine: this repository installed (`pnpm install`), its PostgreSQL running, and Docker for the Docker distribution.
- Viewer server: Docker with the Compose plugin (or Node.js 22 for the folder distribution) and about 1 GB of RAM. The server used 420 to 470 MB with a small library in testing (the embedded database is roughly 300 MB of that), and the database takes 5 to 15 seconds to open at start. The image file is about 650 MB. Disk: the size of your courses and media, plus about 100 MB.
- HTTPS in front of the viewer (a reverse proxy with a certificate). Login cookies are marked `Secure`, so logins do not work over plain HTTP except on `localhost` (see `COOKIE_SECURE` in `viewer.env.example`).

## 1. Build the distribution (authoring machine)

Start the authoring server once on the current code before building, so its database is migrated to this release.

```bash
pnpm viewer:build
```

This writes `dist/viewer/`:

| File | Purpose |
|---|---|
| `openmaic-viewer-image.tar` | The application as a Docker image (Linux) |
| `docker-compose.yml` | Runs the viewer |
| `snapshot/viewer-snapshot.ndjson.gz` | The course content |
| `env.example` | Settings to copy to `.env` |

Build-time switches (`NEXT_PUBLIC_*`, `ALLOWED_FRAME_ANCESTORS`) are compiled into the application; set them in the shell before `pnpm viewer:build` if you use any.

### Without Docker

```bash
pnpm viewer:build --target folder
```

writes `dist/viewer/app/`, which runs with `node server.js`. It contains native modules for the machine that built it, so build it on the same operating system and CPU as the viewer server (a Windows build does not run on Linux). Building needs several GB of RAM; do not build on a low-spec viewer server.

On Windows the folder build cannot be copied anywhere: its modules are links into this checkout. It stays at `dist/viewer-next/standalone/` and is only good for checking the viewer on the build machine. Use the Docker distribution for a server.

## 2. Install the viewer (viewer server, first time)

Copy `dist/viewer/` to the server, then in that directory:

```bash
docker load -i openmaic-viewer-image.tar
cp env.example .env
# edit .env: set OPENMAIC_SESSION_SECRET (required)
docker compose up -d
docker compose logs -f viewer
```

On a fresh Ubuntu server (a GCP VM, for example), install Docker first and copy the distribution up from the authoring machine:

```bash
# on the server, once
sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker $USER      # log out and in again

# on the authoring machine
scp -r dist/viewer <user>@<server>:~/openmaic-viewer
```

The log shows the import and then the server is ready:

```
[viewer] Embedded database ready in 9626ms.
[viewer] Imported snapshot 88200d44-... (2026-10-11T08:25:39.338Z): 64 rows in 14 tables, 940ms.
[viewer] Viewer mode is on: background workers are not started.
```

The site listens on port 3000 (`OPENMAIC_PORT` changes it). Point your HTTPS reverse proxy at it.

For the folder distribution: copy `env.example` values into the environment (uncomment the "Folder distribution only" block), then run `node server.js` in `app/`. The snapshot is read from `app/data/viewer-snapshot.ndjson.gz` and the database is created in `app/data/viewer-db`.

### Class chat and quiz grading (optional)

Guests watch courses without any AI model. Logged-in accounts can also use class chat, quiz grading and speech, which call a model. To offer those, put an `openmaic.yml` beside `docker-compose.yml`, uncomment its mount in `docker-compose.yml`, and set the keys it names in `.env`. Without it those features answer with an error and everything else works.

## 3. Update the content

On the authoring machine:

```bash
pnpm viewer:export
```

writes `viewer-snapshot.ndjson.gz` in the repository root (`--out <file>` for another place). Copy it over the old one on the viewer server and restart:

```bash
# on the viewer server, in the distribution directory
cp /path/to/new/viewer-snapshot.ndjson.gz snapshot/viewer-snapshot.ndjson.gz
docker compose restart viewer
docker compose logs --tail 20 viewer
```

The viewer is offline for the restart (seconds for a small library; longer the first time large media arrives, since media already imported is not written again).

An import is all-or-nothing. If the file is incomplete or damaged, or was exported from a different release, the log says why and the viewer keeps serving the content it had:

```
[viewer] Could not import the snapshot at ...; the viewer keeps the content it had. The snapshot ends before its end marker: the file is incomplete. Copy it again.
```

A snapshot is imported once; restarting with the same file does nothing.

## 4. Update the application

When the code changes (a new release, or new fork changes):

1. Update and start the authoring server on the new code, so its database is migrated.
2. Run `pnpm viewer:build` again and copy `openmaic-viewer-image.tar` and `snapshot/viewer-snapshot.ndjson.gz` to the viewer server.
3. On the viewer server:

   ```bash
   docker load -i openmaic-viewer-image.tar
   docker compose up -d
   ```

The new application migrates the embedded database when it starts, then imports the new snapshot. Learner data stays in the `openmaic-viewer-data` volume throughout. Always ship the application and the snapshot from the same release: a snapshot from a different schema version is refused.

## Backup

Everything the viewer owns is in the `openmaic-viewer-data` volume (`app/data/` in the folder distribution). Back it up with the container stopped:

```bash
docker compose stop viewer
docker run --rm -v openmaic-viewer_openmaic-viewer-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/viewer-data.tar.gz -C /data .
docker compose start viewer
```

`docker compose down -v` deletes the volume, and with it all learner data.

## Settings

| Variable | Where | Meaning |
|---|---|---|
| `DATABASE_URL=pglite:<directory>` | viewer | Use the embedded database in `<directory>`. Refused unless the next two are on. |
| `OPENMAIC_VIEWER_MODE=true` | viewer | No creating, editing, publishing, settings or user management. |
| `OPENMAIC_ACCOUNTS_ENABLED=true` | viewer | Logins; viewer mode is enforced by the account gate. |
| `OPENMAIC_SESSION_SECRET` | viewer | Signs login cookies; 32+ random characters. |
| `OPENMAIC_VIEWER_SNAPSHOT` | viewer | The snapshot file to import at start. Default `data/viewer-snapshot.ndjson.gz`. |
| `OPENMAIC_EMBEDDED_DB_LOCK_WAIT_MS` | viewer | How long a statement waits for the embedded database before failing. Default 60000. |

`docker-compose.viewer.yml` sets the first three and the snapshot path for you.

## Limits

- The embedded database serves one statement or transaction at a time. That suits a site that mostly reads; it is not meant for hundreds of learners writing at once. If the viewer outgrows it, point `DATABASE_URL` at a PostgreSQL server instead: the snapshot import only runs on the embedded database, so load content there with `pg_dump`/`pg_restore`.
- One viewer process per data directory. Do not run two containers on the same volume.
- Live course-update notifications are off on the viewer; pages pick up new content on their next load after an import.
