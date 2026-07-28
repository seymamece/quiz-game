# 🎲 Quiz Game — End-of-Class Quiz for Teachers

A classroom quiz game that runs from **a single HTML file**. No installation, no server, no account — download it, double-click it, play. Built for teachers who want to close their lessons with five fun minutes of review.

## Features

**Three quiz modes**
- 🎲 **Individual** — a slot-machine picks a random student, a wheel (or the student) picks the difficulty, confetti or a buzzer follows the answer.
- 👥 **Groups** — the app splits the class into random teams, rotates the turn between teams *and* rotates who answers inside each team, and keeps a live team scoreboard.
- ⏱️ **Beat the Clock** — one student answers as many questions as they can before time runs out. Only correct answers count; no penalty.

**Interactive answering** — multiple-choice options become clickable buttons, True/False gets two big buttons, open questions get a type-in box with smart answer matching (case, punctuation, `H2O` = `H₂O`, alternatives like `100°C / 212°F`). Anything ambiguous is left to the teacher's judgement.

**Question banks that match how schools work** — Subjects → Grades → Topics → Easy/Medium/Hard. Classes detect their grade from their name (`7-A` → Grade 7), and the quiz screen only offers topics for that grade.

**Get questions in fast**
- 📄 *Import from Word/text*: paste a whole yearly plan with `Subject:` / `Grade:` / `Topic:` / `Easy` markers — every question lands in the right place. Turkish markers (`Ders:`, `Konu:`, `Kolay`…) work too. A template is included: [`tools/question-plan-template.txt`](tools/question-plan-template.txt)
- 📝 *Bulk add*: paste many questions at once, one per line or in blocks.
- ⬆ *Import/Export JSON*: share complete question banks with colleagues (questions only — never student data).

**Reports** — every answer is recorded, so you can see success per topic (worst first), per student, and which questions most of the class gets wrong. Filter by class and period, export to Excel-friendly CSV.

**Classroom conveniences** — attendance (tap a name to mark absent; absent students are skipped), pause/resume the timer (Space), keyboard shortcuts (→ correct, ← wrong), fullscreen mode, adjustable timers per difficulty.

**Data safety** — deleted items go to a Trash with 30-day restore, Ctrl+Z undoes the last delete, and the app reminds you when a backup is overdue. Everything can be exported to a single backup file and imported on another computer.

**Sounds** — a carnival tune while names spin, a tick-tock countdown, applause + fanfare for correct, a donk-zonk buzzer for wrong. All synthesized from scratch (no copyright worries) and embedded in the file. Want your own sounds? See [`tools/`](tools/).

## Getting started

1. Download **`quiz-game.html`** (or use the hosted page if this repo has GitHub Pages enabled).
2. Open it in any modern browser.
3. **Classes tab** → add your classes (`7-A, 7-B, 8-A`) and students.
4. **Question Banks tab** → add subjects and topics, then questions (try *📄 Import from Word / text* with the template in `tools/`).
5. **Quiz tab** → pick a mode and play. 🎉

Demo content to try it immediately: import [`demo/demo-question-banks.json`](demo/demo-question-banks.json) from the Question Banks tab (96 questions, 4 subjects, Grades 6–7).

## Where is my data?

All data (classes, students, questions, scores, history) lives in **your browser's storage on your computer** — nothing is sent anywhere. That means:

- The HTML file itself does not contain your data; sharing the file never leaks student names.
- To move between computers (home ↔ school), use **Backup → Export All Data** and import the file on the other machine.
- If the browser's site data is cleared, the data is gone — the app reminds you to keep backups. Please do.

⚠️ **Never commit backup files** (`quiz-backup-*.json`) to a public repository — they contain student names. The included `.gitignore` guards against this.

## Customizing sounds

Everything lives in the `MY_SOUNDS` block near the top of the file's script. Point any sound at your own audio, either as an embedded base64 string (survives sharing the file) or a filename next to the HTML. Helper scripts:

- `tools/make_sound_line.py your.mp3 correct` → prints the line to paste.
- `tools/make_sounds.py` → regenerates the built-in synthesized sounds (Python, `numpy` + `lameenc`).

Python is **only** needed for these optional tools — the game itself needs nothing but a browser.

## Roadmap

- Cloud sync (Firebase) so one teacher's setup follows them across devices
- Question sets ("Lesson 3 review") inside topics
- Image-based questions
- Search across question banks

## Contributing

Issues and pull requests are welcome. The whole app is one HTML file — open it, read it, change it. Keep the single-file philosophy: no build step, no dependencies.

## License

MIT — see [LICENSE](LICENSE). Use it, change it, share it with your school.
