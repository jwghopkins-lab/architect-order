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

    python3 pipeline/build.py content/fixture.json

Python 3 standard library only, no npm, no bundler. It validates the hunt and
exits non-zero naming the stop if anything is wrong, then writes `site/`.

## Test

    python3 -m http.server -d site 8000

Then open `http://localhost:8000`. Not `file://`: the camera needs a secure
context, and localhost counts as one while a file path does not.

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

## Deploy

Pushing to `main` builds and publishes to GitHub Pages. Which hunt gets
published is the `HUNT` variable at the top of `.github/workflows/pages.yml`.
