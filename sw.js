/* Service worker: makes the app installable and genuinely usable offline.
 *
 * The whole design turns on one thing — never stranding a teacher on an old
 * version. A cache-first service worker is the classic way to do exactly that,
 * and this project has already been bitten once by stale files, so:
 *
 *   the page itself   network first, cache only as a fallback. index.html is
 *                     what names the current ?v= stamps, so if it were served
 *                     from cache the new versions could never arrive.
 *   ?v= assets        cache first. Those URLs are immutable — a new deploy is a
 *                     new URL — so a hit is always correct and always current.
 *   everything else   cache first with a quiet background refresh.
 *   Supabase          never touched. Sync must reach the network or fail
 *                     honestly; a cached answer here would be a lie.
 *
 * VERSION must equal the ?v= stamp in index.html. tools/selftest.js fails if
 * they drift, the same way it guards the stamps themselves.
 */

const VERSION = '7bc4582e';
const CACHE = 'gisu-quiz-' + VERSION;

/* The shell: enough to open the app with no connection at all. */
const SHELL = [
  './',
  './index.html',
  './style.css?v=' + VERSION,
  './supabase-config.js?v=' + VERSION,
  './sync.js?v=' + VERSION,
  './game.js?v=' + VERSION,
  './vendor/confetti.browser.js',
  './assets/gisu-logo.png',
  './assets/spin.mp3',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './manifest.json'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* One at a time, ignoring failures: a single missing optional file must not
       abandon the whole install and leave the app with no offline copy. */
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE && n.startsWith('gisu-quiz-'))
                           .map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isSupabase = url => /\.supabase\.co$/i.test(url.hostname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // sync writes go straight out

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (isSupabase(url)) return;                      // never cache the API
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  /* The document itself: always ask the network first, so a deploy is picked up
     on the next open rather than whenever a cache happens to expire. */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', fresh.clone()).catch(() => {});
        return fresh;
      } catch (err) {
        return (await caches.match('./index.html')) || (await caches.match('./')) ||
               new Response('Offline, and this page was never saved.', {
                 status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) {
      /* A ?v= URL cannot change under us, so a hit is final. Anything else gets
         refreshed quietly for next time. */
      if (!url.search.includes('v=')) {
        fetch(req).then(r => {
          if (r && r.ok) caches.open(CACHE).then(c => c.put(req, r.clone()).catch(() => {}));
        }).catch(() => {});
      }
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const c = await caches.open(CACHE);
        c.put(req, res.clone()).catch(() => {});     // fonts included, once seen
      }
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
