# The Architect Order

A real-world walking puzzle game, played on a phone alongside a paper diary the
team carries. One static page on GitHub Pages: no backend, no logins, no
accounts. A team is a phone, and progress lives in that phone's localStorage.

The page walks a team through a fixed sequence of stops. A stop shows text and
pictures; it may require the phone to be physically at a place before going on;
it may ask a question with a small number of guesses; and it may open the
camera with a picture laid over the live view that the player lines up against
something real.

## Layout

    content/fixture.json   the fixture hunt: fake stops that exercise every feature
    content/<hunt>.json    real hunts
    app/player.html        the player template, with one marker line for the hunt
    app/lens.js            the camera overlay
    app/img/               images referenced by content, by relative path
    pipeline/build.py      validate the content, bake it into the page
    site/                  build output, gitignored

## Build

    python3 pipeline/build.py content/architect-order.json site
    python3 pipeline/build.py content/fixture.json site/fixture

Python 3 standard library only, no npm, no bundler. It validates the hunt and
exits non-zero naming the stop if anything is wrong, then writes the output
directory (`site` if none is given): the page, `lens.js`, and only the images
that hunt refers to. The second directory can sit inside the first, so the
real hunt is at the site root and the fixture at `/fixture/`.

## Test

    python3 -m http.server -d site 8000

Then open `http://localhost:8000` for the real hunt and
`http://localhost:8000/fixture/` for the fixture. Not `file://`: the camera
needs a secure context, and localhost counts as one while a file path does not.

Add `#testing` to the address for the position simulator. It is deliberately
off unless asked for by name, and it does not weaken the real gate rule.

The camera and the real gates can only be tested on a phone, at the Pages URL.

## Stencils and the match

A stencil lens can carry a `match` block, at which point the lens scores how
well the edges in the camera frame line up with the stencil, several times a
second, and shows the score as a bar with a Progress button under it. The
player still lines the stencil up by hand; the code only checks the alignment.

    "lens": {
      "kind": "stencil",
      "src": "img/placeholder-stencil.png",
      "note": "Line the outline up with the plaque.",
      "auto": true,
      "match": {"threshold": 0.35, "hold_ms": 600, "gate": true, "fallback_s": null}
    }

`auto` opens the lens by itself once the stop's gate has been passed and
Continue tapped, or when the body finishes revealing if there is no gate.
`threshold` is the score that counts as matched, `hold_ms` how long it must
stay there, `gate` whether Progress waits for it, and `fallback_s` how many
seconds of trying light Progress anyway (null: never). The Log button in the
lens appends one sample per press to a per-hunt log on the phone; **Copy log**
in the menu puts it on the clipboard as tab-separated text with a header row.

**Supplying a real stencil.** A PNG with a transparent background and dark
lines 2–4 px wide, at roughly 600–800 px on the long side, drawn from a
head-on photo of the target at the framing a phone gets from three to five
metres. Big distinctive edges only: the outline and two or three strong
internal lines. A stencil that traces every engraved letter fails in glare;
one that is only a rectangle matches anything. Drop it in `app/img/`, point
`src` at it, and the build checks it exists. `img/placeholder-stencil.png` is
a rectangle inside a rectangle, which roughly fits a doorway, a window or a
notice board, for testing on almost any wall before real stencils exist.

The match reads only the alpha channel, so the line colour is free: pick one
that shows over the real surface. This is what a made stencil looks like laid
over the photo it was drawn from, which is what an aligned match looks like
on the phone. The preview is documentation and is not shipped to the player.

![The Jewel Tower stencil over its reference photo](app/img/jewel-tower-stencil-preview.jpg)

## Test mode, the live distance, and a name that resolves

- **`"test_mode": true`** at the top of a hunt turns on every player-facing
  testing affordance: a plain Skip button on every location check, every
  match and every question; the threshold slider in the lens; and a Start
  over button in the bar at the top of the walk that is always on screen.
  Skipped parts count in the ending as skipped, not wrong. One field: set it
  false and rebuild before anybody plays for real, and none of them exist.
  Start over stays in the menu either way. `#testing` in the address is
  separate: that is the position simulator, a developer tool.
- **The threshold slider**, test mode only, runs from 0.05 to 0.95 and starts
  at the stop's `match.threshold`. Moving it moves the tick on the bar and
  changes the pass test at once. The setting is kept per stop on the phone
  while test mode is on, and every Log line records the threshold in force.
- **`"distance": true`** on a stop with a gate shows the distance to the target
  from each usable fix while the gate card is open, rounded the way a person
  would say it. The compass rule is unchanged.
- **`"reveal": {"at_m": 500, "chapter": "…", "title": "…"}`** on a stop with a
  gate keeps the stop's written chapter and title until a usable fix reads
  within `at_m`, then changes them, once, for good. Passing the gate reveals
  it too. `at_m` defaults to 500, where the compass drops out; `0` means only
  on the pass. At least one of `chapter` or `title` is required.
- A stop's **`title` is optional**; the card shows the chapter as its header
  and a title only if there is one. Nothing on a card or the opening counts
  the stops. A `gate.prompt` is accepted and not shown.
- **`{"type": "pause", "ms": 1000}`** in any block list holds the next block
  back by that long, between 100 and 5000 ms. It renders nothing.
- **Finishing a reveal** is three taps within a second and a half on the text
  that is arriving. One or two taps do nothing.

## Deploy

Pushing to `main` builds and publishes to GitHub Pages: the real hunt at the
root of the Pages URL and the fixture under `/fixture/`. Which hunts those are
is the pair of variables, `HUNT` and `FIXTURE`, at the top of
`.github/workflows/pages.yml`.
