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

`favicon-16.png`, `favicon-32.png` and `favicon-180.png` are the green **Q card**
mark, not the school emblem. They are declared in `index.html`.

Each size is drawn for its size rather than scaled from one image:

| File | What it shows |
|---|---|
| `favicon-16.png` | just the green tile — the card and the letter turn to mush at 16px |
| `favicon-32.png` | green tile, white card, `Q` |
| `favicon-180.png` | the same, for a tablet home screen |

Colours, taken from the original design: green `#25984d`, ink `#181611`.
Proportions follow the 48px reference — corner radius 0.229 of the tile, card
0.583 x 0.708, border 0.0625, letter 0.34. The letter is set in Segoe UI Black,
the closest weight available here to the Poppins 800 of the design.

To regenerate after a design change, adjust and run:

```python
from PIL import Image, ImageDraw, ImageFont
GREEN=(37,152,77); INK=(24,22,17); SS=8
def icon(size, card=True):
    S=size*SS
    im=Image.new('RGBA',(S,S),(0,0,0,0)); d=ImageDraw.Draw(im)
    d.rounded_rectangle([0,0,S-1,S-1], radius=int(S*0.229), fill=GREEN)
    if card:
        cw,ch=S*0.583,S*0.708; x0,y0=(S-cw)/2,(S-ch)/2
        d.rounded_rectangle([x0,y0,x0+cw,y0+ch], radius=int(S*0.104),
                            fill=(255,255,255), outline=INK, width=max(1,int(S*0.0625)))
        f=ImageFont.truetype("C:/Windows/Fonts/seguibl.ttf", int(S*0.34))
        l,t,r,b=d.textbbox((0,0),'Q',font=f)
        d.text(((S-(r-l))/2-l,(S-(b-t))/2-t-S*0.01),'Q',font=f,fill=INK)
    return im.resize((size,size), Image.LANCZOS)
for size,card,name in [(180,True,'favicon-180.png'),(32,True,'favicon-32.png'),(16,False,'favicon-16.png')]:
    icon(size,card).save(name, optimize=True)
```

Bump the `?v=` on the `<link rel="icon">` tags afterwards, or browsers will keep
showing the old one for a long time — favicons are cached far longer than pages.

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
