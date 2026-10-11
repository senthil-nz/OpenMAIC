# Fork changes

This fork (`senthil-nz/OpenMAIC`) tracks [`THU-MAIC/OpenMAIC`](https://github.com/THU-MAIC/OpenMAIC) `main`.
This file lists every change that exists only in the fork, so a resync with upstream knows what to keep and where conflicts are likely.

**Last synced with upstream:** `7d324aa` (upstream #1871, 2026-10-10).

All changes here are fork-only and are not sent upstream. Add a row to the table and a section below each time a fork PR is merged. If upstream later ships an equivalent change, keep upstream's version during the resync and drop the entry.

## Summary

| # | Change | Merged | Status |
|---|--------|--------|--------|
| [#1](https://github.com/senthil-nz/OpenMAIC/pull/1) | Tamil (`ta-IN`) interface locale | 2026-10-11 | Merged |
| — | README fork notice and this change log | — | This PR |
| — | Outline prompt no longer adds a second language to English courses | — | On branch, no PR yet |

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

## Unmerged work

### Outline prompt: no second language for English courses

- **Branch:** `claude/project-thread-tz7wg0` (commit `d15d030`), pushed but no PR yet.
- **What:** the "show emerging tech terms bilingually" rule now applies only when the teaching language is not English, and the language directive may not add a language the user did not ask for.
- **Files:** `lib/prompts/templates/interactive-outlines/system.md`, `packages/@openmaic/generation/templates/requirements-to-outlines/system.md`, `packages/@openmaic/generation/test/__snapshots__/outline-prompt.test.ts.snap`
- **Likely conflicts:** upstream edits to either prompt template; regenerate the snapshot after merging.

### Local-only configuration (not committed)

These live only on the local machine (`openmaic.yml`, `.env.local`) and are not in git. Back them up before a resync and re-check them after.

- Ollama Cloud as an LLM provider.
- Browser voice (Web Speech) as the TTS provider.

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
