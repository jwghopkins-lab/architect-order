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

## Deploy

Pushing to `main` builds and publishes to GitHub Pages. Which hunt gets
published is the `HUNT` variable at the top of `.github/workflows/pages.yml`.
