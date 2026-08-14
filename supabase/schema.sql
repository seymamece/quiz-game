-- GISU Quiz Game — Supabase schema
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> Run.
-- Safe to run again; every statement is guarded.
--
-- The design is deliberately one row per teacher holding their whole state as
-- JSON, because that is exactly what the app already keeps in localStorage.
-- Splitting classes, students, topics and questions into separate tables would
-- buy nothing here — a teacher's data is only ever read and written as a whole
-- by that one teacher — and would multiply the number of policies that have to
-- be right.
--
-- WHAT THIS TABLE HOLDS
--   payload   the state, with every student name already AES-GCM encrypted in
--             the browser. The server never sees a readable student name and
--             never holds the key.
--   salt      per-teacher PBKDF2 salt. Not secret; needed so the same
--             passphrase derives the same key on a second device.
--   verifier  ciphertext of a known string, used by the client to tell a
--             mistyped passphrase from a right one.
--
-- The anon key shipped in the page is public by design. It grants nothing on
-- its own: every policy below requires a signed-in user, and restricts them to
-- their own row.

create extension if not exists pgcrypto;

create table if not exists public.quiz_state (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  payload     jsonb       not null default '{}'::jsonb,
  salt        text,
  verifier    text,
  device      text,
  updated_at  timestamptz not null default now()
);

comment on table  public.quiz_state is
  'One row per teacher: their whole quiz state. Student names inside payload are encrypted client-side.';
comment on column public.quiz_state.salt is
  'PBKDF2 salt, not secret. Lets the same passphrase derive the same key on another device.';
comment on column public.quiz_state.verifier is
  'Ciphertext of a fixed string, so the client can detect a mistyped passphrase.';
comment on column public.quiz_state.device is
  'Label of the device that wrote last, shown to the teacher when versions differ.';

-- Row Level Security ---------------------------------------------------------
-- This is the actual protection. Without it, anyone holding the public anon key
-- could read every teacher's row.

alter table public.quiz_state enable row level security;
-- Applies the policies to the table owner too, so a mistake cannot bypass them.
alter table public.quiz_state force row level security;

-- The policies themselves are further down, after is_school_account() exists.
-- No policy is granted to the `anon` role anywhere in this file. An
-- unauthenticated caller with the anon key can therefore read nothing.

-- Keep updated_at honest ------------------------------------------------------
-- Set server-side so a device with a wrong clock cannot claim to be newest.

create or replace function public.quiz_state_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists quiz_state_touch on public.quiz_state;
create trigger quiz_state_touch
  before insert or update on public.quiz_state
  for each row execute function public.quiz_state_touch();

-- Size guard ------------------------------------------------------------------
-- A yearly plan is a few hundred KB. This stops a bug or a runaway import from
-- filling the project's storage, and gives a clear error instead of a slow one.

alter table public.quiz_state drop constraint if exists quiz_state_payload_size;
alter table public.quiz_state add constraint quiz_state_payload_size
  check (pg_column_size(payload) < 5 * 1024 * 1024);

-- ============================================================================
-- ANSWER RECORDS
--
-- Kept out of quiz_state.payload on purpose. Answers are about 80% of a
-- teacher's data by June, and they only ever get appended — so carrying them
-- inside the one big JSON document meant re-uploading the entire year every
-- time a child answered a question. Here they are rows, and a lesson sends the
-- handful it produced.
--
-- id is generated on the device and is the reason a retry is harmless: the same
-- answer can be sent twice and lands once.
--
-- stu_name is CIPHERTEXT, exactly as in quiz_state. That is the trade this
-- design makes: the server can group by topic, level or correctness, because
-- those are plain, but it can never group by student, because it cannot read
-- who they are. Per-student reports are therefore worked out on the device.
-- ============================================================================

create table if not exists public.quiz_attempts (
  user_id     uuid        not null references auth.users(id) on delete cascade,
  id          text        not null,          -- generated on the device
  ts          timestamptz not null,
  cls_id      text,
  cls_name    text,
  grade_key   text,
  subj_id     text,
  subj_name   text,
  topic_id    text,
  topic_name  text,
  level       text,
  stu_id      text,
  stu_name    text,                          -- encrypted; opaque to the server
  q_id        text,
  q_text      text,
  correct     boolean     not null,
  primary key (user_id, id)
);

comment on table public.quiz_attempts is
  'One row per answered question. Append-only. stu_name is encrypted client-side.';
comment on column public.quiz_attempts.id is
  'Generated on the device so a resend is idempotent rather than a duplicate.';

-- Reports filter by class and by period, and sync asks "what is newer than X".
create index if not exists quiz_attempts_user_ts on public.quiz_attempts (user_id, ts desc);
create index if not exists quiz_attempts_user_cls_ts on public.quiz_attempts (user_id, cls_id, ts desc);

alter table public.quiz_attempts enable row level security;
alter table public.quiz_attempts force row level security;

-- ============================================================================
-- WHO IS ALLOWED IN
--
-- Teachers sign in with their school Google account. Google will happily
-- authenticate any account it knows, so being signed in is not by itself a
-- reason to be let in — this is where that line is drawn, and it is drawn in
-- the database because a browser can be argued with and Postgres cannot.
--
-- Compared on the exact domain rather than with a wildcard: "%@gisu.ac.ug"
-- would also match someone@notgisu.ac.ug.
--
-- To change schools, edit the domain here AND in supabase-config.js. If the two
-- disagree the app lets someone in that the database then ignores, and they see
-- an empty screen with no explanation.
-- ============================================================================

create or replace function public.is_school_account()
returns boolean
language sql
stable
as $$
  select split_part(lower(coalesce(auth.jwt() ->> 'email', '')), '@', 2) = 'gisu.ac.ug'
$$;

comment on function public.is_school_account is
  'True when the signed-in account belongs to the school domain. Guards every policy.';

-- quiz_state -----------------------------------------------------------------
drop policy if exists "read own state"   on public.quiz_state;
drop policy if exists "insert own state" on public.quiz_state;
drop policy if exists "update own state" on public.quiz_state;
drop policy if exists "delete own state" on public.quiz_state;

create policy "read own state" on public.quiz_state
  for select to authenticated
  using (auth.uid() = user_id and public.is_school_account());

create policy "insert own state" on public.quiz_state
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_school_account());

create policy "update own state" on public.quiz_state
  for update to authenticated
  using (auth.uid() = user_id and public.is_school_account())
  with check (auth.uid() = user_id and public.is_school_account());

create policy "delete own state" on public.quiz_state
  for delete to authenticated
  using (auth.uid() = user_id and public.is_school_account());

-- quiz_attempts --------------------------------------------------------------
drop policy if exists "read own attempts"   on public.quiz_attempts;
drop policy if exists "insert own attempts" on public.quiz_attempts;
drop policy if exists "update own attempts" on public.quiz_attempts;
drop policy if exists "delete own attempts" on public.quiz_attempts;

create policy "read own attempts" on public.quiz_attempts
  for select to authenticated
  using (auth.uid() = user_id and public.is_school_account());

create policy "insert own attempts" on public.quiz_attempts
  for insert to authenticated
  with check (auth.uid() = user_id and public.is_school_account());

create policy "update own attempts" on public.quiz_attempts
  for update to authenticated
  using (auth.uid() = user_id and public.is_school_account())
  with check (auth.uid() = user_id and public.is_school_account());

create policy "delete own attempts" on public.quiz_attempts
  for delete to authenticated
  using (auth.uid() = user_id and public.is_school_account());
