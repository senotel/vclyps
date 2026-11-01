/* vClyps landing, the show (T18, built from Codex's T17 design:
   NO UPLOAD/team/design/T17-landing-spec.md, sections 4 to 8).

   One small story, the paper-plane shoot, keeps its identity while it
   changes: six loose pieces of the shoot -> they land on a timeline with
   captions, voice and music -> the pauses leave, then the gaps close -> the
   playhead finds the rhythm -> the four kept clips gather into one vertical
   short -> that short moves into a field of other stories.

   How it is driven, and why:
   - Scroll is the clock. p = how far through the tall #lpShow section the
     home screen has scrolled (0..1). Every piece is a pure function of p
     (frame() below), so scrolling back gives exactly the same frames, a fast
     flick may skip beats, and nothing is queued or held.
   - Nothing takes the scroll: one passive scroll listener, one
     requestAnimationFrame only when the position changed, none at all while
     the show is off screen (IntersectionObserver on the home screen).
   - Only transform and opacity change per frame. Sizes and places are set
     once per layout, on resize or when fonts arrive.
   - Reduced motion, a short landscape screen, very large text, or no
     JavaScript: the show is the finished still in index.html (is-still).

   The pure part at the top is exported as window.vcLandingShow and tested
   without a browser in NO UPLOAD/tests/landing-t18.test.cjs. */
(function (root) {
  "use strict";

  /* ══════════ pure maths ══════════ */

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function mix(a, b, k) { return a + (b - a) * k; }

  // A CSS cubic-bezier as a function of progress u: solve the curve's x for u
  // (Newton, then bisection when Newton stalls), then return its y. Plugging
  // u straight into the y polynomial would give the wrong curve.
  function bezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function X(t) { return ((ax * t + bx) * t + cx) * t; }
    function Y(t) { return ((ay * t + by) * t + cy) * t; }
    function dX(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (u) {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      var t = u, i, d, x;
      for (i = 0; i < 8; i++) {
        x = X(t) - u;
        if (Math.abs(x) < 1e-7) return Y(t);
        d = dX(t);
        if (Math.abs(d) < 1e-6) break;
        t -= x / d;
      }
      var lo = 0, hi = 1;
      t = u;
      for (i = 0; i < 40; i++) {
        x = X(t);
        if (Math.abs(x - u) < 1e-7) break;
        if (x < u) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return Y(t);
    };
  }

  // the spec's five curves
  var EASE = {
    A: bezier(0.22, 1, 0.36, 1),   // arrive: pieces settling into lanes
    M: bezier(0.65, 0, 0.35, 1),   // morph: shared pieces, phone assembly
    X: bezier(0.4, 0, 1, 1),       // exit: short departures
    L: function (u) { return u; }, // clock: playhead
    F: bezier(0.33, 0, 0.67, 1)    // dissolve: opacity bridges
  };

  // one channel: 0 before a, 1 after b, eased in between
  function ch(p, a, b, ease) { return (ease || EASE.L)(clamp01((p - a) / (b - a))); }

  var BEATS = [
    { from: 0, to: 0.12, line: "A good story starts here.", phone: "A good story|starts here." },
    { from: 0.12, to: 0.30, line: "It all comes together.", phone: "It all comes|together." },
    { from: 0.30, to: 0.44, line: "Keep the good part.", phone: "Keep the|good part." },
    { from: 0.44, to: 0.58, line: "Find the rhythm.", phone: "Find the rhythm." },
    { from: 0.58, to: 0.74, line: "Now it's a video.", phone: "Now it's a video." },
    { from: 0.74, to: 0.88, line: "Make room for more.", phone: "Make room|for more." },
    { from: 0.88, to: 1, line: "Imagine a million stories.", phone: "Imagine a|million stories.", second: "Start with yours." }
  ];

  // Headlines stay put and only dissolve: the old one leaves in the .012
  // before a boundary, the new one arrives in the .012 after it, so two
  // headlines are never on screen together.
  function headOpacity(p, i) {
    var b = BEATS[i];
    var inn = i === 0 ? 1 : ch(p, b.from, b.from + 0.012, EASE.F);
    var out = i === BEATS.length - 1 ? 0 : ch(p, b.to - 0.012, b.to, EASE.F);
    return inn * (1 - out);
  }

  // p from the home screen's scroll. sectionTop is in the scroll box's own
  // content coordinates; the pin sticks under the header (nav), so the show
  // starts when the section's top meets the header's bottom.
  function progress(scrollTop, sectionTop, nav, sectionH, pinH) {
    return clamp01((scrollTop + nav - sectionTop) / Math.max(1, sectionH - pinH));
  }

  // the source shoot: six windows, 16 s in all; B and E are pauses
  var DUR = [3, 2, 3, 3, 2, 3];
  var KEEP = [true, false, true, true, false, true];
  var ROT = [-4, 3, -2, 3, -3, 2];
  var CAPS = [
    { t: "Fold.", clip: 0 }, { t: "um", clip: 1, word: true }, { t: "Miss.", clip: 2 },
    { t: "Again.", clip: 3 }, { t: "like", clip: 4, word: true }, { t: "Made it.", clip: 5 }
  ];
  var KEPT_CAPS = ["Fold.", "Miss.", "Again.", "Made it."];

  // Stage geometry, as fractions of the stage (x of width, y of height).
  // x/y are centres unless named otherwise. From the spec's geometry table.
  var VARIANT = {
    desktop: {
      phone: false,
      head: { x: 0.053, y: 0.162 }, skip: { x: 0.947, y: 0.062 }, cue: { x: 0.053, y: 0.95 },
      tl: { x: 0.09, w: 0.82, keptW: 0.615, ruler: 0.365, cap: [0.412, 0.047], vid: [0.529, 0.141], voice: [0.646, 0.056], music: [0.719, 0.056] },
      loose: {
        clips: [[0.18, 0.39], [0.43, 0.34], [0.72, 0.38], [0.28, 0.66], [0.55, 0.60], [0.83, 0.67]], size: [0.17, 0.14],
        voice: [0.47, 0.81, 0.40, 0.05], music: [0.72, 0.87, 0.30, 0.05], um: [0.39, 0.46], like: [0.67, 0.52]
      },
      clipWin: [0.14, 0.225], stagger: 0.012,
      panel: { x: 0.50, y: 0.29, w: 0.24, h: 0.075 },
      short: { x: 0.70, y: 0.59, w: 0.21, h: 0.659 }, surround: 8,
      line: { x: 0.16, y: 0.53 },
      wall: { cols: 7, rows: 3, x0: 0.08, dx: 0.14, y0: 0.34, dy: 0.38, w: 0.1133, h: 0.3556, cc: 3, cr: 1 },
      plane: 0.243
    },
    phone: {
      phone: true,
      head: { x: 0.051, y: 0.123 }, skip: { x: 0.949, y: 0.045 }, cue: { x: 0.051, y: 0.95 },
      tl: { x: 0.051, w: 0.898, keptW: 0.6735, ruler: 0.378, cap: [0.427, 0.040], vid: [0.522, 0.120], voice: [0.623, 0.046], music: [0.692, 0.046] },
      loose: {
        clips: [[0.19, 0.34], [0.51, 0.31], [0.80, 0.37], [0.22, 0.53], [0.54, 0.55], [0.80, 0.59]], size: [0.26, 0.105],
        voice: [0.38, 0.73, 0.60, 0.046], music: [0.62, 0.80, 0.60, 0.046], um: [0.43, 0.43], like: [0.65, 0.65]
      },
      clipWin: [0.14, 0.235], stagger: 0.009,
      panel: { x: 0.50, y: 0.32, w: 0.54, h: 0.075 },
      short: { x: 0.50, y: 0.576, w: 0.462, h: 0.492 }, surround: 6,
      line: null,
      wall: { cols: 3, rows: 5, x0: 0.17, dx: 0.33, y0: 0.07, dy: 0.28, w: 0.2308, h: 0.2462, cc: 1, cr: 2 },
      plane: 0.269
    }
  };

  // where each source clip sits on the raw 16 s timeline, and the kept 12 s one
  function rawSlots(v) {
    var out = [], cum = 0;
    DUR.forEach(function (d) {
      var w = d / 16 * v.tl.w;
      out.push({ x: v.tl.x + cum / 16 * v.tl.w + w / 2, w: w, left: v.tl.x + cum / 16 * v.tl.w });
      cum += d;
    });
    return out;
  }
  function keptSlot(v, k) {
    var w = v.tl.keptW / 4;
    return { x: v.tl.x + (k + 0.5) * w, w: w, left: v.tl.x + k * w };
  }
  function keptIndex(i) { return i === 0 ? 0 : i === 2 ? 1 : i === 3 ? 2 : i === 5 ? 3 : -1; }
  function wallSlots(v) {
    var out = [], W = v.wall;
    for (var r = 0; r < W.rows; r++) for (var c = 0; c < W.cols; c++) {
      if (c === W.cc && r === W.cr) continue;   // the short's own slot
      out.push({ c: c, r: r, x: W.x0 + W.dx * c, y: W.y0 + W.dy * r, rank: Math.abs(c - W.cc) + Math.abs(r - W.cr) });
    }
    return out;
  }

  // The whole stage at progress p: plain numbers, no DOM, no memory of the
  // previous frame. Boxes are {x, y, w, h} (centres and sizes, fractions of
  // the stage), r in degrees, o opacity.
  function frame(p, v) {
    var tl = v.tl, raw = rawSlots(v), F = {};
    var lanes = ch(p, 0.12, 0.15, EASE.F);
    var exit = ch(p, 0.335, 0.365, EASE.X);        // pauses leave first
    var close = ch(p, 0.38, 0.43, EASE.A);         // then the gaps close
    var contract = ch(p, 0.38, 0.43, EASE.M);      // voice and music 16 s -> 12 s
    var labelsOut = ch(p, 0.585, 0.61, EASE.F);    // playhead, ruler, legends leave
    var lanesOut = ch(p, 0.62, 0.66, EASE.F);      // captions and waves leave
    var laneW = tl.w * (1 - 0.25 * contract);

    F.heads = BEATS.map(function (b, i) { return headOpacity(p, i); });
    F.second = ch(p, 0.90, 0.92, EASE.F);
    F.cue = 1 - ch(p, 0.12, 0.14, EASE.F);
    F.cta = ch(p, 0.885, 0.90, EASE.F);

    // clips
    F.clips = raw.map(function (slot, i) {
      var l = v.loose.clips[i], a = v.clipWin[0] + v.stagger * i, b = v.clipWin[1] + v.stagger * i;
      var fly = ch(p, a, b, EASE.A);
      var s = {
        x: mix(l[0], slot.x, fly), y: mix(l[1], tl.vid[0], fly),
        w: mix(v.loose.size[0], slot.w, fly), h: mix(v.loose.size[1], tl.vid[1], fly),
        r: mix(ROT[i], 0, fly), o: 1, crop: 0,
        // phone: the small label gives way to the big initial as it lands
        ini: v.phone ? ch(p, a + 0.6 * (b - a), b, EASE.F) : 0
      };
      var k = keptIndex(i);
      if (k >= 0) {
        s.x = mix(s.x, keptSlot(v, k).x, close);
        var band = ch(p, 0.60 + 0.006 * k, 0.68 + 0.006 * k, EASE.M);
        var sh = v.short;
        s.x = mix(s.x, sh.x, band);
        s.y = mix(s.y, sh.y - sh.h / 2 + sh.h * (0.125 + 0.25 * k), band);
        s.w = mix(s.w, sh.w, band);
        s.h = mix(s.h, sh.h / 4, band);
        s.crop = ch(p, 0.65, 0.69, EASE.F);
        // the finished poster dissolves in on top of the four bands, which
        // are the same picture; they go once it is whole (no see-through dip)
        s.o = p >= 0.71 ? 0 : 1;
      } else {
        s.y -= 0.04 * exit;
        s.o = 1 - exit;
      }
      return s;
    });

    // captions: x is the left edge on the lane; ax 1 means x is the centre
    F.caps = CAPS.map(function (c, j) {
      var k = ch(p, 0.18 + 0.008 * j, 0.26 + 0.008 * j, EASE.A);
      var left = raw[c.clip].left, y = tl.cap[0], s;
      if (c.word) {
        var l = v.loose[c.t === "um" ? "um" : "like"];
        s = { x: mix(l[0], left, k), ax: 1 - k, y: mix(l[1], y, k) - 0.04 * exit, s: 1, o: 1 - exit };
      } else {
        var kx = keptIndex(c.clip);
        s = { x: mix(left, keptSlot(v, kx).left, close), ax: 0, y: mix(y - 0.03, y, k), s: mix(0.96, 1, k), o: k };
        s.y -= 0.012 * lanesOut;
        s.o *= 1 - lanesOut;
      }
      return s;
    });

    F.laneb = { x: tl.x + laneW / 2, y: tl.cap[0], w: laneW, h: tl.cap[1], o: lanes * (1 - lanesOut) };
    var gapO = ch(p, 0.335, 0.365, EASE.F) * (1 - ch(p, 0.38, 0.40, EASE.F));
    F.gaps = [1, 4].map(function (i) { return { x: raw[i].x, y: tl.vid[0], w: raw[i].w, h: tl.vid[1], o: gapO }; });

    F.tracks = [["voice", 0.18, 0.27, 1], ["music", 0.20, 0.29, 1]].map(function (t) {
      var fly = ch(p, t[1], t[2], EASE.M), l = v.loose[t[0]], lane = tl[t[0]];
      return {
        x: mix(l[0], tl.x + laneW / 2, fly), y: mix(l[1], lane[0], fly) + 0.012 * lanesOut,
        w: mix(l[2], laneW, fly), h: mix(l[3], lane[1], fly), o: 1 - lanesOut
      };
    });

    var rulerSwap = ch(p, 0.405, 0.425, EASE.F);
    F.rulerRaw = lanes * (1 - rulerSwap) * (1 - labelsOut);
    F.rulerKept = rulerSwap * (1 - labelsOut);
    F.legends = lanes * (1 - labelsOut);

    // the playhead: to the end of the first pause, then carried by the cut
    // to the same moment on the shorter timeline, back to the start, and
    // across the kept edit at a steady rate
    var perSec = tl.w / 16, x;
    if (p < 0.38) x = tl.x + 5 * perSec * ch(p, 0.31, 0.335, EASE.L);
    else if (p < 0.435) x = mix(tl.x + 5 * perSec, tl.x + 3 * perSec, close);
    else if (p < 0.45) x = mix(tl.x + 3 * perSec, tl.x, ch(p, 0.435, 0.45, EASE.M));
    else x = tl.x + 12 * perSec * ch(p, 0.45, 0.565, EASE.L);
    F.playhead = { x: x, o: lanes * (1 - labelsOut) };
    var sec = (x - tl.x) / perSec;
    F.panel = { text: KEPT_CAPS[Math.max(0, Math.min(3, Math.floor(sec / 3 + 1e-9)))], o: ch(p, 0.44, 0.452, EASE.F) * (1 - labelsOut) };

    // the finished short, then its move into the middle of the field
    var mv = ch(p, 0.745, 0.81, EASE.M), W = v.wall, sh = v.short;
    var cx = W.x0 + W.dx * W.cc, cy = W.y0 + W.dy * W.cr;
    F.short = { x: mix(sh.x, cx, mv), y: mix(sh.y, cy, mv), w: mix(sh.w, W.w, mv), h: mix(sh.h, W.h, mv), o: ch(p, 0.66, 0.71, EASE.F) };
    F.shell = ch(p, 0.67, 0.70, EASE.F) * (1 - ch(p, 0.75, 0.79, EASE.F));
    F.line = v.line ? ch(p, 0.69, 0.72, EASE.F) * (1 - ch(p, 0.74, 0.76, EASE.X)) : 0;

    // the field opens from the short's slot outward, nearest first
    F.tiles = wallSlots(v).map(function (t) {
      var k = ch(p, 0.77 + 0.012 * t.rank, 0.825 + 0.012 * t.rank, EASE.A);
      var sx = cx + Math.max(-0.025, Math.min(0.025, t.x - cx));
      var sy = cy + Math.max(-0.025, Math.min(0.025, t.y - cy));
      var s = mix(0.96, 1, k);
      return { x: mix(sx, t.x, k), y: mix(sy, t.y, k), w: W.w * s, h: W.h * s, o: k };
    });
    return F;
  }

  /* The media contract: every footage surface is one record. Until the owner
     supplies footage, poster is empty and the deliberate type composition
     shows. A poster replaces it only after it decodes; a failed one leaves the
     type. Loops are only ever fetched after an explicit Play (none yet). */
  var MEDIA = {
    A: { id: "A", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "Fold.", ink: "ink", surface: "paper", sampleKind: "type" },
    B: { id: "B", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "Pause.", ink: "ink", surface: "paper", sampleKind: "type" },
    C: { id: "C", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "Miss.", ink: "paper", surface: "ink", sampleKind: "type" },
    D: { id: "D", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "Again.", ink: "ink", surface: "splice", sampleKind: "type" },
    E: { id: "E", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "Pause.", ink: "ink", surface: "paper", sampleKind: "type" },
    F: { id: "F", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "Made it.", ink: "paper", surface: "ink", sampleKind: "type" },
    short: { id: "short", poster: "", loop: "", objectPosition: [0.5, 0.5], caption: "One more try.", ink: "ink", surface: "splice", sampleKind: "type" }
  };
  var STORIES = ["One more try.", "From scratch.", "Tiny wins.", "First light.", "The long way.", "Sunday.", "Made by hand."];
  var SURFACES = ["splice", "paper", "ink"];
  function story(c, r) {
    var t = STORIES[(c + 1 + 3 * r) % STORIES.length];
    var surface = SURFACES[(c + r) % 3];
    return { id: "story-" + c + "-" + r, poster: "", loop: "", objectPosition: [0.5, 0.5], caption: t, ink: surface === "ink" ? "paper" : "ink", surface: surface, sampleKind: "type" };
  }

  root.vcLandingShow = {
    bezier: bezier, EASE: EASE, ch: ch, BEATS: BEATS, headOpacity: headOpacity, progress: progress,
    VARIANT: VARIANT, frame: frame, rawSlots: rawSlots, keptSlot: keptSlot, wallSlots: wallSlots,
    DUR: DUR, KEEP: KEEP, MEDIA: MEDIA, story: story
  };

  /* ══════════ the page ══════════ */
  if (typeof document === "undefined") return;
  var home = document.getElementById("screen-home");
  var show = document.getElementById("lpShow");
  var stage = document.getElementById("lpStage");
  var art = document.getElementById("lpArt");
  if (!home || !show || !stage || !art) return;
  var lpRoot = home.querySelector(".lp-root");
  var skip = stage.querySelector(".lp-skip");
  var act = show.querySelector(".lp-show-act");
  var cta = document.getElementById("lpShowPick");
  var stillHead = show.querySelector(".lp-still .lp-h2");
  var reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // a poster, once real footage exists, goes in over the type composition
  function dress(mount, rec) {
    if (!rec || !rec.poster) return;
    var img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.src = rec.poster;
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:" +
      (rec.objectPosition[0] * 100) + "% " + (rec.objectPosition[1] * 100) + "%";
    (img.decode ? img.decode() : Promise.resolve()).then(function () {
      mount.appendChild(img);
      mount.classList.add("has-poster");
    }, function () { /* keep the type composition */ });
  }
  home.querySelectorAll("[data-media]").forEach(function (el) { dress(el, MEDIA[el.getAttribute("data-media")]); });

  function el(cls, html, parent) {
    var e = document.createElement("div");
    e.className = cls;
    if (html != null) e.innerHTML = html;
    (parent || art).appendChild(e);
    return e;
  }
  function posterHTML() {
    return '<i class="lp-poster-rule"></i><p class="lp-poster-words">One<br>more<br>try.</p><p class="lp-poster-tag">A type-only sample</p>';
  }

  var V = null, kind = "", N = {};   // the variant, its name, the stage's nodes
  function build(v) {
    art.textContent = "";
    N = {};
    N.tiles = wallSlots(v).map(function (t) {
      var rec = story(t.c, t.r);
      var e = el("lp-p lp-box lp-tile is-" + rec.surface, "<p>" + rec.caption.split(" ").join("<br>") + "</p>");
      dress(e, rec);
      return e;
    });
    N.plane = el("lp-box lp-plane");
    N.laneb = el("lp-p lp-box lp-laneb");
    N.gaps = [0, 1].map(function () { return el("lp-p lp-box lp-gap", "pause"); });
    N.rulerRaw = el("lp-ruler", "<span>0:00</span><span>0:04</span><span>0:08</span><span>0:12</span><span>0:16</span>");
    N.rulerKept = el("lp-ruler", "<span>0:00</span><span>0:03</span><span>0:06</span><span>0:09</span><span>0:12</span>");
    N.legends = v.phone ? [] : [el("lp-leg", "Voice"), el("lp-leg", "Music")];
    N.tracks = ["voice", "music"].map(function (k) {
      var name = v.phone ? '<span class="lp-track-name">' + (k === "voice" ? "Voice" : "Music") + "</span>" : "";
      var e = el("lp-p lp-box lp-track is-" + k);
      e._in = [el("lp-in", name + '<i class="lp-wave"></i>', e)];
      return e;
    });
    N.clips = DUR.map(function (d, i) {
      var rec = MEDIA["ABCDEF"[i]];
      var e = el("lp-p lp-box lp-clip is-" + rec.surface);
      e._lbl = el("lp-in lp-lbl", rec.caption, e);
      e._in = [e._lbl];
      if (v.phone) {
        e._ini = el("lp-in lp-ini", KEEP[i] ? rec.caption.charAt(0) : "", e);
        e._in.push(e._ini);
      }
      if (KEEP[i]) {
        e._crop = el("lp-in lp-crop", null, e);
        e._crop.style.transformOrigin = "50% 50%";
        e._cropPoster = el("lp-poster is-splice", posterHTML(), e._crop);
      }
      dress(e, rec);
      return e;
    });
    N.caps = CAPS.map(function (c) { return el("lp-p lp-cap" + (c.word ? " is-word" : ""), c.t); });
    N.playhead = el("lp-p lp-head-mark");
    N.panel = el("lp-p lp-box lp-panel", KEPT_CAPS[0]);
    N.shell = el("lp-p lp-box lp-shell");
    N.short = el("lp-p lp-box lp-poster is-splice", posterHTML());
    dress(N.short, MEDIA.short);
    N.line = v.line ? el("lp-oneline", "One more<br>try.") : null;
    N.heads = BEATS.map(function (b) {
      var txt = v.phone ? b.phone.split("|").join("<br>") : b.line;
      return el("lp-sh", txt);
    });
    N.second = el("lp-sh2", BEATS[6].second);
    N.cue = el("lp-cue", "Scroll to edit");
  }

  var S = { w: 0, h: 0, nav: 72, top: 0, H: 0, pin: 0 };   // measured
  var isStill = show.classList.contains("is-still");

  function px(n) { return n.toFixed(1) + "px"; }
  // set a box node's resting place (its base) once per layout
  function base(e, x, y, w, h, inset) {
    inset = inset || 0;
    var W = S.w, H = S.h;
    var b = { x: x * W, y: y * H, w: w * W - inset * 2, h: h * H, inset: inset };
    e._b = b;
    e.style.left = px(b.x - b.w / 2);
    e.style.top = px(b.y - b.h / 2);
    e.style.width = px(b.w);
    e.style.height = px(b.h);
    if (e._in) e._in.forEach(function (n) { n.style.width = px(b.w); n.style.height = px(b.h); });
  }

  function layout() {
    var vw = home.clientWidth, vh = home.clientHeight;
    var small = vw < 700;   // the page's own phone layout: header, gutters, buttons
    S.nav = small ? 64 : 72;
    var pinH = vh - S.nav;
    var gut = small ? 20 : vw < 1100 ? 32 : Math.max(64, (vw - 1312) / 2);
    var btn = small ? 56 : 60, pad = small ? 12 : 16;
    var w = small ? vw : vw - 2 * gut, h = pinH - btn - 2 * pad;
    // the composition follows the shape of the room it gets: the tall one on
    // phones and portrait tablets, the wide one everywhere else
    var phone = small || w / h < 1.2;
    var want = phone ? "phone" : "desktop";
    if (want !== kind) { kind = want; V = VARIANT[kind]; build(V); }
    lpRoot.style.setProperty("--lp-vh", vh + "px");
    var A = phone ? 390 / 650 : 1200 / 680;
    if (phone) h = Math.min(h, w / A);
    if (w / h > A * 1.1) w = h * A * 1.1;
    if (w / h < A * 0.9) h = w / (A * 0.9);
    S.w = w; S.h = h;
    var top = Math.max(0, (pinH - (h + btn + 2 * pad)) / 2);
    stage.style.left = px((vw - w) / 2);
    stage.style.top = px(top);
    stage.style.width = px(w);
    stage.style.height = px(h);
    act.style.top = px(top + h + pad);
    act.style.left = px(small ? gut : (vw - w) / 2);
    act.style.right = px(small ? gut : 0);

    var v = V, tl = v.tl, raw = rawSlots(v);
    // type sizes follow the stage, not the window
    var vidH = tl.vid[1] * h, capH = tl.cap[1] * h;
    stage.style.setProperty("--clip-fs", px(phone ? Math.max(12, vidH * 0.17) : Math.max(14, vidH * 0.26)));
    stage.style.setProperty("--clip-pad", px(phone ? 8 : 12));
    stage.style.setProperty("--ini-fs", px(vidH * 0.55));
    stage.style.setProperty("--cap-fs", px(Math.max(11, capH * 0.42)));
    stage.style.setProperty("--cap-pad", px(phone ? 6 : 12));
    stage.style.setProperty("--panel-fs", px(v.panel.h * h * 0.5));

    N.tiles.forEach(function (e, i) { var t = wallSlots(v)[i]; base(e, t.x, t.y, v.wall.w, v.wall.h); });
    base(N.plane, 0.5, v.plane / 2, 1, v.plane);
    base(N.laneb, tl.x + tl.w / 2, tl.cap[0], tl.w, tl.cap[1]);
    N.gaps.forEach(function (e, k) { var s = raw[k ? 4 : 1]; base(e, s.x, tl.vid[0], s.w, tl.vid[1], 2); });
    [[N.rulerRaw, tl.w], [N.rulerKept, tl.keptW]].forEach(function (r) {
      r[0].style.left = px(tl.x * w);
      r[0].style.top = px(tl.ruler * h - 12);
      r[0].style.width = px(r[1] * w);
      Array.prototype.forEach.call(r[0].children, function (s, k) {
        s.style.left = (k * 25) + "%";
        s.style.transform = k === 4 ? "translateX(-100%)" : "";
      });
    });
    N.legends.forEach(function (e, k) {
      var lane = tl[k ? "music" : "voice"];
      e.style.left = px(tl.x * w);
      e.style.top = px((lane[0] - lane[1] / 2) * h - 15);
    });
    N.tracks.forEach(function (e, k) { var lane = tl[k ? "music" : "voice"]; base(e, tl.x + tl.w / 2, lane[0], tl.w, lane[1]); });
    var sh = v.short;
    DUR.forEach(function (d, i) {
      var e = N.clips[i], k = keptIndex(i);
      if (k >= 0) {
        // kept clips rest where they end: one band of the finished short
        base(e, sh.x, sh.y - sh.h / 2 + sh.h * (0.125 + 0.25 * k), sh.w, sh.h / 4);
        e._crop.style.width = px(e._b.w);
        e._crop.style.height = px(e._b.h);
        e._cropPoster.style.width = px(sh.w * w);
        e._cropPoster.style.height = px(sh.h * h);
        e._cropPoster.style.top = px(-k * sh.h * h / 4);
      } else base(e, raw[i].x, tl.vid[0], raw[i].w, tl.vid[1], 2);
    });
    N.caps.forEach(function (e) { e.style.height = px(capH); e._w = e.offsetWidth; });
    N.playhead.style.width = px(phone ? 2 : 3);
    var phTop = (tl.cap[0] - tl.cap[1] / 2) * h - 6, phBot = (tl.music[0] + tl.music[1] / 2) * h + 6;
    N.playhead.style.top = px(phTop);
    N.playhead.style.height = px(phBot - phTop);
    base(N.panel, v.panel.x, v.panel.y, v.panel.w, v.panel.h);
    base(N.short, sh.x, sh.y, sh.w, sh.h);
    var sr = v.surround;
    N.shell._b = { x: sh.x * w, y: sh.y * h, w: sh.w * w + 2 * sr, h: sh.h * h + 2 * sr };
    N.shell.style.left = px(N.shell._b.x - N.shell._b.w / 2);
    N.shell.style.top = px(N.shell._b.y - N.shell._b.h / 2);
    N.shell.style.width = px(N.shell._b.w);
    N.shell.style.height = px(N.shell._b.h);
    N.short.style.borderRadius = px(24 - sr);
    // headlines: the first baseline on the spec's origin
    var fs = parseFloat(getComputedStyle(N.heads[0]).fontSize) || 56;
    // the second line and the desktop sample line keep the spec's ratio to
    // the headline (44 to 56 on the wide stage, 28 to 34 on the tall one)
    N.second.style.fontSize = px(fs * (phone ? 28 / 34 : 44 / 56));
    if (N.line) {
      N.line.style.fontSize = px(fs * 44 / 56);
      N.line.style.left = px(v.line.x * w);
      N.line.style.top = px(v.line.y * h - N.line.offsetHeight / 2);
    }
    stage.style.setProperty("--gap-fs", px(phone ? 10 : 13));
    var hTop = v.head.y * h - 0.84 * fs;
    N.heads.forEach(function (e) {
      e.style.left = px(v.head.x * w);
      e.style.top = px(hTop);
    });
    N.second.style.left = px(v.head.x * w);
    N.second.style.top = px(hTop + N.heads[6].offsetHeight - 2);
    var headBottom = hTop + N.heads[6].offsetHeight - 2 + N.second.offsetHeight;
    N.cue.style.left = px(v.cue.x * w);
    N.cue.style.top = px(v.cue.y * h - 14);
    skip.style.left = px(v.skip.x * w - skip.offsetWidth);   // x is its right edge
    skip.style.top = px(v.skip.y * h - 22);

    // the section and where it sits in the home screen's scroll
    S.pin = pinH;
    S.H = show.offsetHeight;
    S.top = topIn(show);
    // the static path when the motion cannot be read well: a short landscape
    // screen, or text so large the headline region cannot hold it
    S.cramped = (vh < 600 && vw > vh) || headBottom > (v.plane + 0.06) * h ||
      N.heads.some(function (e) { return e.offsetWidth > w * 0.94; });
  }

  // write a node's transform and opacity, only when they changed
  function put(e, t, o) {
    var os = o <= 0.001 ? "0" : o >= 0.999 ? "1" : o.toFixed(3);
    if (e._t !== t) { e.style.transform = t; e._t = t; }
    if (e._o !== os) { e.style.opacity = os; e._o = os; }
  }
  function boxTo(e, s, r) {
    var b = e._b, cx = s.x * S.w, cy = s.y * S.h;
    var w = s.w * S.w - (b.inset || 0) * 2, h = s.h * S.h;
    var sx = w / b.w, sy = h / b.h;
    put(e, "translate(" + (cx - b.x).toFixed(2) + "px," + (cy - b.y).toFixed(2) + "px)" +
      (r ? " rotate(" + r.toFixed(2) + "deg)" : "") + " scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ")", s.o);
    // labels and waves inside are held at their own size, so they never squash
    if (e._in) {
      var c = "scale(" + (1 / sx).toFixed(4) + "," + (1 / sy).toFixed(4) + ")";
      e._in.forEach(function (n) { if (n._t !== c) { n.style.transform = c; n._t = c; } });
    }
  }
  function fade(e, o) { put(e, e._t || "", o); }

  function render(p) {
    var f = frame(p, V);
    N.heads.forEach(function (e, i) { fade(e, f.heads[i]); });
    fade(N.second, f.second);
    fade(N.cue, f.cue);
    N.clips.forEach(function (e, i) {
      var s = f.clips[i];
      boxTo(e, s, s.r);
      // the label (phone: then the big initial) hands over to the poster crop
      fade(e._lbl, (1 - s.ini) * (1 - s.crop));
      if (e._ini) fade(e._ini, s.ini * (1 - s.crop));
      if (e._crop) fade(e._crop, s.crop);
    });
    N.caps.forEach(function (e, j) {
      var s = f.caps[j];
      var x = s.x * S.w - s.ax * e._w * s.s / 2 + (s.ax < 1 ? (1 - s.ax) * 3 : 0);
      var y = s.y * S.h - (S.h * V.tl.cap[1]) / 2;
      put(e, "translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px) scale(" + s.s.toFixed(4) + ")", s.o);
    });
    boxTo(N.laneb, f.laneb);
    N.gaps.forEach(function (e, k) { boxTo(e, f.gaps[k]); });
    N.tracks.forEach(function (e, k) { boxTo(e, f.tracks[k]); });
    fade(N.rulerRaw, f.rulerRaw);
    fade(N.rulerKept, f.rulerKept);
    N.legends.forEach(function (e) { fade(e, f.legends); });
    put(N.playhead, "translateX(" + (f.playhead.x * S.w - (V.phone ? 1 : 1.5)).toFixed(2) + "px)", f.playhead.o);
    if (N.panel.textContent !== f.panel.text) N.panel.textContent = f.panel.text;
    boxTo(N.panel, { x: V.panel.x, y: V.panel.y, w: V.panel.w, h: V.panel.h, o: f.panel.o });
    boxTo(N.short, f.short);
    var k = f.short.w / V.short.w;   // the shell rides with the short
    put(N.shell, "translate(" + (f.short.x * S.w - N.shell._b.x).toFixed(2) + "px," + (f.short.y * S.h - N.shell._b.y).toFixed(2) + "px) scale(" + k.toFixed(4) + ")", f.shell);
    if (N.line) fade(N.line, f.line);
    N.tiles.forEach(function (e, i) { boxTo(e, f.tiles[i]); });
    // the closing action: a real button below the stage, there from .90 on
    var co = f.cta.toFixed(3);
    if (cta._o !== co) {
      cta._o = co;
      act.style.opacity = co;
      act.style.visibility = f.cta > 0 ? "visible" : "hidden";
    }
    S.p = p;
  }

  /* ══════════ driving it ══════════ */
  var raf = 0, onScreen = true;
  function current() { return progress(home.scrollTop, S.top, S.nav, S.H, S.pin); }
  function tick() { raf = 0; if (!isStill) render(current()); }
  function kick() { if (!raf && !isStill && onScreen) raf = requestAnimationFrame(tick); }

  // which heading the visitor is looking at, to keep it in place when the
  // show turns into the still (or back)
  function shownHead() {
    if (isStill) return stillHead;
    var best = null, o = -1;
    (N.heads || []).forEach(function (e) { var v = parseFloat(e.style.opacity || "0"); if (v > o) { o = v; best = e; } });
    return best;
  }
  function topIn(e) { return e.getBoundingClientRect().top - home.getBoundingClientRect().top + home.scrollTop; }
  function inView() {
    var r = show.getBoundingClientRect(), hr = home.getBoundingClientRect();
    return r.bottom > hr.top && r.top < hr.bottom;
  }

  function settle() {
    // where the visitor is, from the scroll and the measurements before this change
    var wasStill = isStill, p = wasStill || !S.H ? null : current();
    var seen = inView(), pinned = p != null && p > 0 && p < 1 && seen;
    // below the show, keep the page where it is when the show's height
    // changes (the home screen does its own anchoring: overflow-anchor none)
    var oldEnd = wasStill ? topIn(show) + show.offsetHeight : S.top + S.H;
    var below = home.scrollTop >= oldEnd;
    var anchor = !wasStill && seen ? shownHead() : null;
    var before = anchor ? anchor.getBoundingClientRect().top : null;
    // reduced motion never measures the stage: it goes straight to the still
    if (!reduce.matches) { show.classList.remove("is-still"); layout(); }
    var wantStill = !!reduce.matches || S.cramped;
    stage.classList.toggle("is-live", !wantStill && onScreen);
    if (wantStill) {
      show.classList.add("is-still");
      isStill = true;
      // motion -> still while watching: the still's heading takes the place
      // of the headline that was on screen, so nothing jumps away
      if (before != null && stillHead) home.scrollTop += stillHead.getBoundingClientRect().top - before;
      else if (below) home.scrollTop += topIn(show) + show.offsetHeight - oldEnd;
      return;
    }
    isStill = false;
    S.H = show.offsetHeight;
    S.top = topIn(show);
    // a resize keeps the visitor at the same point of the show
    if (pinned) home.scrollTop = S.top - S.nav + p * (S.H - S.pin);
    else if (below) home.scrollTop += S.top + S.H - oldEnd;
    render(current());
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      onScreen = es[0].isIntersecting;
      // only the moving pieces get will-change, and only while the show is on screen
      stage.classList.toggle("is-live", onScreen && !isStill);
      if (onScreen) kick();
    }, { root: home, threshold: 0 }).observe(show);
  }
  home.addEventListener("scroll", kick, { passive: true });
  var resizeTimer = 0;
  function relayout() { if (resizeTimer) cancelAnimationFrame(resizeTimer); resizeTimer = requestAnimationFrame(function () { resizeTimer = 0; if (home.clientWidth) settle(); }); }
  window.addEventListener("resize", relayout);
  if ("ResizeObserver" in window) {
    var hero = document.getElementById("lpHero");
    var ro = new ResizeObserver(relayout);
    ro.observe(home);
    if (hero) ro.observe(hero);
  }
  if (reduce.addEventListener) reduce.addEventListener("change", settle);
  else if (reduce.addListener) reduce.addListener(settle);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
  settle();
})(typeof window !== "undefined" ? window : globalThis);
