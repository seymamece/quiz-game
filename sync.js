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

  async function encryptState(key, state) {
    const copy = JSON.parse(JSON.stringify(state));
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

  const api = { newSalt, deriveKey, encrypt, decrypt, isEncrypted, makeVerifier, checkVerifier,
                encryptState, decryptState, MARK, PBKDF2_ROUNDS };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QuizCrypto = api;

})(typeof globalThis !== 'undefined' ? globalThis : this);
