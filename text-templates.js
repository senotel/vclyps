/* ═══════════════════════════════════════════════════════════
   text-templates.js — ready-made designed titles (ccl3, 0.35.0)
   window.SenotelTextTemplates

   CapCut's Text → Templates: tap one and a finished title lands at the
   playhead, words ready to change. Each template is only fields the editor
   already draws (font, colours, outline, shadow, label box, glow, spacing,
   kind, In/Out/Loop animations), so it looks the same in the preview and
   the export, and every part of it stays editable afterwards.

   The Director may also name one for a text ({"template": id}); `use` says
   when, in its own words. Fonts are the 166 text fonts of fonts.js.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const GROUPS = ["Titles", "Lower thirds", "Social", "Quotes", "Numbers", "Business"];

  const T = [
    // ── Titles ──
    { id: "big-bold", name: "Big and bold", group: "Titles", use: "a strong hook or headline",
      t: { text: "THIS CHANGES EVERYTHING", font: "Bricolage Grotesque", weight: 800, upper: true, size: 50, color: "#ffffff",
        shadow: true, shColor: "#000000", shOpacity: 0.9, shBlur: 0, shDist: 0.06, shAngle: 45, animIn: "w-pop", animInLen: 0.6 } },
    { id: "cinema", name: "Cinema", group: "Titles", use: "a calm premium title or a chapter",
      t: { text: "THE STORY BEGINS", font: "Bodoni Moda", weight: 600, upper: true, spacing: 0.22, size: 36, color: "#f2e9d8",
        shadow: true, shOpacity: 0.5, shBlur: 0.4, animIn: "l-blur", animInLen: 1, animOut: "blur", animOutLen: 0.4 } },
    { id: "neon", name: "Neon sign", group: "Titles", use: "a night, party or gaming moment",
      t: { text: "Open late", font: "Tilt Neon", weight: 400, size: 48, color: "#ffe9f6",
        glowOn: true, glowColor: "#ff2e88", glowSize: 0.8, shadow: false, animIn: "flicker", animInLen: 0.8 } },
    { id: "comic", name: "Comic pop", group: "Titles", use: "a funny or loud moment",
      t: { text: "BOOM!", font: "Bowlby One", weight: 400, size: 60, color: "#ffe600", strokeColor: "#111111", strokeW: 0.12,
        shadow: true, shColor: "#111111", shOpacity: 1, shBlur: 0, shDist: 0.08, shAngle: 45, rotate: -6, animIn: "pop", animInLen: 0.45 } },
    { id: "retro-3d", name: "Retro 3D", group: "Titles", use: "a retro, fun or throwback title",
      t: { text: "Weekend vibes", font: "Shrikhand", weight: 400, size: 46, color: "#ffd23f", strokeColor: "#3a1020", strokeW: 0.04,
        shadow: true, shColor: "#ee4266", shOpacity: 1, shBlur: 0, shDist: 0.09, shAngle: 45, animIn: "drop", animInLen: 0.6 } },
    { id: "minimal", name: "Minimal", group: "Titles", use: "a quiet, modern title",
      t: { text: "SLOW MORNINGS", font: "Outfit", weight: 300, upper: true, spacing: 0.32, size: 28, color: "#ffffff",
        shadow: true, shOpacity: 0.35, shBlur: 0.5, animIn: "fade", animInLen: 0.8, animOut: "fade", animOutLen: 0.5 } },
    { id: "handwritten", name: "Handwritten", group: "Titles", use: "a personal, diary-like line",
      t: { text: "a little note to self", font: "Homemade Apple", weight: 400, size: 34, color: "#ffffff",
        shadow: true, shOpacity: 0.5, shBlur: 0.3, animIn: "type", animInLen: 1.2 } },
    { id: "glitch", name: "Glitch", group: "Titles", use: "a tech, gaming or surprise moment",
      t: { text: "SYSTEM UPDATE", font: "Rubik Glitch", weight: 400, size: 44, color: "#ffffff",
        shadow: true, shColor: "#00e5ff", shOpacity: 0.9, shBlur: 0, shDist: 0.04, shAngle: 180, animIn: "glitch", animInLen: 0.6 } },

    // ── Lower thirds (style "lower": a name and a second line) ──
    { id: "lower-crimson", name: "Crimson name", group: "Lower thirds", use: "a speaker's name and role",
      t: { style: "lower", text: "Alex Morgan", sub: "Founder", accent: "#dc143c", color: "#edeae2", font: "Manrope", weight: 700, size: 34 } },
    { id: "lower-yellow", name: "Yellow name", group: "Lower thirds", use: "a guest or an interview",
      t: { style: "lower", text: "Sam Lee", sub: "Guest", accent: "#ffd23f", color: "#ffffff", font: "Plus Jakarta Sans", weight: 700, size: 34 } },
    { id: "lower-blue", name: "Blue name", group: "Lower thirds", use: "a calm, corporate name tag",
      t: { style: "lower", text: "Jordan Kim", sub: "Product designer", accent: "#2f80ed", color: "#ffffff", font: "Epilogue", weight: 700, size: 32 } },
    { id: "lower-white", name: "Clean name", group: "Lower thirds", use: "a minimal name tag",
      t: { style: "lower", text: "Riley Park", sub: "Host", accent: "#ffffff", color: "#ffffff", font: "Outfit", weight: 600, size: 32 } },
    { id: "lower-place", name: "Place", group: "Lower thirds", use: "where a scene happens",
      t: { style: "lower", text: "Kyoto", sub: "Day 3", accent: "#b7f36b", color: "#ffffff", font: "Familjen Grotesk", weight: 700, size: 34 } },
    { id: "lower-feature", name: "Feature", group: "Lower thirds", use: "a product feature and what it does",
      t: { style: "lower", text: "Auto captions", sub: "Every word, timed for you", accent: "#dc143c", color: "#edeae2", font: "Bricolage Grotesque", weight: 700, size: 32 } },
    { id: "lower-handle", name: "Handle", group: "Lower thirds", use: "the creator's account name",
      t: { style: "lower", text: "@yourname", sub: "Follow for more", accent: "#ff2e88", color: "#ffffff", font: "Gabarito", weight: 700, size: 32 } },

    // ── Social ──
    { id: "subscribe", name: "Subscribe", group: "Social", use: "a subscribe reminder near the end",
      t: { text: "SUBSCRIBE", font: "Archivo", weight: 800, upper: true, size: 34, color: "#ffffff",
        boxOn: true, boxColor: "#ff0033", boxOpacity: 1, boxRadius: 0.15, shadow: false, animIn: "pop", animInLen: 0.4, animLoop: "pulse" } },
    { id: "follow", name: "Follow for more", group: "Social", use: "a follow reminder at the end",
      t: { text: "Follow for more", font: "Manrope", weight: 800, size: 32, color: "#111111",
        boxOn: true, boxColor: "#ffffff", boxOpacity: 1, boxRadius: 0.2, shadow: false, animIn: "rise", animInLen: 0.5 } },
    { id: "link-bio", name: "Link in bio", group: "Social", use: "pointing viewers to the link",
      t: { text: "Link in bio", font: "Plus Jakarta Sans", weight: 800, size: 32, color: "#ffffff",
        boxOn: true, boxColor: "#111210", boxOpacity: 0.85, boxRadius: 0.2, shadow: false, animIn: "wipe", animInLen: 0.5 } },
    { id: "part-2", name: "Part 2", group: "Social", use: "a series or a follow-up",
      t: { text: "PART 2", font: "Bungee Inline", weight: 400, size: 58, color: "#ffe600",
        shadow: true, shColor: "#000000", shOpacity: 1, shBlur: 0, shDist: 0.06, animIn: "grow", animInLen: 0.5 } },
    { id: "comment", name: "Comment below", group: "Social", use: "asking viewers a question",
      t: { text: "Which one would you pick?", font: "Gabarito", weight: 700, size: 32, color: "#ffffff",
        boxOn: true, boxColor: "#000000", boxOpacity: 0.7, boxRadius: 0.25, shadow: false, animIn: "rise", animInLen: 0.5 } },
    { id: "wait-for-it", name: "Wait for it", group: "Social", use: "building up to a payoff",
      t: { text: "wait for it...", font: "Darker Grotesque", weight: 800, size: 40, color: "#ffffff",
        strokeColor: "#000000", strokeW: 0.08, animIn: "type", animInLen: 0.9, animLoop: "breathe" } },
    { id: "pov", name: "POV", group: "Social", use: "a point-of-view setup line",
      t: { text: "POV: you finally edit it yourself", font: "Outfit", weight: 700, size: 30, color: "#ffffff",
        strokeColor: "#000000", strokeW: 0.07, shadow: false, animIn: "fade", animInLen: 0.4 } },

    // ── Quotes ──
    { id: "quote-serif", name: "Serif quote", group: "Quotes", use: "a meaningful quote or line",
      t: { text: "“Do the work you would do for free.”", font: "Instrument Serif", weight: 400, italic: true, size: 38, color: "#ffffff",
        shadow: true, shOpacity: 0.6, shBlur: 0.4, animIn: "w-rise", animInLen: 1 } },
    { id: "quote-type", name: "Typed quote", group: "Quotes", use: "a line typed out letter by letter",
      t: { text: "Start before you're ready.", font: "Special Elite", weight: 400, size: 32, color: "#f2efe6",
        shadow: true, shOpacity: 0.6, shBlur: 0.3, animIn: "type", animInLen: 1.4 } },
    { id: "quote-bold", name: "Bold quote", group: "Quotes", use: "a punchy statement",
      t: { text: "Less talking. More making.", font: "Bricolage Grotesque", weight: 800, size: 36, color: "#ffffff",
        boxOn: true, boxColor: "#000000", boxOpacity: 0.72, boxRadius: 0.1, shadow: false, animIn: "w-pop", animInLen: 0.6 } },
    { id: "quote-script", name: "Script quote", group: "Quotes", use: "a soft, romantic or emotional line",
      t: { text: "always worth it", font: "Great Vibes", weight: 400, size: 52, color: "#ffffff",
        shadow: true, shOpacity: 0.5, shBlur: 0.3, animIn: "l-fade", animInLen: 1.2 } },
    { id: "quote-paper", name: "Paper note", group: "Quotes", use: "a note or a tip",
      t: { text: "Tip: film in daylight", font: "Courgette", weight: 400, size: 32, color: "#1a1a1a",
        boxOn: true, boxColor: "#f2efe6", boxOpacity: 1, boxRadius: 0.05, shadow: true, shOpacity: 0.35, shBlur: 0.3, shDist: 0.03, rotate: -2, animIn: "drop", animInLen: 0.5 } },

    // ── Numbers ──
    { id: "big-number", name: "Big number", group: "Numbers", use: "a number the video is about",
      t: { text: "10x", font: "Bricolage Grotesque", weight: 800, size: 88, color: "#ffffff",
        shadow: true, shOpacity: 0.7, shBlur: 0.3, animIn: "grow", animInLen: 0.5 } },
    { id: "price", name: "Price tag", group: "Numbers", use: "a price or an offer",
      t: { text: "$19", font: "Archivo", weight: 900, size: 64, color: "#111111",
        boxOn: true, boxColor: "#ffe600", boxOpacity: 1, boxRadius: 0.12, shadow: false, rotate: -4, animIn: "pop", animInLen: 0.4 } },
    { id: "percent", name: "Percent", group: "Numbers", use: "a percentage or a result",
      t: { text: "90%", font: "Outfit", weight: 800, size: 80, color: "#b7f36b",
        shadow: true, shOpacity: 0.6, shBlur: 0.2, animIn: "rise", animInLen: 0.5 } },
    { id: "countdown", name: "Countdown", group: "Numbers", use: "a countdown or a numbered step",
      t: { text: "3", font: "Bowlby One", weight: 400, size: 88, color: "#ffffff", strokeColor: "#000000", strokeW: 0.06,
        animIn: "zoom", animInLen: 0.35, animOut: "shrink", animOutLen: 0.25 } },
    { id: "date", name: "Date", group: "Numbers", use: "a date or a day",
      t: { text: "OCT 24", font: "Major Mono Display", weight: 400, upper: true, spacing: 0.15, size: 38, color: "#ffffff",
        shadow: true, shOpacity: 0.5, shBlur: 0.3, animIn: "type", animInLen: 0.6 } },
    { id: "step", name: "Step", group: "Numbers", use: "a numbered step in a tutorial",
      t: { text: "STEP 1", font: "Manrope", weight: 800, upper: true, spacing: 0.08, size: 30, color: "#ffffff",
        boxOn: true, boxColor: "#dc143c", boxOpacity: 1, boxRadius: 0.12, shadow: false, animIn: "left", animInLen: 0.4 } },

    // ── Business ──
    { id: "now-live", name: "Now live", group: "Business", use: "a launch or an announcement",
      t: { text: "NOW LIVE", font: "Bricolage Grotesque", weight: 800, upper: true, spacing: 0.06, size: 40, color: "#ffffff",
        boxOn: true, boxColor: "#dc143c", boxOpacity: 1, boxRadius: 0.1, shadow: false, animIn: "wipe", animInLen: 0.5 } },
    { id: "new-tag", name: "New", group: "Business", use: "marking something new",
      t: { text: "NEW", font: "Archivo", weight: 800, upper: true, spacing: 0.1, size: 26, color: "#111111",
        boxOn: true, boxColor: "#ffd23f", boxOpacity: 1, boxRadius: 0.15, shadow: false, animIn: "pop", animInLen: 0.35 } },
    { id: "before", name: "Before", group: "Business", use: "a before-and-after comparison",
      t: { text: "BEFORE", font: "Familjen Grotesk", weight: 700, upper: true, spacing: 0.2, size: 28, color: "#ffffff",
        boxOn: true, boxColor: "#000000", boxOpacity: 0.6, boxRadius: 0.1, shadow: false, animIn: "fade", animInLen: 0.3 } },
    { id: "after", name: "After", group: "Business", use: "the result after a change",
      t: { text: "AFTER", font: "Familjen Grotesk", weight: 700, upper: true, spacing: 0.2, size: 28, color: "#111111",
        boxOn: true, boxColor: "#ffffff", boxOpacity: 0.95, boxRadius: 0.1, shadow: false, animIn: "fade", animInLen: 0.3 } },
    { id: "cta", name: "Call to action", group: "Business", use: "telling viewers what to do next",
      t: { text: "Try it free", font: "Plus Jakarta Sans", weight: 800, size: 34, color: "#ffffff",
        boxOn: true, boxColor: "#dc143c", boxOpacity: 1, boxRadius: 0.15, shadow: false, animIn: "rise", animInLen: 0.5 } },
    { id: "headline", name: "Headline", group: "Business", use: "a product's main claim",
      t: { text: "Edit in half the time", font: "Epilogue", weight: 800, size: 42, color: "#ffffff",
        shadow: true, shOpacity: 0.55, shBlur: 0.4, animIn: "w-rise", animInLen: 0.8, animOut: "blur", animOutLen: 0.35 } },
    { id: "product-card", name: "Product card", group: "Business", use: "the product name full screen",
      t: { style: "card", text: "Your product", sub: "What it does, in one line", bg: "#111210", color: "#edeae2", size: 46 } }
  ];

  const BY = {};
  T.forEach((x) => { BY[x.id] = x; });

  // a fresh copy of a template's fields (never the stored object itself)
  function fields(id) {
    const x = BY[id];
    return x ? JSON.parse(JSON.stringify(x.t)) : null;
  }

  // The Director's menu: "id (when to use it)"
  function directorList() {
    return T.map((x) => x.id + " (" + x.use + ")").join(", ");
  }

  global.SenotelTextTemplates = { GROUPS: GROUPS, LIST: T, has: (id) => !!BY[id], fields: fields, directorList: directorList };
})(typeof window !== "undefined" ? window : globalThis);
