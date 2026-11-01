/* ═══════════════════════════════════════════════════════════
   vClyps: text animations
   CapCut's three kinds, for headings: In (how a text arrives), Out (how it
   leaves) and Loop (what it does while it stays). 67 ins, 54 outs and 41
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
  // adds a change for every letter, after any the text already has
  function eachLetter(o, fn) {
    var prev = o.letter;
    o.letter = function (q, i, n, w, nw) { if (prev) prev(q, i, n, w, nw); fn(q, i, n, w, nw); };
  }
  /* A mask: drawHeading clips to the text's own box whenever a wipe is under
     1, and moves the letters inside that clip. Just under 1 keeps the whole
     box open, so letters sliding in from below or above appear to come out
     from behind an edge, the way CapCut's mask reveals do. */
  var MASK = 0.9999;

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
    wave: function (o, p) { o.dy += (1 - back(p)) * 0.7; o.a *= clamp(p * 3, 0, 1); },

    /* 0.52: the CapCut staples that were missing. A "swoosh" is a slide with
       motion blur: smeared and stretched along the way it moves, sharp as it
       lands. */
    blurleft: function (o, p) { var w = 1 - out3(p); o.dx -= w * 2.2; o.sx *= 1 + w * 0.5; o.blur += w * 0.25; o.a *= clamp(p * 3, 0, 1); },
    blurright: function (o, p) { var w = 1 - out3(p); o.dx += w * 2.2; o.sx *= 1 + w * 0.5; o.blur += w * 0.25; o.a *= clamp(p * 3, 0, 1); },
    blurrise: function (o, p) { var w = 1 - out3(p); o.dy += w * 1.1; o.sy *= 1 + w * 0.45; o.blur += w * 0.22; o.a *= clamp(p * 3, 0, 1); },
    blurfall: function (o, p) { var w = 1 - out3(p); o.dy -= w * 1.1; o.sy *= 1 + w * 0.45; o.blur += w * 0.22; o.a *= clamp(p * 3, 0, 1); },
    blurzoom: function (o, p) { var e = out3(p), w = 1 - e; o.s *= 1 + w * 0.6; o.blur += w * 0.4; o.a *= e; },
    // one and a half turns while it grows out of a point and curls into place
    spiral: function (o, p) {
      var e = out3(p), w = 1 - e, ang = w * Math.PI * 3;
      o.r -= w * 540; o.s *= 0.2 + 0.8 * e; o.a *= clamp(p * 2.5, 0, 1);
      o.dx += Math.cos(ang) * w * 1.2; o.dy += Math.sin(ang) * w * 1.2;
    },
    rotate: function (o, p) { var e = out3(p); o.r -= (1 - e) * 90; o.s *= 0.7 + 0.3 * e; o.a *= e; },
    stretchup: function (o, p) { var e = out3(p); o.sy *= 1 + (1 - e) * 1.5; o.sx *= 0.4 + 0.6 * e; o.a *= e; },
    // squashed wide, then wobbles to its shape like a jelly set down
    jelly: function (o, p) { var w = 1 - elastic(p); o.sx *= 1 + w * 0.5; o.sy *= 1 - w * 0.5; o.a *= clamp(p * 5, 0, 1); },
    shake: function (o, p) { o.dx += Math.sin(p * Math.PI * 10) * (1 - p) * 0.3; o.a *= clamp(p * 4, 0, 1); },
    // a neon tube striking: two stutters, a dim moment, then full. No glow is
    // added: the text's own glow, if it has one, flickers with it
    neon: function (o, p) {
      if (p >= 1) return;
      o.a *= p < 0.1 ? 0 : p < 0.17 ? 1 : p < 0.3 ? 0.12 : p < 0.36 ? 1 : p < 0.48 ? 0.2 : 0.7 + 0.3 * out3((p - 0.48) / 0.52);
    },
    spring: function (o, p) { o.dy -= (1 - elastic(p)) * 0.9; o.a *= clamp(p * 4, 0, 1); },
    // lands from big and fast, like a stamp
    slam: function (o, p) { var w = 1 - out3(p); o.s *= 1 + w * w * 2.2; o.blur += w * w * 0.12; o.a *= clamp(p * 5, 0, 1); },
    // a word that is simply there when its turn comes, with a tiny settle
    snap: function (o, p) { o.a *= clamp(p * 4, 0, 1); o.s *= 0.92 + 0.08 * out3(p); },
    // mask reveals: the letters rise (or drop) into place from behind the
    // edge of their own box; a line of text moves as one
    maskup: function (o, p) {
      if (p >= 1) return;
      var w = 1 - out3(p);
      wipeTo(o, "y", MASK);
      eachLetter(o, function (q) { q.dy += w * 1.3; q.a *= clamp(p * 2.5, 0, 1); });
    },
    maskdown: function (o, p) {
      if (p >= 1) return;
      var w = 1 - out3(p);
      wipeTo(o, "y", MASK);
      eachLetter(o, function (q) { q.dy -= w * 1.3; q.a *= clamp(p * 2.5, 0, 1); });
    },
    // opens from the middle while the letters spread out from it
    open: function (o, p) {
      if (p >= 1) return;
      var e = out3(p);
      wipeTo(o, "c", e);
      eachLetter(o, function (q, i, n) { q.dx -= (i - (n - 1) / 2) * 0.3 * (1 - e); });
    }
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
    ["w-pop", "Words pop", { m: "pop", by: "word" }],
    // 0.52
    ["swoosh-left", "Swoosh in left", { m: "blurleft" }], ["swoosh-right", "Swoosh in right", { m: "blurright" }],
    ["swoosh-up", "Swoosh up", { m: "blurrise" }], ["swoosh-down", "Swoosh down", { m: "blurfall" }],
    ["zoom-blur", "Zoom blur", { m: "blurzoom" }], ["spiral", "Spiral"], ["rotate", "Rotate in"],
    ["stretch-up", "Stretch up", { m: "stretchup" }], ["jelly", "Jelly"], ["shake", "Shake in"],
    ["neon", "Neon on"], ["spring", "Spring"], ["slam", "Slam"],
    ["l-mask-up", "Mask up", { m: "maskup" }], ["l-mask-down", "Mask down", { m: "maskdown" }],
    ["l-open", "Open out", { m: "open" }],
    // st: how much of the length goes to waiting for its turn; near 1 is a
    // typewriter, each letter landing in its own short moment
    ["l-type-fade", "Type fade", { m: "fade", by: "letter", st: 0.9 }],
    ["l-type-pop", "Type pop", { m: "pop", by: "letter", st: 0.85 }],
    ["l-type-rise", "Type rise", { m: "rise", by: "letter", st: 0.85 }],
    ["l-grow", "Letters grow", { m: "grow", by: "letter" }], ["l-elastic", "Letters spring", { m: "elastic", by: "letter" }],
    ["l-flip", "Letters flip", { m: "flipx", by: "letter" }], ["l-swing", "Letters swing", { m: "swing", by: "letter" }],
    ["l-swoosh", "Letters swoosh", { m: "blurrise", by: "letter" }],
    ["w-blur", "Words blur", { m: "blur", by: "word" }], ["w-drop", "Words drop", { m: "drop", by: "word" }],
    ["w-snap", "Words appear", { m: "snap", by: "word", st: 0.9 }]
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
    ["l-right", "Letters slide out", { m: "right", by: "letter" }], ["w-rise", "Words away", { m: "drop", by: "word" }],
    // 0.52: an Out plays its motion backwards, so leaving upwards is the
    // motion that arrives from above
    ["swoosh-left", "Swoosh out left", { m: "blurleft" }], ["swoosh-right", "Swoosh out right", { m: "blurright" }],
    ["swoosh-up", "Swoosh away up", { m: "blurfall" }], ["swoosh-down", "Swoosh away down", { m: "blurrise" }],
    ["zoom-blur", "Zoom blur out", { m: "blurzoom" }], ["spiral", "Spiral out"], ["rotate", "Rotate out"],
    ["shake", "Shake out"], ["neon", "Neon off"], ["slam", "Blow up"],
    ["l-mask-up", "Mask away up", { m: "maskdown" }], ["l-mask-down", "Mask away down", { m: "maskup" }],
    ["l-open", "Close in", { m: "open" }],
    ["l-grow", "Letters shrink", { m: "grow", by: "letter" }], ["l-flip", "Letters flip out", { m: "flipx", by: "letter" }],
    ["l-swing", "Letters swing out", { m: "swing", by: "letter" }], ["l-swoosh", "Letters swoosh away", { m: "blurfall", by: "letter" }],
    ["w-blur", "Words blur out", { m: "blur", by: "word" }], ["w-drop", "Words fall", { m: "rise", by: "word" }],
    ["w-snap", "Words vanish", { m: "snap", by: "word", st: 0.9 }]
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
    // 0.52
    // hops, and squashes a little each time it touches down
    bounce: function (o, ph) {
      var b = Math.abs(Math.sin((ph / 0.8) * Math.PI)), g = Math.pow(1 - b, 6);
      o.dy -= 0.3 * b; o.sx *= 1 + 0.12 * g; o.sy *= 1 - 0.12 * g;
    },
    "slow-zoom": function (o, ph) { o.s *= 1 + 0.07 * (0.5 - 0.5 * Math.cos((ph / 3) * PI2)); },
    wobble: function (o, ph) { o.kx += 0.14 * wav(ph, 1.1); },
    // a neon sign's hum: steady, with a double stutter every few seconds
    neon: function (o, ph) {
      var c = ph % 2.8;
      if ((c > 2.2 && c < 2.28) || (c > 2.4 && c < 2.46)) o.a *= 0.15;
      else o.a *= 0.97 + 0.03 * wav(ph, 0.5);
    },
    stretch: function (o, ph) { o.sx *= 1 + 0.1 * wav(ph, 1.3); },
    // every so often it is plucked and wobbles back; starts and ends at rest so nothing jumps
    rubber: function (o, ph) {
      var c = ph % 1.6, w = Math.exp(-c * 6) * Math.sin(c * 25);
      o.sx *= 1 + 0.18 * w; o.sy *= 1 - 0.18 * w;
    },
    tada: function (o, ph) {
      var c = ph % 2.2;
      if (c >= 0.8) return;
      var env = Math.sin((c / 0.8) * Math.PI);
      o.s *= 1 + 0.1 * env; o.r += 5 * Math.sin(c * 28) * env;
    },
    // slides side to side, leaning into the way it moves
    glide: function (o, ph) { var a = (ph / 2.2) * PI2; o.dx += 0.12 * Math.sin(a); o.kx -= 0.12 * Math.cos(a); },
    rumble: function (o, ph) {
      var step = Math.floor(ph * 24);
      o.dx += (rnd(step, 15) - 0.5) * 0.06; o.dy += (rnd(step, 16) - 0.5) * 0.06;
    },
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
    },
    "l-bounce": function (o, ph) { o.each = function (q, i) { var b = Math.max(0, Math.sin(ph * 5 - i * 0.45)); q.dy -= 0.22 * b * b; }; },
    "l-shimmer": function (o, ph) { o.each = function (q, i) { q.a *= 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(ph * 4 - i * 0.5)); }; },
    "l-sway": function (o, ph) { o.each = function (q, i) { q.r += 12 * Math.sin(ph * 3 - i * 0.5); }; },
    "l-stretch": function (o, ph) { o.each = function (q, i) { q.sy *= 1 + 0.25 * Math.max(0, Math.sin(ph * 4 - i * 0.6)); }; },
    // one letter after another turns over (or spins round), then a pause
    "l-flip": function (o, ph) {
      o.each = function (q, i, n) {
        var d = ((ph / 0.1) % (n + 8)) - i;
        if (d > 0 && d < 3) { var c = Math.cos((d / 3) * PI2); q.sx *= Math.abs(c) < 0.02 ? 0.02 : c; }
      };
    },
    "l-spin": function (o, ph) {
      o.each = function (q, i, n) {
        var d = ((ph / 0.1) % (n + 8)) - i;
        if (d > 0 && d < 3) q.r += 360 * (0.5 - 0.5 * Math.cos((d / 3) * Math.PI));
      };
    },
    // a sign with a loose wire: now and then a letter or two goes dim
    "l-neon": function (o, ph) {
      var step = Math.floor(ph * 8);
      o.each = function (q, i) { if (rnd(i * 7 + step, 17) > 0.93) q.a *= 0.2; };
    }
  };
  var LOOP = [
    ["pulse", "Pulse"], ["float", "Float"], ["swing", "Swing"], ["shake", "Shake"], ["heartbeat", "Heartbeat"],
    ["jelly", "Jelly"], ["hop", "Hop"], ["spin", "Spin"], ["flip", "Flip"], ["breathe", "Breathe"], ["blink", "Blink"],
    ["flicker", "Flicker"], ["glitch", "Glitch"], ["sway", "Sway"], ["tilt", "Tilt"], ["drift", "Drift"],
    ["orbit", "Orbit"], ["throb", "Throb"], ["shiver", "Shiver"], ["pendulum", "Pendulum"],
    ["l-wave", "Letters wave"], ["l-jump", "Letters jump"], ["l-ripple", "Ripple"], ["l-dance", "Dance"], ["l-jitter", "Jitter"],
    // 0.52
    ["bounce", "Bounce"], ["slow-zoom", "Slow zoom"], ["wobble", "Wobble"], ["neon", "Neon buzz"], ["stretch", "Stretch"],
    ["rubber", "Rubber"], ["tada", "Tada"], ["glide", "Glide"], ["rumble", "Rumble"],
    ["l-bounce", "Letters bounce"], ["l-shimmer", "Shimmer"], ["l-sway", "Letters sway"], ["l-stretch", "Letters stretch"],
    ["l-flip", "Letters flip"], ["l-spin", "Letters spin"], ["l-neon", "Broken neon"]
  ];

  // id → {m, by, order}; a row without a spec uses the motion of the same name
  function table(list) {
    var t = {};
    list.forEach(function (r) { t[r[0]] = r[2] || { m: r[0] }; });
    return t;
  }
  var IN_BY = table(IN), OUT_BY = table(OUT);

  // a letter's own progress: each starts a little after the one before, and all finish together
  // (st, from the row, is the share of the length spent waiting; 0.6 unless it says)
  function stagger(p, idx, count, st) {
    if (count <= 1) return p;
    st = st || 0.6;
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
      fn(q, stagger(p, idx, cnt, spec.st), i);
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
    lengthFor: function (id) {
      id = id || "";
      if (/^l-type-/.test(id) || id === "w-snap") return 1.1;   // a typewriter needs time for every letter
      if (/^l-(mask-|open)/.test(id) || id === "neon" || id === "spiral") return 0.7;
      return /^[lw]-/.test(id) ? 0.9 : id === "type" ? 1 : 0.5;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
