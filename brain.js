/* ═══════════════════════════════════════════════════════════
   VEVRIS BRAIN — footage understanding + editorial planner
   Runs 100% in the browser. For every source file it:
     · watches the frames  (motion, sharpness, light, color, scene cuts)
     · listens to the audio (energy, beats/BPM, speech detection)
     · optionally transcribes speech (Whisper, loaded on demand)
   Then plans a real edit from vague — or empty — prompts:
   highlight picking, story arc, beat-synced cut lengths,
   speech-safe cutting, Ken Burns on photos, fades.
   Exposes window.VevrisBrain. AI failures leave the timeline intact.
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;

  function rng(seed) {
    let a = (seed * 1103515245 + 12345) & 0x7fffffff;
    return () => {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      return a / 0x7fffffff;
    };
  }

  /* ═══════════ AUDIO ANALYSIS ═══════════ */

  async function analyzeAudio(item) {
    const out = { energy: [], zcr: [], hop: 0.05, peak: 0, loud: 0, beats: [], bpm: 0, musical: 0, voiced: [] };
    if (item.type !== "video" || (item.duration || 0) > 720) return out;
    let ctx = null;
    try {
      const buf = await (await fetch(item.url)).arrayBuffer();
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audio = await ctx.decodeAudioData(buf);
      const sr = audio.sampleRate;
      const ch = audio.getChannelData(0);
      const hopN = Math.round(sr * 0.05);
      out.hop = hopN / sr;

      // RMS energy + zero-crossing rate (high-pitch/excitement proxy) per hop
      for (let i = 0; i + hopN <= ch.length; i += hopN) {
        let s = 0, zc = 0, last = ch[i];
        for (let j = i; j < i + hopN; j += 4) {
          s += ch[j] * ch[j];
          if ((ch[j] >= 0) !== (last >= 0)) zc++;
          last = ch[j];
        }
        out.energy.push(Math.sqrt(s / (hopN / 4)));
        out.zcr.push(zc / (hopN / 4));
      }
      const e = out.energy;
      out.peak = Math.max(1e-6, ...e.slice(0, 20000));
      for (let i = 0; i < e.length; i++) e[i] /= out.peak;
      out.loud = e.reduce((a, b) => a + b, 0) / Math.max(1, e.length);

      // onsets = positive energy flux peaks
      const flux = e.map((v, i) => Math.max(0, v - (e[i - 1] || 0)));
      const mean = flux.reduce((a, b) => a + b, 0) / Math.max(1, flux.length);
      const sd = Math.sqrt(flux.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, flux.length));
      const th = mean + 1.4 * sd;
      const onsets = [];
      for (let i = 2; i < flux.length - 2; i++) {
        if (flux[i] > th && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] &&
            (!onsets.length || i * out.hop - onsets[onsets.length - 1] > 0.18)) {
          onsets.push(i * out.hop);
        }
      }
      // tempo from inter-onset intervals
      const iois = [];
      for (let i = 1; i < onsets.length; i++) {
        const d = onsets[i] - onsets[i - 1];
        if (d >= 0.28 && d <= 1.1) iois.push(d);
      }
      if (iois.length >= 6) {
        iois.sort((a, b) => a - b);
        const med = iois[Math.floor(iois.length / 2)];
        const near = iois.filter((d) => Math.abs(d - med) < med * 0.14).length / iois.length;
        if (near > 0.42) {
          out.bpm = Math.round(60 / med);
          out.musical = near;
          out.beats = onsets;
        }
      }

      // voiced / audible segments (speech-safe zones)
      const vth = 0.14;
      let start = -1;
      const segs = [];
      for (let i = 0; i <= e.length; i++) {
        const on = i < e.length && e[i] > vth;
        if (on && start < 0) start = i;
        if (!on && start >= 0) {
          if ((i - start) * out.hop > 0.35) segs.push({ s: start * out.hop, e: i * out.hop });
          start = -1;
        }
      }
      // merge close segments
      for (let i = segs.length - 2; i >= 0; i--) {
        if (segs[i + 1].s - segs[i].e < 0.3) {
          segs[i].e = segs[i + 1].e;
          segs.splice(i + 1, 1);
        }
      }
      out.voiced = segs;
    } catch (err) { /* silent media or decode failure — planner copes */ }
    if (ctx) { try { ctx.close(); } catch (e) {} }
    return out;
  }

  /* ═══════════ VISUAL ANALYSIS ═══════════ */

  function analyzeFrames(item, onProg) {
    return new Promise((resolve) => {
      const empty = { samples: [], sceneCuts: [], avgMot: 0.05, avgBri: 0.5, avgCol: 0.2, avgMcx: 0.5, keyframes: [] };
      if (item.type !== "video") {
        // single-frame stats from the photo itself
        const img = new Image();
        img.onload = () => {
          try {
            const cv = document.createElement("canvas");
            cv.width = 64; cv.height = 36;
            const cx = cv.getContext("2d");
            cx.drawImage(img, 0, 0, 64, 36);
            const st = frameStats(cx.getImageData(0, 0, 64, 36).data, null).stats;
            let keyframes = [];
            try {
              const kc = document.createElement("canvas");
              kc.width = 320; kc.height = 180;
              kc.getContext("2d").drawImage(img, 0, 0, 320, 180);
              keyframes = [{ t: 0, data: kc.toDataURL("image/jpeg", 0.6) }];
            } catch (e2) {}
            resolve({ samples: [{ t: 0, bri: st.bri, col: st.col, sh: st.sh, mot: 0.04, mcx: 0.5 }], sceneCuts: [], avgMot: 0.04, avgBri: st.bri, avgCol: st.col, avgMcx: 0.5, keyframes: keyframes });
          } catch (e) { resolve(empty); }
        };
        img.onerror = () => resolve(empty);
        img.src = item.url;
        return;
      }

      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto";
      const cv = document.createElement("canvas");
      cv.width = 64; cv.height = 36;
      const cx = cv.getContext("2d", { willReadFrequently: true });
      // larger keyframes for the Director's vision input
      const kc = document.createElement("canvas");
      kc.width = 320; kc.height = 180;
      const kcx = kc.getContext("2d");
      const keyframes = [];
      const samples = [];
      let prev = null, t = 0.01, step = 0.5, done = false;

      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        const cuts = [];
        let mSum = 0, bSum = 0, cSum = 0;
        samples.forEach((s, i) => {
          mSum += s.mot; bSum += s.bri; cSum += s.col;
          if (i > 1 && s.mot > 0.16 && s.mot > 2.4 * (samples[i - 1].mot + 0.02)) cuts.push(s.t);
        });
        const n = Math.max(1, samples.length);
        let wx = 0, ww = 0;
        samples.forEach((s) => { wx += (s.mcx || 0.5) * s.mot; ww += s.mot; });
        resolve({ samples, sceneCuts: cuts, avgMot: mSum / n, avgBri: bSum / n, avgCol: cSum / n, avgMcx: ww > 0.2 ? wx / ww : 0.5, keyframes: keyframes });
      };
      /* Safety net only. This was 25s + 1.2s per second of footage, so a
         four-minute clip could sit here for FIVE MINUTES before giving up and
         the app looked hung. Analysis is a nice-to-have — the planner copes
         with partial samples — so cap the wait at something a person will
         tolerate and move on with whatever we got. */
      const guard = setTimeout(finish, Math.min(45000, 8000 + (item.duration || 30) * 250));

      v.onerror = finish;
      v.onloadedmetadata = () => {
        /* Two limits, and they exist for opposite reasons.

           /90 sets the RESOLUTION. Dropping it to /45 to save time was a bad
           trade: on a five-minute clip it cut the candidate moments the
           heuristic planner can pick from 25 to 12 — visibly flatter edits —
           and bought only about four seconds. Resolution is where the quality
           lives, so it is not the place to economise.

           The 0.5s FLOOR is where the real waste was. Every sample costs a seek
           (50-200ms on a phone), and peaks are spaced by cutMin anyway (~2s),
           so sampling a short clip every 0.35s bought nothing and cost a third
           of the wait. Short clips are now faster than before AND long clips
           are back to full resolution. */
        step = Math.max(0.5, (v.duration || 10) / 90);
        v.currentTime = t;
      };
      v.onseeked = () => {
        try {
          cx.drawImage(v, 0, 0, 64, 36);
          const r = frameStats(cx.getImageData(0, 0, 64, 36).data, prev);
          prev = r.lum;
          samples.push({ t, bri: r.stats.bri, col: r.stats.col, sh: r.stats.sh, mot: r.stats.mot, mcx: r.stats.mcx });
        } catch (e) { /* tainted frame — skip */ }
        if (keyframes.length < 6 && t >= keyframes.length * ((v.duration || 10) / 6)) {
          try {
            kcx.drawImage(v, 0, 0, 320, 180);
            keyframes.push({ t: Math.round(t * 10) / 10, data: kc.toDataURL("image/jpeg", 0.6) });
          } catch (e) { /* tainted frame — skip keyframe */ }
        }
        if (onProg) onProg(clamp(t / (v.duration || 1), 0, 1));
        t += step;
        if (t < (v.duration || 0) - 0.06) v.currentTime = t;
        else finish();
      };
      v.src = item.url;
    });
  }

  function frameStats(d, prevLum) {
    const N = 64 * 36;
    const lum = new Float32Array(N);
    let bri = 0, col = 0;
    for (let i = 0, px = 0; px < N; i += 4, px++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const l = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      lum[px] = l;
      bri += l;
      col += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    }
    bri /= N; col /= N;
    let sh = 0;
    for (let y = 0; y < 36; y++) {
      for (let x = 1; x < 64; x++) sh += Math.abs(lum[y * 64 + x] - lum[y * 64 + x - 1]);
    }
    sh /= 36 * 63;
    let mot = 0.04, mcx = 0.5;
    if (prevLum) {
      mot = 0;
      let wsum = 0, xsum = 0;
      for (let px = 0; px < N; px++) {
        const df = Math.abs(lum[px] - prevLum[px]);
        mot += df; wsum += df; xsum += df * (px % 64);
      }
      mot /= N;
      if (wsum > 0.5) mcx = (xsum / wsum) / 64; // where the action is, horizontally
    }
    return { lum, stats: { bri, col, sh, mot, mcx } };
  }

  /* ═══════════ ANALYZE ORCHESTRATION ═══════════ */

  const pending = new Map();

  function analyze(item, onStatus) {
    if (item.analysis) return Promise.resolve(item.analysis);
    if (pending.has(item.id)) return pending.get(item.id);
    const p = (async () => {
      const [vis, aud] = await Promise.all([
        analyzeFrames(item, null),
        analyzeAudio(item)
      ]);
      item.analysis = { vis, aud };
      pending.delete(item.id);
      return item.analysis;
    })();
    pending.set(item.id, p);
    return p;
  }

  async function prepare(mediaList, opts) {
    opts = opts || {};
    const say = opts.status || function () {};
    const D = window.VevrisDiag ? window.VevrisDiag.last : {};
    const todo = mediaList.filter((m) => !m.analysis);
    let i = 0;
    for (const m of todo) {
      i++;
      say("Watching your footage… (" + i + " of " + todo.length + ")");
      try { await analyze(m); } catch (e) { m.analysis = { vis: null, aud: null }; }
    }
    D.analysis = mediaList.filter((m) => m.analysis && m.analysis.vis && m.analysis.vis.samples && m.analysis.vis.samples.length).length +
      "/" + mediaList.length + " files";

    /* Transcripts make the Director dramatically better, so speech auto-enables
       when a Director is configured — but ONLY once the model is already in the
       browser cache. Otherwise the very first Generate a new user ever presses
       silently stalls on a ~40 MB download they never asked for, which reads as
       the app being broken. Explicitly flipping 🎙 Speech still forces it (the
       user has then chosen to pay the download); with it off and nothing cached
       we plan from vision and audio alone, which is immediate. */
    let asrCached = false;
    if (window.VevrisCaptions && window.VevrisCaptions.modelReady) {
      try { asrCached = await window.VevrisCaptions.modelReady(); } catch (e) {}
    }
    const wantSpeech = opts.speech ||
      (asrCached && window.IntelligenceEngine && window.IntelligenceEngine.hasGemini());
    if (wantSpeech) {
      const vids = mediaList.filter((m) => m.type === "video" && m.transcript === undefined);
      let fail = null;
      for (const m of vids) {
        say("Transcribing speech in “" + m.name + "”…");
        try { await transcribe(m, say); } catch (e) { m.transcript = null; fail = (e && e.message) || String(e); }
      }
      const done = mediaList.filter((m) => m.transcript && m.transcript.length).length;
      D.whisper = fail
        ? "failed — " + fail
        : done + " file" + (done === 1 ? "" : "s") + " transcribed";
    } else {
      D.whisper = asrCached
        ? "off — enable 🎙 Speech to use it"
        : "off — turn on 🎙 Speech to transcribe (one-time ~40 MB model download)";
    }
    say("Scoring the best moments…");
  }

  /* ═══════════ TRANSCRIPTION (Whisper, on-demand) ═══════════ */

  let asr = null, asrLoading = null;

  /* ONE Whisper pipeline for the whole app. brain.js wants segment timings and
     captions.js wants word timings, but that is a difference in how the model is
     CALLED, not in the model itself — and each file used to build its own, so a
     session that generated an edit and then captioned it held the same ~40 MB
     model in memory twice. captions.js owns the loader; this delegates to it and
     only falls back if that file failed to load. */
  async function loadASR(say) {
    if (window.VevrisCaptions && window.VevrisCaptions.loadASR) {
      return window.VevrisCaptions.loadASR(say || function () {});
    }
    if (asr) return asr;
    if (!asrLoading) {
      asrLoading = (async () => {
        say("Downloading the speech model (first time only)…");
        const T = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
        T.env.allowLocalModels = false;
        asr = await T.pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
          progress_callback: (p) => {
            if (p.status === "progress" && p.progress) {
              say("Downloading the speech model… " + Math.round(p.progress) + "%");
            }
          }
        });
        return asr;
      })();
    }
    return asrLoading;
  }

  /* Word timings grouped back into sentences. Whisper is by far the slowest
     thing in the app, and it used to run TWICE over the same audio — once here
     for segments, once in captions.js for words. Words carry strictly more
     information, so one word-level pass now feeds both: this groups them into
     segments, and captions.js reuses the identical cached result for free. */
  /* Hard ceilings, because Whisper's word-level output does not reliably carry
     punctuation. Without them a stretch of unpunctuated speech merges into one
     enormous "sentence", and speechUnits() then treats that whole block as
     ATOMIC — the planner can only keep or drop the lot, so the edit collapses
     into a few very long clips and looks far dumber than it is. Splitting on
     the widest internal pause keeps the break somewhere a human would breathe. */
  const SEG_MAX_S = 11;
  const SEG_MAX_WORDS = 28;

  function groupWords(words) {
    const out = [];
    let cur = null;
    (words || []).forEach((w) => {
      const gap = cur ? w.start - cur.e : 0;
      const ended = cur && /[.!?…]["')\]]?\s*$/.test(cur.text);
      const tooLong = cur && (w.end - cur.s > SEG_MAX_S || cur.n >= SEG_MAX_WORDS);
      if (!cur || ended || gap > 0.6 || tooLong) {
        cur = { s: w.start, e: w.end, text: w.text, n: 1, widest: 0, at: -1 };
        out.push(cur);
      } else {
        if (gap > cur.widest) { cur.widest = gap; cur.at = cur.n; }  // remember the best split point
        cur.e = w.end;
        cur.text += " " + w.text;
        cur.n++;
      }
    });
    return out
      .map((c) => ({ s: c.s, e: c.e, text: String(c.text || "").trim() }))
      .filter((c) => c.text && c.e > c.s);
  }

  async function transcribe(item, say) {
    if (item.transcript !== undefined) return item.transcript;

    if (window.VevrisCaptions && window.VevrisCaptions.transcribeWords) {
      const words = await window.VevrisCaptions.transcribeWords(item, say || function () {});
      item.transcript = groupWords(words);
      return item.transcript;
    }

    // fallback: captions.js absent, do our own segment pass
    const model = await loadASR(say || function () {});
    // decode + resample to 16 kHz mono
    const buf = await (await fetch(item.url)).arrayBuffer();
    const probe = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await probe.decodeAudioData(buf);
    probe.close();
    const off = new OfflineAudioContext(1, Math.ceil(audio.duration * 16000), 16000);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const mono = (await off.startRendering()).getChannelData(0);
    const out = await model(mono, { chunk_length_s: 30, stride_length_s: 5, return_timestamps: true });
    item.transcript = (out.chunks || []).map((c) => ({
      s: c.timestamp[0] || 0,
      e: c.timestamp[1] || (c.timestamp[0] || 0) + 4,
      text: (c.text || "").trim()
    })).filter((c) => c.text);
    return item.transcript;
  }

  /* ═══════════ INTENT (prompt + footage → decisions) ═══════════ */

  const LOOK_RULES = [
    [/cinema|film|movie|epic/, "cinematic"],
    [/vintage|retro|old school|8mm|film grain|90s|80s|nostalg/, "vintage"],
    [/black and white|b&w|noir|monochrome/, "noir"],
    [/vibrant|colorful|colourful|vivid|pop|bright/, "vivid"],
    [/warm|golden|sunset|summer|cozy|romantic|wedding/, "warm"],
    [/cool|cold|winter|blue|moody/, "cool"],
    [/dream|soft|hazy|aesthetic|nostalgic/, "dreamy"]
  ];
  const FAST_RE = /fast|quick|energetic|upbeat|punchy|hype|exciting|action|reel|tiktok|party|sport|workout|gym|montage/;
  const SLOW_RE = /slow(?![ -]?mo)|calm|emotional|relax|chill|peaceful|gentle|romantic|wedding|tribute|memory|sad/;

  function decideIntent(prompt, media, rnd, fmt) {
    const p = (prompt || "").toLowerCase();
    const reasons = [];

    // aggregate footage character
    let mot = 0, bri = 0, col = 0, loud = 0, n = 0, bpm = 0, musical = 0;
    media.forEach((m) => {
      const a = m.analysis;
      if (a && a.vis) { mot += a.vis.avgMot; bri += a.vis.avgBri; col += a.vis.avgCol; n++; }
      if (a && a.aud) {
        loud = Math.max(loud, a.aud.loud);
        if (a.aud.musical > musical) { musical = a.aud.musical; bpm = a.aud.bpm; }
      }
    });
    if (n) { mot /= n; bri /= n; col /= n; }

    // pacing
    let pace;
    if (FAST_RE.test(p)) { pace = "fast"; reasons.push("fast pacing (you asked)"); }
    else if (SLOW_RE.test(p)) { pace = "slow"; reasons.push("gentle pacing (you asked)"); }
    else if (mot > 0.085 || loud > 0.45) { pace = "fast"; reasons.push("fast pacing to match your high-energy footage"); }
    else if (mot < 0.035 && loud < 0.2) { pace = "slow"; reasons.push("calm pacing to match your quiet footage"); }
    else { pace = "medium"; reasons.push("balanced pacing"); }

    // look
    let look = null;
    for (const [re, f] of LOOK_RULES) { if (re.test(p)) { look = f; break; } }
    if (!look) {
      if (bri < 0.32) { look = "cinematic"; reasons.push("cinematic look for your low-light shots"); }
      else if (col < 0.13) { look = "vivid"; reasons.push("vivid look to lift the muted colors"); }
      else if (bri > 0.55 && col > 0.2) { look = "warm"; reasons.push("warm look to match the bright footage"); }
      else { look = "cinematic"; reasons.push("cinematic look"); }
    } else reasons.push(LOOK_RULES.find((r) => r[1] === look) ? look + " look (you asked)" : look);

    // length
    let target = null;
    let m = p.match(/(\d+)\s*(?:seconds|second|secs|sec|s\b)/);
    if (m) target = +m[1];
    else if ((m = p.match(/(\d+)\s*(?:minutes|minute|mins|min)/))) target = +m[1] * 60;
    const explicitLen = target; // user's stated length, or null — user wishes always win
    const srcTotal = media.reduce((s, x) => s + (x.duration || 3), 0);
    if (!target) target = clamp(Math.round(srcTotal * (pace === "fast" ? 0.35 : 0.5)), 12, 170);
    target = Math.min(target, Math.max(8, srcTotal * 3)); // photos can stretch a bit

    // title
    let title = null;
    m = (prompt || "").match(/"([^"]{1,40})"|'([^']{1,40})'/);
    if (m) title = m[1] || m[2];
    else if ((m = p.match(/titled\s+([a-z0-9 ,!&']{2,36})/))) {
      title = m[1].trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
    }

    // format defaults fill only what the user didn't specify
    if (fmt === "film") {
      if (!FAST_RE.test(p) && !SLOW_RE.test(p)) { pace = "slow"; reasons.push("slow, filmic pacing (Film format)"); }
      if (!LOOK_RULES.some((r) => r[0].test(p))) look = "cinematic";
    }

    const slowmo = /slow[- ]?mo|slow motion/.test(p);
    const cutMin = pace === "fast" ? 0.9 : pace === "slow" ? 3.4 : 1.9;
    const cutMax = pace === "fast" ? 2.1 : pace === "slow" ? 6.2 : 3.9;

    if (bpm && pace !== "slow") reasons.push("cuts timed to the music (~" + bpm + " bpm)");

    return { pace, look, target, explicitLen, title, slowmo, cutMin, cutMax, bpm, musical, reasons };
  }

  /* ═══════════ SCORING & SEGMENT PICKING ═══════════ */

  function audioAt(aud, t) {
    if (!aud || !aud.energy.length) return 0.3;
    const i = clamp(Math.floor(t / aud.hop), 0, aud.energy.length - 1);
    return aud.energy[i];
  }

  function inVoiced(aud, t) {
    if (!aud) return null;
    for (const s of aud.voiced) if (t >= s.s && t <= s.e) return s;
    return null;
  }

  function zcrAt(aud, t) {
    if (!aud || !aud.zcr || !aud.zcr.length) return 0.1;
    const i = clamp(Math.floor(t / aud.hop), 0, aud.zcr.length - 1);
    return aud.zcr[i];
  }

  /* Wording patterns that reliably signal hooks in short-form content —
     distilled from what viral shorts have in common, encoded as rules */
  /* WORD BOUNDARIES MATTER HERE. This was written without them, so "how "
     matched inside "s-how- you", "what " inside "somew-hat ", "stop " inside
     "non-stop " — and a line like "let me show you around" scored as a stronger
     hook than the speaker's actual opening claim. Stems keep their prefix
     boundary only (\bwait matches "waiting"); short words that hide inside
     longer ones get both (\bhow\b). */
  const HOOK_WORDS = /\?|\bwait|\bwatch|\bhow\b|\bwhy\b|\bwhat\b|\bnever\b|\bno one\b|\bnobody\b|\binsane|\bcrazy|\bsecret|\bhack|\bbefore you\b|\byou won'?t\b|\bdon'?t\b|\bstop\b|\btop \d|\d+ (things|ways|tips|reasons)|\bpov\b|\blisten\b|\bokay so\b|\bso basically\b/i;

  function hookWordBonus(item, t) {
    if (!item.transcript) return 0;
    for (const c of item.transcript) {
      if (t >= c.s - 0.3 && t <= c.e + 0.3 && HOOK_WORDS.test(c.text)) return 1;
    }
    return 0;
  }

  /* ═══════════ SHORT-FORM SCORING ═══════════
     Every instant of every clip earns hook / retention / engagement points:
     hook  = loudness spikes, motion bursts, high-pitch excitement, hook wording
     ret   = sustained energy, movement, scene variety, sharpness
     eng   = speech, audible energy, excited delivery                       */
  function shortCurves(item) {
    const a = item.analysis || {};
    const vis = a.vis, aud = a.aud;
    if (!vis || !vis.samples || vis.samples.length < 2) return null;
    let shMax = 0.001, motAvg = 0.0001, eAvg = 0.0001;
    const n = vis.samples.length;
    vis.samples.forEach((s) => { shMax = Math.max(shMax, s.sh); motAvg += s.mot; });
    motAvg /= n;
    vis.samples.forEach((s) => { eAvg += audioAt(aud, s.t); });
    eAvg /= n;
    return vis.samples.map((s) => {
      const e = audioAt(aud, s.t);
      const eSpike = clamp(e / (eAvg * 2 + 0.05), 0, 1);
      const mSpike = clamp(s.mot / (motAvg * 2 + 0.01), 0, 1);
      const pitchy = clamp(zcrAt(aud, s.t) * 3, 0, 1);
      const sharp = s.sh / shMax;
      const voice = inVoiced(aud, s.t) ? 1 : 0;
      const words = hookWordBonus(item, s.t);
      const nearCut = vis.sceneCuts.some((c) => Math.abs(c - s.t) < 1.2) ? 1 : 0;
      return {
        t: s.t,
        hook: 26 * eSpike + 22 * mSpike + 14 * pitchy + 12 * sharp + 10 * voice + 16 * words,
        ret: 30 * clamp(e / (eAvg + 0.05) / 1.5, 0, 1) + 26 * clamp(s.mot / (motAvg + 0.01) / 1.5, 0, 1) + 16 * nearCut + 14 * sharp + 14 * voice,
        eng: 40 * voice + 24 * clamp(e, 0, 1) + 16 * pitchy + 20 * words,
        mot: s.mot, e: e
      };
    });
  }

  function qualityCurve(item) {
    const a = item.analysis;
    const vis = a && a.vis, aud = a && a.aud;
    if (!vis || !vis.samples.length) return [{ t: 0, q: 0.5, mot: 0.05 }];
    // normalizers
    let shMax = 0.001, motMax = 0.001;
    vis.samples.forEach((s) => { shMax = Math.max(shMax, s.sh); motMax = Math.max(motMax, s.mot); });
    const curve = vis.samples.map((s) => {
      const sharp = s.sh / shMax;
      const briOk = clamp(1 - Math.abs(s.bri - 0.5) * 1.9, 0, 1);
      const motN = s.mot / motMax;
      const motInterest = motN < 0.75 ? motN / 0.75 : clamp(1 - (motN - 0.75) * 2.2, 0.15, 1); // chaos penalty
      const aE = audioAt(aud, s.t);
      let q = sharp * 0.24 + briOk * 0.2 + s.col * 0.6 * 0.14 + motInterest * 0.24 + aE * 0.18;
      if (inVoiced(aud, s.t)) q += 0.08;
      return { t: s.t, q, mot: s.mot };
    });
    // light smoothing
    for (let i = 1; i < curve.length - 1; i++) {
      curve[i].q = (curve[i - 1].q + curve[i].q * 2 + curve[i + 1].q) / 4;
    }
    return curve;
  }

  function buildCandidates(item, intent, rnd) {
    const cands = [];
    const dur = item.duration || 3;
    if (item.type !== "video") {
      cands.push({ item, s: 0, e: Math.min(3.2, intent.cutMax), q: (qualityCurve(item)[0].q || 0.5) * 0.92, photo: true, mot: 0.04, aE: 0.2 });
      return cands;
    }
    const curve = qualityCurve(item);
    const aud = item.analysis && item.analysis.aud;
    const minGap = intent.cutMin * 1.1;

    // whole sentences are candidates in their own right — atomic, never sliced
    const units = speechUnits(item);
    units.forEach((u) => {
      let q = 0, cnt = 0, mot = 0;
      curve.forEach((c) => { if (c.t >= u.s && c.t <= u.e) { q += c.q; mot += c.mot; cnt++; } });
      cands.push({
        item, s: u.s, e: Math.min(u.e, dur),
        q: (cnt ? q / cnt : 0.5) + 0.2, photo: false,
        mot: cnt ? mot / cnt : 0.05, aE: audioAt(aud, (u.s + u.e) / 2)
      });
    });

    // visual peaks only OUTSIDE speech — no interval cuts over talking
    const peaks = [];
    for (let i = 1; i < curve.length - 1; i++) {
      if (curve[i].q >= curve[i - 1].q && curve[i].q >= curve[i + 1].q) {
        if (!peaks.length || curve[i].t - peaks[peaks.length - 1].t > minGap) peaks.push(curve[i]);
        else if (curve[i].q > peaks[peaks.length - 1].q) peaks[peaks.length - 1] = curve[i];
      }
    }
    if (!peaks.length) peaks.push(curve[Math.floor(curve.length / 2)] || { t: dur / 2, q: 0.5, mot: 0.05 });

    peaks.forEach((pk) => {
      if (inUnits(units, pk.t)) return;
      let L = intent.cutMin + rnd() * (intent.cutMax - intent.cutMin);
      let s = clamp(pk.t - L * 0.4, 0, Math.max(0, dur - L));
      let e = Math.min(s + L, dur);
      // never cut into the middle of speech / a musical phrase
      const vs = inVoiced(aud, s), ve = inVoiced(aud, e);
      if (vs) s = Math.max(0, vs.s - 0.12);
      if (ve) e = Math.min(dur, Math.min(ve.e + 0.12, s + intent.cutMax * 1.7));
      if (e - s < 0.4) return;
      // average quality inside window
      let q = 0, cnt = 0, mot = 0;
      curve.forEach((c) => { if (c.t >= s && c.t <= e) { q += c.q; mot += c.mot; cnt++; } });
      q = cnt ? q / cnt : pk.q;
      mot = cnt ? mot / cnt : pk.mot;
      // transcript bonus: whole sentences are gold
      if (item.transcript && item.transcript.some((c) => c.s >= s - 0.2 && c.e <= e + 0.2)) q += 0.15;
      cands.push({ item, s, e, q, photo: false, mot, aE: audioAt(aud, (s + e) / 2) });
    });
    return cands;
  }

  function pickSegments(media, intent, rnd) {
    const bySource = media.map((m) => ({
      m,
      cands: buildCandidates(m, intent, rnd).sort((a, b) => b.q - a.q),
      picked: []
    })).filter((g) => g.cands.length);

    const picked = [];
    let sum = 0, safety = 0;
    // round-robin across sources for variety, best-first within each
    while (sum < intent.target && safety++ < 300) {
      let took = false;
      for (const g of bySource) {
        if (sum >= intent.target) break;
        const next = g.cands.find((c) =>
          !g.picked.some((p) => c.s < p.e + 0.25 && c.e > p.s - 0.25));
        if (!next) continue;
        g.cands = g.cands.filter((c) => c !== next);
        g.picked.push(next);
        picked.push(next);
        sum += (next.e - next.s);
        took = true;
      }
      if (!took) break; // sources exhausted — shorter than target is fine
    }
    return picked;
  }

  /* ═══════════ ARRANGEMENT (story arc) ═══════════ */

  function arrange(picked, media, rnd) {
    if (picked.length <= 2) return picked;
    const energy = (c) => c.mot * 4 + c.aE;
    // opening: calm but high quality
    let opening = picked.slice().sort((a, b) => (b.q - energy(b) * 0.25) - (a.q - energy(a) * 0.25))[0];
    // ending: the calmest of the rest
    const rest = picked.filter((c) => c !== opening);
    let ending = rest.slice().sort((a, b) => energy(a) - energy(b))[0];
    // middle: chronological story order (source order, then time)
    const mid = rest.filter((c) => c !== ending).sort((a, b) => {
      const ai = media.indexOf(a.item), bi = media.indexOf(b.item);
      return ai !== bi ? ai - bi : a.s - b.s;
    });
    // push the single most energetic middle segment toward the 3/4 mark
    if (mid.length > 3) {
      let pk = 0;
      for (let i = 1; i < mid.length; i++) if (energy(mid[i]) > energy(mid[pk])) pk = i;
      const seg = mid.splice(pk, 1)[0];
      mid.splice(Math.floor(mid.length * 0.72), 0, seg);
    }
    return [opening].concat(mid, [ending]);
  }

  /* ═══════════ INTELLIGENCE LAYER GLUE ═══════════
     VevrisBrain stays the orchestrator: it builds a structured request,
     asks the IntelligenceEngine (Vision-1.0 → Gemini), validates and
     executes whatever comes back — or falls back to its own planner. */

  const LOOKS = ["none", "cinematic", "vivid", "warm", "cool", "noir", "vintage", "dreamy"];

  /* The speaker's own most arresting line, trimmed to fit on screen. Reads the
     transcript for hook wording first (questions, claims, "wait", "never",
     numbers…), and falls back to whatever they opened with — an imperfect hook
     drawn from real speech beats no hook at all. */
  function bestHookLine(media) {
    let best = null, bestScore = -1, first = null;
    media.forEach((m) => {
      (m.transcript || []).forEach((c) => {
        const text = String(c.text || "").trim();
        if (text.length < 6) return;
        if (!first || c.s < first.s) first = { s: c.s, text: text };
        // earlier lines win ties: a hook belongs at the top of the video
        const score = (HOOK_WORDS.test(text) ? 10 : 0) +
                      (/[!?]/.test(text) ? 3 : 0) +
                      (/\d/.test(text) ? 2 : 0) +
                      Math.max(0, 4 - c.s / 8);
        if (score > bestScore) { bestScore = score; best = text; }
      });
    });
    const pick = (bestScore >= 5 ? best : (first && first.text)) || null;
    if (!pick) return null;
    const clean = pick.replace(/^[\s,.-]+/, "").trim();
    return clean.length > 46 ? clean.slice(0, 45).trim() + "…" : clean;
  }

  function mediaMeta(media) {
    return media.map((m) => ({
      id: m.id, name: m.name, type: m.type,
      duration: Math.round((m.duration || 0) * 10) / 10,
      transcribed: !!(m.transcript && m.transcript.length)
    }));
  }

  /* The sound effects the Director may use, straight from sfx.js, so a voice
     added there is offered here with no second list to keep in step. Only
     voices with a `use` line: that line is what the Director is taught, and a
     sound it has not been taught is a sound it will use wrongly. */
  function soundLibrary() {
    const X = window.VevrisSFX;
    if (!X || !X.available || !X.available() || !X.list) return [];
    return X.list().filter((s) => s && s.use).map((s) => ({
      name: s.name,
      duration: Math.round(s.duration * 100) / 100,
      hit: Math.round((s.hit || 0) * 100) / 100,
      use: s.use
    }));
  }

  /* Gaps between words longer than 0.8s, with whether something audible
     filled them (mean energy over 0.2: laughter, applause, music). For
     Vision-1.0, which reads a filled pause after a line as a punchline. */
  function pausesOf(m, aud) {
    const ws = m.words || [];
    const out = [];
    for (let k = 1; k < ws.length; k++) {
      const gs = ws[k - 1].end, ge = ws[k].start;
      if (!(ge - gs > 0.8)) continue;
      let sum = 0, n = 0;
      if (aud && aud.energy && aud.energy.length) {
        const hop = aud.hop || 0.05;
        for (let i = Math.floor((gs + 0.1) / hop); i < Math.min(aud.energy.length, Math.ceil((ge - 0.1) / hop)); i++) { sum += aud.energy[i]; n++; }
      }
      out.push([Math.round(gs * 100) / 100, Math.round(ge * 100) / 100, n && sum / n > 0.2 ? 1 : 0]);
    }
    return out;
  }

  /* opts.range scopes the edit to one stretch of one source: a clip found in a
     long recording (clips.js). Its transcript is cut to that stretch and its
     keyframes are taken from inside it, so the Director sees only the clip,
     at the same size of request as a short upload. */
  function buildRequest(opts, fmt, intent, media) {
    const r = opts.range || null;
    return {
      prompt: opts.prompt || "",
      format: fmt,
      target: opts.target || intent.explicitLen || null, // no target → the story decides the length
      sfx: soundLibrary(),
      // {available, chosen}: app.js knows whether the creator already picked a track
      music: opts.music || null,
      range: r ? { mediaId: r.mediaId, start: r.start, end: r.end } : null,
      media: media.map((m) => {
        const a = m.analysis || {};
        const mine = r && r.mediaId === m.id;
        const inside = (c) => !mine || (c.e > r.start + 0.05 && c.s < r.end - 0.05);
        const kept = (m.transcript || []).filter(inside);
        const RX = window.VevrisRetention;
        return {
          id: m.id, name: m.name, type: m.type, duration: m.duration || 3,
          transcript: kept.map((c) => ({
            s: Math.round(c.s * 10) / 10, e: Math.round(c.e * 10) / 10, text: c.text
          })),
          /* For the on-device editor only (Vision-1.0 reads word timing and
             how lifted each line's delivery is). The cloud Directors are sent
             named fields (footageParts/footageText), never the whole request,
             so neither of these leaves the device. */
          words: (m.words || []).filter((w) => !mine || (w.end > r.start && w.start < r.end))
            .map((w) => [w.text, Math.round(w.start * 100) / 100, Math.round(w.end * 100) / 100]),
          prosody: RX ? kept.map((c) => Math.round(RX.prosodyOf(a.aud, c.s, c.e) * 100) / 100) : [],
          // pauses over 0.8s between words, and whether the room filled them (a laugh, applause)
          pauses: pausesOf(m, a.aud),
          stats: a.vis ? {
            avgMot: Math.round(a.vis.avgMot * 1000) / 1000,
            loud: a.aud ? Math.round(a.aud.loud * 100) / 100 : 0,
            bpm: a.aud ? a.aud.bpm : 0
          } : null,
          keyframes: mine && r.keyframes && r.keyframes.length ? r.keyframes : ((a.vis && a.vis.keyframes) || [])
        };
      })
    };
  }

  function materialize(ai, intent, fmt, media) {
    const look = LOOKS.includes(ai.look) ? ai.look : intent.look;
    const clips = ai.clips.map((c, i) => ({
      mediaId: c.mediaId, in: c.in, out: c.out,
      speed: 1, volume: 1, muted: false, filter: look, fadeIn: 0, fadeOut: 0,
      _i: i   // which Director clip this is, through the merges below; see soundMoments()
    }));
    // the Director's effects — emphasis only, never decoration
    (ai.effects || []).forEach((ef) => {
      const c = clips[ef.clip];
      if (!c) return;
      if (ef.type === "slow-mo") c.speed = 0.5;
      else if (ef.type === "speed-up") c.speed = 1.4;
      else if (ef.type === "punch-in") c.kb = { s0: 1, s1: 1.09, x0: 0, x1: 0, y0: 0, y1: 0 };
    });
    snapToSentences(clips, media); // even the Director can't cut mid-sentence
    /* What keeps people watching, enforced whatever the Director said
       (retention.js, findings RQ1/RQ4/RQ10): start on speech, not on a
       greeting; end on the last word, not a sign-off; close dead air to a
       breath; reframe jump cuts. Every edge stays on a sentence boundary,
       and the Director's indices (_i) ride along on any split. */
    const RX = window.VevrisRetention;
    const tightened = RX ? RX.tighten(clips, media) : null;
    const reframed = RX ? RX.zoomCuts(clips) : 0;
    const sfx = soundMoments(ai, clips);
    /* Cutaways onto the words they illustrate, now that the clip list is
       final. This replaced re-clamping an `after` index, which was the bug:
       a clip merge shifted every later index, and even when the index was
       right the cutaway sat at the START of the clip, not on its words. */
    const broll = placeBroll(ai.broll || [], clips, media);
    clips.forEach((c) => { delete c._i; });
    // No opening fade when a hook has to be read in the first second — fading
    // up from black over the most important text in the video is self-defeating.
    const hasHook = (ai.texts || []).some((t) => (+t.start || 0) < 1);
    clips[0].fadeIn = (fmt === "short" || hasHook) ? 0 : 0.4;
    clips[clips.length - 1].fadeOut = 0.5;
    // Hook / on-screen texts only — captions are now the karaoke system
    // (VevrisCaptions), built word-timed after the edit. No sentence-captions.
    const texts = [];
    (ai.texts || []).forEach((t) => texts.push(t));

    /* A hook is not optional. If the Director returns no on-screen text — it
       happens, and the result is a video that just starts, which is the single
       worst opening a short can have — build one from what the speaker actually
       said. Prefer a line carrying hook wording, else the opening line. */
    if (!texts.length) {
      const line = bestHookLine(media);
      if (line) {
        texts.push({ text: line, start: 0.1, dur: 2.2, pos: "top", size: 40, color: "#ffffff" });
      }
    }
    /* A text's entrance sound lands as the text appears. It comes off the text
       here and becomes a sound on the timeline in its own right, so a text
       moved by hand later cannot carry a stale claim to one. */
    texts.forEach((t) => {
      if (t.sfx) sfx.push({ name: t.sfx, at: Math.max(0, +t.start || 0), why: "text appears" });
      delete t.sfx;
    });
    if (window.VevrisDiag) {
      window.VevrisDiag.last.hook = texts.length ? texts[0].text : "none produced";
      /* Did it actually cold-open? Comparing where clip 1 starts in the SOURCE
         against the earliest clip tells you instantly whether the opener was
         lifted from later in the recording or whether it just ran the video
         from the top — which is the difference the owner was seeing. */
      const firstIn = clips[0] ? clips[0].in : 0;
      const earliest = clips.reduce((a, c) => Math.min(a, c.in), Infinity);
      window.VevrisDiag.last.opener = firstIn > earliest + 1
        ? "cold open from " + firstIn.toFixed(1) + "s"
        : "chronological (from " + firstIn.toFixed(1) + "s)";
    }
    const tot = clips.reduce((s, c) => s + (c.out - c.in) / (c.speed || 1), 0);
    const storyLine = ai.story
      ? "“" + String(ai.story).slice(0, 70) + "”"
      : null;
    const conf = typeof ai.confidence === "number" ? ai.confidence : null;
    /* The retention check. Its numbers are a PROXY (retention.js explains
       why), so the summary says only what was done and what was found, never
       a predicted percentage; the numbers go to the diagnostics and the
       training data, where they are read as what they are. */
    let retention = null, tidy = "";
    if (RX) {
      const checked = RX.check({ clips: clips, texts: texts, broll: broll, sfx: sfx }, media);
      retention = { decided: ai.retention || null, tightened: tightened, reframed: reframed,
        estimate: checked.est, rules: checked.rules };
      const t = tightened || {};
      const did = [];
      if (t.greeting) did.push("greeting cut");
      if (t.signoff) did.push("sign-off cut");
      if (t.gaps) did.push(t.gaps + (t.gaps === 1 ? " pause" : " pauses") + " tightened");
      if (t.lead || t.tail) did.push("dead air trimmed");
      if (checked.est) did.push("speech from " + checked.est.firstSpeech.toFixed(1) + "s");
      tidy = did.length ? " · " + did.join(", ") : "";
      if (window.VevrisDiag) window.VevrisDiag.last.retention = checked.passed + "/" + checked.total + " checks" +
        (checked.est ? " · proxy " + checked.est.score + " (uncalibrated)" : "");
    }
    const summary = "Director: " + (ai.providerLabel || "AI") +
      (storyLine ? " · " + storyLine : "") +
      " · " + clips.length + " cuts · " + Math.round(tot) + "s" + tidy +
      (conf !== null ? " · confidence " + Math.round(conf * 100) + "%" + (conf < 0.7 ? " — worth reviewing" : "") : "");
    // b-roll travels as a REQUEST, not as media: app.js fetches and splices it
    // in after the timeline exists, so a failed download costs a cutaway and
    // never the whole edit. Music travels the same way, as a brief for app.js
    // to search the library with. Sound effects arrive as MOMENTS on the
    // timeline; placeSounds() turns them into placements once b-roll has
    // settled, because a cutaway's entrance sound only exists if it was found.
    return {
      clips: clips, texts: texts, broll: broll,
      sfx: sfx, music: ai.music || null,
      summary: summary, vertical: fmt === "short",
      retention: retention
    };
  }

  /* The Director's sound effects, attached to their clips by intelligence.js,
     turned into TIMELINE moments now that the clip list is final.
     A sound on a CUT needs its clip to still exist: snapToSentences may have
     merged it into the clip before, and then there is no cut left to mark.
     A sound on a MOMENT only needs that footage to still be in the edit,
     whichever clip now holds it: snapping only ever extends and merges, so a
     moment inside a Director clip is always inside some final one. */
  function soundMoments(ai, clips) {
    const out = [];
    const startAt = new Map();
    let acc = 0;
    clips.forEach((c) => { startAt.set(c, acc); acc += (c.out - c.in) / (c.speed || 1); });
    (ai.clips || []).forEach((src, i) => {
      (src.sfx || []).forEach((x) => {
        if (x.cut) {
          const own = clips.find((c) => c._i === i);
          if (own) out.push({ name: x.name, at: startAt.get(own), why: x.why || "" });
          return;
        }
        const holds = (c) => x.t >= c.in - 0.001 && x.t <= c.out + 0.001;
        const host = clips.find((c) => c._i === i && holds(c)) ||
                     clips.find((c) => c.mediaId === src.mediaId && holds(c));
        if (host) out.push({ name: x.name, at: startAt.get(host) + (x.t - host.in) / (host.speed || 1), why: x.why || "" });
      });
    });
    return out;
  }

  /* ═══════════ B-ROLL ON ITS WORDS ═══════════
     The owner's verdict on 2026-10-08 was that the GIFs were "absolutely
     irrelevant". The searches were mostly fine; the TIMING was not. A cutaway
     was attached to a clip and shown a third of a second into it, so a GIF
     about the rent arrived while the speaker was still on the sentence
     before, which reads as a random GIF. Now each one is placed on the words
     it illustrates:
       1. the words the Director quoted (`say`), searched in what was really
          said, nearest the moment it named
       2. else the moment it named (`t`), snapped to the word starting there
       3. else a word of the search itself being spoken ("Tokyo")
       4. else it is dropped. A GIF on the wrong moment is worse than none.
     Only footage that is still in the edit counts, and the result follows
     clip merges and speed changes like soundMoments() does. Two cutaways
     never overlap; the later one is dropped. */
  const LEAD = 0.08;     // on screen a hair before the word, as an editor cuts it
  const GAP = 0.4;       // breathing room between two cutaways
  const QUIET = new Set(("a an the of and or to in on for with at is it its this that these those be been " +
    "am are was were do does did my your his her their our some any very really just so as by from into " +
    "about over under out up down reaction meme gif funny photo video shot clip").split(" "));

  function wordKey(s) {
    return String(s || "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, "");
  }
  function keys(text) {
    return String(text || "").split(/\s+/).map(wordKey).filter(Boolean);
  }
  // what was said, word by word, in source seconds: Whisper's words where they
  // exist, else each transcript line spread evenly over its own span
  function spoken(m) {
    if (m.words && m.words.length) {
      return m.words.map((w) => ({ k: wordKey(w.text), s: +w.start || 0, e: +w.end || +w.start || 0 })).filter((w) => w.k);
    }
    const out = [];
    (m.transcript || []).forEach((c) => {
      const ks = keys(c.text);
      const step = (c.e - c.s) / Math.max(1, ks.length);
      ks.forEach((k, i) => out.push({ k: k, s: c.s + i * step, e: c.s + (i + 1) * step }));
    });
    return out;
  }

  /* The best stretch of `ws` for the phrase `want`: the share of its words
     found in order within a window a little longer than the phrase. Ties go to
     the stretch nearest `near`. At least 60% of the words must be there. */
  function findPhrase(ws, want, near) {
    if (!want.length || !ws.length) return null;
    let best = null;
    const span = want.length + 2;
    for (let i = 0; i < ws.length; i++) {
      if (ws[i].k !== want[0] && ws[i].k !== want[1]) continue;
      let j = i, got = 0, first = null, last = null;
      for (const k of want) {
        let found = -1;
        for (let x = j; x < Math.min(ws.length, i + span); x++) if (ws[x].k === k) { found = x; break; }
        if (found < 0) continue;
        got++;
        if (first == null) first = ws[found];
        last = ws[found];
        j = found + 1;
      }
      const score = got / want.length;
      if (score < 0.6) continue;
      const dist = near == null ? 0 : Math.abs(first.s - near);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && dist < best.dist)) {
        best = { score: score, dist: dist, s: first.s, e: last.e };
      }
    }
    return best;
  }

  function placeBroll(list, clips, media) {
    const startAt = new Map();
    let acc = 0;
    clips.forEach((c) => { startAt.set(c, acc); acc += (c.out - c.in) / (c.speed || 1); });
    const holds = (c, mid, s) => c.mediaId === mid && s >= c.in - 0.001 && s <= c.out + 0.001;
    const onTimeline = (mid, s, ci) => {
      const host = (ci != null && clips.find((c) => c._i === ci && holds(c, mid, s))) ||
                   clips.find((c) => holds(c, mid, s));
      return host ? startAt.get(host) + (s - host.in) / (host.speed || 1) : null;
    };
    const kept = (mid) => (w) => clips.some((c) => holds(c, mid, w.s));
    const D = window.VevrisDiag && window.VevrisDiag.last;

    const placed = [];
    let dropped = 0;
    list.forEach((b) => {
      const sources = b.mediaId != null ? media.filter((m) => m.id === b.mediaId) : media;
      let hit = null;
      for (const m of sources) {
        const ws = spoken(m).filter(kept(m.id));
        let at = null;
        if (b.say) at = findPhrase(ws, keys(b.say), b.t);
        if (!at && b.t != null && clips.some((c) => holds(c, m.id, b.t))) {
          // the moment it named, snapped to a word that starts close by
          const w = ws.reduce((x, y) => (Math.abs(y.s - b.t) < Math.abs((x ? x.s : Infinity) - b.t) ? y : x), null);
          at = w && Math.abs(w.s - b.t) <= 0.6 ? { s: w.s, e: w.e } : { s: b.t, e: b.t };
        }
        if (!at) {
          const words = keys(b.query).filter((k) => k.length > 2 && !QUIET.has(k));
          for (const k of words) {
            const w = ws.find((x) => x.k === k || (k.length > 4 && x.k.indexOf(k.slice(0, -1)) === 0));
            if (w) { at = { s: w.s, e: w.e }; break; }
          }
        }
        if (at) { hit = { mid: m.id, s: at.s, e: at.e }; break; }
      }
      const t = hit ? onTimeline(hit.mid, hit.s, b.ci) : null;
      if (t == null) { dropped++; return; }
      const item = {
        at: Math.max(0, t - LEAD),
        // long enough to cover the words it illustrates, never a long hold
        dur: Math.min(4, Math.max(b.dur || 1.6, Math.min(3, hit.e - hit.s + 0.35), 0.8)),
        query: b.query, kind: b.kind, mode: b.mode, say: b.say || ""
      };
      if (b.sfx) item.sfx = b.sfx;
      placed.push(item);
    });
    placed.sort((a, b) => a.at - b.at);
    const out = [];
    placed.forEach((p) => {
      const prev = out[out.length - 1];
      if (prev && p.at < prev.at + prev.dur + GAP) { dropped++; return; }
      out.push(p);
    });
    if (D) D.brollPlaced = out.length + " on their words" + (dropped ? ", " + dropped + " with no clear moment left out" : "");
    return out;
  }

  /* Hard guarantee: no cut boundary may land inside a spoken sentence.
     Runs on EVERY plan (Director or heuristic) — boundaries inside a
     transcript chunk get pushed out to the sentence edges, and clips
     that end up overlapping are merged. */
  function snapToSentences(clips, media) {
    clips.forEach((c) => {
      const m = media.find((x) => x.id === c.mediaId);
      if (!m) return;
      const units = speechUnits(m);
      if (!units.length) return;
      const dur = m.duration || c.out;
      /* Extending a cut out to a sentence edge is right, but only by a LITTLE.
         Speech units can run to 11s, and without a ceiling this rule would drag
         several seconds of deliberately-removed speech back into the edit —
         which is how words the Director had cut ended up captioned on screen.
         Beyond this, the Director's decision to drop the material wins over
         tidiness at the boundary. */
      const MAX_SNAP = 1.5;
      units.forEach((u) => {
        if (c.in > u.s + 0.25 && c.in < u.e - 0.2 && c.in - u.s <= MAX_SNAP) {
          c.in = Math.max(0, u.s - 0.1);
        }
        if (c.out > u.s + 0.2 && c.out < u.e - 0.2 && u.e - c.out <= MAX_SNAP) {
          c.out = Math.min(dur, u.e);
        }
      });
    });
    for (let i = clips.length - 2; i >= 0; i--) {
      const a = clips[i], b = clips[i + 1];
      if (a.mediaId === b.mediaId && b.in < a.out - 0.05 && b.out > a.in) {
        a.in = Math.min(a.in, b.in);
        a.out = Math.max(a.out, b.out);
        clips.splice(i + 1, 1);
      }
    }
    return clips;
  }

  /* Find where the voice actually goes quiet: scan the audio-energy map
     forward from t for the first sustained low-energy stretch. This is how
     we STOP cutting people off mid-word — a clip end is only allowed where
     the audio shows real silence, not just where Whisper's timestamp lands
     (Whisper often marks the end a beat early, while the person talks on). */
  function nextSilence(aud, t, maxAhead) {
    if (!aud || !aud.energy || !aud.energy.length) return t;
    const hop = aud.hop || 0.05;
    const th = 0.11;                                  // below this = quiet
    const need = Math.max(3, Math.round(0.22 / hop)); // sustained ~220ms
    const start = clamp(Math.floor(t / hop), 0, aud.energy.length - 1);
    const limit = Math.min(aud.energy.length, start + Math.round((maxAhead || 1.5) / hop));
    let run = 0;
    for (let i = start; i < limit; i++) {
      if (aud.energy[i] < th) { run++; if (run >= need) return (i - need + 1) * hop; }
      else run = 0;
    }
    return t; // still talking through the whole window — don't force a cut
  }

  /* Speech units: transcript chunks grouped into whole sentences/thoughts,
     then each end snapped OUT to real audio silence. Over continuous talking
     these are ATOMIC — the planner may drop a whole unit but never slice
     inside one, and never interval-cuts across them. */
  function speechUnits(m) {
    if (!m.transcript || !m.transcript.length) return [];
    const aud = m.analysis && m.analysis.aud;
    const dur = m.duration || 1e9;
    const units = [];
    let cur = null;
    m.transcript.forEach((ch) => {
      const endsSentence = /[.!?…]["')]?\s*$/.test(ch.text || "");
      if (cur && !cur.closed && ch.s - cur.rawEnd < 0.45) {
        cur.rawEnd = ch.e;
      } else {
        cur = { s: Math.max(0, ch.s - 0.1), rawEnd: ch.e, closed: false };
        units.push(cur);
      }
      if (endsSentence) cur.closed = true;
    });
    units.forEach((u) => {
      const sil = nextSilence(aud, u.rawEnd, 1.5);
      // end = later of (transcript end + small pad) and (measured silence)
      u.e = clamp(Math.max(u.rawEnd + 0.12, sil + 0.06), u.s + 0.3, dur);
      delete u.rawEnd; delete u.closed;
    });
    return units;
  }
  function inUnits(units, t) {
    return units.some((u) => t > u.s && t < u.e);
  }

  /* Short-form captions: one short centered phrase at a time */
  function splitPhrases(text) {
    const words = String(text).trim().split(/\s+/);
    const out = [];
    let cur = [];
    words.forEach((w) => {
      cur.push(w);
      if (cur.join(" ").length >= 22 || cur.length >= 5 || /[.!?]$/.test(w)) {
        out.push(cur.join(" "));
        cur = [];
      }
    });
    if (cur.length) out.push(cur.join(" "));
    return out.map((p) => p.replace(/,$/, ""));
  }

  function addCaptions(clips, texts, media) {
    let pos = 0, added = 0;
    clips.forEach((c) => {
      const m = media.find((x) => x.id === c.mediaId);
      const dd = (c.out - c.in) / (c.speed || 1);
      if (m && m.transcript && m.transcript.length && added < 90) {
        m.transcript.forEach((ch) => {
          if (added >= 90) return;
          const s = Math.max(ch.s, c.in), e = Math.min(ch.e, c.out);
          if (e - s < 0.3) return;
          // split the sentence into short phrases, timed proportionally
          const phrases = splitPhrases(ch.text);
          const totalChars = phrases.reduce((a, p) => a + p.length, 0) || 1;
          let t0 = s;
          phrases.forEach((p) => {
            if (added >= 90) return;
            const pd = Math.max(0.5, (e - s) * (p.length / totalChars));
            texts.push({
              text: p,
              start: pos + (t0 - c.in) / (c.speed || 1),
              dur: pd / (c.speed || 1),
              size: 30, color: "#ffffff", pos: "center", cap: true
            });
            t0 += pd;
            added++;
          });
        });
      }
      pos += dd;
    });
    return added;
  }

  /* ═══════════ SOUND EFFECTS: THE EDITOR'S RULES ═══════════
     The Director names moments; this turns them into placements. Enforced
     here, whatever the provider said, for the same reason cutting
     mid-sentence is: a model that is told the rules still breaks them. */

  /* Where timeline time t falls in the footage: the clip, and the source
     second on screen. */
  function sourceAt(clips, t) {
    let acc = 0;
    for (const c of clips) {
      const d = (c.out - c.in) / (c.speed || 1);
      if (t < acc + d) return { clip: c, s: c.in + (t - acc) * (c.speed || 1) };
      acc += d;
    }
    return null;
  }

  /* Is someone talking at timeline time t? The words Whisper timed where there
     are some; otherwise loud audio, the best evidence there is without a
     transcript, and it errs toward "yes", the safe side for anything mixed
     underneath a voice. */
  function speakingAt(clips, media, t) {
    const at = sourceAt(clips, t);
    if (!at || at.clip.muted || at.clip.volume === 0) return false;
    const m = media.find((x) => x.id === at.clip.mediaId);
    if (!m || m.type !== "video") return false;
    if (m.words && m.words.length) return m.words.some((w) => at.s >= w.start - 0.12 && at.s <= w.end + 0.12);
    if (m.transcript && m.transcript.length) return m.transcript.some((u) => at.s >= u.s && at.s <= u.e);
    return !!inVoiced(m.analysis && m.analysis.aud, at.s);
  }

  // Share of the edit with someone talking, sampled every quarter second.
  function speechShare(clips, media) {
    const len = clips.reduce((s, c) => s + (c.out - c.in) / (c.speed || 1), 0);
    let n = 0, talk = 0;
    for (let t = 0.125; t < len; t += 0.25) { n++; if (speakingAt(clips, media, t)) talk++; }
    return n ? talk / n : 0;
  }

  // The only sounds allowed to land together: a build, and the hit it builds to.
  const IMPACT = { boom: true, subdrop: true };
  const BUILD = { riser: true, drumroll: true };
  const landTogether = (a, b) => (BUILD[a] && IMPACT[b]) || (BUILD[b] && IMPACT[a]);

  /* Moments → placements. Each sound starts `hit` seconds early (sfx.js) so
     its impact lands on the moment; a riser whose build does not fit before
     its moment is dropped rather than started late, because a riser landing
     after its drop marks nothing. Then the rules, in the order an editor
     applies them:
       · no more than one moment per ~5 seconds of edit (a riser and the
         impact it lands on are one moment)
       · a riser at most once per 40 seconds; the others as often as their
         own `max` in sfx.js allows (the airhorn and most comedy stings once)
       · the same sound twice within 2 seconds is a stutter, not an edit
       · two impacts within 0.35s blur into one; only a riser and the hit it
         builds to may share a moment
       · on speech, 0.7 of full level (a riser 0.5): punctuation under the
         voice, never on top of it. A riser is judged across its build, since
         seconds of rising noise under a sentence is how a word gets buried.
     Sounds placed by hand come in as `keep`. They are never moved; the
     Director's sounds make room for them. */
  function placeSounds(opts) {
    const X = window.VevrisSFX;
    const clips = (opts && opts.clips) || [], media = (opts && opts.media) || [];
    const len = clips.reduce((s, c) => s + (c.out - c.in) / (c.speed || 1), 0);
    const out = [];
    if (!X || !X.has || !X.info || len <= 0) return out;
    const hitOf = (name) => { const i = X.info(name); return (i && i.hit) || 0; };
    const want = ((opts && opts.want) || [])
      .filter((w) => w && X.has(w.name) && isFinite(w.at) && w.at >= 0 && w.at <= len + 0.05)
      .sort((a, b) => a.at - b.at);
    /* The cap counts MOMENTS, not sounds: a riser and the boom it lands on
       are one moment. Counting both would let the cap keep the build and cut
       the payoff it was building to. */
    const cap = clamp(Math.round(len / 5), 2, 12);
    const risers = Math.max(1, Math.floor(len / 40));
    const hits = ((opts && opts.keep) || []).filter((k) => k && X.has(k.name))
      .map((k) => ({ name: k.name, at: (+k.start || 0) + hitOf(k.name) }));
    const count = {};
    let moments = 0;
    for (const w of want) {
      const hit = hitOf(w.name);
      let start = w.at - hit;
      if (start < 0) {
        if (hit > 0.5 || start < -0.15) continue;
        start = 0;
      }
      if (start > len - 0.05) continue;
      const n = count[w.name] || 0;
      const most = (X.info(w.name) || {}).max || 0;
      if ((w.name === "riser" && n >= risers) || (most && n >= most)) continue;
      const land = start + hit;
      let paired = false;
      const crowded = hits.some((h) => {
        const gap = Math.abs(h.at - land);
        if (h.name === w.name) return gap < 2;
        if (gap >= 0.35) return false;
        if (landTogether(h.name, w.name)) { paired = true; return false; }
        return true;
      });
      if (crowded || (!paired && moments >= cap)) continue;
      if (!paired) moments++;
      const talking = speakingAt(clips, media, land) ||
        (hit > 0.5 && speakingAt(clips, media, Math.max(0, land - hit / 2)));
      out.push({
        name: w.name,
        start: Math.round(start * 1000) / 1000,
        gain: talking ? (hit > 0.5 ? 0.5 : 0.7) : 1,
        why: w.why || ""
      });
      hits.push({ name: w.name, at: land });
      count[w.name] = n + 1;
    }
    return out;
  }

  /* ═══════════ MUSIC: THE EDITOR'S RULES ═══════════ */

  /* Bed levels, as gain on the music. Under a voice 0.2: felt more than
     heard, and no word is lost to it. Leading 0.55, when nobody talks. */
  const BED = { under: 0.2, forward: 0.55 };

  /* The Director's music brief → what to search for, and how loud to play
     the result. Music may lead only when nobody is talking: the Director is
     told so, and it is enforced here because a bed fighting a voice is the
     one mix mistake no viewer forgives.
     Searches run from most specific to safest, three at most, because the
     library allows each visitor 200 searches a day: the brief as written;
     its last word (the genre, as the Director is taught to order them) with
     "music" added, since a bare "rock" finds rocks and "rock music" finds
     music; then a dependable default for the level. */
  function musicPlan(want, opts) {
    if (!want || !want.use || !want.query) return null;
    const share = speechShare((opts && opts.clips) || [], (opts && opts.media) || []);
    const level = share > 0.25 ? "under" : (want.level === "forward" ? "forward" : "under");
    const words = String(want.query).trim().split(/\s+/).filter(Boolean);
    const queries = [words.join(" ")];
    const genre = words[words.length - 1];
    if (genre && genre !== "music") queries.push(genre + " music");
    queries.push(level === "forward" ? "upbeat music" : "chill music");
    return {
      level: level,
      gain: BED[level],
      speech: share > 0.05,
      queries: queries.filter((q, i) => q && queries.indexOf(q) === i).slice(0, 3)
    };
  }

  /* Which search result becomes the bed. The library ranks by text
     relevance, which is not the same as "a usable music bed": for "rock
     music" it put a Paris street recording first. So each result is judged on
     what its title and tags say:
       · a musical word (music, loop, beat, melody, bpm…) counts for it
       · a field-recording word (ambience, crowd, street, rain…) rules it out,
         unless it is also plainly music, and even then counts against it
       · a voice (vocals, singing, rap, talking…) rules it out when someone in
         the video speaks, and counts against it anywhere else
       · long enough to play through the edit without looping counts for it;
         over six minutes is usually a soundscape, and counts against it
       · the brief's own words, then the library's ranking, break ties */
  const MUSICAL = /\b(music|musical|loops?|beats?|melod(y|ic)|bpm|instrumental|track|song|tune|chords?|groove|bgm|soundtrack|theme|arrangement|composition|jingle|riff|lofi|piano|guitar|synth\w*|orchestra\w*|jazz|funk|hip ?hop|drums?)\b/;
  const NOT_MUSIC = /\b(ambience|ambiance|field ?recording|foley|sfx|sound ?effects?|crowds?|people|street|traffic|nature|birds?|crickets|insects?|rain|wind|waves|water|footsteps|interview|rumble|whales?|rocks?)\b/;
  const VOICE = /\b(vocals?|voices?|singing|singer|sings|sung|lyrics?|rap|rapping|acapella|a cappella|choir|chant\w*|spoken|speech|talk\w*|narrat\w*|poem|poetry)\b/;

  function pickTrack(tracks, opts) {
    opts = opts || {};
    const list = Array.isArray(tracks) ? tracks : [];
    const q = String(opts.query || "").toLowerCase().replace(/-/g, "")
      .split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== "music");
    let best = null, top = -Infinity;
    list.forEach((t, i) => {
      if (!t || !t.url) return;
      const hay = (String(t.title || "") + " " + (t.tags || []).join(" ")).toLowerCase().replace(/[_.\-]+/g, " ");
      const flat = hay.replace(/\s+/g, "");
      const musical = MUSICAL.test(hay), field = NOT_MUSIC.test(hay), voice = VOICE.test(hay);
      if (field && !musical) return;
      if (voice && opts.speech) return;            // never a voice over a voice
      let score = (q.length ? q.filter((w) => flat.indexOf(w) >= 0).length / q.length : 1) * 2;
      score += (1 - i / Math.max(1, list.length)) * 0.5;
      if (musical) score += 1;
      if (field) score -= 1.5;
      if (voice) score -= 1;
      const d = t.duration || 0;
      if (opts.length && d >= opts.length) score += 1;
      else if (d >= 45) score += 0.4;
      if (d > 360) score -= 0.5;
      if (score > top) { top = score; best = t; }
    });
    return best;
  }

  /* ═══════════ FORMAT DETECTION ═══════════
     Priority: explicit user pick (opts.format) > prompt keywords > default */

  function detectFormat(prompt) {
    const p = (prompt || "").toLowerCase();
    if (/reel|shorts?\b|tiktok|tik tok|viral|for ?you|fyp/.test(p)) return "short";
    if (/\bfilm\b|movie|wedding video|documentary/.test(p)) return "film";
    if (/\bstory\b|vlog|day in/.test(p)) return "story";
    const m = p.match(/(\d+)\s*(?:seconds|second|secs|sec|s\b)/);
    if (m && +m[1] <= 60 && /hook|follow|engag/.test(p)) return "short";
    return "recap";
  }

  /* ═══════════ SHORT-FORM PLANNER: HOOK → RETENTION → CTA ═══════════ */

  function planShort(opts, intent, media, rnd) {
    const withCurves = media
      .map((m) => ({ m, curves: shortCurves(m) }))
      .filter((x) => x.curves);
    if (!withCurves.length) return null; // photos-only / unanalyzed → standard planner takes over

    const srcTotalS = media.reduce((s, x) => s + (x.duration || 3), 0);
    // let the story breathe: as long as it makes sense, up to ~3 minutes
    const target = clamp(intent.explicitLen || Math.round(srcTotalS * 0.9), 8, 175);

    // ── HOOK: the single most scroll-stopping moment across all footage
    let hook = null;
    withCurves.forEach(({ m, curves }) => {
      curves.forEach((c) => { if (!hook || c.hook > hook.c.hook) hook = { m, c }; });
    });
    const hookLen = clamp(1.7 + rnd() * 1.1, 1.5, 3);
    const hookIn = clamp(hook.c.t - hookLen * 0.35, 0, Math.max(0, (hook.m.duration || hookLen) - hookLen));
    const hookPts = Math.round(clamp(hook.c.hook, 0, 100));
    const hookClip = {
      mediaId: hook.m.id, in: hookIn, out: hookIn + hookLen,
      speed: 1, volume: 1, muted: false, filter: intent.look, fadeIn: 0, fadeOut: 0
    };

    // ── CTA bed: a stable, clean closing shot
    let cta = null;
    withCurves.forEach(({ m, curves }) => {
      curves.forEach((c) => {
        const stability = c.ret - c.mot * 120; // steady but still interesting
        if (!cta || stability > cta.score) cta = { m, c, score: stability };
      });
    });
    const ctaLen = 2.4;
    const ctaIn = clamp(cta.c.t - ctaLen / 2, 0, Math.max(0, (cta.m.duration || ctaLen) - ctaLen));
    const ctaClip = {
      mediaId: cta.m.id, in: ctaIn, out: ctaIn + ctaLen,
      speed: 1, volume: 1, muted: false, filter: intent.look, fadeIn: 0, fadeOut: 0.45
    };

    // ── RETENTION: rapid middle, escalating energy, beat-locked when musical
    const beat = intent.bpm ? 60 / intent.bpm : 0;
    const midTarget = Math.max(3, target - hookLen - ctaLen);
    const cands = [];
    withCurves.forEach(({ m, curves }) => {
      const units = speechUnits(m);
      // whole sentences first — atomic, never interval-cut
      units.forEach((u) => {
        if (m === hook.m && u.s < hookIn + hookLen + 0.3 && u.e > hookIn - 0.3) return;
        if (m === cta.m && u.s < ctaIn + ctaLen + 0.3 && u.e > ctaIn - 0.3) return;
        let q = 0, cnt = 0, en = 0;
        curves.forEach((c) => { if (c.t >= u.s && c.t <= u.e) { q += c.ret; en += c.e + c.mot * 4; cnt++; } });
        cands.push({
          m, s: u.s, e: Math.min(u.e, m.duration || u.e),
          ret: (cnt ? q / cnt : 50) + 18, energy: cnt ? en / cnt : 0.5
        });
      });
      // rapid visual moments only OUTSIDE speech
      for (let i = 1; i < curves.length - 1; i++) {
        const c = curves[i];
        if (inUnits(units, c.t)) continue;
        if (c.ret >= curves[i - 1].ret && c.ret >= curves[i + 1].ret) {
          let L = beat ? Math.max(1, Math.round((1.2 + rnd() * 1.2) / beat)) * beat : 1.2 + rnd() * 1.2;
          L = clamp(L, 0.8, 2.6);
          const s = clamp(c.t - L / 2, 0, Math.max(0, (m.duration || L) - L));
          if (m === hook.m && s < hookIn + hookLen + 0.3 && s + L > hookIn - 0.3) continue;
          if (m === cta.m && s < ctaIn + ctaLen + 0.3 && s + L > ctaIn - 0.3) continue;
          cands.push({ m, s, e: s + L, ret: c.ret, energy: c.e + c.mot * 4 });
        }
      }
    });
    cands.sort((a, b) => b.ret - a.ret);
    const midPicks = [];
    let sum = 0;
    for (const c of cands) {
      if (sum >= midTarget) break;
      if (midPicks.some((q) => q.m === c.m && c.s < q.e + 0.25 && c.e > q.s - 0.25)) continue;
      midPicks.push(c);
      sum += c.e - c.s;
    }
    // chronological middle — the hook is the only sanctioned reorder
    midPicks.sort((a, b) => {
      const ai = media.indexOf(a.m), bi = media.indexOf(b.m);
      return ai !== bi ? ai - bi : a.s - b.s;
    });

    const clips = [hookClip];
    midPicks.forEach((c, i) => {
      const clip = {
        mediaId: c.m.id, in: c.s, out: c.e,
        speed: 1, volume: 1, muted: false, filter: intent.look, fadeIn: 0, fadeOut: 0
      };
      // pattern interrupts every third cut: punch-in zoom or speed ramp
      if (i % 3 === 2) {
        if (c.energy < 0.5) clip.speed = 1.35;
        else clip.kb = { s0: 1, s1: 1.09, x0: 0, x1: 0, y0: 0, y1: 0 };
      }
      clips.push(clip);
    });
    clips.push(ctaClip);
    snapToSentences(clips, media);

    // ── Texts: hook line on top, call to action at the end
    let hookText = null;
    if (hook.m.transcript) {
      const hit = hook.m.transcript.find((c) => c.s <= hook.c.t + 0.5 && c.e >= hook.c.t - 0.5 && HOOK_WORDS.test(c.text));
      if (hit) hookText = hit.text.length > 44 ? hit.text.slice(0, 43).trim() + "…" : hit.text;
    }
    if (!hookText) hookText = intent.title || "Wait for it…";
    const tot = clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
    const texts = [
      { text: hookText, start: 0.15, dur: Math.min(2.2, hookLen), size: 38, color: "#ffffff", pos: "top" },
      { text: "Follow for more ✦", start: Math.max(0, tot - ctaLen), dur: ctaLen, size: 32, color: "#ffffff", pos: "bottom" }
    ];

    const summary = "Shorts format · hook scored " + hookPts + "/100 · " + clips.length + " cuts · " +
      Math.round(tot) + "s" +
      (beat ? " · beat-synced ~" + intent.bpm + " bpm" : "") +
      " · CTA added · exports vertical 9:16";

    return { clips, texts, summary, vertical: true };
  }

  /* ═══════════ PLAN — the public entry (orchestrator) ═══════════ */

  async function plan(opts) {
    const media = opts.media || [];
    const rnd = rng((opts.seed || 1) * 7919 + 13);
    const fmt = opts.format || detectFormat(opts.prompt);
    const intent = decideIntent(opts.prompt, media, rnd, fmt);

    // 1) Intelligence Layer first (Vision-1.0 → Gemini, when available)
    if (window.IntelligenceEngine) {
      try {
        const ai = await IntelligenceEngine.plan(buildRequest(opts, fmt, intent, media));
        if (ai) {
          const g = materialize(ai, intent, fmt, media);
          IntelligenceEngine.record({
            kind: "plan", provider: ai.provider, prompt: opts.prompt || "", format: fmt,
            media: mediaMeta(media), clips: g.clips, texts: g.texts,
            sfx: g.sfx, music: g.music, retention: g.retention || null,
            director: ai.raw || null, confidence: ai.confidence, summary: g.summary
          });
          return g;
        }
      } catch (e) {
        // A failed cloud edit is not permission to replace the timeline with
        // a lower-quality heuristic edit. Let the UI explain and offer retry.
        throw e;
      }
    }

    if (!opts.allowHeuristic) throw new Error("The AI Director is unavailable. Reload the app and retry; your timeline has not been changed.");

    // 2) Built-in heuristic planner (explicit callers only, never silent fallback)
    let g2 = null;
    if (fmt === "short") g2 = planShort(opts, intent, media, rnd);
    if (!g2) g2 = planStandard(opts, intent, media, rnd, fmt);
    if (window.IntelligenceEngine) {
      IntelligenceEngine.record({
        kind: "plan", provider: "heuristic", prompt: opts.prompt || "", format: fmt,
        media: mediaMeta(media), clips: g2.clips, texts: g2.texts, summary: g2.summary
      });
    }
    return g2;
  }

  function planStandard(opts, intent, media, rnd, fmt) {
    let picked = pickSegments(media, intent, rnd);
    if (!picked.length) {
      // analysis unavailable — even spread fallback
      media.forEach((m) => {
        const d = m.duration || 3;
        picked.push({ item: m, s: 0, e: Math.min(d, intent.cutMax), q: 0.5, photo: m.type !== "video", mot: 0.05, aE: 0.3 });
      });
    }
    // Keep the story in order — never shuffle clips without a reason
    picked = picked.slice().sort((a, b) => {
      const ai = media.indexOf(a.item), bi = media.indexOf(b.item);
      return ai !== bi ? ai - bi : a.s - b.s;
    });

    // beat-sync cut lengths when the footage is musical
    const beat = intent.bpm && intent.pace !== "slow" ? 60 / intent.bpm : 0;

    const clips = [];
    let zoomIn = rnd() > 0.5;
    picked.forEach((c, idx) => {
      let s = c.s, e = c.e;
      if (beat && !c.photo) {
        const L = e - s;
        const beats = Math.max(1, Math.round(L / beat));
        e = Math.min(s + beats * beat, c.item.duration || e);
        if (e - s < 0.4) e = c.e;
      }
      const clip = {
        mediaId: c.item.id,
        in: s,
        out: e,
        speed: intent.slowmo && !c.photo ? 0.5 : 1,
        volume: 1,
        muted: false,
        filter: intent.look,
        fadeIn: 0,
        fadeOut: 0
      };
      // Ken Burns on photos: alternate gentle push-in / pull-out with a drift
      if (c.photo) {
        const drift = (rnd() - 0.5) * 0.06;
        clip.kb = zoomIn
          ? { s0: 1.0, s1: 1.14, x0: 0, x1: drift, y0: 0, y1: -Math.abs(drift) * 0.6 }
          : { s0: 1.14, s1: 1.0, x0: drift, x1: 0, y0: -Math.abs(drift) * 0.6, y1: 0 };
        zoomIn = !zoomIn;
      }
      // fades by mood
      if (idx === 0) clip.fadeIn = intent.pace === "fast" ? 0.3 : 0.55;
      if (idx === picked.length - 1) clip.fadeOut = intent.pace === "fast" ? 0.4 : 0.7;
      if (intent.pace === "slow" && idx > 0) clip.fadeIn = Math.max(clip.fadeIn, 0.18);
      if (intent.pace === "slow" && idx < picked.length - 1) clip.fadeOut = Math.max(clip.fadeOut, 0.18);
      clips.push(clip);
    });

    // trim overshoot so we land near the target
    let tot = clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);
    while (clips.length > 2 && tot > intent.target * 1.18) {
      const cut = clips.splice(clips.length - 2, 1)[0];
      tot -= (cut.out - cut.in) / cut.speed;
    }
    snapToSentences(clips, media);
    tot = clips.reduce((s, c) => s + (c.out - c.in) / c.speed, 0);

    const texts = [];
    if (intent.title && tot > 2) {
      texts.push({ text: intent.title, start: 0.35, dur: Math.min(2.9, tot - 0.5), size: 46, color: "#ffffff", pos: "center" });
    }

    const analyzed = media.filter((m) => m.analysis && m.analysis.vis && m.analysis.vis.samples.length > 1).length;
    const spoken = media.filter((m) => m.transcript && m.transcript.length).length;
    const parts = [];
    if (fmt === "film") parts.push("Film format");
    else if (fmt === "story") parts.push("Story format — kept in order");
    parts.push("watched " + media.length + (media.length === 1 ? " source" : " sources") +
      (analyzed ? "" : " (quick mode)"));
    parts.push(clips.length + " cuts · " + Math.round(tot) + "s");
    parts.push(intent.reasons[0]);
    if (intent.reasons[1]) parts.push(intent.reasons[1]);
    if (intent.bpm && intent.pace !== "slow") parts.push("beat-synced ~" + intent.bpm + " bpm");
    if (spoken) parts.push("speech transcribed & kept intact");
    else if (media.some((m) => m.analysis && m.analysis.aud && m.analysis.aud.voiced.length)) parts.push("kept spoken moments whole");
    if (intent.title) parts.push("titled “" + intent.title + "”");

    return { clips, texts, summary: parts.join(" · "), vertical: false };
  }

  /* ═══════════ EXPORT ═══════════ */

  window.VevrisBrain = {
    analyze,
    prepare,
    transcribe,
    plan,
    // clips.js groups a long recording's words into sentences the same way
    groupWords,
    frameStats,
    // sound: the Director proposes, these decide (app.js calls them once b-roll has settled)
    placeSounds,
    musicPlan,
    pickTrack,
    // exported for the tests and the research lab (research/vision/)
    _placeBroll: placeBroll,
    _materialize: materialize,
    _buildRequest: buildRequest
  };
})();
