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

drop policy if exists "read own state"   on public.quiz_state;
drop policy if exists "insert own state" on public.quiz_state;
drop policy if exists "update own state" on public.quiz_state;
drop policy if exists "delete own state" on public.quiz_state;

create policy "read own state" on public.quiz_state
  for select to authenticated using (auth.uid() = user_id);

create policy "insert own state" on public.quiz_state
  for insert to authenticated with check (auth.uid() = user_id);

create policy "update own state" on public.quiz_state
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own state" on public.quiz_state
  for delete to authenticated using (auth.uid() = user_id);

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
