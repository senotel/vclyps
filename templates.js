/* ═══════════════════════════════════════════════════════════
   templates.js — video templates (ccl20 stage 1, 0.50.0)
   window.SenotelTemplates

   CapCut's Templates: "drop your photos and videos in, get this exact
   edit". Stage 1 of the plan, with no server and no money: an edit is
   saved as a template file (slots with their lengths and looks, the texts,
   stickers, effects, sounds, captions style and library music; never the
   person's own footage), kept on the device and shared as a file; a new
   project starts from it with your own clips.

     make(state, info) → template (plain JSON)
     build(template, media) → {clips, texts, effects, sfx, capOpts, music, vertical, aspect}
       media: [{id, type, duration}] in the order chosen; slots take them
       in turn (and round again if there are fewer than slots)
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const VERSION = 1;
  // what of a clip is its look (and so belongs to the template): never its footage, crop or analysis
  const LOOK = ["speed", "curve", "curvePreset", "filter", "filterAmt", "adj", "kb", "fit", "bg", "bgColor", "rot", "flipH", "flipV",
    "animIn", "animOut", "animLoop", "animInLen", "animOutLen", "animLoopSpeed", "tIn", "tDur", "tAudio", "retouch",
    "volume", "muted", "fadeIn", "fadeOut", "voice", "voiceAmt", "denoise", "cutout", "kf", "name"];
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const pick = (o, keys) => { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = clone(o[k]); }); return r; };

  function make(st, info) {
    const disp = info.dispDur;
    const slots = st.clips.map((c) => {
      const look = pick(c, LOOK);
      if (c.mask && c.mask.shape && c.mask.shape !== "none") { look.mask = clone(c.mask); delete look.mask.track; }   // a tracked path belongs to that footage
      return { len: +disp(c).toFixed(3), kind: info.kindOf(c) === "image" ? "image" : "video", look: look };
    });
    const strip = (x) => { const o = clone(x); delete o.id; delete o.track; return o; };
    const music = st.music && st.music.url && !/^blob:/.test(st.music.url) ? clone(st.music) : null;
    return {
      vclypsTemplate: VERSION,
      name: String(info.name || "Template").slice(0, 60),
      made: new Date().toISOString().slice(0, 10),
      app: info.app || "",
      mode: st.mode || "entertainment",
      vertical: !!st.vertical, aspect: st.aspect || null,
      slots: slots,
      texts: (st.texts || []).filter((t) => !t.cap).map(strip),
      effects: (st.effects || []).map(strip),
      sfx: (st.sfx || []).map(strip),
      capOpts: clone(st.capOpts || null),
      music: music,
      thumb: info.thumb || null
    };
  }

  function valid(t) {
    return !!(t && t.vclypsTemplate >= 1 && Array.isArray(t.slots) && t.slots.length && t.slots.every((s) => s && s.len > 0 && s.look));
  }

  // nextId: a function handing out ids, as the editor does
  function build(t, media, nextId) {
    if (!valid(t)) throw new Error("not a vClyps template");
    if (!media.length) throw new Error("no footage");
    const clips = t.slots.map((s, i) => {
      const m = media[i % media.length];
      const look = clone(s.look);
      const sp = look.curve ? 1 : look.speed || 1;
      // the slot's length on the timeline, as much as the footage has (a photo holds as long as it is asked)
      let footage = s.len * sp;
      if (look.curve) footage = s.len;   // a curve keeps the clip's length (its presets do), so footage = length
      const out = m.type === "video" && m.duration ? Math.min(m.duration, footage) : footage;
      return Object.assign({ speed: 1, volume: 1, muted: false, filter: "none", fadeIn: 0, fadeOut: 0 }, look,
        { id: nextId(), mediaId: m.id, in: 0, out: Math.max(0.2, out) });
    });
    const ids = (list) => (list || []).map((x) => Object.assign(clone(x), { id: nextId() }));
    return {
      clips: clips, texts: ids(t.texts), effects: ids(t.effects), sfx: ids(t.sfx),
      capOpts: clone(t.capOpts), music: clone(t.music), vertical: !!t.vertical, aspect: t.aspect || null, mode: t.mode || "entertainment"
    };
  }

  global.SenotelTemplates = { VERSION: VERSION, LOOK: LOOK, make: make, build: build, valid: valid };
})(typeof window !== "undefined" ? window : globalThis);
