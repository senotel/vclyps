/* vClyps landing, the experience (0.68.0, reworked in T21)
   Two things, both drawn with plain elements and transforms, no libraries:

   1. The hero's wall of shorts (#lpWall): columns of finished vertical videos
      drifting past, as Prime Video's wall of posters says "this is a place
      full of films" before a word is read.
   2. The show (#lpShow): a tall section whose stage stays pinned while you
      scroll through it. Scroll IS the edit's clock:
        raw    the pieces of a shoot float loose: clips, spoken words, a
               voice, a song
        build  they fly onto a timeline and snap into their tracks
        cut    the playhead runs, the dull parts and the filler words drop
               out, the rest closes up
        fold   the timeline folds into a phone playing the finished short
        wall   that phone becomes one of a wall of shorts, and the wall
               pulls back into a field of 1,510 different videos
      It plays by itself once you have scrolled into it (autoplay), in the
      direction you last scrolled, and always gives way to your own
      scrolling, keys and links. With reduced motion it is one still frame.

   T21 (both audits, T19 and T20): autoplay never writes the scroll position
   while the visitor is scrolling; one opacity setter; the grid is rebuilt
   when its size changes, so no image repeats; the visitor keeps their place
   across a resize or rotation; the field's sheet is three small pages
   decoded off the main thread; the frame loop stops when nothing moves; a
   pause button for everything that moves on its own. */
(function () {
  "use strict";

  /* ── the logic, kept free of the page so NO UPLOAD/tests can check it ── */
  var Logic = (function () {
    // the ten caption styles (landing.css .cap-*), by number
    var CAPS = ["cap-punch", "cap-box", "cap-serif", "cap-outline", "cap-marker", "cap-mono", "cap-karaoke", "cap-bubble", "cap-block", "cap-quiet"];
    var N_CLIPS = 15;

    /* The hero wall: the 15 clips each once (owner: no image twice), with
       a caption style table instead of a formula. Neighbouring columns use
       different styles (they slide past each other, so any two tiles of
       neighbouring columns end up side by side), a column never repeats a
       style, and all ten styles are used. Four columns when the shortest
       one (three clips) is still taller than what the wall shows plus one
       tile, otherwise three columns of five (wallColumns). */
    var WALL = {
      3: [[[0, 0], [8, 1], [4, 2], [10, 3], [5, 4]],
          [[1, 5], [12, 6], [11, 7], [3, 8], [13, 9]],
          [[6, 2], [2, 4], [7, 0], [9, 1], [14, 3]]],
      4: [[[0, 0], [8, 1], [4, 2], [10, 3]],
          [[1, 4], [12, 5], [11, 6], [3, 7]],
          [[6, 8], [2, 9], [7, 0], [9, 1]],
          [[5, 2], [13, 3], [14, 4]]]
    };
    function wallPlan(n) {
      return (WALL[n] || WALL[3]).map(function (col) { return col.map(function (a) { return { clip: a[0], cap: a[1] }; }); });
    }
    // which plan fits: the column with the fewest clips must never show one clip twice at once
    function wallColumns(inner, height, gap) {
      var t4 = (inner - gap * 3) / 4 * 16 / 9;
      return 3 * (t4 + gap) >= height + t4 + gap ? 4 : 3;
    }

    /* The show's wall: the 15 captioned clips sit round the phone (0, 0),
       one ring of 14 plus one above it. Styles: no repeat in a column or
       between side-by-side tiles, all ten used. */
    var NEAR = [
      [-2, -1, 5, 0], [-1, -1, 12, 1], [0, -1, 2, 2], [1, -1, 6, 3], [2, -1, 8, 4],
      [-2, 0, 3, 5], [-1, 0, 11, 6], [1, 0, 0, 7], [2, 0, 9, 8],
      [-2, 1, 1, 9], [-1, 1, 13, 0], [0, 1, 4, 1], [1, 1, 14, 4], [2, 1, 10, 2],
      [0, -2, 7, 8]
    ].map(function (a) { return { c: a[0], r: a[1], clip: a[2], cap: a[3] }; });

    /* Every cell of a cols x rows grid (both odd, centred on the phone),
       row by row, except the phone's own: a captioned clip from NEAR, or a
       cell of the field (its frame comes from cellFrame). */
    function gridPlan(cols, rows) {
      var hc = Math.floor(cols / 2), hr = Math.floor(rows / 2), out = [];
      for (var r = -hr; r <= hr; r++) for (var c = -hc; c <= hc; c++) {
        if (!c && !r) continue;
        var near = null;
        for (var k = 0; k < NEAR.length; k++) if (NEAR[k].c === c && NEAR[k].r === r) near = NEAR[k];
        out.push(near ? { c: c, r: r, clip: near.clip, cap: near.cap } : { c: c, r: r, clip: -1 });
      }
      return out;
    }

    /* The field's 1,510 frames, three pages of 32 x 17 (NO UPLOAD/stock/
       field2/build.mjs). A frame for a grid cell, never the same for two
       cells: the cells are numbered row by row inside the field's rectangle
       (fewer than n of them), and the number is multiplied by 389 mod n,
       which only reorders 0..n-1 (389 shares no factor with 1510), so
       neighbours look unrelated. */
    var ATLAS = { n: 1510, pages: 3, cols: 32, rows: 17, w: 64, h: 114 };
    var MULT = 389;
    /* The show's wall for a stage W wide and a pin pinH tall: tile size, the
       DOM grid (cols x rows, odd, enough to run past every edge), and how far
       the field may pull back (zEnd): until the screen would need more cells
       than there are frames (FC x FR is the field's half size in cells). */
    function gridSize(W, pinH) {
      var narrow = W < 700;
      var tf = Math.min(120, Math.max(56, W / (narrow ? 6.5 : 13))), tg = tf * 0.12, tfh = tf * 16 / 9;
      var cols = Math.ceil(W / (tf + tg)) + 2, rows = Math.ceil(pinH * 1.25 / (tfh + tg)) + 2;
      if (cols % 2 === 0) cols++;
      if (rows % 2 === 0) rows++;
      var zEnd = narrow ? 0.34 : 0.24, FC, FR;
      for (;;) {
        FC = Math.ceil(W / 2 / ((tf + tg) * zEnd)) + 1;
        FR = Math.ceil(pinH * 0.66 / ((tfh + tg) * zEnd)) + 2;   // +2: columns slide up to a tile apart
        if ((2 * FC + 1) * (2 * FR + 1) <= ATLAS.n || zEnd >= 1) break;
        zEnd *= 1.04;
      }
      return { tf: tf, tg: tg, tfh: tfh, cols: cols, rows: rows, zEnd: zEnd, FC: FC, FR: FR };
    }
    function cellFrame(c, r, FC, FR) {
      if (Math.abs(c) > FC || Math.abs(r) > FR) return -1;
      var idx = (r + FR) * (2 * FC + 1) + (c + FC);
      if (idx >= ATLAS.n) return -1;
      return (idx * MULT) % ATLAS.n;
    }
    function atlasCell(f) {
      var per = ATLAS.cols * ATLAS.rows, k = f % per;
      return { page: Math.floor(f / per), x: (k % ATLAS.cols) * ATLAS.w, y: Math.floor(k / ATLAS.cols) * ATLAS.h };
    }

    /* One opacity setter for every piece (T19-06 / F1). It remembers what it
       wrote so a frame does not re-write the same value; anything that hid
       an element behind its back would make that memory lie, and the wall
       stayed invisible after a jump. */
    function fade(el, o) {
      var s = o < 0.0005 ? "0" : o > 0.9995 ? "1" : o.toFixed(3);
      if (el._o !== s) { el._o = s; el.style.opacity = s; }
    }

    /* The picture follows the scroll position, eased, and never faster than
       vmax (show per second): a phone flick or a thrown scrollbar plays the
       story quickly but still readably instead of skipping beats (F11). */
    function follow(shown, target, dt, k, vmax) {
      var d = target - shown, step = d * (1 - Math.exp(-k * dt)), cap = vmax * dt;
      if (step > cap) step = cap; else if (step < -cap) step = -cap;
      return Math.abs(d - step) < 0.00002 ? target : shown + step;
    }

    /* Words on the caption track: pushed right so none sits on another,
       then pulled back from the lane's right end so the last one never
       runs off the screen (T19-14 / F12). xs are left edges, ws widths. */
    function fitInside(xs, ws, right, gap) {
      var out = xs.slice(), last = -1e9;
      for (var i = 0; i < out.length; i++) { out[i] = Math.max(out[i], last + gap); last = out[i] + ws[i]; }
      for (var j = out.length - 1; j >= 0; j--) {
        var limit = j === out.length - 1 ? right : out[j + 1] - gap;
        if (out[j] + ws[j] > limit) out[j] = limit - ws[j];
      }
      return out;
    }

    /* Autoplay (owner: "like lusion.co"; 0.71.4: back = reverse), as a
       small state machine so it can be tested without a page.
       It plays at range/secs in the direction the visitor last scrolled and
       stops at either end. It yields to the visitor (T19-01 / F2): any
       wheel, key, pointer or touch input, and every scroll it did not make
       itself, stops it at once and holds it for holdMs after the last one,
       so a smooth scroll, a key press, a link jump or a phone's momentum is
       never cut short by a write to the scroll position. A link jump
       (navigate) does not count as "the visitor scrolled the show"; with
       start it plays the show forwards from its first frame once it lands.
       tick() returns the scroll position to write, or null. */
    function autoplay(secs, holdMs) {
      var a = { on: false, dir: 1, pos: 0, expect: null, seen: -1, armed: false, hold: 0, touching: false, nav: false, start: false, paused: false, ignore: 0 };
      a.input = function (now) { a.on = false; if (now + holdMs > a.hold) a.hold = now + holdMs; };
      a.touch = function (down, now) { a.touching = down; a.input(now); };
      a.navigate = function (start, now) { a.input(now); a.nav = true; a.start = !!start; a.armed = false; };
      // a scroll position the page set itself (keeping the visitor's place): not the visitor,
      // and autoplay carries on from there
      a.own = function (st) { a.expect = st; a.seen = st; a.pos = st; };
      a.scroll = function (st, now) {
        if (a.expect !== null && Math.abs(st - a.expect) < 1.5) { a.seen = st; return false; }
        a.expect = null;
        if (now < a.ignore) { a.seen = st; return false; }
        a.input(now);
        if (!a.nav) {
          if (a.seen >= 0 && Math.abs(st - a.seen) > 0.5) a.dir = st > a.seen ? 1 : -1;
          a.armed = true;
        }
        a.seen = st;
        return true;
      };
      a.setPaused = function (on) { a.paused = on; a.on = false; if (!on) { a.armed = true; a.hold = 0; } };
      a.tick = function (now, dt, pr, st, range) {
        if (a.paused || a.touching || now < a.hold) return null;
        if (a.nav) { a.nav = false; if (a.start) { a.start = false; a.dir = 1; a.armed = true; } }
        // a "watch" lands on the show's very first frame, where pr is 0
        var atStart = a.armed && a.dir > 0 && pr > -0.003 && pr <= 0;
        if (!(pr > 0 && pr < 1) && !atStart) { a.on = false; a.armed = false; return null; }
        if (a.armed) { a.armed = false; a.on = true; a.pos = st; }
        if (!a.on) return null;
        if ((a.dir > 0 && pr >= 0.995) || (a.dir < 0 && pr <= 0.004)) { a.on = false; return null; }
        a.pos += a.dir * (range / secs) * Math.min(dt, 0.05);
        a.expect = a.pos;
        return a.pos;
      };
      // still has work to do (a paused autoplay has none, however armed it is)
      a.busy = function () { return !a.paused && (a.on || a.armed || a.nav); };
      // back on the home screen (F13): nothing plays until the visitor scrolls
      a.reset = function (now) {
        a.on = false; a.armed = false; a.nav = false; a.start = false; a.dir = 1; a.seen = -1; a.expect = null;
        a.hold = 0; a.touching = false; a.ignore = now + 400;
      };
      return a;
    }

    return { CAPS: CAPS, N_CLIPS: N_CLIPS, WALL: WALL, NEAR: NEAR, ATLAS: ATLAS, MULT: MULT,
      wallPlan: wallPlan, wallColumns: wallColumns, gridSize: gridSize, gridPlan: gridPlan, cellFrame: cellFrame, atlasCell: atlasCell,
      fade: fade, follow: follow, fitInside: fitInside, autoplay: autoplay };
  })();
  if (typeof module !== "undefined" && module.exports) module.exports = Logic;
  if (typeof document === "undefined") return;

  var home = document.getElementById("screen-home");
  if (!home) return;
  var root = home.querySelector(".lp-root") || home;
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  var coarse = window.matchMedia("(pointer: coarse)");
  var fade = Logic.fade, CAPS = Logic.CAPS, ATLAS = Logic.ATLAS;
  var paused = false;   // the visitor's pause button (.lp-motion)
  var onHome = function () { return document.body.dataset.screen === "home"; };

  /* ── the shorts ──
     Real footage (0.70.0): free Pexels stock, edited in NO UPLOAD/stock/make.mjs
     (one grade, stabilised, seamless 3.2 s loops, 320x568). Each has a poster
     (v.webp, shown at once) and a loop (v.mp4) that only plays while on
     screen, never with reduced motion, data saver, a hidden tab or the
     pause button. Captions are what the clip shows, written the way
     creators caption; no names, counts or likes. */
  var MEDIA = "site/wall/";
  var SHORTS = [
    { t: "he finally landed it", hi: 2, v: "skate" },
    { t: "dinner in 10 minutes", hi: 2, v: "cook" },
    { t: "first time baking these", hi: 2, v: "cupcake" },
    { t: "we learned it in a day", hi: 3, v: "dance" },
    { t: "the drop was unreal", hi: 1, v: "fest" },
    { t: "wrote this last night", hi: 0, v: "guitar" },
    { t: "day 3 on the trail", hi: 1, v: "hike" },
    { t: "100 shots before school", hi: 1, v: "hoop" },
    { t: "my first latte heart", hi: 3, v: "latte" },
    { t: "painting every single day", hi: 2, v: "paint" },
    { t: "best beach day ever", hi: 1, v: "picnic" },
    { t: "meet the new puppy", hi: 3, v: "puppy" },
    { t: "biggest wave so far", hi: 1, v: "surf" },
    { t: "ride to work with me", hi: 0, v: "bike" },
    { t: "one more try", hi: 2, v: "laugh" }
  ];
  // data saver is read every time (T19-16): it can be switched while the page is open
  function saveData() { var c = navigator.connection; return !!(c && c.saveData); }
  // loops play only while they are on screen (and the home page is showing)
  var playing = [];
  var watch = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { e.target._seen = e.isIntersecting && e.intersectionRect.height > 0; tend(e.target); });
  }, { root: home, rootMargin: "0px" }) : null;
  function canPlay() { return !still.matches && !paused && !saveData() && !document.hidden && onHome(); }
  function tend(v) {
    // _gate false: on screen only in the geometric sense (the show's phone before it appears)
    if ((watch ? v._seen : true) && v._gate !== false && canPlay()) {
      if (!v.src) v.src = v.dataset.src;
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
    } else if (!v.paused) v.pause();
  }
  function tendAll() { playing.forEach(tend); }
  function loop(src, poster) {
    var v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
    v.preload = "none"; v.poster = poster; v.dataset.src = src;
    playing.push(v);
    if (watch) watch.observe(v);
    return v;
  }
  function short(i, cap, moving) {
    var s = SHORTS[i];
    var el = document.createElement("div");
    el.className = "lp-short has-media " + CAPS[cap];
    el.style.backgroundImage = "url(" + MEDIA + s.v + ".webp)";
    if (moving) el.appendChild(loop(MEDIA + s.v + ".mp4", MEDIA + s.v + ".webp"));
    var capEl = document.createElement("div");
    capEl.className = "lp-short-cap";
    s.t.split(" ").forEach(function (w, k) {
      var sp = document.createElement("span");
      sp.textContent = w;
      if (k === s.hi) sp.className = "hi";
      capEl.appendChild(sp);
      capEl.appendChild(document.createTextNode(" "));
    });
    var bar = document.createElement("i");
    bar.className = "lp-short-bar";
    bar.style.setProperty("--done", (20 + ((i * 37) % 70)) + "%");
    el.appendChild(capEl);
    el.appendChild(bar);
    return el;
  }
  function forget(scope) {
    playing = playing.filter(function (v) {
      if (!scope.contains(v)) return true;
      if (watch) watch.unobserve(v);
      v.pause(); v.removeAttribute("src");
      return false;
    });
  }
  if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener("change", tendAll);
  document.addEventListener("visibilitychange", tendAll);

  /* ── 1. the wall ── */
  var wall = document.getElementById("lpWall"), wallCols = 0;
  function buildWall() {
    if (!wall) return;
    var w = wall.clientWidth, h = wall.clientHeight;
    if (!w || !h) return;
    var cs = getComputedStyle(wall), gap = parseFloat(cs.columnGap) || 14;
    var inner = w - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    var n = Logic.wallColumns(inner, h, gap);
    if (n === wallCols) return;
    wallCols = n;
    forget(wall);
    wall.textContent = "";
    Logic.wallPlan(n).forEach(function (list, c) {
      var col = document.createElement("div");
      col.className = "lp-wall-col" + (c % 2 ? " is-down" : "");
      col.style.setProperty("--dur", (46 + c * 9) + "s");
      var strip = document.createElement("div");
      strip.className = "lp-wall-strip";
      // the column twice over, so the loop has no seam
      for (var rep = 0; rep < 2; rep++) list.forEach(function (it) { strip.appendChild(short(it.clip, it.cap, true)); });
      col.appendChild(strip);
      wall.appendChild(col);
    });
  }

  /* ── the pause button (T19-08 / F10): stops autoplay, the wall's drift,
     the idle float of the pieces and every loop, until pressed again ── */
  var motionBtns = Array.prototype.slice.call(home.querySelectorAll("[data-motion]"));
  function setPaused(on) {
    paused = on;
    root.classList.toggle("is-motion-paused", on);
    motionBtns.forEach(function (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = on ? "Play motion" : "Pause motion";
    });
    if (auto) auto.setPaused(on);
    tendAll();
    kick();
  }
  motionBtns.forEach(function (b) { b.addEventListener("click", function () { setPaused(!paused); }); });

  /* ── 2. the show ── */
  var show = document.getElementById("lpShow");
  var stage = document.getElementById("lpStage");
  if (!show || !stage) { buildWall(); return; }
  var pin = stage.parentNode;
  var nav = home.querySelector(".lp-nav");
  var says = Array.prototype.slice.call(show.querySelectorAll(".lp-show-say p"));
  // the blocks after the show, in page order (the visitor's place below it, see measure)
  var afterShow = Array.prototype.slice.call(home.querySelectorAll(".lp-big-row, #lpFaq .lp-h2, .lp-faq details, .lp-end, .lp-foot"));

  var CLIPS = [
    // one shoot, six takes: fold, a wait, the throw, again, a wait, made it
    { name: "IMG_4821.MOV", d: 3.2, img: "fold", keep: true },
    { name: "IMG_4822.MOV", d: 2.1, img: "wait", keep: false },
    { name: "IMG_4825.MOV", d: 3.8, img: "throw", keep: true },
    { name: "IMG_4827.MOV", d: 2.6, img: "again", keep: true },
    { name: "IMG_4830.MOV", d: 2.4, img: "idle", keep: false },
    { name: "IMG_4831.MOV", d: 2.9, img: "made", keep: true }
  ];
  var WORDS = [
    { w: "fold it", clip: 0, keep: true }, { w: "right", clip: 0, keep: true },
    { w: "um", clip: 1, keep: false },
    { w: "and throw", clip: 2, keep: true }, { w: "nope", clip: 2, keep: true },
    { w: "one more", clip: 3, keep: true },
    { w: "like", clip: 4, keep: false },
    { w: "made it!", clip: 5, keep: true }
  ];
  var RAW = CLIPS.reduce(function (a, c) { return a + c.d; }, 0);
  var KEPT = CLIPS.reduce(function (a, c) { return a + (c.keep ? c.d : 0); }, 0);
  /* Where each piece floats in the raw beat (F17): placed by hand so no
     label lies on another, as fractions of the stage (x, y of the top
     left) and a slight tilt. Wide stages and narrow ones differ. */
  var LOOSE = {
    wide: {
      clips: [[0.06, 0.08, -6], [0.29, 0.56, 5], [0.56, 0.06, 4], [0.81, 0.30, -5], [0.09, 0.60, 6], [0.62, 0.57, -4]],
      words: [[0.21, 0.36, -4], [0.34, 0.32, 3], [0.46, 0.42, -6], [0.57, 0.36, 2], [0.73, 0.12, 5], [0.79, 0.64, -3], [0.05, 0.42, 4], [0.47, 0.66, -2]],
      bars: [[0.24, 0.10, -3], [0.36, 0.82, 2]]
    },
    narrow: {
      clips: [[0.04, 0.03, -6], [0.56, 0.03, 5], [0.30, 0.30, 4], [0.06, 0.56, -5], [0.70, 0.29, 6], [0.50, 0.56, -4]],
      words: [[0.04, 0.32, -4], [0.72, 0.08, 3], [0.52, 0.33, -6], [0.22, 0.58, 2], [0.84, 0.36, 5], [0.24, 0.70, -3], [0.68, 0.60, 4], [0.08, 0.86, -2]],
      bars: [[0.22, 0.06, -3], [0.62, 0.80, 2]]
    }
  };

  function mk(cls, html) {
    var el = document.createElement("div");
    el.className = cls;
    if (html != null) el.innerHTML = html;
    stage.appendChild(el);
    return el;
  }
  function wave(n, seed) {
    var h = "";
    for (var i = 0; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var v = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55) * 0.6 + (seed / 233280) * 0.4);
      h += '<i style="height:' + Math.round(v * 100) + '%"></i>';
    }
    return h;
  }

  // lanes and ruler, under everything
  var lanes = ["text", "video", "voice", "music"].map(function (k) { return mk("lp-lane lp-lane-" + k); });
  var ruler = mk("lp-ruler");
  var marks = [];
  for (var s = 0; s <= 16; s += 2) {
    var m = document.createElement("span");
    if (s % 4) m.className = "is-odd";
    m.textContent = "00:" + (s < 10 ? "0" : "") + s;
    m._s = s;
    ruler.appendChild(m); marks.push(m);
  }
  var clipEls = CLIPS.map(function (c) {
    return mk("lp-clip", "<b>" + c.name + "</b><em>0:0" + Math.round(c.d) + "</em>");
  });
  clipEls.forEach(function (el, i) { el.style.backgroundImage = "linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0) 48%), url(site/story/" + CLIPS[i].img + ".webp)"; });
  var wordEls = WORDS.map(function (w) { return mk("lp-word" + (w.keep ? "" : " is-filler"), w.w); });
  var voice = mk("lp-voice", '<span>Voice</span><div class="lp-wave">' + wave(90, 7) + "</div>");
  var music = mk("lp-music", '<span>Music</span><div class="lp-wave">' + wave(70, 31) + "</div>");
  var playhead = mk("lp-playhead");
  var phone = mk("lp-phone-f");
  var phoneScreen = document.createElement("div");
  phoneScreen.className = "lp-phone-s";
  phone.appendChild(phoneScreen);
  // the finished short: the five best moments of the shoot, cut and graded (story/short.mp4)
  var heroShort = document.createElement("div");
  heroShort.className = "lp-short has-media is-hero";
  heroShort.style.backgroundImage = "url(site/story/short.webp)";
  var shortVid = loop("site/story/short.mp4", "site/story/short.webp");
  shortVid._gate = false;   // plays only once its phone is on screen (T19-10)
  heroShort.appendChild(shortVid);
  heroShort.insertAdjacentHTML("beforeend", '<div class="lp-short-cap"><span class="lp-live"></span></div>');
  phoneScreen.appendChild(heroShort);
  var live = heroShort.querySelector(".lp-live");
  // the caption the finished short is playing, cut with its own shots
  // (make.mjs: 2.3 / 2.4 / 2.2 / 2.6 / 2.5 s); driven by the video, not the frame loop
  function showLine() {
    var vt = shortVid.currentTime || 0;
    var line = shortVid.paused && !vt ? "ONE MORE TRY" : vt < 2.3 ? "FOLD IT" : vt < 4.7 ? "AND THROW" : vt < 6.9 ? "ONE MORE TRY" : "MADE IT";
    if (live.textContent !== line) live.textContent = line;
  }
  if (shortVid.requestVideoFrameCallback) {
    var onVideoFrame = function () { showLine(); shortVid.requestVideoFrameCallback(onVideoFrame); };
    shortVid.requestVideoFrameCallback(onVideoFrame);
  } else shortVid.addEventListener("timeupdate", showLine);
  shortVid.addEventListener("seeked", showLine);
  showLine();

  var tiles = [], atlasTiles = [], builtCols = 0, builtRows = 0;
  var FC = 1, FR = 1;   // the field's half width and half height in cells, set in layout()
  /* The field's footage (0.71.3): 1,510 different videos, one frame each
     (free Pexels stock; NO UPLOAD/stock/field2/build.mjs drops siblings from
     one shoot and any picture that looks like another), packed in three
     pages of 64x114 frames, none over 2048 px (T21: one 2560x4332 sheet
     froze the show for ~150 ms twice while it decoded). Fetched when the
     visitor nears the field, decoded off the main thread
     (createImageBitmap), and drawn into the tiles' own canvases, so no
     paint ever waits for a decode. The 15 captioned clips are not in it. */
  var pages = [], pagesReady = 0, atlasAwake = false;
  function wakeAtlas() {
    if (atlasAwake) return;
    atlasAwake = true;
    for (var i = 0; i < ATLAS.pages; i++) loadPage(i);
  }
  function loadPage(i) {
    var src = "site/field-" + i + ".webp";
    var done = function (img) {
      pages[i] = img; pagesReady++;
      atlasTiles.forEach(function (el) { if (el._page === i) paintAtlasTile(el); });
      fieldKey = ""; kick();
    };
    var viaImage = function () {
      var img = new Image();
      img.decoding = "async";
      img.src = src;
      (img.decode ? img.decode() : new Promise(function (ok, no) { img.onload = ok; img.onerror = no; }))
        .then(function () { done(img); }).catch(function () {});
    };
    if (window.createImageBitmap && window.fetch) {
      fetch(src).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(function (b) { return createImageBitmap(b); }).then(done).catch(viaImage);
    } else viaImage();
  }
  /* Sets a field tile's frame; the drawing itself waits in a queue that the
     frame loop empties a few tiles at a time, so a page arriving never
     costs one long frame for a hundred canvases. */
  var paintQueue = [];
  function paintAtlasTile(el) {
    var f = Logic.cellFrame(el._c, el._r, FC, FR);
    el._f = f;
    if (f < 0) return;
    var a = Logic.atlasCell(f);
    el._page = a.page;
    if (el._painted === f) return;
    if (!pages[a.page]) { if (el._painted !== -1) { el._ctx.clearRect(0, 0, ATLAS.w, ATLAS.h); el._painted = -1; } return; }
    if (!el._queued) { el._queued = true; paintQueue.push(el); }
  }
  function drainPaints(n) {
    while (n-- > 0 && paintQueue.length) {
      var el = paintQueue.shift();
      el._queued = false;
      if (!el.isConnected || el._f < 0) continue;
      var a = Logic.atlasCell(el._f), img = pages[a.page];
      if (!img) continue;
      el._ctx.drawImage(img, a.x, a.y, ATLAS.w, ATLAS.h, 0, 0, ATLAS.w, ATLAS.h);
      el._painted = el._f;
    }
  }
  function atlasTile() {
    var el = document.createElement("div");
    el.className = "lp-short lp-atlas";
    var cv = document.createElement("canvas");
    cv.width = ATLAS.w; cv.height = ATLAS.h;
    el.appendChild(cv);
    el._ctx = cv.getContext("2d");
    el._painted = -1;
    atlasTiles.push(el);
    return el;
  }
  /* The show's wall, rebuilt whenever its grid changes size (T19-05 / F6):
     every tile's place, kind and frame are set together, so after a resize
     or rotation the captioned clips are still round the phone and no
     frame is used twice. */
  function buildTiles(cols, rows) {
    tiles.forEach(function (el) { el.remove(); });
    tiles = []; atlasTiles = [];
    Logic.gridPlan(cols, rows).forEach(function (cell, i) {
      var el = cell.clip >= 0 ? short(cell.clip, cell.cap, false) : atlasTile();
      el.classList.add("lp-tile");
      el._c = cell.c; el._r = cell.r; el._i = i; el._atlas = cell.clip < 0;
      stage.insertBefore(el, phone);
      tiles.push(el);
    });
    builtCols = cols; builtRows = rows;
  }

  /* ── maths ── */
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var ease = function (x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  var mix = function (a, b, k) { return a + (b - a) * k; };
  var span = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };

  var W = 0, H = 0, L = null;
  /* Measures everything once (sizes, word widths, the grid) so a frame only
     writes. Returns false while the home screen is hidden: a hidden stage
     measures zero and must not leave a broken layout behind (T19-03). */
  function layout() {
    var W0 = stage.clientWidth, H0 = stage.clientHeight;
    if (!W0 || !H0) { L = null; return false; }
    W = W0; H = H0;
    var pinW = pin.clientWidth, pinH = pin.clientHeight;
    var narrow = W < 700, portrait = pinH > pinW * 1.1;
    var tlX = W * (narrow ? 0.04 : 0.08), tlW = W - tlX * 2;
    // tall screens (phones, tablets upright) give the timeline more of their height (F23)
    var vh = portrait ? clamp(H * 0.24, 48, 170) : clamp(H * 0.17, 48, 130);
    var th = portrait ? clamp(H * 0.09, 26, 56) : clamp(H * 0.075, 26, 52);
    var ah = portrait ? clamp(H * 0.13, 34, 96) : clamp(H * 0.1, 34, 76);
    var gap = clamp(H * 0.016, 6, 14);
    var top = (H - (th + vh + ah * 2 + gap * 3)) / 2 + 14;   // the timeline sits in the middle
    stage.style.setProperty("--th", th.toFixed(1) + "px");
    var y = { ruler: top - 26, text: top, video: top + th + gap, voice: top + th + vh + gap * 2, music: top + th + vh + ah + gap * 3 };
    var pH = H * 0.96, pW = Math.min(pH * 9 / 19.5, W * 0.7); pH = pW * 19.5 / 9;
    // the wall and the field (Logic.gridSize); the tiles are rebuilt when the grid changes
    var gs = Logic.gridSize(W, pinH);
    var tf = gs.tf, tg = gs.tg, tfh = gs.tfh, cols = gs.cols, rows = gs.rows, zEnd = gs.zEnd;
    FC = gs.FC; FR = gs.FR;
    if (cols !== builtCols || rows !== builtRows) buildTiles(cols, rows);
    atlasTiles.forEach(paintAtlasTile);   // the field's rectangle may have changed size
    // the words' widths, read once here, never in a frame (a read after a write forces a layout)
    var wordW = wordEls.map(function (el) { return el.offsetWidth; });
    var sumW = wordW.reduce(function (a, b) { return a + b; }, 0);
    var ws = Math.min(narrow ? 0.7 : 1, (tlW * 0.98 - 4 * (WORDS.length - 1)) / sumW);
    L = { narrow: narrow, tlX: tlX, tlW: tlW, vh: vh, th: th, ah: ah, y: y, pps: tlW / RAW, pW: pW, pH: pH, px: (W - pW) / 2, py: (H - pH) / 2,
      tf: tf, tg: tg, tfh: tfh, cols: cols, rows: rows, zEnd: zEnd, wordW: wordW, ws: ws, oy: stage.offsetTop, fw: pinW, fh: pinH,
      // the loose pieces' float, smaller on a short stage (a phone on its side) so they never touch
      bob: clamp(H / 60, 3, 10) / 10 };
    // full screen, the caption keeps the size it has on a 9:16 short of the pin's height
    heroShort.style.setProperty("--capmax", (Math.min(pinW, pinH * 9 / 16) * 0.115).toFixed(1) + "px");
    fade(ruler, 0); lanes.forEach(function (el) { fade(el, 0); });
    lanes[0].style.cssText = box(tlX, y.text, tlW, th);
    lanes[1].style.cssText = box(tlX, y.video, tlW, vh);
    lanes[2].style.cssText = box(tlX, y.voice, tlW, ah);
    lanes[3].style.cssText = box(tlX, y.music, tlW, ah);
    ruler.style.cssText = box(tlX, y.ruler, tlW, 20);
    lanes.concat([ruler]).forEach(function (el) { el._o = null; });
    marks.forEach(function (mk2) { mk2._t = null; mk2._o = null; });
    // where each piece starts, loose in the air (F17)
    var lz = LOOSE[narrow ? "narrow" : "wide"];
    var at = function (a) { return { x: W * a[0], y: H * a[1], r: a[2] }; };
    L.loose = { clips: lz.clips.map(at), words: lz.words.map(at), bars: lz.bars.map(at) };
    // the field's canvas, at the pin's size
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    field.width = Math.round(pinW * dpr); field.height = Math.round(pinH * dpr);
    fx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fieldKey = "";
    navH = nav ? nav.offsetHeight : 0;
    return true;
  }
  function box(x, y, w, h) { return "transform:translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px);width:" + w.toFixed(1) + "px;height:" + h.toFixed(1) + "px;"; }

  function place(el, x, y, w, h, r, sc, o) {
    var tr = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) rotate(" + (r || 0).toFixed(2) + "deg) scale(" + (sc == null ? 1 : sc).toFixed(3) + ")";
    if (el._t !== tr) { el._t = tr; el.style.transform = tr; }
    // size only when it changes: a width or height write costs a layout, a transform does not
    if (w != null) { var wv = w.toFixed(1); if (el._w !== wv) { el._w = wv; el.style.width = wv + "px"; } }
    if (h != null) { var hv = h.toFixed(1); if (el._h !== hv) { el._h = hv; el.style.height = hv + "px"; } }
    fade(el, o == null ? 1 : o);
  }

  var clock = 0;      // ms of motion time; it stands still while paused
  /* The ending (0.70.2): the show is longer (760vh, was 560vh). The original
     story keeps its pace in the first 74% (p = pAll x STRETCH); the rest is
     the pull-back, the wall shrinking into a field of hundreds of videos, the
     far ones drawn on one canvas so it stays smooth. */
  var STRETCH = 760 / 560;
  // the reduced-motion picture: the cut has happened, the timeline is still there
  var STILL_P = 0.545, STILL_ALL = STILL_P / STRETCH;
  var field = document.createElement("canvas");
  field.className = "lp-field";
  field.setAttribute("aria-hidden", "true");
  pin.insertBefore(field, stage);
  var fx = field.getContext("2d"), fieldKey = "", navH = 60, stageWall = false, phoneShown = false;

  /* Draws the show at progress pAll (0..1 through the section). Returns
     whether anything on screen moves with time alone (the pieces floating
     before they land, the wall's slight float), so the loop can stop when
     nothing does. */
  function render(pAll, sayIndex) {
    var p = Math.min(1, pAll * STRETCH);
    var tail = ease(span(pAll, 0.70, 0.97));
    var t = clock / 1000, timed = false;
    var fold = ease(span(p, 0.58, 0.7));   // the timeline folding into the phone
    var cut = ease(span(p, 0.42, 0.54));
    var cx = W / 2, cy = L.py + L.pH / 2;
    // toward the phone's centre, shrinking, as the fold happens
    function folded(x, y, w, h) {
      return { x: mix(x, cx - w * 0.1, fold), y: mix(y, cy - h * 0.1, fold), s: mix(1, 0.2, fold), o: 1 - span(fold, 0.5, 1) };
    }

    // tracks, and the ruler: it reads the raw 17 s, then the kept 12.5 s once the cut closes up (F20)
    var lane = ease(span(p, 0.1, 0.24)) * (1 - span(fold, 0.2, 0.7));
    lanes.forEach(function (el) { fade(el, lane); });
    fade(ruler, lane);
    if (lane > 0) {
      var secs = mix(RAW, KEPT, cut);
      marks.forEach(function (el) {
        var x = el._s / secs * L.tlW, tr = "translate(" + x.toFixed(1) + "px,0) translateX(-50%)";
        if (el._t !== tr) { el._t = tr; el.style.transform = tr; }
        fade(el, x <= L.tlW + 1 ? 1 : 0);
      });
    }

    // clips: loose, then in place, then closed up
    var before = 0, kept = 0;
    CLIPS.forEach(function (c, i) {
      var el = clipEls[i], w = c.d * L.pps;
      var lo = L.loose.clips[i];
      var fly = ease(span(p, 0.12 + i * 0.02, 0.3 + i * 0.02));
      var sx = L.tlX + before * L.pps, sy = L.y.video;
      var ex = L.tlX + kept * L.pps;
      var bob = (1 - fly) * Math.sin(t * 1.1 + i) * 8 * L.bob;
      var x = mix(lo.x, sx, fly), y = mix(lo.y + bob, sy, fly);
      var o = 1, r = mix(lo.r, 0, fly), sc = mix(0.8, 1, fly);
      if (c.keep) x = mix(x, ex, cut);
      else { y += cut * L.vh * 1.4; r += cut * 8; o = 1 - cut; }
      var f = folded(x, y, w, L.vh);
      if (fly < 1 && o * f.o > 0) timed = true;
      place(el, f.x, f.y, mix(w * 0.9, w, fly), L.vh, r, sc * f.s, o * f.o);
      before += c.d; if (c.keep) kept += c.d;
    });

    // spoken words: loose, then onto the text track over their clip, filler drops out
    var starts = [], acc = 0, accK = 0, startsK = [];
    CLIPS.forEach(function (c) { starts.push(acc); startsK.push(accK); acc += c.d; if (c.keep) accK += c.d; });
    var perClip = {}, ws = L.ws, wx = [], wy = [], wo = [], wr = [], track = [];
    WORDS.forEach(function (wd, i) {
      var n = perClip[wd.clip] = (perClip[wd.clip] || 0) + 1;
      var lo = L.loose.words[i];
      var fly = ease(span(p, 0.16 + i * 0.018, 0.34 + i * 0.018));
      var sx = L.tlX + (starts[wd.clip] + (n - 1) * 1.4 + 0.15) * L.pps;
      var ex = L.tlX + (startsK[wd.clip] + (n - 1) * 1.4 + 0.15) * L.pps;
      var bob = (1 - fly) * Math.sin(t * 1.4 + i * 2) * 10 * L.bob;
      var x = mix(lo.x, sx, fly), y = mix(lo.y + bob, L.y.text + 2, fly), o = 1;
      if (wd.keep) x = mix(x, ex, cut);
      else { y -= cut * 30; o = 1 - cut; }
      if (fly < 1) timed = true;
      wx[i] = x; wy[i] = y; wo[i] = o; wr[i] = mix(lo.r * 0.6, 0, fly);
      // once on the track, a word never sits on top of another or off the lane's end
      if (fly > 0.9 && o > 0.5) track.push(i);
    });
    var fit = Logic.fitInside(track.map(function (i) { return wx[i]; }), track.map(function (i) { return L.wordW[i] * ws; }), L.tlX + L.tlW, 4);
    track.forEach(function (i, k) { wx[i] = fit[k]; });
    WORDS.forEach(function (wd, i) {
      var f = folded(wx[i], wy[i], 60, L.th);
      place(wordEls[i], f.x, f.y, null, L.th - 4, wr[i], ws * f.s, wo[i] * f.o);
    });

    // voice and song: one each, they stretch onto their tracks, then fit the kept length
    [[voice, L.y.voice], [music, L.y.music]].forEach(function (a, k) {
      var lo = L.loose.bars[k];
      var fly = ease(span(p, 0.2 + k * 0.04, 0.38 + k * 0.04));
      var bob = (1 - fly) * Math.sin(t + k * 3) * 9 * L.bob;
      var w = mix(L.tlW * 0.3, L.tlW, fly) * mix(1, KEPT / RAW, cut);
      var x = mix(lo.x, L.tlX, fly), y = mix(lo.y + bob, a[1], fly);
      var f = folded(x, y, w, L.ah);
      if (fly < 1) timed = true;
      place(a[0], f.x, f.y, w, L.ah, mix(lo.r, 0, fly), f.s, f.o);
    });

    // the playhead appears once the timeline is built and runs only with the cut (F14):
    // no time loop, no jumps, it ends where the kept edit ends
    var ph = span(p, 0.3, 0.58);
    var phx = L.tlX + ph * mix(RAW, KEPT, cut) * L.pps;
    place(playhead, phx, L.y.ruler, 2, L.y.music + L.ah - L.y.ruler, 0, 1, lane * span(p, 0.26, 0.3));

    // the phone: grows out of the fold, then becomes one tile of the wall
    var ph1 = ease(span(p, 0.6, 0.72));
    var wallK = ease(span(p, 0.76, 0.94));
    var tw = L.tf, thh = L.tfh, g = L.tg;
    // the wall settles back as it fills, then keeps pulling away into the field
    var zoom = mix(1.3, 1, wallK) * mix(1, L.zEnd, tail);
    var drift = function (col) { return (col % 2 ? 1 : -1) * tail * thh * 0.9; };   // neighbouring columns slide apart
    // 0.82.1 (owner: "full screen not framed"): the finished short fills the
    // whole pin, no phone bezel, then shrinks into its tile of the wall
    var pw = mix(L.fw, tw, wallK), phh = mix(L.fh, thh, wallK);
    var pcx = mix(L.fw / 2, cx, wallK), pcy = mix(L.fh / 2 - L.oy, cy, wallK);
    var pS = mix(0.55, 1, ph1);
    var pz = wallK > 0 ? zoom : 1;
    place(phone, pcx - pw * pS * pz / 2, pcy - phh * pS * pz / 2 + drift(0) * pz, pw, phh, 0, pS * pz, ph1);
    phone.classList.toggle("is-tile", wallK > 0.5);
    // the finished short plays only while its phone is on screen, from its first shot (T19-10)
    var phoneOn = ph1 > 0.02;
    if (phoneOn !== phoneShown) {
      phoneShown = phoneOn;
      if (phoneOn) { try { shortVid.currentTime = 0; } catch (e) {} }
      shortVid._gate = phoneOn;
      tend(shortVid);
    }

    // the wall: tiles arrive from the phone's place outward, the whole wall zooms out
    tiles.forEach(function (el) {
      var col = el._c, row = el._r;
      var dist = Math.sqrt(col * col + row * row);
      var k = ease(span(wallK, Math.min(0.5, dist * 0.05), Math.min(0.5, dist * 0.05) + 0.4));
      if (k <= 0 || (el._atlas && el._f < 0)) { fade(el, 0); return; }
      var x = cx - tw / 2 + col * (tw + g), y = cy - thh / 2 + row * (thh + g);
      var bob = Math.sin(t * 0.6 + el._i) * 4 * k * (1 - tail);
      if (tail < 1) timed = true;
      place(el, cx + (x - cx) * zoom, cy + (y + bob + drift(col) - cy) * zoom, tw, thh, 0, zoom * mix(0.6, 1, k), k);
    });
    // only the pieces in motion are layers, and only while they move (F16)
    var wallLive = wallK > 0 && tail < 1;
    if (wallLive !== stageWall) { stageWall = wallLive; stage.classList.toggle("is-wall", wallLive); }

    // the field: every cell beyond the DOM tiles, on one canvas, redrawn only when it changes (F5)
    var fa = ease(span(pAll, 0.66, 0.76));
    var key = fa > 0 ? [zoom.toFixed(5), tail.toFixed(5), fa.toFixed(3), L.fw, L.fh, pagesReady, L.cols, L.rows].join() : "off";
    if (key !== fieldKey) {
      fieldKey = key;
      fx.clearRect(0, 0, L.fw, L.fh);
      if (fa > 0) {
        var hc = Math.floor(L.cols / 2), hr = Math.floor(L.rows / 2);
        var sx2 = (tw + g) * zoom, sy2 = (thh + g) * zoom, w0 = tw * zoom, h0 = thh * zoom;
        var nc = Math.ceil(W / 2 / sx2) + 2, nr = Math.ceil(L.fh / sy2) + 3;
        // cells sorted by page: three image switches per redraw instead of one per cell
        var byPage = [[], [], []], empty = [];
        for (var c2 = -nc; c2 <= nc; c2++) {
          var dy = drift(c2) * zoom;
          for (var r2 = -nr; r2 <= nr; r2++) {
            if (Math.abs(c2) <= hc && Math.abs(r2) <= hr) continue;   // a DOM tile is there
            var X = cx + c2 * sx2 - w0 / 2, Y = L.oy + cy + r2 * sy2 - h0 / 2 + dy;
            if (X > L.fw || X + w0 < 0 || Y > L.fh || Y + h0 < 0) continue;
            var fr = Logic.cellFrame(c2, r2, FC, FR);
            if (fr < 0) continue;
            var a = Logic.atlasCell(fr);
            (pages[a.page] ? byPage[a.page] : empty).push(a.x, a.y, X, Y);
          }
        }
        fx.globalAlpha = fa;
        fx.fillStyle = "#1c1c1c";
        for (var e = 0; e < empty.length; e += 4) fx.fillRect(empty[e + 2], empty[e + 3], w0, h0);
        byPage.forEach(function (list, pg) {
          for (var q = 0; q < list.length; q += 4) fx.drawImage(pages[pg], list[q], list[q + 1], ATLAS.w, ATLAS.h, list[q + 2], list[q + 3], w0, h0);
        });
        fx.globalAlpha = 1;
      }
    }

    // the words on screen
    var idx = sayIndex != null ? sayIndex : p < 0.1 ? 0 : p < 0.36 ? 1 : p < 0.5 ? 2 : p < 0.6 ? 3 : p < 0.76 ? 4 : 5;
    says.forEach(function (el, i) { if (el.classList.contains("is-on") !== (i === idx)) el.classList.toggle("is-on", i === idx); });
    return timed;
  }

  /* ── driving it ── */
  var PLAY_SECS = 34;   // the whole show, start to end, untouched
  var auto = Logic.autoplay(PLAY_SECS, 700);
  if (paused) auto.setPaused(true);
  var visible = false, raf = 0, lastTs = 0, shown = -1, jump = true, anchor = null, lastShowH = -1;
  // softer on touch: a finger's flick arrives in bursts, a wheel in small steps
  var EASE_K, VMAX;
  function pace() { EASE_K = coarse.matches ? 7 : 12; VMAX = coarse.matches ? 0.2 : 0.35; }
  pace();
  if (coarse.addEventListener) coarse.addEventListener("change", pace);

  // where the show is: its top in the scroll box, its scroll range, the progress
  function geometry() {
    var hr = home.getBoundingClientRect(), r = show.getBoundingClientRect(), st = home.scrollTop, h = home.clientHeight;
    var T = st + r.top - hr.top, range = Math.max(1, r.height - h);
    return { st: st, T: T, showH: r.height, range: range, h: h, pr: (st - T) / range, top: r.top - hr.top, bottom: r.bottom - hr.top };
  }
  /* Remembers where the visitor is, so a resize, rotation or reduced-motion
     switch can put them back at the same moment of the show (T19-04) or at
     the same content below it. Also darkens the nav only once the show
     reaches it (F18), and fetches the field's pages on approach (T19-15). */
  function measure() {
    // a hidden home screen measures zero: keep the last real place for its return
    if (!home.clientHeight || !onHome()) return null;
    var g = geometry();
    // what is laid out, not the setting: the setting flips a moment before its change event
    var isStill = show.classList.contains("is-still");
    var stillView = isStill && g.top < g.h * 0.6 && g.bottom > navH;
    anchor = { st: g.st, T: g.T, showH: g.showH, p: isStill ? null : g.pr, stillView: stillView, below: g.top + g.showH <= navH + 1 && g.st > g.T };
    // below the show: the first block at the top of the screen, so it stays put however the page reflows
    if (anchor.below) for (var i = 0; i < afterShow.length; i++) {
      var r = afterShow[i].getBoundingClientRect();
      if (r.bottom > navH) { anchor.el = afterShow[i]; anchor.elTop = r.top; break; }
    }
    var cinema = g.top <= navH && g.bottom > navH;
    if (document.body.classList.contains("lp-cinema") !== cinema) document.body.classList.toggle("lp-cinema", cinema);
    if (!still.matches && g.pr > 0.3 && g.pr < 1.05) wakeAtlas();
    return g;
  }
  function setScroll(st) {
    st = Math.max(0, Math.round(st));
    auto.own(st);
    home.scrollTop = st;
    auto.own(home.scrollTop);
  }
  /* Called at the first event that sees the show's new height (the window's
     resize, the scroll event the browser sends with it, or the size
     observer, whichever comes first), before anything re-measures.
     Returns true when it moved the page. */
  function keepPlace() {
    var h = show.offsetHeight;
    if (h === lastShowH) return false;
    var first = lastShowH < 0;
    lastShowH = h;
    if (first) return false;
    return restorePlace();
  }
  // back to the remembered moment of the show, or the remembered block below it
  function restorePlace() {
    if (!anchor || !show.offsetHeight || !home.clientHeight || !onHome() || show.classList.contains("is-still")) return false;
    var g = geometry(), moved = false;
    if (anchor.p != null && anchor.p > 0 && anchor.p < 1) { setScroll(g.T + g.range * anchor.p); moved = true; }
    else if (anchor.below && anchor.el) { belowPlace(anchor); moved = true; }
    jump = true;
    measure();
    return moved;
  }
  function belowPlace(before) {
    if (before && before.below && before.el) setScroll(home.scrollTop + before.el.getBoundingClientRect().top - before.elTop);
  }

  function frame(ts) {
    raf = 0;
    if (still.matches || !onHome()) { lastTs = 0; return; }
    if (!L && !layout()) { lastTs = 0; return; }
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 1 / 60;
    lastTs = ts;
    if (!paused) clock += dt * 1000;
    var g = geometry();
    var w = auto.tick(ts, dt, g.pr, g.st, g.range);
    var pr = g.pr;
    if (w != null) { home.scrollTop = w; pr = (w - g.T) / g.range; }
    var target = clamp(pr, 0, 1);
    // jumps the visitor asked for (a link, a resize, coming back) snap; anything else is followed
    if (shown < 0 || ((jump || auto.nav) && Math.abs(target - shown) > 0.08)) shown = target;
    else shown = Logic.follow(shown, target, dt, EASE_K, VMAX);
    jump = false;
    drainPaints(12);
    var timed = render(shown);
    var busy = shown !== target || auto.busy() || paintQueue.length > 0;
    if (visible && !document.hidden && (busy || (timed && !paused))) raf = requestAnimationFrame(frame);
    else lastTs = 0;
  }
  function kick() { if (!raf && !still.matches) raf = requestAnimationFrame(frame); }

  // the one still picture for reduced motion (T19-07 / F3): drawn here only, never by the loop
  function drawStill() {
    if (!L && !layout()) return;
    clock = 0;
    render(STILL_ALL, 2);
  }
  function settle(first) {
    var before = anchor;
    var nowStill = still.matches;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    // after a switch either way nothing plays until the visitor scrolls again
    if (!first) auto.reset(performance.now());
    show.classList.toggle("is-still", nowStill);
    lastShowH = show.offsetHeight;   // this height change is handled here, not by keepPlace
    if (!first && before && home.clientHeight) {
      var g = geometry();
      if (nowStill && before.p != null && before.p > 0 && before.p < 1) setScroll(g.T - navH);
      else if (!nowStill && before.stillView) setScroll(g.T + g.range * STILL_ALL);
      else belowPlace(before);
    }
    L = null;
    layout();
    if (nowStill) drawStill(); else { jump = true; kick(); }
    if (home.clientHeight) measure();
    tendAll();
  }

  /* ── listening ── */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      var e = es[es.length - 1];
      visible = e.isIntersecting && e.intersectionRect.height > 0;
      stage.classList.toggle("is-live", visible);
      if (visible) kick();
    }, { root: home, threshold: [0, 0.001] }).observe(show);
  } else { visible = true; stage.classList.add("is-live"); }
  /* Sizes are watched on the elements themselves (T19-03): a resize while
     the home screen is hidden measures nothing, and the stage reports its
     real size again when the home screen comes back. The show's own height
     changing (a rotation, a resize) keeps the visitor's place first. */
  function relayout() { if (layout()) { jump = true; if (still.matches) drawStill(); else kick(); } }
  if ("ResizeObserver" in window) {
    // the blocks round the show: when one changes height (a web font, a picture that
    // switches source after a rotation), the visitor's place is put back
    var around = Array.prototype.slice.call(home.querySelectorAll("#lpHero, .lp-big, #lpFaq"));
    var ro = new ResizeObserver(function (es) {
      var showChanged = false, stageChanged = false, wallChanged = false, aroundChanged = false;
      es.forEach(function (e) {
        if (e.target === show) showChanged = true;
        else if (e.target === stage) stageChanged = true;
        else if (e.target === wall) wallChanged = true;
        else aroundChanged = true;
      });
      if (wallChanged) buildWall();
      if (showChanged) keepPlace();
      else if (aroundChanged) restorePlace();
      if (stageChanged) relayout();
    });
    ro.observe(show); ro.observe(stage);
    if (wall) ro.observe(wall);
    around.forEach(function (el) { ro.observe(el); });
  } else {
    window.addEventListener("resize", function () { buildWall(); relayout(); });
  }
  // a width-only resize leaves the show's height alone but can reflow what is below it
  window.addEventListener("resize", function () {
    if (!onHome() || !home.clientHeight) return;
    if (!keepPlace() && anchor && anchor.below) { belowPlace(anchor); measure(); }
  });

  home.addEventListener("scroll", function () {
    if (!onHome() || !home.clientHeight) return;
    // the scroll event a resize or rotation sends is the browser's, not the visitor's
    if (show.offsetHeight !== lastShowH && keepPlace()) { kick(); return; }
    auto.scroll(home.scrollTop, performance.now());
    measure();
    if (!still.matches) kick();
  }, { passive: true });
  // the visitor's own input: autoplay steps aside at once and waits until it settles
  var input = function () { auto.input(performance.now()); kick(); };
  home.addEventListener("wheel", input, { passive: true });
  home.addEventListener("pointerdown", input, { passive: true });
  home.addEventListener("touchstart", function () { auto.touch(true, performance.now()); }, { passive: true });
  home.addEventListener("touchend", function () { auto.touch(false, performance.now()); kick(); }, { passive: true });
  home.addEventListener("touchcancel", function () { auto.touch(false, performance.now()); kick(); }, { passive: true });
  document.addEventListener("keydown", function (e) {
    if (!onHome() || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    input();
  });
  // leaving the home screen stops autoplay; coming back starts nothing until the visitor scrolls (F13)
  new MutationObserver(function () {
    if (onHome()) { auto.reset(performance.now()); keepPlace(); jump = true; L = null; layout(); kick(); }
    else auto.reset(performance.now());
    tendAll();
  }).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { lastTs = 0; kick(); } });
  if (still.addEventListener) still.addEventListener("change", function () { settle(false); });
  // the words' widths change when the web fonts arrive
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (layout()) { if (still.matches) drawStill(); else kick(); } });

  /* Section links (landing.js) call this before they scroll: autoplay waits
     until the jump has landed, and "Watch it edit first" / "See it edit"
     then play the show forwards from its first frame (T19-02 / F8). */
  window.vcLandingShow = {
    navigate: function (startShow) { auto.navigate(!!startShow && !still.matches, performance.now()); jump = true; kick(); },
    logic: Logic
  };

  buildWall();
  settle(true);
})();
