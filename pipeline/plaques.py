#!/usr/bin/env python3
"""Draw the two Trafalgar Square plaque stencils.

    python3 pipeline/plaques.py

Not part of the build, and the one thing in pipeline/ that needs an install:
Pillow, for the drawing and the font. The build only needs the PNGs this
writes into app/img/, which are committed.

Each plaque is a frame, four bolt heads and some lines of cast lettering.
The stencil draws the frame and the bolts as lines, then the handful of
letters the hunt wants the player to notice as solid shapes, each sitting
exactly where it sits on the plaque, and no other letter at all. The letter
positions come from a perspective-corrected photograph of each plaque,
measured by hand; the typeface is not the foundry's, but at the size a phone
shows a plaque, a bold sans in the right place is the right letter.

These are bigger than the building stencils on purpose: a building's outline
survives being shrunk to a phone screen, and the two-centimetre letters on a
metre-wide plaque do not, so they are drawn with pixels to spare.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent.parent
IMG = BASE / "app" / "img"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
ORANGE = (255, 61, 0, 255)
CAP = 0.73          # DejaVu Sans Bold: cap height as a fraction of the font size

# Everything is in the pixels of the rectified photograph, 1600 wide with the
# outer edge of the frame 4% in from each side. `lines` are (text, top of the
# capitals, cap height, left edge, right edge, {index: letter} to keep).
PLAQUES = {
    "imperial-standards": {
        "size": (1600, 438),
        "inner": (118, 62, 1470, 380),
        "bolts": [(175, 118), (175, 322), (1380, 115), (1380, 322)],
        "bolt_d": 55,
        "lines": [
            ("IMPERIAL STANDARDS OF LENGTH", 100, 32, 372, 1180, {1: "M", 25: "G"}),
            ("PLACED ON THIS SITE BY THE", 150, 34, 415, 1135, {11: "H", 21: "Y"}),
            ("STANDARDS DEPARTMENT OF THE BOARD OF TRADE", 198, 34, 163, 1405,
             {28: "B", 38: "R"}),
            ("BY THE PERMISSION OF THE COMMISSIONERS OF", 247, 21, 415, 1130, {}),
            ("HER MAJESTY'S WORKS AND PUBLIC BUILDINGS.", 282, 21, 410, 1135, {25: "U"}),
            ("MDCCCLXXVI", 318, 30, 610, 935, {}),
        ],
        "frame_w": 6, "inner_w": 5, "bolt_w": 4,
        "photo": "imperial-standards-rectified.jpg",
    },
    "standard-chain": {
        "size": (1600, 914),
        "inner": (178, 152, 1440, 746),
        "bolts": [(232, 200), (238, 690), (1345, 195), (1345, 660)],
        "bolt_d": 70,
        "lines": [
            ("STANDARD CHAIN", 232, 68, 330, 1255, {0: "S", 3: "N", 10: "H", 12: "I"}),
            ("OF", 405, 60, 745, 860, {}),
            ("66 FEET", 570, 70, 585, 1005, {6: "T"}),
        ],
        "frame_w": 7, "inner_w": 6, "bolt_w": 5,
        "photo": "standard-chain-rectified.jpg",
    },
}


def glyph_boxes(text, top, cap, x0, x1):
    """Where each character of a line lands when the line is stretched, by
    letter spacing alone, to run from x0 to x1 with capitals cap px tall."""
    size = cap / CAP
    font = ImageFont.truetype(FONT, round(size))
    advances = [font.getlength(ch) for ch in text]
    natural = sum(advances)
    gaps = max(1, len(text) - 1)
    track = ((x1 - x0) - natural) / gaps
    # Anchor at the capitals' top: "la" is left, ascender-top.
    boxes, x = [], x0
    for ch, adv in zip(text, advances):
        boxes.append((ch, x, font))
        x += adv + track
    return boxes, font


def draw(name, spec, preview):
    W, H = spec["size"]
    mx, my = round(W * 0.04), round(H * 0.04)
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    fw, iw, bw = spec["frame_w"], spec["inner_w"], spec["bolt_w"]
    d.rectangle((mx, my, W - mx, H - my), outline=ORANGE, width=fw)
    d.rectangle(spec["inner"], outline=ORANGE, width=iw)
    r = spec["bolt_d"] / 2
    for cx, cy in spec["bolts"]:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=ORANGE, width=bw)

    for text, top, cap, x0, x1, keep in spec["lines"]:
        boxes, font = glyph_boxes(text, top, cap, x0, x1)
        for n, (ch, x, font) in enumerate(boxes):
            if n not in keep:
                continue
            if keep[n] != ch:
                raise SystemExit(f"{name}: index {n} of {text!r} is {ch!r}, not {keep[n]!r}")
            # Solid, not outlined: at the size a phone shows a plaque an
            # outlined letter is a smudge and a solid one is a letter.
            d.text((x, top), ch, font=font, fill=ORANGE, anchor="lt")

    # Anything the antialiasing left half-orange becomes fully orange or
    # nothing, like the building stencils, so the alpha the match reads is
    # a clean mask.
    px = im.load()
    for y in range(H):
        for x in range(W):
            a = px[x, y][3]
            px[x, y] = ORANGE if a >= 96 else (0, 0, 0, 0)

    out = IMG / f"{name}-stencil.png"
    im.save(out, optimize=True)
    print(f"wrote {out} {im.size}")

    if preview and preview.is_file():
        photo = Image.open(preview).convert("RGBA").resize((W, H))
        photo.alpha_composite(im)
        pv = IMG / f"{name}-stencil-preview.jpg"
        photo.convert("RGB").save(pv, quality=82)
        print(f"wrote {pv}")


if __name__ == "__main__":
    for name, spec in PLAQUES.items():
        draw(name, spec, IMG / spec["photo"])
