#!/usr/bin/env python3
"""Validate a hunt and bake it into the player.

    python3 pipeline/build.py content/fixture.json

Standard library only, on purpose: the whole point of this game is that it is
a static page anybody can serve, so the thing that produces it should not need
an install either.

Validation fails loudly and names the stop, because the person writing a hunt
is walking around a real city with a notebook, not reading a stack trace.
"""

import json
import shutil
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
APP = BASE / "app"
SITE = BASE / "site"

# The one line in app/player.html that the hunt gets written over. Matched
# whole and stripped of surrounding whitespace, so re-indenting the template
# cannot silently stop the bake working and ship a player with no hunt in it.
MARKER = "<!-- HUNT GOES HERE -->"

LENS_KINDS = ("stencil", "cord", "arrow")


class ContentError(Exception):
    """A hunt that will not play. The message says which stop and why."""


def fail(where, why):
    raise ContentError(f"{where}: {why}")


def check_blocks(blocks, where, images):
    if not isinstance(blocks, list):
        fail(where, "must be a list of blocks")
    for n, b in enumerate(blocks):
        at = f"{where}[{n}]"
        if not isinstance(b, dict):
            fail(at, "must be an object")
        kind = b.get("type")
        if kind == "text":
            if not str(b.get("text", "")).strip():
                fail(at, "text block has no text")
        elif kind == "image":
            src = b.get("src")
            if not src:
                fail(at, "image block has no src")
            if not (APP / src).is_file():
                fail(at, f"image {src!r} is not under app/")
            images.append(src)
        else:
            fail(at, f"unknown block type {kind!r} (text or image)")


def check_gate(gate, where):
    for field in ("lat", "lon", "radius_m", "prompt"):
        if gate.get(field) is None:
            fail(where, f"gate has no {field}")
    for field in ("lat", "lon", "radius_m"):
        if not isinstance(gate[field], (int, float)) or isinstance(gate[field], bool):
            fail(where, f"gate {field} must be a number")
    if not -90 <= gate["lat"] <= 90 or not -180 <= gate["lon"] <= 180:
        fail(where, "gate lat/lon are not on the Earth")
    # Below twenty metres a gate is arguing with the phone rather than with the
    # player: a good urban fix is rarely better than fifteen metres, so a
    # tighter radius is a stop that cannot reliably be passed by standing on it.
    if gate["radius_m"] < 20:
        fail(where, f"gate radius_m is {gate['radius_m']}, minimum is 20")
    if not str(gate["prompt"]).strip():
        fail(where, "gate prompt is empty")


def check_question(q, where):
    answers = q.get("answers")
    if not isinstance(answers, list) or not answers:
        fail(where, "question needs at least one answer")
    if any(not str(a).strip() for a in answers):
        fail(where, "question has a blank answer")
    if not str(q.get("ask", "")).strip():
        fail(where, "question has no ask")
    guesses = q.get("guesses", 3)
    if not isinstance(guesses, int) or isinstance(guesses, bool) or guesses < 1:
        fail(where, f"question guesses is {guesses!r}, must be a whole number 1 or more")
    q["guesses"] = guesses


def is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_match(m, where):
    """The live match on a stencil lens. Defaults are filled in here so the
    player never has to guess them, and the JSON that reaches the page says
    exactly what it is going to do."""
    if not isinstance(m, dict):
        fail(where, "match must be an object")
    threshold = m.setdefault("threshold", 0.35)
    if not is_num(threshold) or not 0 < threshold <= 1:
        fail(where, f"match threshold is {threshold!r}, must be more than 0 and at most 1")
    hold = m.setdefault("hold_ms", 600)
    if not is_num(hold) or hold < 0:
        fail(where, f"match hold_ms is {hold!r}, must be 0 or more")
    gate = m.setdefault("gate", True)
    if not isinstance(gate, bool):
        fail(where, f"match gate is {gate!r}, must be true or false")
    fallback = m.setdefault("fallback_s", None)
    if fallback is not None and (not is_num(fallback) or fallback < 10):
        fail(where, f"match fallback_s is {fallback!r}, must be null or 10 or more")


def check_lens(lens, where, images):
    kind = lens.get("kind")
    if kind not in LENS_KINDS:
        fail(where, f"unknown lens kind {kind!r} ({', '.join(LENS_KINDS)})")
    if kind == "stencil":
        src = lens.get("src")
        if not src:
            fail(where, "stencil lens has no src")
        if not (APP / src).is_file():
            fail(where, f"stencil image {src!r} is not under app/")
        images.append(src)
        if lens.get("match") is not None:
            check_match(lens["match"], where)
        # auto opens the lens unprompted. It only makes sense with something
        # to wait for, so it follows match unless the content says otherwise.
        auto = lens.setdefault("auto", lens.get("match") is not None)
        if not isinstance(auto, bool):
            fail(where, f"lens auto is {auto!r}, must be true or false")
    else:
        for field in ("match", "auto"):
            if lens.get(field) is not None:
                fail(where, f"{field} is only for a stencil lens, not {kind}")
    if kind == "cord":
        marks = lens.get("marks_mm")
        if not isinstance(marks, list) or len(marks) < 2:
            fail(where, "cord lens needs at least two marks_mm")
        if any(not isinstance(m, (int, float)) or isinstance(m, bool) for m in marks):
            fail(where, "cord marks_mm must all be numbers")
        if list(marks) != sorted(marks) or marks[0] != 0:
            fail(where, "cord marks_mm must start at 0 and increase")


def validate(hunt):
    """Check the whole hunt. Returns the image srcs it referenced."""
    images = []
    for field in ("id", "title", "stops"):
        if not hunt.get(field):
            fail("hunt", f"no {field}")
    check_blocks(hunt.get("intro", []), "hunt.intro", images)
    check_blocks(hunt.get("outro", []), "hunt.outro", images)

    diary = hunt.setdefault("diary_mm", {"w": 148, "h": 210})
    for field in ("w", "h"):
        if not isinstance(diary.get(field), (int, float)) or diary[field] <= 0:
            fail("hunt.diary_mm", f"{field} must be a positive number of millimetres")

    seen = set()
    for n, s in enumerate(hunt["stops"]):
        sid = s.get("id")
        where = f"stop {sid!r}" if sid else f"stop #{n + 1}"
        if not sid:
            fail(where, "no id")
        if sid in seen:
            fail(where, "duplicate id")
        seen.add(sid)

        for field in ("chapter", "title"):
            if not str(s.get(field, "")).strip():
                fail(where, f"no {field}")
        if not s.get("body"):
            fail(where, "no body")
        check_blocks(s["body"], f"{where}.body", images)
        check_blocks(s.get("after") or [], f"{where}.after", images)

        gate = s.get("gate")
        if gate:
            check_gate(gate, where)
        if s.get("compass") and not gate:
            fail(where, "compass is on but there is no gate to point at")
        if s.get("question"):
            check_question(s["question"], where)
        if s.get("lens"):
            check_lens(s["lens"], where, images)
    return images


def build(content_path):
    hunt = json.loads(Path(content_path).read_text(encoding="utf-8"))
    images = validate(hunt)

    template = (APP / "player.html").read_text(encoding="utf-8")
    if MARKER not in template:
        fail("app/player.html", f"no {MARKER} line to write the hunt over")

    # Escaping "</" is the whole of the safety here: a hunt containing the
    # characters that end a script tag would otherwise close this one early and
    # spill the rest of the JSON into the page as markup.
    payload = json.dumps(hunt, ensure_ascii=False).replace("</", "<\\/")
    page = template.replace(MARKER, f"<script>window.HUNT = {payload};</script>", 1)
    page = page.replace("<title>The Architect Order</title>",
                        f"<title>{hunt['title']}</title>", 1)

    if SITE.exists():
        shutil.rmtree(SITE)
    SITE.mkdir(parents=True)
    (SITE / "index.html").write_text(page, encoding="utf-8")
    shutil.copy2(APP / "lens.js", SITE / "lens.js")
    if (APP / "img").is_dir():
        shutil.copytree(APP / "img", SITE / "img")

    print(f"built site/index.html from {content_path}")
    print(f"  {hunt['id']}: {len(hunt['stops'])} stops, "
          f"{sum(1 for s in hunt['stops'] if s.get('gate'))} gates, "
          f"{sum(1 for s in hunt['stops'] if s.get('question'))} questions, "
          f"{sum(1 for s in hunt['stops'] if s.get('lens'))} lenses, "
          f"{len(set(images))} images")


def main():
    if len(sys.argv) != 2:
        print("usage: python3 pipeline/build.py content/<hunt>.json", file=sys.stderr)
        return 2
    try:
        build(sys.argv[1])
    except ContentError as err:
        print(f"content error — {err}", file=sys.stderr)
        return 1
    except FileNotFoundError as err:
        print(f"missing file — {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
