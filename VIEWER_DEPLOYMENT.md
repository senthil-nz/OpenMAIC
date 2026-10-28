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

writes `dist/viewer/app/` (runs with `node server.js`), `snapshot/`, `env.example`, a systemd service file and a Caddy configuration. It contains native modules for the machine that built it, so build it on Linux with the same CPU type as the viewer server and a glibc no newer than the server's (build on Ubuntu 22.04 for a 22.04 or 24.04 server). Building needs several GB of RAM; do not build on a low-spec viewer server. Leave the snapshot out of the build (`--skip-snapshot`) when the build machine cannot reach the authoring database, and export it there with `pnpm viewer:export --out dist/viewer/snapshot/viewer-snapshot.ndjson.gz`.

On Windows, build it inside WSL (Ubuntu): a folder built by Windows itself cannot be copied anywhere, because its modules are links into the checkout. It stays at `dist/viewer-next/standalone/` and is only good for checking the viewer on the build machine.

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

`openmaic.yml` in the distribution directory sets the narration voices; `docker-compose.yml` mounts it. Keep it there: without it lessons play silently (see "Narration, class chat and quiz grading" below).

The log shows the import and then the server is ready:

```
[viewer] Embedded database ready in 9626ms.
[viewer] Imported snapshot 88200d44-... (2026-10-11T08:25:39.338Z): 64 rows in 14 tables, 940ms.
[viewer] Viewer mode is on: background workers are not started.
```

The site listens on port 3000 (`OPENMAIC_PORT` changes it). Point your HTTPS reverse proxy at it.

### Ubuntu without Docker (small servers such as an e2-micro)

Docker costs roughly 100 MB of RAM, which matters on a 1 GB server. The folder distribution runs on Node.js directly, as a systemd service behind Caddy. Layout on the server:

| Path | Contents |
|---|---|
| `/opt/node` | Node.js 22 |
| `/opt/openmaic-viewer/app` | The application; replaced on each update |
| `/opt/openmaic-viewer/data` | The embedded database and the snapshot; kept |
| `/opt/openmaic-viewer/.env` | `OPENMAIC_SESSION_SECRET` and other settings |
| `/opt/openmaic-viewer/openmaic.yml` | Narration voices (and optional chat models) |

On the server, once:

```bash
# 2 GB of swap, so a 1 GB server survives a busy moment
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Node.js 22 (the release the distribution was built with)
curl -fsSLO https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz
sudo mkdir -p /opt/node && sudo tar -xJf node-v22.23.2-linux-x64.tar.xz -C /opt/node --strip-components=1

# Caddy, for HTTPS (https://caddyserver.com/docs/install#debian-ubuntu-raspbian)
sudo apt-get install -y caddy

# A user for the service, and its directories
sudo useradd --system --home /opt/openmaic-viewer --shell /usr/sbin/nologin openmaic
sudo mkdir -p /opt/openmaic-viewer/data
```

Pack `dist/viewer/` as one archive (the application's modules are symbolic links; `scp -r` would copy them as separate files and break them) and copy it up, from the build machine:

```bash
tar -czf openmaic-viewer.tar.gz -C dist viewer
scp openmaic-viewer.tar.gz <user>@<server>:~
```

then on the server:

```bash
tar -xzf openmaic-viewer.tar.gz            # creates ~/viewer
sudo cp -a ~/viewer/app /opt/openmaic-viewer/app
sudo cp ~/viewer/snapshot/viewer-snapshot.ndjson.gz /opt/openmaic-viewer/data/
sudo cp ~/viewer/env.example /opt/openmaic-viewer/.env
sudo cp ~/viewer/openmaic.yml /opt/openmaic-viewer/openmaic.yml
sudo nano /opt/openmaic-viewer/.env          # set OPENMAIC_SESSION_SECRET and
                                             # OPENMAIC_CONFIG=/opt/openmaic-viewer/openmaic.yml
sudo chown -R openmaic:openmaic /opt/openmaic-viewer
sudo chmod 600 /opt/openmaic-viewer/.env

sudo cp ~/viewer/openmaic-viewer.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now openmaic-viewer
journalctl -u openmaic-viewer -f             # shows the import, then ready

# HTTPS: put your domain in the Caddyfile first; its DNS record must point here
sudo cp ~/viewer/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

The service listens on `127.0.0.1:3000` only; Caddy serves the site on ports 80 and 443. Open those two ports in the cloud firewall (on GCP: allow HTTP and HTTPS traffic on the VM).

**A server that already runs nginx for other sites** (ports 80 and 443 taken) uses nginx instead of Caddy: `nginx-site.conf` in the distribution is a site for the viewer's subdomain, and certbot adds its certificate. Change `PORT` (and `OPENMAIC_INTERNAL_URL` with it) in the service file when 3000 is in use, and always run `sudo nginx -t` before reloading, so a mistake never takes the other sites down. The comments at the top of `nginx-site.conf` list the commands.

`OPENMAIC_INTERNAL_URL` in the service file must point at the service's own port. Behind a reverse proxy, the app otherwise calls its public address with the wrong port for its login and course-visibility checks, and every course page sends visitors back to the home page.

To update the content on this layout, copy the new snapshot to `/opt/openmaic-viewer/data/viewer-snapshot.ndjson.gz` and run `sudo systemctl restart openmaic-viewer`. To update the application, replace `/opt/openmaic-viewer/app` with the new `app/` (keep `data/` and `.env`), `chown` it again and restart.

### Narration, class chat and quiz grading

The viewer reads its own `openmaic.yml`: the authoring server's model configuration is not in the snapshot. The one in the distribution narrates lessons with the voices installed in each visitor's browser, which costs nothing and needs no key, and declares no chat model. Without any `openmaic.yml` narration is unassigned and lessons play silently.

Browser voices depend on the visitor's device: a Tamil course needs a Tamil voice there. Android phones usually have one; on Windows add the Tamil speech pack (Settings, Time & language, Language, Tamil).

Logged-in accounts can also use class chat, quiz grading and speech input, which call a chat model. To offer those, declare a provider and the `llm` slot in the viewer's `openmaic.yml` (as in `openmaic.example.yml`), put the key it names in `.env`, and restart. Every chat and graded quiz then spends that provider's quota.

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
| `OPENMAIC_CONFIG` | viewer | The viewer's `openmaic.yml` (narration voices, optional chat models). Set by the compose file's mount; the folder distribution sets it in `.env`. |
| `OPENMAIC_INTERNAL_URL` | viewer | Where the app reaches itself, `http://127.0.0.1:<PORT>`. Needed behind a reverse proxy; the compose file and the service file set it. |
| `OPENMAIC_EMBEDDED_DB_LOCK_WAIT_MS` | viewer | How long a statement waits for the embedded database before failing. Default 60000. |

`docker-compose.viewer.yml` sets the first three and the snapshot path for you.

## Limits

- The embedded database serves one statement or transaction at a time. That suits a site that mostly reads; it is not meant for hundreds of learners writing at once. If the viewer outgrows it, point `DATABASE_URL` at a PostgreSQL server instead: the snapshot import only runs on the embedded database, so load content there with `pg_dump`/`pg_restore`.
- One viewer process per data directory. Do not run two containers on the same volume.
- Live course-update notifications are off on the viewer; pages pick up new content on their next load after an import.
