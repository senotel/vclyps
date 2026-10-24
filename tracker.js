/* ═══════════════════════════════════════════════════════════
   tracker.js — follow a picked thing from frame to frame (0.39.0)
   window.SenotelTracker

   CapCut's mask tracking: put the mask on something, tap Track, and the
   mask follows it. Done on the device, so it is free for everyone: no
   model, no server, no download.

   Method: template matching by normalised cross-correlation (the classic,
   lighting-proof way). The patch under the mask at the first frame is the
   template; each next frame is searched around where the thing should be
   (its last place plus its speed). The template slowly takes on the
   thing's new look while the match is good, and holds still while the
   thing is lost (hidden, blurred), then picks it up again when it is back.

   Frames are grey: Float32Array of w*h, 0..255 (gray()).
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  function gray(rgba, w, h) {
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
    return g;
  }

  function cut(g, w, h, x0, y0, tw, th) {
    const t = new Float32Array(tw * th);
    for (let y = 0; y < th; y++) {
      const sy = Math.min(h - 1, Math.max(0, y0 + y));
      for (let x = 0; x < tw; x++) t[y * tw + x] = g[sy * w + Math.min(w - 1, Math.max(0, x0 + x))];
    }
    return t;
  }

  // the template's mean and spread, used by every comparison
  function stats(t) {
    let s = 0;
    for (let i = 0; i < t.length; i++) s += t[i];
    const mean = s / t.length;
    let v = 0;
    for (let i = 0; i < t.length; i++) { const d = t[i] - mean; v += d * d; }
    return { mean: mean, norm: Math.sqrt(v) };
  }

  /* The best place for template t (tw x th) in frame g, its top-left corner
     searched within r pixels of (px, py). Score is -1..1 (1 = the same). */
  function search(g, w, h, t, tw, th, ts, px, py, r, stride) {
    let best = { x: px, y: py, score: -2 };
    const st = stride || 1;
    const x0 = Math.max(0, px - r), x1 = Math.min(w - tw, px + r);
    const y0 = Math.max(0, py - r), y1 = Math.min(h - th, py + r);
    for (let y = y0; y <= y1; y += st) {
      for (let x = x0; x <= x1; x += st) {
        let s = 0, ss = 0, cross = 0;
        for (let j = 0; j < th; j++) {
          const row = (y + j) * w + x, trow = j * tw;
          for (let i = 0; i < tw; i++) {
            const v = g[row + i];
            s += v; ss += v * v; cross += v * t[trow + i];
          }
        }
        const n = tw * th, mean = s / n;
        const norm = Math.sqrt(Math.max(1e-6, ss - n * mean * mean));
        const score = (cross - n * mean * ts.mean) / (norm * Math.max(1e-6, ts.norm));
        if (score > best.score) best = { x: x, y: y, score: score };
      }
    }
    return best;
  }

  /* A tracker for one thing. box = {x, y, w, h} in frame pixels (its
     centre is what is reported). */
  function create(g0, w, h, box) {
    const tw = Math.max(6, Math.min(w - 2, Math.round(box.w)));
    const th = Math.max(6, Math.min(h - 2, Math.round(box.h)));
    let x = Math.round(box.x), y = Math.round(box.y);
    x = Math.max(0, Math.min(w - tw, x)); y = Math.max(0, Math.min(h - th, y));
    let tpl = cut(g0, w, h, x, y, tw, th), ts = stats(tpl);
    const first = tpl.slice();
    let vx = 0, vy = 0, lost = 0;
    return {
      step(g) {
        const px = Math.round(x + vx), py = Math.round(y + vy);
        const r = Math.max(10, Math.round(Math.max(tw, th) * (lost ? 1.2 : 0.6)));
        // every pixel: a sharp-edged thing matches at one spot only
        let b = search(g, w, h, tpl, tw, th, ts, px, py, r, 1);
        if (b.score < 0.45) {
          // not found: look wider, with the first look too, before giving up
          const fs = stats(first);
          const b2 = search(g, w, h, first, tw, th, fs, px, py, Math.round(r * 1.6), 1);
          if (b2.score > Math.max(0.55, b.score)) b = b2;
        }
        if (b.score >= 0.45) {
          vx = vx * 0.5 + (b.x - x) * 0.5; vy = vy * 0.5 + (b.y - y) * 0.5;
          x = b.x; y = b.y; lost = 0;
          if (b.score > 0.7) {
            // take on the thing's new look, slowly, so it never drifts to the background
            const now = cut(g, w, h, x, y, tw, th);
            for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * 0.85 + now[i] * 0.15;
            ts = stats(tpl);
          }
        } else { lost++; vx *= 0.5; vy *= 0.5; }
        return { cx: x + tw / 2, cy: y + th / 2, score: b.score, lost: lost > 0 };
      }
    };
  }

  global.SenotelTracker = { gray: gray, create: create, search: search, stats: stats, cut: cut };
})(typeof window !== "undefined" ? window : globalThis);
