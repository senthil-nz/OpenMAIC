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
