# CLAUDE.md

See [README.md](README.md) for the project overview, feature rules, and game logic.

## Working agreements

- **Reply to me in Turkish.** All code, comments, commit messages, and docs stay in English.
- **Commit after each working change.** Small, self-contained commits — not one big commit at the end.
- **Don't rewrite whole files.** Make targeted edits to the lines that need changing.
- **Database: Supabase. Ask before changing the schema.**
  Note: there is no Supabase (or any backend) in the code today — all state lives in
  `localStorage`, see below. Treat this rule as active from the moment a backend is added.

## Architecture

Three plain files, no build step, no package manager, no dependencies to install:

| File | Contents |
|---|---|
| `index.html` | All markup. Loads the other two from the same folder. |
| `style.css` | All styling. Custom properties on `:root`, one `max-width:520px` breakpoint. |
| `game.js` | All behaviour: data model, quiz flow, reports, sounds. |

`index.html` must be opened directly (`file://` works) or served from a folder that also
contains `style.css`, `game.js`, and `assets/`. Keep it that way — no bundler.

Only two external resources, both in `<head>`: Google Fonts (Nunito + Caveat) and
canvas-confetti. Offline the app still runs, just with system fonts and no confetti.

### game.js section map

Jump straight to the right band instead of reading the whole file:

```
   1  DATA MODEL (schema 6) — full shape of every entity, read this first
  64  const KEY='quiz-state-v6'   persistence + load/save
 210  SOUND (MY_SOUNDS block at 211)
 250  SMALL HELPERS      263  STYLED DIALOGS     298  TRASH & UNDO
 358  FULLSCREEN & TABS  382  CLASSES            450  STUDENTS
 526  QUESTION BANKS     804  TOPICS             898  QUESTIONS
1038  SCOREBOARD        1203  BACKUP & TRASH    1316  QUIZ SELECTORS & BANNER
1340  QUIZ SETTINGS     1386  QUIZ FLOW         1848  CONFETTI
1860  KEYBOARD          1872  INIT
```

Line numbers drift as the file changes — grep the banner text (`/* ===== CLASSES =====`)
rather than trusting them.

## Conventions to preserve

- **Event handlers are assigned in JS**, never as inline `onclick=` attributes in the
  markup. There are currently zero inline handlers; keep it that way.
- **Entities carry permanent ids.** Names are labels only, so renaming a class, subject,
  topic, or student must never break scores, history, or references.
- **Bump `SCHEMA`** and handle migration in `init()` when the stored shape changes.
  The storage key is `quiz-state-v6`; changing it silently orphans every teacher's data.
- The header logo (`assets/gisu-logo.png`) is optional — `game.js` hides the `img` when
  the file is missing. Don't make it required.
- **Treat imported question banks as untrusted input.** Subject, topic and question names
  arrive through Import JSON from other teachers. Anything of theirs that reaches the page
  goes through `esc()` or `textContent` — never straight into `innerHTML`. This is not
  hypothetical: a topic named `<img src=x onerror=...>` used to run script when deleted.

## Data and privacy

All data (classes, students, questions, scores, history) lives in `localStorage` under
`quiz-state-v6`. Nothing is sent anywhere; there is no network call in `game.js`.

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

- Browser caching will serve a stale `style.css` / `game.js` and make a correct fix look
  broken. Hard-reload, or serve over `python -m http.server` and add a cache-busting query.
- Import the demo bank (`demo/demo-question-banks.json`) from the Question Banks tab to get
  playable content without typing questions by hand.

## Optional Python tools

`tools/` only matters for regenerating sounds; the game itself needs nothing but a browser.
Both scripts write into the `MY_SOUNDS` block in `game.js` and need `numpy` + `lameenc`.
