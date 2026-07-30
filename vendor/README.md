# vendor/

Third-party code, bundled on purpose. Nothing here is ours.

## `confetti.browser.js` — canvas-confetti 1.9.3

- Source: <https://github.com/catdad/canvas-confetti> by Kiril Vatev
- Licence: ISC — see [`LICENSE-canvas-confetti`](LICENSE-canvas-confetti)
- Downloaded from: `https://unpkg.com/canvas-confetti@1.9.3/dist/confetti.browser.js`
  (verified byte-identical against `https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.js`)
- Size: 24,906 bytes
- `sha512-x3E9Zf5krE1VB4jXjd1xa7ehxJ5JdWLqg1gxhFVNWK7HphKYKDdIy2t/El3qiDUxgu36zNmWFOyjajFkPecGGg==`

**Use the `confetti.browser.js` build, not `confetti.js` or `confetti.min.js`.**
Those are the CommonJS builds: they reference a bare `module`, so in a plain
`<script>` tag they throw `ReferenceError: module is not defined` and the
`confetti` global is never created. Only the `.browser.` build ends with
`window.confetti = module.exports`.

### Why it is bundled instead of loaded from a CDN

This script shares a page with every class list, student name and score. A
`<script>` tag pointing at a CDN is a standing invitation: if that CDN — or DNS
on the school's network — were ever tampered with, the replacement code would
run with full access to that data and could quietly send it anywhere. Bundling
the file removes that possibility, and the confetti now also works with no
internet connection, like the rest of the app.

### Updating it

1. Download the new version from unpkg or jsDelivr, using the `dist/confetti.browser.js`
   path, and record the hash:

   ```bash
   printf "sha512-%s\n" "$(openssl dgst -sha512 -binary confetti.browser.js | openssl base64 -A)"
   ```

   Fetching the same file from both CDNs and checking they are byte-identical is
   a cheap way to catch a single tampered mirror.

2. Replace the file, update the version, size and hash above.
3. Open `index.html`, answer a question correctly, and confirm confetti fires.

### If you ever remove it

`fireConfetti()` in `game.js` starts with `if(typeof confetti!=='function') return;`,
so the app keeps working without this file — you just lose the celebration.
