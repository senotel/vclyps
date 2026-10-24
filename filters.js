/* ═══════════════════════════════════════════════════════════
   filters.js — CapCut-style filters as real colour tables (ccl4, 0.35.0)
   window.SenotelFilters

   Each filter is a short recipe of our own (white balance, exposure, an
   S-curve, saturation and vibrance, split toning, channel curves, black and
   white mixes, fades), baked once into a 33x33x33 colour table (a 3D LUT)
   and applied to the clip's picture on the graphics card: one table lookup
   per pixel, the way film and phone apps grade. Recipes are ours, so the
   looks are ours outright (free LUT packs are mostly attribution-only or
   unclear). Where WebGL is missing, cssOf() gives the nearest CSS filter.

   The preview and the export both call apply() from drawClipPicture, so
   they look the same. Old projects' 8 looks keep their ids.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const N = 33;   // table size per channel
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  /* ── the recipes ──
     e exposure (stops) · t temperature -1..1 (+ warm) · g tint -1..1 (+ magenta)
     c contrast -1..1 (an S-curve) · s saturation -1..1 · v vibrance -1..1
     l fade (lifts the blacks) · h dull (lowers the whites) · hue (degrees)
     sh / hi split toning [r, g, b, amount] for shadows / highlights
     bw black and white 0..1 with bwm [r, g, b] the channel mix
     mul colour multiplier [r, g, b] after black and white (sepia, cyanotype)
     cr / cg / cb / cm channel curves as [[in, out], ...] points */
  const GROUPS = ["Portrait", "Film", "Vintage", "Black and white", "Food", "Scenery", "Mood"];
  const R = [
    // Portrait
    ["clean", "Clean", "Portrait", { e: 0.05, c: 0.06, v: 0.15, t: 0.04 }, "natural fresh bright"],
    ["peach", "Peach", "Portrait", { t: 0.22, g: 0.08, s: -0.05, l: 0.03, hi: [1, 0.78, 0.65, 0.12] }, "warm soft flattering"],
    ["porcelain", "Porcelain", "Portrait", { e: 0.12, s: -0.22, t: -0.04, l: 0.04, c: -0.05 }, "pale soft bright"],
    ["honey", "Honey", "Portrait", { t: 0.32, s: 0.05, sh: [0.75, 0.5, 0.25, 0.1], c: 0.05 }, "warm golden cosy"],
    ["rosy", "Rosy", "Portrait", { g: 0.18, hi: [1, 0.7, 0.75, 0.12], e: 0.04 }, "pink romantic soft"],
    ["natural", "Natural", "Portrait", { v: 0.22, c: 0.04 }, "natural true colour"],
    ["bright-skin", "Bright", "Portrait", { e: 0.16, c: -0.04, v: 0.08 }, "bright airy clean"],
    ["milk", "Milk", "Portrait", { e: 0.1, l: 0.08, s: -0.25, c: -0.06 }, "soft pale dreamy"],
    ["blush", "Blush", "Portrait", { g: 0.12, t: 0.08, s: 0.06, l: 0.02, hi: [1, 0.82, 0.82, 0.1] }, "pink warm youthful"],
    ["golden-hour", "Golden hour", "Portrait", { t: 0.42, s: 0.1, hi: [1, 0.8, 0.45, 0.15], c: 0.06 }, "warm sunset golden"],
    ["cool-skin", "Cool skin", "Portrait", { t: -0.15, s: -0.06, e: 0.05, c: 0.04 }, "cool clean modern"],
    ["matte-portrait", "Matte", "Portrait", { l: 0.1, c: -0.1, s: -0.08 }, "matte soft calm"],
    ["studio", "Studio", "Portrait", { c: 0.16, s: -0.05, v: 0.06 }, "crisp professional clean"],
    ["glow", "Glow", "Portrait", { e: 0.14, c: -0.12, l: 0.04, t: 0.08, s: 0.04 }, "soft glowing warm"],

    // Film
    ["cinematic", "Cinematic", "Film", { c: 0.2, s: 0.08, sh: [0.2, 0.45, 0.55, 0.14], hi: [1, 0.72, 0.45, 0.1], e: -0.02 }, "cinematic dramatic film"],
    ["teal-orange", "Teal and orange", "Film", { c: 0.18, s: 0.12, sh: [0.1, 0.5, 0.6, 0.22], hi: [1, 0.65, 0.35, 0.18] }, "blockbuster bold cinematic"],
    ["gold-film", "Gold film", "Film", { t: 0.22, c: 0.1, s: 0.12, l: 0.03, cb: [[0, 0.04], [1, 0.92]] }, "warm film nostalgic"],
    ["soft-film", "Soft film", "Film", { c: -0.06, s: -0.1, l: 0.05, t: 0.06, hi: [1, 0.86, 0.75, 0.08] }, "soft film gentle"],
    ["green-film", "Green film", "Film", { g: -0.14, c: 0.08, s: -0.05, sh: [0.25, 0.5, 0.35, 0.12], l: 0.03 }, "film green indie"],
    ["bleach", "Bleach", "Film", { s: -0.48, c: 0.34, e: -0.04 }, "gritty harsh desaturated"],
    ["night-film", "Night film", "Film", { t: -0.32, e: -0.16, c: 0.2, sh: [0.15, 0.25, 0.5, 0.12] }, "night cold dark"],
    ["tungsten", "Tungsten", "Film", { t: -0.5, c: 0.06, s: 0.04 }, "cold blue film"],
    ["faded-film", "Faded film", "Film", { l: 0.13, h: 0.07, s: -0.16, c: -0.04 }, "faded old film soft"],
    ["warm-film", "Warm film", "Film", { t: 0.26, c: 0.12, s: 0.06, l: 0.02 }, "warm film cosy"],
    ["cross", "Cross process", "Film", { cr: [[0, 0], [0.5, 0.55], [1, 1]], cg: [[0, 0.02], [0.5, 0.52], [1, 0.96]], cb: [[0, 0.12], [0.5, 0.45], [1, 0.82]], s: 0.18, c: 0.1 }, "bold retro experimental"],
    ["anamorphic", "Anamorphic", "Film", { c: 0.16, sh: [0.1, 0.3, 0.6, 0.16], s: -0.04, t: -0.06 }, "cinematic cool widescreen"],
    ["eterna", "Muted cinema", "Film", { s: -0.28, c: 0.1, l: 0.03, sh: [0.25, 0.4, 0.45, 0.1] }, "muted serious cinematic"],
    ["chrome", "Chrome", "Film", { c: 0.22, s: 0.16, e: -0.03, hi: [0.9, 0.95, 1, 0.06] }, "punchy crisp film"],

    // Vintage
    ["vintage", "Vintage", "Vintage", { t: 0.3, s: -0.16, c: -0.08, l: 0.06, cb: [[0, 0.08], [1, 0.88]] }, "vintage warm faded"],
    ["polaroid", "Instant", "Vintage", { l: 0.08, t: 0.12, g: 0.06, s: -0.08, cb: [[0, 0.1], [1, 0.9]], c: -0.04 }, "instant photo nostalgic"],
    ["seventies", "70s", "Vintage", { t: 0.38, s: -0.08, c: 0.04, sh: [0.45, 0.3, 0.15, 0.15], l: 0.05 }, "retro 70s warm"],
    ["eighties", "80s", "Vintage", { g: 0.16, s: 0.16, sh: [0.2, 0.35, 0.6, 0.14], hi: [1, 0.6, 0.8, 0.12] }, "retro 80s neon"],
    ["camcorder", "Camcorder", "Vintage", { s: 0.12, c: 0.12, g: -0.05, h: 0.04, l: 0.04 }, "90s home video"],
    ["sepia", "Sepia", "Vintage", { bw: 1, mul: [1.08, 0.92, 0.72], l: 0.04, c: -0.04 }, "old sepia antique"],
    ["faded", "Faded", "Vintage", { l: 0.16, h: 0.06, s: -0.22 }, "faded washed soft"],
    ["retro-pop", "Retro pop", "Vintage", { s: 0.28, c: 0.16, t: 0.1, l: 0.04 }, "retro bold colourful"],
    ["dusty", "Dusty", "Vintage", { s: -0.3, t: 0.16, l: 0.08, c: -0.06 }, "dusty muted warm"],
    ["slide-film", "Slide film", "Vintage", { s: 0.3, c: 0.22, e: -0.04, t: 0.06 }, "saturated retro rich"],
    ["old-photo", "Old photo", "Vintage", { bw: 0.7, mul: [1.06, 0.96, 0.8], l: 0.1, h: 0.06, c: -0.06 }, "old faded photograph"],
    ["lomo", "Lomo", "Vintage", { c: 0.3, s: 0.24, cb: [[0, 0.1], [0.5, 0.45], [1, 0.9]], t: 0.06 }, "bold contrasty retro"],
    ["cream", "Cream", "Vintage", { t: 0.16, l: 0.1, s: -0.12, e: 0.06 }, "soft creamy warm"],
    ["postcard", "Postcard", "Vintage", { s: 0.12, t: 0.14, l: 0.06, hi: [1, 0.9, 0.7, 0.1] }, "sunny vintage holiday"],

    // Black and white
    ["noir", "Noir", "Black and white", { bw: 1, c: 0.28, e: -0.06 }, "black and white dramatic"],
    ["mono", "Mono", "Black and white", { bw: 1 }, "black and white classic"],
    ["high-key", "High key", "Black and white", { bw: 1, e: 0.22, c: -0.06, l: 0.04 }, "black and white bright airy"],
    ["low-key", "Low key", "Black and white", { bw: 1, e: -0.26, c: 0.3 }, "black and white dark moody"],
    ["silver", "Silver", "Black and white", { bw: 1, c: 0.12, mul: [0.97, 1, 1.04] }, "black and white cool silver"],
    ["red-filter", "Red filter", "Black and white", { bw: 1, bwm: [0.9, 0.1, 0.0], c: 0.14 }, "black and white dark skies"],
    ["green-filter", "Green filter", "Black and white", { bw: 1, bwm: [0.25, 0.7, 0.05], c: 0.08 }, "black and white soft skin"],
    ["blue-filter", "Blue filter", "Black and white", { bw: 1, bwm: [0.1, 0.3, 0.6], c: 0.1 }, "black and white moody"],
    ["sepia-mono", "Warm mono", "Black and white", { bw: 1, mul: [1.05, 0.98, 0.88], c: 0.06 }, "black and white warm"],
    ["cyanotype", "Cyanotype", "Black and white", { bw: 1, mul: [0.72, 0.92, 1.12], l: 0.04 }, "blue print artistic"],
    ["selenium", "Selenium", "Black and white", { bw: 1, sh: [0.45, 0.35, 0.55, 0.12], c: 0.1 }, "black and white rich"],
    ["matte-bw", "Matte mono", "Black and white", { bw: 1, l: 0.12, c: -0.04 }, "black and white soft matte"],
    ["charcoal", "Charcoal", "Black and white", { bw: 1, c: 0.42, e: -0.1 }, "black and white gritty strong"],
    ["paper", "Paper", "Black and white", { bw: 1, l: 0.1, h: 0.04, mul: [1.04, 1.01, 0.94] }, "black and white gentle print"],

    // Food
    ["fresh", "Fresh", "Food", { v: 0.32, e: 0.06, t: 0.06, c: 0.05 }, "fresh appetising bright"],
    ["crisp", "Crisp", "Food", { c: 0.2, v: 0.18, e: 0.03 }, "crisp clean sharp"],
    ["delicious", "Delicious", "Food", { s: 0.24, t: 0.14, c: 0.1 }, "rich warm appetising"],
    ["bakery", "Bakery", "Food", { t: 0.24, l: 0.05, s: 0.04, e: 0.05 }, "warm cosy soft"],
    ["juicy", "Juicy", "Food", { s: 0.36, v: 0.1, c: 0.06 }, "vivid colourful fruity"],
    ["cafe", "Cafe", "Food", { t: 0.2, l: 0.08, s: -0.1, c: -0.04 }, "warm matte calm"],
    ["brunch", "Brunch", "Food", { e: 0.14, t: 0.12, v: 0.15 }, "bright warm morning"],
    ["sushi", "Sushi", "Food", { t: -0.1, e: 0.08, v: 0.16, c: 0.06 }, "cool clean fresh"],
    ["spice", "Spice", "Food", { t: 0.2, s: 0.2, hue: -6, c: 0.12 }, "hot spicy rich"],
    ["dessert", "Dessert", "Food", { g: 0.12, e: 0.1, l: 0.06, s: 0.06 }, "sweet pastel soft"],
    ["greens", "Greens", "Food", { g: -0.12, v: 0.26, e: 0.04 }, "fresh green healthy"],
    ["grill", "Grill", "Food", { t: 0.3, c: 0.18, s: 0.1, e: -0.05 }, "warm smoky contrasty"],
    ["plate", "Plate", "Food", { e: 0.08, c: 0.08, s: 0.08, t: 0.02 }, "neutral clean natural"],
    ["berry", "Berry", "Food", { g: 0.1, s: 0.2, c: 0.08, hue: 4 }, "rich red pink"],

    // Scenery
    ["vivid", "Vivid", "Scenery", { s: 0.4, c: 0.06 }, "vivid colourful punchy"],
    ["warm", "Warm", "Scenery", { t: 0.3, s: 0.14, e: 0.03 }, "warm sunny"],
    ["cool", "Cool", "Scenery", { t: -0.26, s: 0.06, e: 0.02 }, "cool calm"],
    ["sky", "Sky", "Scenery", { t: -0.12, v: 0.3, c: 0.08, cb: [[0, 0], [0.6, 0.65], [1, 1]] }, "blue sky clear"],
    ["forest", "Forest", "Scenery", { g: -0.16, v: 0.24, c: 0.08, e: -0.04 }, "green nature lush"],
    ["ocean", "Ocean", "Scenery", { t: -0.18, g: -0.06, v: 0.26, sh: [0.1, 0.45, 0.55, 0.1] }, "teal water summer"],
    ["sunset", "Sunset", "Scenery", { t: 0.4, g: 0.12, s: 0.2, hi: [1, 0.6, 0.4, 0.14] }, "sunset orange warm"],
    ["snow", "Snow", "Scenery", { t: -0.16, e: 0.18, s: -0.08, c: 0.04 }, "white winter bright"],
    ["desert", "Desert", "Scenery", { t: 0.28, s: -0.12, l: 0.04, c: 0.06 }, "dry warm earthy"],
    ["city", "City", "Scenery", { t: -0.12, c: 0.2, s: -0.1 }, "urban cool contrasty"],
    ["autumn", "Autumn", "Scenery", { t: 0.3, hue: -8, s: 0.2, c: 0.06 }, "autumn orange warm"],
    ["spring", "Spring", "Scenery", { e: 0.08, v: 0.24, g: 0.04, t: 0.04 }, "fresh pastel bright"],
    ["mountain", "Mountain", "Scenery", { c: 0.18, v: 0.16, t: -0.06, e: -0.03 }, "clear crisp epic"],
    ["vivid-hdr", "HDR", "Scenery", { c: 0.24, v: 0.32, l: 0.02, h: 0.04 }, "intense detailed bold"],

    // Mood
    ["dreamy", "Dreamy", "Mood", { e: 0.06, c: -0.12, s: -0.1, l: 0.05, hi: [1, 0.9, 0.95, 0.08] }, "dreamy soft hazy"],
    ["moody", "Moody", "Mood", { e: -0.16, s: -0.24, c: 0.14, sh: [0.2, 0.4, 0.38, 0.14] }, "moody dark green"],
    ["dark", "Dark", "Mood", { e: -0.32, c: 0.2, s: -0.1 }, "dark serious intense"],
    ["midnight", "Midnight", "Mood", { t: -0.4, e: -0.2, s: -0.08, c: 0.12 }, "night blue cold"],
    ["neon-nights", "Neon nights", "Mood", { g: 0.18, s: 0.22, sh: [0.15, 0.3, 0.7, 0.18], hi: [1, 0.4, 0.8, 0.14], c: 0.14 }, "neon night party"],
    ["pastel", "Pastel", "Mood", { l: 0.12, s: -0.08, e: 0.08, g: 0.06 }, "pastel soft cute"],
    ["melancholy", "Melancholy", "Mood", { t: -0.18, s: -0.36, l: 0.04, e: -0.06 }, "sad cold quiet"],
    ["nostalgia", "Nostalgia", "Mood", { t: 0.22, l: 0.1, s: -0.14, h: 0.05 }, "nostalgic warm faded"],
    ["eerie", "Eerie", "Mood", { g: -0.2, s: -0.4, e: -0.18, c: 0.16 }, "horror green unsettling"],
    ["romance", "Romance", "Mood", { g: 0.14, t: 0.12, c: -0.08, l: 0.04, e: 0.05 }, "romantic pink warm soft"],
    ["cyber", "Cyber", "Mood", { sh: [0.1, 0.6, 0.7, 0.2], hi: [0.9, 0.4, 0.9, 0.14], c: 0.2, s: 0.1 }, "futuristic cyan magenta"],
    ["summer", "Summer", "Mood", { e: 0.1, t: 0.2, s: 0.22, c: 0.06 }, "happy summer bright warm"],
    ["winter", "Winter", "Mood", { t: -0.34, s: -0.16, e: 0.04 }, "cold winter quiet"],
    ["golden", "Golden", "Mood", { t: 0.36, s: 0.12, hi: [1, 0.82, 0.5, 0.16], c: 0.08 }, "golden warm uplifting"],
    ["haze", "Haze", "Mood", { l: 0.14, c: -0.14, t: 0.06, s: -0.06, e: 0.04 }, "hazy soft atmospheric"]
  ];

  // ── a recipe as a colour function ──
  function curveFn(pts) {
    return (x) => {
      if (x <= pts[0][0]) return pts[0][1];
      for (let i = 1; i < pts.length; i++) {
        if (x <= pts[i][0]) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          return y0 + (y1 - y0) * (x - x0) / Math.max(1e-6, x1 - x0);
        }
      }
      return pts[pts.length - 1][1];
    };
  }
  function contrast(x, c) {
    x = clamp01(x);
    if (c >= 0) { const sm = x * x * (3 - 2 * x); return x + c * (sm - x) * 1.6; }
    return 0.5 + (x - 0.5) * (1 + c);
  }
  function make(p) {
    const cr = p.cr && curveFn(p.cr), cg = p.cg && curveFn(p.cg), cb = p.cb && curveFn(p.cb), cm = p.cm && curveFn(p.cm);
    const hueRad = ((p.hue || 0) * Math.PI) / 180;
    const ch = Math.cos(hueRad), sh = Math.sin(hueRad);
    const bwm = p.bwm ? (() => { const s = p.bwm[0] + p.bwm[1] + p.bwm[2] || 1; return p.bwm.map((v) => v / s); })() : [0.2126, 0.7152, 0.0722];
    return (r, g, b) => {
      if (p.e) { const k = Math.pow(2, p.e); r *= k; g *= k; b *= k; }
      if (p.t) { r *= 1 + 0.12 * p.t; b *= 1 - 0.14 * p.t; g *= 1 + 0.02 * p.t; }
      if (p.g) { g *= 1 - 0.08 * p.g; r *= 1 + 0.02 * p.g; b *= 1 + 0.02 * p.g; }
      if (p.c) { r = contrast(r, p.c); g = contrast(g, p.c); b = contrast(b, p.c); }
      if (cm) { r = cm(clamp01(r)); g = cm(clamp01(g)); b = cm(clamp01(b)); }
      if (cr) r = cr(clamp01(r));
      if (cg) g = cg(clamp01(g));
      if (cb) b = cb(clamp01(b));
      let y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (p.s) { const k = 1 + p.s; r = y + (r - y) * k; g = y + (g - y) * k; b = y + (b - y) * k; }
      if (p.v) {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const k = 1 + p.v * (1 - clamp01((mx - mn) * 1.6));   // lifts dull colours more than vivid ones
        r = y + (r - y) * k; g = y + (g - y) * k; b = y + (b - y) * k;
      }
      if (hueRad) {
        // rotate around the grey axis (YIQ)
        const Y = 0.299 * r + 0.587 * g + 0.114 * b, I = 0.596 * r - 0.274 * g - 0.322 * b, Q = 0.211 * r - 0.523 * g + 0.312 * b;
        const I2 = I * ch - Q * sh, Q2 = I * sh + Q * ch;
        r = Y + 0.956 * I2 + 0.621 * Q2; g = Y - 0.272 * I2 - 0.647 * Q2; b = Y - 1.106 * I2 + 1.703 * Q2;
      }
      if (p.bw) {
        const gy = r * bwm[0] + g * bwm[1] + b * bwm[2];
        r += (gy - r) * p.bw; g += (gy - g) * p.bw; b += (gy - b) * p.bw;
      }
      if (p.mul) { r *= p.mul[0]; g *= p.mul[1]; b *= p.mul[2]; }
      y = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (p.sh) { const w = (1 - y) * (1 - y) * p.sh[3]; r += (p.sh[0] - 0.5) * w; g += (p.sh[1] - 0.5) * w; b += (p.sh[2] - 0.5) * w; }
      if (p.hi) { const w = y * y * p.hi[3]; r += (p.hi[0] - 0.5) * w; g += (p.hi[1] - 0.5) * w; b += (p.hi[2] - 0.5) * w; }
      if (p.l) { r = p.l + r * (1 - p.l); g = p.l + g * (1 - p.l); b = p.l + b * (1 - p.l); }
      if (p.h) { r *= 1 - p.h; g *= 1 - p.h; b *= 1 - p.h; }
      return [clamp01(r), clamp01(g), clamp01(b)];
    };
  }

  const LIST = [{ id: "none", name: "Original", group: "", recipe: {}, tags: "no filter" }].concat(
    R.map(([id, name, group, recipe, tags]) => ({ id: id, name: name, group: group, recipe: recipe, tags: tags })));
  const BY = {};
  LIST.forEach((f) => {
    BY[f.id] = f;
    f.fn = make(f.recipe);
    // a filter that darkens mid-grey a lot is "dark": the Director keeps it off dark footage
    const mid = f.fn(0.45, 0.45, 0.45);
    f.dark = (0.2126 * mid[0] + 0.7152 * mid[1] + 0.0722 * mid[2]) < 0.37;
  });

  // The 33x33x33 table as RGBA bytes, laid out (r + b * N, g): N*N wide, N tall
  function table(id) {
    const f = BY[id];
    if (!f) return null;
    if (f.table) return f.table;
    const d = new Uint8Array(N * N * N * 4);
    for (let g = 0; g < N; g++) {
      for (let b = 0; b < N; b++) {
        for (let r = 0; r < N; r++) {
          const o = f.fn(r / (N - 1), g / (N - 1), b / (N - 1));
          const i = (g * N * N + b * N + r) * 4;
          d[i] = Math.round(o[0] * 255); d[i + 1] = Math.round(o[1] * 255); d[i + 2] = Math.round(o[2] * 255); d[i + 3] = 255;
        }
      }
    }
    f.table = d;
    return d;
  }

  // The nearest CSS filter, for devices without WebGL.
  function cssOf(id) {
    const f = BY[id];
    if (!f || id === "none") return "none";
    const p = f.recipe;
    const parts = [];
    const bright = Math.pow(2, p.e || 0) * (1 - (p.h || 0)) + (p.l || 0) * 0.5;
    if (Math.abs(bright - 1) > 0.01) parts.push("brightness(" + bright.toFixed(3) + ")");
    const con = 1 + (p.c || 0) - (p.l || 0) * 0.8;
    if (Math.abs(con - 1) > 0.01) parts.push("contrast(" + con.toFixed(3) + ")");
    if (p.bw) parts.push("grayscale(" + p.bw + ")");
    if (p.mul && p.mul[0] > p.mul[2]) parts.push("sepia(" + Math.min(1, (p.mul[0] - p.mul[2]) * 2).toFixed(2) + ")");
    if ((p.t || 0) > 0) parts.push("sepia(" + Math.min(0.6, p.t * 0.7).toFixed(2) + ")");
    const sat = 1 + (p.s || 0) + (p.v || 0) * 0.5;
    if (!p.bw && Math.abs(sat - 1) > 0.01) parts.push("saturate(" + sat.toFixed(3) + ")");
    const hue = (p.hue || 0) + ((p.t || 0) < 0 ? -p.t * 16 : 0);
    if (hue) parts.push("hue-rotate(" + hue.toFixed(1) + "deg)");
    return parts.join(" ") || "none";
  }

  // ── WebGL: the table applied on the graphics card ──
  let gl = null, glCanvas = null, prog = null, srcTex = null, failed = false, loc = null;
  const lutTex = new Map();
  const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
  const FS = [
    "#ifdef GL_FRAGMENT_PRECISION_HIGH", "precision highp float;", "#else", "precision mediump float;", "#endif",
    "uniform sampler2D img; uniform sampler2D lut; uniform float amt; varying vec2 uv;",
    "const float N = " + N + ".0;",
    "vec3 look(vec3 c){",
    "  float bz = c.b * (N - 1.0); float b0 = floor(bz); float b1 = min(b0 + 1.0, N - 1.0); float f = bz - b0;",
    "  float x = c.r * (N - 1.0) + 0.5; float y = (c.g * (N - 1.0) + 0.5) / N;",
    "  vec3 a = texture2D(lut, vec2((x + b0 * N) / (N * N), y)).rgb;",
    "  vec3 b = texture2D(lut, vec2((x + b1 * N) / (N * N), y)).rgb;",
    "  return mix(a, b, f);",
    "}",
    "void main(){ vec4 c = texture2D(img, uv); gl_FragColor = vec4(mix(c.rgb, look(clamp(c.rgb, 0.0, 1.0)), amt), c.a); }"
  ].join("\n");

  function init() {
    if (gl || failed) return !!gl;
    try {
      glCanvas = document.createElement("canvas");
      gl = glCanvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) ||
           glCanvas.getContext("experimental-webgl");
      if (!gl) throw new Error("no webgl");
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link failed");
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const pa = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(pa);
      gl.vertexAttribPointer(pa, 2, gl.FLOAT, false, 0, 0);
      loc = { img: gl.getUniformLocation(prog, "img"), lut: gl.getUniformLocation(prog, "lut"), amt: gl.getUniformLocation(prog, "amt") };
      srcTex = texture();
      glCanvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); gl = null; lutTex.clear(); failed = true; });
      return true;
    } catch (e) {
      failed = true;
      gl = null;
      return false;
    }
  }
  function texture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function lutFor(id) {
    if (lutTex.has(id)) return lutTex.get(id);
    const t = texture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N * N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, table(id));
    lutTex.set(id, t);
    return t;
  }

  // one pass of a table texture over `src`
  function draw(src, tex, amount) {
    try {
      const W = src.width, H = src.height;
      if (!W || !H) return null;
      if (glCanvas.width !== W) glCanvas.width = W;
      if (glCanvas.height !== H) glCanvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc.img, 0);
      gl.uniform1i(loc.lut, 1);
      gl.uniform1f(loc.amt, amount == null ? 1 : Math.max(0, Math.min(1, amount)));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return glCanvas;
    } catch (e) {
      return null;
    }
  }

  /* The filtered picture of `src` (a canvas), as a canvas to draw back, or
     null when this device can't (then the caller uses cssOf). */
  function apply(src, id, amount) {
    if (!BY[id] || id === "none" || !init()) return null;
    return draw(src, lutFor(id), amount);
  }

  // ── grading (ccl7, 0.37.0): HSL, curves, colour wheels ──
  // any colour function as a table, in the same layout as table()
  function tableFromFn(fn) {
    const d = new Uint8Array(N * N * N * 4);
    for (let g = 0; g < N; g++) for (let b = 0; b < N; b++) for (let r = 0; r < N; r++) {
      const o = fn(r / (N - 1), g / (N - 1), b / (N - 1));
      const i = (g * N * N + b * N + r) * 4;
      d[i] = Math.round(clamp01(o[0]) * 255); d[i + 1] = Math.round(clamp01(o[1]) * 255); d[i + 2] = Math.round(clamp01(o[2]) * 255); d[i + 3] = 255;
    }
    return d;
  }
  // custom tables (a clip's grade with its filter), the most recent 24 kept on the card
  const customTex = new Map();
  function applyFn(src, key, fn) {
    if (!init()) return null;
    let t = customTex.get(key);
    if (t) { customTex.delete(key); customTex.set(key, t); }
    else {
      t = texture();
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N * N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, tableFromFn(fn));
      customTex.set(key, t);
      while (customTex.size > 24) { const [k, old] = customTex.entries().next().value; customTex.delete(k); try { gl.deleteTexture(old); } catch (e) {} }
    }
    return draw(src, t, 1);
  }

  /* A smooth curve through points (monotone cubic, Fritsch-Carlson): it
     never overshoots between points, so a curve can't flip colours. */
  function smoothCurve(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0]);
    const n = p.length;
    if (n < 2) return (x) => x;
    const d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
      const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return (x) => {
      if (x <= p[0][0]) return p[0][1];
      if (x >= p[n - 1][0]) return p[n - 1][1];
      let i = 0;
      while (i < n - 2 && x > p[i + 1][0]) i++;
      const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    };
  }

  // the 8 colours of HSL, CapCut's, by hue in degrees
  const HSL_COLOURS = [["red", 0], ["orange", 30], ["yellow", 60], ["green", 120], ["aqua", 180], ["blue", 225], ["purple", 270], ["magenta", 315]];
  function rgbToHsl(r, g, b) {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s <= 0) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  }
  const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

  /* A clip's grade as a colour function, or null when it has none.
     adj.hsl: {colour: {h, s, l}} each -100..100 · adj.curves: {m, r, g, b}
     point lists · adj.wheels: {sh, mid, hi}: [x, y] in -1..1, a tint for
     the shadows, midtones and highlights (the direction is the hue). */
  function gradeFn(adj) {
    if (!adj) return null;
    const hsl = adj.hsl && Object.keys(adj.hsl).length ? adj.hsl : null;
    const cv = adj.curves || null;
    const curve = (k) => (cv && cv[k] && cv[k].length >= 2 ? smoothCurve(cv[k]) : null);
    const cm = curve("m"), cr = curve("r"), cg = curve("g"), cb = curve("b");
    const wh = adj.wheels && Object.keys(adj.wheels).some((k) => adj.wheels[k] && (adj.wheels[k][0] || adj.wheels[k][1])) ? adj.wheels : null;
    if (!hsl && !cm && !cr && !cg && !cb && !wh) return null;
    const bands = hsl ? HSL_COLOURS.filter(([name]) => hsl[name]).map(([name, hue]) => [hue, hsl[name]]) : [];
    const tint = (w) => {
      if (!w || (!w[0] && !w[1])) return null;
      const ang = Math.atan2(-w[1], w[0]) * 180 / Math.PI;   // up on the pad is red-magenta, as on a wheel
      const amt = Math.min(1, Math.hypot(w[0], w[1]));
      const c = hslToRgb(ang, 1, 0.5);
      return [(c[0] - 0.5) * amt * 0.22, (c[1] - 0.5) * amt * 0.22, (c[2] - 0.5) * amt * 0.22];
    };
    const tSh = wh && tint(wh.sh), tMid = wh && tint(wh.mid), tHi = wh && tint(wh.hi);
    return (r, g, b) => {
      if (bands.length) {
        let [h, s, l] = rgbToHsl(r, g, b);
        if (s > 0.02) {
          let dh = 0, ds = 0, dl = 0;
          const k = Math.min(1, s * 2.5);   // greys are left alone
          bands.forEach(([hue, v]) => {
            const w = Math.max(0, 1 - hueDist(h, hue) / 40) * k;
            if (!w) return;
            dh += w * (v.h || 0) * 0.3;      // up to 30 degrees
            ds += w * (v.s || 0) / 100;
            dl += w * (v.l || 0) / 100;
          });
          h += dh;
          s = clamp01(s * (1 + ds));
          l = clamp01(l + dl * 0.3 * (1 - Math.abs(2 * l - 1)));
          [r, g, b] = hslToRgb(h, s, l);
        }
      }
      if (cm) { r = cm(r); g = cm(g); b = cm(b); }
      if (cr) r = cr(r);
      if (cg) g = cg(g);
      if (cb) b = cb(b);
      if (wh) {
        const y = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const add = (t, w) => { if (t) { r += t[0] * w; g += t[1] * w; b += t[2] * w; } };
        add(tSh, (1 - y) * (1 - y));
        add(tMid, 1 - Math.abs(2 * y - 1));
        add(tHi, y * y);
      }
      return [clamp01(r), clamp01(g), clamp01(b)];
    };
  }

  /* The one table a clip needs: its grade, then its filter at its strength
     (strength is baked in, so the grade stays at full). Null when the clip
     has neither. key changes whenever the result would. */
  function clipLook(filterId, amount, adj) {
    const g = gradeFn(adj);
    const f = filterId && filterId !== "none" && BY[filterId] ? BY[filterId] : null;
    if (!g && !f) return null;
    const a = amount == null ? 1 : Math.max(0, Math.min(1, amount));
    if (!g) return { filterOnly: true, id: filterId, amount: a };
    const key = (f ? filterId + "@" + a.toFixed(2) : "-") + "|" + JSON.stringify({ h: adj.hsl || null, c: adj.curves || null, w: adj.wheels || null });
    const fn = (r, gg, b) => {
      const x = g(r, gg, b);
      if (!f) return x;
      const y = f.fn(x[0], x[1], x[2]);
      return [x[0] + (y[0] - x[0]) * a, x[1] + (y[1] - x[1]) * a, x[2] + (y[2] - x[2]) * a];
    };
    return { key: key, fn: fn };
  }

  // whether filters run on the graphics card here (else the CSS look is used)
  function gpu() { return init(); }

  // The Director's menu: "id (mood words)" per filter, by group
  function directorList() {
    return GROUPS.map((g) => g + ": " + LIST.filter((f) => f.group === g).map((f) => f.id + " (" + f.tags + ")").join(", ")).join("\n");
  }

  global.SenotelFilters = {
    GROUPS: GROUPS, LIST: LIST, N: N,
    has: (id) => !!BY[id], nameOf: (id) => (BY[id] ? BY[id].name : id), isDark: (id) => !!(BY[id] && BY[id].dark),
    colour: (id, r, g, b) => (BY[id] ? BY[id].fn(r, g, b) : [r, g, b]),
    table: table, cssOf: cssOf, apply: apply, gpu: gpu, directorList: directorList,
    applyFn: applyFn, gradeFn: gradeFn, clipLook: clipLook, smoothCurve: smoothCurve, HSL_COLOURS: HSL_COLOURS,
    ids: () => LIST.map((f) => f.id)
  };
})(typeof window !== "undefined" ? window : globalThis);
