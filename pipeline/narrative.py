#!/usr/bin/env python3
"""Read a hunt written as narrative Markdown.

JSON is a bad place to keep prose. Every paragraph becomes one long line
inside quotes, a paragraph break has to be spelled \\n\\n, a stray quote or
comma breaks the file, and moving a paragraph from one stop to another means
editing punctuation rather than moving words. This reads the same hunt
written the way it is meant to be read.

It produces exactly the shape the JSON produced, so the validation, the bake
and the player are all unchanged. Nothing here decides whether a hunt is
playable; that is still build.validate, which names the stop when it says no.

The format, in full:

    # The Architect Order          the hunt's title
    id: architect-order            optional, defaults to the file's name
    test_mode: yes                 optional, defaults to no
    diary: 148 x 210 mm            optional

    ## Intro                       prose, arrives before the walk
    ## Outro                       prose, arrives at the end
    ## Stop: <id>                  one per stop, in the order they are walked
    chapter: Location one          the header on the card
    title: ...                     optional second line on the card
    reveal: Westminster, on the pass
    gate: 51.4984528, -0.1260286, 40 m, compass, distance
    lens: stencil img/x.png, auto, match 0.35
    note: Line the drawing up with the building.
    marks: 0, 300, 600, 914        a cord lens only
    ### Body                       prose, before the gate
    ### After                      prose, once the stop is resolved
    ### Question
    ask: ...
    answers: PENNIES, PENNY, PENCE
    guesses: 3

In prose, a blank line starts a new paragraph and each paragraph arrives on
its own. A line reading (same reveal) joins the paragraph after it to the one
before, so they arrive together. A line reading (pause 1 s) holds the next
paragraph back. A picture is an ordinary Markdown image line, alone on its
line, with its caption as the quoted title.
"""

import re

# Reserved words at the start of a reveal, and the commas in the settings
# lines, are the only punctuation that carries meaning. Everything else in
# the file is words.
BOOLS = {"yes": True, "no": False, "true": True, "false": False,
         "on": True, "off": False}

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
SETTING = re.compile(r"^(?P<key>[a-z_]+)\s*:\s*(?P<value>.*)$")
IMAGE = re.compile(r'^!\[(?P<alt>[^\]]*)\]\((?P<src>[^\s)]+)(?:\s+"(?P<caption>[^"]*)")?\)$')
PAUSE = re.compile(r"^\(\s*pause\s+(?P<n>\d+(?:\.\d+)?)\s*"
                   r"(?P<unit>milliseconds?|ms|seconds?|secs?|s)\s*\)$", re.I)
SAME = re.compile(r"^\(\s*same reveal\s*\)$", re.I)
# Close enough to a direction to be a typo rather than a sentence in brackets.
NEARLY_A_DIRECTION = re.compile(r"^\(\s*(pause|same)\b", re.I)

AT_M = re.compile(r"^at\s+(\d+(?:\.\d+)?)\s*m$", re.I)
NEARLY = re.compile(r"^(at|title|on the)\s", re.I)
TITLE_OF = re.compile(r"^title\s+(.+)$", re.I)
RADIUS = re.compile(r"^(\d+(?:\.\d+)?)\s*m$", re.I)
HOLD = re.compile(r"^hold\s+(\d+(?:\.\d+)?)\s*ms$", re.I)
FALLBACK = re.compile(r"^fallback\s+(\d+(?:\.\d+)?)\s*s$", re.I)
MATCH = re.compile(r"^match(?:\s+(\d*\.?\d+))?$", re.I)

HUNT_KEYS = ("id", "test_mode", "diary")
STOP_KEYS = ("chapter", "title", "reveal", "gate", "lens", "note", "marks")
QUESTION_KEYS = ("ask", "answers", "guesses")


class NarrativeError(Exception):
    """A narrative file that cannot be read. The message names the line."""


def oops(line_no, why):
    raise NarrativeError(f"line {line_no}: {why}")


def number(raw, line_no, what):
    """A number written the way a person writes it. Whole numbers stay whole,
    so a radius of 40 metres is 40 and not 40.0 in the page."""
    try:
        value = float(raw)
    except ValueError:
        oops(line_no, f"{what} is {raw!r}, which is not a number")
    return int(value) if value.is_integer() and "." not in raw else value


def headings(text):
    """Cut the file into headed sections, each keeping its own line numbers so
    an error can point at the line the writer typed."""
    out = []
    current = None
    for line_no, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip()
        if line.lstrip().startswith("<!--"):
            continue
        found = HEADING.match(line)
        if found:
            current = {"level": len(found.group(1)), "head": found.group(2).strip(),
                       "line": line_no, "lines": [], "subs": []}
            out.append(current)
            continue
        if current is None:
            if line.strip():
                oops(line_no, "there is text before the '# ' title line")
            continue
        current["lines"].append((line_no, line))
    return out


def settings(section, allowed, what):
    """A run of `name: value` lines and nothing else. Prose in here is a
    mistake worth catching, because it would otherwise vanish silently."""
    out = {}
    for line_no, line in section["lines"]:
        if not line.strip():
            continue
        found = SETTING.match(line.strip())
        if not found or found.group("key") not in allowed:
            oops(line_no, f"{what} takes {', '.join(allowed)}, each written as "
                          f"'name: value'. This line is {line.strip()!r}")
        key = found.group("key")
        if key in out:
            oops(line_no, f"{key} is given twice")
        out[key] = (found.group("value").strip(), line_no)
    return out


def blocks(section):
    """Prose into the block list the player reveals. A blank line ends a
    block; (same reveal) glues the next one onto the last; (pause 1 s) is a
    held breath; a Markdown image line is a picture."""
    chunks = []
    current = None
    for line_no, line in section["lines"]:
        if not line.strip():
            current = None
            continue
        if current is None:
            current = (line_no, [])
            chunks.append(current)
        current[1].append(line.strip())

    out = []
    join = None                       # the line number of a waiting (same reveal)
    for line_no, lines in chunks:
        if len(lines) > 1:
            for n, one in enumerate(lines, line_no):
                if (IMAGE.match(one) or PAUSE.match(one) or SAME.match(one)
                        or NEARLY_A_DIRECTION.match(one)):
                    oops(n, f"{one!r} has to be on its own, with a blank line "
                            f"before it and after it")
        first = lines[0]
        if NEARLY_A_DIRECTION.match(first) and not (PAUSE.match(first) or SAME.match(first)):
            oops(line_no, f"{first!r} is not a direction this understands; "
                          f"write '(pause 1 s)' or '(same reveal)'")

        if len(lines) == 1 and SAME.match(first):
            if not out or out[-1]["type"] != "text":
                oops(line_no, "(same reveal) needs a paragraph before it")
            if join:
                oops(line_no, "two (same reveal) lines in a row")
            join = line_no
            continue

        if len(lines) == 1 and PAUSE.match(first):
            if join:
                oops(join, "(same reveal) must be followed by a paragraph, not a pause")
            found = PAUSE.match(first)
            ms = float(found.group("n")) * (1 if found.group("unit").lower()[0] == "m" else 1000)
            out.append({"type": "pause", "ms": int(ms)})
            continue

        if len(lines) == 1 and IMAGE.match(first):
            if join:
                oops(join, "(same reveal) must be followed by a paragraph, not a picture")
            found = IMAGE.match(first)
            out.append({"type": "image", "src": found.group("src"),
                        "alt": found.group("alt"), "caption": found.group("caption") or ""})
            continue

        # A wrapped paragraph is one paragraph: the line breaks a writer's
        # editor puts in are not breaks the player should see.
        text = " ".join(lines)
        if join:
            out[-1]["text"] += "\n\n" + text
            join = None
        else:
            out.append({"type": "text", "text": text})

    if join:
        oops(join, "(same reveal) is the last thing in this section, with nothing to join")
    return out


def reveal_word(part, reveal, line_no):
    """One of the words that may follow the new chapter. False if it is not
    one of them, so the caller can treat it as part of the chapter instead."""
    at = AT_M.match(part)
    titled = TITLE_OF.match(part)
    if part.lower() == "on the pass":
        reveal["at_m"] = 0
    elif at:
        reveal["at_m"] = number(at.group(1), line_no, "reveal distance")
    elif titled:
        reveal["title"] = titled.group(1).strip()
    else:
        return False
    return True


def read_reveal(value, line_no):
    """`reveal: Westminster, on the pass`, or `at 300 m`, or `title <words>`.

    The chapter comes first and is allowed commas of its own, so the words
    that can follow it are taken off the end one at a time and whatever is
    left is the chapter."""
    reveal = {}
    rest = value.strip()
    while True:
        head, comma, tail = rest.rpartition(",")
        if not comma:
            break
        tail = tail.strip()
        if not reveal_word(tail, reveal, line_no):
            # A near miss is a typo, not a chapter ending in "at 40 metres".
            if NEARLY.match(tail):
                oops(line_no, f"reveal ends with {tail!r}; after the new chapter only "
                              f"'on the pass', 'at <n> m' and 'title <words>' are understood")
            break
        rest = head.rstrip()
    rest = rest.strip()
    if rest and not reveal_word(rest, reveal, line_no):
        reveal["chapter"] = rest
    return reveal


def read_gate(value, line_no):
    """`gate: <lat>, <lon>, <radius> m` and then the two things a gate can
    show while it is shut."""
    parts = [p.strip() for p in value.split(",")]
    if len(parts) < 3:
        oops(line_no, f"gate is {value!r}; it needs 'latitude, longitude, <radius> m'")
    gate = {"lat": number(parts[0], line_no, "gate latitude"),
            "lon": number(parts[1], line_no, "gate longitude")}
    radius = RADIUS.match(parts[2])
    if not radius:
        oops(line_no, f"gate radius is {parts[2]!r}; write it as '40 m'")
    gate["radius_m"] = number(radius.group(1), line_no, "gate radius")
    flags = {}
    for part in parts[3:]:
        if part.lower() in ("compass", "distance"):
            flags[part.lower()] = True
        else:
            oops(line_no, f"gate has {part!r}; after the radius only 'compass' "
                          f"and 'distance' are understood")
    return gate, flags


def read_lens(value, line_no, note, marks):
    """`lens: <kind> [picture]` and then how the match behaves. The note and
    the cord's marks are their own lines, because notes contain commas."""
    parts = [p.strip() for p in value.split(",")]
    head = parts[0].split(None, 1)
    if not head:
        oops(line_no, "lens has no kind (stencil, cord or arrow)")
    kind = head[0].lower()
    lens = {"kind": kind}
    if kind == "stencil":
        if len(head) < 2:
            oops(line_no, "a stencil lens needs its picture: 'lens: stencil img/....png'")
        lens["src"] = head[1].strip()
    elif len(head) > 1:
        oops(line_no, f"a {kind} lens takes no picture, but this one has {head[1]!r}")
    if note is not None:
        lens["note"] = note[0]
    if kind == "cord":
        if marks is None:
            oops(line_no, "a cord lens needs its knots: 'marks: 0, 300, 600, 914'")
        lens["marks_mm"] = [number(m.strip(), marks[1], "a cord mark")
                            for m in marks[0].split(",") if m.strip()]
    elif marks is not None:
        oops(marks[1], f"marks belong to a cord lens, and this stop's lens is a {kind}")

    auto = None
    threshold = hold = gates = fallback = None
    wants_match = False
    for part in parts[1:]:
        low = part.lower()
        matched, held, fell = MATCH.match(part), HOLD.match(part), FALLBACK.match(part)
        if low == "auto":
            auto = True
        elif low in ("no auto", "not auto"):
            auto = False
        elif matched:
            wants_match = True
            if matched.group(1):
                threshold = number(matched.group(1), line_no, "match threshold")
        elif held:
            wants_match = True
            hold = number(held.group(1), line_no, "match hold")
        elif low in ("gated", "gates"):
            wants_match, gates = True, True
        elif low in ("not gated", "ungated"):
            wants_match, gates = True, False
        elif fell:
            wants_match = True
            fallback = number(fell.group(1), line_no, "match fallback")
        elif low == "no fallback":
            wants_match = True
        else:
            oops(line_no, f"lens has {part!r}; after the picture only 'auto', "
                          f"'match <n>', 'hold <n> ms', 'gated', 'not gated', "
                          f"'fallback <n> s' and 'no fallback' are understood")
    if auto is not None:
        lens["auto"] = auto
    if wants_match:
        match = {}
        if threshold is not None:
            match["threshold"] = threshold
        if hold is not None:
            match["hold_ms"] = hold
        if gates is not None:
            match["gate"] = gates
        if fallback is not None:
            match["fallback_s"] = fallback
        lens["match"] = match
    return lens


def read_question(section):
    setting = settings(section, QUESTION_KEYS, "a question")
    for needed in ("ask", "answers"):
        if needed not in setting:
            oops(section["line"], f"this question has no '{needed}:' line")
    answers = [a.strip() for a in setting["answers"][0].split(",") if a.strip()]
    question = {"ask": setting["ask"][0], "answers": answers}
    if "guesses" in setting:
        raw, line_no = setting["guesses"]
        if not raw.isdigit():
            oops(line_no, f"guesses is {raw!r}; it must be a whole number, 1 or more")
        question["guesses"] = int(raw)
    return question


def read_stop(section):
    stop_id = section["head"].split(":", 1)[1].strip()
    if not stop_id:
        oops(section["line"], "a stop heading needs a name: '## Stop: first'")
    setting = settings(section, STOP_KEYS, f"stop {stop_id!r}")

    stop = {"id": stop_id}
    if "chapter" in setting:
        stop["chapter"] = setting["chapter"][0]
    if "title" in setting:
        stop["title"] = setting["title"][0]
    if "reveal" in setting:
        stop["reveal"] = read_reveal(*setting["reveal"])

    body = after = question = None
    for sub in section["subs"]:
        name = sub["head"].strip().lower()
        if name == "body":
            body = blocks(sub)
        elif name == "after":
            after = blocks(sub)
        elif name == "question":
            question = read_question(sub)
        else:
            oops(sub["line"], f"'### {sub['head']}' is not a part of a stop "
                              f"(Body, After or Question)")
    stop["body"] = body if body is not None else []

    if "gate" in setting:
        gate, flags = read_gate(*setting["gate"])
        stop["gate"] = gate
        stop.update(flags)
    if question is not None:
        stop["question"] = question
    if "lens" in setting:
        stop["lens"] = read_lens(*setting["lens"],
                                 note=setting.get("note"), marks=setting.get("marks"))
    elif "note" in setting:
        oops(setting["note"][1], "a note belongs to a lens, and this stop has no lens")
    elif "marks" in setting:
        oops(setting["marks"][1], "marks belong to a cord lens, and this stop has no lens")
    if after is not None:
        stop["after"] = after
    return stop


def parse(text, default_id="hunt"):
    """The whole file into the structure the build validates and bakes."""
    sections = headings(text)
    if not sections or sections[0]["level"] != 1:
        raise NarrativeError("the file must start with '# ' and the hunt's title")

    top = []
    for section in sections[1:]:
        if section["level"] == 2:
            top.append(section)
        elif section["level"] == 3:
            if not top:
                oops(section["line"], f"'### {section['head']}' comes before any "
                                      f"'## Stop:' section")
            top[-1]["subs"].append(section)
        else:
            oops(section["line"], f"'{'#' * section['level']} {section['head']}' — a hunt "
                                  f"uses '# ' once, then '## ' and '### '")

    setting = settings(sections[0], HUNT_KEYS, "a hunt")
    hunt = {"id": setting["id"][0] if "id" in setting else default_id,
            "title": sections[0]["head"]}
    if "test_mode" in setting:
        raw, line_no = setting["test_mode"]
        if raw.lower() not in BOOLS:
            oops(line_no, f"test_mode is {raw!r}; write yes or no")
        hunt["test_mode"] = BOOLS[raw.lower()]
    if "diary" in setting:
        raw, line_no = setting["diary"]
        found = re.match(r"^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm$", raw, re.I)
        if not found:
            oops(line_no, f"diary is {raw!r}; write it as '148 x 210 mm'")
        hunt["diary_mm"] = {"w": number(found.group(1), line_no, "diary width"),
                            "h": number(found.group(2), line_no, "diary height")}

    stops = []
    for section in top:
        name = section["head"].strip().lower()
        if name == "intro":
            hunt["intro"] = blocks(section)
        elif name == "outro":
            hunt["outro"] = blocks(section)
        elif name.startswith("stop:"):
            stops.append(read_stop(section))
        else:
            oops(section["line"], f"'## {section['head']}' is not a section of a hunt "
                                  f"(Intro, Outro, or 'Stop: <name>')")
    hunt["stops"] = stops
    return hunt
