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
