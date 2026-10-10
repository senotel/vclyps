/* ═══════════════════════════════════════════════════════════
   vClyps — caption styles
   106 animated caption styles in 11 groups. Each is a short recipe
   that captions.js draws, the same in the preview and the export.

   A recipe, every field optional except font:
     font, weight, italic        any of caption-tools.js FONTS
     upper | lower               letter case
     size                        of the picture's short side
     tracking                    letter spacing, in ems
     words, lines                most words per caption, lines per caption
     y                           centre of the caption, 0 top to 1 bottom
     fill | gradient [top, bot]  text colour
     active                      colour of the word being said
     key                         colour of a highlighted keyword
     dim                         opacity of words not said yet
     stroke, strokeW             outline colour, width in ems
     shadow [color, blur, dx, dy]   soft shadow (ems)
     hard [color, dx, dy]        solid offset shadow, the "3D" look
     glow, glowAll               glow colour; on every word or the spoken one
     chroma                      red and cyan split, for glitch looks
     box {on, color, text, pad, radius, alpha}
         on: "line" behind the caption, "word" behind each word,
             "active" behind the spoken word, "slide" glides between words
         text: text colour on top of the box
     under {color, h}            bar under the spoken word
     anim                        how it moves (see captions.js ANIMS)
     pop                         size of the spoken word
     tilt                        degrees the caption leans
   Exposes window.VevrisCaptionStyles.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var SH = ["rgba(0,0,0,0.55)", 0.18, 0, 0.05];
  var SOFT = ["rgba(0,0,0,0.65)", 0.3, 0, 0.04];

  var BASE = {
    bold: { font: "Montserrat", weight: 900, upper: true, size: 0.074, fill: "#FFFFFF", stroke: "#000000", strokeW: 0.15, shadow: SH, words: 3, y: 0.72, anim: "pop", pop: 1.1, key: "#FFE600" },
    clean: { font: "Inter", weight: 800, size: 0.058, fill: "#FFFFFF", shadow: SOFT, words: 4, y: 0.76, anim: "none", key: "#FFE600" },
    sub: { font: "Inter", weight: 700, size: 0.048, fill: "#FFFFFF", words: 8, lines: 2, y: 0.84, anim: "fade", box: { on: "line", color: "#000000", alpha: 0.62, pad: 0.3, radius: 0.2 }, key: "#FFE600" },
    tall: { font: "Anton", weight: 400, upper: true, size: 0.096, tracking: 0.02, fill: "#FFFFFF", stroke: "#000000", strokeW: 0.12, shadow: SH, words: 3, y: 0.72, anim: "pop", pop: 1.08, key: "#FFE600" },
    comic: { font: "Bangers", weight: 400, upper: true, size: 0.095, tracking: 0.04, fill: "#FFE600", stroke: "#000000", strokeW: 0.2, hard: ["#000000", 0.05, 0.07], words: 3, y: 0.72, anim: "bounce", key: "#FF3B30" },
    neon: { font: "Poppins", weight: 800, size: 0.066, fill: "#F2FEFF", glowAll: true, words: 3, y: 0.74, anim: "none", key: "#FFFFFF" },
    script: { font: "Caveat", weight: 700, size: 0.09, fill: "#FFFFFF", shadow: SOFT, words: 4, y: 0.76, anim: "rise", key: "#FFE600" },
    serif: { font: "Playfair Display", weight: 800, size: 0.066, fill: "#FFFFFF", shadow: SOFT, words: 4, y: 0.78, anim: "fade", key: "#E8C468" },
    mono: { font: "Space Mono", weight: 700, size: 0.052, fill: "#FFFFFF", words: 5, lines: 2, y: 0.8, anim: "type", key: "#39FF14" },
    thai: { font: "Kanit", weight: 800, size: 0.07, fill: "#FFFFFF", stroke: "#000000", strokeW: 0.14, shadow: SH, words: 3, y: 0.72, anim: "pop", pop: 1.08, key: "#FFE600" }
  };

  function S(id, name, cat, base, over) {
    var o = {};
    var b = BASE[base] || {};
    Object.keys(b).forEach(function (k) { o[k] = b[k]; });
    Object.keys(over || {}).forEach(function (k) { o[k] = over[k]; });
    o.id = id; o.name = name; o.cat = cat;
    return o;
  }

  var LIST = [
    // ── Trending: the short-form standards ──
    S("punch", "Punch", "Trending", "bold", { active: "#DC143C" }),
    S("block", "Block", "Trending", "bold", { anim: "none", box: { on: "active", color: "#DC143C", pad: 0.14, radius: 0.16 }, size: 0.07 }),
    S("clean", "Clean", "Trending", "clean", { active: "#DC143C" }),
    S("hustle", "Hustle", "Trending", "bold", { active: "#FFE600", pop: 1.14 }),
    S("hustle-green", "Hustle Green", "Trending", "bold", { active: "#2BE36E", pop: 1.14 }),
    S("showman", "Showman", "Trending", "bold", { font: "Luckiest Guy", weight: 400, size: 0.088, strokeW: 0.2, hard: ["#000000", 0.04, 0.07], anim: "bounce", active: "#FFE600" }),
    S("one-word", "One Word", "Trending", "bold", { anim: "single", size: 0.11, words: 3, active: null, pop: 1 }),
    S("karaoke", "Karaoke", "Trending", "bold", { anim: "sweep", active: "#FFE600", pop: 1 }),
    S("glide", "Glide", "Trending", "bold", { anim: "none", stroke: null, shadow: null, box: { on: "slide", color: "#FFE600", text: "#000000", pad: 0.14, radius: 0.18 }, size: 0.068 }),
    S("podcast", "Podcast", "Trending", "clean", { lower: true, dim: 0.4, words: 5, lines: 2 }),
    S("word-by-word", "Word by Word", "Trending", "bold", { anim: "reveal", weight: 800, active: "#FFFFFF", pop: 1 }),
    S("typewriter", "Typewriter", "Trending", "mono", { box: { on: "line", color: "#FFFFFF", text: "#111111", alpha: 1, pad: 0.3, radius: 0.08 }, fill: "#111111", key: "#DC143C" }),
    S("rise", "Rise", "Trending", "clean", { font: "Poppins", weight: 800, anim: "rise", size: 0.064 }),
    S("drop", "Drop", "Trending", "bold", { font: "Rubik", anim: "drop", active: "#FF5A5F", pop: 1 }),
    S("glow", "Glow", "Trending", "clean", { font: "Poppins", weight: 800, glow: "#00E5FF", active: "#E9FDFF", anim: "pop", pop: 1.1 }),
    S("bounce", "Bounce", "Trending", "clean", { font: "Fredoka", weight: 700, size: 0.07, stroke: "#000000", strokeW: 0.12, anim: "bounce", active: "#FF5A5F" }),

    // ── Bold ──
    S("tall", "Tall", "Bold", "tall", { active: "#FFE600" }),
    S("bebas", "Bebas", "Bold", "tall", { font: "Bebas Neue", active: "#FF3B30" }),
    S("impact", "Impact", "Bold", "bold", { font: "Archivo Black", weight: 400, active: "#FF3B30" }),
    S("hollow", "Hollow", "Bold", "bold", { font: "Rubik", fill: "rgba(255,255,255,0)", stroke: "#FFFFFF", strokeW: 0.06, shadow: null, active: "#FFFFFF", anim: "none" }),
    S("stamp", "Stamp", "Bold", "bold", { font: "Black Ops One", weight: 400, size: 0.078, strokeW: 0.1, active: "#FF3B30", anim: "zoom" }),
    S("poster", "Poster", "Bold", "tall", { stroke: null, hard: ["#DC143C", 0.05, 0.06], active: "#FFFFFF", anim: "none" }),
    S("headline", "Headline", "Bold", "bold", { font: "Oswald", weight: 700, stroke: null, shadow: null, box: { on: "line", color: "#000000", pad: 0.24, radius: 0.08 }, anim: "slide", active: "#FFE600" }),
    S("massive", "Massive", "Bold", "bold", { size: 0.1, words: 2, active: "#FFE600" }),
    S("sport", "Sport", "Bold", "tall", { font: "Teko", weight: 700, size: 0.11, italic: true, active: "#00FF87" }),
    S("condensed", "Condensed", "Bold", "tall", { font: "Barlow Condensed", weight: 900, active: "#FFB800" }),
    S("zoom-punch", "Zoom Punch", "Bold", "bold", { anim: "zoom", active: "#FFE600" }),
    S("shake", "Shake", "Bold", "tall", { anim: "shake", active: "#FF3B30", pop: 1.12 }),

    // ── Clean ──
    S("minimal", "Minimal", "Clean", "clean", { weight: 600, size: 0.05, shadow: ["rgba(0,0,0,0.5)", 0.2, 0, 0.03] }),
    S("soft", "Soft", "Clean", "clean", { font: "Poppins", weight: 700 }),
    S("subtitle", "Subtitle", "Clean", "sub", {}),
    S("subtitle-light", "Subtitle Light", "Clean", "sub", { fill: "#111111", box: { on: "line", color: "#FFFFFF", alpha: 0.92, pad: 0.3, radius: 0.2 }, key: "#DC143C" }),
    S("lowercase", "Lowercase", "Clean", "clean", { lower: true, active: "#B7F36B" }),
    S("fade", "Fade", "Clean", "clean", { anim: "fade", words: 5, lines: 2 }),
    S("slide-up", "Slide Up", "Clean", "clean", { anim: "slide" }),
    S("underline", "Underline", "Clean", "clean", { under: { color: "#FFE600", h: 0.09 } }),
    S("dim-ahead", "Dim Ahead", "Clean", "clean", { dim: 0.35, words: 5, lines: 2 }),
    S("documentary", "Documentary", "Clean", "clean", { font: "Noto Sans", weight: 700, size: 0.044, words: 9, lines: 2, y: 0.86, anim: "fade" }),
    S("news-bar", "News Bar", "Clean", "sub", { font: "Oswald", weight: 700, upper: true, box: { on: "line", color: "#DC143C", alpha: 1, pad: 0.26, radius: 0.04 }, anim: "slide" }),
    S("classic", "Classic", "Clean", "clean", { weight: 700, size: 0.046, stroke: "#000000", strokeW: 0.1, shadow: null, words: 8, lines: 2, y: 0.86 }),

    // ── Boxed ──
    S("yellow-box", "Yellow Box", "Boxed", "bold", { anim: "none", stroke: null, box: { on: "active", color: "#FFE600", text: "#000000", pad: 0.14, radius: 0.14 } }),
    S("red-box", "Red Box", "Boxed", "bold", { anim: "pop", pop: 1.06, box: { on: "active", color: "#DC143C", pad: 0.14, radius: 0.14 } }),
    S("green-box", "Green Box", "Boxed", "bold", { anim: "none", box: { on: "active", color: "#1DB954", pad: 0.14, radius: 0.14 } }),
    S("blue-box", "Blue Box", "Boxed", "bold", { anim: "none", box: { on: "active", color: "#2F80ED", pad: 0.14, radius: 0.14 } }),
    S("white-box", "White Box", "Boxed", "bold", { anim: "none", stroke: null, box: { on: "active", color: "#FFFFFF", text: "#000000", pad: 0.14, radius: 0.14 } }),
    S("black-bar", "Black Bar", "Boxed", "clean", { box: { on: "line", color: "#000000", alpha: 0.85, pad: 0.26, radius: 0.1 }, shadow: null, active: "#FFE600" }),
    S("tiles", "Tiles", "Boxed", "clean", { upper: true, weight: 900, shadow: null, box: { on: "word", color: "#111111", alpha: 0.85, pad: 0.14, radius: 0.12 }, active: "#FFE600" }),
    S("candy", "Candy", "Boxed", "clean", { font: "Fredoka", weight: 700, shadow: null, fill: "#111111", box: { on: "word", color: "#FFD6E0", pad: 0.16, radius: 0.3 }, active: "#DC143C" }),
    S("glide-red", "Glide Red", "Boxed", "bold", { anim: "none", stroke: null, shadow: null, box: { on: "slide", color: "#DC143C", pad: 0.14, radius: 0.18 } }),
    S("glide-white", "Glide White", "Boxed", "bold", { anim: "none", stroke: null, shadow: null, box: { on: "slide", color: "#FFFFFF", text: "#000000", pad: 0.14, radius: 0.18 } }),
    S("glide-green", "Glide Green", "Boxed", "bold", { anim: "none", stroke: null, shadow: null, box: { on: "slide", color: "#2BE36E", text: "#000000", pad: 0.14, radius: 0.18 } }),
    S("label", "Label", "Boxed", "clean", { font: "Archivo Black", weight: 400, upper: true, fill: "#000000", shadow: null, box: { on: "line", color: "#FFE600", pad: 0.22, radius: 0.04 }, tilt: -2, anim: "zoom", key: "#DC143C" }),

    // ── Glow ──
    S("neon-cyan", "Neon Cyan", "Glow", "neon", { glow: "#00E5FF" }),
    S("neon-pink", "Neon Pink", "Glow", "neon", { glow: "#FF2E88", fill: "#FFF0F7" }),
    S("neon-green", "Neon Green", "Glow", "neon", { glow: "#39FF14", fill: "#F3FFEF" }),
    S("neon-yellow", "Neon Yellow", "Glow", "neon", { glow: "#FFE600", fill: "#FFFDE8" }),
    S("neon-red", "Neon Red", "Glow", "neon", { glow: "#FF1E3C", fill: "#FFF0F2" }),
    S("electric", "Electric", "Glow", "neon", { glowAll: false, glow: "#00E5FF", anim: "flash", active: "#FFFFFF", fill: "#BFEFFF" }),
    S("laser", "Laser", "Glow", "neon", { font: "Russo One", weight: 400, upper: true, glow: "#FF1E3C", fill: "#FFFFFF" }),
    S("sunrise-glow", "Sunrise Glow", "Glow", "neon", { font: "Righteous", weight: 400, gradient: ["#FFB347", "#FF5F6D"], glow: "#FF7A45" }),
    S("ice", "Ice", "Glow", "neon", { gradient: ["#FFFFFF", "#9BE7FF"], glow: "#7FDBFF", stroke: "#0B3D5C", strokeW: 0.06 }),
    S("fire", "Fire", "Glow", "bold", { gradient: ["#FFE259", "#FF4E00"], stroke: "#3A0A00", strokeW: 0.12, glow: "#FF6A00", active: null, anim: "flash" }),

    // ── Gradient and 3D ──
    S("sunset", "Sunset", "3D", "bold", { gradient: ["#FFB347", "#FF5F6D"], stroke: "#2A0A0A", strokeW: 0.12, active: null, anim: "pop" }),
    S("gold", "Gold", "3D", "bold", { gradient: ["#FFE58F", "#C8961E"], stroke: "#3B2A06", strokeW: 0.1, active: null, anim: "zoom" }),
    S("chrome", "Chrome", "3D", "bold", { gradient: ["#FFFFFF", "#9AA4AE"], stroke: "#1E2328", strokeW: 0.1, active: null }),
    S("ocean", "Ocean", "3D", "bold", { gradient: ["#6EE7F9", "#2F80ED"], stroke: "#051B33", strokeW: 0.12, active: null }),
    S("lime", "Lime", "3D", "bold", { gradient: ["#E8FF7A", "#3DDC84"], stroke: "#0B2A12", strokeW: 0.12, active: null }),
    S("pop-3d", "3D Pop", "3D", "bold", { font: "Lilita One", weight: 400, size: 0.088, stroke: null, hard: ["#DC143C", 0.05, 0.07], active: "#FFE600" }),
    S("deep-3d", "Deep 3D", "3D", "bold", { font: "Lilita One", weight: 400, size: 0.088, stroke: "#000000", strokeW: 0.08, hard: ["#000000", 0.07, 0.1], active: "#4CC9F0" }),
    S("retro-3d", "Retro 3D", "3D", "bold", { font: "Bungee", weight: 400, size: 0.07, fill: "#FFD23F", stroke: null, shadow: null, hard: ["#EE4266", 0.06, 0.07], active: "#FFFFFF", anim: "bounce" }),

    // ── Fun ──
    S("comic", "Comic", "Fun", "comic", { tilt: -3, anim: "swing" }),
    S("bubble", "Bubble", "Fun", "comic", { font: "Luckiest Guy", fill: "#FFFFFF", stroke: "#FF4F79", strokeW: 0.24, hard: null, shadow: SH, anim: "pop", pop: 1.12, active: "#FFE600" }),
    S("cartoon", "Cartoon", "Fun", "comic", { font: "Lilita One", fill: "#FFFFFF", active: "#4CC9F0", anim: "bounce" }),
    S("pop-art", "Pop Art", "Fun", "comic", { fill: "#FF3B30", stroke: "#FFFFFF", strokeW: 0.16, hard: ["#000000", 0.06, 0.08], active: "#FFE600" }),
    S("kids", "Kids", "Fun", "clean", { font: "Fredoka", weight: 700, size: 0.074, stroke: "#FFFFFF", strokeW: 0.16, fill: "#2F80ED", shadow: null, anim: "wave", active: "#FF5A5F" }),
    S("boom", "Boom", "Fun", "comic", { anim: "zoom", size: 0.1, words: 2 }),
    S("sticker", "Sticker", "Fun", "comic", { font: "Luckiest Guy", fill: "#111111", stroke: "#FFFFFF", strokeW: 0.3, hard: null, shadow: ["rgba(0,0,0,0.5)", 0.25, 0, 0.06], active: "#DC143C", tilt: -4, anim: "pop" }),
    S("wobble", "Wobble", "Fun", "comic", { fill: "#FFFFFF", anim: "wave", active: "#FFE600" }),

    // ── Handwritten ──
    S("marker", "Marker", "Handwritten", "script", { font: "Permanent Marker", weight: 400, size: 0.07, anim: "pop", pop: 1.06 }),
    S("notebook", "Notebook", "Handwritten", "script", { size: 0.1 }),
    S("signature", "Signature", "Handwritten", "script", { font: "Pacifico", weight: 400, size: 0.066, anim: "fade" }),
    S("vlog", "Vlog", "Handwritten", "script", { active: "#FFE600" }),
    S("sketch", "Sketch", "Handwritten", "script", { font: "Permanent Marker", weight: 400, size: 0.068, stroke: "#000000", strokeW: 0.1, shadow: null, anim: "shake", active: "#FF5A5F" }),
    S("diary", "Diary", "Handwritten", "script", { fill: "#111111", shadow: null, box: { on: "line", color: "#FFF8E7", pad: 0.24, radius: 0.1 }, key: "#DC143C" }),

    // ── Cinematic ──
    S("cinema", "Cinema", "Cinematic", "serif", { font: "Cinzel", weight: 700, upper: true, tracking: 0.12, size: 0.048, words: 5, y: 0.84 }),
    S("editorial", "Editorial", "Cinematic", "serif", { italic: true }),
    S("serif-gold", "Serif Gold", "Cinematic", "serif", { font: "DM Serif Display", weight: 400, active: "#E8C468" }),
    S("trailer", "Trailer", "Cinematic", "serif", { font: "Cinzel", weight: 800, upper: true, tracking: 0.08, size: 0.064, anim: "zoom", words: 3 }),
    S("luxury", "Luxury", "Cinematic", "serif", { font: "Cinzel", weight: 700, upper: true, tracking: 0.16, size: 0.05, gradient: ["#FFF1C1", "#C8961E"], words: 4 }),
    S("quote", "Quote", "Cinematic", "serif", { italic: true, words: 6, lines: 2, anim: "reveal", dim: 1 }),
    S("film-subtitle", "Film Subtitle", "Cinematic", "clean", { font: "Noto Sans", weight: 700, fill: "#FFE680", size: 0.046, words: 8, lines: 2, y: 0.88, stroke: "#000000", strokeW: 0.08 }),
    S("noir", "Noir", "Cinematic", "serif", { box: { on: "line", color: "#000000", pad: 0.28, radius: 0.02 }, shadow: null }),

    // ── Retro and gaming ──
    S("pixel", "Pixel", "Retro", "bold", { font: "Press Start 2P", weight: 400, size: 0.046, strokeW: 0.18, active: "#39FF14", pop: 1, anim: "none" }),
    S("arcade", "Arcade", "Retro", "bold", { font: "Press Start 2P", weight: 400, size: 0.046, stroke: null, hard: ["#FF2E63", 0.08, 0.08], active: "#FFE600", anim: "bounce" }),
    S("terminal", "Terminal", "Retro", "mono", { fill: "#39FF14", box: { on: "line", color: "#000000", alpha: 0.85, pad: 0.3, radius: 0.04 }, glow: "#39FF14", glowAll: true }),
    S("gamer", "Gamer", "Retro", "bold", { font: "Russo One", weight: 400, glow: "#00E5FF", active: "#00E5FF", stroke: "#001018", strokeW: 0.1 }),
    S("retro", "Retro", "Retro", "bold", { font: "Bungee", weight: 400, size: 0.068, fill: "#FF8C42", stroke: null, hard: ["#1B998B", 0.06, 0.06], active: "#FFFFFF" }),
    S("eighties", "Eighties", "Retro", "neon", { font: "Righteous", weight: 400, upper: true, gradient: ["#FFE259", "#FF5F6D"], glow: "#FF5F6D" }),
    S("glitch", "Glitch", "Retro", "bold", { font: "Russo One", weight: 400, chroma: true, stroke: null, anim: "flash", active: "#FFFFFF" }),
    S("military", "Military", "Retro", "bold", { font: "Black Ops One", weight: 400, size: 0.07, fill: "#E8E2C9", stroke: "#2B2B1E", strokeW: 0.1, active: "#C9B458", anim: "zoom" }),

    // ── Thai and other scripts: fonts that carry Thai, Vietnamese and Cyrillic ──
    S("kanit-bold", "Kanit Bold", "Thai", "thai", { active: "#FFE600" }),
    S("kanit-box", "Kanit Box", "Thai", "thai", { anim: "none", box: { on: "active", color: "#DC143C", pad: 0.14, radius: 0.14 } }),
    S("prompt-clean", "Prompt Clean", "Thai", "clean", { font: "Prompt", weight: 700, active: "#FFE600" }),
    S("prompt-subtitle", "Prompt Subtitle", "Thai", "sub", { font: "Prompt", weight: 600 }),
    S("thai-pop", "Thai Pop", "Thai", "thai", { active: "#2BE36E", pop: 1.14, anim: "bounce" }),
    S("noto-bold", "Noto Bold", "Thai", "bold", { font: "Noto Sans", weight: 900, active: "#FFE600" })
  ];

  // Every font named above must be in the FONTS list of caption-tools.js.
  var BY_ID = {};
  LIST.forEach(function (s) { BY_ID[s.id] = s; });
  var CATEGORIES = [];
  LIST.forEach(function (s) { if (CATEGORIES.indexOf(s.cat) < 0) CATEGORIES.push(s.cat); });

  global.VevrisCaptionStyles = {
    LIST: LIST,
    BY_ID: BY_ID,
    CATEGORIES: CATEGORIES,
    get: function (id) { return BY_ID[id] || BY_ID.punch; }
  };
})(typeof window !== "undefined" ? window : globalThis);
