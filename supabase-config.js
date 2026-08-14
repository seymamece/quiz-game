/* Cloud sync settings. Fill these in after creating your Supabase project —
   the steps are in supabase/README.md. Leave them empty and the app simply
   runs without cloud sync, exactly as before.

   Project Settings -> API in the Supabase dashboard:
     SUPABASE_URL       the "Project URL"
     SUPABASE_ANON_KEY  the key labelled "anon public"

   The anon key is meant to be public and is safe to commit — it names the
   project, it does not grant access. Access is decided by the row level
   security policies in supabase/schema.sql.

   Never put the "service_role" key here. It bypasses those policies entirely
   and would expose every teacher's data to anyone who opened the page. */

window.SUPABASE_URL = 'https://oacqveknfmdhsijocujk.supabase.co';
window.SUPABASE_ANON_KEY = 'sb_publishable_z5PdE9cRTrYPBX7MipIR0g_TTVjIeb1';

/* Only staff accounts on this domain may sign in. The app checks it so it can
   explain the refusal, but the check that actually matters is in the database:
   is_school_account() in supabase/schema.sql guards every policy, and a
   browser cannot argue with that. Change it in BOTH places or the two disagree
   — the app would let someone in that the database then ignores. */
window.SCHOOL_EMAIL_DOMAIN = 'gisu.ac.ug';
