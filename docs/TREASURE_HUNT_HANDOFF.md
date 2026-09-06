# Treasure Hunt — handoff

A new web app in the repository `jwghopkins-lab/Treasure_hunt`, which exists,
is empty, and has its GitHub Pages source already set to GitHub Actions. It
reuses the working parts of `jwghopkins-lab/architect-order` (public; clone it
read-only as a reference, never push to it) and adds a different game on top.

The game: a hunt has a name and six to nine stencils, each cut from a
photograph the owner took standing somewhere. The player sees the stencils as
thumbnails, picks any one, and the camera opens with that stencil fixed over
the live view. To pass it the player has to stand where the photograph was
taken and point the phone the same way, until the live edges agree with the
stencil for long enough. A passed stencil gets a green tick. When every one
is passed the page says Congratulations and the clock stops. A stencil may
carry a clue and the place it was taken, which give a line of text and a
distance and bearing under the camera, and a hunt may carry a map of where
its photographs were taken, or a hand-drawn one for a small or indoor hunt.

The owner will use the session that builds this to create a series of hunts:
for each, a name and six to nine photographs. Section 9 says what to do with
them.

## 1. What to take from architect-order, and what to leave

Take, adapting as this document says:

- `app/lens.js`: the camera lifecycle (`startCamera`, `stopStream`, the
  `generation` counter so a stream that arrives after the screen closed is
  stopped on arrival, `close`), and the whole match scorer: `edgeMap`
  (grey, 3×3 box blur, 3×3 Sobel, magnitude normalised so the frame's 99th
  percentile is 1, histogram over the interior only), `stencilMasks`,
  `nativeMask` (threshold the PNG's alpha at its own resolution, then thicken,
  then shrink; never the other way round, the comment there says why),
  `dilate`, `meanAt`, the 27-evaluation search, the exponential smoothing
  (`MATCH_ALPHA` 0.3, one evaluation every `MATCH_EVERY_MS` 250 ms), the
  320 px working frame that drops to 240 px on a slow phone by the median of
  eight steady ticks, and the score `(on − off) / (on + off)` clamped at 0.
- `app/player.html`: the palette and the three theme states; the header
  wordmark; the sticky top bar with the progress meter; the tick: `haptic`,
  `TICK_MS`, `TICK_STRONG`, `armTicks`, `fitTick`, the `MutationObserver`
  that arms new buttons, the capture-phase click listener, the `.tickpad`
  CSS, and `hapticReport` for the menu; `LS` (localStorage namespaced by
  hunt id); the `⋯` menu with Start over behind a confirm; `escapeHtml`;
  `toast`; the geography: `haversineM`, `bearingDeg`, `compassPoint` (one
  of eight points), `aboutM` (a distance rounded the way a person says it),
  `ACC_USELESS_M` 75 (a fix worse than that is no information), and the
  shape of `startFixWatch`/`stopCompass`: one `watchPosition` with
  `enableHighAccuracy` while a screen that needs it is open, cleared the
  moment it closes, because a watch left running is a battery spent.
- `pipeline/build.py`: the shape of it. Standard library only, validate
  loudly naming the stencil, bake the hunt into the page over the
  `<!-- HUNT GOES HERE -->` marker with `</` escaped, copy only the images
  the hunt references, refuse to build into the repository itself.
- `.github/workflows/pages.yml`: the shape of it, including the final step
  that curls the deployed URL rather than the local build.
- The testing approach: Playwright headless Chromium with a fake camera
  (`--use-fake-device-for-media-stream`, `--use-file-for-fake-video-capture`
  with a y4m file), a stubbed `navigator.vibrate`, and page errors collected.
  The architect-order session wrote a tool that turns a PNG into a y4m; write
  one again (Y4M is a text header then raw I420 frames; one frame repeated).

Leave behind, entirely: location gates (the check, the pass rule, Continue)
and the position simulator; the narrative, reveals, questions, answers,
letters, the finale; the diary, the cord and arrow lenses, calibration; the
Markdown reader; the calibration log and Copy log; test-mode threshold slider,
Log, Skip, Progress, the Fade slider, the photo fallback and Choose a photo;
drag, pinch and rotate of the overlay. None of it exists in the new app.

One dependency is new, and it is the only one: Leaflet 1.9.4 for the map
(section 6a), vendored into `app/vendor/leaflet/` (`leaflet.js`,
`leaflet.css`, and its `images/`), not loaded from a CDN, and copied to
the site only for a hunt whose map needs it. Everything else stays without
a library, an install or a bundler.

## 2. Making a stencil from a photograph

`pipeline/stencil.py`, Pillow only, no numpy (the build stays standard
library; this tool is the one thing that needs an install, like
architect-order's `pipeline/plaques.py`).

    python3 pipeline/stencil.py photos/<slug>/*.jpg
        --keep 0.06 --speck 60 --long 800 --out app/img/<slug>

This recipe was prototyped in the architect-order session on a photograph of
a bronze plaque set in granite: the frame came out as clean lines, the
lettering was too faint to survive the top 6%, and the granite speckle
survived as blobs until the speck limit was raised. Expect that: strong
outlines make the stencil, fine detail does not, and the preview is where
you find out.

For each photograph:

1. Apply the EXIF orientation (`ImageOps.exif_transpose`), so a portrait
   photo is portrait. Resize so the long side is `--long` px (default 800),
   keeping the aspect ratio. Nearly every phone photo is 3:4, giving 600×800.
2. Compute exactly the edge map the player's `edgeMap` computes, so the
   stencil is the edges the camera will see: greyscale by 0.299/0.587/0.114,
   a 3×3 box blur, a 3×3 Sobel in both directions, magnitude, a 256-bin
   histogram of the interior, normalised so the interior's 99th percentile
   is 1 and clipped at 1. Do it in plain Python over `list(im.getdata())`
   with the same loops as `edgeMap`, line for line. Not with
   `ImageFilter.Kernel`: it refuses float images and clips a signed
   gradient to 0–255 on an `L` image, so the Sobel cannot be done with it.
   A 600×800 frame takes about a second this way, which is fine offline.
3. Keep the strongest pixels: those above the threshold that leaves the
   fraction `--keep` (default 0.06) of the interior set. Then drop specks:
   8-connected components with fewer than `--speck` pixels (default 60),
   found with a plain stack-based flood fill over the pixel list. Texture
   (granite, gravel, foliage) survives as scattered blobs; a bigger
   `--speck` is the first thing to try, then a smaller `--keep`.
4. Thicken by one pixel (`MaxFilter(3)`) so the lines are 2–3 px, the
   width the scorer's masks expect.
5. Write `<id>-stencil.png`: RGBA, every kept pixel exactly (255, 61, 0, 255),
   everything else fully transparent, no antialiasing, the same size as the
   resized photo. `<id>` is the photo's filename without its extension,
   lower-cased, spaces to hyphens.
6. Print one JSON stencil entry per photo for pasting into the hunt file,
   and write `<id>-stencil-preview.jpg`: the stencil over the resized
   photograph, for the owner to look at. Previews are not shipped.

Look at every preview. A photo with too much texture (foliage, gravel,
brick) gives a stencil that is noise; raise `--speck`, lower `--keep`, or
ask for another photo. A stencil is good when a person could tell what it is.

## 3. The hunt file

`content/<slug>.json`:

    {
      "id": "trafalgar",
      "name": "Trafalgar",
      "test_mode": false,
      "map": {"bounds": [[51.5060, -0.1310], [51.5100, -0.1240]]},
      "stencils": [
        {"id": "lions", "src": "img/trafalgar/lions-stencil.png",
         "clue": "Between the fountains, looking north.",
         "location": {"lat": 51.50787, "lon": -0.12812}},
        {"id": "column", "src": "img/trafalgar/column-stencil.png"}
      ]
    }

`id` is the hunt's slug and the localStorage namespace. `name` is what the
title bar shows. `clue` is optional and one sentence; absent means nothing
is shown. `location` is optional: where the photograph was taken, and it
drives the distance line (section 6) and the marker on the map (6a).

`map` is optional and one of two shapes. `{"bounds": [[south, west],
[north, east]]}` is a street map of that area, and the session sets the
corners from the stencils' locations with about 150 m of margin, once it
has them. `{"image": "img/<slug>/map.jpg"}` is a hand-made map the owner
supplies for a small or indoor hunt: it is shown as a picture to pan and
pinch, and no location of any kind is shown or read with it. With no
`map` there is no map button.

Validation: unique stencil ids, every `src` exists under `app/`, six to nine
stencils (warn, do not fail, outside that), `test_mode` a boolean
defaulting to false, `name` present; a `location` has numeric `lat` and
`lon` on the Earth; `bounds` are two such pairs with south below north and
west below east, and every located stencil lies inside them; a map `image`
exists under `app/`; a hunt with `bounds` and no located stencil is an
error.

The photographs themselves live in `photos/<slug>/` and that directory is
gitignored. They give the answers away, the stencils are derived from them,
and the repository is public because Pages is.

## 4. The build and the site

    python3 pipeline/build.py content/trafalgar.json site/trafalgar

One page per hunt at `/<slug>/`. `site/index.html` at the root is the
wordmark `Treasure Hunt` and the hunts as links by name, nothing else. The
workflow runs a shell loop over `content/*.json`, the slug being each
file's stem, builds each into `site/<slug>/`, writes the root index (the
build script takes `--index` for that, or a second small script), publishes
`site`, then curls the root and each hunt's URL. The build copies the
stencils, a map image if there is one, and `vendor/leaflet/` only for a
hunt with a `bounds` map.

Also build `site/capture/index.html`, a page that opens the back camera with
exactly the `getUserMedia` request the game makes, shows it with the same
letterboxing, and has one shutter button that downloads the current frame
as a JPEG at the stream's own resolution (draw the video onto a canvas of
`videoWidth × videoHeight`, `toBlob`, an `<a download>`). It is how the
owner should take the hunt photographs: through the same lens and crop the
game will see, on the phone that will play, so the photograph and the live
view have the same framing by construction. Section 10 says why. This page
is the architect-order session's addition, not the owner's request; it is
here to protect the one mechanic the game rests on, and it is separate from
the game, so nothing in the game gains a word by it.

## 4a. State, on the phone

localStorage, namespaced `treasure.<id>.`, one key `state`:

    { "startedAt": 1757170000000 | null,
      "started": { "<stencil id>": true },
      "done": { "<stencil id>": 1757170420000 } }

`startedAt` is set by the first thumbnail tap and never moved. A stencil is
`started` from its first tap until it is `done`; `done` holds the time of
the pass. The clock shows `now − startedAt`, or `0:00` before it, or, once
every stencil is done, `max(done) − startedAt`, fixed. Start over deletes
the key, so the clock goes back to `0:00` and every tile to untouched.
A reload changes nothing: the page is rebuilt from `state`.

## 5. The main screen

Top to bottom, and nothing that is not listed:

- The header: the hunt's `name` on the left in the wordmark style, and on
  the right the clock, `m:ss`, `h:mm:ss` past an hour, ticking every second.
  It starts at the first tap on any thumbnail and is stored as a timestamp
  so a reload continues it. Before that tap it shows `0:00`. When the last
  stencil passes it freezes at the finishing time.
- The `⋯` menu button, as in architect-order, whose menu has Start over
  behind the confirm and nothing else.
- Beside it, only when the hunt has a `map`, a round map button of the same
  size carrying a map glyph (an SVG, no word), which opens the map screen
  (section 6a).
- The sticky progress meter: passed stencils over all stencils. No numbers.
- The thumbnails, three to a row (`grid-template-columns: repeat(3, 1fr)`,
  8 px gaps), square tiles (`aspect-ratio: 1`) in the order of the hunt
  file. Each tile is a `<button>` whose whole face is the stencil PNG on a
  dark ground that stays dark in both themes (the orange needs it), with
  `object-fit: contain` and 6% padding. Three states: untouched, a 2 px
  border in `--line`; started and left, a 3 px amber border (add an
  `--amber` token to the palette, one value per theme); passed, a 3 px
  `--good` border and a badge over the top-right corner, a `--good` disc
  about 28 px with a white tick. A passed tile is inert: its tap ticks like
  any tap and opens nothing. Every other tile opens the camera screen.
- Once every stencil has passed, one line under the grid: `Congratulations!`

No words anywhere else on this screen. No stencil is numbered. The stencil
PNGs are the thumbnails, so they are already loaded when the camera needs
them.

## 6. The camera screen

Opens from a thumbnail tap, which is the user gesture the camera needs.
Full screen, over the main screen, exactly these things:

- The live video from the back camera, letterboxed, not cropped: the
  `<video>` fills the screen with `object-fit: contain` on a black ground,
  at the stream's own aspect ratio. The `getUserMedia` request is the one
  architect-order makes, `{ video: { facingMode: { ideal: "environment" } },
  audio: false }`, and nothing more: an `aspectRatio` or size constraint
  changes the crop a phone hands over, and the capture page must get the
  same crop the game gets. Until the stream arrives the ground is black
  with the stencil already over it and the bar at zero.
- The stencil, fixed. Work out the video's rendered rectangle from
  `videoWidth`/`videoHeight` against the element's box (the letterbox
  arithmetic), then the largest rectangle of the stencil's own aspect that
  fits inside it, centred. Size the stencil `<img>` to exactly that drawn
  rectangle with explicit `width`/`height` and absolute position; do not
  rely on `object-fit` on the image, because `stencilMasks` reads
  `offsetWidth`/`offsetHeight` as the drawn size. Recompute on `resize`,
  `orientationchange` and `loadedmetadata`. It cannot be dragged, pinched
  or rotated: there are no gestures on this screen at all. Stencil pixel
  (x, y) sits over video pixel (x, y) scaled, so it lines up when the phone
  is where the photograph was taken.
- The match bar, architect-order's `#matchbar` moved to the very top of the
  screen, the full width, under the back button's row or with the back
  button floating over its left end. Green, always, and its fill is
  `min(1, smoothed score / 0.35)`: the full width is a pass on the 0.35
  line, so a pass that comes from the 0.30 or 0.25 timer is seen with the
  bar part of the way across. No numbers, no tick mark, no threshold line.
- The clue, if the stencil has one: one sentence in a translucent dark
  strip across the bottom, over the video. If none, nothing.
- Under the clue, if the stencil has a `location`: one line, the distance
  and the bearing from the phone to where the photograph was taken, in the
  same translucent strip: `About 240 m · NE`, from `aboutM` and
  `compassPoint`, so it reads as a person would say it and points one of
  eight ways. It is the direction from where the phone is to the target,
  not which way the phone is facing; the phone's heading is not used. It
  comes from one `watchPosition` started when this screen opens for a
  located stencil and cleared when it closes, and it repaints on every fix
  whose accuracy is at most `ACC_USELESS_M`; on a worse fix, or before the
  first, or if location is refused, the line is empty and nothing says so.
  It shows all the way in: there is no five-hundred-metre drop-out here.
  With no `location`, no line and no permission prompt.
- A back button, top-left, `←`, which closes the camera, stops the stream
  and the watch, and returns to the main screen with this stencil marked
  started.
- On the pass (section 7): the line `Complete!` large in the middle of the
  screen over a green wash, the match loop stopped, Android vibrating the
  strong pattern at once. After 1.5 s the screen returns to the main screen
  by itself with the stencil marked passed. The wash is also a full-screen
  `<button data-strong>`: a tap on it returns at once and, being a tap,
  ticks on iPhone. An iPhone can only tick under a finger (see The tick in
  architect-order's README), so a pass that returns by itself is silent
  there; the tap is the one chance of a tick, and it is not required.
- In test mode only, a plain Skip in the top-right, which marks the stencil
  passed without a match. With `test_mode` false it does not exist.

The scorer's working frame is the video's rendered rectangle, not the
screen. `workSize` takes the rectangle's size, not the window's; `edgeMap`
draws the source's whole frame into the working canvas, no crop; and
`stencilMasks` places the stencil with `view = { x, y, scale: 1, rot: 0 }`
at the rectangle's centre, translating by the rectangle's origin before
scaling by `k`, so working pixel (0, 0) is the rectangle's corner. Widen
the search: `MATCH_SHIFTS = [-5, 0, 5]` and `MATCH_SCALES = [0.9, 1, 1.1]`,
still 27 evaluations. The scale search is what absorbs a browser camera
whose crop is a little different from the photograph's.

With no camera (refused, or none), the video area shows the single line
`The camera was refused.` or `No camera here.` and the back button. No
photo fallback: a chosen photo would be the answer.

## 6a. The map screen

Opens from the map button, full screen over the main screen, with the same
`←` back button top-left and nothing else that is a word, except the
attribution Leaflet and OpenStreetMap require, small, bottom-right.

With `map.bounds`: a Leaflet map with OpenStreetMap's standard tiles
(`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, attribution
`© OpenStreetMap contributors`, which their tile policy requires, and a
maximum zoom of 19), opened with `fitBounds` on the hunt's `bounds`, so the
session's corners are what the player sees first. Pan and pinch as Leaflet
does them. On it:

- One marker per located stencil at its `location`: a Leaflet
  `circleMarker`, 10 px, filled `--good` if passed, `--amber` if started,
  the accent colour otherwise, with a white edge. Tapping one opens a
  Leaflet popup holding that stencil's thumbnail and nothing else.
- The player: a small blue dot with a translucent accuracy circle, from a
  `watchPosition` started when the map opens and cleared when it closes,
  painted on every fix, moved as fixes arrive; nothing if location is
  refused or has not arrived. The map does not follow the player.
- Along the bottom, over the map, one `?` tile per stencil that has no
  `location`, a square of the same style as the thumbnails but carrying a
  large `?` instead of the stencil, in the hunt's order, with the same
  green tick badge if passed. Tapping one shows that stencil's thumbnail in
  a popup. If every stencil is located, no row.

With `map.image`: the picture, in a Leaflet map with `L.CRS.Simple` and an
`imageOverlay` whose bounds are the image's pixel size, fitted to the
screen, so it pans and pinches; no tiles, no markers, no player dot, no `?`
row, no location read at all, and no attribution.

The map is part of the hunt's page (a screen in `player.html`, Leaflet
loaded from `vendor/leaflet/`), not a separate page, so the state and the
tick are the same objects. Leaflet's own zoom buttons are hidden; the
pinch is enough.

## 7. The pass rule

The smoothed score is evaluated every 250 ms. The stencil passes when any
one of these has held, continuously, on consecutive evaluations:

| score at least | for |
|---|---|
| 0.35 | 0.6 s |
| 0.30 | 1.0 s |
| 0.25 | 2.0 s |

Each line keeps its own timer, started when the score first reaches it and
cleared the moment the score drops below it. The first timer to expire
passes the stencil. There is no Progress button and no fallback timer; a
stencil that never matches is never passed, except by Skip in test mode.
The smoothing starts at the first raw score rather than at zero, as it does
now, so a good alignment passes about a second after the first evaluation.

Write the rule as one pure function, `passRule(state, score, now)`, that
returns the updated timers and whether it passed, and call it from the
match loop. It is then testable with made-up sequences (section 11).

On the pass: `done[id]` is stored with the finishing time, the strong
vibration fires, the match loop and the watch stop, the screen shows
`Complete!` over the green wash, and 1.5 s later, or on a tap, the camera
closes and the main screen is rebuilt with the tile green. There is nothing
to press to complete a stencil.

## 8. The tick

Every tap ticks, exactly as architect-order does it: the invisible native
switch stretched over every button's face for iPhone, and one 50 ms
vibration in the capture phase for everything else. The strong pattern,
`[60, 50, 60]`, on: the pass itself (Android, from the match loop; Chrome
allows a vibration outside a tap once the page has been tapped, which it has),
and a tap on the `Complete!` wash if the player makes one (`data-strong`).
Thumbnail taps, the map button, marker taps and the back buttons are
ordinary taps. Keep `hapticReport` reachable from the menu only when
`test_mode` is on.

## 9. Creating a hunt, which the owner will do in the session

The owner gives a name and six to nine photographs; clues for some or none
of them; coordinates for some, all or none of them, each as a latitude and
longitude of where the photograph was taken; and either nothing for the
map, or a hand-made map image for a small or indoor hunt. The session:

1. Saves the photographs to `photos/<slug>/<id>.jpg`, gitignored. A
   hand-made map goes to `app/img/<slug>/map.jpg` (or `.png`), committed.
2. Runs `pipeline/stencil.py` on them and looks at every preview, tuning or
   asking for a replacement where a stencil is noise.
3. Writes `content/<slug>.json` with the name, the stencils in the order
   given, the clues exactly as given, and each `location` as given. If any
   stencil has a location and there is no hand-made map, adds
   `map.bounds`: the smallest box round every location, widened by about
   150 m on each side, rounded to four decimal places. If there is a
   hand-made map, `map.image` instead, and the locations are still kept on
   the stencils for the distance line only if the owner gave them.
4. Builds, runs the tests (section 11) including the fake-camera pass for
   every stencil of the new hunt, commits the stencils and the hunt file,
   pushes to `main`, waits for the Pages run, and reports the hunt's URL,
   a contact sheet of the stencils over their photographs, and a screenshot
   of the map screen as it opens.

The photographs should be taken with the capture page on the phone that
will play, in portrait, without zooming. If they were taken with the camera
app instead, say so in the report: they will still work if the camera app
was at 1× on the main lens, with more reliance on the scale search.

## 10. Known risk, stated so it is not rediscovered

A browser's camera stream and the phone's camera app do not always show the
same field of view: on iPhone in particular the stream can be a crop of what
the Camera app captures, or the reverse. The stencil is fixed, so a scale
difference between the photograph and the live view cannot be corrected by
the player. That is why the capture page exists and is the recommended way
to take the photographs, and why the scale search runs to ±10%. If field
tests show a systematic scale difference for camera-app photos, the fix is
a per-hunt `scale` in the hunt file applied to every stencil, not a wider
search.

## 11. Tests, before anything is pushed

Playwright, headless Chromium, mobile viewport, against a local
`python3 -m http.server`. Commit the suites and the y4m tool under `tests/`
so a later session can run them; they are not part of the site. At least:

- The main screen: name in the title bar, clock at `0:00`, three-per-row
  tiles with the right stencil images, no numbers, no other words.
- The first thumbnail tap starts the clock; a reload continues it.
- The camera screen shows the stencil fixed, the bar at the top, the clue
  when set and nothing when not, the back button, and no other controls;
  pointer drags and pinches do not move the stencil.
- The bar: a smoothed score of 0.175 fills half the width, 0.35 and above
  fills all of it.
- The distance line, with Playwright's mocked geolocation: a located
  stencil shows `About 240 m · NE` for a phone 240 m south-west of it, the
  wording changes as the mock moves, a 100 m accuracy blanks it, and an
  unlocated stencil shows no line and asks for no permission (no
  `watchPosition` call, checked with a stub).
- The pass shows `Complete!`, returns to the main screen by itself within
  two seconds with the tile green, and a tap on the wash returns at once
  with a strong tick. Build the tests so the pass is reached both ways: by
  the fake camera, and by the test-mode Skip.
- The map screen, `bounds` kind: opens fitted to the hunt's bounds (check
  the Leaflet map's bounds contain them and are not much larger), one
  marker per located stencil in the state's colour, a `?` tile per
  unlocated stencil along the bottom, the player's dot at the mocked
  position, the attribution present, and the watch cleared on back.
- The map screen, `image` kind: the image fills the screen, pinch and pan
  work, and no marker, dot, `?` row, attribution or `watchPosition`.
- A hunt with no `map` has no map button.
- With the stencil's own photograph as the fake camera feed, a y4m at the
  photograph's own portrait size so `videoWidth`/`videoHeight` match it, the
  stencil passes within three seconds; with a blank grey feed it does not
  pass in ten.
- The three timers, on `passRule` with made-up sequences at 250 ms steps,
  the first evaluation at 0 ms: a constant 0.36 passes on the fourth
  evaluation (750 ms) and not the third; 0.31 on the fifth (1000 ms) and not
  the fourth; 0.26 on the ninth (2000 ms) and not the eighth; 0.24 never; a
  single dip below a line resets that line's timer and no other.
- Back marks the tile amber; the pass marks it green with a tick and moves
  the progress meter; all passed shows Congratulations and freezes the clock.
- Every tap ticks inside the tap; the pass fires the strong pattern; a tap
  on the wash is strong; a tile tap is a single pulse.
- Start over confirms, then forgets everything including the clock.
- Test mode off: no Skip anywhere.
- `stencil.py` on a checked-in sample photo produces a stencil the scorer
  passes against that photo, and a blank image produces an empty stencil
  with a clear message rather than a crash.

## 12. The leaderboard

Not built, and this is why. A leaderboard of everybody who has completed
the hunt has to be readable by every phone, so the completions have to be
stored somewhere every phone can reach. That is a shared store, which is a
database whatever it is called: GitHub Pages serves files and cannot accept
a write, and every hosted alternative is a database with a key. The owner
asked for this feature only if it could be done without one, so it is left
out, and with it the display-name prompt, which existed only to feed it.

The nearest thing that needs no store is a board of the players who have
completed the hunt on that one phone, which is nearly always one player.
Say in the report that it was left out and why.

## 13. Report

When the app is built: the Pages URL, the test counts, what was taken from
architect-order and what was changed in it, the leaderboard decision, the
capture page's URL with the advice to take the hunt photographs with it,
and what each hunt needs from the owner: the name, the photographs, and
for each photograph an optional clue and an optional latitude and
longitude, plus an optional hand-made map image. Then wait for the first
hunt.
