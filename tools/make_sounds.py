#!/usr/bin/env python3
"""
Builds the quiz sounds from scratch (no downloads, no copyright worries)
and writes them straight into game.js as base64.

  spin    – a cheerful little carnival tune while the names are spinning
  tick    – a mechanical clock tick for the last seconds
  correct – applause with a small fanfare
  wrong   – a "donk-zonk" buzzer

Run:  python make_sounds.py
"""

import base64
import os
import re

import lameenc
import numpy as np

SR = 44100          # sample rate
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- helpers
def env(n, attack=0.01, decay=0.25, sustain=0.7, release=0.2):
    """Simple ADSR-ish envelope of length n samples."""
    a, d, r = int(n * attack), int(n * decay), int(n * release)
    s = max(n - a - d - r, 0)
    return np.concatenate([
        np.linspace(0, 1, a, endpoint=False),
        np.linspace(1, sustain, d, endpoint=False),
        np.full(s, sustain),
        np.linspace(sustain, 0, r),
    ])[:n]


def tone(freq, dur, kind="sine", vol=1.0, detune=0.0):
    """One note. 'square' gives the retro game-show colour."""
    n = int(SR * dur)
    t = np.arange(n) / SR
    f = freq * (1 + detune)
    if kind == "square":
        w = np.sign(np.sin(2 * np.pi * f * t))
        w += 0.35 * np.sign(np.sin(2 * np.pi * f * 2 * t))   # a little brightness
    elif kind == "tri":
        w = 2 * np.abs(2 * (t * f - np.floor(t * f + 0.5))) - 1
    else:
        w = np.sin(2 * np.pi * f * t)
    return w * vol


def place(track, sound, at_sec):
    """Mix a sound into a track at a given time."""
    i = int(at_sec * SR)
    end = min(i + len(sound), len(track))
    if end > i:
        track[i:end] += sound[: end - i]


def lowpass(x, alpha=0.25):
    """One-pole low-pass — takes the harshness off noise."""
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += alpha * (v - acc)
        y[i] = acc
    return y


def normalise(x, peak=0.89):
    m = np.max(np.abs(x))
    return x / m * peak if m > 0 else x


def to_mp3(samples, bitrate=80):
    """Float array -> mp3 bytes (mono, small)."""
    pcm = (normalise(samples) * 32767).astype(np.int16)
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(3)
    return enc.encode(pcm.tobytes()) + enc.flush()


# ---------------------------------------------------------------- 1) spin
def make_spin():
    """A bouncy circus-style melody, ~2.4 s, for the name draw."""
    dur = 2.45
    track = np.zeros(int(SR * dur))

    # C major-ish romp: the notes of a fairground organ
    melody = [
        (523, 0.00, 0.16), (659, 0.16, 0.16), (784, 0.32, 0.16), (659, 0.48, 0.16),
        (784, 0.64, 0.16), (880, 0.80, 0.16), (1047, 0.96, 0.22), (880, 1.18, 0.14),
        (784, 1.32, 0.14), (880, 1.46, 0.14), (1047, 1.60, 0.20), (1175, 1.80, 0.18),
        (1319, 1.98, 0.42),
    ]
    for f, at, d in melody:
        n = int(SR * d)
        note = tone(f, d, "square", 0.24) * env(n, 0.02, 0.18, 0.8, 0.3)
        place(track, note, at)

    # oom-pah bass so it swings
    for i, at in enumerate(np.arange(0, 2.2, 0.16)):
        f = 131 if i % 2 == 0 else 196
        n = int(SR * 0.13)
        place(track, tone(f, 0.13, "tri", 0.30) * env(n, 0.01, 0.3, 0.4, 0.4), at)

    # a shaker on the off-beats
    for at in np.arange(0.08, 2.2, 0.16):
        n = int(SR * 0.05)
        hit = lowpass(rng.normal(0, 1, n), 0.55) * np.linspace(1, 0, n) ** 3
        place(track, hit * 0.14, at)

    # closing cymbal
    n = int(SR * 0.45)
    place(track, lowpass(rng.normal(0, 1, n), 0.7) * np.linspace(1, 0, n) ** 2 * 0.3, 1.98)
    return track


# ---------------------------------------------------------------- 2) tick
def make_tick():
    """A single short mechanical click (the app alternates its pitch for tick-tock)."""
    n = int(SR * 0.075)
    click = lowpass(rng.normal(0, 1, n), 0.42) * np.linspace(1, 0, n) ** 7
    body = tone(1650, 0.075, "sine", 0.5) * np.linspace(1, 0, n) ** 9
    return click * 0.75 + body


# ------------------------------------------------------------- 3) correct
def make_correct():
    """Applause plus a short rising fanfare, ~2.0 s."""
    dur = 2.05
    track = np.zeros(int(SR * dur))

    # ~140 hand claps, dense at the start then thinning out
    for _ in range(140):
        at = abs(rng.normal(0.18, 0.55))
        if at > 1.85:
            continue
        n = int(SR * rng.uniform(0.020, 0.045))
        clap = lowpass(rng.normal(0, 1, n), rng.uniform(0.30, 0.60))
        clap *= np.linspace(1, 0, n) ** 2.2
        loud = 0.55 * np.exp(-at * 0.75) * rng.uniform(0.55, 1.25)
        place(track, clap * loud, at)

    # crowd "hiss" underneath so it sounds like a room, not clicks
    n = int(SR * 1.9)
    bed = lowpass(rng.normal(0, 1, n), 0.18) * 0.10
    bed *= np.concatenate([np.linspace(0, 1, int(SR * 0.12)),
                           np.linspace(1, 0, n - int(SR * 0.12)) ** 1.4])
    place(track, bed, 0.05)

    # fanfare on top: C - E - G - C
    for f, at, d in [(523, 0.0, 0.16), (659, 0.14, 0.16), (784, 0.28, 0.18), (1047, 0.44, 0.55)]:
        n = int(SR * d)
        note = (tone(f, d, "tri", 0.30) + tone(f * 2, d, "sine", 0.10)) * env(n, 0.01, 0.2, 0.75, 0.45)
        place(track, note, at)
    return track


# --------------------------------------------------------------- 4) wrong
def make_wrong():
    """Two descending buzzes — the classic 'donk-zonk'."""
    dur = 0.95
    track = np.zeros(int(SR * dur))

    def buzz(f0, f1, d, vol):
        n = int(SR * d)
        t = np.arange(n) / SR
        f = np.linspace(f0, f1, n)                       # falling pitch
        phase = 2 * np.pi * np.cumsum(f) / SR
        w = np.sign(np.sin(phase)) * 0.6 + np.sin(phase) * 0.4
        w *= 1 + 0.35 * np.sin(2 * np.pi * 26 * t)       # wobble = "raspberry"
        return w * env(n, 0.008, 0.15, 0.85, 0.25) * vol

    place(track, buzz(196, 150, 0.34, 0.55), 0.00)       # DONK
    place(track, buzz(147, 100, 0.52, 0.55), 0.38)       # ZONK
    return track


# ---------------------------------------------------------------- build
# "spin" is deliberately not in here. It now points at assets/spin.mp3 instead
# of an embedded tune, and regenerating it would silently overwrite that line in
# game.js with the synthesized carnival music again. make_spin() is kept below
# in case anyone wants it back — put "spin": (make_spin, 88) here and set
# MY_SOUNDS.spin back to an embedded value.
SOUNDS = {
    "tick": (make_tick, 64),
    "correct": (make_correct, 88),
    "wrong": (make_wrong, 80),
}

# MY_SOUNDS lives in game.js, next to this tools/ folder.
js_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "game.js")
js = open(js_path, encoding="utf-8").read()

total = 0
for name, (fn, br) in SOUNDS.items():
    mp3 = to_mp3(fn(), br)
    total += len(mp3)
    b64 = base64.b64encode(mp3).decode("ascii")
    print(f"{name:8} {len(mp3)/1024:6.1f} KB mp3  ->  {len(b64)/1024:6.1f} KB base64")

    # replace  name: "...."  inside the MY_SOUNDS block
    pattern = re.compile(rf'(\n  {name}:\s*)"[^"]*"')
    new_line = rf'\g<1>"data:audio/mpeg;base64,{b64}"'
    js, count = pattern.subn(new_line, js, count=1)
    if count != 1:
        raise SystemExit(f"Could not find the '{name}' line in MY_SOUNDS")

open(js_path, "w", encoding="utf-8").write(js)
print(f"\ntotal audio: {total/1024:.0f} KB   ·   game.js now {len(js)/1024:.0f} KB")
