#!/usr/bin/env python3
"""Validate a hunt and bake it into the player.

    python3 pipeline/build.py content/architect-order.md
    python3 pipeline/build.py content/fixture.json

A hunt is either narrative Markdown, which is the readable way to write one,
or JSON, which is the same thing with the prose in quotes. Both arrive here
as the same structure and are validated and baked identically.

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

# The reader sits beside this file rather than inside it, and running a script
# does not always put its own directory on the path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import narrative  # noqa: E402

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
        elif kind == "pause":
            # A beat between blocks. Bounded, because a pause under a tenth of
            # a second is a typo and one over five is a page that looks broken.
            ms = b.get("ms")
            if not is_num(ms) or not 100 <= ms <= 5000:
                fail(at, f"pause ms is {ms!r}, must be between 100 and 5000")
        else:
            fail(at, f"unknown block type {kind!r} (text, image or pause)")


def check_gate(gate, where):
    # No prompt any more: the gate is the compass, the distance and the
    # button. One left in older content is carried through and not shown.
    for field in ("lat", "lon", "radius_m"):
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


def check_reveal(r, where):
    """A name that resolves. With at_m, on the approach to a gate: zero means
    on the pass rather than at a distance. Without it, when the stop is
    finished, whatever finishes it."""
    if not isinstance(r, dict):
        fail(where, "reveal must be an object")
    at = r.get("at_m")
    if at is not None and (not is_num(at) or at < 0):
        fail(where, f"reveal at_m is {at!r}, must be 0 or a number of metres")
    if not str(r.get("chapter") or "").strip() and not str(r.get("title") or "").strip():
        fail(where, "reveal needs a chapter or a title to change to")


def check_letters(letters, where):
    """What a finished stop leaves on its card: capitals, and whether the
    player sees them in order."""
    if not isinstance(letters, dict):
        fail(where, "letters must be an object")
    text = str(letters.get("text") or "").upper()
    if not text.strip():
        fail(where, "letters has no letters")
    if any(not ("A" <= ch <= "Z" or ch == " ") for ch in text):
        fail(where, f"letters {text!r} must be capital letters A to Z, and spaces")
    letters["text"] = text
    scrambled = letters.setdefault("scrambled", False)
    if not isinstance(scrambled, bool):
        fail(where, f"letters scrambled is {scrambled!r}, must be true or false")


def check_finale(hunt):
    """The ending rearranges every stop's letters into the finale, so the two
    have to be the same letters, and it is far better to hear that here than
    to watch a letter with nowhere to go on a phone at the end of a walk."""
    finale = hunt.get("finale")
    letters = "".join(s["letters"]["text"] for s in hunt["stops"] if s.get("letters"))
    if finale is None:
        return
    finale = str(finale).upper()
    if not finale.strip() or any(not ("A" <= ch <= "Z" or ch == " ") for ch in finale):
        fail("hunt.finale", f"{finale!r} must be capital letters A to Z, and spaces")
    hunt["finale"] = finale
    if not letters:
        fail("hunt.finale", "there is a finale but no stop leaves any letters behind")
    have, want = sorted(letters.replace(" ", "")), sorted(finale.replace(" ", ""))
    if have != want:
        missing = list(want)
        for ch in have:
            if ch in missing:
                missing.remove(ch)
        extra = list(have)
        for ch in want:
            if ch in extra:
                extra.remove(ch)
        fail("hunt.finale", f"the stops leave {letters.replace(' ', '')!r}, which does not "
                            f"rearrange into {finale!r}: missing {''.join(missing) or 'nothing'}, "
                            f"left over {''.join(extra) or 'nothing'}")


def validate(hunt):
    """Check the whole hunt. Returns the image srcs it referenced."""
    images = []
    for field in ("id", "title", "stops"):
        if not hunt.get(field):
            fail("hunt", f"no {field}")
    # One flag for every player-facing testing affordance: the Skip buttons,
    # the threshold slider, the Start over in the bar. One edit turns them all
    # off before anybody plays for real.
    if "skips" in hunt:
        fail("hunt", "skips was renamed test_mode")
    test_mode = hunt.setdefault("test_mode", False)
    if not isinstance(test_mode, bool):
        fail("hunt", f"test_mode is {test_mode!r}, must be true or false")
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

        if not str(s.get("chapter", "")).strip():
            fail(where, "no chapter")
        # A title is optional: the card shows one only when the content gives it.
        if s.get("title") is not None and not isinstance(s["title"], str):
            fail(where, "title must be text")
        if not s.get("body"):
            fail(where, "no body")
        check_blocks(s["body"], f"{where}.body", images)
        check_blocks(s.get("after") or [], f"{where}.after", images)

        gate = s.get("gate")
        if gate:
            check_gate(gate, where)
        if s.get("compass") and not gate:
            fail(where, "compass is on but there is no gate to point at")
        if s.get("distance") and not gate:
            fail(where, "distance is on but there is no gate to measure to")
        if s.get("compass_min_m") is not None:
            if not s.get("compass"):
                fail(where, "compass_min_m is set but the compass is not on")
            if not is_num(s["compass_min_m"]) or s["compass_min_m"] < 0:
                fail(where, f"compass_min_m is {s['compass_min_m']!r}, must be 0 or a number of metres")
        if s.get("reveal") is not None:
            check_reveal(s["reveal"], where)
            lens = s.get("lens") or {}
            match = lens.get("kind") == "stencil" and lens.get("match") is not None
            # On the approach, a name needs a gate to approach. On the finish,
            # it needs something that finishes: a match, a question or a gate.
            if s["reveal"].get("at_m") is not None and not gate:
                fail(where, "reveal at a distance needs a gate to approach")
            if s["reveal"].get("at_m") is None and not (match or s.get("question") or gate):
                fail(where, "reveal needs a match, a question or a gate to finish on")
        if s.get("question"):
            check_question(s["question"], where)
        if s.get("lens"):
            check_lens(s["lens"], where, images)
        if s.get("letters") is not None:
            check_letters(s["letters"], where)
    check_finale(hunt)
    return images


def load(content_path):
    """Markdown or JSON, by the name of the file. Same structure either way."""
    path = Path(content_path)
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() in (".md", ".markdown"):
        return narrative.parse(text, default_id=path.stem)
    try:
        return json.loads(text)
    except json.JSONDecodeError as err:
        fail(str(path), f"line {err.lineno}: {err.msg}")


def build(content_path, out_dir):
    hunt = load(content_path)
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

    # Only this hunt's own directory is cleared, so the fixture can be built
    # into a corner of the real site without flattening it.
    out = Path(out_dir)
    if out.resolve() == BASE.resolve() or out.resolve() in BASE.resolve().parents:
        fail("output", f"{out} is the repository itself, not a place to build into")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / "index.html").write_text(page, encoding="utf-8")
    shutil.copy2(APP / "lens.js", out / "lens.js")
    # Only the images the hunt refers to. app/img/ also holds the other hunts'
    # pictures and the stencil preview that is documentation, not content, and
    # none of that belongs on a page handed to a player.
    for src in sorted(set(images)):
        dest = out / src
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(APP / src, dest)

    print(f"built {out / 'index.html'} from {content_path}")
    print(f"  {hunt['id']}: {len(hunt['stops'])} stops, "
          f"{sum(1 for s in hunt['stops'] if s.get('gate'))} gates, "
          f"{sum(1 for s in hunt['stops'] if s.get('question'))} questions, "
          f"{sum(1 for s in hunt['stops'] if s.get('lens'))} lenses, "
          f"{len(set(images))} images, test mode {'on' if hunt['test_mode'] else 'off'}"
          + (f", finale {hunt['finale']!r}" if hunt.get("finale") else ""))


def main():
    if len(sys.argv) not in (2, 3):
        print("usage: python3 pipeline/build.py content/<hunt>.md [output dir, default site]",
              file=sys.stderr)
        return 2
    try:
        build(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else SITE)
    except narrative.NarrativeError as err:
        print(f"{sys.argv[1]} — {err}", file=sys.stderr)
        return 1
    except ContentError as err:
        print(f"content error — {err}", file=sys.stderr)
        return 1
    except FileNotFoundError as err:
        print(f"missing file — {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
