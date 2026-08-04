# assets/

## `gisu-logo.png` — the school logo in the header

Drop the Galaxy International School Uganda logo here with **exactly this name**:

```
assets/gisu-logo.png
```

`index.html` looks for that path and shows it to the left of the title. Nothing
else needs to change.

**If the file is missing the app still works** — the logo is hidden and the
header shows only the title, no broken-image icon. So the repo is usable before
anyone adds a logo.

The file currently in this folder is the **emblem only** — the four figures
around the swirl, without the "GALAXY INTERNATIONAL SCHOOL UGANDA" wordmark or
the tagline. At header size the wordmark was too small to read, and the app's
own title already says the school name.

### Recommended file

- **Height:** the header renders it at 60px tall (44px on phones). Supply
  roughly **3× that** so it stays sharp on high-DPI screens — about
  **180px tall** is plenty. Width can be anything; the aspect ratio is kept.
- **Format:** PNG with a transparent background looks best against the cream
  header. A JPG works too, but rename it to `.png`, or edit the `src` in
  `index.html` and the CSS selector stays the same.
- **Keep it small:** under ~100 KB. It loads on every open.

## `spin.mp3` — the music while student names are spinning

- 2.6 seconds, mono, 44.1 kHz, 88 kbps, 26 KB
- Trimmed from a longer track supplied by the school: *Host Entrance Background
  Music* by Robert Gubac Jr. The school confirmed it is cleared for this use.
  **If that track asks for credit, add the credit line here** — this is the
  place anyone will look.
- Excerpt taken from 60.8s-63.4s of the original, chosen by measuring loudness
  and beat density across the whole track and picking the busiest window. Short
  fade in and out so it does not click, levelled to match the other sounds.

`MY_SOUNDS.spin` in `game.js` points at this path rather than embedding the
audio. That keeps `game.js` about 32 KB smaller and means the music can be
swapped by replacing this one file. The browser fetches it on the first spin
and caches it after that.

Note for anyone regenerating sounds: `spin` was removed from the `SOUNDS` dict
in `tools/make_sounds.py` on purpose, so running that script rewrites the other
sounds without silently putting the old synthesized tune back.

### The tab icon

`favicon-32.png` and `favicon-180.png` are generated from this same emblem and
declared in `index.html`. If you replace `gisu-logo.png`, regenerate them too —
scaling the header logo down to 16px in the browser comes out muddy:

```python
from PIL import Image
im = Image.open('gisu-logo.png').convert('RGBA')
im = im.crop(im.split()[3].getbbox())
w, h = im.size; side = max(w, h)
for size, name in [(32, 'favicon-32.png'), (180, 'favicon-180.png')]:
    c = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    c.paste(im, ((side - w) // 2, (side - h) // 2), im)
    c.resize((size, size), Image.LANCZOS).save(name, optimize=True)
```

Bump the `?v=` on the two `<link rel="icon">` tags afterwards, or browsers will
keep showing the old one for a long time.

### Using an SVG instead

An SVG scales better. Save it as `assets/gisu-logo.svg` and change the one
`src` in `index.html`:

```html
<img id="brandLogo" class="logo" src="assets/gisu-logo.svg"
     alt="Galaxy International School Uganda">
```

### Note on sharing

The logo is a separate file, so it travels with the folder — not with a lone
`index.html`. If you send someone just the HTML, they get the title without the
logo. Send the whole folder (or a zip of it) to keep it.
