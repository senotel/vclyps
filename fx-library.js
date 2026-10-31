/* ═══════════════════════════════════════════════════════════
   vClyps: transitions and video effects
   The drawing for both, on a canvas, so the preview and the export (which
   both draw through app.js renderPicture) show exactly the same thing.

   TRANSITIONS mix two whole pictures across a cut, as CapCut's do: A is
   the outgoing clip, B the incoming one, each already drawn to fill the
   frame on its own canvas; p runs 0 → 1 across the transition. 80 of them
   in six groups.

   EFFECTS (100 in twelve groups) are laid over the finished picture for as
   long as an effect clip lasts on its own lane (shake, VHS, old film, light leaks,
   snow...). Each reads the frame drawn so far and changes it. local is the
   seconds since the effect began, amount 0 to 1 how strong it is.

   Everything is drawn with plain canvas operations. ctx.filter (blur,
   grey, sepia) is used where the browser has it and skipped where it
   doesn't, so nothing fails, it just looks plainer there.
   Exposes window.SenotelFX.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var inOut = function (p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  var out3 = function (p) { return 1 - Math.pow(1 - p, 3); };
  var rnd = function (i, k) { var x = Math.sin(i * 12.9898 + (k || 0) * 78.233) * 43758.5453; return x - Math.floor(x); };

  // scratch canvases, reused: one per name and size
  var pool = {};
  function scratch(name, W, H) {
    var c = pool[name];
    if (!c) {
      if (typeof document !== "undefined") c = document.createElement("canvas");
      else if (typeof OffscreenCanvas !== "undefined") c = new OffscreenCanvas(W, H);
      pool[name] = c;
    }
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    var x = c.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 1;
    x.globalCompositeOperation = "source-over";
    x.filter = "none";
    x.clearRect(0, 0, W, H);
    return c;
  }
  var canFilter = (function () {
    try {
      var c = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
      if (!c) return false;
      c.filter = "blur(2px)";
      return c.filter === "blur(2px)";
    } catch (e) { return false; }
  })();
  function filtered(c, f) { if (canFilter) c.filter = f; }

  // draw a whole picture moved, scaled and turned about the frame's centre
  function place(c, img, W, H, o) {
    c.save();
    if (o.alpha != null) c.globalAlpha = clamp(o.alpha, 0, 1);
    c.translate(W / 2 + (o.dx || 0), H / 2 + (o.dy || 0));
    if (o.rot) c.rotate(o.rot);
    c.scale(o.sx != null ? o.sx : o.s != null ? o.s : 1, o.sy != null ? o.sy : o.s != null ? o.s : 1);
    if (o.blur) filtered(c, "blur(" + o.blur.toFixed(1) + "px)");
    c.drawImage(img, -W / 2, -H / 2, W, H);
    c.restore();
  }
  function clipThen(c, path, draw) { c.save(); c.beginPath(); path(); c.clip(); draw(); c.restore(); }

  /* ═══════════ TRANSITIONS ═══════════ */
  var DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

  function push(dir) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p), d = DIRS[dir];
      place(c, A, W, H, { dx: d[0] * e * W, dy: d[1] * e * H });
      place(c, B, W, H, { dx: -d[0] * (1 - e) * W, dy: -d[1] * (1 - e) * H });
    };
  }
  function slideIn(dir) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p), d = DIRS[dir];
      c.drawImage(A, 0, 0, W, H);
      c.fillStyle = "rgba(0,0,0," + (0.35 * e) + ")";
      c.fillRect(0, 0, W, H);
      place(c, B, W, H, { dx: -d[0] * (1 - e) * W, dy: -d[1] * (1 - e) * H });
    };
  }
  function uncover(dir) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p), d = DIRS[dir];
      c.drawImage(B, 0, 0, W, H);
      c.fillStyle = "rgba(0,0,0," + (0.35 * (1 - e)) + ")";
      c.fillRect(0, 0, W, H);
      place(c, A, W, H, { dx: d[0] * e * W, dy: d[1] * e * H });
    };
  }
  function wipe(dir) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p);
      c.drawImage(A, 0, 0, W, H);
      clipThen(c, function () {
        if (dir === "left") c.rect(W * (1 - e), 0, W * e, H);
        else if (dir === "right") c.rect(0, 0, W * e, H);
        else if (dir === "up") c.rect(0, H * (1 - e), W, H * e);
        else c.rect(0, 0, W, H * e);
      }, function () { c.drawImage(B, 0, 0, W, H); });
    };
  }
  // a wipe with a soft edge: B is cut out through a gradient
  function softWipe(dir) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p), S = scratch("soft", W, H), x = S.getContext("2d");
      x.drawImage(B, 0, 0, W, H);
      x.globalCompositeOperation = "destination-in";
      var horiz = dir === "left" || dir === "right";
      var len = horiz ? W : H, band = len * 0.35, pos = -band + (len + band * 2) * e;
      var g = horiz ? x.createLinearGradient(0, 0, W, 0) : x.createLinearGradient(0, 0, 0, H);
      var a = clamp((pos - band) / len, 0, 1), b = clamp(pos / len, 0, 1);
      var toward = dir === "right" || dir === "down";
      if (toward) { g.addColorStop(0, "#000"); g.addColorStop(Math.max(0, Math.min(a, 1)), "#000"); g.addColorStop(Math.max(a, Math.min(b, 1)), "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0)"); }
      else {
        var a2 = 1 - b, b2 = 1 - a;
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(clamp(a2, 0, 1), "rgba(0,0,0,0)"); g.addColorStop(clamp(b2, a2, 1), "#000"); g.addColorStop(1, "#000");
      }
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      c.drawImage(A, 0, 0, W, H);
      c.drawImage(S, 0, 0);
    };
  }
  function shapeReveal(path, closing) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p);
      var under = closing ? B : A, over = closing ? A : B, k = closing ? 1 - e : e;
      c.drawImage(under, 0, 0, W, H);
      if (k <= 0) return;
      clipThen(c, function () { path(c, k, W, H); }, function () { c.drawImage(over, 0, 0, W, H); });
    };
  }
  var R = function (W, H) { return Math.hypot(W, H) / 2; };

  var T = {
    mix: function (c, A, B, p, W, H) { c.drawImage(A, 0, 0, W, H); c.globalAlpha = inOut(p); c.drawImage(B, 0, 0, W, H); c.globalAlpha = 1; },
    black: function (c, A, B, p, W, H) { c.drawImage(p < 0.5 ? A : B, 0, 0, W, H); c.fillStyle = "rgba(0,0,0," + (1 - Math.abs(p - 0.5) * 2) + ")"; c.fillRect(0, 0, W, H); },
    white: function (c, A, B, p, W, H) { c.drawImage(p < 0.5 ? A : B, 0, 0, W, H); c.fillStyle = "rgba(255,255,255," + (1 - Math.abs(p - 0.5) * 2) + ")"; c.fillRect(0, 0, W, H); },
    blur: function (c, A, B, p, W, H) {
      var b = Math.sin(Math.PI * p) * H * 0.035, e = inOut(p);
      place(c, A, W, H, { blur: b, s: 1 + 0.04 * Math.sin(Math.PI * p) });
      place(c, B, W, H, { blur: b, alpha: e, s: 1 + 0.04 * Math.sin(Math.PI * p) });
    },
    dissolve: function (c, A, B, p, W, H) {
      // blocks of B appear in a scattered order: a pixel dissolve
      var cols = 48, rows = Math.max(1, Math.round(cols * H / W)), cw = W / cols, ch = H / rows, e = inOut(p);
      c.drawImage(A, 0, 0, W, H);
      clipThen(c, function () {
        for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) if (rnd(x * 97 + y, 3) < e) c.rect(Math.floor(x * cw), Math.floor(y * ch), Math.ceil(cw) + 1, Math.ceil(ch) + 1);
      }, function () { c.drawImage(B, 0, 0, W, H); });
    },
    "push-left": push("left"), "push-right": push("right"), "push-up": push("up"), "push-down": push("down"),
    "slide-left": slideIn("left"), "slide-right": slideIn("right"), "slide-up": slideIn("up"), "slide-down": slideIn("down"),
    "uncover-left": uncover("left"), "uncover-right": uncover("right"), "uncover-up": uncover("up"), "uncover-down": uncover("down"),
    "wipe-left": wipe("left"), "wipe-right": wipe("right"), "wipe-up": wipe("up"), "wipe-down": wipe("down"),
    "soft-left": softWipe("left"), "soft-right": softWipe("right"), "soft-up": softWipe("up"), "soft-down": softWipe("down"),
    "circle-open": shapeReveal(function (c, k, W, H) { c.arc(W / 2, H / 2, R(W, H) * k, 0, Math.PI * 2); }),
    "circle-close": shapeReveal(function (c, k, W, H) { c.arc(W / 2, H / 2, R(W, H) * k, 0, Math.PI * 2); }, true),
    diamond: shapeReveal(function (c, k, W, H) {
      var r = (W + H) / 2 * k;
      c.moveTo(W / 2, H / 2 - r); c.lineTo(W / 2 + r, H / 2); c.lineTo(W / 2, H / 2 + r); c.lineTo(W / 2 - r, H / 2); c.closePath();
    }),
    clock: shapeReveal(function (c, k, W, H) {
      c.moveTo(W / 2, H / 2);
      c.arc(W / 2, H / 2, R(W, H) * 1.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      c.closePath();
    }),
    "split-open": shapeReveal(function (c, k, W, H) { c.rect(W / 2 * (1 - k), 0, W * k, H); }),
    "split-close": shapeReveal(function (c, k, W, H) { c.rect(0, 0, W / 2 * k + 0.5, H); c.rect(W - W / 2 * k - 0.5, 0, W / 2 * k + 0.5, H); }),
    "barn-open": shapeReveal(function (c, k, W, H) { c.rect(0, H / 2 * (1 - k), W, H * k); }),
    blinds: shapeReveal(function (c, k, W, H) { var n = 9, h = H / n; for (var i = 0; i < n; i++) c.rect(0, i * h, W, h * k + 0.5); }),
    "blinds-v": shapeReveal(function (c, k, W, H) { var n = 7, w = W / n; for (var i = 0; i < n; i++) c.rect(i * w, 0, w * k + 0.5, H); }),
    checker: shapeReveal(function (c, k, W, H) {
      var n = 8, m = Math.max(1, Math.round(n * H / W)), w = W / n, h = H / m;
      for (var y = 0; y < m; y++) for (var x = 0; x < n; x++) {
        var d = (x + y) / (n + m - 2), q = clamp((k - d * 0.6) / 0.4, 0, 1);
        if (q > 0) c.rect(x * w + w / 2 * (1 - q), y * h + h / 2 * (1 - q), w * q + 0.5, h * q + 0.5);
      }
    }),
    heart: shapeReveal(function (c, k, W, H) {
      var s = Math.max(W, H) * 1.6 * k, cx = W / 2, cy = H / 2 + s * 0.05;
      c.moveTo(cx, cy + s * 0.3);
      c.bezierCurveTo(cx - s * 0.6, cy - s * 0.1, cx - s * 0.3, cy - s * 0.55, cx, cy - s * 0.25);
      c.bezierCurveTo(cx + s * 0.3, cy - s * 0.55, cx + s * 0.6, cy - s * 0.1, cx, cy + s * 0.3);
    }),
    "zoom-in": function (c, A, B, p, W, H) {
      var e = inOut(p), b = Math.sin(Math.PI * p) * H * 0.02;
      place(c, A, W, H, { s: 1 + e * 1.2, alpha: 1, blur: b });
      place(c, B, W, H, { s: 1.6 - 0.6 * e, alpha: e, blur: b });
    },
    "zoom-out": function (c, A, B, p, W, H) {
      var e = inOut(p), b = Math.sin(Math.PI * p) * H * 0.02;
      place(c, B, W, H, { s: 1.4 - 0.4 * e, blur: b });
      place(c, A, W, H, { s: 1 - 0.6 * e, alpha: 1 - e, blur: b });
    },
    "pull-in": function (c, A, B, p, W, H) {
      var e = out3(p);
      c.drawImage(A, 0, 0, W, H);
      place(c, B, W, H, { s: 0.2 + 0.8 * e, alpha: clamp(p * 3, 0, 1) });
    },
    spin: function (c, A, B, p, W, H) {
      var e = inOut(p), b = Math.sin(Math.PI * p) * H * 0.02;
      if (p < 0.5) place(c, A, W, H, { rot: e * Math.PI, s: 1 + e * 0.6, blur: b });
      else place(c, B, W, H, { rot: -(1 - e) * Math.PI, s: 1 + (1 - e) * 0.6, blur: b });
    },
    "rotate": function (c, A, B, p, W, H) {
      var e = inOut(p);
      c.drawImage(B, 0, 0, W, H);
      c.save(); c.translate(0, H); c.rotate(e * Math.PI / 2); c.globalAlpha = 1 - e * 0.3; c.drawImage(A, 0, -H, W, H); c.restore();
    },
    "whip-left": whip(-1, 0), "whip-right": whip(1, 0), "whip-up": whip(0, -1), "whip-down": whip(0, 1),
    shake: function (c, A, B, p, W, H) {
      var amp = Math.sin(Math.PI * p) * W * 0.035, i = Math.floor(p * 30);
      var dx = (rnd(i, 1) - 0.5) * 2 * amp, dy = (rnd(i, 2) - 0.5) * 2 * amp, e = inOut(p);
      place(c, A, W, H, { dx: dx, dy: dy, s: 1.06 });
      place(c, B, W, H, { dx: dx, dy: dy, s: 1.06, alpha: e });
    },
    glitch: function (c, A, B, p, W, H) {
      var img = p < 0.5 ? A : B, i = Math.floor(p * 24), k = Math.sin(Math.PI * p);
      c.drawImage(img, 0, 0, W, H);
      var n = 10;
      for (var s = 0; s < n; s++) {
        if (rnd(i * 13 + s, 4) > 0.55 * k + 0.2) continue;
        var y = Math.floor(rnd(i * 7 + s, 5) * H), h = Math.max(2, Math.floor(rnd(i * 3 + s, 6) * H * 0.08));
        var dx = (rnd(i + s, 7) - 0.5) * W * 0.25 * k;
        c.drawImage(rnd(s, 8) > 0.5 ? A : B, 0, y, W, h, dx, y, W, h);
      }
      rgbShift(c, c.canvas, W, H, W * 0.012 * k);
    },
    flash: function (c, A, B, p, W, H) {
      c.drawImage(A, 0, 0, W, H);
      c.globalAlpha = inOut(p); c.drawImage(B, 0, 0, W, H); c.globalAlpha = 1;
      c.fillStyle = "rgba(255,255,255," + Math.pow(Math.sin(Math.PI * p), 2) + ")";
      c.fillRect(0, 0, W, H);
    },
    "light-leak": function (c, A, B, p, W, H) {
      c.drawImage(A, 0, 0, W, H);
      c.globalAlpha = inOut(p); c.drawImage(B, 0, 0, W, H); c.globalAlpha = 1;
      leak(c, W, H, p * 1.6, Math.sin(Math.PI * p));
    },
    burn: function (c, A, B, p, W, H) {
      c.drawImage(A, 0, 0, W, H);
      c.globalAlpha = inOut(p); c.drawImage(B, 0, 0, W, H); c.globalAlpha = 1;
      var k = Math.sin(Math.PI * p), cx = W * (0.2 + 0.6 * p), cy = H * 0.6;
      c.save(); c.globalCompositeOperation = "lighter";
      var g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.7);
      g.addColorStop(0, "rgba(255,240,200," + k + ")"); g.addColorStop(0.3, "rgba(255,120,20," + 0.8 * k + ")"); g.addColorStop(1, "rgba(120,0,0,0)");
      c.fillStyle = g; c.fillRect(0, 0, W, H); c.restore();
    },
    pixelate: function (c, A, B, p, W, H) {
      var k = Math.sin(Math.PI * p), img = p < 0.5 ? A : B;
      pixel(c, img, W, H, Math.max(1, Math.round(k * Math.min(W, H) / 14)));
    },
    "color-split": function (c, A, B, p, W, H) {
      c.drawImage(A, 0, 0, W, H);
      c.globalAlpha = inOut(p); c.drawImage(B, 0, 0, W, H); c.globalAlpha = 1;
      rgbShift(c, c.canvas, W, H, Math.sin(Math.PI * p) * W * 0.04);
    },
    "flip-h": function (c, A, B, p, W, H) {
      if (p < 0.5) place(c, A, W, H, { sx: Math.max(0.001, 1 - p * 2) });
      else place(c, B, W, H, { sx: Math.max(0.001, p * 2 - 1) });
      shade(c, W, H, 0.5 * Math.sin(Math.PI * p));
    },
    "flip-v": function (c, A, B, p, W, H) {
      if (p < 0.5) place(c, A, W, H, { sy: Math.max(0.001, 1 - p * 2) });
      else place(c, B, W, H, { sy: Math.max(0.001, p * 2 - 1) });
      shade(c, W, H, 0.5 * Math.sin(Math.PI * p));
    },
    door: function (c, A, B, p, W, H) {
      var e = inOut(p);
      c.drawImage(B, 0, 0, W, H);
      shade(c, W, H, 0.5 * (1 - e));
      var w = W / 2 * (1 - e);
      if (w > 0.5) {
        c.drawImage(A, 0, 0, W / 2, H, 0, 0, w, H);
        c.drawImage(A, W / 2, 0, W / 2, H, W - w, 0, w, H);
      }
    },
    "cube-left": cube(-1), "cube-right": cube(1)
  };
  function whip(dx, dy) {
    return function (c, A, B, p, W, H) {
      var b = Math.sin(Math.PI * p) * Math.max(W, H) * 0.03;
      if (p < 0.5) { var q = p * 2; place(c, A, W, H, { dx: dx * q * q * W * 0.6, dy: dy * q * q * H * 0.6, blur: b, s: 1.05 }); }
      else { var r = (1 - p) * 2; place(c, B, W, H, { dx: -dx * r * r * W * 0.6, dy: -dy * r * r * H * 0.6, blur: b, s: 1.05 }); }
    };
  }
  function cube(dir) {
    return function (c, A, B, p, W, H) {
      var e = inOut(p);
      // the outgoing face folds toward one edge as the incoming one opens from the other
      var wa = W * (1 - e), wb = W * e;
      if (dir < 0) {
        if (wa > 0.5) { c.drawImage(A, 0, 0, wa, H); c.fillStyle = "rgba(0,0,0," + 0.5 * e + ")"; c.fillRect(0, 0, wa, H); }
        if (wb > 0.5) { c.drawImage(B, wa, 0, wb, H); c.fillStyle = "rgba(0,0,0," + 0.5 * (1 - e) + ")"; c.fillRect(wa, 0, wb, H); }
      } else {
        if (wb > 0.5) { c.drawImage(B, 0, 0, wb, H); c.fillStyle = "rgba(0,0,0," + 0.5 * (1 - e) + ")"; c.fillRect(0, 0, wb, H); }
        if (wa > 0.5) { c.drawImage(A, wb, 0, wa, H); c.fillStyle = "rgba(0,0,0," + 0.5 * e + ")"; c.fillRect(wb, 0, wa, H); }
      }
    };
  }
  function shade(c, W, H, a) { if (a <= 0) return; c.fillStyle = "rgba(0,0,0," + a + ")"; c.fillRect(0, 0, W, H); }
  function pixel(c, img, W, H, size) {
    if (size <= 1) { c.drawImage(img, 0, 0, W, H); return; }
    var w = Math.max(1, Math.round(W / size)), h = Math.max(1, Math.round(H / size));
    var S = scratch("pix", w, h); S.getContext("2d").drawImage(img, 0, 0, w, h);
    var was = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    c.drawImage(S, 0, 0, w, h, 0, 0, W, H);
    c.imageSmoothingEnabled = was;
  }
  // red to one side, blue to the other: three channel copies added back together
  function rgbShift(c, src, W, H, off) {
    if (Math.abs(off) < 0.5) return;
    var base = scratch("rgb-base", W, H); base.getContext("2d").drawImage(src, 0, 0, W, H);
    var parts = [["#ff0000", -off], ["#00ff00", 0], ["#0000ff", off]];
    c.save();
    c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = "lighter";
    parts.forEach(function (pt, i) {
      var S = scratch("rgb" + i, W, H), x = S.getContext("2d");
      x.drawImage(base, 0, 0);
      x.globalCompositeOperation = "multiply"; x.fillStyle = pt[0]; x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = "destination-in"; x.drawImage(base, 0, 0);
      c.drawImage(S, pt[1], 0);
    });
    c.restore();
  }
  function leak(c, W, H, ph, k) {
    if (k <= 0) return;
    c.save(); c.globalCompositeOperation = "screen";
    var cx = W * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(ph * 2.1))), cy = H * (0.3 + 0.4 * (0.5 + 0.5 * Math.cos(ph * 1.3)));
    var g = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(255,190,90," + 0.85 * k + ")"); g.addColorStop(0.4, "rgba(255,90,40," + 0.45 * k + ")"); g.addColorStop(1, "rgba(255,40,40,0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    var g2 = c.createLinearGradient(0, 0, W, H);
    g2.addColorStop(0, "rgba(255,220,150," + 0.25 * k + ")"); g2.addColorStop(0.5, "rgba(255,120,60,0)"); g2.addColorStop(1, "rgba(255,80,160," + 0.2 * k + ")");
    c.fillStyle = g2; c.fillRect(0, 0, W, H);
    c.restore();
  }

  var TRANSITIONS = [
    ["Basic", [["mix", "Mix"], ["black", "Fade black"], ["white", "Fade white"], ["blur", "Blur"], ["dissolve", "Dissolve"]]],
    ["Slide", [["push-left", "Push left"], ["push-right", "Push right"], ["push-up", "Push up"], ["push-down", "Push down"],
      ["slide-left", "Slide left"], ["slide-right", "Slide right"], ["slide-up", "Slide up"], ["slide-down", "Slide down"],
      ["uncover-left", "Uncover left"], ["uncover-right", "Uncover right"], ["uncover-up", "Uncover up"], ["uncover-down", "Uncover down"]]],
    ["Wipe", [["wipe-left", "Wipe left"], ["wipe-right", "Wipe right"], ["wipe-up", "Wipe up"], ["wipe-down", "Wipe down"],
      ["soft-left", "Soft left"], ["soft-right", "Soft right"], ["soft-up", "Soft up"], ["soft-down", "Soft down"],
      ["circle-open", "Circle open"], ["circle-close", "Circle close"], ["diamond", "Diamond"], ["clock", "Clock"],
      ["split-open", "Split open"], ["split-close", "Split close"], ["barn-open", "Barn doors"], ["blinds", "Blinds"],
      ["blinds-v", "Blinds across"], ["checker", "Checker"], ["heart", "Heart"]]],
    ["Camera", [["zoom-in", "Zoom in"], ["zoom-out", "Zoom out"], ["pull-in", "Pull in"], ["spin", "Spin"], ["rotate", "Rotate"],
      ["whip-left", "Whip left"], ["whip-right", "Whip right"], ["whip-up", "Whip up"], ["whip-down", "Whip down"], ["shake", "Shake"]]],
    ["Effects", [["glitch", "Glitch"], ["flash", "Flash"], ["light-leak", "Light leak"], ["burn", "Film burn"], ["pixelate", "Pixelate"], ["color-split", "Colour split"]]],
    ["3D", [["flip-h", "Flip"], ["flip-v", "Flip up"], ["door", "Doors"], ["cube-left", "Cube left"], ["cube-right", "Cube right"]]]
  ];
  // the transitions of 0.27 to 0.31 keep working under their old names
  var OLD = { fade: "black", flash: "white", zoom: "zoom-in", whip: "whip-left" };

  function transition(id, c, A, B, p, W, H) {
    var fn = T[OLD[id] || id] || T.mix;
    c.save();
    c.fillStyle = "#000";
    c.fillRect(0, 0, W, H);
    fn(c, A, B, clamp(p, 0, 1), W, H);
    c.restore();
  }

  /* ═══════════ EFFECTS ═══════════
     f(c, W, H, local, amount): the frame drawn so far is on c. */
  function copyOf(c, W, H) { var S = scratch("fx-copy", W, H); S.getContext("2d").drawImage(c.canvas, 0, 0, W, H); return S; }
  function grain(c, W, H, local, a, mode) {
    var g = scratch("grain", 160, 160), x = g.getContext("2d"), d = x.createImageData(160, 160), seed = Math.floor(local * 24);
    for (var i = 0; i < d.data.length; i += 4) { var v = rnd(i + seed * 7919, 9) * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    c.save(); c.globalAlpha = a; c.globalCompositeOperation = mode || "overlay";
    var pat = c.createPattern(g, "repeat"); c.fillStyle = pat; c.fillRect(0, 0, W, H);
    c.restore();
  }
  function vignette(c, W, H, a) {
    c.save(); c.translate(W / 2, H / 2); c.scale(1, H / W);
    var g = c.createRadialGradient(0, 0, 0, 0, 0, W / 2 * Math.SQRT2);
    g.addColorStop(0.45, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0," + a + ")");
    c.fillStyle = g; c.fillRect(-W / 2, -W / 2, W, W); c.restore();
  }
  function redraw(c, W, H, fn) { var S = copyOf(c, W, H); c.save(); c.fillStyle = "#000"; c.fillRect(0, 0, W, H); fn(S); c.restore(); }
  function particles(c, W, H, local, n, draw) { for (var i = 0; i < n; i++) draw(i, rnd(i, 11), rnd(i, 12), rnd(i, 13)); }

  var E = {
    shake: function (c, W, H, t, a) {
      var i = Math.floor(t * 30), amp = W * 0.025 * a;
      redraw(c, W, H, function (S) { c.drawImage(S, (rnd(i, 1) - 0.5) * 2 * amp - amp, (rnd(i, 2) - 0.5) * 2 * amp - amp, W + amp * 2, H + amp * 2); });
    },
    "zoom-pulse": function (c, W, H, t, a) {
      var s = 1 + 0.08 * a * Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 / 0.6)), 4);
      redraw(c, W, H, function (S) { c.drawImage(S, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s); });
    },
    "slow-zoom": function (c, W, H, t, a) {
      var s = 1 + 0.03 * a * t;
      redraw(c, W, H, function (S) { c.drawImage(S, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s); });
    },
    heartbeat: function (c, W, H, t, a) {
      var b = t % 1, g = function (x) { return Math.exp(-Math.pow((b - x) / 0.05, 2)); }, s = 1 + 0.07 * a * (g(0.1) + 0.7 * g(0.3));
      redraw(c, W, H, function (S) { c.drawImage(S, W / 2 - W * s / 2, H / 2 - H * s / 2, W * s, H * s); });
    },
    "camera-sway": function (c, W, H, t, a) {
      var r = 0.02 * a * Math.sin(t * 1.7), dx = W * 0.015 * a * Math.sin(t * 1.1), s = 1.06;
      redraw(c, W, H, function (S) { c.translate(W / 2 + dx, H / 2); c.rotate(r); c.scale(s, s); c.drawImage(S, -W / 2, -H / 2, W, H); });
    },
    flash: function (c, W, H, t, a) { c.fillStyle = "rgba(255,255,255," + a * Math.pow(Math.max(0, Math.cos(t * Math.PI * 2 / 0.5)), 6) + ")"; c.fillRect(0, 0, W, H); },
    strobe: function (c, W, H, t, a) { if (Math.floor(t * 12) % 2) { c.fillStyle = "rgba(255,255,255," + 0.5 * a + ")"; c.fillRect(0, 0, W, H); } },
    blur: function (c, W, H, t, a) { if (!canFilter) return; redraw(c, W, H, function (S) { c.filter = "blur(" + (H * 0.012 * a).toFixed(1) + "px)"; c.drawImage(S, 0, 0); }); },
    "black-white": function (c, W, H, t, a) {
      if (canFilter) { redraw(c, W, H, function (S) { c.filter = "grayscale(" + a + ") contrast(1.1)"; c.drawImage(S, 0, 0); }); return; }
      c.save(); c.globalCompositeOperation = "saturation"; c.fillStyle = "rgba(128,128,128," + a + ")"; c.fillRect(0, 0, W, H); c.restore();
    },
    invert: function (c, W, H, t, a) { c.save(); c.globalCompositeOperation = "difference"; c.fillStyle = "rgba(255,255,255," + a + ")"; c.fillRect(0, 0, W, H); c.restore(); },
    rainbow: function (c, W, H, t, a) {
      c.save(); c.globalCompositeOperation = "hue"; c.globalAlpha = 0.5 * a;
      c.fillStyle = "hsl(" + ((t * 120) % 360) + ",90%,50%)"; c.fillRect(0, 0, W, H); c.restore();
    },
    "dreamy-glow": function (c, W, H, t, a) {
      var S = copyOf(c, W, H);
      c.save(); c.globalCompositeOperation = "screen"; c.globalAlpha = 0.55 * a;
      filtered(c, "blur(" + (H * 0.02).toFixed(1) + "px)"); c.drawImage(S, 0, 0); c.restore();
    },
    vhs: function (c, W, H, t, a) {
      var i = Math.floor(t * 20);
      rgbShift(c, c.canvas, W, H, W * 0.006 * a);
      c.save();
      c.fillStyle = "rgba(0,0,0," + 0.18 * a + ")";
      var gap = Math.max(2, Math.round(H / 240));
      for (var y = 0; y < H; y += gap * 2) c.fillRect(0, y, W, gap);
      var by = ((t * 0.35) % 1.2 - 0.1) * H, bh = H * 0.05;   // the rolling band
      var S = copyOf(c, W, H);
      c.drawImage(S, 0, by, W, bh, (rnd(i, 3) - 0.5) * W * 0.04 * a, by, W, bh);
      c.fillStyle = "rgba(255,255,255," + 0.08 * a + ")"; c.fillRect(0, by, W, bh);
      c.restore();
      grain(c, W, H, t, 0.12 * a, "overlay");
      c.save(); c.globalCompositeOperation = "soft-light"; c.fillStyle = "rgba(80,40,140," + 0.25 * a + ")"; c.fillRect(0, 0, W, H); c.restore();
    },
    "old-film": function (c, W, H, t, a) {
      if (canFilter) redraw(c, W, H, function (S) { c.filter = "sepia(" + 0.85 * a + ") contrast(1.08)"; c.drawImage(S, 0, 0); });
      else { c.save(); c.globalCompositeOperation = "color"; c.fillStyle = "rgba(160,120,70," + 0.6 * a + ")"; c.fillRect(0, 0, W, H); c.restore(); }
      grain(c, W, H, t, 0.22 * a, "overlay");
      var i = Math.floor(t * 18);
      c.save(); c.strokeStyle = "rgba(255,250,235," + 0.35 * a + ")"; c.lineWidth = Math.max(1, W * 0.0018);
      for (var s = 0; s < 3; s++) if (rnd(i * 5 + s, 4) > 0.45) { var x = rnd(i * 3 + s, 5) * W; c.beginPath(); c.moveTo(x, 0); c.lineTo(x + (rnd(s, 6) - 0.5) * W * 0.02, H); c.stroke(); }
      c.restore();
      c.fillStyle = "rgba(0,0,0," + (rnd(i, 7) * 0.12 * a) + ")"; c.fillRect(0, 0, W, H);   // the flicker
      vignette(c, W, H, 0.65 * a);
    },
    "film-grain": function (c, W, H, t, a) { grain(c, W, H, t, 0.25 * a, "overlay"); },
    "super-8": function (c, W, H, t, a) {
      var i = Math.floor(t * 18), j = H * 0.004 * a;
      redraw(c, W, H, function (S) { c.drawImage(S, (rnd(i, 1) - 0.5) * j * 2 - j, (rnd(i, 2) - 0.5) * j * 2 - j, W + j * 2, H + j * 2); });
      c.save(); c.globalCompositeOperation = "soft-light"; c.fillStyle = "rgba(255,170,80," + 0.45 * a + ")"; c.fillRect(0, 0, W, H); c.restore();
      grain(c, W, H, t, 0.18 * a, "overlay");
      vignette(c, W, H, 0.7 * a);
    },
    "light-leak": function (c, W, H, t, a) { leak(c, W, H, t * 0.9, 0.85 * a); },
    "rgb-split": function (c, W, H, t, a) { rgbShift(c, c.canvas, W, H, W * (0.008 + 0.012 * Math.abs(Math.sin(t * 3))) * a); },
    glitch: function (c, W, H, t, a) {
      var i = Math.floor(t * 15), on = rnd(i, 1) > 0.35;
      if (!on) return;
      var S = copyOf(c, W, H);
      for (var s = 0; s < 8; s++) {
        if (rnd(i * 11 + s, 2) > 0.6) continue;
        var y = Math.floor(rnd(i * 5 + s, 3) * H), h = Math.max(2, Math.floor(rnd(i * 7 + s, 4) * H * 0.07));
        c.drawImage(S, 0, y, W, h, (rnd(i + s, 5) - 0.5) * W * 0.18 * a, y, W, h);
      }
      rgbShift(c, c.canvas, W, H, W * 0.01 * a * (rnd(i, 6) > 0.5 ? 1 : -1));
    },
    pixelate: function (c, W, H, t, a) { var S = copyOf(c, W, H); pixel(c, S, W, H, Math.max(2, Math.round(a * Math.min(W, H) / 40))); },
    static: function (c, W, H, t, a) { grain(c, W, H, t * 3, 0.6 * a, "source-over"); grain(c, W, H, t * 5, 0.3 * a, "overlay"); },
    "split-2": tiles(1, 2), "split-3": tiles(1, 3), "split-4": tiles(2, 2), "split-9": tiles(3, 3),
    mirror: function (c, W, H, t, a) {
      var S = copyOf(c, W, H);
      c.save(); c.translate(W, 0); c.scale(-1, 1); c.drawImage(S, W / 2, 0, W / 2, H, 0, 0, W / 2, H); c.restore();
    },
    letterbox: function (c, W, H, t, a) {
      var bar = H * 0.12 * a * out3(clamp(t / 0.6, 0, 1));
      c.fillStyle = "#000"; c.fillRect(0, 0, W, bar); c.fillRect(0, H - bar, W, bar);
    },
    "vignette-pulse": function (c, W, H, t, a) { vignette(c, W, H, (0.55 + 0.35 * Math.sin(t * 4)) * a); },
    snow: function (c, W, H, t, a) {
      c.save(); c.fillStyle = "rgba(255,255,255," + 0.9 * a + ")";
      particles(c, W, H, t, 90, function (i, r1, r2, r3) {
        var y = ((r2 + t * (0.06 + r3 * 0.08)) % 1.1 - 0.05) * H, x = (r1 * W + Math.sin(t * 1.3 + i) * W * 0.02 + W) % W, s = (1 + r3 * 3) * W / 720;
        c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
      });
      c.restore();
    },
    rain: function (c, W, H, t, a) {
      c.save(); c.strokeStyle = "rgba(200,220,255," + 0.55 * a + ")"; c.lineWidth = Math.max(1, W / 540);
      particles(c, W, H, t, 110, function (i, r1, r2, r3) {
        var y = ((r2 + t * (0.9 + r3 * 0.6)) % 1.2 - 0.1) * H, x = r1 * W, l = H * (0.03 + r3 * 0.03);
        c.beginPath(); c.moveTo(x, y); c.lineTo(x - l * 0.15, y + l); c.stroke();
      });
      c.fillStyle = "rgba(20,30,50," + 0.15 * a + ")"; c.fillRect(0, 0, W, H);
      c.restore();
    },
    confetti: function (c, W, H, t, a) {
      var cols = ["#dc143c", "#e8c547", "#2f80ed", "#2be36e", "#ff8ac2", "#ffffff"];
      c.save(); c.globalAlpha = a;
      particles(c, W, H, t, 70, function (i, r1, r2, r3) {
        var y = ((r2 * 0.5 + t * (0.25 + r3 * 0.2)) % 1.2 - 0.1) * H, x = r1 * W + Math.sin(t * 2 + i) * W * 0.03, s = W * (0.008 + r3 * 0.008);
        c.save(); c.translate(x, y); c.rotate(t * (2 + r3 * 4) + i); c.fillStyle = cols[i % cols.length]; c.fillRect(-s, -s / 2, s * 2, s); c.restore();
      });
      c.restore();
    },
    sparkle: function (c, W, H, t, a) {
      c.save(); c.globalCompositeOperation = "lighter";
      particles(c, W, H, t, 26, function (i, r1, r2, r3) {
        var k = Math.pow(Math.max(0, Math.sin(t * (2 + r3 * 3) + i)), 8) * a; if (k < 0.02) return;
        var x = r1 * W, y = r2 * H, s = W * (0.01 + r3 * 0.02) * k;
        c.strokeStyle = "rgba(255,250,220," + k + ")"; c.lineWidth = Math.max(1, W / 600);
        c.beginPath(); c.moveTo(x - s * 2, y); c.lineTo(x + s * 2, y); c.moveTo(x, y - s * 2); c.lineTo(x, y + s * 2); c.stroke();
        var g = c.createRadialGradient(x, y, 0, x, y, s * 1.5); g.addColorStop(0, "rgba(255,255,235," + k + ")"); g.addColorStop(1, "rgba(255,255,235,0)");
        c.fillStyle = g; c.beginPath(); c.arc(x, y, s * 1.5, 0, Math.PI * 2); c.fill();
      });
      c.restore();
    },
    bokeh: function (c, W, H, t, a) {
      var cols = ["255,200,120", "255,140,170", "150,200,255", "255,240,200"];
      c.save(); c.globalCompositeOperation = "screen";
      particles(c, W, H, t, 18, function (i, r1, r2, r3) {
        var x = (r1 * W + t * W * 0.01 * (r3 - 0.5)) % W, y = (r2 * H + Math.sin(t * 0.5 + i) * H * 0.02), s = W * (0.04 + r3 * 0.08);
        var g = c.createRadialGradient(x, y, 0, x, y, s); g.addColorStop(0, "rgba(" + cols[i % 4] + "," + 0.35 * a + ")"); g.addColorStop(0.85, "rgba(" + cols[i % 4] + "," + 0.2 * a + ")"); g.addColorStop(1, "rgba(" + cols[i % 4] + ",0)");
        c.fillStyle = g; c.beginPath(); c.arc(x, y, s, 0, Math.PI * 2); c.fill();
      });
      c.restore();
    }
  };
  function tiles(rows, cols) {
    return function (c, W, H) {
      var S = copyOf(c, W, H), w = W / cols, h = H / rows;
      c.fillStyle = "#000"; c.fillRect(0, 0, W, H);
      // each tile shows the middle of the picture at the tile's own shape
      var sw = Math.min(W, H * (w / h)), sh = sw * (h / w);
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) c.drawImage(S, (W - sw) / 2, (H - sh) / 2, sw, sh, x * w, y * h, w + 0.5, h + 0.5);
    };
  }

  var EFFECTS = [
    ["Basic", [["shake", "Shake"], ["zoom-pulse", "Zoom pulse"], ["slow-zoom", "Slow zoom"], ["heartbeat", "Heartbeat"], ["camera-sway", "Sway"],
      ["flash", "Flash"], ["strobe", "Strobe"], ["blur", "Blur"]]],
    ["Colour", [["black-white", "Black and white"], ["invert", "Invert"], ["rainbow", "Rainbow"], ["dreamy-glow", "Dreamy glow"]]],
    ["Retro", [["vhs", "VHS"], ["old-film", "Old film"], ["film-grain", "Film grain"], ["super-8", "Super 8"], ["light-leak", "Light leak"]]],
    ["Glitch", [["rgb-split", "RGB split"], ["glitch", "Glitch"], ["pixelate", "Pixelate"], ["static", "Static"]]],
    ["Split", [["split-2", "Split 2"], ["split-3", "Split 3"], ["split-4", "Split 4"], ["split-9", "Split 9"], ["mirror", "Mirror"]]],
    ["Frame", [["letterbox", "Cinema bars"], ["vignette-pulse", "Vignette pulse"]]],
    ["Particles", [["snow", "Snow"], ["rain", "Rain"], ["confetti", "Confetti"], ["sparkle", "Sparkle"], ["bokeh", "Bokeh"]]],
    // ccl19 (0.49.0): CapCut's Body effects, drawn around the person the cutout finds
    ["Body", [["body-outline", "Outline"], ["body-neon", "Neon edge"], ["body-clones", "Clones"], ["body-shadow", "Shadow"], ["body-glow", "Glow"]]]
  ];

  /* ─── Body effects (ccl19) ───
     The person is found in the frame by the cutout model (cutout.js); while
     it is still loading the frame is left as it is. */
  var bodyCv = {};
  function bodyCanvas(name, W, H) {
    var c = bodyCv[name];
    if (!c) c = bodyCv[name] = document.createElement("canvas");
    if (c.width !== W) c.width = W;
    if (c.height !== H) c.height = H;
    var x = c.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = "source-over";
    x.globalAlpha = 1;
    x.filter = "none";
    x.clearRect(0, 0, W, H);
    return c;
  }
  function personMask(c, W, H, local) {
    var C = global.SenotelCutout;
    if (!C || (W < 240 && !C.ready())) return null;   // a tile in the Effects sheet never downloads the model by itself
    return C.mask(c.canvas, W, H, null, { stream: "fx-body", index: Math.round(local * 30) });
  }
  // the person alone, cut from the frame
  function personLayer(c, m, W, H) {
    var p = bodyCanvas("person", W, H), x = p.getContext("2d");
    x.drawImage(c.canvas, 0, 0, W, H);
    x.globalCompositeOperation = "destination-in";
    x.drawImage(m, 0, 0, W, H);
    return p;
  }
  // a band just outside the person's edge, of colour col, `w` pixels wide
  function edgeBand(m, W, H, w, col) {
    var b = bodyCanvas("band", W, H), x = b.getContext("2d");
    x.filter = "blur(" + w.toFixed(1) + "px)";
    for (var i = 0; i < 4; i++) x.drawImage(m, 0, 0, W, H);   // a blur drawn four times: a wide, solid halo
    x.filter = "none";
    x.globalCompositeOperation = "source-in";
    x.fillStyle = col;
    x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = "destination-out";
    x.drawImage(m, 0, 0, W, H);
    return b;
  }
  E["body-outline"] = function (c, W, H, t, a) {
    var m = personMask(c, W, H, t); if (!m) return;
    c.globalAlpha = a; c.drawImage(edgeBand(m, W, H, Math.max(2, W * 0.006), "#ffffff"), 0, 0);
  };
  E["body-neon"] = function (c, W, H, t, a) {
    var m = personMask(c, W, H, t); if (!m) return;
    var hue = Math.round((t * 90) % 360);
    var band = edgeBand(m, W, H, Math.max(2, W * 0.008), "hsl(" + hue + ", 95%, 60%)");
    c.globalAlpha = a; c.globalCompositeOperation = "screen";
    c.filter = "blur(" + (W * 0.01).toFixed(1) + "px)"; c.drawImage(band, 0, 0);
    c.filter = "none"; c.drawImage(band, 0, 0);
  };
  E["body-clones"] = function (c, W, H, t, a) {
    var m = personMask(c, W, H, t); if (!m) return;
    var p = personLayer(c, m, W, H), off = W * 0.2;
    var keep = bodyCanvas("keep", W, H); keep.getContext("2d").drawImage(p, 0, 0);
    c.globalAlpha = 0.55 * a; c.drawImage(keep, -off, 0); c.drawImage(keep, off, 0);
    c.globalAlpha = 1; c.drawImage(keep, 0, 0);   // the person back in front of their copies
  };
  E["body-shadow"] = function (c, W, H, t, a) {
    var m = personMask(c, W, H, t); if (!m) return;
    var p = personLayer(c, m, W, H);
    var keep = bodyCanvas("keep", W, H); keep.getContext("2d").drawImage(p, 0, 0);
    var s = bodyCanvas("shadow", W, H), x = s.getContext("2d");
    x.drawImage(m, 0, 0, W, H); x.globalCompositeOperation = "source-in"; x.fillStyle = "#000"; x.fillRect(0, 0, W, H);
    c.globalAlpha = 0.5 * a; c.filter = "blur(" + (W * 0.008).toFixed(1) + "px)"; c.drawImage(s, W * 0.035, H * 0.02);
    c.filter = "none"; c.globalAlpha = 1; c.drawImage(keep, 0, 0);
  };
  E["body-glow"] = function (c, W, H, t, a) {
    var m = personMask(c, W, H, t); if (!m) return;
    var p = personLayer(c, m, W, H);
    c.globalAlpha = 0.6 * a; c.globalCompositeOperation = "screen";
    c.filter = "blur(" + (W * 0.02).toFixed(1) + "px) brightness(1.4)"; c.drawImage(p, 0, 0);
    c.filter = "none";
  };

  // Families share primitives, never past frames. Scrubbing and export therefore
  // have the same result, and each loop has a small fixed upper bound.
  function addEffects(group, rows, draw) {
    var g = EFFECTS.filter(function (g) { return g[0] === group; })[0];
    if (!g) { g = [group, []]; EFFECTS.push(g); }
    rows.forEach(function (row, i) {
      g[1].push(row);
      E[row[0]] = function (c, W, H, t, a) { draw(c, W, H, t, a, i); };
    });
  }
  function starPath(c, x, y, r, points, inner) {
    for (var j = 0; j < points * 2; j++) {
      var angle = j * Math.PI / points - Math.PI / 2, radius = j % 2 ? r * inner : r;
      if (!j) c.moveTo(x, y - r);
      else c.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
    c.closePath();
  }
  function wash(c, W, H, x, y, radius, colour, a) {
    var g = c.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, "rgba(" + colour + "," + a + ")");
    g.addColorStop(1, "rgba(" + colour + ",0)");
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  addEffects("Lens", [["bulge", "Bulge"], ["edge-prism", "Chromatic edge"], ["tilt-shift", "Tilt shift"], ["lens-flare", "Lens flare"],
    ["soft-focus", "Soft focus"], ["glass-ripple", "Glass ripple"], ["anamorphic", "Anamorphic flare"], ["kaleidoscope", "Kaleidoscope"]],
    function (c, W, H, t, a, i) {
      var S = copyOf(c, W, H), j, y, h = H / 32;
      if (i === 0 || i === 5) {
        c.globalAlpha = a;
        for (j = 0; j < 32; j++) {
          y = j * h;
          var k = i === 0 ? Math.sin((j + 0.5) / 32 * Math.PI) * 0.2 : Math.sin(j * 0.6 + t * 3) * 0.035;
          c.drawImage(S, 0, y, W, h, -W * k / 2, y, W * (1 + k), h + 0.5);
        }
      } else if (i === 1) {
        c.globalAlpha = a;
        clipThen(c, function () { c.rect(0, 0, W * 0.18, H); c.rect(W * 0.82, 0, W * 0.18, H); }, function () { rgbShift(c, S, W, H, W * 0.025 * a); });
      } else if (i === 2 || i === 4) {
        c.globalAlpha = a * (i === 4 ? 0.65 : 1);
        filtered(c, "blur(" + (Math.min(W, H) * 0.018).toFixed(1) + "px)");
        if (i === 2) clipThen(c, function () { c.rect(0, 0, W, H * 0.26); c.rect(0, H * 0.74, W, H * 0.26); }, function () { c.drawImage(S, 0, 0); });
        else c.drawImage(S, 0, 0);
      } else if (i === 3 || i === 6) {
        c.globalCompositeOperation = "screen";
        var x = W * (0.3 + 0.25 * Math.sin(t * 0.4)), cy = H * 0.3;
        wash(c, W, H, x, cy, Math.min(W, H) * 0.35, "255,210,140", a * 0.7);
        if (i === 6) { c.fillStyle = "rgba(140,200,255," + a * 0.45 + ")"; c.fillRect(0, cy, W, Math.max(1, H * 0.004)); }
        else for (j = 1; j < 5; j++) { c.strokeStyle = "rgba(160,210,255," + a * 0.3 + ")"; c.beginPath(); c.arc(W - x * j / 5, H - cy * j / 5, W * 0.02 * j, 0, Math.PI * 2); c.stroke(); }
      } else {
        c.globalAlpha = a;
        for (j = 0; j < 6; j++) {
          c.save(); c.translate(W / 2, H / 2); c.rotate(j * Math.PI / 3);
          clipThen(c, function () { c.moveTo(0, 0); c.lineTo(R(W, H) * 2, 0); c.lineTo(R(W, H), R(W, H) * 1.74); c.closePath(); }, function () { c.drawImage(S, -W / 2, -H / 2, W, H); }); c.restore();
        }
      }
    });
  addEffects("Light", [["sun-rays", "Sun rays"], ["neon-flicker", "Neon flicker"], ["flashlight", "Flashlight sweep"], ["prism", "Prism"],
    ["golden-hour", "Golden hour"], ["light-sweep", "Light sweep"], ["aurora", "Aurora"], ["stage-lights", "Stage lights"]],
    function (c, W, H, t, a, i) {
      var j, g, x = (0.5 + 0.5 * Math.sin(t * 0.8)) * W;
      if (i === 2) {
        var S = copyOf(c, W, H); shade(c, W, H, a * 0.7);
        var L = scratch("flashlight", W, H), l = L.getContext("2d"); l.drawImage(S, 0, 0);
        l.globalCompositeOperation = "destination-in";
        wash(l, W, H, x, H * 0.45, Math.min(W, H) * 0.65, "255,255,255", 1);
        c.globalAlpha = a; c.drawImage(L, 0, 0); return;
      }
      c.globalCompositeOperation = "screen";
      if (i === 0 || i === 7) {
        c.globalAlpha = a * 0.18; c.fillStyle = i === 0 ? "#ffe4a0" : "#80bfff";
        c.translate(W * 0.5, -H * 0.1);
        for (j = 0; j < 9; j++) { c.save(); c.rotate((j - 4) * 0.22 + Math.sin(t * 0.3) * 0.12); c.beginPath(); c.moveTo(0, 0); c.lineTo(-W * 0.055, H * 1.3); c.lineTo(W * 0.055, H * 1.3); c.closePath(); c.fill(); c.restore(); }
      } else if (i === 1) wash(c, W, H, W * 0.1, H * 0.5, Math.max(W, H), "255,40,100", a * (0.15 + 0.4 * rnd(Math.floor(t * 12), 31)));
      else if (i === 4) wash(c, W, H, W, 0, Math.max(W, H), "255,170,65", a * 0.65);
      else {
        g = c.createLinearGradient(0, 0, W, i === 6 ? H : 0);
        for (j = 0; j <= 6; j++) g.addColorStop(j / 6, "hsla(" + ((j * 55 + t * 25) % 360) + ",85%,65%," + a * (i === 3 ? 0.18 : 0.3) + ")");
        c.fillStyle = g;
        if (i === 5) { c.translate(x, H / 2); c.rotate(-0.3); c.fillRect(-W * 0.1, -H, W * 0.2, H * 2); }
        else c.fillRect(0, 0, W, H);
      }
    });
  addEffects("Motion", [["zoom-blur", "Zoom blur"], ["motion-echo", "Motion echo"], ["freeze-flash", "Freeze flash"], ["speed-lines", "Speed lines"],
    ["wobble", "Wobble"], ["roll", "Camera roll"], ["vertical-drift", "Vertical drift"], ["horizontal-trail", "Horizontal trail"], ["tunnel", "Tunnel"], ["impact", "Impact"]],
    function (c, W, H, t, a, i) {
      var j, S;
      if (i === 3) {
        c.strokeStyle = "rgba(255,255,255," + a * 0.65 + ")"; c.lineWidth = Math.max(1, W / 500);
        for (j = 0; j < 36; j++) { var angle = rnd(j, 71) * Math.PI * 2, r = R(W, H) * (0.45 + rnd(j, 72) * 0.3 + (t * 0.7 % 0.3)); c.beginPath(); c.moveTo(W / 2 + Math.cos(angle) * r, H / 2 + Math.sin(angle) * r); c.lineTo(W / 2 + Math.cos(angle) * r * 1.6, H / 2 + Math.sin(angle) * r * 1.6); c.stroke(); } return;
      }
      if (i === 2) { c.fillStyle = "rgba(255,255,255," + a * 0.75 * Math.pow(Math.max(0, Math.cos(t * 5)), 18) + ")"; c.fillRect(0, 0, W, H); return; }
      S = copyOf(c, W, H);
      if (i === 4 || i === 5 || i === 6 || i === 9) {
        var wave = Math.sin(t * (i === 9 ? 17 : 3));
        c.globalAlpha = a;
        place(c, S, W, H, { s: 1 + a * 0.08, rot: i === 5 ? wave * a * 0.08 : 0, dx: i === 4 || i === 9 ? wave * a * W * 0.025 : 0, dy: i === 6 ? wave * a * H * 0.035 : 0 });
      } else for (j = 1; j <= 5; j++) place(c, S, W, H, { alpha: a * (6 - j) / 35, s: i === 0 || i === 8 ? 1 + j * a * (i === 8 ? 0.16 : 0.025) : 1, dx: i === 1 || i === 7 ? j * W * a * 0.015 : 0, dy: i === 1 ? j * H * a * 0.008 : 0 });
    });
  addEffects("Retro", [["crt-lines", "CRT lines"], ["burn-edges", "Burn edges"], ["sepia-flicker", "Sepia flicker"], ["halftone", "Halftone"], ["newsprint", "Newsprint"],
    ["film-scratches", "Film scratches"], ["projector", "Projector"], ["faded-film", "Faded film"], ["gate-weave", "Gate weave"], ["tv-roll", "TV roll"]],
    function (c, W, H, t, a, i) {
      var j, S;
      if (i === 0 || i === 9) {
        c.fillStyle = "rgba(0,0,0," + a * 0.35 + ")";
        for (j = 0; j < 90; j++) c.fillRect(0, j * H / 90, W, H / 240);
        if (i === 9) { c.fillStyle = "rgba(255,255,255," + a * 0.2 + ")"; c.fillRect(0, (t * 0.23 % 1) * H, W, H * 0.09); }
      } else if (i === 1) { leak(c, W, H, t, a); vignette(c, W, H, a * 0.9); }
      else if (i === 3 || i === 4) {
        S = copyOf(c, W, H); filtered(c, i === 4 ? "grayscale(1) contrast(1.6)" : "contrast(1.25)"); c.globalAlpha = a; c.drawImage(S, 0, 0); c.filter = "none";
        // An eight-pixel pattern is tiled by canvas, avoiding frame-sized loops.
        var P = scratch("print-pattern", 8, 8), x = P.getContext("2d"); x.fillStyle = "rgba(0,0,0,0.5)"; x.beginPath(); x.arc(4, 4, i === 3 ? 1.5 : 1, 0, Math.PI * 2); x.fill();
        c.fillStyle = c.createPattern(P, "repeat"); c.fillRect(0, 0, W, H);
      } else if (i === 5) {
        c.strokeStyle = "rgba(255,240,210," + a * 0.5 + ")";
        for (j = 0; j < 8; j++) { var xx = rnd(j + Math.floor(t * 8) * 17, 41) * W; c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx + W * 0.005, H); c.stroke(); }
      } else if (i === 8) { S = copyOf(c, W, H); place(c, S, W, H, { s: 1.025, dx: (rnd(Math.floor(t * 18), 1) - 0.5) * W * 0.015 * a, alpha: a }); }
      else {
        S = copyOf(c, W, H); c.globalAlpha = a; filtered(c, i === 2 ? "sepia(0.8)" : i === 7 ? "saturate(0.55) contrast(0.8)" : "sepia(0.25)"); c.drawImage(S, 0, 0); c.filter = "none";
        shade(c, W, H, a * (i === 6 ? 0.16 : 0.06) * rnd(Math.floor(t * 18), 19));
      }
    });
  addEffects("Party", [["disco", "Disco lights"], ["balloons", "Balloons"], ["floating-hearts", "Floating hearts"], ["falling-stars", "Falling stars"],
    ["glitter", "Glitter"], ["streamers", "Streamers"], ["bubbles", "Bubbles"], ["fireworks", "Fireworks"]],
    function (c, W, H, t, a, kind) {
      c.globalAlpha = a;
      for (var j = 0; j < (kind === 4 ? 80 : 24); j++) {
        var r = rnd(j, 52), x = rnd(j, 51) * W, y = ((rnd(j, 53) - t * (0.04 + r * 0.08)) % 1 + 1) % 1 * H, size = Math.min(W, H) * (0.012 + r * 0.025);
        c.fillStyle = "hsl(" + (j * 47 % 360) + ",80%,75%)"; c.strokeStyle = c.fillStyle;
        c.save(); c.translate(x, y); c.beginPath();
        if (kind === 0) { c.restore(); c.globalCompositeOperation = "screen"; wash(c, W, H, x, y, size * 6, j % 2 ? "255,60,110" : "70,170,255", a * 0.12 * (0.5 + 0.5 * Math.sin(t * 3 + j))); continue; }
        if (kind === 2) { c.moveTo(0, size); c.bezierCurveTo(-size * 2, -size * 0.2, -size, -size * 1.7, 0, -size * 0.5); c.bezierCurveTo(size, -size * 1.7, size * 2, -size * 0.2, 0, size); }
        else if (kind === 3 || kind === 4) { c.rotate(t + j); starPath(c, 0, 0, kind === 4 ? size * 0.3 * Math.abs(Math.sin(t * 3 + j)) : size, kind === 4 ? 4 : 5, 0.4); }
        else if (kind === 5) { c.moveTo(0, 0); c.bezierCurveTo(size * 2, size, -size * 2, size * 2, 0, size * 4); c.stroke(); }
        else if (kind === 7) {
          var phase = (t * 0.6 + r) % 1; c.globalAlpha = a * (1 - phase);
          for (var q = 0; q < 10; q++) { var angle = q * Math.PI / 5; c.moveTo(Math.cos(angle) * size * phase * 4, Math.sin(angle) * size * phase * 4); c.lineTo(Math.cos(angle) * size * phase * 5, Math.sin(angle) * size * phase * 5); } c.stroke();
        } else { c.ellipse(0, 0, size, size * (kind === 1 ? 1.3 : 1), 0, 0, Math.PI * 2); if (kind === 6) c.stroke(); }
        if (kind !== 5 && kind !== 6 && kind !== 7) c.fill();
        if (kind === 1) { c.beginPath(); c.moveTo(0, size * 1.3); c.lineTo(size * 0.1, size * 3); c.stroke(); }
        c.restore();
      }
    });
  addEffects("Frame", [["film-strip", "Film strip"], ["polaroid", "Polaroid"], ["bars-sweep", "Bars sweep"], ["rounded-vignette", "Rounded vignette"],
    ["countdown", "Countdown"], ["viewfinder", "Viewfinder"], ["postcard", "Postcard"], ["double-border", "Double border"]],
    function (c, W, H, t, a, i) {
      var m = Math.min(W, H) * 0.045, j;
      c.globalAlpha = a; c.fillStyle = i === 1 || i === 6 ? "#fff8ec" : "#000"; c.strokeStyle = "#ffffff"; c.lineWidth = Math.max(1, m * 0.1);
      if (i === 3) { c.globalAlpha = 1; vignette(c, W, H, a * 0.95); return; }
      if (i === 2) { var bar = H * 0.12 * (0.5 + 0.5 * Math.sin(t)); c.fillRect(0, 0, W, bar); c.fillRect(0, H - bar, W, bar); }
      else if (i === 4) {
        c.beginPath(); c.arc(W / 2, H / 2, Math.min(W, H) * 0.3, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.moveTo(0, H / 2); c.lineTo(W, H / 2); c.stroke();
        c.fillStyle = "#ffffff"; c.font = "bold " + Math.round(Math.min(W, H) * 0.3) + "px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(3 - Math.floor(t % 3)), W / 2, H / 2);
      } else if (i === 5) {
        for (j = 0; j < 4; j++) { c.save(); c.translate(j % 2 ? W - m : m, j < 2 ? m : H - m); c.scale(j % 2 ? -1 : 1, j < 2 ? 1 : -1); c.beginPath(); c.moveTo(0, m * 2); c.lineTo(0, 0); c.lineTo(m * 2, 0); c.stroke(); c.restore(); }
      } else {
        c.fillRect(0, 0, W, m); c.fillRect(0, H - m * (i === 1 ? 3 : 1), W, m * (i === 1 ? 3 : 1)); c.fillRect(0, 0, m, H); c.fillRect(W - m, 0, m, H);
        if (i === 0) { c.fillStyle = "#e8e8e8"; for (j = 0; j < 16; j++) { c.fillRect(m * 0.25, (j + t % 1) * H / 16, m * 0.5, H / 28); c.fillRect(W - m * 0.75, (j + t % 1) * H / 16, m * 0.5, H / 28); } }
        if (i === 7) { c.strokeRect(m * 1.5, m * 1.5, W - m * 3, H - m * 3); c.strokeRect(m * 2, m * 2, W - m * 4, H - m * 4); }
      }
    });
  addEffects("Glitch", [["scan-jitter", "Scan jitter"], ["block-jump", "Block jump"], ["signal-loss", "Signal loss"], ["digital-smear", "Digital smear"], ["colour-tear", "Colour tear"], ["compression", "Compression"]],
    function (c, W, H, t, a, i) {
      var S = copyOf(c, W, H), seed = Math.floor(t * 12);
      if (i === 2) { shade(c, W, H, rnd(seed, 90) * a * 0.8); return; }
      if (i === 5) { c.globalAlpha = a; pixel(c, S, W, H, 3 + rnd(seed, 91) * 24); return; }
      for (var j = 0; j < 12; j++) {
        var y = rnd(j + seed * 13, 92) * H, h = Math.min(H - y, H * (0.01 + rnd(j, 93) * 0.05)), dx = (rnd(j + seed, 94) - 0.5) * W * 0.18 * a;
        c.globalAlpha = i === 3 ? a * 0.5 : a;
        c.drawImage(S, 0, y, W, h, dx, y, W, h);
        if (i === 4) { c.globalCompositeOperation = "screen"; c.fillStyle = "rgba(255,40,100," + a * 0.25 + ")"; c.fillRect(0, y, W, h); c.globalCompositeOperation = "source-over"; }
        if (i === 1) c.drawImage(S, W * 0.25, y, W * 0.25, h, W * 0.5, y, W * 0.25, h);
      }
    });
  addEffects("Colour", [["duotone", "Duotone"], ["warm-fade", "Warm fade"], ["cool-fade", "Cool fade"], ["bleach", "Bleach bypass"]],
    function (c, W, H, t, a, i) {
      var S = copyOf(c, W, H); c.globalAlpha = a;
      filtered(c, i === 0 ? "grayscale(1) contrast(1.3)" : i === 3 ? "saturate(0.3) contrast(1.5)" : "saturate(0.75) contrast(0.9)"); c.drawImage(S, 0, 0); c.filter = "none";
      if (i < 3) { c.globalCompositeOperation = i === 0 ? "multiply" : "screen"; c.globalAlpha = a * 0.3; c.fillStyle = i === 2 ? "#7ca9df" : i === 1 ? "#edb77c" : "#e0a5bd"; c.fillRect(0, 0, W, H); }
    });

  // Exact endpoints also work when a renderer seeks straight to the cut edge.
  function addTransition(group, id, name, draw) {
    T[id] = function (c, A, B, p, W, H) {
      if (p <= 0 || p >= 1) { c.drawImage(p <= 0 ? A : B, 0, 0, W, H); return; }
      draw(c, A, B, p, W, H);
    };
    var g = TRANSITIONS.filter(function (g) { return g[0] === group; })[0];
    g[1].push([id, name]);
  }
  [["ink", "Ink dissolve"], ["luma", "Luma dissolve"], ["cloud", "Cloud dissolve"]].forEach(function (row, kind) {
    addTransition("Effects", row[0], row[1], function (c, A, B, p, W, H) {
      c.drawImage(A, 0, 0, W, H);
      // Read only a thumbnail for luma; ink and cloud use procedural masks.
      var M = scratch("ink-mask", 96, 96), x = M.getContext("2d");
      var light;
      if (kind === 1) {
        var thumb = scratch("luma-thumb", 8, 8), tx = thumb.getContext("2d");
        tx.drawImage(B, 0, 0, 8, 8);
        try { light = tx.getImageData(0, 0, 8, 8).data; } catch (err) { light = null; }
      }
      for (var j = 0; j < 64; j++) {
        var xx = rnd(j, 101) * 96, yy = rnd(j, 102) * 96;
        if (kind === 1) {
          var brightness = light ? (light[j * 4] * 0.2126 + light[j * 4 + 1] * 0.7152 + light[j * 4 + 2] * 0.0722) / 255 : rnd(j, 103);
          x.fillStyle = "rgba(0,0,0," + clamp((p - (1 - brightness) * 0.8) * 5, 0, 1) + ")"; x.fillRect(j % 8 * 12, Math.floor(j / 8) * 12, 13, 13);
        }
        else { x.fillStyle = "#000"; x.beginPath(); x.arc(xx, yy, Math.max(0, p - rnd(j, 104) * 0.6) * (kind === 2 ? 70 : 45), 0, Math.PI * 2); x.fill(); }
      }
      var S = scratch("ink-picture", W, H), y = S.getContext("2d"); y.drawImage(B, 0, 0, W, H); y.globalCompositeOperation = "destination-in"; y.drawImage(M, 0, 0, W, H); c.drawImage(S, 0, 0);
    });
  });
  [["swirl", "Swirl"], ["ripple", "Ripple"], ["stretch-h", "Stretch across"], ["stretch-v", "Stretch up"], ["zoom-smear", "Zoom smear"], ["elastic", "Elastic zoom"]].forEach(function (row, kind) {
    addTransition("Camera", row[0], row[1], function (c, A, B, p, W, H) {
      var k = Math.sin(p * Math.PI);
      if (kind === 1) {
        place(c, A, W, H, {}); place(c, B, W, H, { alpha: inOut(p) });
        var S = scratch("ripple-picture", W, H), x = S.getContext("2d"); x.drawImage(A, 0, 0, W, H); x.globalAlpha = inOut(p); x.drawImage(B, 0, 0, W, H);
        for (var j = 0; j < 32; j++) { var h = H / 32, dx = Math.sin(j * 0.6 - p * 12) * W * 0.06 * k; c.drawImage(S, 0, j * h, W, h, dx - W * 0.07 * k, j * h, W * (1 + 0.14 * k), h + 0.5); }
      } else {
        place(c, A, W, H, { s: 1 + k * 0.3, sx: kind === 2 ? 1 + k * 1.5 : null, sy: kind === 3 ? 1 + k * 1.5 : null, rot: kind === 0 ? p * Math.PI : 0, blur: kind === 4 ? k * Math.min(W, H) * 0.025 : 0 });
        place(c, B, W, H, { alpha: inOut(p), s: 1 + k * (kind === 5 ? 0.55 : 0.3), rot: kind === 0 ? (p - 1) * Math.PI : 0, sx: kind === 2 ? 1 + k * 1.5 : null, sy: kind === 3 ? 1 + k * 1.5 : null, blur: kind === 4 ? k * Math.min(W, H) * 0.025 : 0 });
      }
    });
  });
  [["star-wipe", "Star wipe"], ["triangle-wipe", "Triangle wipe"], ["diagonal-slices", "Diagonal slices"], ["staggered-slices", "Staggered slices"], ["zigzag", "Zigzag wipe"], ["page-curl", "Page curl"], ["page-peel", "Page peel"]].forEach(function (row, kind) {
    addTransition("Wipe", row[0], row[1], function (c, A, B, p, W, H) {
      var e = inOut(p); c.drawImage(A, 0, 0, W, H);
      clipThen(c, function () {
        var j, x;
        if (kind === 0) starPath(c, W / 2, H / 2, R(W, H) * 3.3 * e, 5, 0.4);
        else if (kind === 1) { var r = R(W, H) * 4 * e; c.moveTo(W / 2, H / 2 - r); c.lineTo(W / 2 + r, H / 2 + r); c.lineTo(W / 2 - r, H / 2 + r); c.closePath(); }
        else if (kind === 2 || kind === 3) {
          for (j = 0; j < 10; j++) { var k = clamp(e * 1.5 - j * 0.05, 0, 1); if (kind === 2) { c.moveTo(0, j * H / 10); c.lineTo(W * k, j * H / 10); c.lineTo(W * k + W * 0.1, (j + 1) * H / 10); c.lineTo(0, (j + 1) * H / 10); c.closePath(); } else c.rect(0, j * H / 10, W * k, H / 10 + 1); }
        } else if (kind === 4) {
          c.moveTo(0, 0); c.lineTo(W * e, 0); for (j = 0; j <= 20; j++) c.lineTo(W * e + (j % 2 ? 1 : -1) * W * 0.035, j * H / 20); c.lineTo(0, H); c.closePath();
        } else { x = W * e; c.rect(kind === 5 ? 0 : W - x, 0, x, H); }
      }, function () { c.drawImage(B, 0, 0, W, H); });
      if (kind >= 5) {
        var edge = kind === 5 ? W * e : W * (1 - e), width = W * 0.13 * Math.sin(p * Math.PI), g = c.createLinearGradient(edge - width, 0, edge + width, 0);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.5, "rgba(0,0,0,0.45)"); g.addColorStop(0.55, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(edge - width, 0, width * 2, H);
      }
    });
  });
  [["warm-flash", "Warm flash"], ["cool-flash", "Cool flash"], ["prism-flash", "Prism flash"], ["shutter-flash", "Shutter flash"], ["glitch-bars", "Glitch bars"], ["rgb-flash", "RGB flash"], ["pixel-wave", "Pixel wave"]].forEach(function (row, kind) {
    addTransition("Effects", row[0], row[1], function (c, A, B, p, W, H) {
      var k = Math.sin(Math.PI * p), img = p < 0.5 ? A : B;
      c.drawImage(img, 0, 0, W, H);
      if (kind === 4) {
        for (var j = 0; j < 16; j++) { var h = H / 16; c.drawImage(img, 0, j * h, W, h, (rnd(j + Math.floor(p * 20), 111) - 0.5) * W * 0.3 * k, j * h, W, h + 1); }
      } else if (kind === 5) rgbShift(c, img, W, H, W * 0.06 * k);
      else if (kind === 6) pixel(c, img, W, H, 1 + Math.pow(k, 3) * 48);
      else if (kind === 3) { c.fillStyle = "rgba(0,0,0," + k + ")"; c.fillRect(0, 0, W, H * k / 2); c.fillRect(0, H * (1 - k / 2), W, H * k / 2); }
      else { c.globalCompositeOperation = "screen"; c.fillStyle = kind === 0 ? "rgba(255,195,105," + k + ")" : kind === 1 ? "rgba(155,210,255," + k + ")" : "hsla(" + Math.round(p * 360) + ",90%,80%," + k + ")"; c.fillRect(0, 0, W, H); }
    });
  });

  function effect(id, c, W, H, local, amount) {
    var fn = E[id];
    if (!fn || amount <= 0) return;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    try { fn(c, W, H, Math.max(0, local), clamp(amount == null ? 1 : amount, 0, 1)); } catch (e) {}
    c.restore();
  }

  var flat = function (groups) { var o = []; groups.forEach(function (g) { g[1].forEach(function (r) { o.push(r); }); }); return o; };
  global.SenotelFX = {
    TRANSITIONS: TRANSITIONS,
    EFFECTS: EFFECTS,
    transitionIds: flat(TRANSITIONS).map(function (r) { return r[0]; }),
    effectIds: flat(EFFECTS).map(function (r) { return r[0]; }),
    nameOf: function (id) { var r = flat(TRANSITIONS).concat(flat(EFFECTS)).filter(function (x) { return x[0] === (OLD[id] || id); })[0]; return r ? r[1] : id; },
    transition: transition,
    effect: effect,
    canFilter: canFilter,
    scratch: scratch
  };
})(typeof window !== "undefined" ? window : globalThis);
