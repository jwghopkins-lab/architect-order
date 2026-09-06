# A place to go, seen through the camera: plan and state of the art

Written 6 September 2026 against commit 5a570e1. Read-only research; nothing in the app was changed.

## 0. Conclusions

1. **What you imagine is not what Pokémon Go did.** Pokémon Go never drew a "go here" marker in the camera. Navigation was always the 2D GPS map. The camera only ever held the catch scene and photo modes, first with the gyroscope alone and from December 2017 with ARKit or ARCore plane detection. Most players turned it off. Section 2.1.
2. **The thing you imagine is Google Maps Live View.** A dot or a path drawn on the real street needs the phone to know where it is to about a metre and where it points to a few degrees. GPS and a compass give roughly 5 to 15 m and 10 to 30 degrees. Google and Apple both solved that with a Visual Positioning System, which matches the camera image against street imagery. Section 2.2.
3. **From a static web page in Safari, VPS is not available.** Safari still has no WebXR AR in 2026, 8th Wall closed its platform in February 2026, and Google, Apple, Niantic and Snap VPS are native SDKs only. The one web VPS left, Immersal, needs you to scan each spot yourself and pay. Section 2.3.
4. **So the honest version for this app is a sensor beacon.** GPS plus compass plus gyroscope, in vanilla JS, about 300 lines, no library. A floating dot at the target's bearing with a distance, and an arrow at the edge of the screen when it is out of view. Right to about 20 degrees and 15 m. Good for "over there, 400 m", useless for "that doorway". Section 1.
5. **A yellow brick road is possible in the same tier, but it will swim.** Draw the authored route as a ground path starting at the player's feet. Every GPS wobble moves it sideways by metres. An arrow on the ground at your feet pointing along the route carries the same information and jitters far less. A road that sticks to the pavement is native app territory. Section 1.4.
6. **The game already has a better trick than any compass.** A stencil lined up on the Elizabeth Tower fixes the heading to a degree or two. From that moment the gyroscope alone can hold a dot at the true bearing of the next place. This is the game's own mechanic doing visual positioning by hand. Section 1.5.
7. **This collides with a design rule already in the code.** The compass letter is hidden inside 500 m on purpose, so the diary carries the last stretch. A camera dot is a homing beacon. Decide whether the dot is the far-range guide that hands over to the diary, or a change of rule. Section 1.2.
8. **Yes, the compass is required as well as location.** GPS says where you are. Only the magnetometer, fused with the gyroscope, says where the camera points while you stand still. GPS "heading" is course over ground and is null when stationary. Section 2.5.
9. **Pokémon Go did not stop.** Niantic sold it to Scopely in May 2025 for about 3.5 billion dollars; it made over a billion dollars in 2025 and had its best month in four years in July 2026. What stopped was almost everything else: Wizards Unite, Minecraft Earth, NBA All-World, Peridot mobile, Niantic's Lightship and 8th Wall, Microsoft's spatial anchors, Meta Spark, Adobe Aero, Wikitude, Onirix. Section 2.1 and 2.4.
10. **Nothing in 2025 or 2026 changes the plan.** The industry moved to glasses that show a heads-up arrow, not a world-locked marker, and to VPS platforms that are native only. The web option is still GPS and compass. The one useful new thing is LocAR.js, actively maintained, whose maths can be borrowed. Section 2.6 and 2.7.

Assumptions made: the target stays a static page on GitHub Pages with no library and no backend; iPhone in Safari is the phone that matters; "a place to go" means the gate point of the next stop; central London is where it is played.

Questions worth answering before any code:
- Should the dot obey the 500 m rule, or replace it?
- Is a native app off the table for good, or only for now?
- Is the marker for the next gate, or for the landmark the stencil traces?

## 1. Part 1: giving the camera window a physical location

### 1.1 Three tiers, and the price jumps between them

| Tier | What the player sees | How | Accuracy | Fits the static page |
|---|---|---|---|---|
| A. Sensor beacon | A dot at the target's bearing, a distance, an edge arrow | GPS + compass + gyro | 10 to 30 deg, 5 to 15 m | Yes, no library |
| B. Landmark-anchored | After a stencil match, a dot at the next place's true bearing | Stencil fixes heading, gyro holds it | 2 to 5 deg for a minute or so | Yes, on top of A |
| C. Visual positioning | A path on the pavement that stays put | Camera matched to street imagery | About 1 m, under 5 deg | No, native app only |

Recommendation: build A as the far-range guide and keep the stencil as the last-metres guide, add B if the field test shows the compass is as bad near Westminster's steel and buses as expected, and do not attempt C in this codebase.

### 1.2 The design decision this forces

The code hides the compass letter inside 500 m and says why: "a bearing that keeps updating as you close in would be a homing beacon, and the diary is supposed to be the thing that gets you the last five hundred metres." A camera dot is a homing beacon. Two coherent options:

1. Keep the rule. The dot replaces the eight-letter compass beyond 500 m and hands over to the diary and the stencil. This is also the range where the sensors are honest.
2. Change the rule deliberately, accepting that the last 200 m is where a GPS and compass dot is at its worst, and where it will sit on the wrong building.

The plan below assumes option 1, with the distance made a content field so a hunt can choose.

### 1.3 Steps for Tier A, in order

0. **Field test before code, half a day.** A test-mode page showing raw heading, compass accuracy, GPS accuracy and one dot for a fixed target, walked round Parliament Square and over Westminster Bridge. Log with the existing Log and Copy log. The decision "is 20 degrees acceptable" comes from that data. Check the heading as the phone passes vertical, where iOS compass readings are known to jump.
1. **Content and build.** A stop gets a beacon block: lat, lon, a from-distance and a to-distance, defaulting to the gate. For a road, a route block: a hand-authored list of waypoints. No routing service. The build script validates both.
2. **Permission on the same tap.** iOS needs DeviceOrientationEvent.requestPermission inside a user gesture, over HTTPS, like the camera. The tap that opens the lens asks for orientation first, then the camera. Expect to ask each time the page opens. If refused, fall back to the compass letter.
3. **Heading.** Listen to deviceorientation. On iOS, webkitCompassHeading is absolute but noisy and alpha is relative but smooth: combine them with a complementary filter, gyro for fast response, compass for slow drift correction, averaging sine and cosine so 359 and 1 do not average to 180. On Android use deviceorientationabsolute. webkitCompassHeading is magnetic north; London's declination is about one degree, so ignore it.
4. **Position.** Respect the one-watch-at-a-time rule: the lens takes the radio while open and hands it back on close. Exponential smoothing on lat and lon; ignore fixes worse than the existing 75 m cut-off.
5. **Projection.** Bearing and distance from the existing helpers. Screen x is the centre plus the focal length times the tangent of the bearing minus the heading; the horizon comes from pitch; roll rotates the layer. The focal length depends on the camera's field of view, which Safari does not expose. On an iPhone held in portrait with the feed cropped to the screen, the visible horizontal field is only about 35 to 40 degrees, and iOS 18 can switch lenses mid-session. So: a constant, plus a test-mode slider like the threshold slider, calibrated once by lining the dot up on the Elizabeth Tower from a known spot.
6. **Rendering.** A fourth lens kind, beacon, or a flag on any lens: an SVG layer under the touch layer, repainted by requestAnimationFrame from the latest sensor state. Not draggable: the phone places it, which is a break from the lens's stated philosophy that every pixel is placed by a thumb. The match loop is untouched.
7. **Edge arrow.** With a 35 degree window the target is off-screen most of the time. Without a left or right arrow the feature reads as broken.
8. **Degradation rules.** Hide when GPS accuracy is worse than 75 m. When webkitCompassAccuracy is negative or large, say "wave the phone in a figure of eight". Inside the to-distance, replace the dot with "You are close. Look for the drawing."
9. **Simulator.** Extend the #testing position simulator with a heading slider so the projection can be checked on a laptop webcam.
10. **Battery.** Camera plus GPS plus 60 Hz sensors is the dearest thing the page can do. Keep the beacon a look-and-close tool, as the lenses already are.

Effort: two to three days including the field test.

### 1.4 The yellow brick road, in the same tier

Same maths, in three dimensions. Each waypoint becomes east and north metres from the smoothed position, placed about 1.5 m below the camera, rotated by heading, pitch and roll, and projected as a polyline. Two things make it tolerable without VPS:

- Start the path at the player's feet, not at the GPS position: draw from under the camera to the nearest point on the route, so a 10 m wobble moves the far end, not the start.
- Prefer a single arrow on the ground at your feet pointing along the route, plus a distance. Same information, far less jitter.

Effort: two more days after Tier A. LocAR.js has a createGeoLine primitive that does exactly this; its source is a good reference even though the library itself needs a bundler and three.js.

### 1.5 Tier B: landmark-anchored bearing, the game's own trick

1. Give each stencil an anchor: the lat and lon of the landmark it traces.
2. When the match holds, record the gyro's relative yaw and the bearing from the current fix to the anchor. A landmark 100 m away lined up on screen fixes heading to about two degrees; even a 15 m position error costs under ten degrees at that range.
3. From then on place the next stop's dot at the next bearing minus the anchor bearing, plus the change in gyro yaw since the match. No magnetometer involved. Show it for a bounded time and while the player stays put; drop it after a threshold of walking.
4. The reveal writes itself: "Line up the tower. Now turn until you find the mark." The player performs the localisation, which is what the preamble in lens.js says the game is.

Effort: one to two days on top of Tier A.

### 1.6 Alternatives that need no camera

- **A radar.** A compass rose that turns with the phone, target dot at bearing and distance. Same sensors, no field-of-view problem, tolerant of heading error, works when the camera is refused. One day, and the natural first thing to build with the new sensor code. This is how Pokémon Go and Ingress actually guide players.
- **A 2D map.** Needs a tile server and a library such as Leaflet, against the no-dependency ethos, and it makes the diary redundant.
- **A sound beacon.** Web Audio clicks whose rate rises as distance falls. Audio can run on a timer after one tap, where haptics on iPhone cannot.
- **A photo from the approach.** What the pen sketch already does.

### 1.7 Tier C, if the game ever goes native

- **Google ARCore Geospatial API.** Native iOS and Android, free within quota with a Google Cloud project, Street View coverage which includes central London, about 1 m and 5 degrees where VPS is available, Terrain and Rooftop anchors, Streetscape Geometry for occlusion. Actively maintained through September 2026. The best fit.
- **Apple ARKit geo-tracking.** Native, no extra dependency, London supported since 2021, no published accuracy figure, Apple advises anchors within 50 m.
- **Niantic VPS 2.0.** Native SDK for Swift, centimetre-level only where a spot has been scanned with Scaniverse, first 10,000 calls a month free.

## 2. Part 2: the state of the art

### 2.1 How Pokémon Go worked, and what stopped

- The core loop is a 2D map driven by GPS. The camera appears only in catch encounters and photo modes. Niantic's CEO said in 2019 that most play should and does happen outside AR, and the CTO said most players run with it off.
- The 2016 AR mode used gyroscope and accelerometer only; the Pokémon floated in a fixed direction with no world tracking. AR+ arrived on iOS in December 2017 with ARKit plane detection, on Android in October 2018. Shared AR followed in 2019, occlusion in 2020, PokéStop scanning from 2020 to feed Niantic's VPS. The legacy AR mode was removed in April 2024.
- No source shows Ingress or Pokémon Go ever drawing a navigation marker in the camera view.
- Scopely bought Niantic's games for about 3.5 billion dollars, closing 29 May 2025. Pokémon Go made over a billion dollars in 2025 and hit a four-year monthly high in July 2026 around its tenth anniversary. Scanning that fed Niantic's map was reported to have ended with the sale.
- Shutdowns: Ghostbusters World 2020, Minecraft Earth June 2021 blamed on COVID, Catan World Explorers November 2021, Wizards Unite January 2022, Transformers Heavy Metal 2022, NBA All-World and Marvel World of Heroes 2023, The Walking Dead Our World 2023, Peridot mobile August 2026. Niantic's 2023 memo said new projects "have not delivered revenues commensurate with those investments" and that only "the best and most differentiated titles" survive. Still running: Dragon Quest Walk in Japan, Jurassic World Alive, Orna, Pikmin Bloom, Monster Hunter Now.
- Why the genre concentrated: it needs an IP that makes people walk, dense place data, and expensive live operations. The camera part stayed small because it is slower, drains the battery, is socially awkward and makes the game harder.

### 2.2 What draws a dot on a real street

| Approach | Position | Heading | Where it runs |
|---|---|---|---|
| GPS + compass | 5 to 15 m, worse in urban canyons | 10 to 30 deg | Any browser |
| ARKit or ARCore world tracking | Drift-free relative to start, not absolute | Relative only | Native |
| VPS: Google Geospatial, Apple geo-tracking, Niantic VPS 2.0 | About 1 m where covered | Under 5 deg | Native |

Google Maps Live View and Apple Maps AR walking directions are VPS products. Live View still exists in 2026 and is not offered as an SDK.

### 2.3 What the web can do in September 2026

- Safari on iPhone does not support WebXR immersive-ar. An Apple engineer said so in June 2024 and the thread was still open in March 2026. The WebKit flag exists and is marked testable only. Chrome on Android does support immersive-ar with hit-test, anchors and depth, but not the Geospatial API.
- 8th Wall, the one browser SLAM and web VPS, closed its platform on 28 February 2026. Its engine is now MIT open source but the SLAM is a binary download and VPS is not included.
- Immersal, under Hexagon, still sells VPS for Web at about 99 dollars a month with an MIT demo that runs in iOS Safari, but only where you have scanned with their mapper.
- Zappar, Blippar and Aryel continue; Onirix closes 1 September 2026; Adobe Aero closed November 2025.
- Open source: LocAR.js version 0.2.9, released 5 September 2026, actively maintained, GPS and compass into three.js, needs npm and a bundler. AR.js 3.4.8 from March 2026 made its location examples work on iPhone. AlvaAR, browser SLAM in WebAssembly, is GPLv3 and last touched in July 2023, no IMU. MindAR does image and face tracking only. OpenVPS from Open AR Cloud and Nokia is a self-hosted VPS built on hloc and COLMAP that needs a GPU server and days of capture per street. The WebXR geo-alignment proposal has been dormant since 2020 and Mozilla's webxr-geospatial was archived in 2024.

### 2.4 The wider retreat

Wikitude services ended September 2024. Microsoft retired Azure Spatial Anchors in November 2024 and discontinued HoloLens 2. Meta Spark closed January 2025. Niantic Spatial's Lightship 3.x is being wound down by February 2027 and its Shared AR ended May 2026. The pattern: phone-screen AR platforms are closing, and the survivors sell VPS to native apps, robots and glasses.

### 2.5 What the iPhone senses, and what a web page can reach

| Need | Sensor | Web API in Safari | Notes |
|---|---|---|---|
| Where you are | GNSS, dual-frequency since iPhone 14 Pro, plus Wi-Fi and cell | Geolocation watchPosition | Accuracy field is a 95 percent radius; heading is null when stationary; a user can grant only approximate location, kilometres off |
| Where the camera points | Magnetometer fused with gyro | deviceorientation, webkitCompassHeading | Magnetic north, per WebKit source; webkitCompassAccuracy negative means invalid; permission prompt needed each launch |
| Tilt and roll | Accelerometer and gyro | deviceorientation beta and gamma, 60 Hz | alpha is relative in Safari; deviceorientationabsolute is not supported |
| Drift-free motion | Camera plus IMU, ARKit | None | Native only |
| Depth | LiDAR on Pro models | None | Native only |
| Direction to a beacon | Ultra Wideband, iPhone 11 and later | None | Native only, needs a UWB accessory, direction only within a narrow field of view |

So the compass is required as well as GPS. Native adds true heading with declination corrected, ARKit's gravity-and-heading alignment, and Core Location's calibration prompt.

### 2.6 What is happening now

- **Glasses show a heads-up arrow, not a world-locked marker.** Meta Ray-Ban Display shipped September 2025 with a mini-map and turn cues. Google and Samsung's Android XR glasses ship audio-only this autumn with displays later; hands-on reports describe a cue in a small square. Even Realities, Alibaba and Rokid do the same. Snap Specs, announced June 2026 at 2,195 dollars and shipping this autumn in the US, UK and France, carry Niantic Spatial's VPS and a guided-navigation template, so they will be the first consumer device that can render a real "go here" marker outdoors.
- **Niantic Spatial** spun out in April 2025 with 250 million dollars, launched VPS 2.0 and its development kit in April 2026, claims a million VPS locations, and partnered with Snap in June 2025 and with defence and robotics firms since. It is an enterprise company now.
- **Google** shipped the Geospatial API for Android XR headsets in 2026 and keeps the phone API maintained, with a Maps overhaul in March 2026 that kept Live View. **Apple** shipped nothing new for outdoor iPhone AR at WWDC 2025 or 2026 and is reported to have cancelled Vision Pro successors in favour of glasses later in the decade.
- **Research** is moving fast on map-free relocalisation with MASt3R, VGGT and their descendants, all needing a GPU. Niantic's ACE runs on a phone but needs per-scene training. None is usable in a browser.

### 2.7 Does any of this change Part 1?

No. Every 2025 and 2026 development points the same way: real-world anchoring lives in native SDKs and glasses, while the browser has exactly what it had in 2019, a camera feed, a compass and GPS. The precedent is also reassuring: the most successful location game never put navigation in the camera, and the two companies that did needed street-imagery VPS to do it. A radar or dot for the far range and the stencil for the last metres is the design the evidence supports. Two practical flags for the code: iOS 18 can switch camera lenses mid-session, which changes the field of view for both the beacon and the existing stencil match; and LocAR.js is worth reading for its projection and smoothing even if it is not adopted.

## 3. Sources

Research notes: most primary pages were fetched directly; where a page was blocked by the session's proxy the fact rests on search-engine excerpts and is stated as reported.

- Pokémon Go AR+ launch: https://techcrunch.com/2017/12/20/pokemon-go-gets-a-new-and-improved-augmented-reality-mode-but-only-on-ios/
- Niantic on AR use: https://arinsider.co/2019/04/10/the-age-old-question-is-pokemon-go-ar/
- Scopely acquisition: https://variety.com/2025/gaming/news/scopely-pokemon-go-niantic-sale-3-billion-1236334814/
- Niantic 2023 memo: https://nianticlabs.com/news/organizational-update
- Pokémon Go July 2026 revenue: https://www.pocketgamer.biz/pokmon-go-revenue-rockets-to-a-four-year-high-of-1415m-during-anniversary-month/
- Niantic Spatial VPS 2.0: https://www.geekwire.com/2026/from-pokemon-go-to-physical-ai-niantic-spatial-unveils-its-global-3d-mapping-platform/
- Niantic Spatial and Snap: https://www.nianticspatial.com/blog/vps-snap-investment
- 8th Wall engine and wind-down: https://github.com/8thwall/8thwall and https://8thwall.org/docs/migration/faq
- ARCore Geospatial API: https://developers.google.com/ar/develop/geospatial and https://github.com/google-ar/arcore-ios-sdk
- Apple geo-tracking: https://developer.apple.com/documentation/arkit/argeotrackingconfiguration and https://developer.apple.com/videos/play/wwdc2021/10073/
- WebXR on iOS, Apple engineer: https://developer.apple.com/forums/thread/756850
- WebKit compass source: https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/ios/WebCoreMotionManager.mm
- Compass headings across browsers: https://github.com/w3c/deviceorientation/issues/137
- LocAR.js: https://github.com/AR-js-org/locar.js and examples at https://ar-js-org.github.io/locar.js
- AR.js releases: https://github.com/AR-js-org/AR.js/releases
- AlvaAR: https://github.com/alanross/AlvaAR
- OpenVPS: https://github.com/OpenArCloud/openvps
- Immersal VPS for Web: https://github.com/immersal/vps-for-web
- Snap Specs developer tools: https://newsroom.snap.com/snap-launches-new-tools-for-specs-developers
- Meta Ray-Ban Display navigation: https://www.meta.com/blog/ces-2026-meta-ray-ban-display-teleprompter-emg-handwriting-garmin-unified-cabin-university-of-utah-tetraski/
- Android XR glasses: https://techcrunch.com/2026/05/22/we-tried-googles-ai-glasses-and-theyre-almost-there/
- ARCore for Jetpack XR release notes: https://developer.android.com/jetpack/androidx/releases/xr-arcore
- Onirix closure: https://www.onirix.com/onirix-closure/
- Peridot sunset: https://massivelyop.com/2026/04/27/niantic-is-already-sunsetting-its-2023-mobile-mmoarg-peridot/
