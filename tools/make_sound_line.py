#!/usr/bin/env python3
"""
Turns an audio file into the one line you paste into game.js.

Usage:
    python make_sound_line.py yay.mp3 correct
    python make_sound_line.py buzz.wav wrong

The second argument is which sound it replaces:
    correct | wrong | timeUp | tick | pick

It prints a line like:
    correct: "data:audio/mpeg;base64,SUQzBAAA....",
Copy that line into the MY_SOUNDS block near the top of game.js,
replacing the existing line for that sound.

Tip: keep clips under ~2 seconds. Every 100 KB of audio adds roughly
135 KB to game.js, because base64 text is bigger than the raw file.
"""

import base64
import os
import sys

MIME = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".webm": "audio/webm",
}
KEYS = ("correct", "wrong", "timeUp", "tick", "pick")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1

    path, key = sys.argv[1], sys.argv[2]

    if key not in KEYS:
        print(f'"{key}" is not a valid sound name. Use one of: {", ".join(KEYS)}')
        return 1

    if not os.path.isfile(path):
        print(f"File not found: {path}")
        return 1

    ext = os.path.splitext(path)[1].lower()
    mime = MIME.get(ext)
    if not mime:
        print(f"Unsupported file type '{ext}'. Use: {', '.join(MIME)}")
        return 1

    raw = open(path, "rb").read()
    encoded = base64.b64encode(raw).decode("ascii")

    size_kb = len(raw) / 1024
    added_kb = len(encoded) / 1024
    print(f"\n{os.path.basename(path)} — {size_kb:.0f} KB "
          f"(adds about {added_kb:.0f} KB to game.js)")
    if added_kb > 500:
        print("That is quite large. A shorter clip would keep game.js quick to load.")

    print("\nPaste this line into the MY_SOUNDS block in game.js:\n")
    print(f'  {key}: "data:{mime};base64,{encoded}",')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
