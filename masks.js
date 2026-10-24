/* ═══════════════════════════════════════════════════════════
   masks.js — show a clip or an overlay only through a shape (ccl8, 0.38.0)
   window.SenotelMasks

   CapCut's Mask: Line (one side of a line), Mirror (a band), Circle,
   Rectangle (with rounded corners), Heart and Star, each with feathered
   edges and Invert. A mask is fractions of the picture, so it holds at any
   export size:
     { shape, x, y (centre, 0..1 of width and height), s (size, of the
       shorter side), ar (width over height), rot (degrees), feather (0..1),
       round (rectangle corners, 0..1), invert }
   apply() keeps only the inside (or only the outside, inverted) of
   whatever is already drawn on a canvas, so the preview and the export
   share it. Drawn on the device's own canvas, no library.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const SHAPES = [["none", "None"], ["line", "Line"], ["mirror", "Mirror"], ["circle", "Circle"], ["rect", "Rectangle"], ["heart", "Heart"], ["star", "Star"]];
  const DEFAULTS = { x: 0.5, y: 0.5, s: 0.6, ar: 1, rot: 0, feather: 0, round: 0, invert: false };
  const fresh = (shape) => Object.assign({ shape: shape }, DEFAULTS, shape === "rect" ? { ar: 1.4, round: 0.1 } : shape === "mirror" ? { s: 0.4 } : {});

  // the shape's size in pixels on a W x H picture
  function dims(m, W, H) {
    const base = Math.max(1, (m.s == null ? DEFAULTS.s : m.s) * Math.min(W, H));
    const ar = m.ar || 1;
    return { w: base * ar, h: base, base: base, cx: (m.x == null ? 0.5 : m.x) * W, cy: (m.y == null ? 0.5 : m.y) * H };
  }

  // The shape as a path, centred on its place and turned by its rotation
  function path(ctx, m, W, H) {
    const d = dims(m, W, H);
    const L = (W + H) * 2;   // "far enough" for the open shapes
    ctx.save();
    ctx.translate(d.cx, d.cy);
    ctx.rotate(((m.rot || 0) * Math.PI) / 180);
    ctx.beginPath();
    if (m.shape === "line") ctx.rect(-L, -L, 2 * L, L);                  // everything above the line
    else if (m.shape === "mirror") ctx.rect(-L, -d.h / 2, 2 * L, d.h);   // a band
    else if (m.shape === "circle") ctx.ellipse(0, 0, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
    else if (m.shape === "rect") {
      const r = Math.min(d.w, d.h) / 2 * Math.max(0, Math.min(1, m.round || 0));
      const x = -d.w / 2, y = -d.h / 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + d.w, y, x + d.w, y + d.h, r);
      ctx.arcTo(x + d.w, y + d.h, x, y + d.h, r);
      ctx.arcTo(x, y + d.h, x, y, r);
      ctx.arcTo(x, y, x + d.w, y, r);
      ctx.closePath();
    } else if (m.shape === "heart") {
      const w = d.w / 2, h = d.h / 2;
      ctx.moveTo(0, h * 0.95);
      ctx.bezierCurveTo(-w * 1.25, h * 0.15, -w * 0.95, -h * 1.05, 0, -h * 0.45);
      ctx.bezierCurveTo(w * 0.95, -h * 1.05, w * 1.25, h * 0.15, 0, h * 0.95);
      ctx.closePath();
    } else if (m.shape === "star") {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.42 : 1;
        const px = Math.cos(a) * (d.w / 2) * rr, py = Math.sin(a) * (d.h / 2) * rr;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
    }
    ctx.restore();
  }

  let scratch = null;
  function scratchCanvas(W, H) {
    if (!scratch) scratch = (typeof document !== "undefined" ? document.createElement("canvas") : null);
    if (!scratch) return null;
    if (scratch.width !== W) scratch.width = W;
    if (scratch.height !== H) scratch.height = H;
    return scratch;
  }

  /* Keep only the mask's inside of what is on `ctx` (W x H at 0,0), or only
     its outside when inverted; the rest becomes see-through. Feathering
     blurs the shape's edge by up to a quarter of its size. */
  function apply(ctx, m, W, H) {
    if (!m || !m.shape || m.shape === "none") return;
    const sc = scratchCanvas(W, H);
    if (!sc) return;
    const x = sc.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, W, H);
    const d = dims(m, W, H);
    const blur = Math.max(0, Math.min(1, m.feather || 0)) * d.base * 0.25;
    x.fillStyle = "#fff";
    if (blur > 0.5) {
      if ("filter" in x) { x.filter = "blur(" + blur.toFixed(1) + "px)"; path(x, m, W, H); x.fill(); x.filter = "none"; }
      else {
        // without canvas filters: the shape's blurred shadow, drawn from off the canvas
        x.shadowColor = "#fff"; x.shadowBlur = blur * 2; x.shadowOffsetX = W * 3;
        x.translate(-W * 3, 0); path(x, m, W, H); x.fill();
        x.setTransform(1, 0, 0, 1, 0, 0); x.shadowBlur = 0; x.shadowOffsetX = 0;
      }
    } else { path(x, m, W, H); x.fill(); }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.globalCompositeOperation = m.invert ? "destination-out" : "destination-in";
    ctx.drawImage(sc, 0, 0, W, H);
    ctx.restore();
  }

  // The outline the editor draws over the picture while the mask is being set
  function outline(ctx, m, box) {
    if (!m || !m.shape || m.shape === "none") return;
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.beginPath();
    ctx.rect(0, 0, box.w, box.h);
    ctx.clip();
    path(ctx, m, box.w, box.h);
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(238,234,226,0.95)";
    ctx.stroke();
    ctx.setLineDash([]);
    const d = dims(m, box.w, box.h);
    ctx.fillStyle = "#eeeae2";
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* Whether a point (pixels on a W x H picture) is inside the mask, for the
     shapes with a simple answer (the tests use it; heart and star are
     checked by drawing). */
  function inside(m, px, py, W, H) {
    if (!m || m.shape === "none") return true;
    const d = dims(m, W, H);
    const a = (-(m.rot || 0) * Math.PI) / 180;
    const dx = px - d.cx, dy = py - d.cy;
    const u = dx * Math.cos(a) - dy * Math.sin(a), v = dx * Math.sin(a) + dy * Math.cos(a);
    let ins;
    if (m.shape === "line") ins = v < 0;
    else if (m.shape === "mirror") ins = Math.abs(v) <= d.h / 2;
    else if (m.shape === "circle") ins = (u * u) / ((d.w / 2) ** 2) + (v * v) / ((d.h / 2) ** 2) <= 1;
    else if (m.shape === "rect") ins = Math.abs(u) <= d.w / 2 && Math.abs(v) <= d.h / 2;
    else return null;
    return m.invert ? !ins : ins;
  }

  global.SenotelMasks = { SHAPES: SHAPES, fresh: fresh, path: path, apply: apply, outline: outline, inside: inside, dims: dims };
})(typeof window !== "undefined" ? window : globalThis);
