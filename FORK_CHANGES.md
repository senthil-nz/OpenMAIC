# Fork changes

This fork (`senthil-nz/OpenMAIC`) tracks [`THU-MAIC/OpenMAIC`](https://github.com/THU-MAIC/OpenMAIC) `main`.
This file lists every change that exists only in the fork, so a resync with upstream knows what to keep and where conflicts are likely.

**Last synced with upstream:** `7d324aa` (upstream #1871, 2026-10-10).

All changes here are fork-only and are not sent upstream. Add a row to the table and a section below each time a fork PR is merged. If upstream later ships an equivalent change, keep upstream's version during the resync and drop the entry.

## Summary

| # | Change | Merged | Status |
|---|--------|--------|--------|
| [#1](https://github.com/senthil-nz/OpenMAIC/pull/1) | Tamil (`ta-IN`) interface locale | 2026-10-11 | Merged |
| [#2](https://github.com/senthil-nz/OpenMAIC/pull/2) | README fork notice and this change log | 2026-10-11 | Merged |
| [#3](https://github.com/senthil-nz/OpenMAIC/pull/3) | Outline prompt no longer adds a second language to English courses | 2026-10-11 | Merged |
| [#3](https://github.com/senthil-nz/OpenMAIC/pull/3) | Page translators no longer crash the interface | 2026-10-11 | Merged |
| [#3](https://github.com/senthil-nz/OpenMAIC/pull/3) | Accounts and roles, stage 2: login | 2026-10-11 | Merged |
| [#3](https://github.com/senthil-nz/OpenMAIC/pull/3) | Accounts and roles, stages 3 to 6: enforcement, catalogue, user management, viewer mode | 2026-10-11 | Merged |
| [#4](https://github.com/senthil-nz/OpenMAIC/pull/4) | Token usage is shown to admins only | 2026-10-11 | Merged |
| [#5](https://github.com/senthil-nz/OpenMAIC/pull/5) | Viewer deployment on an embedded database, with content snapshots | 2026-10-11 | Merged |
| [#6](https://github.com/senthil-nz/OpenMAIC/pull/6) | Viewer: Linux deployment without Docker, narration voices, reverse-proxy fix | 2026-10-28 | Merged |

## Merged changes

### #1 Tamil (`ta-IN`) locale

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/1 (merge commit `f47294b`, change commit `02332a8`)
- **What:** Tamil as the 13th interface locale; Tamil narration is tagged `ta-IN` and binds an installed Tamil browser voice; voice input maps `ta` to `ta-IN`.
- **Files added:** `lib/i18n/locales/ta-IN.json`, `lib/i18n/workbench-locales/ta-IN.json`
- **Files changed:** `lib/i18n/locales.ts`, `lib/i18n/workbench.ts`, `lib/video-export-app/cover-config.ts`, `lib/audio/browser-tts-preview.ts`, `lib/audio/asr-providers.ts`, `lib/playback/engine.ts`, `README.md`, `README-zh.md`, `tests/audio/detect-speech-lang.test.ts`, `tests/video-export/cover-config.test.ts`, `tests/workbench/workbench-i18n.test.ts`
- **Likely conflicts on resync:**
  - `lib/i18n/locales.ts`, `workbench.ts`, `cover-config.ts`: upstream adding its own locale touches the same lists. Keep both entries.
  - `tests/workbench/workbench-i18n.test.ts`: hard-coded locale counts (13 locales, 11 overlays). Add 1 for each new upstream locale.
  - `lib/i18n/locales/ta-IN.json`, `workbench-locales/ta-IN.json`: no git conflict, but new keys upstream adds to `en-US.json` or `workbenchEn` will be missing in Tamil. Run the i18n tests after every sync and translate any new keys.
  - `lib/playback/engine.ts`: the Vietnamese voice-binding block was generalised to Vietnamese and Tamil.
  - README locale lists.

### README fork notice and this file

- **What:** a short notice near the top of `README.md` that says this is a fork and links here, plus this file.
- **Files:** `README.md` (one block between `<!-- fork-notice:start -->` and `<!-- fork-notice:end -->`), `FORK_CHANGES.md`
- **Likely conflicts:** upstream edits to the README header. Keep the marked block as it is.

### #3 Outline prompt: no second language for English courses

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/3 (merge commit `62e081b`, change commit `d15d030`)
- **What:** the "show emerging tech terms bilingually" rule now applies only when the teaching language is not English, and the language directive may not add a language the user did not ask for.
- **Files:** `lib/prompts/templates/interactive-outlines/system.md`, `packages/@openmaic/generation/templates/requirements-to-outlines/system.md`, `packages/@openmaic/generation/test/__snapshots__/outline-prompt.test.ts.snap`
- **Likely conflicts:** upstream edits to either prompt template; regenerate the snapshot after merging.

### #3 Page translators no longer crash the interface

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/3 (merge commit `62e081b`)
- **What:** the page is marked `translate="no"` / `notranslate` so a browser's page translator leaves the React interface alone, and the Test TTS button label is wrapped in a `<span>`. Before, translating the page caused "NotFoundError: Failed to execute 'insertBefore' on 'Node'" in settings.
- **Files:** `app/layout.tsx`, `components/settings/tts-settings.tsx`
- **Likely conflicts:** upstream edits to the `<html>` tag or `metadata` in `app/layout.tsx`. Keep the `translate`/`notranslate` attributes and the `google: 'notranslate'` entry.

### #3 Accounts and roles, stage 2: login

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/3 (merge commit `62e081b`, change commit `e90ef7a`). Plan: https://claude.ai/code/artifact/6d3bec58-fb37-4409-b635-915635400797
- **What:** username and password accounts with three roles (student, teacher, admin), stored in PostgreSQL, plugged in through upstream's documented owner auth hook. Login page, logout, user menu, first admin from the environment. Off unless `OPENMAIC_ACCOUNTS_ENABLED=true`, so default behaviour matches upstream. Nothing is restricted yet; enforcement is stage 3.
- **New environment variables:** `OPENMAIC_ACCOUNTS_ENABLED`, `OPENMAIC_SESSION_SECRET` (32+ characters, required when enabled), `OPENMAIC_ADMIN_USERNAME`, `OPENMAIC_ADMIN_PASSWORD`.
- **New database tables:** `account_users`, `account_sessions` (migration store `fork-accounts`). No upstream table is changed.
- **Files added (fork-owned, no upstream counterpart):** `lib/accounts/policy.ts` (the permission table), `lib/accounts/strings.ts`, `lib/accounts/use-account.ts`, `lib/server/accounts/*.ts`, `app/api/auth/{login,logout,me}/route.ts`, `app/login/page.tsx`, `components/accounts/account-menu.tsx`, `tests/accounts/accounts.test.ts`
- **Upstream files changed:** `instrumentation.ts` (two marked blocks: registration before owner identity validation, and the first-admin seed), `app/page.tsx` (one import and one `<AccountMenu />` in the top-right pill), `.env.example` (one block at the end).
- **Likely conflicts:** upstream edits near the owner identity validation in `instrumentation.ts`, or to the top-right pill in `app/page.tsx`. Keep the blocks marked "Fork-only".
- **Depends on upstream contracts:** `configureOwnerAuthentication` and `OwnerAuthMethod` in `lib/server/identity/`, `applySchemaMigrations` in `@openmaic/storage/pg-migrations`, `POST /api/identity/claim`. If upstream changes these, `lib/server/accounts/auth-method.ts` and `store.ts` need the matching change.

### #3 Accounts and roles, stages 3 to 6: enforcement, catalogue, user management, viewer mode

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/3 (merge commit `62e081b`)
- **What:**
  - *Enforcement (stage 3).* Every request passes an access gate in `middleware.ts` that reads the role from the signed session cookie and applies one rule table, `lib/accounts/route-policy.ts`. An API route missing from the table is admin-only. Guests cannot create, generate, chat or configure; students view and take part; teachers create and publish; admins also configure models and manage users. Model settings are one site-wide record (`site:settings`) instead of one per owner.
  - *Public courses and catalogue (stage 4).* A course that is not public can be opened only by a logged-in account. `GET /api/courses` and a catalogue on the home page list the courses the visitor may open; owners and admins get a public/private switch.
  - *User management (stage 5).* `/admin/users` and `/api/admin/users*`: add accounts, change roles, reset passwords, disable accounts. `/api/admin/courses/[id]` lets an admin change any course's visibility.
  - *Viewer mode (stage 6).* `OPENMAIC_VIEWER_MODE=true` refuses creation, publishing, settings and user management for every role and starts no background workers.
- **Session tokens:** the cookie's signed token lives 10 minutes and the gate renews it against the database, so a disabled user, a logout or a role change reaches every route within 10 minutes, and at once on routes that resolve the owner. Changing a role or password, or disabling an account, deletes its sessions.
- **New environment variables:** `OPENMAIC_VIEWER_MODE`, `OPENMAIC_INTERNAL_URL` (optional).
- **Files added (fork-owned):** `lib/accounts/route-policy.ts`, `lib/server/accounts/{gate,guard,courses,admin}.ts`, `app/api/auth/{session,course}/route.ts`, `app/api/courses/route.ts`, `app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`, `app/api/admin/courses/[id]/route.ts`, `app/admin/users/page.tsx`, `components/accounts/course-catalogue.tsx`, `tests/accounts/route-policy.test.ts`
- **Upstream files changed (each change marked "Fork-only"):**
  - `middleware.ts`: `next()` takes an optional account pass, plus `applyAccountGate()` called before the access-code check.
  - `instrumentation.ts`: background workers are skipped in viewer mode.
  - `lib/persistence/workspace-model-config.ts`: read and save map the owner to the site-wide key when accounts are on.
  - `app/api/model-config/route.ts` (PUT) and `app/api/model-config/import/route.ts`: a second admin check inside the handler.
  - `app/page.tsx`: the composer is shown only to roles that may create; the catalogue is added.
  - `components/settings/index.tsx`: non-admins see only the General section.
- **Likely conflicts:** `middleware.ts` (upstream may rename it to `proxy.ts`, as Next.js 16 asks: move both marked blocks with it), the top of `HomePage` and the composer block in `app/page.tsx`, the `listed` function in `components/settings/index.tsx`.
- **After every upstream resync:** new upstream API routes are admin-only until a row is added for them in `lib/accounts/route-policy.ts`. Run `pnpm vitest run tests/accounts`, then check the new routes against the table.
- **Known limits:** an admin can change any course's visibility but cannot edit or delete a course owned by someone else (upstream's document store is owner-only). Courses made anonymously before accounts were turned on stay with their anonymous owner unless that browser logs in as a teacher or admin, which claims them.

### #4 Token usage is shown to admins only

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/4 (change commit `1624917`)
- **What:** with accounts on, the token usage dashboard in Settings > General is rendered only for an admin. Its data route was already admin-only, so students and teachers saw a panel that could not load.
- **Files:** `components/settings/general-settings.tsx`
- **Likely conflicts:** upstream edits around `<UsageDashboard />` in that file.

### #5 Viewer deployment on an embedded database, with content snapshots

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/5 (merge commit `11a5ba4`, change commit `fae7237`)
- **What:** a public viewer server that needs no database service, fed from a local authoring server. Operator guide: [VIEWER_DEPLOYMENT.md](VIEWER_DEPLOYMENT.md).
  - *Embedded database.* `DATABASE_URL=pglite:<directory>` runs PostgreSQL inside the server process (PGlite) with its data in a directory. No SQL is translated: every store issues the PostgreSQL it already issues, and upstream's own test suite runs those stores on PGlite. PGlite is one session, so `EmbeddedPool` gives it the surface of a node-postgres pool and takes turns on it: a checked-out client holds the session until released, and a statement that waits longer than `OPENMAIC_EMBEDDED_DB_LOCK_WAIT_MS` fails instead of hanging. Refused at boot unless `OPENMAIC_VIEWER_MODE=true` and `OPENMAIC_ACCOUNTS_ENABLED=true`.
  - *Content snapshots.* `pnpm viewer:export` writes the course content of the authoring PostgreSQL database to `viewer-snapshot.ndjson.gz`, read in one REPEATABLE READ transaction. A viewer imports the file as it starts, before it serves, in one transaction. The import replaces content tables and never writes the viewer's own tables, so learner progress, chat history and login sessions survive every update. A snapshot is imported once, and is refused (the viewer keeps what it had) when it is incomplete or from a different schema version.
  - *Distribution.* `pnpm viewer:build` writes `dist/viewer/`: the Docker image as a tar file, a compose file, the snapshot and an env example. `--target folder` builds a `node server.js` folder instead, into its own build directory so it does not replace `.next`.
- **Which tables a snapshot carries** is one list, `SNAPSHOT_TABLES` in `lib/server/viewer/snapshot-format.ts`, with how each meets the viewer's rows (`replace`, `merge`, `insert-missing`). `VIEWER_OWNED_TABLES` in the same file lists what an import refuses to write. `workspace_model_config` is deliberately not carried: it holds keys sealed with the authoring deployment's instance secret.
- **New environment variables:** `OPENMAIC_VIEWER_SNAPSHOT` (default `data/viewer-snapshot.ndjson.gz`), `OPENMAIC_EMBEDDED_DB_LOCK_WAIT_MS` (default 60000), `OPENMAIC_DIST_DIR` (build only, set by `viewer:build`).
- **New database table (viewer only):** `fork_viewer_snapshots`, the log of imported snapshots. No upstream table is changed.
- **Files added (fork-owned):** `lib/persistence/embedded-database.ts`, `lib/server/viewer/{embedded-boot,snapshot-format,snapshot-export,snapshot-import}.ts`, `scripts/viewer-export.ts`, `scripts/viewer-build.mjs`, `docker-compose.viewer.yml`, `viewer.env.example`, `VIEWER_DEPLOYMENT.md`, `tests/viewer/{embedded-database,snapshot}.test.ts`
- **Upstream files changed (each change marked "Fork-only"):**
  - `lib/persistence/server-provider.ts` and `lib/persistence/schema-boot-check.ts`: the default pool factory is `createDatabasePool`, which opens a node-postgres pool for anything but `pglite:`. `Pool` is now a type-only import in both.
  - `lib/server/agent-runtime/event-notify-bus.ts`: `ensureConnected` returns at once on the embedded database (no second connection to LISTEN on; streams keep their fallback polls).
  - `instrumentation.ts`: three blocks. The embedded database is opened and a new snapshot imported before the admin seed, and `register` waits for it; the configuration check beside the accounts check; the embedded database is closed at shutdown.
  - `next.config.ts`: `@electric-sql/pglite` in `serverExternalPackages` and its runtime files in `outputFileTracingIncludes`; `distDir` from `OPENMAIC_DIST_DIR` when set.
  - `.dockerignore`: `**/node_modules` added. The existing `node_modules` line matches the root directory only, so on a machine where `pnpm install` had run, the workspace packages' own `node_modules` (host links) were copied over the ones the image installed and `pnpm run build:packages` failed with `ERR_MODULE_NOT_FOUND`. This also fixes `docker compose up --build` from such a checkout.
  - `.env.example`: one block at the end.
  - `package.json`, `pnpm-lock.yaml`: `@electric-sql/pglite` moved from `devDependencies` to `dependencies` (same version); scripts `viewer:export` and `viewer:build`.
- **Likely conflicts on resync:**
  - `instrumentation.ts`: upstream edits around the accounts check or the shutdown hook. Keep the three marked blocks.
  - `lib/persistence/server-provider.ts`, `schema-boot-check.ts`: upstream edits to the default `poolFactory` parameter or the `pg` import.
  - `next.config.ts`: upstream additions to the same two lists. Keep both.
  - `package.json` / `pnpm-lock.yaml`: if upstream bumps `@electric-sql/pglite`, take its version and keep the package under `dependencies`.
- **After every upstream resync:**
  - Run `pnpm vitest run tests/viewer`.
  - A new upstream table that holds course content must be added to `SNAPSHOT_TABLES`, or viewers will not receive it. Compare the tables of a migrated database with the list.
  - A new place that opens a database connection from `DATABASE_URL` (`new Pool(` or `new Client(` under `lib/` or `app/`) must go through `createDatabasePool`, or be skipped on a viewer.
  - Rebuild the viewer distribution and export a fresh snapshot from the same release: a snapshot from a different schema version is refused.
- **Depends on upstream contracts:** the schema migration records in `openmaic_schema_migrations` (`@openmaic/storage/pg-migrations`), `getServerPersistenceProvider`'s `poolFactory` parameter, the `isPool` test in `pg-migrations.ts` (it reads `totalCount`, `idleCount` and `waitingCount`), and upstream continuing to run its stores on PGlite in tests.
- **Known limits:** the embedded database serves one statement or transaction at a time; learner data on the viewer does not flow back to the authoring server; private courses and password hashes are in the snapshot; media kept in S3 and courses still stored as files in `data/classrooms` are not.

### #6 Viewer: Linux deployment without Docker, narration voices, reverse-proxy fix

- **PR:** https://github.com/senthil-nz/OpenMAIC/pull/6 (branch `feat/viewer-linux-deploy`)
- **What:** what the first real viewer deployment (https://learn.studylk.org, a 1 GB GCP VM that also hosts two other sites behind nginx) needed:
  - *Without Docker.* `pnpm viewer:build --target folder` built on Linux now also writes a systemd service (`deploy/viewer/openmaic-viewer.service`), a Caddy configuration and an nginx site for a server whose nginx already serves other sites. The snapshot goes to `dist/viewer/snapshot/` for both targets. VIEWER_DEPLOYMENT.md has the Ubuntu steps (swap, Node.js, service user, layout under `/opt/openmaic-viewer`) and how to build on Linux from Windows (WSL).
  - *Narration.* A viewer with no `openmaic.yml` has narration unassigned, so lessons played silently. `deploy/viewer/openmaic.yml` narrates with browser voices (free, no key), declares no chat model and sets `allowUserKeys: false`. The build ships it, `docker-compose.viewer.yml` mounts it, and the folder layout reads it through `OPENMAIC_CONFIG`.
  - *Reverse proxy.* Behind nginx the account gate called the app's public address with the wrong port for its course-visibility and session checks, so every course page redirected to the home page. The service file and the compose file now set `OPENMAIC_INTERNAL_URL` to the app's own port.
- **Files added (fork-owned):** `deploy/viewer/{openmaic-viewer.service,Caddyfile,nginx-site.conf,openmaic.yml}`
- **Files changed (fork-owned, from #5):** `scripts/viewer-build.mjs`, `docker-compose.viewer.yml`, `viewer.env.example`, `VIEWER_DEPLOYMENT.md`
- **Upstream files changed:** none.
- **Likely conflicts on resync:** none; every file is fork-owned.
- **Known limits:** browser voices depend on the visitor's device (a Tamil course needs a Tamil voice installed). The folder build must be made on Linux with a glibc no newer than the server's.

## Unmerged work

None.

### Local-only configuration (not committed)

These live only on the local machine (`openmaic.yml`, `.env.local`) and are not in git. Back them up before a resync and re-check them after.

- Ollama Cloud as an LLM provider.
- Browser voice (Web Speech) as the TTS provider.
- Accounts switched on, with a locally generated `OPENMAIC_SESSION_SECRET` and the admin username.

## Resync procedure

```bash
# one-time
git remote add upstream https://github.com/THU-MAIC/OpenMAIC.git

# each resync
git fetch upstream
git checkout main
git checkout -b sync/upstream-YYYY-MM-DD
git merge upstream/main          # merge, not rebase: keeps fork PR history intact
# resolve conflicts using the "Likely conflicts" notes above
pnpm install
npx tsc --noEmit
pnpm vitest run tests/i18n tests/workbench tests/audio tests/video-export
git push -u origin sync/upstream-YYYY-MM-DD   # open a PR into the fork's main
```

After merging the sync PR, update **Last synced with upstream** above and drop any entry that upstream now covers.
