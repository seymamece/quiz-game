#!/usr/bin/env node
/*
 * Self-test for the parts of game.js where a mistake would be invisible in the
 * classroom: how imported question banks are parsed, how typed answers are
 * judged, and whether user-supplied names can reach innerHTML.
 *
 * No dependencies and no build step — the functions are lifted straight out of
 * game.js and run with only the helpers they need stubbed.
 *
 * Run:  node tools/selftest.js
 */

const fs = require('fs');
const path = require('path');

const GAME = path.join(__dirname, '..', 'game.js');
const src = fs.readFileSync(GAME, 'utf8');

function grab(name) {
  const m = src.match(new RegExp('^function ' + name + '\\b[\\s\\S]*?^}', 'm'));
  if (!m) throw new Error('could not find function ' + name + ' in game.js');
  return m[0];
}

const LEVELS = ['easy', 'medium', 'hard'];
let seq = 0;
const newId = p => p + '_' + (++seq);
const emptyQ = () => ({ easy: [], medium: [], hard: [] });
const SUBSUP = eval('(' + src.match(/^const SUBSUP=(\{.*?\});/m)[1] + ')');

const F = new Function('LEVELS', 'newId', 'emptyQ', 'SUBSUP',
  [grab('gradesFromAnyFormat'), grab('mergeIntoSubject'), grab('normAns'), grab('typedMatches')].join('\n') +
  '\nreturn {gradesFromAnyFormat,mergeIntoSubject,normAns,typedMatches};'
)(LEVELS, newId, emptyQ, SUBSUP);

const results = [];
function test(name, fn) {
  let outcome;
  try { outcome = fn(); } catch (e) { outcome = 'threw: ' + e.message; }
  results.push({ name, ok: outcome === true, detail: outcome === true ? '' : String(outcome) });
}

/* ---------- imported banks are untrusted input ---------- */

test('a "__proto__" grade key does not pollute Object.prototype', () => {
  F.gradesFromAnyFormat(JSON.parse(
    '{"name":"X","grades":{"__proto__":{"topics":{"t":{"name":"n","questions":{"easy":[{"q":"a","a":"b"}]}}}}}}'));
  return {}.topics === undefined || 'Object.prototype was modified';
});

test('a "constructor" grade key does not pollute Object.prototype', () => {
  F.gradesFromAnyFormat(JSON.parse('{"grades":{"constructor":{"topics":{}}}}'));
  return {}.polluted === undefined || 'Object.prototype was modified';
});

test('imported topic keys are replaced with generated ids', () => {
  const out = F.gradesFromAnyFormat(JSON.parse(
    '{"grades":{"7":{"topics":{"__proto__":{"name":"n","questions":{"easy":[{"q":"a"}]}}}}}}'));
  const keys = Object.keys(out['7'].topics);
  return keys.every(k => /^t_/.test(k)) || 'raw imported key kept: ' + keys.join(',');
});

test('merging a bank with a "__proto__" grade key does not pollute', () => {
  try { F.mergeIntoSubject({ id: 's', name: 'Mine', grades: {} }, JSON.parse('{"__proto__":{"topics":{}}}')); }
  catch (e) { /* the import handler catches this and shows "Could not read this file" */ }
  return {}.topics === undefined || 'Object.prototype was modified';
});

test('a missing questions block imports as an empty topic', () => {
  const out = F.gradesFromAnyFormat(JSON.parse('{"grades":{"7":{"topics":{"t":{"name":"n"}}}}}'));
  return Object.values(out['7'].topics)[0].questions.easy.length === 0 || 'unexpected questions';
});

test('null topics imports as no topics', () => {
  const out = F.gradesFromAnyFormat(JSON.parse('{"grades":{"7":{"topics":null}}}'));
  return Object.keys(out['7'].topics).length === 0 || 'unexpected topics';
});

test('a non-string question body is kept as data, not dropped', () => {
  const out = F.gradesFromAnyFormat(JSON.parse(
    '{"grades":{"7":{"topics":{"t":{"name":{"a":1},"questions":{"easy":[{"q":{"x":2},"a":["y"]}]}}}}}}'));
  return Object.values(out['7'].topics)[0].questions.easy.length === 1 || 'question lost';
});

/* ---------- typed answers: lenient enough to be useful, strict enough to mean something ---------- */

const ACCEPT = [
  ['water', 'Water', 'case'],
  ['  water  ', 'Water', 'surrounding spaces'],
  ['Paris.', 'Paris', 'punctuation'],
  ['H2O', 'H₂O', 'plain digits for a subscript'],
  ['h₂o', 'H2O', 'subscript for plain digits'],
  ['CO2', 'CO₂', 'another subscript'],
  ['100°C', '100°C / 212°F', 'first alternative'],
  ['212F', '100°C / 212°F', 'second alternative'],
  ['alveoli', 'B) Alveoli', 'option label ignored'],
  ['alveoli', 'The alveoli', 'answer written with an article'],
  ['the powerhouse of the cell is the mitochondria', 'Mitochondria', 'answer inside a sentence'],
  ['mitochondri', 'Mitochondria', 'almost the whole word']
];
const REJECT = [
  ['a', 'Alveoli', 'single letter'],
  ['up', 'Jupiter', 'two-letter fragment'],
  ['is', 'Mitosis', 'fragment in the middle'],
  ['ox', 'Oxygen', 'short prefix'],
  ['gen', 'Hydrogen', 'short suffix'],
  ['cury', 'Mercury', 'partial suffix'],
  ['photo', 'Photosynthesis', 'prefix that is too short'],
  ['trachea', 'B) Alveoli', 'a different answer'],
  ['', 'Water', 'empty'],
  ['x', 'Water', 'one wrong letter']
];

test('typed answers that must count (' + ACCEPT.length + ')', () => {
  const bad = ACCEPT.filter(c => F.typedMatches(c[0], c[1]) !== true).map(c => `${c[2]}: "${c[0]}" vs "${c[1]}"`);
  return bad.length === 0 || bad.join('; ');
});

test('typed answers that must not count (' + REJECT.length + ')', () => {
  const bad = REJECT.filter(c => F.typedMatches(c[0], c[1]) !== false).map(c => `${c[2]}: "${c[0]}" vs "${c[1]}"`);
  return bad.length === 0 || bad.join('; ');
});

/* ---------- names must not reach innerHTML ---------- */

test('showToast sets its message as text, not HTML', () => {
  const fn = grab('showToast');
  if (/innerHTML/.test(fn)) return 'showToast writes innerHTML again — delete labels quote imported topic and question names';
  return /textContent/.test(fn) || 'showToast no longer sets textContent';
});

/* ---------- the confetti bundle ----------
   fireConfetti() bails out quietly when the global is missing, so a wrong
   script tag costs the celebration and says nothing. It went unnoticed once
   already: the page pointed at a cdnjs URL that had always 404'd. */

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('index.html loads confetti from vendor/, not a CDN', () => {
  const tags = [...indexHtml.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]);
  const remote = tags.filter(s => /^https?:|^\/\//.test(s));
  if (remote.length) return 'script loaded over the network: ' + remote.join(', ');
  return tags.some(s => /^vendor\/confetti/.test(s)) || 'no vendor/confetti script tag: ' + tags.join(', ');
});

test('the vendored confetti is the browser build', () => {
  const src2 = [...indexHtml.matchAll(/<script[^>]*src="(vendor\/[^"]+)"/g)].map(m => m[1])[0];
  if (!src2) return 'no vendored script to check';
  const file = path.join(__dirname, '..', src2);
  if (!fs.existsSync(file)) return src2 + ' is referenced but missing';
  const lib = fs.readFileSync(file, 'utf8');
  // The CommonJS builds pass a bare `module` and never touch window.
  if (!/window\.confetti\s*=/.test(lib)) {
    return src2 + ' never assigns window.confetti — this looks like the CommonJS build, ' +
      'which throws "module is not defined" in a script tag. Use dist/confetti.browser.js.';
  }
  return true;
});

/* ---------- cache busting ----------
   GitHub Pages serves everything with max-age=600 and the edge caches age
   independently, so a browser can hold a fresh index.html next to a ten-minute-
   old game.js. That mismatch is invisible and looks like a broken feature: the
   new markup renders, none of its handlers exist. The ?v= stamp makes a new
   deploy a new URL, so the pair can never be mixed. */

const VERSIONED = ['style.css', 'supabase-config.js', 'sync.js', 'game.js'];

function assetVersion() {
  const h = require('crypto').createHash('sha256');
  // normalise line endings: a clone may check out CRLF where the repo holds LF
  for (const a of VERSIONED) h.update(fs.readFileSync(path.join(__dirname, '..', a), 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 8);
}

test('every local script and stylesheet carries a ?v= stamp', () => {
  const missing = VERSIONED.filter(a => !new RegExp('(src|href)="' + a.replace('.', '\\.') + '\\?v=').test(indexHtml));
  return missing.length === 0 || 'no cache-busting stamp on: ' + missing.join(', ');
});

test('no asset is loaded twice', () => {
  // Updating a stamp by pasting a fresh tag instead of editing the old one
  // leaves two. A duplicate stylesheet is only waste; a duplicate game.js runs
  // the whole app a second time — every handler bound twice, init run twice.
  const refs = [...indexHtml.matchAll(/(?:src|href)="([^"?]+)(?:\?[^"]*)?"/g)]
    .map(m => m[1])
    .filter(f => VERSIONED.includes(f));
  const seen = {}, dupes = [];
  for (const f of refs) { seen[f] = (seen[f] || 0) + 1; }
  for (const f of Object.keys(seen)) if (seen[f] > 1) dupes.push(`${f} (${seen[f]}x)`);
  return dupes.length === 0 || 'loaded more than once: ' + dupes.join(', ');
});

test('the ?v= stamp matches what the files actually contain', () => {
  const want = assetVersion();
  // only the hashed assets — other files (the favicon, say) carry their own stamp
  const stamps = VERSIONED.map(a => {
    const m = indexHtml.match(new RegExp('(?:src|href)="' + a.replace('.', '\\.') + '\\?v=([0-9a-z]+)"'));
    return m && m[1];
  }).filter(Boolean);
  const wrong = [...new Set(stamps)].filter(s => s !== want);
  if (wrong.length) {
    return 'index.html says v=' + wrong.join('/') + ' but the files hash to ' + want +
      '. Update the ?v= stamps in index.html to ' + want + ', or teachers will keep running ' +
      'a half-updated app after this deploy.';
  }
  return stamps.length > 0 || 'no stamps found at all';
});

test('checking the cloud does not download the whole payload', () => {
  // The payload is a year of questions, answer records and diagrams — several
  // megabytes by June. Deciding which way to sync needs a timestamp. Fetching
  // the payload for that turned every app open into a full download.
  const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');
  const meta = syncSrc.match(/async function fetchRemoteMeta[\s\S]*?\n  \}/);
  if (!meta) return 'fetchRemoteMeta is gone — the check has no cheap path any more';
  if (/payload/.test(meta[0])) return 'the cheap check asks for the payload again';
  if (!/fetchRemotePayload/.test(syncSrc)) return 'nothing can fetch the payload when a pull is needed';
  // select=* is fine on quiz_attempts — those rows are small and wanted in full.
  // On quiz_state it would drag the payload back in.
  if (/quiz_state\?select=\*/.test(syncSrc)) return 'a select=* on quiz_state is back: that pulls the payload';

  const doSync = src.match(/^async function doSync[\s\S]*?\n\}/m);
  if (!doSync) return 'doSync is gone';
  if (!/fetchRemoteMeta\(\)/.test(doSync[0])) return 'doSync no longer uses the cheap check';
  // the payload fetch must sit inside the pull branch, not before the decision
  const beforeDecision = doSync[0].slice(0, doSync[0].indexOf('decideSync'));
  return !/fetchRemotePayload/.test(beforeDecision)
    || 'the payload is fetched before the decision, so it downloads even when nothing changed';
});

test('only school accounts are let in, checked on the exact domain', () => {
  const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');
  const m = syncSrc.match(/function isSchoolAccount[\s\S]*?\n  \}/);
  if (!m) return 'the domain check is gone from the client';
  const { isSchoolAccount } = new Function('root',
    'const String_=String;' + m[0] +
    '\nfunction schoolDomain(){return String(root.SCHOOL_EMAIL_DOMAIN||"").toLowerCase();}' +
    '\nreturn {isSchoolAccount};')({ SCHOOL_EMAIL_DOMAIN: 'gisu.ac.ug' });

  const allow = ['a.teacher@gisu.ac.ug', 'A.Teacher@GISU.AC.UG'];
  const deny = [
    'someone@notgisu.ac.ug',       // the wildcard trap: "%@gisu.ac.ug" matches this
    'someone@gisu.ac.ug.evil.com',
    'teacher@gmail.com',
    'teacher@gisu.ac.ugx',
    'no-at-sign', ''
  ];
  const wrong = allow.filter(e => isSchoolAccount(e) !== true).map(e => 'refused ' + e)
    .concat(deny.filter(e => isSchoolAccount(e) !== false).map(e => 'admitted ' + e));
  return wrong.length === 0 || wrong.join('; ');
});

test('the database enforces the domain too, on every policy', () => {
  // The client check only explains the refusal. This is the one that holds:
  // a signed-in Google account from anywhere gets nothing without it.
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  if (!/create or replace function public\.is_school_account/.test(sql)) {
    return 'is_school_account() is gone — any Google account would have full access';
  }
  if (/like\s+'%@/.test(sql)) return 'a wildcard domain match is back: it also matches notgisu.ac.ug';
  const policies = [...sql.matchAll(/create policy "([^"]+)" on public\.(quiz_state|quiz_attempts)[\s\S]*?;/g)];
  if (policies.length < 8) return 'expected eight policies, found ' + policies.length;
  const unguarded = policies.filter(p => !/is_school_account\(\)/.test(p[0])).map(p => p[1]);
  return unguarded.length === 0 || 'these let any account through: ' + unguarded.join(', ');
});

test('the app and the database agree on the domain', () => {
  const conf = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
  const inApp = (conf.match(/SCHOOL_EMAIL_DOMAIN\s*=\s*'([^']*)'/) || [])[1];
  // the expression nests parentheses, so match on the tail rather than the call
  const inDb = (sql.match(/split_part\([\s\S]*?,\s*2\)\s*=\s*'([^']*)'/) || [])[1];
  if (!inApp) return 'no SCHOOL_EMAIL_DOMAIN in supabase-config.js';
  if (!inDb) return 'no domain in is_school_account()';
  return inApp === inDb
    || `the app allows @${inApp} but the database allows @${inDb}. Someone would sign in ` +
       'successfully and then find every screen empty, with nothing explaining why.';
});

test('clearing report history also clears it in the cloud', () => {
  // Answers are rows in their own table now. Deleting them only on this device
  // means the next sync pulls them straight back, and the teacher watches
  // history they deleted reappear with no explanation.
  const h = src.match(/getElementById\('rpClear'\)\.onclick[\s\S]*?\n\};/);
  if (!h) return 'the clear-history handler is gone';
  if (!/S\.attempts=S\.attempts\.filter/.test(h[0])) return 'it no longer clears locally';
  return /deleteAttempts\(/.test(h[0])
    || 'it clears locally only, so the rows come back on the next sync';
});

test('only unsent answers are uploaded', () => {
  // The point of the separate table: a lesson sends the answers it produced,
  // not the year. Pushing S.attempts wholesale would undo that.
  const doSync = src.match(/^async function doSync[\s\S]*?\n\}/m);
  if (!doSync) return 'doSync is gone';
  const push = doSync[0].slice(doSync[0].indexOf("d.action==='push'"));
  if (!/pushAttempts\(/.test(push)) return 'answers are not sent as rows any more';
  if (!/attemptsSyncedTs/.test(push)) return 'nothing tracks which answers have already gone';
  return /filter\(a=>a\.ts>=since\)/.test(push)
    || 'the whole history is uploaded instead of what is new';
});

test('an automatic push waits out the gaps between questions', () => {
  const m = src.match(/const AUTO_DELAY=(\d+)/);
  if (!m) return 'AUTO_DELAY is gone';
  const ms = +m[1];
  if (ms < 60000) {
    return `AUTO_DELAY is ${ms}ms. Answers in a lesson arrive further apart than that, so the ` +
      'timer fires between each one and uploads the entire payload every time — about 25 full ' +
      'uploads per lesson. Keep it above a minute.';
  }
  // ...but something has to send it when the teacher stops for the day
  return /visibilitychange/.test(src)
    || 'nothing pushes when the teacher switches away, so a long delay could strand a lesson';
});

test('the looping draw music can always be silenced', () => {
  // It loops now, so unlike a fixed clip it never stops on its own. Every way
  // out of a draw has to stop it or it plays over the next lesson.
  if (!/playFile\(MY_SOUNDS\.spin,\s*1,\s*true\)/.test(src)) return 'the draw music no longer loops';
  const needs = [
    ['the question screen', /^function startQuestion[\s\S]*?\n\}/m],
    ['going back to idle', /^function showIdle\(\)[\s\S]*?\n\}/m]
  ];
  const missing = needs.filter(([, re]) => { const m = src.match(re); return !m || !/sndSpinStop\(\)/.test(m[0]); })
    .map(n => n[0]);
  if (missing.length) return 'nothing stops it on: ' + missing.join('; ');
  // switching tabs and muting are the two ways to leave a draw running
  const nav = src.match(/document\.querySelectorAll\('nav button'\)\.forEach[\s\S]*?\n\}\);/);
  if (!nav || !/sndSpinStop\(\)/.test(nav[0])) return 'switching tabs would leave the music playing';
  const mute = src.match(/getElementById\('soundBtn'\)\.onclick[\s\S]*?\n\};/);
  if (!mute || !/sndSpinStop\(\)/.test(mute[0])) return 'muting would not silence a loop already playing';
  return true;
});

test('every nav tab points at a section that exists', () => {
  // data-tab is wiring, not a label: game.js builds the section id from it, so
  // renaming the value to something friendlier silently kills the tab and
  // throws on click. Easy to do while tidying the wording.
  const tabs = [...indexHtml.matchAll(/data-tab="([^"]*)"/g)].map(m => m[1]);
  const ids = new Set([...indexHtml.matchAll(/id="tab-([^"]*)"/g)].map(m => m[1]));
  if (!tabs.length) return 'no nav tabs found at all';
  const broken = tabs.filter(t => !ids.has(t));
  return broken.length === 0
    || broken.map(t => `data-tab="${t}" has no <section id="tab-${t}">`).join('; ');
});

test('images referenced by the README are in the repo', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  const local = [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
    .filter(u => !/^https?:/.test(u));
  const missing = local.filter(u => !fs.existsSync(path.join(__dirname, '..', decodeURIComponent(u))));
  return missing.length === 0 || 'broken image on the front page: ' + missing.join(', ');
});

test('the tab icon is declared and the files are there', () => {
  const refs = [...indexHtml.matchAll(/<link[^>]*rel="(?:icon|apple-touch-icon)"[^>]*href="([^"?]+)/g)].map(m => m[1]);
  if (!refs.length) return 'no favicon declared — the browser tab falls back to a grey globe';
  const missing = refs.filter(r => !fs.existsSync(path.join(__dirname, '..', r)));
  return missing.length === 0 || 'declared but not in the repo: ' + missing.join(', ');
});

/* ---------- installable app ----------
   A service worker is the fastest way to strand every teacher on an old
   version, which is exactly the failure this project has already had once. */

const swSrc = fs.existsSync(path.join(__dirname, '..', 'sw.js'))
  ? fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8') : '';

test('the service worker version matches the asset stamp', () => {
  if (!swSrc) return 'sw.js is gone — the app is no longer installable or offline';
  const inSw = (swSrc.match(/const VERSION = '([0-9a-f]+)'/) || [])[1];
  const want = assetVersion();
  return inSw === want
    || `sw.js says ${inSw} but the files hash to ${want}. Update VERSION in sw.js, or the ` +
       'cached shell keeps serving the previous release.';
});

test('the service worker never caches Supabase', () => {
  if (!swSrc) return 'sw.js is gone';
  // Checking the word appears somewhere is not enough — a comment would satisfy
  // that. The fetch handler has to actually bail out before it touches a cache.
  const fetchStart = swSrc.indexOf("addEventListener('fetch'");
  if (fetchStart < 0) return 'no fetch handler at all';
  const handler = swSrc.slice(fetchStart);
  const firstCache = handler.indexOf('caches.');
  const head = firstCache < 0 ? handler : handler.slice(0, firstCache);
  if (!/supabase/i.test(head)) {
    return 'nothing excludes the API before the cache is consulted. A cached sync response ' +
      'would hand back stale data as if it were live, and a teacher would never know.';
  }
  return /return;/.test(head)
    || 'the API is recognised but not skipped — it needs an early return, not just a check';
});

test('the page itself is fetched network-first', () => {
  if (!swSrc) return 'sw.js is gone';
  const nav = swSrc.slice(swSrc.indexOf("req.mode === 'navigate'"));
  if (!nav) return 'navigation requests are not handled separately';
  const beforeCache = nav.slice(0, nav.indexOf('caches.match'));
  return /await fetch\(req\)/.test(beforeCache)
    || 'index.html is served from cache first. It is what names the current ?v= stamps, so ' +
       'cached-first means a new deploy can never arrive.';
});

test('the manifest is linked and its icons exist', () => {
  if (!/<link[^>]*rel="manifest"/.test(indexHtml)) return 'no manifest link — nothing offers to install';
  const p = path.join(__dirname, '..', 'manifest.json');
  if (!fs.existsSync(p)) return 'manifest.json is referenced but missing';
  let man;
  try { man = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return 'manifest.json is not valid JSON'; }
  for (const k of ['name', 'start_url', 'display', 'icons']) {
    if (!man[k]) return 'manifest.json has no ' + k;
  }
  const missing = (man.icons || []).map(i => i.src)
    .filter(s => !fs.existsSync(path.join(__dirname, '..', s)));
  if (missing.length) return 'icons declared but not in the repo: ' + missing.join(', ');
  const sizes = (man.icons || []).map(i => i.sizes);
  return (sizes.includes('192x192') && sizes.includes('512x512'))
    || 'Android wants a 192 and a 512; got ' + sizes.join(', ');
});

/* ---------- pictures attached to questions ----------
   A picture can arrive inside an imported bank, so its value is as untrusted
   as the question text around it. */

test('only a real data:image URI is allowed into a src attribute', () => {
  const m = src.match(/^const IMG_URI_RE[\s\S]*?^function imgTag[\s\S]*?^\}/m);
  if (!m) return 'the picture validator is gone — an imported bank could inject markup';
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const { safeImgUri, imgTag } = new Function('esc',
    m[0] + '; return {safeImgUri, imgTag};')(esc);

  const ok = 'data:image/png;base64,iVBORw0KGgo=';
  if (safeImgUri(ok) !== ok) return 'a genuine picture was rejected';
  if (!/<img class="stageImg" src="data:image\/png;base64,iVBORw0KGgo="/.test(imgTag(ok, 'stageImg')))
    return 'a genuine picture did not render';

  const hostile = [
    'data:image/png;base64,x" onerror="alert(1)',
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'https://example.com/tracker.png',      // would phone home from a lesson
    '"><script>alert(1)</script>',
    'data:image/svg+xml;base64,PHN2Zz4='    // SVG can carry script
  ];
  const leaked = hostile.filter(h => imgTag(h, 'stageImg') !== '');
  return leaked.length === 0 || 'these reached the page: ' + leaked.join(' | ');
});

test('a question picture is actually rendered where it is needed', () => {
  // Defining the validator is not the same as using it. It was defined,
  // committed and unused: pictures saved fine and never appeared in a quiz.
  const places = [
    ['the individual/group question screen', /^function startQuestion[\s\S]*?\n\}/m, /imgTag\(q\.img/],
    ['the Beat the Clock screen', /^function beatNextQuestion[\s\S]*?\n\}/m, /imgTag\(pick\.q\.img/],
    ['the question list thumbnail', /^function renderQuestions[\s\S]*?\n\}/m, /safeImgUri\(it\.img\)/]
  ];
  const missing = places.filter(([, fn, use]) => {
    const m = src.match(fn);
    return !m || !use.test(m[0]);
  }).map(p => p[0]);
  return missing.length === 0 || 'pictures would not show on: ' + missing.join('; ');
});

test('a remembered passphrase is opt-in, checked, and dropped on sign-out', () => {
  const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'sync.js'), 'utf8');
  // The key goes into IndexedDB as a CryptoKey, not into localStorage as bytes.
  // It is created non-extractable, so a script can use it but not copy it out —
  // which matters here, given this app has had an XSS.
  if (!/indexedDB/i.test(syncSrc)) return 'the key store is gone';
  if (/localStorage[\s\S]{0,80}cloudKey|setItem\([^)]*[Kk]ey[^)]*key/.test(syncSrc)) {
    return 'raw key material looks like it is going into localStorage, where any script can read it';
  }
  const derive = syncSrc.match(/function deriveKey[\s\S]*?\n  \}/);
  if (derive && /true,\s*\['encrypt'/.test(derive[0])) {
    return 'the key is derived as extractable, so a script could copy it out of the browser';
  }

  const unlock = src.match(/^async function unlockKey[\s\S]*?\n\}/m);
  if (!unlock) return 'unlockKey is gone';
  if (!/checkVerifier\(saved/.test(unlock[0])) {
    return 'a remembered key is used without checking it against the account — a different ' +
      'teacher signing in here would get unreadable names instead of being asked';
  }
  const offer = src.match(/^async function offerToRemember[\s\S]*?\n\}/m);
  if (!offer) return 'nothing offers to remember it';
  if (!/uiConfirm/.test(offer[0])) return 'it is remembered without asking — this must stay opt-in';

  const out = src.match(/cloudOut'\)\.onclick[\s\S]*?\n  \};/);
  return (out && /forgetKey\(\)/.test(out[0]))
    || 'signing out leaves the passphrase behind for whoever uses this computer next';
});

test('searching questions cannot delete what it hides', () => {
  // Bulk delete works off qSel. If a filter could narrow the list while a
  // selection stood, "Delete selected" would remove questions the teacher can
  // no longer see — the one genuinely dangerous mistake in this screen.
  const rq = src.match(/^function renderQuestions[\s\S]*?\n\}/m);
  if (!rq) return 'renderQuestions is gone';
  if (!/qFind/.test(rq[0])) return 'the search is gone';
  const onInput = rq[0].slice(rq[0].indexOf('box.oninput'));
  if (!/qSel\.clear\(\)/.test(onInput.slice(0, 200))) {
    return 'typing in the search no longer clears the selection, so a bulk delete could ' +
      'remove hidden questions';
  }
  // and moving to another topic or level must reset it too, or the list looks empty
  return /scope!==qFindScope/.test(rq[0])
    || 'the search is not reset when the topic or level changes, so the next one opens filtered';
});

test('bulk select applies to what is on screen', () => {
  const bar = src.match(/^function renderSelBar[\s\S]*?\n\}/m);
  if (!bar) return 'renderSelBar is gone';
  return /visible\.forEach/.test(bar[0])
    || 'select-all still reaches past the filter into the whole level';
});

test('a v6 backup is not run through the pre-v6 migration', () => {
  const m = src.match(/if\(!data\.schemaVersion \|\| data\.schemaVersion<(\w+)\)/);
  if (!m) return 'the backup import version check is gone';
  if (m[1] !== '6') {
    return 'the check compares against ' + m[1] + '. Now that SCHEMA is past 6, every existing ' +
      'v6 backup would be fed through migrateToV6, which only understands the older name-keyed ' +
      'format, and come out wrecked.';
  }
  return true;
});

/* ---------- cloud sync wiring ---------- */

test('sync.js and its config load before game.js', () => {
  // strip the ?v= cache-busting stamp before comparing names
  const order = [...indexHtml.matchAll(/<script[^>]*src="([^"?]+)/g)].map(m => m[1]);
  const i = n => order.indexOf(n);
  if (i('sync.js') < 0) return 'sync.js is not loaded';
  if (i('supabase-config.js') < 0) return 'supabase-config.js is not loaded';
  if (!(i('supabase-config.js') < i('sync.js') && i('sync.js') < i('game.js'))) {
    return 'wrong order — game.js calls into QuizSync during init: ' + order.join(', ');
  }
  return true;
});

test('supabase-config.js holds no secret key', () => {
  const conf = fs.readFileSync(path.join(__dirname, '..', 'supabase-config.js'), 'utf8');
  const bad = k => 'this is a secret key (' + k + '). It bypasses row level security, so it must ' +
    'never sit in a file the browser can read. Use the public one — labelled "anon public" on ' +
    'older projects, "publishable" on newer ones.';

  // Only look at code — the comments in this file name service_role on purpose,
  // to warn against it.
  const code = conf.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  // Newer projects issue sb_publishable_… / sb_secret_… instead of JWTs.
  if (/sb_secret_/.test(code)) return bad('sb_secret_…');
  if (/service_role/.test(code)) return bad('service_role, in code');

  // Legacy keys are JWTs; the middle segment says which role they grant.
  for (const jwt of code.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
    let claims;
    try { claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')); }
    catch (e) { continue; }
    if (claims.role && claims.role !== 'anon') return bad(claims.role);
  }
  return true;
});

test('saving marks the state dirty and schedules an automatic sync', () => {
  const m = src.match(/^function markDirty\(\)\{[\s\S]*?^\}/m);
  if (!m) return 'markDirty is gone — nothing would notice local changes';
  if (!/scheduleAutoSync\(\)/.test(m[0])) {
    return 'markDirty no longer schedules a sync, so work would silently stop reaching the cloud ' +
      'until someone pressed the button';
  }
  return /markDirty\(\)/.test(src.match(/^async function flushSave[\s\S]*?^\}/m)[0])
    || 'flushSave no longer calls markDirty';
});

test('an automatic sync never resolves a conflict on its own', () => {
  const m = src.match(/^async function doSync[\s\S]*?\n\}/m);
  if (!m) return 'doSync is gone';
  const conflict = m[0].slice(m[0].indexOf("d.action==='conflict'"));
  if (!conflict) return 'the conflict branch is gone';
  const beforePrompt = conflict.slice(0, conflict.indexOf('dlg({'));
  return /opts\.manual/.test(beforePrompt)
    || 'a background sync could overwrite one side without the teacher choosing';
});

test('the last-synced time reads as plain English', () => {
  const m = src.match(/^function ago\([\s\S]*?^\}/m);
  if (!m) return 'ago() is gone';
  const ago = new Function(m[0] + '; return ago;')();
  const cases = [
    [0, /just now/], [30 * 1000, /just now/], [5 * 60 * 1000, /5 minutes ago/],
    [60 * 60 * 1000, /1 hour ago/], [3 * 24 * 60 * 60 * 1000, /3 days ago/]
  ];
  const bad = cases.filter(([d, want]) => !want.test(ago(Date.now() - d)));
  if (bad.length) return 'unexpected wording for ' + bad.map(b => b[0] + 'ms').join(', ');
  return ago(null) === '' || 'a never-synced device should show no time at all';
});

test('sign-in errors are translated into something a teacher can act on', () => {
  const m = src.match(/^function signInProblem[\s\S]*?^}/m);
  if (!m) return 'signInProblem is gone — Supabase error strings would reach the teacher raw';
  const fn = new Function(m[0] + '; return signInProblem;')();
  const cases = [
    ['email rate limit exceeded', /only a few messages per hour/i],
    // everything that fails on the way back from Google lands in one branch;
    // calling all of it "the link expired" sends people looking in the wrong place
    ['Signups not allowed for this instance', /Allow new users to sign up/i],
    ['Email link is invalid or has expired', /link has expired/i],
    ['Provider is not enabled', /not switched on/i],
    ['User already registered', /already has an account/i],
    ['Invalid login credentials', /do not match an account/i],
    ['Email not confirmed', /needs confirming/i],
    ['Failed to fetch', /no connection/i]
  ];
  const bad = cases.filter(([msg, want]) => !want.test(fn(msg))).map(c => c[0]);
  if (bad.length) return 'still shown raw: ' + bad.join('; ');
  // anything unrecognised must still surface the original text, not swallow it
  return /banana/.test(fn('banana')) || 'an unknown error loses its message';
});

/* ---------- student names must be unreadable once they leave the device ----------
   These are async because WebCrypto is. Key derivation is deliberately slow,
   so the key is derived once and reused across the cases. */

const C = require(path.join(__dirname, '..', 'sync.js'));

async function cryptoTests() {
  const salt = C.newSalt();
  const key = await C.deriveKey('a good long passphrase', salt);
  const wrongKey = await C.deriveKey('a good long passphras', salt);   // one character short

  async function atest(name, fn) {
    let outcome;
    try { outcome = await fn(); } catch (e) { outcome = 'threw: ' + e.message; }
    results.push({ name, ok: outcome === true, detail: outcome === true ? '' : String(outcome) });
  }

  await atest('an encrypted name does not contain the name', async () => {
    const blob = await C.encrypt(key, 'Amina Nakato');
    return (!/Amina|Nakato/.test(blob)) || 'plaintext survives in ' + blob;
  });

  await atest('a name survives the round trip', async () => {
    const blob = await C.encrypt(key, 'Amina Nakato');
    const back = await C.decrypt(key, blob);
    return back === 'Amina Nakato' || 'got ' + back;
  });

  await atest('the same name twice gives different ciphertext', async () => {
    const a = await C.encrypt(key, 'Grace');
    const b = await C.encrypt(key, 'Grace');
    return a !== b || 'identical ciphertext leaks which students share a name';
  });

  await atest('another device with the same passphrase can read it', async () => {
    const blob = await C.encrypt(key, 'Hakim');
    const school = await C.deriveKey('a good long passphrase', salt);   // same salt, fresh derive
    return (await C.decrypt(school, blob)) === 'Hakim' || 'second device could not decrypt';
  });

  await atest('the wrong passphrase cannot read a name', async () => {
    const blob = await C.encrypt(key, 'Esther');
    try { const out = await C.decrypt(wrongKey, blob); return 'decrypted anyway: ' + out; }
    catch (e) { return true; }        // AES-GCM refuses rather than returning garbage
  });

  await atest('the verifier accepts the right passphrase and rejects a typo', async () => {
    const v = await C.makeVerifier(key);
    if ((await C.checkVerifier(key, v)) !== true) return 'right passphrase rejected';
    if ((await C.checkVerifier(wrongKey, v)) !== false) return 'typo accepted';
    return true;
  });

  /* the shape the app actually stores, including the places a name hides */
  const sample = () => ({
    classes: {
      c1: {
        id: 'c1', name: '7-A', grade: '7',
        students: [{ id: 's1', name: 'Amina' }, { id: 's2', name: 'Brian' }],
        absent: ['s2'], picked: ['s1'], scores: { s1: { pts: 20, ok: 1, no: 0 } },
        groupState: { teams: [['s1'], ['s2']], scores: [10, 0], turn: 0, memberIdx: [0, 0] }
      }
    },
    subjects: { u1: { id: 'u1', name: 'Science' } },
    attempts: [{ ts: 1, clsName: '7-A', stuId: 's1', stuName: 'Amina', qText: 'What is water?', correct: true }],
    // deleting a student parks their name in two places at once
    trash: [{ id: 'd1', kind: 'student', label: 'Student "Cynthia"', ts: 1,
              data: { cid: 'c1', pos: 2, stu: { id: 's3', name: 'Cynthia' } } }]
  });

  await atest('encryptState encrypts every roster name', async () => {
    const enc = await C.encryptState(key, sample());
    const roster = enc.classes.c1.students.map(s => s.name);
    return roster.every(C.isEncrypted) || 'a roster name was left readable: ' + roster.join(', ');
  });

  await atest('answers are not carried inside the payload', async () => {
    // They are rows in quiz_attempts now. Leaving them here would put the whole
    // year back into every upload, which is the thing that table exists to stop.
    const enc = await C.encryptState(key, sample());
    return enc.attempts === undefined || 'the payload still carries the answer records';
  });

  await atest('an answer row keeps its encrypted name and survives the trip', async () => {
    const enc = await C.encryptState(key, sample());   // encrypts in place first
    void enc;
    const a = { id: 'a_1', ts: 1735689600000, clsId: 'c1', clsName: '7-A', gradeKey: '7',
                subjId: 'u1', subjName: 'Science', topicId: 't1', topicName: 'Body',
                level: 'medium', stuId: 's1', stuName: await C.encrypt(key, 'Amina'),
                qId: 'q1', qText: 'Which organ?', correct: true };
    const row = C.attemptToRow(a, 'user-uuid');
    if (/Amina/.test(JSON.stringify(row))) return 'the name would be sent readable';
    if (row.stu_name !== a.stuName) return 'the ciphertext was altered on the way out';
    const back = C.rowToAttempt(row);
    const lost = Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(back[k]));
    if (lost.length) return 'lost in conversion: ' + lost.join(', ');
    return (await C.decrypt(key, back.stuName)) === 'Amina' || 'the name no longer decrypts';
  });

  await atest('encryptState leaves the question bank readable', async () => {
    const enc = await C.encryptState(key, sample());
    if (enc.subjects.u1.name !== 'Science') return 'subject name was encrypted';
    if (enc.classes.c1.name !== '7-A') return 'class name was encrypted';
    return true;
  });

  await atest('no student name appears anywhere in the encrypted payload', async () => {
    const wire = JSON.stringify(await C.encryptState(key, sample()));
    // Cynthia is only in the trash — the easiest place for a name to escape.
    const leaked = ['Amina', 'Brian', 'Cynthia'].filter(n => wire.includes(n));
    return leaked.length === 0 || 'these names would be sent readable: ' + leaked.join(', ');
  });

  await atest('the trash is not uploaded at all', async () => {
    const wire = await C.encryptState(key, sample());
    return wire.trash === undefined || 'deleted-student snapshots would be sent';
  });

  await atest('ids, scores and teams are left alone', async () => {
    const wire = await C.encryptState(key, sample());
    const c = wire.classes.c1;
    if (c.students[0].id !== 's1') return 'a student id was altered';
    if (JSON.stringify(c.scores) !== JSON.stringify({ s1: { pts: 20, ok: 1, no: 0 } })) return 'scores were altered';
    if (JSON.stringify(c.groupState.teams) !== JSON.stringify([['s1'], ['s2']])) return 'teams were altered';
    if (JSON.stringify(c.absent) !== JSON.stringify(['s2'])) return 'attendance was altered';
    return true;
  });

  await atest('encryptState twice does not double-encrypt', async () => {
    const once = await C.encryptState(key, sample());
    const twice = await C.encryptState(key, once);
    const back = await C.decryptState(key, twice);
    return back.state.classes.c1.students[0].name === 'Amina' || 'name mangled by a second pass';
  });

  await atest('decryptState restores everything except trash and answers', async () => {
    const original = sample();
    const expected = sample();
    delete expected.trash;      // per-device undo, deliberately not synced
    delete expected.attempts;   // their own table now
    const back = await C.decryptState(key, await C.encryptState(key, original));
    return JSON.stringify(back.state) === JSON.stringify(expected) || 'round trip changed the state';
  });

  /* coming back from the confirmation email — a 404 or a blank page here makes
     a teacher think the link failed and sign up again */

  await atest('a confirmation redirect is recognised and its tokens read', async () => {
    const r = C.parseAuthHash('#access_token=abc123&expires_in=3600&refresh_token=r9&token_type=bearer&type=signup');
    if (!r || r.ok !== true) return 'a successful confirmation was not recognised';
    if (r.access_token !== 'abc123' || r.refresh_token !== 'r9') return 'tokens not read';
    if (r.type !== 'signup') return 'link type not read';
    return r.expires_in === 3600 || 'expiry not read';
  });

  await atest('an expired link is reported, not treated as success', async () => {
    const r = C.parseAuthHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    if (!r) return 'an expired link was ignored entirely';
    if (r.ok !== false) return 'an expired link was treated as a successful sign-in';
    return /invalid or has expired/.test(r.message) || 'the reason was not passed on: ' + r.message;
  });

  await atest('an ordinary visit is left alone', async () => {
    for (const h of ['', '#', '#tab=quiz']) {
      if (C.parseAuthHash(h) !== null) return 'a normal page load was mistaken for a sign-in: "' + h + '"';
    }
    return true;
  });

  await atest('a recovery link is handled the same way', async () => {
    const r = C.parseAuthHash('#access_token=t&expires_in=3600&refresh_token=r&type=recovery');
    return (r && r.ok === true && r.type === 'recovery') || 'password recovery links would be dropped';
  });

  /* which way data moves — the rule that decides whether work can be lost */

  const decide = (local, remote) => C.decideSync(local, remote).action;
  const HAS = { hasState: true, dirty: false, lastSeen: 't1' };

  await atest('first upload: local data, empty cloud', async () =>
    decide(HAS, { exists: false }) === 'push' || 'got ' + decide(HAS, { exists: false }));

  await atest('a new device with no data pulls', async () =>
    decide({ hasState: false }, { exists: true, updatedAt: 't1' }) === 'pull' || 'a fresh device did not pull');

  await atest('nothing anywhere does nothing', async () =>
    decide({ hasState: false }, { exists: false }) === 'none' || 'unexpected action on an empty setup');

  await atest('local edits with an untouched cloud push', async () =>
    decide({ hasState: true, dirty: true, lastSeen: 't1' }, { exists: true, updatedAt: 't1' }) === 'push'
    || 'local changes were not pushed');

  await atest('a newer cloud with no local edits pulls', async () =>
    decide({ hasState: true, dirty: false, lastSeen: 't1' }, { exists: true, updatedAt: 't2' }) === 'pull'
    || 'the newer cloud copy was not pulled');

  await atest('edits on both sides are a conflict, never a silent overwrite', async () => {
    const r = C.decideSync({ hasState: true, dirty: true, lastSeen: 't1' }, { exists: true, updatedAt: 't2' });
    if (r.action !== 'conflict') return 'one side would have been overwritten silently: ' + r.action;
    return !!r.reason || 'a conflict must explain itself to the teacher';
  });

  await atest('in sync means no traffic', async () =>
    decide(HAS, { exists: true, updatedAt: 't1' }) === 'none' || 'pointless sync when nothing changed');

  await atest('decryptState with the wrong passphrase reports the loss instead of hiding it', async () => {
    const enc = await C.encryptState(key, sample());
    const back = await C.decryptState(wrongKey, enc);
    if (back.failed !== 2) return 'expected 2 unreadable names, got ' + back.failed;
    if (back.state.classes.c1.students[0].name !== '???') return 'unreadable name was not flagged';
    return true;
  });
}

/* ---------- report ---------- */

cryptoTests().then(() => {
  const failed = results.filter(r => !r.ok);
  for (const r of results) {
    console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.detail ? '\n         ' + r.detail : ''));
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
});
