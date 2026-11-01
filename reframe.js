/* ═══════════════════════════════════════════════════════════
   vClyps: Auto reframe (ccl25, round 2)
   When a wide picture goes into a narrower frame (landscape footage in a
   9:16 edit), only a slice of it shows. Auto reframe moves that slice with
   the subject, as a calm camera operator would: it follows where the face
   (or, without a face, the motion) is, smoothly, never faster than a person
   would pan, and holds still when the subject barely moves.

   A path is [[t, x], ...]: t in the footage's own seconds, x the subject's
   centre as a fraction of the picture's width. The renderer reads it with
   at(); app.js builds it from faces (retouch.js faceCentres) or from the
   motion samples the analysis already has (fromMotion, free and instant).
   Exposes window.SenotelReframe.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const STEP = 0.2;        // seconds between path points
  const WINDOW = 1.6;      // seconds of smoothing, so it glides instead of twitching
  const MAX_PAN = 0.35;    // the most it may move, in picture widths per second
  const DEAD = 0.04;       // a subject moving less than this stays framed as it is

  // raw [[t, x or null]] at any spacing -> an even path with gaps filled
  function even(raw, t0, t1) {
    const known = raw.filter((p) => p[1] != null && isFinite(p[1])).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (let t = t0; t <= t1 + 1e-6; t += STEP) {
      let x = 0.5;
      if (known.length) {
        if (t <= known[0][0]) x = known[0][1];
        else if (t >= known[known.length - 1][0]) x = known[known.length - 1][1];
        else {
          for (let i = 0; i < known.length - 1; i++) {
            const a = known[i], b = known[i + 1];
            if (t >= a[0] && t <= b[0]) { x = a[1] + (b[1] - a[1]) * ((t - a[0]) / Math.max(1e-6, b[0] - a[0])); break; }
          }
        }
      }
      out.push([+t.toFixed(3), x]);
    }
    return out;
  }

  // the camera's path: averaged over WINDOW, a dead zone, and a speed limit
  function smooth(raw, t0, t1) {
    const pts = even(raw, t0, t1);
    if (pts.length < 2) return pts.length ? pts : [[t0, 0.5]];
    const half = Math.max(1, Math.round(WINDOW / STEP / 2));
    const avg = pts.map((p, i) => {
      let s = 0, n = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) { s += pts[j][1]; n++; }
      return [p[0], s / n];
    });
    // hold still inside the dead zone, then never pan faster than MAX_PAN
    const out = [[avg[0][0], avg[0][1]]];
    let cur = avg[0][1];
    for (let i = 1; i < avg.length; i++) {
      const want = avg[i][1];
      if (Math.abs(want - cur) > DEAD) {
        const limit = MAX_PAN * (avg[i][0] - avg[i - 1][0]);
        cur += Math.max(-limit, Math.min(limit, want - cur));
      }
      out.push([avg[i][0], +cur.toFixed(4)]);
    }
    return out;
  }

  // where the subject is at footage time t
  function at(path, t) {
    if (!path || !path.length) return 0.5;
    if (t <= path[0][0]) return path[0][1];
    const last = path[path.length - 1];
    if (t >= last[0]) return last[1];
    const i = Math.min(path.length - 2, Math.max(0, Math.floor((t - path[0][0]) / STEP)));
    for (let k = Math.max(0, i - 1); k < path.length - 1; k++) {
      const a = path[k], b = path[k + 1];
      if (t >= a[0] && t <= b[0]) return a[1] + (b[1] - a[1]) * ((t - a[0]) / Math.max(1e-6, b[0] - a[0]));
    }
    return last[1];
  }

  /* From the analysis's motion samples ({t, mcx, mot}): only samples with
     real motion say where the action is; still ones are gaps to fill. */
  function fromMotion(samples, t0, t1) {
    const raw = (samples || []).filter((s) => s.t >= t0 - 1 && s.t <= t1 + 1)
      .map((s) => [s.t, s.mot > 0.03 && s.mcx != null ? s.mcx : null]);
    return smooth(raw, t0, t1);
  }

  global.SenotelReframe = { STEP: STEP, smooth: smooth, at: at, fromMotion: fromMotion };
})(typeof window !== "undefined" ? window : globalThis);
