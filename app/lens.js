/* The lens: the phone's camera with a picture laid over the live view, which
   the player lines up against something real by hand.

   No dependencies, no library, and above all no computer vision. Nothing here
   detects anything, nothing snaps to anything and nothing is measured for you.
   The overlay is a shape on top of a video, and every last pixel of where it
   sits was put there by somebody's thumb. That is the game: the phone holds the
   picture still and the player does the looking.

   window.Lens.open(lens, diary_mm) where lens is the stop's lens object and
   diary_mm is the physical size of the paper diary, used by the scale bar. */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const MIN_OPACITY = 0.3;

  let root = null;        // the full-screen container, built once and reused
  let stream = null;      // the live camera tracks, so they can all be stopped
  let cfg = null;         // { lens, diary }
  let view = null;        // { x, y, scale, rot } placement of the whole overlay
  let cord = null;        // { a: {x,y}, b: {x,y} } the two cord ends, in pixels
  let mmPerPx = null;     // set by Calibrate with the diary, cleared by Reset
  const pointers = new Map();
  let pinch = null;

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
                background: linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0));
                display: flex; flex-direction: column; gap: 9px; }
    #lenstop { position: absolute; left: 0; right: 0; top: 0;
               padding: calc(8px + env(safe-area-inset-top)) 12px 8px;
               background: linear-gradient(to bottom, rgba(0,0,0,.62), rgba(0,0,0,0));
               display: flex; align-items: center; gap: 10px; }
    #lensnote { font-size: .78rem; line-height: 1.35; flex: 1;
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
    attachGestures();
  }

  function note(text) { root.querySelector("#lensnote").textContent = text; }

  /* ---- opening and closing ---- */
  async function open(lens, diary) {
    if (!root) build();
    cfg = { lens, diary: diary || { w: 148, h: 210 } };
    mmPerPx = null;
    root.classList.add("on");
    root.querySelector("#lensop").value = 100;
    root.querySelector("#lensshot").hidden = true;
    root.querySelector("#lensfeed").hidden = false;
    note(lens.note || "Line it up against the real thing.");
    buildOverlay();
    buildActions();
    paintScale();
    await startCamera();
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
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream;
    } catch (err) {
      fallback(err && err.name === "NotAllowedError"
        ? "The camera was refused. You can use a photo instead."
        : "No camera here. You can use a photo instead.");
    }
  }
  // Refusing the camera must not end the lens. The same overlay over a still
  // photo is the same tool, one frame at a time, and it is the only thing that
  // works on a laptop or behind a locked-down browser.
  function fallback(why) {
    note(why);
    const pick = root.querySelector("#lenspick");
    const b = el("button", "lensb", "Choose a photo");
    b.onclick = () => pick.click();
    root.querySelector("#lensactions").prepend(b);
  }

  function close() {
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
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
    const size = shortEdge() * 0.6;
    view = { x: window.innerWidth / 2, y: window.innerHeight / 2, scale: 1, rot: 0 };

    if (cfg.lens.kind === "stencil") {
      const img = el("img");
      img.src = cfg.lens.src;
      img.alt = "";
      img.style.width = size + "px";
      over.appendChild(img);
      img.onload = () => { centreOn(over); };
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
    const r = node.getBoundingClientRect();
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.rotate(view.rot * Math.PI / 180);
    ctx.scale(view.scale, view.scale);
    const w = r.width / view.scale, h = r.height / view.scale;
    if (node.tagName === "IMG") {
      ctx.drawImage(node, -w / 2, -h / 2, w, h);
      ctx.restore();
      return Promise.resolve();
    }
    ctx.restore();
    return drawSvg(ctx, node, view);
  }

  // An SVG is drawn by serialising it into an image. It has to be given an
  // explicit size or Safari draws nothing at all and reports no error.
  function drawSvg(ctx, svg, placement) {
    if (!svg) return Promise.resolve();
    const clone = svg.cloneNode(true);
    const r = svg.getBoundingClientRect();
    clone.setAttribute("width", Math.max(1, Math.round(r.width)));
    clone.setAttribute("height", Math.max(1, Math.round(r.height)));
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
          ctx.drawImage(im, -r.width / (2 * placement.scale),
                            -r.height / (2 * placement.scale),
                            r.width / placement.scale, r.height / placement.scale);
          ctx.restore();
        } else {
          ctx.drawImage(im, 0, 0, r.width, r.height);
        }
        URL.revokeObjectURL(url);
        resolve();
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      im.src = url;
    });
  }

  window.Lens = { open, close };
})();
