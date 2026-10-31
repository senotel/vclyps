/* ═══════════════════════════════════════════════════════════
   speedcurve.js — speed that changes during a clip (ccl12, 0.43.0)
   window.SenotelCurve

   CapCut's Speed, Curve tab: Montage, Hero, Bullet, Jump cut, Flash in,
   Flash out, or a curve of your own. A curve is the speed at each point of
   the clip's footage:
     clip.curve = [[u, v], ...]   u = 0..1 through the footage (first 0,
                                  last 1), v = speed there (0.1..10)
   Pure time maths, no library: the time on the timeline is the integral of
   1/speed along the footage. Everything that turns timeline time into
   footage time (the picture, the sound, the playhead, captions) goes
   through srcOff / dispOff here, so a curve clip plays and exports
   frame-exact.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const MIN = 0.1, MAX = 10, K = 400;
  // the presets keep the clip's length (normalised when applied), so the edit around it does not move
  const PRESETS = [
    ["montage", "Montage", [[0, 2.2], [0.18, 2.2], [0.3, 0.45], [0.5, 0.45], [0.62, 2.2], [0.8, 2.2], [0.88, 0.6], [1, 0.6]]],
    ["hero", "Hero", [[0, 1.6], [0.32, 1.6], [0.42, 0.22], [0.58, 0.22], [0.68, 1.6], [1, 1.6]]],
    ["bullet", "Bullet", [[0, 2.4], [0.3, 2.4], [0.38, 0.15], [0.62, 0.15], [0.7, 2.4], [1, 2.4]]],
    ["jumpcut", "Jump cut", [[0, 1], [0.38, 1], [0.44, 6], [0.58, 6], [0.64, 1], [1, 1]]],
    ["flashin", "Flash in", [[0, 6], [0.28, 6], [0.45, 1], [1, 1]]],
    ["flashout", "Flash out", [[0, 1], [0.55, 1], [0.72, 6], [1, 6]]]
  ];

  const clampV = (v) => Math.max(MIN, Math.min(MAX, v));
  function segment(a, b) {
    const s = a[2];
    if (!s || s[4] !== a[0] || s[5] !== b[0]) return null;
    const value = (f) => clampV(s[0] + (s[1] - s[0]) * f * f * (3 - 2 * f));
    // Editing either handle replaces the restricted easing with a new segment.
    return Math.abs(value(s[2]) - a[1]) < 1e-9 && Math.abs(value(s[3]) - b[1]) < 1e-9 ? s : null;
  }
  function speedAt(curve, u) {
    if (!curve || !curve.length) return 1;
    if (u <= curve[0][0]) return clampV(curve[0][1]);
    for (let i = 0; i < curve.length - 1; i++) {
      const a = curve[i], b = curve[i + 1];
      if (u <= b[0]) {
        const f = b[0] > a[0] ? (u - a[0]) / (b[0] - a[0]) : 1;
        // eased between points, so a change of speed is never a jolt
        const seg = segment(a, b);
        const x = seg ? seg[2] + (seg[3] - seg[2]) * f : f;
        const e = x * x * (3 - 2 * x);
        return clampV(seg ? seg[0] + (seg[1] - seg[0]) * e : a[1] + (b[1] - a[1]) * e);
      }
    }
    return clampV(curve[curve.length - 1][1]);
  }

  /* T[k] = ∫ du / v(u) from 0 to k/K: timeline time per second of footage
     (times the footage length L gives seconds). Cached per curve. */
  const cache = new Map();
  function table(curve) {
    const key = JSON.stringify(curve);
    let T = cache.get(key);
    if (T) return T;
    T = new Float64Array(K + 1);
    let prev = 1 / speedAt(curve, 0);
    for (let k = 1; k <= K; k++) {
      const cur = 1 / speedAt(curve, k / K);
      T[k] = T[k - 1] + ((prev + cur) / 2) / K;   // trapezoids
      prev = cur;
    }
    if (cache.size > 64) cache.clear();
    cache.set(key, T);
    return T;
  }

  // timeline length of footage length L under the curve
  const length = (curve, L) => L * table(curve)[K];
  // footage seconds (from the clip's in point) reached `local` timeline seconds in
  function srcOff(curve, L, local) {
    const T = table(curve), want = Math.max(0, local / Math.max(1e-9, L));
    if (want >= T[K]) return L;
    let lo = 0, hi = K;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= want) lo = mid; else hi = mid; }
    const f = T[hi] > T[lo] ? (want - T[lo]) / (T[hi] - T[lo]) : 0;
    return L * ((lo + f) / K);
  }
  // timeline seconds at which footage second s (from the in point) is shown
  function dispOff(curve, L, s) {
    const T = table(curve), u = Math.max(0, Math.min(1, s / Math.max(1e-9, L))) * K;
    const i = Math.min(K - 1, Math.floor(u));
    return L * (T[i] + (T[i + 1] - T[i]) * (u - i));
  }
  // the speed at `local` timeline seconds in (for the preview player)
  const rateAt = (curve, L, local) => speedAt(curve, srcOff(curve, L, local) / Math.max(1e-9, L));

  // a preset's points, scaled so the clip keeps its length
  function preset(id) {
    const p = PRESETS.find((x) => x[0] === id);
    if (!p) return null;
    const pts = p[2].map((q) => q.slice());
    const f = table(pts)[K];   // timeline per footage before scaling
    return pts.map((q) => [q[0], +clampV(q[1] * f).toFixed(3)]);
  }

  // the part [a, b] of a curve (0..1), as a curve of its own (for Split)
  function sub(curve, a, b) {
    if (!curve || b - a < 1e-6) return curve;
    // Retain the original easing domain, including through repeated splits.
    // Segment data is JSON-safe so history and reload preserve the mapping.
    const cuts = [a, ...curve.filter((q) => q[0] > a && q[0] < b).map((q) => q[0]), b];
    const out = cuts.map((u) => [(u - a) / (b - a), speedAt(curve, u)]);
    for (let j = 0; j < cuts.length - 1; j++) {
      const mid = (cuts[j] + cuts[j + 1]) / 2;
      const i = curve.findIndex((q, i) => i < curve.length - 1 && mid >= q[0] && mid <= curve[i + 1][0]);
      if (i < 0) continue;
      const p = curve[i], q = curve[i + 1], seg = segment(p, q) || [p[1], q[1], 0, 1];
      const at = (u) => seg[2] + (seg[3] - seg[2]) * (u - p[0]) / (q[0] - p[0]);
      out[j][2] = [seg[0], seg[1], at(cuts[j]), at(cuts[j + 1]), out[j][0], out[j + 1][0]];
    }
    return out;
  }

  global.SenotelCurve = { MIN: MIN, MAX: MAX, PRESETS: PRESETS, speedAt: speedAt, length: length, srcOff: srcOff, dispOff: dispOff, rateAt: rateAt, preset: preset, sub: sub };
})(typeof window !== "undefined" ? window : globalThis);
