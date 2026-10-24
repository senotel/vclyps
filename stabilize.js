/* ═══════════════════════════════════════════════════════════
   stabilize.js — steady shaky footage (ccl17, 0.45.0)
   window.SenotelStab

   CapCut's Stabilize: Minimal, Recommended, Most stable. Written here, no
   library (the plan's OpenCV.js would have been a 10 MB download):
     1. measure: between each two frames (grey, about 192 px wide), a grid
        of small patches is found again by block matching, and the camera's
        shift and turn are fitted to those moves, ignoring the ones that
        disagree (a person walking through the shot);
     2. smooth: the camera's path is added up and smoothed (a Gaussian,
        wider for more stability); the correction is smooth - real;
     3. zoom: just enough to hide the edges the correction uncovers.
   The renderer applies the correction to the clip's picture, so the
   preview and the export are the same.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const LEVELS = [["off", "Off"], ["min", "Minimal"], ["rec", "Recommended"], ["max", "Most stable"]];
  const SIGMA = { min: 0.25, rec: 0.6, max: 1.4 };   // seconds of smoothing
  const AW = 192;                                     // analysis width
  const CAP = { min: 0.03, rec: 0.06, max: 0.1 };     // the furthest the picture is moved, in frame sizes
  const CAP_R = 0.05;                                 // and turned, in radians

  function gray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
    return g;
  }

  // where the patch at (x, y) of a went in b: sum of absolute differences, ±R pixels
  function match(a, b, w, h, x, y, P, R) {
    let best = Infinity, bx = 0, by = 0, second = Infinity;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (x + dx < 0 || y + dy < 0 || x + dx + P > w || y + dy + P > h) continue;
        let s = 0;
        for (let j = 0; j < P && s < best; j++) {
          const ra = (y + j) * w + x, rb = (y + dy + j) * w + x + dx;
          for (let i = 0; i < P; i++) s += Math.abs(a[ra + i] - b[rb + i]);
        }
        if (s < best) { second = best; best = s; bx = dx; by = dy; } else if (s < second) second = s;
      }
    }
    // a parabola through the best and its neighbours: the move to a tenth of a pixel
    const sadAt = (dx, dy) => {
      if (x + dx < 0 || y + dy < 0 || x + dx + P > w || y + dy + P > h) return Infinity;
      let s = 0;
      for (let j = 0; j < P; j++) { const ra = (y + j) * w + x, rb = (y + dy + j) * w + x + dx; for (let i = 0; i < P; i++) s += Math.abs(a[ra + i] - b[rb + i]); }
      return s;
    };
    const sub = (m, z, p) => { const d = m - 2 * z + p; return isFinite(d) && d > 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * d))) : 0; };
    const fx = sub(sadAt(bx - 1, by), best, sadAt(bx + 1, by)), fy = sub(sadAt(bx, by - 1), best, sadAt(bx, by + 1));
    return { dx: bx + fx, dy: by + fy, sad: best };
  }

  /* The camera between frame a and frame b (grey, w x h): how the picture
     content moved, {x, y} in pixels and r in radians, or null when there
     is too little texture to tell. */
  function estimate(a, b, w, h) {
    const P = 12, R = Math.max(6, Math.round(w * 0.06));
    const cols = 8, rows = Math.max(4, Math.round((8 * h) / w));
    const pts = [];
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const x = Math.round(R + ((w - 2 * R - P) * (gx + 0.5)) / cols), y = Math.round(R + ((h - 2 * R - P) * (gy + 0.5)) / rows);
        // skip flat patches: nothing to match on
        let mn = Infinity, mx = -Infinity;
        for (let j = 0; j < P; j += 3) for (let i = 0; i < P; i += 3) { const v = a[(y + j) * w + x + i]; if (v < mn) mn = v; if (v > mx) mx = v; }
        if (mx - mn < 12) continue;
        const m = match(a, b, w, h, x, y, P, R);
        pts.push({ x: x + P / 2 - w / 2, y: y + P / 2 - h / 2, u: m.dx, v: m.dy });
      }
    }
    if (pts.length < 6) return null;
    const median = (a) => { const s = a.slice().sort((q, z) => q - z); return s[s.length >> 1]; };
    // 1. the shift most patches agree on; patches that disagree (something moving in the shot) are left out
    const mu0 = median(pts.map((p) => p.u)), mv0 = median(pts.map((p) => p.v));
    const r0 = pts.map((p) => Math.hypot(p.u - mu0, p.v - mv0));
    const lim = Math.max(1, median(r0) * 2.5);
    const use = pts.filter((p, i) => r0[i] <= lim);
    if (use.length < 6) return { x: mu0, y: mv0, r: 0 };
    const shift = { x: median(use.map((p) => p.u)), y: median(use.map((p) => p.v)), r: 0 };
    // 2. a turn as well, only when it is small (a hand rolls a little a frame) and clearly fits better
    let n = 0, sx = 0, sy = 0, su = 0, sv = 0;
    use.forEach((p) => { n++; sx += p.x; sy += p.y; su += p.x + p.u; sv += p.y + p.v; });
    const mx = sx / n, my = sy / n, mu = su / n, mv = sv / n;
    let num = 0, den = 0;
    use.forEach((p) => {
      const x = p.x - mx, y = p.y - my, X = p.x + p.u - mu, Y = p.y + p.v - mv;
      num += x * Y - y * X; den += x * X + y * Y;
    });
    const r = Math.atan2(num, den), c = Math.cos(r), s = Math.sin(r);
    const turn = { r: r, x: mu - (c * mx - s * my), y: mv - (s * mx + c * my) };
    const errOf = (f) => use.reduce((a, p) => {
      const cc = Math.cos(f.r), ss = Math.sin(f.r);
      return a + Math.hypot(cc * p.x - ss * p.y + f.x - (p.x + p.u), ss * p.x + cc * p.y + f.y - (p.y + p.v));
    }, 0) / use.length;
    return Math.abs(r) < 0.03 && errOf(turn) < errOf(shift) * 0.75 ? turn : shift;
  }

  /* From the frame-to-frame moves (raw: [x, y, r, x, y, r...] per frame,
     in fractions of the frame and radians), the correction for each frame
     at a level: {d: [x, y, r...], zoom}. */
  function corrections(raw, fps, level) {
    const n = raw.length / 3, sig = (SIGMA[level] || SIGMA.rec) * fps;
    const path = new Float64Array(n * 3);
    for (let i = 1; i < n; i++) for (let k = 0; k < 3; k++) path[i * 3 + k] = path[(i - 1) * 3 + k] + raw[i * 3 + k];
    const half = Math.ceil(sig * 3), wts = [];
    for (let j = -half; j <= half; j++) wts.push(Math.exp(-(j * j) / (2 * sig * sig)));
    const d = new Float32Array(n * 3);
    let worst = [];
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        let s = 0, ws = 0;
        for (let j = -half; j <= half; j++) {
          // past an end the path is mirrored through the end point, so a pan carries on as a pan there
          const q = i + j;
          let v;
          if (q < 0) v = 2 * path[k] - path[Math.min(n - 1, -q) * 3 + k];
          else if (q > n - 1) v = 2 * path[(n - 1) * 3 + k] - path[Math.max(0, 2 * (n - 1) - q) * 3 + k];
          else v = path[q * 3 + k];
          s += v * wts[j + half]; ws += wts[j + half];
        }
        // capped softly: a big intended move (a pan speeding up) is let through rather than chased
        const cap = k === 2 ? CAP_R : CAP[level] || CAP.rec;
        d[i * 3 + k] = cap * Math.tanh((s / ws - path[i * 3 + k]) / cap);
      }
      worst.push(Math.abs(d[i * 3]) * 2 + Math.abs(d[i * 3 + 2]) * 1.2, Math.abs(d[i * 3 + 1]) * 2 + Math.abs(d[i * 3 + 2]) * 1.2);
    }
    worst.sort((a, b) => a - b);
    const need = worst.length ? worst[Math.floor(worst.length * 0.98)] : 0;
    return { d: d, zoom: Math.min(1.35, 1 + need + 0.01) };
  }

  // the correction for footage time s (seconds past the analysed start)
  function at(cor, fps, s) {
    const n = cor.d.length / 3;
    if (!n) return null;
    const f = Math.max(0, Math.min(n - 1, s * fps)), i = Math.floor(f), j = Math.min(n - 1, i + 1), t = f - i, d = cor.d;
    return { x: d[i * 3] * (1 - t) + d[j * 3] * t, y: d[i * 3 + 1] * (1 - t) + d[j * 3 + 1] * t, r: d[i * 3 + 2] * (1 - t) + d[j * 3 + 2] * t, z: cor.zoom };
  }

  global.SenotelStab = { LEVELS: LEVELS, AW: AW, gray: gray, estimate: estimate, corrections: corrections, at: at };
})(typeof window !== "undefined" ? window : globalThis);
