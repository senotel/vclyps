/* ═══════════════════════════════════════════════════════════
   masks.js — show a clip or an overlay only through a shape (ccl8, 0.38.0;
   more shapes, handles and drawn shapes in 0.39.0)
   window.SenotelMasks

   CapCut's Mask: Line (one side of a line), Mirror (a band), Circle,
   Rectangle (with rounded corners), Heart, Star and nine more, plus Custom,
   a shape drawn with a finger. Each has feathered edges and Invert. A mask
   is fractions of the picture, so it holds at any export size:
     { shape, x, y (centre, 0..1 of width and height), s (size, of the
       shorter side), ar (width over height), rot (degrees), feather (0..1),
       round (rectangle corners, 0..1), invert,
       pts (Custom only: the outline as [u, v, u, v...], each -0.5..0.5 of
       the shape's width and height) }
   apply() keeps only the inside (or only the outside, inverted) of
   whatever is already drawn on a canvas, so the preview and the export
   share it. Drawn on the device's own canvas, no library.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const SHAPES = [["none", "None"], ["line", "Line"], ["mirror", "Mirror"], ["circle", "Circle"], ["rect", "Rectangle"],
    ["heart", "Heart"], ["star", "Star"], ["diamond", "Diamond"], ["triangle", "Triangle"], ["hexagon", "Hexagon"],
    ["moon", "Moon"], ["flower", "Flower"], ["bubble", "Bubble"], ["bolt", "Lightning"], ["plus", "Plus"], ["custom", "Custom"]];
  const DEFAULTS = { x: 0.5, y: 0.5, s: 0.6, ar: 1, rot: 0, feather: 0, round: 0, invert: false };
  const OWN = { rect: { ar: 1.4, round: 0.1 }, mirror: { s: 0.4 }, bubble: { ar: 1.3 }, triangle: { ar: 1.1 } };
  const fresh = (shape) => Object.assign({ shape: shape }, DEFAULTS, OWN[shape] || {});
  // shapes with a width of their own (Line and Mirror run edge to edge)
  const hasWidth = (shape) => shape !== "line" && shape !== "mirror";

  // the shape's size in pixels on a W x H picture
  function dims(m, W, H) {
    const base = Math.max(1, (m.s == null ? DEFAULTS.s : m.s) * Math.min(W, H));
    const ar = m.ar || 1;
    return { w: base * ar, h: base, base: base, cx: (m.x == null ? 0.5 : m.x) * W, cy: (m.y == null ? 0.5 : m.y) * H };
  }

  function poly(ctx, pts, w, h) {
    for (let i = 0; i < pts.length; i += 2) {
      if (i) ctx.lineTo(pts[i] * w, pts[i + 1] * h); else ctx.moveTo(pts[i] * w, pts[i + 1] * h);
    }
    ctx.closePath();
  }
  // a smooth closed curve through the points (midpoint quadratics)
  function smoothClosed(ctx, pts, w, h) {
    const n = pts.length / 2;
    if (n < 3) return;
    const P = (i) => [pts[((i + n) % n) * 2] * w, pts[((i + n) % n) * 2 + 1] * h];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const s = mid(P(n - 1), P(0));
    ctx.moveTo(s[0], s[1]);
    for (let i = 0; i < n; i++) {
      const p = P(i), q = mid(P(i), P(i + 1));
      ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
    }
    ctx.closePath();
  }

  const BOLT = [0.14, -0.5, -0.3, 0.08, -0.02, 0.08, -0.16, 0.5, 0.32, -0.12, 0.04, -0.12];
  const PLUS = (() => { const a = 0.17; return [-a, -0.5, a, -0.5, a, -a, 0.5, -a, 0.5, a, a, a, a, 0.5, -a, 0.5, -a, a, -0.5, a, -0.5, -a, -a, -a]; })();

  // The shape as a path, centred on its place and turned by its rotation
  function path(ctx, m, W, H) {
    const d = dims(m, W, H);
    const L = (W + H) * 2;   // "far enough" for the open shapes
    const w = d.w, h = d.h;
    ctx.save();
    ctx.translate(d.cx, d.cy);
    ctx.rotate(((m.rot || 0) * Math.PI) / 180);
    ctx.beginPath();
    switch (m.shape) {
      case "line": ctx.rect(-L, -L, 2 * L, L); break;                  // everything above the line
      case "mirror": ctx.rect(-L, -h / 2, 2 * L, h); break;            // a band
      case "circle": ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
      case "rect": {
        const r = Math.min(w, h) / 2 * Math.max(0, Math.min(1, m.round || 0));
        const x = -w / 2, y = -h / 2;
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        break;
      }
      case "heart": {
        const a = w / 2, b = h / 2;
        ctx.moveTo(0, b * 0.95);
        ctx.bezierCurveTo(-a * 1.25, b * 0.15, -a * 0.95, -b * 1.05, 0, -b * 0.45);
        ctx.bezierCurveTo(a * 0.95, -b * 1.05, a * 1.25, b * 0.15, 0, b * 0.95);
        ctx.closePath();
        break;
      }
      case "star":
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? 0.42 : 1;
          const px = Math.cos(a) * (w / 2) * rr, py = Math.sin(a) * (h / 2) * rr;
          if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath();
        break;
      case "diamond": poly(ctx, [0, -0.5, 0.5, 0, 0, 0.5, -0.5, 0], w, h); break;
      case "triangle": poly(ctx, [0, -0.5, 0.5, 0.5, -0.5, 0.5], w, h); break;
      case "hexagon": {
        const p = [];
        for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 3; p.push(Math.cos(a) / 2, Math.sin(a) / 2); }
        poly(ctx, p, w, h);
        break;
      }
      case "moon": {
        // a crescent: the outer circle, less a circle moved to the right
        const R = 1, r = 0.85, dd = 0.55;
        const ix = (R * R - r * r + dd * dd) / (2 * dd), iy = Math.sqrt(Math.max(0, R * R - ix * ix));
        const t1 = Math.atan2(-iy, ix), t2 = Math.atan2(iy, ix);
        const p2 = Math.atan2(iy, ix - dd), p1 = Math.atan2(-iy, ix - dd);
        ctx.scale(w / 2, h / 2);
        ctx.arc(0, 0, R, t1, t2, true);
        ctx.arc(dd, 0, r, p2, p1 + Math.PI * 2, false);
        ctx.closePath();
        break;
      }
      case "flower": {
        const p = [];
        for (let i = 0; i < 96; i++) {
          const a = (i / 96) * Math.PI * 2, rr = 0.36 + 0.14 * Math.abs(Math.cos(3 * a));
          p.push(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        poly(ctx, p, w, h);
        break;
      }
      case "bubble": {
        const x = -w / 2, y = -h / 2, yb = h / 2 - h * 0.24, r = Math.min(w, h) * 0.2;
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, yb, r);
        ctx.arcTo(x + w, yb, x, yb, r);
        ctx.lineTo(-w * 0.04, yb);
        ctx.lineTo(-w * 0.26, h / 2);
        ctx.lineTo(-w * 0.22, yb);
        ctx.arcTo(x, yb, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
        break;
      }
      case "bolt": poly(ctx, BOLT, w, h); break;
      case "plus": poly(ctx, PLUS, w, h); break;
      case "custom": if (m.pts && m.pts.length >= 6) smoothClosed(ctx, m.pts, w, h); break;
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

  /* The handles CapCut puts on a mask, in picture pixels (W x H), `gap`
     pixels clear of the shape: w = width (right edge), h = height (top
     edge), round = corners (rectangle), feather (below), rot (turn). */
  function handles(m, W, H, gap) {
    if (!m || !m.shape || m.shape === "none") return [];
    const d = dims(m, W, H);
    const a = ((m.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    const at = (id, u, v) => ({ id: id, x: d.cx + u * c - v * s, y: d.cy + u * s + v * c });
    const open = !hasWidth(m.shape);
    const hh = m.shape === "line" ? 0 : d.h / 2;
    const out = [];
    if (m.shape !== "line") out.push(at("h", 0, -hh - gap * 0.6));
    if (!open) out.push(at("w", d.w / 2 + gap * 0.6, 0));
    if (m.shape === "rect") out.push(at("round", -d.w / 2 - gap * 0.6, -hh - gap * 0.6));
    out.push(at("feather", 0, hh + gap * (1 + (m.feather || 0))));
    out.push(at("rot", open ? Math.min(W, H) * 0.32 : d.w / 2 + gap * 0.8, open ? 0 : hh + gap * 0.8));
    return out;
  }

  // a small round handle with its own sign drawn in it
  function handleDot(ctx, h, r) {
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.fillStyle = "#eeeae2";
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = "#151614"; ctx.fillStyle = "#151614";
    ctx.lineWidth = Math.max(1.4, r * 0.16); ctx.lineCap = "round"; ctx.lineJoin = "round";
    const k = r * 0.45;
    ctx.beginPath();
    if (h.id === "feather") {           // two chevrons down: soften
      ctx.moveTo(-k, -k * 0.6); ctx.lineTo(0, 0); ctx.lineTo(k, -k * 0.6);
      ctx.moveTo(-k, k * 0.2); ctx.lineTo(0, k * 0.8); ctx.lineTo(k, k * 0.2);
    } else if (h.id === "rot") {        // a turning arrow
      ctx.arc(0, 0, k, -Math.PI * 0.2, Math.PI * 1.3);
      ctx.moveTo(k * Math.cos(-Math.PI * 0.2) + k * 0.5, k * Math.sin(-Math.PI * 0.2));
      ctx.lineTo(k * Math.cos(-Math.PI * 0.2), k * Math.sin(-Math.PI * 0.2));
      ctx.lineTo(k * Math.cos(-Math.PI * 0.2), k * Math.sin(-Math.PI * 0.2) - k * 0.55);
    } else if (h.id === "round") {      // a rounded corner
      ctx.moveTo(-k, k); ctx.lineTo(-k, 0); ctx.arcTo(-k, -k, 0, -k, k); ctx.lineTo(k, -k);
    } else if (h.id === "w") {          // left and right
      ctx.moveTo(-k, 0); ctx.lineTo(k, 0);
      ctx.moveTo(-k * 0.4, -k * 0.5); ctx.lineTo(-k, 0); ctx.lineTo(-k * 0.4, k * 0.5);
      ctx.moveTo(k * 0.4, -k * 0.5); ctx.lineTo(k, 0); ctx.lineTo(k * 0.4, k * 0.5);
    } else {                            // up and down
      ctx.moveTo(0, -k); ctx.lineTo(0, k);
      ctx.moveTo(-k * 0.5, -k * 0.4); ctx.lineTo(0, -k); ctx.lineTo(k * 0.5, -k * 0.4);
      ctx.moveTo(-k * 0.5, k * 0.4); ctx.lineTo(0, k); ctx.lineTo(k * 0.5, k * 0.4);
    }
    ctx.stroke();
    ctx.restore();
  }

  /* The outline the editor draws over the picture while the mask is being
     set, with its handles. dpr scales the handles to the screen. */
  function outline(ctx, m, box, dpr) {
    if (!m || !m.shape || m.shape === "none") return;
    const k = dpr || 1;
    ctx.save();
    ctx.translate(box.x, box.y);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, box.w, box.h);
    ctx.clip();
    path(ctx, m, box.w, box.h);
    ctx.setLineDash([6 * k, 5 * k]);
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = "rgba(238,234,226,0.95)";
    ctx.stroke();
    ctx.setLineDash([]);
    if (m.shape === "line" || m.shape === "mirror") {
      // the line itself, solid, across the picture
      const d = dims(m, box.w, box.h), a = ((m.rot || 0) * Math.PI) / 180, L = box.w + box.h;
      ctx.translate(d.cx, d.cy); ctx.rotate(a);
      ctx.strokeStyle = "#eeeae2"; ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      if (m.shape === "line") { ctx.moveTo(-L, 0); ctx.lineTo(L, 0); }
      else { ctx.moveTo(-L, -d.h / 2); ctx.lineTo(L, -d.h / 2); ctx.moveTo(-L, d.h / 2); ctx.lineTo(L, d.h / 2); }
      ctx.stroke();
    }
    ctx.restore();
    const d = dims(m, box.w, box.h);
    ctx.fillStyle = "#eeeae2";
    ctx.beginPath();
    ctx.arc(d.cx, d.cy, 4 * k, 0, Math.PI * 2);
    ctx.fill();
    handles(m, box.w, box.h, 22 * k).forEach((h) => handleDot(ctx, h, 11 * k));
    ctx.restore();
  }

  /* Whether a point (pixels on a W x H picture) is inside the mask, for the
     shapes with a simple answer (the tests use it; the others are checked
     by drawing). */
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
    else if (m.shape === "diamond") ins = Math.abs(u) / (d.w / 2) + Math.abs(v) / (d.h / 2) <= 1;
    else return null;
    return m.invert ? !ins : ins;
  }

  /* A finger's path on a W x H picture → a Custom mask: thinned to evenly
     spaced points, then held as fractions of its own box so it moves,
     sizes and turns like any other shape. Null if it is too small. */
  function fromStroke(points, W, H) {
    if (!points || points.length < 6) return null;
    points = points.map((p) => [p[0], p[1]]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    points.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
    const bw = x1 - x0, bh = y1 - y0, mn = Math.min(W, H);
    if (bw < mn * 0.03 || bh < mn * 0.03) return null;
    // even spacing along the stroke, at most 64 points
    let len = 0;
    for (let i = 1; i < points.length; i++) len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    const n = Math.max(8, Math.min(64, Math.round(len / (mn * 0.02))));
    const step = len / n, out = [points[0]];
    let acc = 0;
    for (let i = 1; i < points.length && out.length < n; i++) {
      const a = points[i - 1], b = points[i];
      let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      while (acc + seg >= step && out.length < n) {
        const f = (step - acc) / seg;
        const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        out.push(p);
        a[0] = p[0]; a[1] = p[1];   // carry on from the new point
        seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc = 0;
      }
      acc += seg;
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const pts = [];
    out.forEach((p) => pts.push(+((p[0] - cx) / bw).toFixed(4), +((p[1] - cy) / bh).toFixed(4)));
    return Object.assign(fresh("custom"), { x: cx / W, y: cy / H, s: bh / mn, ar: bw / bh, pts: pts });
  }

  /* The mask t seconds into its clip. A tracked mask (m.track, made by
     Track: {pts: [t, x, y, t, x, y...], dx, dy}) takes its place from the
     path, moved by any drag since (dx, dy). */
  function at(m, t) {
    const tr = m && m.track, p = tr && tr.pts;
    if (!p || p.length < 3) return m;
    let x = p[p.length - 2], y = p[p.length - 1];
    if (t <= p[0]) { x = p[1]; y = p[2]; }
    else {
      for (let i = 0; i + 3 < p.length; i += 3) {
        if (t >= p[i] && t <= p[i + 3]) {
          const f = (t - p[i]) / Math.max(1e-6, p[i + 3] - p[i]);
          x = p[i + 1] + (p[i + 4] - p[i + 1]) * f;
          y = p[i + 2] + (p[i + 5] - p[i + 2]) * f;
          break;
        }
      }
    }
    return Object.assign({}, m, { x: x + (tr.dx || 0), y: y + (tr.dy || 0) });
  }

  global.SenotelMasks = { SHAPES: SHAPES, fresh: fresh, hasWidth: hasWidth, path: path, apply: apply, outline: outline, handles: handles,
    inside: inside, dims: dims, fromStroke: fromStroke, at: at };
})(typeof window !== "undefined" ? window : globalThis);
