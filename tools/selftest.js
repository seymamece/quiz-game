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

/* ---------- report ---------- */

const failed = results.filter(r => !r.ok);
for (const r of results) {
  console.log((r.ok ? '  ok   ' : '  FAIL ') + r.name + (r.detail ? '\n         ' + r.detail : ''));
}
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
