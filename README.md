# 🎲 GISU Quiz Game — End-of-Class Quiz for Teachers

A classroom quiz game for **Galaxy International School Uganda**. No installation, no server, no account, no build step — download the folder, double-click `index.html`, play. Built for teachers who want to close their lessons with five fun minutes of review.

## Features

**Three quiz modes**
- 🎲 **Individual** — a slot-machine picks a random student, a wheel (or the student) picks the difficulty, confetti or a buzzer follows the answer.
- 👥 **Groups** — the app splits the class into random teams, rotates the turn between teams *and* rotates who answers inside each team, and keeps a live team scoreboard.
- ⏱️ **Beat the Clock** — one student answers as many questions as they can before time runs out. Only correct answers count; no penalty.

**Interactive answering** — multiple-choice options become clickable buttons, True/False gets two big buttons, open questions get a type-in box with smart answer matching (case, punctuation, `H2O` = `H₂O`, alternatives like `100°C / 212°F`). Anything ambiguous is left to the teacher's judgement.

**Question banks that match how schools work** — Subjects → Grades → Topics → Easy/Medium/Hard. Classes detect their grade from their name (`7-A` → Grade 7), and the quiz screen only offers topics for that grade.

**Pictures in questions** — copy a diagram out of a textbook or worksheet and press Ctrl+V while adding a question; it is shrunk automatically and travels with the question everywhere, including offline. Drag-and-drop and file picking work too.

**Get questions in fast**
- 📄 *Import from Word/text*: paste a whole yearly plan with `Subject:` / `Grade:` / `Topic:` / `Easy` markers — every question lands in the right place. Turkish markers (`Ders:`, `Konu:`, `Kolay`…) work too. A template is included: [`tools/question-plan-template.txt`](tools/question-plan-template.txt)
- 📝 *Bulk add*: paste many questions at once, one per line or in blocks.
- ⬆ *Import/Export JSON*: share complete question banks with colleagues (questions only — never student data).

**Reports** — every answer is recorded, so you can see success per topic (worst first), per student, and which questions most of the class gets wrong. Filter by class and period, export to Excel-friendly CSV.

**Classroom conveniences** — attendance (tap a name to mark absent; absent students are skipped), pause/resume the timer (Space), keyboard shortcuts (→ correct, ← wrong), fullscreen mode, adjustable timers per difficulty.

**Data safety** — deleted items go to a Trash with 30-day restore, Ctrl+Z undoes the last delete, and the app reminds you when a backup is overdue. Everything can be exported to a single backup file and imported on another computer.

**Optional cloud sync** — prepare your yearly plan at home, open it at school. Your classes, subjects, topics, questions and scores live in your own account; **student names are encrypted on your device first**, so the server only ever stores unreadable text and never has your passphrase. Off by default — see [`supabase/README.md`](supabase/README.md) to switch it on. The app works fully offline either way.

**Sounds** — a carnival tune while names spin, a tick-tock countdown, applause + fanfare for correct, a donk-zonk buzzer for wrong. All synthesized from scratch (no copyright worries) and embedded in `game.js`. Want your own sounds? See [`tools/`](tools/).

## Getting started

1. Download the whole folder (green **Code → Download ZIP** button, then unzip) — or use the hosted page if this repo has GitHub Pages enabled.
2. Open **`index.html`** in any modern browser.
3. **Classes tab** → add your classes (`7-A, 7-B, 8-A`) and students.
4. **Question Banks tab** → add subjects and topics, then questions (try *📄 Import from Word / text* with the template in `tools/`).
5. **Quiz tab** → pick a mode and play. 🎉

> Keep the folder together — `index.html` loads `style.css`, `game.js`, `assets/` and `vendor/` from beside itself. Copying `index.html` on its own gives you an unstyled page that does nothing.

Demo content to try it immediately: import [`demo/demo-question-banks.json`](demo/demo-question-banks.json) from the Question Banks tab (96 questions, 4 subjects, Grades 6–7).

## Project layout

```
index.html      page structure — all the markup, links the scripts below
style.css       all styling
game.js         all behaviour: data model, quiz logic, reports, sounds
sync.js         optional cloud sync + the encryption that protects student names
supabase-config.js   your project URL and public key (empty = sync off)
supabase/       the database schema and its setup guide
assets/         gisu-logo.png — the school logo shown in the header
vendor/         the bundled confetti library (third-party, ISC licensed)
demo/           a ready-made question bank to try the app
tools/          selftest.js, plus optional Python helpers for sounds and a plan template
```

Keep these together when you copy the app around — `index.html` loads `style.css`,
`game.js`, `assets/` and `vendor/` from beside itself.

Only one thing comes from the internet: the **Nunito + Caveat** fonts, in the `<head>` of `index.html`. Offline you simply get system fonts; everything else, confetti included, works with no connection. The confetti library is bundled in [`vendor/`](vendor/) rather than loaded from a CDN, so no third party can ever swap out code that runs alongside your class lists — see [`vendor/README.md`](vendor/README.md).

## The school logo

The header shows `assets/gisu-logo.png` to the left of the title — the GISU **emblem** on its own, without the wordmark or tagline, since at 60px the wordmark was too small to read and the title already names the school. If that file is missing the logo is simply hidden and the title stands alone — no broken-image icon. See [`assets/README.md`](assets/README.md) for the recommended size and how to use an SVG instead.

## Where is my data?

All data (classes, students, questions, scores, history) lives in **your browser's storage on your computer** — nothing is sent anywhere. That means:

- The files themselves do not contain your data; sharing them never leaks student names.
- To move between computers (home ↔ school), use **Backup → Export All Data** and import the file on the other machine.
- If the browser's site data is cleared, the data is gone — the app reminds you to keep backups. Please do.
- Data is stored per-origin, so opening the app from a different folder or a different browser shows an empty app. Use a backup file to carry data across.

⚠️ **Never commit backup files** (`quiz-backup-*.json`) to a public repository — they contain student names. The included [`.gitignore`](.gitignore) guards against this.

## Customizing sounds

Everything lives in the `MY_SOUNDS` block near the top of [`game.js`](game.js) (around line 211). Point any sound at your own audio, either as an embedded base64 string (survives sharing the file) or a filename next to `index.html`. Helper scripts:

- `tools/make_sound_line.py your.mp3 correct` → prints the line to paste into `game.js`.
- `tools/make_sounds.py` → regenerates the built-in synthesized sounds and writes them into `game.js` (Python, `numpy` + `lameenc`).

Python is **only** needed for these optional tools — the game itself needs nothing but a browser.

## Roadmap

- Question sets ("Lesson 3 review") inside topics
- Tables inside questions
- Search across question banks

## Contributing

Issues and pull requests are welcome. Three plain files of our own code, no framework and no build step — open them, read them, change them, refresh the browser. Please keep it that way: no bundler, no dependencies to install. Before opening a PR, run `node tools/selftest.js`.

## License

MIT — see [LICENSE](LICENSE). Use it, change it, share it with your school.
