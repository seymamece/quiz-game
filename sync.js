/* ==================================================================
   SYNC — cloud backup of the yearly plan, with student names encrypted
   on this device before they ever leave it.

   What the server can see:  class names ("7-A"), grades, subjects,
     topics, questions, scores, which answers were right or wrong.
   What the server cannot see: who the students are. Every student name
     is AES-GCM ciphertext, and the key never leaves this browser.

   The passphrase is the whole security model. It is never sent, never
   stored, and cannot be recovered — losing it loses the names (the
   question bank is unaffected, and local backups still hold everything).
================================================================== */

(function (root) {
  'use strict';

  const subtle = (root.crypto && root.crypto.subtle) || null;
  const MARK = 'enc1:';          // prefix so we never double-encrypt
  const VERIFIER_TEXT = 'gisu-quiz-key-check-v1';
  const PBKDF2_ROUNDS = 250000;  // ~0.2-0.5s on a school laptop; deliberate

  /* ---------- bytes <-> base64, without pulling in a library ---------- */
  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function b64ToBytes(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  /* ---------- key material ---------- */

  /* One random salt per teacher, created once and kept with their row.
     It is not secret; it exists so the same passphrase on two devices
     derives the same key, and so two teachers with the same passphrase
     do not share one. */
  function newSalt() {
    return bytesToB64(root.crypto.getRandomValues(new Uint8Array(16)));
  }

  async function deriveKey(passphrase, saltB64) {
    if (!subtle) throw new Error('WebCrypto unavailable — is this page on https or file://?');
    if (!passphrase) throw new Error('empty passphrase');
    const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase),
      'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  /* ---------- one value at a time ---------- */

  async function encrypt(key, plaintext) {
    const text = plaintext == null ? '' : String(plaintext);
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(text)));
    const joined = new Uint8Array(iv.length + ct.length);
    joined.set(iv, 0); joined.set(ct, iv.length);
    return MARK + bytesToB64(joined);
  }

  async function decrypt(key, blob) {
    if (typeof blob !== 'string' || blob.indexOf(MARK) !== 0) return blob;  // not ours; pass through
    const raw = b64ToBytes(blob.slice(MARK.length));
    const plain = await subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, key, raw.slice(12));
    return new TextDecoder().decode(plain);
  }

  const isEncrypted = v => typeof v === 'string' && v.indexOf(MARK) === 0;

  /* ---------- proving the passphrase is right ----------
     Without this, a typo would silently turn every name into garbage.
     The verifier is stored next to the salt; decrypting it is the check. */

  async function makeVerifier(key) { return encrypt(key, VERIFIER_TEXT); }

  async function checkVerifier(key, blob) {
    try { return (await decrypt(key, blob)) === VERIFIER_TEXT; }
    catch (e) { return false; }        // AES-GCM auth failure = wrong passphrase
  }

  /* ---------- whole state ----------
     Student names live in two places, and both have to be covered:
       classes[id].students[].name   the roster
       attempts[].stuName            copied into every answer record
     Everything else is left readable on purpose, so the question bank
     stays useful even if the passphrase is ever lost. */

  function eachName(state, fn) {
    const jobs = [];
    Object.values((state && state.classes) || {}).forEach(c => {
      ((c && c.students) || []).forEach(s => {
        if (s) jobs.push([s, 'name']);
      });
    });
    ((state && state.attempts) || []).forEach(a => {
      if (a && a.stuName !== undefined) jobs.push([a, 'stuName']);
    });
    return jobs;
  }

  /* Produces the payload that is safe to send. Two jobs, and the second one is
     easy to forget: the trash holds snapshots of everything that was deleted,
     including student objects, and its labels read `Student "Amina"`. Encrypting
     only the roster would have shipped those names in the clear. The trash is a
     30-day local undo — per-device by nature — so it is dropped rather than
     encrypted, which also keeps the payload small. */
  async function encryptState(key, state) {
    const copy = JSON.parse(JSON.stringify(state));
    delete copy.trash;
    for (const [obj, field] of eachName(copy)) {
      if (!isEncrypted(obj[field])) obj[field] = await encrypt(key, obj[field]);
    }
    return copy;
  }

  async function decryptState(key, state) {
    const copy = JSON.parse(JSON.stringify(state));
    let failed = 0;
    for (const [obj, field] of eachName(copy)) {
      if (!isEncrypted(obj[field])) continue;
      try { obj[field] = await decrypt(key, obj[field]); }
      catch (e) { obj[field] = '???'; failed++; }   // keep the row, flag the loss
    }
    return { state: copy, failed };
  }

  /* ================== WHICH WAY DOES DATA MOVE? ==================
     Kept as a pure function so the rule is readable in one place and can be
     tested without a server.

     local.dirty        this device has changes the server has not seen
     local.lastSeen     the server's updated_at as of our last successful sync
     remote.updatedAt   what the server holds now

     If the server moved on since we last looked *and* we have our own unsent
     changes, that is a real conflict: one of the two is going to lose work.
     The app asks instead of guessing. Everything else is unambiguous. */

  function decideSync(local, remote) {
    if (!remote || !remote.exists) {
      return local && local.hasState
        ? { action: 'push', reason: 'nothing in the cloud yet' }
        : { action: 'none', reason: 'nothing anywhere yet' };
    }
    if (!local || !local.hasState) return { action: 'pull', reason: 'this device is empty' };

    const serverMoved = local.lastSeen !== remote.updatedAt;
    if (serverMoved && local.dirty) {
      return { action: 'conflict', reason: 'both this device and the cloud changed since the last sync' };
    }
    if (serverMoved) return { action: 'pull', reason: 'the cloud has a newer copy' };
    if (local.dirty) return { action: 'push', reason: 'this device has unsent changes' };
    return { action: 'none', reason: 'already in sync' };
  }

  /* ================== SUPABASE TRANSPORT ==================
     Plain fetch against the REST and auth endpoints — no client library, so
     nothing extra to bundle and nothing extra to keep up to date.

     The anon key is public by design: it identifies the project, it does not
     grant access. Access comes from the signed-in user's token, and the row
     level security policies in supabase/schema.sql restrict every request to
     that user's own row. */

  const cfg = () => ({ url: (root.SUPABASE_URL || '').replace(/\/+$/, ''), key: root.SUPABASE_ANON_KEY || '' });
  const configured = () => !!(cfg().url && cfg().key);

  const SESSION_KEY = 'quiz-sync-session';
  let session = null;

  function loadSession() {
    if (session) return session;
    try { session = JSON.parse(root.localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
    return session;
  }
  function saveSession(s) {
    session = s;
    try {
      if (s) root.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else root.localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  async function authFetch(path, opts, useAnonOnly) {
    const { url, key } = cfg();
    if (!url || !key) throw new Error('Cloud sync is not configured — see supabase/README.md');
    const o = opts || {};
    const headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, o.headers || {});
    if (!useAnonOnly) {
      const s = await validSession();
      if (!s) throw new Error('not signed in');
      headers.Authorization = 'Bearer ' + s.access_token;
    }
    const res = await root.fetch(url + path, Object.assign({}, o, { headers }));
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = j.error_description || j.msg || j.message || j.error || ''; } catch (e) {}
      const err = new Error(msg || ('request failed (' + res.status + ')'));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  /* ---------- accounts ----------
     The teacher types their own email and password into the app. Nothing here
     stores a password; only the tokens the server hands back are kept. */

  async function signUp(email, password) {
    const out = await authFetch('/auth/v1/signup', {
      method: 'POST', body: JSON.stringify({ email, password })
    }, true);
    // With "Confirm email" on, there is no session until the link is clicked.
    if (out && out.access_token) saveSession(sessionFrom(out));
    return { needsConfirmation: !(out && out.access_token) };
  }

  async function signIn(email, password) {
    const out = await authFetch('/auth/v1/token?grant_type=password', {
      method: 'POST', body: JSON.stringify({ email, password })
    }, true);
    saveSession(sessionFrom(out));
    return currentUser();
  }

  function sessionFrom(out) {
    return {
      access_token: out.access_token,
      refresh_token: out.refresh_token,
      expires_at: Date.now() + ((out.expires_in || 3600) * 1000) - 60000,   // refresh a minute early
      user: out.user ? { id: out.user.id, email: out.user.email } : null
    };
  }

  async function validSession() {
    const s = loadSession();
    if (!s) return null;
    if (Date.now() < s.expires_at) return s;
    try {
      const out = await authFetch('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token })
      }, true);
      saveSession(sessionFrom(out));
      return session;
    } catch (e) {
      saveSession(null);          // refresh token is dead; the teacher signs in again
      return null;
    }
  }

  function currentUser() { const s = loadSession(); return s && s.user; }

  async function signOut() {
    try { await authFetch('/auth/v1/logout', { method: 'POST' }); } catch (e) {}
    saveSession(null);
  }

  /* ---------- the row ---------- */

  async function fetchRemote() {
    const s = await validSession();
    if (!s || !s.user) throw new Error('not signed in');
    const rows = await authFetch('/rest/v1/quiz_state?select=*&user_id=eq.' + encodeURIComponent(s.user.id), { method: 'GET' });
    if (!rows || !rows.length) return { exists: false };
    const r = rows[0];
    return { exists: true, updatedAt: r.updated_at, payload: r.payload, salt: r.salt, verifier: r.verifier, device: r.device };
  }

  async function pushRemote(payload, salt, verifier, device) {
    const s = await validSession();
    if (!s || !s.user) throw new Error('not signed in');
    const rows = await authFetch('/rest/v1/quiz_state?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{ user_id: s.user.id, payload, salt, verifier, device: device || 'a device' }])
    });
    return rows && rows[0] ? rows[0].updated_at : null;
  }

  const api = { newSalt, deriveKey, encrypt, decrypt, isEncrypted, makeVerifier, checkVerifier,
                encryptState, decryptState, MARK, PBKDF2_ROUNDS,
                decideSync, configured, signUp, signIn, signOut, currentUser, validSession,
                fetchRemote, pushRemote, SESSION_KEY };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QuizCrypto = api;
  root.QuizSync = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);
