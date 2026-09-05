/* The lens: the phone's camera with a picture laid over the live view, which
   the player lines up against something real by hand.

   No dependencies, no library, and no computer vision that does anything for
   the player. Nothing here detects anything, nothing snaps to anything and
   nothing is measured for you. The overlay is a shape on top of a video, and
   every last pixel of where it sits was put there by somebody's thumb. That is
   the game: the phone holds the picture still and the player does the looking.

   The one thing the code does look at is how well the shape under a stencil
   agrees with it, as a number the player can watch while they line it up. It
   checks the alignment; it never makes it.

   window.Lens.open(lens, diary_mm, opts) where lens is the stop's lens object,
   diary_mm is the physical size of the paper diary, used by the scale bar, and
   opts carries what a match lens needs from the player:
     stopId       for the log
     getAccuracy  () => the last GPS accuracy in metres, or null
     logLine      (fields) => void, appends one calibration sample
     onProgress   () => void, called inside the Progress tap after the close */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const MATCH_EVERY_MS = 250;
  const MATCH_ALPHA = 0.3;          // exponential smoothing of the score
  const MATCH_SHIFTS = [-4, 0, 4];  // working-resolution pixels
  const MATCH_SCALES = [0.96, 1, 1.04];
  const WORK_PX = 320;              // longest side of the working frame
  const WORK_PX_SLOW = 240;         // and where it drops to if a phone cannot keep up
  const SLOW_MS = 10;

  let root = null;        // the full-screen container, built once and reused
  let stream = null;      // the live camera tracks, so they can all be stopped
  let cfg = null;         // { lens, diary, opts }
  let view = null;        // { x, y, scale, rot } placement of the whole overlay
  let cord = null;        // { a: {x,y}, b: {x,y} } the two cord ends, in pixels
  let mmPerPx = null;     // set by Calibrate with the diary, cleared by Reset
  const pointers = new Map();
  let pinch = null;
  let match = null;       // the live match state while a match lens is open

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function haptic() { if (typeof window.haptic === "function") window.haptic(); }

  /* ---- styles, injected once so the player stays one file of markup ---- */
  function injectStyle() {
    if (document.getElementById("lensstyle")) return;
    const s = el("style");
    s.id = "lensstyle";
    s.textContent = `
    #lens { position: fixed; inset: 0; z-index: 40; background: #000;
            display: none; touch-action: none; overscroll-behavior: none;
            color: #fff; font-family: system-ui, -apple-system, sans-serif; }
    #lens.on { display: block; }
    #lensfeed, #lensshot { position: absolute; inset: 0; width: 100%; height: 100%;
                           object-fit: cover; background: #000; }
    #lensstage { position: absolute; inset: 0; overflow: hidden; }
    #lensover { position: absolute; left: 0; top: 0; transform-origin: 50% 50%;
                will-change: transform; }
    #lensover img, #lensover svg { display: block; pointer-events: none; }
    #lenshit { position: absolute; inset: 0; }
    #lensbars { position: absolute; left: 0; right: 0; bottom: 0;
                padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
                background: linear-gradient(to top, rgba(0,0,0,.78), rgba(0,0,0,0));
                display: flex; flex-direction: column; gap: 9px; }
    #lenstop { position: absolute; left: 0; right: 0; top: 0;
               padding: calc(8px + env(safe-area-inset-top)) 12px 8px;
               background: linear-gradient(to bottom, rgba(0,0,0,.62), rgba(0,0,0,0));
               display: flex; align-items: center; gap: 10px; }
    #lensnote { font-size: .78rem; line-height: 1.35; flex: 1; white-space: pre-line;
                text-shadow: 0 1px 3px rgba(0,0,0,.8); }
    .lensx { border: none; background: rgba(255,255,255,.16); color: #fff;
             width: 44px; height: 44px; border-radius: 999px; font-size: 1.2rem;
             cursor: pointer; flex: none; }
    .lensrowb { display: flex; gap: 8px; align-items: center; }
    .lensb { flex: 1; border: 1px solid rgba(255,255,255,.35);
             background: rgba(0,0,0,.42); color: #fff; font-size: .82rem;
             font-weight: 600; padding: 12px 8px; border-radius: 999px;
             cursor: pointer; min-height: 46px; }
    .lensb.on { background: #fff; color: #000; }
    .lensb:disabled { opacity: .4; }
    #lensop { flex: 1; accent-color: #fff; height: 34px; }
    .lensoplab { font-size: .7rem; letter-spacing: .08em; text-transform: uppercase;
                 opacity: .8; }
    #lensscale { font-size: .72rem; opacity: .9; min-height: 1.2em;
                 text-shadow: 0 1px 3px rgba(0,0,0,.8); }
    #lenscal { position: absolute; inset: 0; display: none; }
    #lenscal.on { display: block; }
    .caldot { position: absolute; width: 22px; height: 22px; margin: -11px 0 0 -11px;
              border-radius: 50%; border: 2px solid #fff; background: rgba(255,255,255,.3); }
    #lenscalmsg { position: absolute; left: 12px; right: 12px; top: 42%;
                  text-align: center; font-size: .95rem; line-height: 1.45;
                  text-shadow: 0 1px 4px rgba(0,0,0,.9); }
    .cordend { fill: #fff; stroke: #000; stroke-width: 2; }
    .cordline { stroke: #fff; stroke-width: 3; }
    .cordknot { fill: #fff; stroke: #000; stroke-width: 1.5; }

    /* The match panel. Not a testing feature: it is on for every lens with a
       match, because calibrating in the field is the point. */
    #lensmatch { display: flex; flex-direction: column; gap: 7px;
                 padding: 8px 10px; border-radius: 12px; background: rgba(0,0,0,.5); }
    #matchbar { position: relative; height: 10px; border-radius: 999px;
                background: rgba(255,255,255,.18); overflow: hidden; }
    #matchfill { height: 100%; width: 0; border-radius: 999px; background: #fff;
                 transition: width .2s linear; }
    #matchfill.over { background: #3FBF7F; }
    #matchtick { position: absolute; top: -2px; bottom: -2px; width: 2px;
                 background: #FFD166; }
    #matchnums { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                 font-size: .72rem; opacity: .92; font-variant-numeric: tabular-nums; }
    #matchgo { flex: 2; background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.25); }
    #matchgo:disabled { opacity: .45; }
    #matchgo.lit { background: #fff; color: #000; opacity: 1; }
    #matchgo.matched { background: #3FBF7F; color: #04140B; border-color: #3FBF7F; }
    #matchlog { flex: 1; }
    #matchtried { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                  font-size: .74rem; min-width: 3.2em; text-align: right;
                  opacity: .85; font-variant-numeric: tabular-nums; }
    `;
    document.head.appendChild(s);
  }

  /* ---- the shell ---- */
  function build() {
    injectStyle();
    root = el("div");
    root.id = "lens";
    root.innerHTML = `
      <video id="lensfeed" autoplay playsinline muted></video>
      <img id="lensshot" hidden alt="">
      <div id="lensstage"><div id="lensover"></div></div>
      <div id="lenshit"></div>
      <div id="lenscal"><div id="lenscalmsg"></div></div>
      <div id="lenstop">
        <div id="lensnote"></div>
        <button class="lensx" id="lensclose" aria-label="Close the lens">✕</button>
      </div>
      <div id="lensbars">
        <div id="lensmatch" hidden>
          <div id="matchbar"><div id="matchfill"></div><div id="matchtick"></div></div>
          <div id="matchnums">score 0.00 · on 0.00 · off 0.00</div>
          <div class="lensrowb">
            <button class="lensb" id="matchlog">Log</button>
            <button class="lensb" id="matchskip" hidden>Skip</button>
            <button class="lensb" id="matchgo" disabled>Progress</button>
            <span id="matchtried"></span>
          </div>
        </div>
        <div id="lensscale"></div>
        <div class="lensrowb">
          <span class="lensoplab">Fade</span>
          <input type="range" id="lensop" min="30" max="100" value="100"
                 aria-label="Overlay opacity">
        </div>
        <div class="lensrowb" id="lensactions"></div>
      </div>
      <input type="file" id="lenspick" accept="image/*" capture="environment" hidden>`;
    document.body.appendChild(root);

    root.querySelector("#lensclose").onclick = close;
    root.querySelector("#lensop").oninput = (ev) => {
      root.querySelector("#lensover").style.opacity = ev.target.value / 100;
    };
    root.querySelector("#lenspick").onchange = (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      const shot = root.querySelector("#lensshot");
      shot.src = URL.createObjectURL(f);
      shot.hidden = false;
      root.querySelector("#lensfeed").hidden = true;
      note("Working from the photo you chose. Everything else is the same.");
    };
    root.querySelector("#matchlog").onclick = logSample;
    // The tick has to happen inside the tap, before anything else. Closing
    // and continuing come after it in the same handler, never after an await.
    root.querySelector("#matchgo").onclick = () => {
      haptic();
      const done = cfg.opts.onProgress;
      close();
      if (done) done();
    };
    // Skipping is not a success, so it does not tick.
    root.querySelector("#matchskip").onclick = () => {
      const done = cfg.opts.onSkip;
      close();
      if (done) done();
    };
    attachGestures();
  }

  function note(text) { root.querySelector("#lensnote").textContent = text; }

  /* ---- opening and closing ---- */
  async function open(lens, diary, opts) {
    if (!root) build();
    cfg = { lens, diary: diary || { w: 148, h: 210 }, opts: opts || {} };
    mmPerPx = null;
    root.classList.add("on");
    root.querySelector("#lensop").value = 100;
    root.querySelector("#lensshot").hidden = true;
    root.querySelector("#lensfeed").hidden = false;
    note(lens.note || "Line it up against the real thing.");
    buildOverlay();
    buildActions();
    paintScale();
    startMatch();
    await startCamera();
  }

  let generation = 0;     // which opening of the lens a camera request belongs to
  function stopStream() {
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
  }

  async function startCamera() {
    const video = root.querySelector("#lensfeed");
    // A secure context is required, and file:// is not one. Say which of the
    // two reasons it failed, because "camera unavailable" while standing in a
    // park with a working camera is the least useful sentence on the phone.
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fallback(window.isSecureContext
        ? "This browser will not hand over the camera."
        : "The camera needs a secure page. Open this over https, not from a file.");
      return;
    }
    stopStream();
    const mine = generation;
    try {
      const got = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false });
      // The permission prompt can outlive the lens: tap Continue, tap the
      // cross before answering, and the camera arrives for a view that is
      // gone. A stream nobody is looking at is stopped on arrival.
      if (mine !== generation || !root.classList.contains("on")) {
        for (const t of got.getTracks()) t.stop();
        return;
      }
      stream = got;
      video.srcObject = stream;
      video.hidden = false;
      root.querySelector("#lensshot").hidden = true;
      clearFallback();
    } catch (err) {
      if (mine !== generation || !root.classList.contains("on")) return;
      fallback(err && err.name === "NotAllowedError"
        ? "The camera was refused. You can use a photo instead."
        : "No camera here. You can use a photo instead.");
    }
  }
  // Refusing the camera must not end the lens. The same overlay over a still
  // photo is the same tool, one frame at a time, and it is the only thing that
  // works on a laptop or behind a locked-down browser. A lens that opened by
  // itself may also have asked outside a tap, which some browsers refuse, so
  // there is a button to ask again from inside one.
  function fallback(why) {
    // The stop's instruction stays; the reason the camera is missing goes
    // under it. Losing the instruction to the excuse helped nobody.
    note((cfg.lens.note ? cfg.lens.note + "\n" : "") + why);
    clearFallback();
    const row = root.querySelector("#lensactions");
    const again = el("button", "lensb fallbackb", "Try the camera");
    again.onclick = () => startCamera();
    const pick = el("button", "lensb fallbackb", "Choose a photo");
    pick.onclick = () => root.querySelector("#lenspick").click();
    row.prepend(pick);
    row.prepend(again);
  }
  function clearFallback() {
    for (const b of root.querySelectorAll(".fallbackb")) b.remove();
  }

  function close() {
    stopMatch();
    generation += 1;
    stopStream();
    const video = root.querySelector("#lensfeed");
    video.srcObject = null;
    const shot = root.querySelector("#lensshot");
    if (shot.src.startsWith("blob:")) URL.revokeObjectURL(shot.src);
    shot.removeAttribute("src");
    pointers.clear(); pinch = null;
    root.classList.remove("on");
    root.querySelector("#lenscal").classList.remove("on");
  }

  /* ---- the overlay ---- */
  function shortEdge() { return Math.min(window.innerWidth, window.innerHeight); }

  function buildOverlay() {
    const over = root.querySelector("#lensover");
    over.innerHTML = "";
    over.style.opacity = 1;
    over.style.marginLeft = "0px";
    over.style.marginTop = "0px";
    const size = shortEdge() * 0.6;
    view = { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1, rot: 0 };

    if (cfg.lens.kind === "stencil") {
      const img = el("img");
      img.src = cfg.lens.src;
      img.alt = "";
      img.style.width = size + "px";
      over.appendChild(img);
      img.onload = () => { centreOn(over); };
      if (img.complete && img.naturalWidth) centreOn(over);
    } else if (cfg.lens.kind === "arrow") {
      over.appendChild(arrowSvg(size));
      centreOn(over);
    } else if (cfg.lens.kind === "cord") {
      const half = size / 2;
      cord = { a: { x: view.x - half, y: view.y }, b: { x: view.x + half, y: view.y } };
      // The cord draws in page coordinates from its own two ends, so it is not
      // dragged or scaled as a whole the way a stencil is. Its transform stays
      // the identity and the ends carry all the placement.
      view = { x: 0, y: 0, scale: 1, rot: 0 };
      over.appendChild(cordSvg());
      applyView();
      return;
    }
    applyView();
  }

  function centreOn(over) {
    const r = over.getBoundingClientRect();
    over.style.marginLeft = (-r.width / 2) + "px";
    over.style.marginTop = (-r.height / 2) + "px";
    applyView();
  }

  function arrowSvg(size) {
    const w = size * 0.34, h = size;
    const s = svgEl("svg", { width: w, height: h, viewBox: "0 0 34 100" });
    s.appendChild(svgEl("path", {
      d: "M17 2 L31 34 L22 34 L22 96 L12 96 L12 34 L3 34 Z",
      fill: "rgba(255,255,255,.82)", stroke: "#000", "stroke-width": 2,
      "stroke-linejoin": "round" }));
    return s;
  }

  // Two draggable ends with knots strung between them at their marks_mm
  // proportions. Stretching an end moves every knot with it and keeps the
  // spacing, which is all that is needed to compare proportions on one flat
  // surface. Nothing here knows how big anything really is until the diary
  // says so.
  function cordSvg() {
    const s = svgEl("svg", { id: "cordsvg", width: window.innerWidth,
                             height: window.innerHeight });
    s.style.position = "absolute";
    s.style.left = "0"; s.style.top = "0";
    s.appendChild(svgEl("line", { class: "cordline", id: "cline" }));
    const marks = cfg.lens.marks_mm;
    const span = marks[marks.length - 1] || 1;
    for (let k = 0; k < marks.length; k++) {
      const c = svgEl("circle", { class: "cordknot", r: 6 });
      c.dataset.t = span ? marks[k] / span : 0;
      s.appendChild(c);
    }
    s.appendChild(svgEl("circle", { class: "cordend", id: "cenda", r: 13 }));
    s.appendChild(svgEl("circle", { class: "cordend", id: "cendb", r: 13 }));
    return s;
  }

  function paintCord() {
    const s = root.querySelector("#cordsvg");
    if (!s) return;
    s.setAttribute("width", window.innerWidth);
    s.setAttribute("height", window.innerHeight);
    const { a, b } = cord;
    const line = s.querySelector("#cline");
    line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
    line.setAttribute("x2", b.x); line.setAttribute("y2", b.y);
    for (const k of s.querySelectorAll(".cordknot")) {
      const t = parseFloat(k.dataset.t);
      k.setAttribute("cx", a.x + (b.x - a.x) * t);
      k.setAttribute("cy", a.y + (b.y - a.y) * t);
    }
    s.querySelector("#cenda").setAttribute("cx", a.x);
    s.querySelector("#cenda").setAttribute("cy", a.y);
    s.querySelector("#cendb").setAttribute("cx", b.x);
    s.querySelector("#cendb").setAttribute("cy", b.y);
  }

  function applyView() {
    const over = root.querySelector("#lensover");
    if (cfg.lens.kind === "cord") { paintCord(); return; }
    over.style.transform = `translate(${view.x}px, ${view.y}px) `
                         + `rotate(${view.rot}deg) scale(${view.scale})`;
  }

  /* ---- gestures. One finger drags, two fingers pinch to scale and rotate. ---- */
  function attachGestures() {
    const hit = root.querySelector("#lenshit");
    let dragEnd = null;         // which cord end a single finger grabbed

    hit.addEventListener("pointerdown", (ev) => {
      hit.setPointerCapture(ev.pointerId);
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        pinch = { d: dist(p, q), ang: ang(p, q), scale: view.scale, rot: view.rot,
                  cord: cord ? { a: { ...cord.a }, b: { ...cord.b } } : null };
      } else if (cfg && cfg.lens.kind === "cord") {
        dragEnd = nearestEnd(ev.clientX, ev.clientY);
      }
    });

    hit.addEventListener("pointermove", (ev) => {
      const prev = pointers.get(ev.pointerId);
      if (!prev) return;
      const now = { x: ev.clientX, y: ev.clientY };
      pointers.set(ev.pointerId, now);

      if (pointers.size >= 2 && pinch) {
        const [p, q] = [...pointers.values()];
        const k = dist(p, q) / (pinch.d || 1);
        const turn = ang(p, q) - pinch.ang;
        if (cfg.lens.kind === "cord") {
          scaleCord(pinch.cord, k, turn);
        } else {
          view.scale = Math.max(0.15, Math.min(8, pinch.scale * k));
          view.rot = pinch.rot + turn;
        }
        applyView();
        return;
      }
      const dx = now.x - prev.x, dy = now.y - prev.y;
      if (cfg.lens.kind === "cord") {
        if (dragEnd) { moveEnd(dragEnd, dx, dy); }
        else { cord.a.x += dx; cord.a.y += dy; cord.b.x += dx; cord.b.y += dy; }
      } else {
        view.x += dx; view.y += dy;
      }
      applyView();
    });

    const up = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) dragEnd = null;
    };
    hit.addEventListener("pointerup", up);
    hit.addEventListener("pointercancel", up);
    window.addEventListener("resize", () => { if (root.classList.contains("on")) applyView(); });
  }

  function dist(p, q) { return Math.hypot(q.x - p.x, q.y - p.y); }
  function ang(p, q) { return Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI; }

  function nearestEnd(x, y) {
    const da = Math.hypot(cord.a.x - x, cord.a.y - y);
    const db = Math.hypot(cord.b.x - x, cord.b.y - y);
    const near = da < db ? "a" : "b";
    return Math.min(da, db) <= 44 ? near : null;
  }
  // Once the diary has said how big a millimetre is, the cord stops being a
  // free rubber band: it is exactly as long as its last mark, and dragging an
  // end swings it rather than stretching it.
  function moveEnd(which, dx, dy) {
    const other = which === "a" ? cord.b : cord.a;
    const p = cord[which];
    p.x += dx; p.y += dy;
    if (mmPerPx) {
      const wantPx = lastMark() / mmPerPx;
      const d = Math.hypot(p.x - other.x, p.y - other.y) || 1;
      p.x = other.x + (p.x - other.x) * wantPx / d;
      p.y = other.y + (p.y - other.y) * wantPx / d;
    }
  }
  function scaleCord(base, k, turn) {
    if (!base) return;
    if (mmPerPx) return;                      // calibrated: the length is real
    const cx = (base.a.x + base.b.x) / 2, cy = (base.a.y + base.b.y) / 2;
    const r = turn * Math.PI / 180, cos = Math.cos(r), sin = Math.sin(r);
    const put = (src, dst) => {
      const x = (src.x - cx) * k, y = (src.y - cy) * k;
      dst.x = cx + x * cos - y * sin;
      dst.y = cy + x * sin + y * cos;
    };
    put(base.a, cord.a); put(base.b, cord.b);
  }
  function lastMark() {
    const m = cfg.lens.marks_mm;
    return m[m.length - 1] || 1;
  }

  /* ---- the buttons under the view ---- */
  function buildActions() {
    const row = root.querySelector("#lensactions");
    row.innerHTML = "";
    if (cfg.lens.kind === "cord") {
      const cal = el("button", "lensb", "Calibrate with the diary");
      cal.onclick = startCalibrate;
      row.appendChild(cal);
    }
    const reset = el("button", "lensb", "Reset");
    reset.onclick = () => {
      mmPerPx = null;
      root.querySelector("#lensop").value = 100;
      buildOverlay();
      paintScale();
    };
    row.appendChild(reset);
    const cap = el("button", "lensb", "Capture");
    cap.onclick = capture;
    row.appendChild(cap);
  }

  /* ---- the scale bar ----
     The diary is a known size, so two taps on its long edge give pixels per
     millimetre at that plane and that distance and nowhere else. Move the phone
     and it is wrong, which is why the label says so and why Reset throws it
     away rather than quietly keeping a stale number. */
  function paintScale() {
    const box = root.querySelector("#lensscale");
    if (cfg.lens.kind !== "cord") { box.textContent = ""; return; }
    box.textContent = mmPerPx
      ? `calibrated · move the phone and calibrate again`
      : `not calibrated · the cord stretches freely`;
  }

  function startCalibrate() {
    const layer = root.querySelector("#lenscal");
    const msg = root.querySelector("#lenscalmsg");
    layer.innerHTML = "";
    layer.appendChild(msg);
    layer.classList.add("on");
    const h = cfg.diary.h;
    msg.textContent = `Hold the diary flat against the surface. Tap one end of `
                    + `its long edge, then the other. The edge is ${h} mm.`;
    const taps = [];
    const onTap = (ev) => {
      const x = ev.clientX, y = ev.clientY;
      taps.push({ x, y });
      const dot = el("div", "caldot");
      dot.style.left = x + "px"; dot.style.top = y + "px";
      layer.appendChild(dot);
      if (taps.length < 2) { msg.textContent = "Now the other end."; return; }
      layer.removeEventListener("pointerdown", onTap);
      const px = Math.hypot(taps[1].x - taps[0].x, taps[1].y - taps[0].y);
      if (px < 24) {
        msg.textContent = "Those two taps were on top of each other. Try again.";
        setTimeout(() => { layer.classList.remove("on"); }, 1600);
        return;
      }
      mmPerPx = h / px;
      // Snap the cord to its real length straight away, so the calibration is
      // something the player can see happen rather than take on trust.
      const want = lastMark() / mmPerPx;
      const d = Math.hypot(cord.b.x - cord.a.x, cord.b.y - cord.a.y) || 1;
      cord.b.x = cord.a.x + (cord.b.x - cord.a.x) * want / d;
      cord.b.y = cord.a.y + (cord.b.y - cord.a.y) * want / d;
      applyView();
      paintScale();
      layer.classList.remove("on");
    };
    layer.addEventListener("pointerdown", onTap);
  }

  /* ---- the match ----
     How well the shape under the stencil agrees with it, as a number, several
     times a second. Edges in the frame are compared under the stencil's lines
     against a ring just beside them: if the edges are no more likely under the
     stencil than next to it, the score is zero; if every edge nearby is under
     it, one. A small search around the player's placement forgives an
     imperfect hand. The number is smoothed, shown, logged and tested, and it
     never moves the stencil: alignment stays the player's job. */
  function startMatch() {
    stopMatch();
    const m = cfg.lens.kind === "stencil" ? cfg.lens.match : null;
    const panel = root.querySelector("#lensmatch");
    if (!m) { panel.hidden = true; return; }
    panel.hidden = false;
    match = {
      m, opened: performance.now(), smooth: null, on: 0, off: 0, best: 0,
      above: null, matched: false, workPx: WORK_PX, slow: [],
      frame: document.createElement("canvas"), stencil: document.createElement("canvas"),
      masks: null, maskKey: "",
      timer: null,
    };
    root.querySelector("#matchtick").style.left = (m.threshold * 100) + "%";
    root.querySelector("#matchskip").hidden = !cfg.opts.skips;
    paintMatch();
    match.timer = setInterval(matchTick, MATCH_EVERY_MS);
  }
  function stopMatch() {
    if (match && match.timer) clearInterval(match.timer);
    match = null;
  }

  // The size of the working frame follows the screen's aspect, because the
  // overlay is placed in screen pixels over a feed that is cropped to the
  // screen. Scoring against the raw camera frame would put the stencil
  // somewhere else in the picture than where the player sees it.
  function workSize() {
    const W = window.innerWidth, H = window.innerHeight;
    const k = match.workPx / Math.max(W, H);
    return { w: Math.max(8, Math.round(W * k)), h: Math.max(8, Math.round(H * k)), k };
  }

  function currentSource() {
    const video = root.querySelector("#lensfeed");
    const shot = root.querySelector("#lensshot");
    if (!video.hidden && video.videoWidth > 0) {
      return { src: video, w: video.videoWidth, h: video.videoHeight };
    }
    if (!shot.hidden && shot.naturalWidth > 0) {
      return { src: shot, w: shot.naturalWidth, h: shot.naturalHeight };
    }
    return null;
  }

  function matchTick() {
    if (!match) return;
    const t0 = performance.now();
    const img = root.querySelector("#lensover img");
    const src = currentSource();
    if (!img || !img.naturalWidth || !src) { paintMatch(); return; }

    const { w, h, k } = workSize();
    const E = edgeMap(src, w, h);
    const masks = stencilMasks(img, w, h, k);

    let best = { score: 0, on: 0, off: 0 };
    for (const mk of masks) {
      for (const dy of MATCH_SHIFTS) for (const dx of MATCH_SHIFTS) {
        const on = meanAt(E, mk.M, w, h, dx, dy);
        const off = meanAt(E, mk.R, w, h, dx, dy);
        const score = Math.max(0, (on - off) / (on + off + 0.001));
        if (score > best.score) best = { score, on, off };
      }
    }
    match.best = best.score;
    match.on = best.on; match.off = best.off;
    match.smooth = match.smooth == null ? best.score
                 : MATCH_ALPHA * best.score + (1 - MATCH_ALPHA) * match.smooth;

    // Matched is a state, not an event. Fall below the line and it is gone.
    const now = performance.now();
    if (match.smooth >= match.m.threshold) {
      if (match.above == null) match.above = now;
      match.matched = now - match.above >= match.m.hold_ms;
    } else {
      match.above = null;
      match.matched = false;
    }

    // Keep each evaluation cheap. A phone that cannot manage it at 320 px
    // drops to 240 px and stays there for the rest of the lens. Only the
    // steady ticks count: the one after a drag or a pinch also rebuilds the
    // masks, and that cost is the thumb's, not the frame's.
    const took = now - t0;
    match.ms = took;
    // The median of the last eight, not the mean of the last four: one
    // garbage-collection pause or a slow first readback from the camera is a
    // hiccup, and a hiccup should not demote the lens for the rest of the stop.
    if (!match.rebuilt) {
      match.slow.push(took);
      if (match.slow.length > 8) match.slow.shift();
      if (match.workPx === WORK_PX && match.slow.length === 8) {
        const sorted = [...match.slow].sort((a, b) => a - b);
        if ((sorted[3] + sorted[4]) / 2 > SLOW_MS) {
          match.workPx = WORK_PX_SLOW;
          match.maskKey = "";
        }
      }
    }
    paintMatch();
  }

  // Grayscale, a 3×3 box blur, a 3×3 Sobel, and the magnitude scaled so that
  // the frame's 99th percentile is one. That last step is what stops the score
  // swinging with the light: a dim wall and a bright one give the same map.
  function edgeMap(src, w, h) {
    const c = match.frame;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // object-fit: cover, by hand, so the working frame is the screen's crop.
    const kk = Math.max(window.innerWidth / src.w, window.innerHeight / src.h);
    const cw = window.innerWidth / kk, ch = window.innerHeight / kk;
    ctx.drawImage(src.src, (src.w - cw) / 2, (src.h - ch) / 2, cw, ch, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    const g = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      g[i] = 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
    }
    const b = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        b[i] = (g[i - w - 1] + g[i - w] + g[i - w + 1]
              + g[i - 1] + g[i] + g[i + 1]
              + g[i + w - 1] + g[i + w] + g[i + w + 1]) / 9;
      }
    }
    const mag = new Float32Array(n);
    const hist = new Uint32Array(256);
    const MAXMAG = 1443;                      // sqrt(2) × 4 × 255, the Sobel ceiling
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const gx = -b[i - w - 1] + b[i - w + 1] - 2 * b[i - 1] + 2 * b[i + 1]
                   - b[i + w - 1] + b[i + w + 1];
        const gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1]
                   + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
        const mg = Math.sqrt(gx * gx + gy * gy);
        mag[i] = mg;
        hist[Math.min(255, (mg * 255 / MAXMAG) | 0)]++;
      }
    }
    // The histogram holds the interior only: the one-pixel border has no
    // gradient. Counting to 99% of the whole frame instead would never get
    // there on a small frame, and the loop would run off the end and hand
    // back the Sobel ceiling as the "percentile".
    const want = (w - 2) * (h - 2) * 0.99;
    let seen = 0, bin = 0;
    for (; bin < 255; bin++) { seen += hist[bin]; if (seen >= want) break; }
    const p99 = Math.max(1e-6, (bin + 1) * MAXMAG / 255);
    for (let i = 0; i < n; i++) mag[i] = Math.min(1, mag[i] / p99);
    return mag;
  }

  // The stencil's alpha under the player's placement, at three scales, each
  // thresholded, thickened by two pixels into the mask M, then thickened by
  // six more and hollowed out into the ring R. Cached against the placement:
  // while the phone and the thumb hold still, only the frame is recomputed.
  //
  // The threshold and the first thickening happen at the stencil's own
  // resolution, not the working frame's. A 3 px line on a 600 px stencil is
  // under half a pixel once the stencil is 90 px wide, and thresholding that
  // after the shrink leaves nothing: the line's alpha never reaches 128. So
  // the PNG's own pixels are thresholded, where it is exact, thickened by the
  // native equivalent of two working pixels, and only then drawn small.
  function stencilMasks(img, w, h, k) {
    const key = [w, h, view.x, view.y, view.scale, view.rot, img.width].join(",");
    match.rebuilt = !(match.masks && match.maskKey === key);
    if (!match.rebuilt) return match.masks;
    const c = match.stencil;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // Layout size, not the bounding box: once the stencil is turned, the box
    // is the box around the turned shape and is wider than the shape itself.
    const elW = img.offsetWidth;
    const elH = img.offsetHeight || elW * img.naturalHeight / img.naturalWidth;
    const out = [];
    for (const sc of MATCH_SCALES) {
      const perNative = elW * view.scale * sc * k / img.naturalWidth;   // working px per stencil px
      // Not laid out yet: no size, no mask, and nothing to score this tick.
      if (!(perNative > 0)) { match.maskKey = ""; return []; }
      // Capped: a stencil pinched down to a speck would ask for a thickening
      // wider than the stencil, at a cost that grows with it, for a placement
      // that cannot be scored anyway.
      const thick = nativeMask(img, Math.min(64, Math.max(1, Math.ceil(2 / perNative))));
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(view.x * k, view.y * k);
      ctx.rotate(view.rot * Math.PI / 180);
      ctx.scale(view.scale * sc * k, view.scale * sc * k);
      ctx.drawImage(thick, -elW / 2, -elH / 2, elW, elH);
      ctx.restore();
      const a = ctx.getImageData(0, 0, w, h).data;
      const n = w * h;
      const M = new Uint8Array(n);
      for (let i = 0, j = 3; i < n; i++, j += 4) M[i] = a[j] >= 128 ? 1 : 0;
      const D = dilate(M, w, h, 6);
      const Mi = [], Ri = [];
      for (let i = 0; i < n; i++) {
        if (M[i]) Mi.push(i);
        else if (D[i]) Ri.push(i);
      }
      out.push({ M: Int32Array.from(Mi), R: Int32Array.from(Ri) });
    }
    match.masks = out;
    match.maskKey = key;
    return out;
  }

  // The stencil's alpha at its own size, thresholded at 128 and thickened by
  // r pixels, as an opaque white shape on nothing that drawImage can shrink.
  // Cached by radius: a drag does not change it, only a pinch does.
  function nativeMask(img, r) {
    if (!match.native) match.native = new Map();
    const key = img.src + "|" + r;
    if (match.native.has(key)) return match.native.get(key);
    const nw = img.naturalWidth, nh = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = nw; c.height = nh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const a = ctx.getImageData(0, 0, nw, nh).data;
    const n = nw * nh;
    const bin = new Uint8Array(n);
    for (let i = 0, j = 3; i < n; i++, j += 4) bin[i] = a[j] >= 128 ? 1 : 0;
    const thick = dilate(bin, nw, nh, r);
    const out = ctx.createImageData(nw, nh);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      if (thick[i]) { out.data[j] = out.data[j + 1] = out.data[j + 2] = out.data[j + 3] = 255; }
    }
    ctx.putImageData(out, 0, 0);
    match.native.set(key, c);
    return c;
  }

  // A square dilation as two one-dimensional passes, stamping runs out from
  // each set pixel. Cheap because a stencil is thin lines on nothing.
  function dilate(src, w, h, r) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!src[row + x]) continue;
        tmp.fill(1, row + Math.max(0, x - r), row + Math.min(w - 1, x + r) + 1);
      }
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (!tmp[row + x]) continue;
        const a = Math.max(0, y - r), b = Math.min(h - 1, y + r);
        for (let yy = a; yy <= b; yy++) out[yy * w + x] = 1;
      }
    }
    return out;
  }

  // Mean of E over a set of pixel indices, with the set shifted by (dx, dy).
  // Shifting the sample instead of redrawing the stencil is what makes the
  // twenty-seven evaluations affordable.
  function meanAt(E, idx, w, h, dx, dy) {
    let sum = 0, cnt = 0;
    const n = w * h, off = dy * w + dx;
    for (let t = 0; t < idx.length; t++) {
      const i = idx[t];
      const x = i % w + dx;
      if (x < 0 || x >= w) continue;
      const j = i + off;
      if (j < 0 || j >= n) continue;
      sum += E[j]; cnt++;
    }
    return cnt ? sum / cnt : 0;
  }

  function paintMatch() {
    if (!match) return;
    const m = match.m;
    const s = match.smooth == null ? 0 : match.smooth;
    const fill = root.querySelector("#matchfill");
    fill.style.width = (s * 100) + "%";
    fill.classList.toggle("over", s >= m.threshold);
    root.querySelector("#matchnums").textContent =
      `score ${s.toFixed(2)} · on ${match.on.toFixed(2)} · off ${match.off.toFixed(2)}`;

    const tried = (performance.now() - match.opened) / 1000;
    const gated = m.gate !== false;
    const fellBack = gated && m.fallback_s != null && tried >= m.fallback_s;
    const go = root.querySelector("#matchgo");
    const open = match.matched || !gated || fellBack;
    go.disabled = !open;
    go.classList.toggle("lit", open);
    go.classList.toggle("matched", match.matched);
    root.querySelector("#matchtried").textContent = gated ? `${Math.floor(tried)} s` : "";
  }

  // One calibration sample. The owner presses this at good and bad alignments
  // on real walls, then copies the lot out of the menu.
  function logSample() {
    if (!match || !cfg.opts.logLine) return;
    const acc = cfg.opts.getAccuracy ? cfg.opts.getAccuracy() : null;
    cfg.opts.logLine({
      stop: cfg.opts.stopId || "",
      time: new Date().toISOString(),
      score: match.smooth == null ? 0 : match.smooth,
      on: match.on, off: match.off,
      x: view.x, y: view.y, scale: view.scale, rot: view.rot,
      matched: match.matched,
      acc: acc == null ? null : acc,
    });
    const b = root.querySelector("#matchlog");
    b.textContent = "Logged";
    setTimeout(() => { b.textContent = "Log"; }, 700);
  }

  /* ---- capture ---- */
  async function capture() {
    const video = root.querySelector("#lensfeed");
    const shot = root.querySelector("#lensshot");
    const live = !video.hidden && video.videoWidth > 0;
    const W = window.innerWidth, H = window.innerHeight;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const src = live ? video : (shot.hidden ? null : shot);
    if (src) {
      // object-fit: cover in a canvas, worked out by hand: crop the source to
      // the screen's aspect and draw the crop full-bleed, or the overlay lands
      // somewhere different in the picture than it did on the screen.
      const sw = live ? video.videoWidth : shot.naturalWidth;
      const sh = live ? video.videoHeight : shot.naturalHeight;
      const k = Math.max(W / sw, H / sh);
      const cw = W / k, ch = H / k;
      ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, W, H);
    }

    const over = root.querySelector("#lensover");
    ctx.globalAlpha = parseFloat(over.style.opacity || 1);
    try {
      await drawOverlay(ctx);
    } catch (err) {
      // A stencil served from another origin taints the canvas and toBlob
      // throws. Ours are same-origin, so this is a fallback, not a plan.
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], "lens.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; } catch (err) { /* cancelled */ }
      }
      window.open(URL.createObjectURL(blob), "_blank");
    }, "image/png");
  }

  function drawOverlay(ctx) {
    const over = root.querySelector("#lensover");
    if (cfg.lens.kind === "cord") return drawSvg(ctx, over.querySelector("svg"));
    const node = over.firstElementChild;
    if (!node) return Promise.resolve();
    // Layout size, not the bounding box, for the same reason as the mask: a
    // turned shape's box is bigger than the shape.
    const w = node.tagName === "IMG" ? node.offsetWidth : parseFloat(node.getAttribute("width"));
    const h = node.tagName === "IMG" ? node.offsetHeight : parseFloat(node.getAttribute("height"));
    if (node.tagName === "IMG") {
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.rotate(view.rot * Math.PI / 180);
      ctx.scale(view.scale, view.scale);
      ctx.drawImage(node, -w / 2, -h / 2, w, h);
      ctx.restore();
      return Promise.resolve();
    }
    return drawSvg(ctx, node, view, w, h);
  }

  // An SVG is drawn by serialising it into an image. It has to be given an
  // explicit size or Safari draws nothing at all and reports no error.
  function drawSvg(ctx, svg, placement, w, h) {
    if (!svg) return Promise.resolve();
    const clone = svg.cloneNode(true);
    if (w == null) { const r = svg.getBoundingClientRect(); w = r.width; h = r.height; }
    clone.setAttribute("width", Math.max(1, Math.round(w)));
    clone.setAttribute("height", Math.max(1, Math.round(h)));
    const blob = new Blob([new XMLSerializer().serializeToString(clone)],
                          { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        if (placement) {
          ctx.save();
          ctx.translate(placement.x, placement.y);
          ctx.rotate(placement.rot * Math.PI / 180);
          ctx.scale(placement.scale, placement.scale);
          ctx.drawImage(im, -w / 2, -h / 2, w, h);
          ctx.restore();
        } else {
          ctx.drawImage(im, 0, 0, w, h);
        }
        URL.revokeObjectURL(url);
        resolve();
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      im.src = url;
    });
  }

  // How the match is doing on this phone: the last evaluation's cost and the
  // working size it settled on. Read-only, for checking the 10 ms budget.
  function stats() {
    return match ? { ms: match.ms == null ? null : Math.round(match.ms * 100) / 100,
                     recent: match.slow.map((v) => Math.round(v * 10) / 10),
                     workPx: match.workPx, score: match.smooth, matched: match.matched }
                 : null;
  }

  window.Lens = { open, close, stats };
})();
