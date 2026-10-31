/* ═══════════════════════════════════════════════════════════
   vClyps: text animations
   CapCut's three kinds, for headings: In (how a text arrives), Out (how it
   leaves) and Loop (what it does while it stays). 40 ins, 34 outs and 25
   loops, a third of them letter by letter or word by word.

   at(t, time) works out, for one frame, how the whole text and each letter
   is moved, turned, sized, faded, blurred or uncovered. app.js drawHeading
   draws from that in the preview and in the export alike, so the two can
   never differ. Distances are in text heights, turns in degrees.

   Every motion is one function of p, 0 = not there yet, 1 = settled. An In
   runs it forwards as the text arrives; an Out runs it backwards as it
   leaves, so "Rise away" is the Drop motion played out. Letter versions
   run the same motion per letter, each a little after the one before.
   Exposes window.SenotelTextAnims.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var PI2 = Math.PI * 2;

  var out3 = function (p) { return 1 - Math.pow(1 - p, 3); };
  var back = function (p) { var c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2); };
  var elastic = function (p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (PI2 / 3)) + 1;
  };
  var bounce = function (p) {
    var n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) { p -= 1.5 / d; return n * p * p + 0.75; }
    if (p < 2.5 / d) { p -= 2.25 / d; return n * p * p + 0.9375; }
    p -= 2.625 / d; return n * p * p + 0.984375;
  };
  // the same "random" number every frame for the same letter, so nothing jitters by accident
  var rnd = function (i, k) { var x = Math.sin(i * 12.9898 + (k || 0) * 78.233) * 43758.5453; return x - Math.floor(x); };

  function base() { return { a: 1, dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, kx: 0, blur: 0 }; }
  // a wipe In and a wipe Out both write o.wipe; the Out runs second, mostly
  // at p = 1, so the one that covers more wins and the In still shows
  function wipeTo(o, dir, f) { if (!o.wipe || f < o.wipe.f) o.wipe = { dir: dir, f: f }; }

  /* ─── Motions: p from 0 (gone) to 1 (in place) ─── */
  var M = {
    fade: function (o, p) { o.a *= out3(p); },
    rise: function (o, p) { var e = out3(p); o.a *= e; o.dy += (1 - e) * 0.8; },
    drop: function (o, p) { var e = out3(p); o.a *= e; o.dy -= (1 - e) * 0.8; },
    left: function (o, p) { var e = out3(p); o.a *= e; o.dx -= (1 - e) * 2.5; },
    right: function (o, p) { var e = out3(p); o.a *= e; o.dx += (1 - e) * 2.5; },
    pop: function (o, p) { o.s *= 0.4 + 0.6 * back(p); o.a *= clamp(p * 4, 0, 1); },
    zoom: function (o, p) { var e = out3(p); o.s *= 1 + (1 - e) * 0.9; o.a *= e; },
    grow: function (o, p) { var e = out3(p); o.s *= 0.15 + 0.85 * e; o.a *= e; },
    spin: function (o, p) { var e = out3(p); o.r -= (1 - e) * 120; o.s *= 0.5 + 0.5 * e; o.a *= e; },
    blur: function (o, p) { var e = out3(p); o.blur += (1 - e) * 0.35; o.a *= e; o.s *= 1 + (1 - e) * 0.08; },
    flipx: function (o, p) { var e = out3(p); o.sy *= Math.max(0.01, e); o.a *= clamp(p * 3, 0, 1); },
    flipy: function (o, p) { var e = out3(p); o.sx *= Math.max(0.01, e); o.a *= clamp(p * 3, 0, 1); },
    stretch: function (o, p) { var e = out3(p); o.sx *= 1 + (1 - e) * 1.2; o.sy *= 0.3 + 0.7 * e; o.a *= e; },
    elastic: function (o, p) { o.s *= Math.max(0.01, elastic(p)); o.a *= clamp(p * 5, 0, 1); },
    bounce: function (o, p) { o.dy -= (1 - bounce(p)) * 1.2; o.a *= clamp(p * 5, 0, 1); },
    swing: function (o, p) { o.r -= 35 * (1 - elastic(p)); o.a *= clamp(p * 4, 0, 1); },
    roll: function (o, p) { var e = out3(p); o.dx -= (1 - e) * 3; o.r -= (1 - e) * 360; o.a *= e; },
    tilt: function (o, p) { var e = out3(p); o.r += (1 - e) * 18; o.dy += (1 - e) * 0.5; o.a *= e; },
    skate: function (o, p) { var e = out3(p); o.dx -= (1 - e) * 2; o.kx += (1 - e) * 0.6; o.a *= e; },
    wipe: function (o, p) { wipeTo(o, "x", out3(p)); },
    wipeup: function (o, p) { wipeTo(o, "y", out3(p)); },
    unfold: function (o, p) { wipeTo(o, "c", out3(p)); },
    glitch: function (o, p) {
      if (p >= 1) return;
      var step = Math.floor(p * 18);
      o.dx += (rnd(step, 1) - 0.5) * 0.5 * (1 - p);
      o.kx += (rnd(step, 2) - 0.5) * 0.4 * (1 - p);
      o.a *= p < 0.12 ? 0 : rnd(step, 3) > 0.25 ? 1 : 0.3;
    },
    flicker: function (o, p) {
      if (p >= 1) return;
      if (p < 0.08) { o.a = 0; return; }   // starts from nothing, like every other In
      o.a *= rnd(Math.floor(p * 16), 4) < p * 1.1 ? 1 : 0.08;
    },
    scatter: function (o, p, i) {
      var e = out3(p);
      o.dx += (rnd(i, 5) - 0.5) * 3 * (1 - e);
      o.dy += (rnd(i, 6) - 0.5) * 2.4 * (1 - e);
      o.r += (rnd(i, 7) - 0.5) * 180 * (1 - e);
      o.a *= e;
    },
    wave: function (o, p) { o.dy += (1 - back(p)) * 0.7; o.a *= clamp(p * 3, 0, 1); }
  };

  /* ─── The lists. by: "letter" or "word" runs the motion per letter or
     word; order "random" picks the letters in a scattered order. ─── */
  var IN = [
    ["fade", "Fade"], ["rise", "Rise"], ["drop", "Drop"], ["left", "Slide in left", { m: "left" }],
    ["right-in", "Slide in right", { m: "right" }], ["pop", "Pop"], ["zoom", "Zoom out"], ["grow", "Zoom in"],
    ["spin", "Spin"], ["type", "Typewriter"], ["blur", "Blur in"], ["flipx", "Flip up"], ["flipy", "Turn"],
    ["stretch", "Stretch"], ["elastic", "Elastic"], ["bounce", "Bounce"], ["swing", "Swing in"], ["roll", "Roll in"],
    ["tilt", "Tilt up"], ["skate", "Skate"], ["wipe", "Wipe"], ["wipeup", "Wipe up"], ["unfold", "Unfold"],
    ["glitch", "Glitch"], ["flicker", "Flicker"],
    ["l-fade", "Letters fade", { m: "fade", by: "letter" }], ["l-rise", "Letters rise", { m: "rise", by: "letter" }],
    ["l-drop", "Letters drop", { m: "drop", by: "letter" }], ["l-pop", "Letters pop", { m: "pop", by: "letter" }],
    ["l-spin", "Letters spin", { m: "spin", by: "letter" }], ["l-blur", "Letters blur", { m: "blur", by: "letter" }],
    ["l-scatter", "Gather", { m: "scatter", by: "letter" }], ["l-wave", "Wave in", { m: "wave", by: "letter" }],
    ["l-zoom", "Letters zoom", { m: "zoom", by: "letter" }], ["l-random", "Sparkle", { m: "fade", by: "letter", order: "random" }],
    ["l-left", "Letters slide", { m: "left", by: "letter" }], ["l-turn", "Letters turn", { m: "flipy", by: "letter" }],
    ["l-bounce", "Cascade", { m: "bounce", by: "letter" }], ["w-rise", "Word by word", { m: "rise", by: "word" }],
    ["w-pop", "Words pop", { m: "pop", by: "word" }]
  ];
  var OUT = [
    ["fade", "Fade"], ["rise", "Rise away", { m: "drop" }], ["drop", "Fall away", { m: "rise" }],
    ["left-out", "Slide out left", { m: "left" }], ["right", "Slide out right", { m: "right" }],
    ["shrink", "Shrink", { m: "grow" }], ["zoom", "Zoom in", { m: "zoom" }], ["pop-out", "Pop out", { m: "pop" }],
    ["spin", "Spin out"], ["type", "Erase"], ["blur", "Blur out"], ["flipx", "Flip down"], ["flipy", "Turn away"],
    ["stretch", "Stretch out"], ["roll", "Roll out"], ["tilt", "Tilt away"], ["skate", "Skate out"],
    ["wipe", "Wipe away"], ["wipeup", "Wipe down"], ["unfold", "Fold"], ["glitch", "Glitch out"], ["flicker", "Flicker out"],
    ["swing", "Swing out"],
    ["l-fade", "Letters fade", { m: "fade", by: "letter" }], ["l-rise", "Letters rise away", { m: "drop", by: "letter" }],
    ["l-drop", "Letters fall", { m: "rise", by: "letter" }], ["l-pop", "Letters pop out", { m: "pop", by: "letter" }],
    ["l-spin", "Letters spin out", { m: "spin", by: "letter" }], ["l-blur", "Letters blur", { m: "blur", by: "letter" }],
    ["l-scatter", "Scatter", { m: "scatter", by: "letter" }], ["l-zoom", "Letters zoom", { m: "zoom", by: "letter" }],
    ["l-random", "Fade sparkle", { m: "fade", by: "letter", order: "random" }],
    ["l-right", "Letters slide out", { m: "right", by: "letter" }], ["w-rise", "Words away", { m: "drop", by: "word" }]
  ];

  /* Loops: ph is seconds since the text appeared. Each returns its change
     to the whole text, or sets o.each for one that moves letter by letter. */
  var wav = function (ph, period) { return Math.sin((ph / period) * PI2); };
  var LOOPS = {
    pulse: function (o, ph) { o.s *= 1 + 0.05 * wav(ph, 0.9); },
    float: function (o, ph) { o.dy += 0.1 * wav(ph, 1.6); },
    swing: function (o, ph) { o.r += 5 * wav(ph, 1.4); },
    shake: function (o, ph) { o.r += 2.5 * wav(ph, 0.16); o.dx += 0.03 * wav(ph, 0.11); },
    heartbeat: function (o, ph) {
      var b = ph % 1.1, g = function (c) { return Math.exp(-Math.pow((b - c) / 0.06, 2)); };
      o.s *= 1 + 0.08 * (g(0.12) + 0.7 * g(0.34));
    },
    jelly: function (o, ph) { var w = wav(ph, 0.8); o.sx *= 1 + 0.07 * w; o.sy *= 1 - 0.07 * w; },
    hop: function (o, ph) { o.dy -= 0.28 * Math.abs(Math.sin((ph / 0.7) * Math.PI)); },
    spin: function (o, ph) { o.r += (ph * 90) % 360; },
    flip: function (o, ph) { var c = Math.cos((ph / 2.2) * PI2); o.sx *= Math.abs(c) < 0.02 ? 0.02 : c; },
    breathe: function (o, ph) { var w = wav(ph, 2.4); o.s *= 1 + 0.04 * w; o.a *= 0.88 + 0.12 * w; },
    blink: function (o, ph) { if (ph % 1.2 > 1.05) o.a *= 0.08; },
    flicker: function (o, ph) { if (rnd(Math.floor(ph * 12), 8) > 0.86) o.a *= 0.35; },
    glitch: function (o, ph) {
      var step = Math.floor(ph * 10);
      if (rnd(step, 9) > 0.78) { var q = Math.floor(ph * 40); o.dx += (rnd(q, 10) - 0.5) * 0.25; o.kx += (rnd(q, 11) - 0.5) * 0.3; }
    },
    sway: function (o, ph) { o.r += 3 * wav(ph, 2); o.dx += 0.06 * wav(ph, 2); },
    tilt: function (o, ph) { o.r += 8 * wav(ph, 3); },
    drift: function (o, ph) { o.dx += 0.15 * wav(ph, 4); o.dy += 0.08 * wav(ph, 3); },
    orbit: function (o, ph) { var a = (ph / 1.6) * PI2; o.dx += 0.1 * Math.cos(a); o.dy += 0.1 * Math.sin(a); },
    throb: function (o, ph) { o.s *= 1 + 0.12 * Math.pow(Math.sin((ph / 1.2) * Math.PI), 2); },
    shiver: function (o, ph) { o.r += 1.2 * wav(ph, 0.07); },
    pendulum: function (o, ph) { var w = wav(ph, 1.8); o.r += 12 * w; o.dx += 0.12 * w; },
    // letter by letter
    "l-wave": function (o, ph) { o.each = function (q, i) { q.dy += 0.14 * Math.sin(ph * 5 - i * 0.55); }; },
    "l-jump": function (o, ph) {
      o.each = function (q, i, n) {
        var c = (ph / 0.12) % (n + 4);
        var d = c - i;
        if (d > 0 && d < 2) q.dy -= 0.3 * Math.sin((d / 2) * Math.PI);
      };
    },
    "l-ripple": function (o, ph) { o.each = function (q, i) { q.s *= 1 + 0.15 * Math.max(0, Math.sin(ph * 4 - i * 0.6)); }; },
    "l-dance": function (o, ph) { o.each = function (q, i) { q.r += 10 * Math.sin(ph * 6 + (i % 2 ? Math.PI : 0)); }; },
    "l-jitter": function (o, ph) {
      var step = Math.floor(ph * 12);
      o.each = function (q, i) { q.dy += (rnd(i * 31 + step, 12) - 0.5) * 0.1; q.r += (rnd(i * 17 + step, 13) - 0.5) * 8; };
    }
  };
  var LOOP = [
    ["pulse", "Pulse"], ["float", "Float"], ["swing", "Swing"], ["shake", "Shake"], ["heartbeat", "Heartbeat"],
    ["jelly", "Jelly"], ["hop", "Hop"], ["spin", "Spin"], ["flip", "Flip"], ["breathe", "Breathe"], ["blink", "Blink"],
    ["flicker", "Flicker"], ["glitch", "Glitch"], ["sway", "Sway"], ["tilt", "Tilt"], ["drift", "Drift"],
    ["orbit", "Orbit"], ["throb", "Throb"], ["shiver", "Shiver"], ["pendulum", "Pendulum"],
    ["l-wave", "Letters wave"], ["l-jump", "Letters jump"], ["l-ripple", "Ripple"], ["l-dance", "Dance"], ["l-jitter", "Jitter"]
  ];

  // id → {m, by, order}; a row without a spec uses the motion of the same name
  function table(list) {
    var t = {};
    list.forEach(function (r) { t[r[0]] = r[2] || { m: r[0] }; });
    return t;
  }
  var IN_BY = table(IN), OUT_BY = table(OUT);

  // a letter's own progress: each starts a little after the one before, and all finish together
  function stagger(p, idx, count) {
    if (count <= 1) return p;
    var st = 0.6;
    return clamp((p - (idx / (count - 1)) * st) / (1 - st), 0, 1);
  }

  function apply(o, spec, p, leaving) {
    if (!spec) return;
    if (spec.m === "type") { o.chars = Math.min(o.chars, p); return; }
    var fn = M[spec.m];
    if (!fn) return;
    if (!spec.by) { fn(o, p, 0); return; }
    var prev = o.letter;
    o.letter = function (q, i, n, w, nw) {
      if (prev) prev(q, i, n, w, nw);
      var idx = spec.by === "word" ? w : i, cnt = spec.by === "word" ? nw : n;
      if (spec.order === "random") idx = Math.floor(rnd(i, 14) * cnt);
      if (leaving) idx = cnt - 1 - idx;   // the first to arrive is the first to leave
      fn(q, stagger(p, idx, cnt), i);
    };
  }

  /* One frame. An In takes t.animInLen seconds, an Out t.animOutLen (both
     fall back to t.animLen), a loop runs at t.animLoopSpeed. Returns the
     whole-text change plus:
       chars   share of letters shown (typewriter, erase)
       wipe    {dir: "x"|"y"|"c", f} how much is uncovered
       letter(q, i, n, w, nw)  changes letter i of n, in word w of nw */
  function at(t, time) {
    var o = base();
    o.chars = 1;
    if (time == null) return o;
    // In and Out each have their own length (animInLen, animOutLen; animLen
    // is the shared one from 0.30/0.31); together they never take more than
    // the text's time on screen
    var both = t.animIn && t.animOut;
    var cap = both ? t.dur / 2 : t.dur;
    var lenIn = Math.max(0.05, Math.min(t.animInLen || t.animLen || 0.5, cap));
    var lenOut = Math.max(0.05, Math.min(t.animOutLen || t.animLen || 0.5, cap));
    var pin = clamp((time - t.start) / lenIn, 0, 1), pout = clamp((t.start + t.dur - time) / lenOut, 0, 1);
    if (t.animIn) apply(o, IN_BY[t.animIn], pin, false);
    if (t.animOut) apply(o, OUT_BY[t.animOut], pout, true);
    var loop = t.animLoop && LOOPS[t.animLoop];
    if (loop) {
      // a loop's speed: 1 = as designed, 0.25 slow to 3 fast
      loop(o, (time - t.start) * clamp(t.animLoopSpeed || 1, 0.1, 5));
      if (o.each) {
        var each = o.each, prev = o.letter;
        delete o.each;
        o.letter = function (q, i, n, w, nw) { if (prev) prev(q, i, n, w, nw); each(q, i, n); };
      }
    }
    return o;
  }

  global.SenotelTextAnims = {
    IN: IN.map(function (r) { return [r[0], r[1]]; }),
    OUT: OUT.map(function (r) { return [r[0], r[1]]; }),
    LOOP: LOOP.slice(),
    at: at,
    base: base,
    // how long an In or Out reads best at, when it is first picked
    lengthFor: function (id) { return /^[lw]-/.test(id || "") ? 0.9 : id === "type" ? 1 : 0.5; }
  };
})(typeof window !== "undefined" ? window : globalThis);
