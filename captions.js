/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — word-timed animated captions
   The editing app by Vevris.

   Short-form captions: a few words on screen at a time, moving with the
   voice. Burned into the picture at export, so they survive every platform
   rather than relying on a sidecar subtitle file nobody renders. What the
   preview draws is the export, frame for frame: both call drawCaptions().

   In the order they run:

     transcribeCaptions()  media  → words, in SOURCE time (caption-worker.js:
                                    multilingual Whisper on the device)
     buildCues()           words  → short cues, in SOURCE time
     mapCuesToTimeline()   cues   → the same cues in TIMELINE time
     translateCues()       cues   → a translation riding on each cue
     drawCaptions()        cues   → pixels, once per frame

   The source→timeline split matters: Whisper times a word against the
   original file, but the editor trims and reorders clips underneath it.
   Mapping late keeps one transcript per media item however many times it
   appears on the timeline.

   Styles live in caption-styles.js; languages, swear words, vocabulary,
   keywords, translation and fonts in caption-tools.js.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function Tools() { return global.VevrisCaptionTools || null; }
  function Styles() { return global.VevrisCaptionStyles || null; }

  /* ═══════════ STYLE ═══════════ */

  // The fallback when caption-styles.js has not loaded: the original Punch.
  var PUNCH = {
    id: "punch", name: "Punch", font: "Arial Black", weight: 900, upper: true, size: 0.074,
    fill: "#ffffff", active: "#dc143c", stroke: "#000000", strokeW: 0.15,
    shadow: ["rgba(0,0,0,0.55)", 0.18, 0, 0.05], words: 3, y: 0.72, anim: "pop", pop: 1.1
  };
  function styleOf(id) {
    if (id && typeof id === "object") return id;
    var S = Styles();
    return (S && S.BY_ID[id]) || (S && S.BY_ID.punch) || PUNCH;
  }

  /* ═══════════ CHUNKING ═══════════ */

  var DEFAULTS = {
    maxWords: 3,
    maxChars: 24,
    pause: 0.35,      /* a silence this long forces a new cue */
    minDur: 0.5,      /* stops one-frame flashes */
    hold: 0.4         /* how long a cue lingers past its last word */
  };

  var SENTENCE_END = /[.!?…。！？]["')\]」』]?$/;
  var CLAUSE_END = /[,;:—–、，；：]["')\]」』]?$/;

  function cleanWord(w) {
    return {
      text: String(w.text || "").trim(), raw: w.raw != null ? String(w.raw).trim() : String(w.text || "").trim(),
      start: +w.start, end: +w.end, sp: w.sp !== false, spk: w.spk
    };
  }

  /* Words → cues. This is what makes captions read like short-form rather than
     a caption track: a cap on words AND characters (one long word can fill a
     line on its own), breaks at punctuation and real pauses, and no orphans.
     Languages written without spaces count characters, not words. */
  function buildCues(words, opts) {
    var cfg = Object.assign({}, DEFAULTS, opts || {});
    var clean = (words || []).filter(function (w) { return w && !w.hide; }).map(cleanWord)
      .filter(function (w) { return w.text && w.end > w.start; });
    if (!clean.length) return [];
    var groups = [], cur = [];

    function widthWith(group, word) {
      var n = word.text.length;
      for (var i = 0; i < group.length; i++) n += group[i].text.length + (group[i].sp ? 1 : 0);
      return n;
    }

    for (var i = 0; i < clean.length; i++) {
      var w = clean[i];
      var prev = cur.length ? cur[cur.length - 1] : null;
      var gap = prev ? w.start - prev.end : 0;
      var overflow = cur.length >= cfg.maxWords || widthWith(cur, w) > cfg.maxChars;
      var afterStop = prev && SENTENCE_END.test(prev.text);
      var afterPause = prev && gap >= cfg.pause;
      /* Only honour a comma once the line is carrying its weight, or every
         fragment becomes a one-word cue. */
      var afterClause = prev && CLAUSE_END.test(prev.text) && cur.length >= 2;
      if (cur.length && (overflow || afterStop || afterPause || afterClause)) {
        groups.push(cur); cur = [];
      }
      cur.push(w);
    }
    if (cur.length) groups.push(cur);
    foldOrphans(groups, cfg);
    return toCues(groups, cfg);
  }

  /* A trailing one-word cue reads as a mistake. Merge it backwards where the
     caps allow — a four-word line beats a one-word flash. */
  function foldOrphans(groups, cfg) {
    if (cfg.maxWords <= 1) return;
    for (var i = groups.length - 1; i > 0; i--) {
      if (groups[i].length !== 1) continue;
      var prev = groups[i - 1];
      var last = prev[prev.length - 1];
      /* Never fold across a sentence end or a real pause — those breaks are
         intentional. */
      if (SENTENCE_END.test(last.text)) continue;
      if (groups[i][0].start - last.end >= cfg.pause) continue;
      var merged = prev.concat(groups[i]);
      var chars = merged.reduce(function (n, w) { return n + w.text.length + (w.sp ? 1 : 0); }, 0);
      if (merged.length > cfg.maxWords + 1 || chars > cfg.maxChars) continue;
      groups[i - 1] = merged;
      groups.splice(i, 1);
    }
  }

  function toCues(groups, cfg) {
    var cues = groups.map(function (words) {
      return { words: words, start: words[0].start, end: words[words.length - 1].end };
    });
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i], next = cues[i + 1];
      c.end = next ? Math.min(c.end + cfg.hold, next.start) : c.end + cfg.hold;
      if (c.end - c.start < cfg.minDur) {
        var want = c.start + cfg.minDur;
        c.end = next ? Math.min(want, next.start) : want;
      }
      if (c.end <= c.start) c.end = c.start + 0.1;  /* degenerate model timings */
    }
    return cues;
  }

  // How many characters a caption may hold, by how the language is written.
  function charsFor(lang, maxWords) {
    var T = Tools();
    if (lang === "zh" || lang === "ja" || lang === "yue") return Math.max(8, maxWords * 4);
    if (T && T.NO_SPACE[lang]) return Math.max(14, maxWords * 7);
    return Math.max(14, maxWords * 9);
  }

  /* ═══════════ TRANSCRIPTION ═══════════ */

  /* The small English Whisper that brain.js uses for the Director's
     transcript. Captions no longer use it (see transcribeCaptions), but the
     Director still shares this one so it is not built twice. */
  var asr = null, asrLoading = null;
  var ASR_FLAG = "vclyps-asr-ready";

  /* Ask the browser to KEEP our storage. Models are cached in Cache Storage,
     which a phone low on space may quietly evict by default, throwing away a
     download the person already waited through. Persistent storage is
     granted silently to engaged sites; a refusal costs nothing. It also
     protects the IndexedDB copies of footage that back session-resume. */
  function keepStorage() {
    try {
      if (global.navigator && navigator.storage && navigator.storage.persist) navigator.storage.persist();
    } catch (e) {}
  }

  function flagged() {
    try { return global.localStorage.getItem(ASR_FLAG) === "1"; } catch (e) { return false; }
  }

  // Is a model whose files contain `needle` in the browser's cache right now?
  async function cached(needle) {
    try {
      if (!global.caches || !global.caches.keys) return false;
      var names = await global.caches.keys();
      for (var i = 0; i < names.length; i++) {
        if (names[i].indexOf("transformers") < 0) continue;
        var reqs = await (await global.caches.open(names[i])).keys();
        for (var k = 0; k < reqs.length; k++) if (reqs[k].url.indexOf(needle) >= 0) return true;
      }
    } catch (e) {}
    return false;
  }

  async function modelReady() {
    if (asr) return true;
    if (!global.caches) return flagged();
    return cached("whisper-tiny.en");
  }

  function loadASR(say) {
    if (asr) return Promise.resolve(asr);
    if (!asrLoading) {
      asrLoading = (async function () {
        say("Downloading the speech model (first time only)…");
        var T = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
        T.env.allowLocalModels = false;
        asr = await T.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
          progress_callback: function (p) {
            if (p.status === "progress" && p.progress) say("Downloading the speech model… " + Math.round(p.progress) + "%");
          }
        });
        try { global.localStorage.setItem(ASR_FLAG, "1"); } catch (e) {}
        keepStorage();
        return asr;
      })();
    }
    return asrLoading;
  }

  /* ── captions: multilingual Whisper, off the page ── */

  // What each accuracy setting downloads, for the Captions sheet. Matches TIERS in caption-worker.js.
  var TIERS = {
    best: { id: "whisper-large-v3-turbo_timestamped", label: "Best", mb: 540 },
    balanced: { id: "whisper-small_timestamped", label: "Balanced", mb: 300 },
    fast: { id: "whisper-base_timestamped", label: "Fast", mb: 100 }
  };

  /* What this device can run. No graphics chip means the fast model only:
     the larger ones would take many times the clip's own length. */
  function hasGPU() { return !!(global.navigator && navigator.gpu); }
  function defaultTier() {
    if (!hasGPU()) return "fast";
    var phone = global.matchMedia && global.matchMedia("(pointer: coarse)").matches;
    var memory = (global.navigator && navigator.deviceMemory) || 8;
    return phone || memory < 6 ? "balanced" : "best";
  }
  function effectiveTier(tier) { return hasGPU() ? (TIERS[tier] ? tier : defaultTier()) : "fast"; }
  function tierReady(tier) { return cached(TIERS[effectiveTier(tier)].id); }

  var worker = null, jobs = {}, jobSeq = 0;
  function capWorker() {
    if (worker) return worker;
    worker = new Worker("caption-worker.js", { type: "module" });
    worker.onmessage = function (e) {
      var d = e.data || {}, job = jobs[d.id];
      if (!job) return;
      if (d.type === "download") {
        job.say(job.fresh ? "Downloading the speech model, first time only… " + d.mb + " of about " + job.fresh + " MB"
          : "Loading the speech model… " + d.mb + " MB");
      }
      else if (d.type === "stage") job.say(d.text + "…");
      else if (d.type === "done") { delete jobs[d.id]; job.resolve(d); }
      else if (d.type === "error") { delete jobs[d.id]; job.reject(new Error(d.message || "Captions failed")); }
    };
    worker.onerror = function (e) {
      Object.keys(jobs).forEach(function (k) { jobs[k].reject(new Error((e && e.message) || "The caption worker stopped")); });
      jobs = {};
      worker = null;
    };
    return worker;
  }

  // One job to the worker; its progress goes to say().
  function ask(msg, say, fresh) {
    var id = ++jobSeq;
    msg.id = id;
    return new Promise(function (resolve, reject) {
      jobs[id] = { resolve: resolve, reject: reject, say: say || function () {}, fresh: fresh || 0 };
      capWorker().postMessage(msg, msg.audio ? [msg.audio.buffer] : []);
    });
  }

  // 16 kHz mono: Whisper's native rate, so anything richer is wasted work.
  async function decode16k(url) {
    var buf = await (await fetch(url)).arrayBuffer();
    var probe = new (global.AudioContext || global.webkitAudioContext)();
    var audio;
    try { audio = await probe.decodeAudioData(buf); } finally { try { probe.close(); } catch (e) {} }
    var off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * 16000)), 16000);
    var src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    /* A copy, not the rendered buffer's own channel: that memory belongs to
       the AudioBuffer, and handing it to the worker delivered silence, on
       which Whisper invents "Thank you." (found 2026-10-07). */
    return new Float32Array((await off.startRendering()).getChannelData(0));
  }

  /* One media item's words, cached on the item: {words, lang}. Asked again
     only when the language, the accuracy or speakers change. Words come back
     in SOURCE time, cleaned (see VevrisCaptionTools.words) and, if asked,
     with a speaker number each. */
  async function transcribeCaptions(item, opts, say) {
    opts = opts || {};
    say = say || function () {};
    var tier = effectiveTier(opts.tier);
    var lang = opts.lang || "auto";
    var key = lang + "|" + tier;
    if (item.capWords && item.capKey === key && (!opts.speakers || item.capSpk)) {
      return { words: item.capWords, lang: item.capLang };
    }
    say("Reading the sound of “" + (item.name || "clip") + "”…");
    var audio = await decode16k(item.url);
    var T0 = Tools();
    // words already written, only the voices missing: tell them apart, nothing more
    if (item.capWords && item.capKey === key && opts.speakers && !item.capSpk && T0) {
      var only = await ask({ cmd: "turns", audio: audio }, say);
      if (only.turns) T0.assignSpeakers(item.capWords, only.turns);
      item.capSpk = true;
      return { words: item.capWords, lang: item.capLang };
    }
    var fallback = String((global.navigator && navigator.language) || "en").slice(0, 2).toLowerCase();
    // "downloading" only when it really is; after that it loads from the device
    var fresh = (await cached(TIERS[tier].id)) ? 0 : TIERS[tier].mb;
    var res = await ask({ cmd: "run", audio: audio, lang: lang, tier: tier, speakers: !!opts.speakers, fallbackLang: fallback }, say, fresh);
    keepStorage();
    var T = Tools();
    var raw = res.words || [];
    if (T && res.turns) T.assignSpeakers(raw, res.turns);
    var words = T ? T.words(raw, res.lang) : raw.map(cleanWord);
    item.capWords = words;
    item.capLang = res.lang;
    item.capKey = key;
    item.capSpk = !!res.turns;
    item.capEngine = res.engine;
    item.capTier = res.tier;
    // the old field, which the rest of the app reads as "this clip has words"
    item.words = words;
    return { words: words, lang: res.lang };
  }

  /* Start loading the caption model in the worker, only if it is already on
     the device: warming must never be what starts a big download. */
  var warmed = "";
  async function warm(tier) {
    var t = effectiveTier(tier);
    if (warmed === t) return;
    if (!(await cached(TIERS[t].id))) return;
    warmed = t;
    capWorker().postMessage({ cmd: "warm", tier: t });
  }

  /* The Director's transcript (brain.js, behind the Speech chip): the small
     English model it has always used, so switching Speech on never starts
     the big caption download. Where a clip already has captions, their
     better words are used instead. */
  async function transcribeWords(item, say) {
    if (item.capWords && item.capWords.length) return item.capWords;
    if (item.words !== undefined) return item.words;
    say = say || function () {};
    var model = await loadASR(say);
    say("Timing words in “" + (item.name || "clip") + "”…");
    var mono = await decode16k(item.url);
    var out = await model(mono, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word" });
    item.words = (out.chunks || []).map(function (c) {
      var t = c.timestamp || [];
      return { text: String(c.text || "").trim(), start: t[0] || 0, end: t[1] || (t[0] || 0) + 0.3 };
    }).filter(function (w) { return w.text && w.end > w.start; });
    return item.words;
  }

  /* ═══════════ SOURCE TIME → TIMELINE TIME ═══════════ */

  /* Each clip shows a window of its source. A word is visible only if it falls
     inside that window, and its on-screen moment is shifted by where the clip
     sits on the timeline. Cues are rebuilt per clip so a trim never leaves a
     half-spoken line stranded. */
  function mapCuesToTimeline(clips, opts) {
    opts = opts || {};
    var out = [];
    (clips || []).forEach(function (clip) {
      var words = clip.words || (clip.media && clip.media.words);
      if (!words || !words.length) return;
      var inPoint = clip.in || 0;
      var outPoint = clip.out != null ? clip.out : Infinity;
      var atTimeline = clip.timelineStart || 0;
      var rate = clip.speed || 1;
      var visible = words
        .filter(function (w) { return !w.hide && w.end > inPoint && w.start < outPoint; })
        .map(function (w) {
          /* Clamp to the trim so a word cut in half still shows for the part
             that survives, rather than vanishing or overhanging. */
          var s = Math.max(w.start, inPoint), e = Math.min(w.end, outPoint);
          return {
            text: w.text, raw: w.raw, sp: w.sp, spk: w.spk,
            start: atTimeline + (s - inPoint) / rate,
            end: atTimeline + (e - inPoint) / rate
          };
        });
      var lang = clip.lang || opts.lang;
      var maxWords = opts.maxWords || DEFAULTS.maxWords;
      buildCues(visible, Object.assign({}, opts, { maxWords: maxWords, maxChars: opts.maxChars || charsFor(lang, maxWords) }))
        .forEach(function (c) { c.lang = lang; out.push(c); });
    });
    out.sort(function (a, b) { return a.start - b.start; });
    var T = Tools();
    if (T) T.markKeywords(out, opts.lang);
    /* Emojis are chosen only once the whole timeline exists, because the
       neighbouring cues are what disambiguate a three-word line. */
    if (global.VevrisEmoji && opts.emoji !== false) global.VevrisEmoji.attachToCues(out, opts.emojiCfg);
    return out;
  }

  /* ═══════════ TRANSLATION ═══════════
     The translation rides on its cue: the cue keeps its timing and its
     original words, so switching back is instant. The translated words are
     spread over the cue by length, so the highlight still travels. */
  function cueLine(cue) {
    var s = "";
    cue.words.forEach(function (w, i) { if (!w.hide) s += (i && w.sp ? " " : "") + w.text; });
    return s;
  }

  function spreadWords(text, start, end, lang) {
    var T = Tools();
    var pieces = [];
    var noSpace = T && T.NO_SPACE[lang];
    if (noSpace && typeof Intl !== "undefined" && Intl.Segmenter) {
      var seg = new Intl.Segmenter(T.isoCode(lang), { granularity: "word" }), gap = false;
      Array.from(seg.segment(text)).forEach(function (s) {
        if (!s.segment.trim()) { gap = true; return; }
        if (!s.isWordLike && pieces.length && !gap) { pieces[pieces.length - 1].text += s.segment; return; }
        pieces.push({ text: s.segment, sp: pieces.length > 0 && gap && lang !== "zh" && lang !== "ja" && lang !== "yue" });
        gap = false;
      });
    } else {
      String(text).split(/\s+/).filter(Boolean).forEach(function (p, i) { pieces.push({ text: p, sp: i > 0 }); });
    }
    var total = pieces.reduce(function (n, p) { return n + Math.max(1, p.text.length); }, 0) || 1;
    var at = start, span = Math.max(0.1, end - start);
    return pieces.map(function (p) {
      var d = span * Math.max(1, p.text.length) / total;
      var w = { text: p.text, raw: p.text, start: at, end: at + d, sp: p.sp };
      at += d;
      return w;
    });
  }

  function setTranslation(cue, text, lang) {
    if (!text) { delete cue.tr; delete cue.trLang; delete cue.trWords; return; }
    var first = cue.words[0], last = cue.words[cue.words.length - 1];
    cue.tr = String(text).trim();
    cue.trLang = lang;
    cue.trWords = spreadWords(cue.tr, first.start, last.end, lang);
    var spk = first.spk;
    cue.trWords.forEach(function (w) { w.spk = spk; });
    var T = Tools();
    if (T) T.markKeywords([{ words: cue.trWords }], lang);
  }

  async function translateCues(cues, target, source, say) {
    var T = Tools();
    if (!T) throw new Error("caption-tools.js did not load");
    var todo = cues.filter(function (c) { return c.trLang !== target; });
    if (!todo.length) return cues;
    var lines = todo.map(cueLine);
    var out = await T.translate(lines, target, source, say);
    todo.forEach(function (c, i) { setTranslation(c, out[i] || "", target); });
    return cues;
  }

  /* ═══════════ LOOKUP ═══════════ */

  function cueAt(cues, t) {
    var lo = 0, hi = cues.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1, c = cues[mid];
      if (t < c.start) hi = mid - 1;
      else if (t >= c.end) lo = mid + 1;
      else return c;
    }
    return null;
  }

  function activeIn(words, t) {
    for (var i = 0; i < words.length; i++) if (t >= words[i].start && t < words[i].end) return i;
    /* Between words, keep the last one lit so the line never goes flat. */
    var last = -1;
    for (var j = 0; j < words.length; j++) if (t >= words[j].start) last = j;
    return last;
  }
  function activeIndex(cue, t) { return activeIn(cue.words, t); }

  /* Where the sound is bleeped: every swear word, a hair wider than the
     word so its edges never leak. Timeline time. */
  function bleepSpans(cues, isBad, translated) {
    var out = [];
    (cues || []).forEach(function (c) {
      // the bleep follows what was SAID, whatever language the captions show
      c.words.forEach(function (w) {
        if (!w.hide && isBad(w.raw || w.text)) out.push([w.start - 0.04, w.end + 0.04]);
      });
    });
    return out;
  }

  /* ═══════════ DRAWING ═══════════ */

  var SPEAKER = [null, "#4CC9F0", "#7CFF6B", "#FF9F1C", "#FF5DA2", "#FFE600"];
  var clamp01 = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  var easeOut = function (x) { x = clamp01(x); return 1 - (1 - x) * (1 - x); };
  var easeOutBack = function (x) { x = clamp01(x); var c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  var easeOutBounce = function (x) {
    x = clamp01(x);
    if (x < 1 / 2.75) return 7.5625 * x * x;
    if (x < 2 / 2.75) { x -= 1.5 / 2.75; return 7.5625 * x * x + 0.75; }
    if (x < 2.5 / 2.75) { x -= 2.25 / 2.75; return 7.5625 * x * x + 0.9375; }
    x -= 2.625 / 2.75; return 7.5625 * x * x + 0.984375;
  };

  // The heaviest weight a font has, at most what the style asks for.
  function weightFor(family, want) {
    var T = Tools();
    if (!T) return want;
    var f = T.FONTS.filter(function (x) { return x[0] === family; })[0];
    if (!f) return T.customFonts().indexOf(family) >= 0 ? 400 : want;
    var have = f[1].split(";").map(Number);
    var best = have[0];
    have.forEach(function (w) { if (w <= want && w > best) best = w; });
    if (have.indexOf(want) >= 0) best = want;
    return best;
  }

  /* opts, every field optional:
       style      id or recipe (caption-styles.js)
       font       a font family instead of the style's
       scale      size multiplier (1 = the style's size)
       y          caption centre, 0 top to 1 bottom, instead of the style's
       highlight  colour keywords (default on)
       speakers   colour each voice
       censor     "off" | "hide" | "bleep"; isBad(word) says which to hide
       translate  a language code: draw that translation where there is one
       emoji      false to leave the emoji off
       box        {x,y,w,h}: the picture's rectangle on this canvas */
  function drawCaptions(ctx, cues, t, opts) {
    if (!cues || !cues.length) return;
    if (typeof opts === "string") opts = { style: opts };
    opts = opts || {};
    var cue = cueAt(cues, t);
    if (cue) drawCue(ctx, cue, t, opts);
  }

  function drawCue(ctx, cue, t, opts) {
    var st = styleOf(opts.style);
    var R = opts.box || { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height };
    if (!R.w || !R.h) return;
    var T = Tools();
    var family = opts.font || st.font || "Montserrat";
    var weight = weightFor(family, opts.font ? (st.weight || 700) : (st.weight || 700));
    if (T && !T.fontReady(family, weight)) T.ensureFont(family, weight);
    var unit = Math.min(R.w, R.h);
    var size = unit * (st.size || 0.07) * (opts.scale || 1);
    var stack = '"' + family + '", "Noto Sans", "Noto Sans Thai", system-ui, sans-serif';
    function fontAt(px) { return (st.italic ? "italic " : "") + weight + " " + px + "px " + stack; }

    // what is shown: the translation if asked for, else what was said
    var translated = opts.translate && cue.trLang === opts.translate && cue.trWords;
    var src = translated ? cue.trWords : cue.words.filter(function (w) { return !w.hide; });
    if (!src.length) return;
    var hideBad = opts.censor && opts.censor !== "off" && typeof opts.isBad === "function";
    var lang = translated ? opts.translate : cue.lang;
    var toks = src.map(function (w) {
      var text = w.text;
      if (hideBad && (opts.isBad(w.raw || w.text) || opts.isBad(w.text))) text = T ? T.mask(text) : "****";
      if (st.upper) text = text.toLocaleUpperCase(lang || undefined);
      else if (st.lower) text = text.toLocaleLowerCase(lang || undefined);
      return { text: text, start: w.start, end: w.end, sp: w.sp !== false, spk: w.spk, key: w.key };
    });
    if (cue.emoji && opts.emoji !== false) {
      var lastW = toks[toks.length - 1];
      toks.push({ text: cue.emoji, start: lastW.end, end: lastW.end, sp: true, emoji: true });
    }
    var anim = st.anim || "none";
    var active = activeIn(toks.filter(function (x) { return !x.emoji; }), t);
    if (anim === "single") {
      var pick = Math.max(0, active);
      toks = [toks[pick]];
      active = 0;
    }

    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    var hasSpacing = "letterSpacing" in ctx;

    // measure at the style's size
    ctx.font = fontAt(size);
    if (hasSpacing) ctx.letterSpacing = ((st.tracking || 0) * size) + "px";
    var widths = toks.map(function (k) { return ctx.measureText(k.text).width; });
    var space = ctx.measureText(" ").width;
    /* A word that grows when spoken needs room to grow into, or it runs into
       its neighbours. The room is kept all the time, so the line never
       shifts as the highlight moves along it. */
    var grows = anim === "pop" || anim === "bounce" || anim === "shake" ? Math.max(0, (st.pop || 1.1) - 1) : 0;
    var gapAt = function (i) {
      if (i === 0 || !toks[i].sp) return grows ? Math.max(widths[i - 1] || 0, widths[i]) * grows / 2 : 0;
      return space + Math.max(widths[i - 1], widths[i]) * grows / 2;
    };

    // lines: greedy, up to the style's line count, then shrink to fit
    var maxLines = st.lines || 1, maxW = R.w * 0.86;
    var lines = [[]], lw = [0];
    toks.forEach(function (k, i) {
      var L = lines.length - 1;
      var add = (lines[L].length ? gapAt(i) : 0) + widths[i];
      if (lines[L].length && lw[L] + add > maxW && lines.length < maxLines) {
        lines.push([i]); lw.push(widths[i]);
      } else {
        lines[L].push(i); lw[L] += add;
      }
    });
    var widest = Math.max.apply(null, lw);
    var fit = widest > maxW ? maxW / widest : 1;
    var fs = size * fit;
    if (fit !== 1) {
      ctx.font = fontAt(fs);
      if (hasSpacing) ctx.letterSpacing = ((st.tracking || 0) * fs) + "px";
      widths = widths.map(function (w) { return w * fit; });
      space *= fit;
      lw = lw.map(function (w) { return w * fit; });
    }

    var box = st.box;
    var pad = box ? (box.pad || 0.2) * fs : 0;
    var lineH = fs * 1.2 + (box && box.on === "line" ? pad * 0.6 : 0);
    var blockH = lines.length * lineH;
    var cy = R.y + R.h * (opts.y != null ? opts.y : (st.y || 0.72));
    cy = Math.max(R.y + blockH / 2 + fs * 0.4, Math.min(R.y + R.h - blockH / 2 - fs * 0.3, cy));
    var cx = R.x + R.w / 2;

    // where every word sits, relative to the caption's centre
    var rtl = T && T.RTL_RE.test(toks.map(function (k) { return k.text; }).join(""));
    var pos = new Array(toks.length);
    lines.forEach(function (line, li) {
      var y = -blockH / 2 + lineH * (li + 0.5);
      var x = rtl ? lw[li] / 2 : -lw[li] / 2;
      line.forEach(function (i, n) {
        var gap = n ? gapAt(i) : 0;   // widths and space are already at the fitted size
        if (rtl) { x -= gap + widths[i]; pos[i] = { x: x, y: y, w: widths[i], line: li }; }
        else { x += gap; pos[i] = { x: x, y: y, w: widths[i], line: li }; x += widths[i]; }
      });
    });

    // the caption's own entrance
    var p = t - cue.start, alpha = 1, dy = 0, sc = 1, rot = (st.tilt || 0) * Math.PI / 180;
    if (anim === "fade") alpha = easeOut(p / 0.18);
    else if (anim === "slide") { alpha = easeOut(p / 0.2); dy = (1 - easeOut(p / 0.22)) * fs * 0.5; }
    else if (anim === "zoom") { sc = 0.6 + 0.4 * easeOutBack(p / 0.25); alpha = clamp01(p / 0.08); }
    else if (anim === "swing") rot += (1 - easeOutBack(p / 0.3)) * -0.17;

    ctx.translate(cx, cy + dy);
    if (rot) ctx.rotate(rot);
    if (sc !== 1) ctx.scale(sc, sc);
    ctx.globalAlpha = alpha;

    // boxes behind each line
    if (box && box.on === "line") {
      lines.forEach(function (line, li) {
        var y = -blockH / 2 + lineH * (li + 0.5);
        rr(ctx, -lw[li] / 2 - pad * 1.4, y - fs * 0.5 - pad, lw[li] + pad * 2.8, fs + pad * 2, (box.radius || 0) * fs, box.color, box.alpha);
      });
    }
    // the gliding highlight: from the last word to this one
    if (box && box.on === "slide" && active >= 0 && toks[active] && !toks[active].emoji) {
      var a = pos[active], pr = active > 0 ? pos[active - 1] : null;
      var q = easeOut((t - toks[active].start) / 0.12);
      var bx = a.x, by = a.y, bw = a.w;
      if (pr && pr.line === a.line && q < 1) { bx = pr.x + (a.x - pr.x) * q; bw = pr.w + (a.w - pr.w) * q; }
      rr(ctx, bx - pad, by - fs * 0.5 - pad * 0.7, bw + pad * 2, fs + pad * 1.4, (box.radius || 0) * fs, box.color, box.alpha);
    }

    var canBlur = "filter" in ctx;
    toks.forEach(function (k, i) {
      var P = pos[i];
      if (!P) return;
      var started = t >= k.start - 0.001 || k.emoji && active === toks.length - 2;
      var isAct = i === active && !k.emoji;
      var q = t - k.start;
      var a = 1, ky = 0, ks = 1, kr = 0, letters = -1, blur = 0, wave = false, flash = false, sweep = -1;
      switch (anim) {
        case "pop": if (isAct) ks = 1 + ((st.pop || 1.1) - 1) * easeOutBack(q / 0.12); break;
        case "bounce": if (isAct) { ky = -Math.sin(Math.PI * clamp01(q / 0.28)) * 0.22 * fs; ks = st.pop || 1.06; } break;
        case "reveal": a = started ? clamp01(q / 0.08) : 0; break;
        case "type": {
          if (!started) a = 0;
          else letters = Math.ceil(Array.from(k.text).length * clamp01(q / Math.max(0.08, (k.end - k.start) * 0.8)));
          break;
        }
        case "rise": a = started ? easeOut(q / 0.18) : 0; ky = started ? (1 - easeOut(q / 0.18)) * 0.45 * fs : 0; break;
        case "drop": a = started ? clamp01(q / 0.1) : 0; ky = started ? -(1 - easeOutBounce(q / 0.32)) * 0.7 * fs : 0; break;
        case "blur": a = started ? clamp01(q / 0.2) : 0; blur = started ? (1 - clamp01(q / 0.2)) * 0.25 * fs : 0; break;
        case "shake": if (isAct) { kr = Math.sin(q * 38) * (1 - clamp01(q / 0.3)) * 0.1; ks = st.pop || 1.1; } break;
        case "wave": if (isAct) wave = true; break;
        case "flash": if (isAct && q < 0.2) flash = Math.floor(q / 0.05) % 2 === 0; break;
        case "sweep": sweep = isAct ? clamp01(q / Math.max(0.05, k.end - k.start)) : (t >= k.end ? 1 : 0); break;
        case "single": ks = 0.7 + 0.3 * easeOutBack(q / 0.12); break;
      }
      if (!started && st.dim != null && st.dim < 1) a *= st.dim;
      if (a <= 0.001) return;

      // colour: the voice, then a keyword, then the spoken word
      var base = st.fill || "#ffffff";
      if (opts.speakers && k.spk != null && k.spk > 0) base = SPEAKER[k.spk % SPEAKER.length] || base;
      var useGradient = !!st.gradient && !(opts.speakers && k.spk > 0);
      var col = base;
      if (opts.highlight !== false && k.key && st.key) { col = st.key; useGradient = false; }
      if (isAct && st.active && sweep < 0) { col = st.active; useGradient = false; }
      var onBox = box && box.text && (box.on === "line" || box.on === "word" || (isAct && (box.on === "active" || box.on === "slide")));
      if (onBox) { col = box.text; useGradient = false; }
      if (flash) col = "#FFFFFF";

      ctx.save();
      ctx.globalAlpha = alpha * a;
      var wcx = P.x + P.w / 2, wcy = P.y + ky;
      ctx.translate(wcx, wcy);
      if (kr) ctx.rotate(kr);
      if (ks !== 1) ctx.scale(ks, ks);
      var x0 = -P.w / 2, y0 = 0;

      if (box && !k.emoji && (box.on === "word" || (box.on === "active" && isAct))) {
        rr(ctx, x0 - pad, y0 - fs * 0.5 - pad * 0.7, P.w + pad * 2, fs + pad * 1.4, (box.radius || 0) * fs, box.color, box.alpha);
      }
      if (blur && canBlur) ctx.filter = "blur(" + blur.toFixed(1) + "px)";

      var text = k.text;
      if (letters >= 0) text = Array.from(text).slice(0, letters).join("");
      var paint = function (fn, dx, dy2) {
        if (wave) {
          var chars = Array.from(text), x = x0;
          for (var c = 0; c < chars.length; c++) {
            var off = Math.sin(t * 10 + c * 0.7) * 0.08 * fs;
            ctx[fn](chars[c], x + (dx || 0), y0 + off + (dy2 || 0));
            x += ctx.measureText(chars[c]).width;
          }
        } else ctx[fn](text, x0 + (dx || 0), y0 + (dy2 || 0));
      };

      if (!k.emoji) {
        if (st.hard) {
          ctx.fillStyle = st.hard[0];
          paint("fillText", st.hard[1] * fs, st.hard[2] * fs);
          if (st.stroke && st.strokeW) { ctx.lineWidth = st.strokeW * fs; ctx.strokeStyle = st.hard[0]; ctx.lineJoin = "round"; paint("strokeText", st.hard[1] * fs, st.hard[2] * fs); }
        }
        if (st.chroma) {
          var j = 0.045 * fs;
          ctx.globalAlpha = alpha * a * 0.8;
          ctx.fillStyle = "#FF2A55"; paint("fillText", -j, 0);
          ctx.fillStyle = "#00E5FF"; paint("fillText", j, 0);
          ctx.globalAlpha = alpha * a;
        }
        if (st.shadow) {
          ctx.shadowColor = st.shadow[0];
          ctx.shadowBlur = st.shadow[1] * fs;
          ctx.shadowOffsetX = st.shadow[2] * fs;
          ctx.shadowOffsetY = st.shadow[3] * fs;
        }
        if (st.stroke && st.strokeW) {
          ctx.lineWidth = st.strokeW * fs;
          ctx.strokeStyle = st.stroke;
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          paint("strokeText");
        } else if (st.shadow) {
          ctx.fillStyle = "rgba(0,0,0,0)";
          ctx.fillStyle = col;
          paint("fillText");
        }
        ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        if (st.glow && (st.glowAll || isAct || flash)) {
          ctx.shadowColor = st.glow;
          ctx.shadowBlur = (flash ? 0.7 : 0.45) * fs;
          ctx.fillStyle = col;
          paint("fillText"); paint("fillText");
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
        }
      }
      if (useGradient) {
        var g = ctx.createLinearGradient(0, y0 - fs * 0.45, 0, y0 + fs * 0.45);
        g.addColorStop(0, st.gradient[0]); g.addColorStop(1, st.gradient[1]);
        ctx.fillStyle = g;
      } else ctx.fillStyle = col;
      paint("fillText");
      if (sweep > 0 && st.active) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0 - fs, P.w * sweep, fs * 2);
        ctx.clip();
        ctx.fillStyle = st.active;
        paint("fillText");
        ctx.restore();
      }
      if (st.under && isAct) {
        ctx.fillStyle = st.under.color;
        ctx.fillRect(x0, y0 + fs * 0.52, P.w, Math.max(2, st.under.h * fs));
      }
      ctx.restore();
    });
    ctx.restore();
  }

  function rr(ctx, x, y, w, h, r, fill, alpha) {
    ctx.save();
    ctx.shadowColor = "transparent";
    if (alpha != null && alpha < 1) ctx.globalAlpha *= alpha;
    ctx.fillStyle = fill;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, Math.max(0, r));
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.restore();
  }

  /* ═══════════ EXPORTS ═══════════ */

  global.VevrisCaptions = {
    get STYLES() { var S = Styles(); return S ? S.BY_ID : { punch: PUNCH }; },
    DEFAULTS: DEFAULTS,
    TIERS: TIERS,
    loadASR: loadASR,            // the Director's English transcript (brain.js)
    modelReady: modelReady,      // that model, truthfully (see cached)
    tierReady: tierReady,        // is this accuracy's model already on the device?
    defaultTier: defaultTier,
    effectiveTier: effectiveTier,
    hasGPU: hasGPU,
    keepStorage: keepStorage,
    transcribeCaptions: transcribeCaptions,
    warm: warm,
    transcribeWords: transcribeWords,
    buildCues: buildCues,
    mapCuesToTimeline: mapCuesToTimeline,
    translateCues: translateCues,
    setTranslation: setTranslation,
    bleepSpans: bleepSpans,
    drawCaptions: drawCaptions,
    styleOf: styleOf,
    weightFor: weightFor,
    cueAt: cueAt,
    activeIndex: activeIndex,
    cueText: cueLine
  };
})(window);
