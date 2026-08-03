# CLAUDE.md

See [README.md](README.md) for the project overview, feature rules, and game logic.

## Working agreements

- **Reply to me in Turkish.** All code, comments, commit messages, and docs stay in English.
- **Commit after each working change.** Small, self-contained commits — not one big commit at the end.
- **Don't rewrite whole files.** Make targeted edits to the lines that need changing.
- **Database: Supabase. Ask before changing the schema.**
  Both schemas count: `SCHEMA` in `game.js` for the stored shape, and
  `supabase/schema.sql` for the table and its RLS policies.

## Architecture

Three plain files of our own code, no build step, no package manager, nothing to install:

| File | Contents |
|---|---|
| `index.html` | All markup. Loads the other two from the same folder. |
| `style.css` | All styling. Custom properties on `:root`, one `max-width:520px` breakpoint. |
| `game.js` | All behaviour: data model, quiz flow, reports, sounds, pictures, cloud-sync UI. |
| `sync.js` | Cloud sync: name encryption, the push/pull rule, Supabase transport. No DOM. |
| `supabase-config.js` | Project URL + anon key. Empty by default; sync stays off until filled. |

`index.html` must be opened directly (`file://` works) or served from a folder that also
contains `style.css`, `game.js`, `assets/` and `vendor/`. Keep it that way — no bundler.
`vendor/` is bundled third-party code; don't edit it, and see `vendor/README.md` to update it.

One external resource, in `<head>`: Google Fonts (Nunito + Caveat). Offline the app still
runs, just with system fonts. canvas-confetti is bundled in `vendor/` on purpose — it runs
on the same page as the student data, so it must not be a CDN's to replace. Keep it that
way, and use the `dist/confetti.browser.js` build; the CommonJS builds throw in a script
tag and `fireConfetti()` swallows the failure silently.

### game.js section map

Jump straight to the right band instead of reading the whole file:

```
   1  DATA MODEL (schema 7) — full shape of every entity, read this first
  61  STORAGE — const KEY='quiz-state-v6', debounced save/load
 211  SOUND (MY_SOUNDS block just below)
 251  SMALL HELPERS     271  STYLED DIALOGS    306  TRASH & UNDO
 371  FULLSCREEN & TABS 395  CLASSES           463  STUDENTS
 539  QUESTION BANKS    817  TOPICS            911  QUESTION PICTURES
1043  QUESTIONS        1195  SCOREBOARD       1212  REPORTS
1360  BACKUP & TRASH   1477  QUIZ SELECTORS   1501  QUIZ SETTINGS
1547  QUIZ FLOW        2023  CONFETTI         2035  KEYBOARD
2047  CLOUD SYNC       2324  INIT
```

Line numbers drift as the file changes — grep the banner text (`/* ===== CLASSES =====`)
rather than trusting them.

## Conventions to preserve

- **Event handlers are assigned in JS**, never as inline `onclick=` attributes in the
  markup. There are currently zero inline handlers; keep it that way.
- **Entities carry permanent ids.** Names are labels only, so renaming a class, subject,
  topic, or student must never break scores, history, or references.
- **Bump `SCHEMA`** and handle migration in `init()` when the stored shape changes.
  The storage key stays `quiz-state-v6` whatever `SCHEMA` says; changing the key silently
  orphans every teacher's data. Backup import compares against `6`, not `SCHEMA`, because
  `migrateToV6` only understands the pre-v6 shape.
- The header logo (`assets/gisu-logo.png`) is optional — `game.js` hides the `img` when
  the file is missing. Don't make it required.
- **Pictures are untrusted too.** A question's `img` can arrive in an imported bank, so it
  goes through `safeImgUri()` — only a base64 `data:image` URI ever reaches a `src`. Never
  interpolate it raw; `" onerror="…` and `data:image/svg+xml` are both blocked there.
- **Treat imported question banks as untrusted input.** Subject, topic and question names
  arrive through Import JSON from other teachers. Anything of theirs that reaches the page
  goes through `esc()` or `textContent` — never straight into `innerHTML`. This is not
  hypothetical: a topic named `<img src=x onerror=...>` used to run script when deleted.

## Data and privacy

All data lives in `localStorage` under `quiz-state-v6`. Cloud sync is optional and off
until `supabase-config.js` is filled in; `localStorage` stays the working copy either way,
so the app still runs with no connection.

**Student names never leave the device readable.** `sync.js` encrypts them before anything
is sent (AES-GCM, key derived from a passphrase that is never stored or transmitted). When
you touch the payload, remember a name lives in more places than the roster:

- `classes[].students[].name` and `attempts[].stuName` — encrypted
- `trash[]` — snapshots *and* labels like `Student "Amina"`; dropped from the payload
  entirely, because it is a per-device 30-day undo

Anything new that can hold a name must be encrypted or excluded, and given a case in the
self-test. The `service_role` key must never appear in any file the browser can read — it
ignores RLS; only the `anon` key belongs there.

**Never commit backup files.** `quiz-backup-*.json` and exported report CSVs contain real
student names. `.gitignore` covers them — don't add exceptions, and don't paste backup
contents into commits, issues, or docs.

## Verifying a change

Run the self-test first — no dependencies, no build step:

```bash
node tools/selftest.js
```

It covers the paths where a mistake stays invisible in the classroom: imported question
banks as untrusted input, typed-answer matching, and whether names can reach `innerHTML`.
Add a case to it whenever you touch those. It is not a full suite — everything else still
needs a browser: open `index.html` and exercise the flow. Two gotchas learned the hard way:

- **After editing `style.css`, `sync.js`, `supabase-config.js` or `game.js`, update the
  `?v=` stamps in `index.html`.** GitHub Pages serves everything with `max-age=600` and the
  edge caches age independently, so without it a teacher can get a fresh `index.html` beside
  a stale `game.js` — the new markup renders and none of its handlers exist, which looks
  exactly like a broken feature. `node tools/selftest.js` fails with the value to paste in.
- Browser caching will still serve a stale file locally and make a correct fix look broken.
  Hard-reload, or serve over `python -m http.server` with a cache-busting query.
- Import the demo bank (`demo/demo-question-banks.json`) from the Question Banks tab to get
  playable content without typing questions by hand.

## Optional Python tools

`tools/` only matters for regenerating sounds; the game itself needs nothing but a browser.
Both scripts write into the `MY_SOUNDS` block in `game.js` and need `numpy` + `lameenc`.
