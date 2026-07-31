# Cloud sync setup

One-time setup, done by you in the Supabase dashboard. Nothing here needs a
terminal, and the app keeps working without any of it — sync is an addition to
`localStorage`, not a replacement.

## What ends up on the server

| Stored readable | Stored encrypted | Never stored |
|---|---|---|
| Class names (`7-A`), grades | Student names | Your passphrase |
| Subjects, topics, questions | The copy of each name kept in answer records | The encryption key |
| Scores, right/wrong per answer | | |

Student names are encrypted in your browser before anything is sent. Supabase
holds the ciphertext and never holds the key, so a database dump — or a leaked
API key — does not reveal who your students are.

**The passphrase cannot be recovered.** If you forget it, the names are gone and
you re-enter them; the question bank, scores and everything else still open
normally. Keep using **Backup → Export All Data** as well: that file is complete
and readable, and it is your real safety net.

## Steps

### 1. Create the project

1. Sign in at <https://supabase.com> and create a new project.
2. Choose a region close to Uganda — **eu-central-1 (Frankfurt)** is usually the
   quickest of the available ones.
3. Wait for it to finish provisioning.

### 2. Create the table and its policies

1. Open **SQL Editor → New query**.
2. Paste the whole of [`schema.sql`](schema.sql) and press **Run**.
3. Confirm it says success. Running it twice is harmless.

### 3. Check that Row Level Security is really on

This is the step that matters. The key in the page is public by design; RLS is
what stops one teacher from reading another's data.

1. **Table Editor → `quiz_state`**. There should be a green **RLS enabled** badge.
2. **Authentication → Policies**. You should see exactly four policies on
   `quiz_state`, all for the `authenticated` role, none for `anon`.

If the badge says RLS is disabled, stop and re-run `schema.sql` — do not put
real student data in until it is on.

### 4. Turn on email sign-in

1. **Authentication → Providers → Email**: enabled.
2. Turn **Confirm email** on.
3. **Authentication → URL Configuration → Site URL**: the address you open the
   app from, e.g. `https://seymamece.github.io/quiz-game/`.
   Add the same address under **Redirect URLs**.

Sign-in happens in the app itself — type your own email and password there. Do
not paste account credentials into a chat, including to me.

### 5. Give the app its address

**Project Settings → API** has two values you need:

- **Project URL** — like `https://abcdefgh.supabase.co`
- **anon public** key — the long one labelled `anon`, *not* `service_role`

Put them in `supabase-config.js` next to `index.html`:

```js
window.SUPABASE_URL = 'https://abcdefgh.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

The anon key is meant to be public and is safe in the repository — it is the
address, not the lock. **The `service_role` key is the opposite: it ignores RLS
entirely.** Never put it in this file, in the repo, or anywhere the browser can
reach.

## If you ever want to wipe the cloud copy

**SQL Editor**, then:

```sql
delete from public.quiz_state where user_id = auth.uid();
```

Your device keeps its own copy; this only clears the server.
