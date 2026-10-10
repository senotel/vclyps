/* ═══════════════════════════════════════════════════════════
   vClyps — clip finder
   Turns one long recording into a ranked list of short clips.

   On the device (free, the footage never uploads):
     · READ    the audio track in pieces, so an hour-long file never has
               to fit in memory (MP4/MOV via WebCodecs; other formats are
               decoded whole if they are small enough)
     · LISTEN  in listen-worker.js, off the page: every word with its
               time (Whisper), and the voice itself every 0.1s, loudness
               and pitch, which is how "lively delivery" is measured
     · HEAR    sound events on the page: laughter, applause, cheering,
               shouting, gasps, crying, music, impacts (YAMNet)
     · WATCH   a frame every few seconds: scene changes, bursts of action,
               faces and what they are doing, smiles, open mouths, surprise
   Then ONE Director call reads the whole transcript plus those moments
   and picks the clips (intelligence.js findClips). Here the answer is
   settled onto real sentence edges, held to the length asked for, and
   overlaps removed. Making a clip is a normal edit scoped to its range
   (brain.js buildRequest, opts.range), so it costs what any edit costs.

   Everything measured is cached per file, so asking again with a new
   topic or length costs one Director call and no re-processing.
   Exposes window.VevrisClips.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* A pause that lets the page breathe WITHOUT a timer. A find runs for
     minutes and people switch tabs while it does; in a background tab Chrome
     holds chained timers to once a second, and after five minutes to once a
     MINUTE, which turned "pause for 0ms" into hours. A message to ourselves is
     not a timer and is not throttled. */
  function breathe() {
    return new Promise((r) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => { c.port1.close(); r(); };
      c.port2.postMessage(null);
    });
  }

  const MP4BOX_URL = "https://cdn.jsdelivr.net/npm/mp4box@2.4.1/dist/mp4box.all.mjs";
  const AUDIO_TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-audio@1.0.1";
  const VISION_TASKS = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1";
  const YAMNET = "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
  const FACE = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

  /* The sound-event and face models are Google's MediaPipe. They run on the
     device and never see the footage leave it, BUT the library sends usage
     metrics (not media) to Google about once a minute while it is loaded, with
     no switch to turn that off. That needs a line in the privacy policy before
     launch. false = skip both models: clips are then found from the words, the
     voice and the frame changes alone. See HANDOFF.md, "Clip finder". */
  const SIGNAL_MODELS = true;

  const RATE = 16000;
  const WINDOW_S = 300;          // audio handed to the worker at a time
  const CACHE_V = 1;

  /* Clip length choices. Auto is wide on purpose: the moment decides. */
  const LENGTHS = {
    auto:  { min: 20, max: 90,  label: "Auto" },
    short: { min: 12, max: 30,  label: "Under 30s" },
    mid:   { min: 30, max: 60,  label: "30 to 60s" },
    long:  { min: 60, max: 90,  label: "60 to 90s" },
    xl:    { min: 90, max: 180, label: "90s to 3 min" }
  };

  class Cancelled extends Error {}
  function job() {
    const hooks = [];
    return {
      cancelled: false,
      cancel() { if (this.cancelled) return; this.cancelled = true; hooks.splice(0).forEach((f) => { try { f(); } catch (e) {} }); },
      onCancel(f) { hooks.push(f); },
      check() { if (this.cancelled) throw new Cancelled("Stopped"); }
    };
  }
  const noJob = { cancelled: false, onCancel() {}, check() {} };

  /* ═══════════ READ: the audio track, in pieces ═══════════ */

  async function blobOf(item) {
    if (item.file) return item.file;
    return (await fetch(item.url)).blob();
  }

  // Top-level boxes only, reading 16 bytes per box: finds the moov without
  // ever touching the mdat, wherever the recorder put it.
  async function findBox(blob, want) {
    let off = 0;
    for (let n = 0; n < 4096 && off + 8 <= blob.size; n++) {
      const h = new DataView(await blob.slice(off, Math.min(blob.size, off + 16)).arrayBuffer());
      let size = h.getUint32(0);
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (size === 1 && h.byteLength >= 16) size = Number(h.getBigUint64(8));
      else if (size === 0) size = blob.size - off;
      if (size < 8) return null;
      if (type === want) return { off: off, size: size };
      off += size;
    }
    return null;
  }

  /* 16 kHz mono, written straight into one Int16 buffer: 32 KB a second, so
     an hour is about 115 MB instead of the 1.4 GB the browser's own decoder
     would hold at 48 kHz stereo. Each output sample is the average of the input
     samples it covers, which is also the low-pass a downsample needs. */
  function resampler(srcRate, out) {
    const ratio = srcRate / RATE;
    let pos = 0, acc = 0, cnt = 0, edge = ratio, seen = 0;
    return {
      push(ad) {
        const ch = ad.numberOfChannels, n = ad.numberOfFrames;
        const planes = [];
        for (let c = 0; c < ch; c++) {
          const p = new Float32Array(n);
          ad.copyTo(p, { planeIndex: c, format: "f32-planar" });
          planes.push(p);
        }
        for (let i = 0; i < n; i++) {
          let v = 0;
          for (let c = 0; c < ch; c++) v += planes[c][i];
          acc += v / ch; cnt++; seen++;
          if (seen >= edge) {
            if (pos < out.length) out[pos++] = clamp(Math.round((acc / cnt) * 32767), -32768, 32767);
            acc = 0; cnt = 0; edge += ratio;
          }
        }
      },
      written() { return pos; }
    };
  }

  async function mp4Audio(blob, jb, onProg) {
    if (typeof AudioDecoder === "undefined" || typeof EncodedAudioChunk === "undefined") return null;
    const moov = await findBox(blob, "moov");
    if (!moov || moov.size > 256 * 1024 * 1024) return null;
    const MP4Box = await import(MP4BOX_URL);
    const file = MP4Box.createFile();
    let info = null;
    file.onReady = (i) => { info = i; };
    file.onError = () => {};
    /* Only the moov is parsed. Sample offsets inside it are absolute positions
       in the real file, so the sample bytes are then read from the file
       directly, a run at a time, and never buffered by the parser. The parser
       will not report on a file without a type box, so a minimal one goes in
       front; which brand it names does not matter for reading audio. */
    const ftyp = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
    const body = new Uint8Array(ftyp.length + moov.size);
    body.set(ftyp, 0);
    body.set(new Uint8Array(await blob.slice(moov.off, moov.off + moov.size).arrayBuffer()), ftyp.length);
    file.appendBuffer(MP4Box.MP4BoxBuffer.fromArrayBuffer(body.buffer, 0));
    file.flush();
    if (!info || info.isFragmented) return null;
    const dur = info.timescale ? info.duration / info.timescale : 0;
    if (!info.audioTracks || !info.audioTracks.length) return { pcm: new Int16Array(0), duration: dur, noAudio: true };
    const track = info.audioTracks.find((t) => /^mp4a/.test(t.codec || ""));
    if (!track) return null;     // e.g. iPhone spatial audio: let the browser try
    const trak = file.getTrackById(track.id);
    const samples = trak && trak.samples;
    if (!samples || !samples.length) return null;
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    const esds = entry.esds || (entry.wave && entry.wave.esds);
    let desc;
    try {
      const dcd = esds && esds.esd && esds.esd.findDescriptor(4);
      const dsi = dcd && dcd.findDescriptor(5);
      if (dsi && dsi.data) desc = dsi.data;
    } catch (e) {}
    const rate = (track.audio && track.audio.sample_rate) || 48000;
    const cfg = { codec: track.codec, sampleRate: rate, numberOfChannels: (track.audio && track.audio.channel_count) || 2 };
    if (desc) cfg.description = desc;
    let ok = false;
    try { ok = (await AudioDecoder.isConfigSupported(cfg)).supported; } catch (e) {}
    if (!ok) return null;

    const tdur = track.timescale ? track.duration / track.timescale : dur;
    const out = new Int16Array(Math.ceil((tdur || dur) * RATE) + RATE);
    const rs = resampler(rate, out);
    let fault = null;
    const dec = new AudioDecoder({
      output: (ad) => { try { rs.push(ad); } finally { ad.close(); } },
      error: (e) => { fault = e; }
    });
    dec.configure(cfg);
    let i = 0;
    while (i < samples.length) {
      jb.check();
      if (fault) throw fault;
      let j = i;
      const start = samples[i].offset;
      let end = start + samples[i].size;
      while (j + 1 < samples.length && samples[j + 1].offset === end && end - start < 4 * 1024 * 1024) {
        j++;
        end += samples[j].size;
      }
      const buf = new Uint8Array(await blob.slice(start, end).arrayBuffer());
      for (let k = i; k <= j; k++) {
        const s = samples[k];
        dec.decode(new EncodedAudioChunk({
          type: "key",
          timestamp: Math.round((s.cts * 1e6) / s.timescale),
          duration: Math.round((s.duration * 1e6) / s.timescale),
          data: buf.subarray(s.offset - start, s.offset - start + s.size)
        }));
      }
      i = j + 1;
      // let the decoder catch up: its own dequeue event where there is one
      while (dec.decodeQueueSize > 120) {
        if ("ondequeue" in dec) await new Promise((r) => dec.addEventListener("dequeue", r, { once: true }));
        else await breathe();
      }
      if (onProg) onProg(i / samples.length);
    }
    await dec.flush();
    dec.close();
    if (fault) throw fault;
    return { pcm: out.subarray(0, rs.written()), duration: tdur || dur };
  }

  /* Anything else (WebM, MKV, fragmented MP4, or a browser without WebCodecs)
     goes through the browser's own decoder, which needs the whole file in
     memory. Fine for a typical clip; refused for a file that would crash the
     tab, with a reason that says what to do instead. */
  const WHOLE_MAX = 1200 * 1024 * 1024;
  async function wholeAudio(blob, duration) {
    if (blob.size > WHOLE_MAX) {
      throw new Error("This file is too large to read in this browser. Save it as MP4 or MOV, or use Chrome or Edge on a computer.");
    }
    const buf = await blob.arrayBuffer();
    const Ctx = global.AudioContext || global.webkitAudioContext;
    const ctx = new Ctx();
    let audio = null;
    try { audio = await ctx.decodeAudioData(buf); }
    catch (e) { return { pcm: new Int16Array(0), duration: duration || 0, noAudio: true }; }
    finally { try { ctx.close(); } catch (e) {} }
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * RATE)), RATE);
    const src = off.createBufferSource();
    src.buffer = audio;
    src.connect(off.destination);
    src.start();
    const f = (await off.startRendering()).getChannelData(0);
    const pcm = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) pcm[i] = clamp(Math.round(f[i] * 32767), -32768, 32767);
    return { pcm: pcm, duration: audio.duration };
  }

  async function readAudio(item, jb, say) {
    const blob = await blobOf(item);
    say("Reading the audio…");
    let a = null;
    try {
      a = await mp4Audio(blob, jb, (p) => say("Reading the audio… " + Math.round(p * 100) + "%"));
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      a = null;   // a decoder fault: the browser's own path may still manage
    }
    jb.check();
    const D = global.VevrisDiag && global.VevrisDiag.last;
    if (D) D.audioRead = a ? "streamed from the MP4" : "decoded whole";
    return a || wholeAudio(blob, item.duration);
  }

  /* ═══════════ HEAR: sound events (YAMNet, AudioSet's 521 sounds) ═══════════ */

  const SOUND_GROUPS = {
    laughter: ["Laughter", "Baby laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle"],
    applause: ["Applause", "Clapping"],
    cheering: ["Cheering", "Crowd", "Children shouting"],
    shouting: ["Shout", "Yell", "Screaming", "Battle cry", "Whoop", "Bellow"],
    gasp: ["Gasp"],
    crying: ["Crying, sobbing", "Baby cry, infant cry", "Whimper", "Wail, moan"],
    music: ["Music"],
    singing: ["Singing", "Choir", "Rapping"],
    impact: ["Explosion", "Gunshot, gunfire", "Bang", "Smash, crash", "Boom", "Slam"]
  };
  // per-group score that counts as "it happened"; laughter scores low even when obvious
  const SOUND_MIN = { laughter: 0.15, applause: 0.3, cheering: 0.3, shouting: 0.25, gasp: 0.2, crying: 0.2, music: 0.45, singing: 0.35, impact: 0.3 };
  const GROUP_OF = {};
  Object.keys(SOUND_GROUPS).forEach((g) => SOUND_GROUPS[g].forEach((n) => { GROUP_OF[n] = g; }));

  let soundCls = null;
  async function soundModel() {
    if (!SIGNAL_MODELS) return null;
    if (soundCls) return soundCls;
    const m = await import(AUDIO_TASKS + "/audio_bundle.mjs");
    const files = await m.FilesetResolver.forAudioTasks(AUDIO_TASKS + "/wasm");
    soundCls = await m.AudioClassifier.createFromOptions(files, {
      baseOptions: { modelAssetPath: YAMNET },
      maxResults: 12,
      scoreThreshold: 0.05
    });
    return soundCls;
  }

  // One result per ~second: the strongest score in each group we care about.
  function soundFrames(results, offset) {
    const out = [];
    (results || []).forEach((r) => {
      const cats = (r.classifications && r.classifications[0] && r.classifications[0].categories) || [];
      const g = {};
      let any = false;
      cats.forEach((c) => {
        const k = GROUP_OF[c.categoryName];
        if (k && c.score >= 0.1 && (!g[k] || c.score > g[k])) { g[k] = Math.round(c.score * 100) / 100; any = true; }
      });
      if (any) out.push({ t: Math.round((offset + (r.timestampMs || 0) / 1000) * 10) / 10, g: g });
    });
    return out;
  }

  async function hear(model, f32, start, jb) {
    if (!model) return [];
    const out = [];
    const step = 30 * RATE;   // small slices, yielding between, so the page stays responsive
    for (let o = 0; o < f32.length; o += step) {
      jb.check();
      const part = f32.subarray(o, Math.min(f32.length, o + step));
      try { out.push.apply(out, soundFrames(model.classify(part, RATE), start + o / RATE)); }
      catch (e) { return out; }
      await breathe();
    }
    return out;
  }

  /* ═══════════ LISTEN: words + voice, in the worker ═══════════ */

  function toF32(pcm, a, b) {
    const f = new Float32Array(b - a);
    for (let i = a; i < b; i++) f[i - a] = pcm[i] / 32768;
    return f;
  }

  async function listen(item, jb, say) {
    const audio = await readAudio(item, jb, say);
    const total = audio.pcm.length / RATE;
    const res = { duration: audio.duration || item.duration || total, words: [], rms: null, pitch: null, sounds: [], noAudio: !!audio.noAudio };
    if (audio.noAudio || !audio.pcm.length) return res;
    const hops = Math.ceil(total * 10);
    res.rms = new Float32Array(hops);
    res.pitch = new Float32Array(hops);

    let model = null;
    try { model = await soundModel(); } catch (e) { model = null; }

    /* TWO workers. Whisper decodes one token at a time, which leaves the
       graphics chip mostly idle, so two windows at once ran in the time of
       one (measured 2026-10-05: two 2-minute windows together in 33s, one alone
       in 30s). The second starts only once the first has the model, so a
       first-time download is never fetched twice. One on a small machine. */
    const POOL = (global.navigator && navigator.hardwareConcurrency || 4) >= 4 ? 2 : 1;
    const step = WINDOW_S * RATE;
    const windows = [];
    for (let o = 0, id = 0; o < audio.pcm.length; o += step, id++) {
      windows.push({ id: id, o: o, b: Math.min(audio.pcm.length, o + step), start: o / RATE });
    }
    const waiting = new Map();           // window id → {resolve, reject}
    const workers = [];
    let dl = null, heard = 0;
    // the download while there is one, then how much has been listened to
    const tell = () => say(dl != null
      ? "Getting the speech model ready, first time only… " + dl + " MB"
      : "Listening… " + fmt(Math.min(heard, total)) + " of " + fmt(total));
    const failAll = (err) => { waiting.forEach((p) => p.reject(err)); waiting.clear(); };
    // a terminated worker never answers, so every wait for words ends here
    jb.onCancel(() => { workers.forEach((w) => w.terminate()); failAll(new Cancelled("Stopped")); });

    function spawn() {
      const w = new Worker("listen-worker.js", { type: "module" });
      let ready = null;
      w.loaded = new Promise((r) => { ready = r; });
      w.onmessage = (e) => {
        const m = e.data || {};
        if (m.type === "download") { dl = m.mb; tell(); }
        else if (m.type === "loaded") {
          dl = null;
          const D = global.VevrisDiag && global.VevrisDiag.last;
          if (D) D.speechOn = m.engine === "gpu" ? "graphics chip" : "processor";
          ready();
          tell();
        } else if (m.type === "features") {
          const k0 = Math.round(m.start * 10);
          res.rms.set(m.rms.subarray(0, Math.max(0, Math.min(m.rms.length, hops - k0))), k0);
          res.pitch.set(m.pitch.subarray(0, Math.max(0, Math.min(m.pitch.length, hops - k0))), k0);
        } else if (m.type === "words" || m.type === "error") {
          const p = waiting.get(m.id);
          if (!p) return;
          waiting.delete(m.id);
          if (m.type === "words") { ready(); p.resolve(m.words); }
          else p.reject(new Error(m.message));
        }
      };
      w.onerror = (e) => failAll(new Error((e && e.message) || "The speech worker failed to start"));
      workers.push(w);
      return w;
    }

    const byWindow = [];
    let next = 0;
    // Each worker takes the next window as soon as it is free. The sound model
    // runs here on the page for every window as it is handed out.
    async function lane(w) {
      while (next < windows.length) {
        jb.check();
        const win = windows[next++];
        const f32 = toF32(audio.pcm, win.o, win.b);
        const words = new Promise((resolve, reject) => waiting.set(win.id, { resolve, reject }));
        const copy = f32.slice();   // the worker's own copy; f32 stays here for the sound model
        w.postMessage({ cmd: "window", id: win.id, start: win.start, audio: copy }, [copy.buffer]);
        res.sounds.push.apply(res.sounds, await hear(model, f32, win.start, jb));
        byWindow[win.id] = await words;
        heard += (win.b - win.o) / RATE;
        tell();
      }
    }

    try {
      tell();
      const first = spawn();
      const lanes = [lane(first)];
      if (POOL > 1 && windows.length > 1) {
        // the second lane joins once the first has the model in the cache
        lanes.push(first.loaded.then(() => (next < windows.length ? lane(spawn()) : null)));
      }
      await Promise.all(lanes);
    } finally {
      workers.forEach((w) => w.terminate());
    }
    byWindow.forEach((ws) => { if (ws) res.words.push.apply(res.words, ws); });
    res.sounds.sort((a, b) => a.t - b.t);
    return res;
  }

  /* ═══════════ WATCH: frames, faces ═══════════ */

  let faceLm;
  async function faceModel() {
    if (!SIGNAL_MODELS) return null;
    if (faceLm !== undefined) return faceLm;
    try {
      const m = await import(VISION_TASKS + "/vision_bundle.mjs");
      const files = await m.FilesetResolver.forVisionTasks(VISION_TASKS + "/wasm");
      const make = (delegate) => m.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: FACE, delegate: delegate },
        runningMode: "IMAGE", numFaces: 3, outputFaceBlendshapes: true
      });
      try { faceLm = await make("GPU"); } catch (e) { faceLm = await make("CPU"); }
    } catch (e) { faceLm = null; }
    return faceLm;
  }

  // The largest face in the frame, and what it is doing.
  function faceStats(res) {
    const faces = (res && res.faceLandmarks) || [];
    if (!faces.length) return { faces: 0 };
    let bi = 0, bs = 0;
    faces.forEach((lm, i) => {
      let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
      for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
      const a = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      if (a > bs) { bs = a; bi = i; }
    });
    const cats = {};
    const shapes = res.faceBlendshapes && res.faceBlendshapes[bi];
    ((shapes && shapes.categories) || []).forEach((c) => { cats[c.categoryName] = c.score; });
    const two = (a, b) => ((cats[a] || 0) + (cats[b] || 0)) / 2;
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      faces: faces.length,
      size: r2(bs),
      smile: r2(two("mouthSmileLeft", "mouthSmileRight")),
      open: r2(cats.jawOpen || 0),
      surprise: r2(((cats.browInnerUp || 0) + two("eyeWideLeft", "eyeWideRight")) / 2),
      frown: r2(two("mouthFrownLeft", "mouthFrownRight"))
    };
  }

  function seekTo(v, t) {
    return new Promise((resolve) => {
      let g = null;
      const done = () => { v.removeEventListener("seeked", done); clearTimeout(g); resolve(); };
      g = setTimeout(done, 5000);
      v.addEventListener("seeked", done);
      v.currentTime = t;
    });
  }

  function openVideo(url) {
    return new Promise((resolve, reject) => {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto";
      v.onloadedmetadata = () => resolve(v);
      v.onerror = () => reject(new Error("This video could not be opened"));
      v.src = url;
    });
  }

  async function watch(item, jb, onProg) {
    const v = await openVideo(item.url);
    jb.onCancel(() => { v.removeAttribute("src"); v.load(); });
    const dur = isFinite(v.duration) ? v.duration : (item.duration || 0);
    // about 1,500 looks at most: every 2s up to 50 minutes, sparser beyond
    const step = Math.max(2, dur / 1500);
    const small = document.createElement("canvas");
    small.width = 64; small.height = 36;
    const sx = small.getContext("2d", { willReadFrequently: true });
    const portrait = (v.videoHeight || 9) > (v.videoWidth || 16);
    const big = document.createElement("canvas");
    big.width = portrait ? 288 : 512; big.height = portrait ? 512 : 288;
    const bx = big.getContext("2d");
    const face = await faceModel();
    const B = global.VevrisBrain;
    const out = [];
    let prev = null;
    try {
      for (let t = Math.min(0.5, dur / 2); t < dur - 0.05; t += step) {
        jb.check();
        await seekTo(v, t);
        const s = { t: Math.round(t * 10) / 10 };
        try {
          sx.drawImage(v, 0, 0, 64, 36);
          const r = B.frameStats(sx.getImageData(0, 0, 64, 36).data, prev);
          prev = r.lum;
          s.bri = Math.round(r.stats.bri * 1000) / 1000;
          s.mot = Math.round(r.stats.mot * 1000) / 1000;
        } catch (e) { /* a frame the browser would not hand over */ }
        if (face) {
          try { bx.drawImage(v, 0, 0, big.width, big.height); Object.assign(s, faceStats(face.detect(big))); }
          catch (e) {}
        }
        out.push(s);
        if (onProg) onProg(t / Math.max(1, dur));
      }
    } finally {
      v.removeAttribute("src");
      v.load();
    }
    return { samples: out, step: step, duration: dur };
  }

  /* ═══════════ MOMENTS: everything measured, as things that happened ═══════════ */

  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }
  // robust z: distance from this recording's own norm, in units of its spread
  function zer(vals) {
    const m = median(vals);
    const mad = median(vals.map((v) => Math.abs(v - m))) * 1.4826 || 1e-6;
    return (v) => (v - m) / mad;
  }
  function pct(a, p) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[clamp(Math.floor(p * (s.length - 1)), 0, s.length - 1)];
  }

  /* The voice, sentence by sentence, against the speaker's own norm. Louder,
     higher and faster than they usually are is what excitement sounds like
     in every language, and it needs no model to hear it. */
  function liveliness(units, rms, pitch) {
    if (!rms || !units.length) return [];
    const rows = units.map((u) => {
      const k0 = Math.max(0, Math.floor(u.s * 10)), k1 = Math.min(rms.length, Math.ceil(u.e * 10));
      const loud = [], hz = [];
      for (let k = k0; k < k1; k++) { if (rms[k] > 0.01) loud.push(rms[k]); if (pitch[k] > 0) hz.push(pitch[k]); }
      const words = String(u.text || "").split(/\s+/).filter(Boolean).length;
      return {
        u: u,
        loud: loud.length ? loud.reduce((a, b) => a + b, 0) / loud.length : 0,
        pitch: hz.length >= 3 ? median(hz) : 0,
        range: hz.length >= 5 ? pct(hz, 0.9) - pct(hz, 0.1) : 0,
        rate: words / Math.max(0.5, u.e - u.s)
      };
    }).filter((r) => r.loud > 0);
    if (rows.length < 8) return [];
    const zl = zer(rows.map((r) => r.loud));
    const voiced = rows.filter((r) => r.pitch > 0);
    const zp = zer(voiced.map((r) => r.pitch)), zr = zer(voiced.map((r) => r.range));
    const zq = zer(rows.map((r) => r.rate));
    rows.forEach((r) => {
      r.score = zl(r.loud) + 0.5 * zq(r.rate) + (r.pitch > 0 ? zp(r.pitch) + 0.5 * zr(r.range) : 0);
    });
    const cut = Math.max(2.2, pct(rows.map((r) => r.score), 0.94));
    return rows.filter((r) => r.score >= cut).map((r) => ({ t0: r.u.s, t1: r.u.e, kind: "lively delivery", s: r.score / 2.2 }));
  }

  // Seconds where a sound group scored over its bar, joined into spans.
  function soundSpans(frames) {
    const out = [];
    Object.keys(SOUND_GROUPS).forEach((g) => {
      let cur = null;
      frames.forEach((f) => {
        const v = f.g[g] || 0;
        if (v < SOUND_MIN[g]) return;
        if (cur && f.t - cur.t1 <= 1.6) { cur.t1 = f.t + 1; cur.peak = Math.max(cur.peak, v); return; }
        cur = { t0: f.t, t1: f.t + 1, kind: g, peak: v };
        out.push(cur);
      });
    });
    return out
      .filter((s) => s.kind !== "music" || s.t1 - s.t0 >= 4)       // a bar of music is not a music moment
      .map((s) => ({ t0: s.t0, t1: s.t1, kind: s.kind, s: s.peak / SOUND_MIN[s.kind] }));
  }

  function visualMoments(seen) {
    const S = (seen && seen.samples) || [];
    if (S.length < 4) return [];
    const out = [];
    const mots = S.map((s) => s.mot || 0);
    const base = median(mots);
    // a cut to somewhere new: the picture changes far more than usual between looks
    S.forEach((s, i) => {
      if (i > 0 && (s.mot || 0) > 0.16 && (s.mot || 0) > 2.4 * (base + 0.02)) out.push({ t0: s.t, t1: s.t, kind: "scene change", s: (s.mot || 0) / 0.16 });
    });
    // sustained change across several looks: movement, action, a busy stretch
    const hi = Math.max(0.08, pct(mots, 0.95));
    for (let i = 2; i < S.length; i++) {
      const m3 = (mots[i] + mots[i - 1] + mots[i - 2]) / 3;
      if (m3 > hi) out.push({ t0: S[i - 2].t, t1: S[i].t, kind: "burst of action", s: m3 / hi });
    }
    // faces, against how this person usually looks
    const withFace = S.filter((s) => s.faces > 0);
    if (withFace.length >= 6) {
      const zs = zer(withFace.map((s) => s.smile || 0));
      const zu = zer(withFace.map((s) => s.surprise || 0));
      withFace.forEach((s) => {
        if ((s.open || 0) > 0.35 && (s.smile || 0) > 0.4) out.push({ t0: s.t, t1: s.t, kind: "laughing face", s: 1 + s.open });
        else if ((s.smile || 0) > 0.55 && zs(s.smile) > 1.5) out.push({ t0: s.t, t1: s.t, kind: "big smile", s: s.smile * 1.6 });
        if ((s.surprise || 0) > 0.45 && zu(s.surprise) > 2) out.push({ t0: s.t, t1: s.t, kind: "surprised face", s: s.surprise * 2 });
      });
    }
    // black screen: never a clip, usually an intro, a gap or the end card
    for (let i = 1; i < S.length; i++) {
      if ((S[i].bri || 1) < 0.05 && (S[i - 1].bri || 1) < 0.05) out.push({ t0: S[i - 1].t, t1: S[i].t, kind: "black screen", s: 1 });
    }
    return out;
  }

  // Same kind within 2 seconds is one moment, not three.
  function mergeMoments(list) {
    const by = {};
    list.forEach((m) => { (by[m.kind] = by[m.kind] || []).push(m); });
    const out = [];
    Object.keys(by).forEach((k) => {
      by[k].sort((a, b) => a.t0 - b.t0).forEach((m) => {
        const last = out.length && out[out.length - 1].kind === k ? out[out.length - 1] : null;
        if (last && m.t0 - last.t1 <= 2) { last.t1 = Math.max(last.t1, m.t1); last.s = Math.max(last.s, m.s); }
        else out.push({ t0: m.t0, t1: m.t1, kind: k, s: m.s });
      });
    });
    return out.sort((a, b) => a.t0 - b.t0);
  }

  function fuse(heard, seen, units) {
    return mergeMoments([]
      .concat(liveliness(units, heard && heard.rms, heard && heard.pitch))
      .concat(soundSpans((heard && heard.sounds) || []))
      .concat(visualMoments(seen)))
      .map((m) => ({ t0: Math.round(m.t0 * 10) / 10, t1: Math.round(m.t1 * 10) / 10, kind: m.kind, s: Math.round(m.s * 100) / 100 }));
  }

  function momentLine(m) {
    const span = m.t1 - m.t0 >= 1 ? m.t0.toFixed(1) + "-" + m.t1.toFixed(1) : m.t0.toFixed(1);
    return span + " " + m.kind + (m.s >= 2 ? " (strong)" : "");
  }

  /* ═══════════ SETTLE: the Director's picks onto real sentences ═══════════ */

  /* Every clip starts where a sentence starts and ends where one ends, is held
     to the length asked for by adding or dropping whole sentences, and may not
     overlap a better clip. Order is the Director's ranking and is kept. */
  function settle(found, units, o) {
    const win = o.window, min = o.min, max = o.max;
    const U = (units || []).filter((u) => u.e > win.start && u.s < win.end).sort((a, b) => a.s - b.s);
    const kept = [];
    (found || []).forEach((c) => {
      if (kept.length >= (o.count || 99)) return;
      let a = clamp(c.start, win.start, win.end), b = clamp(c.end, win.start, win.end);
      if (U.length) {
        let si = U.findIndex((u) => u.e > a + 0.05);
        if (si < 0) return;
        let ei = -1;
        for (let k = U.length - 1; k >= si; k--) { if (U[k].s < b - 0.2) { ei = k; break; } }
        if (ei < si) ei = si;
        // grow to the minimum with whole sentences, then trim to the maximum
        while (U[ei].e - U[si].s < min && ei + 1 < U.length && U[ei + 1].e - U[si].s <= max) ei++;
        while (U[ei].e - U[si].s > max && ei > si) ei--;
        a = Math.max(win.start, U[si].s);
        b = Math.min(win.end, U[ei].e);
      } else {
        // no speech: the picture decides, so hold the length directly
        if (b - a < min) b = Math.min(win.end, a + min);
        if (b - a > max) b = a + max;
      }
      if (b - a < Math.min(min, 8) * 0.75) return;            // too short to stand on its own
      const clash = kept.some((k) => {
        const ov = Math.min(b, k.end) - Math.max(a, k.start);
        return ov > 0.3 * Math.min(b - a, k.end - k.start);
      });
      if (clash) return;
      kept.push(Object.assign({}, c, { start: Math.round(a * 10) / 10, end: Math.round(b * 10) / 10 }));
    });
    return kept;
  }

  /* ═══════════ FIND ═══════════ */

  function fmt(s) {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  }

  // "1:02:30", "12:04", "754" or "" → seconds, or null when it isn't a time
  function parseTime(v) {
    const t = String(v == null ? "" : v).trim();
    if (!t) return null;
    if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return NaN;
    return t.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0);
  }

  function clipCount(len) {
    if (len < 100) return 1;
    return clamp(Math.round(len / 240), 2, 15);
  }

  // Stills for the Director when there is little to read: the strongest
  // moments, spread out, never two in the same stretch.
  function stillTimes(moments, win, n) {
    const gap = (win.end - win.start) / (n * 2);
    const out = [];
    moments.filter((m) => m.kind !== "black screen" && m.t0 >= win.start && m.t0 <= win.end)
      .sort((a, b) => b.s - a.s)
      .forEach((m) => {
        const t = (m.t0 + m.t1) / 2;
        if (out.length < n && out.every((x) => Math.abs(x - t) >= gap)) out.push(t);
      });
    // fill any shortfall evenly, so a quiet stretch is still seen
    for (let i = 0; out.length < n && i < n; i++) {
      const t = win.start + ((i + 0.5) * (win.end - win.start)) / n;
      if (out.every((x) => Math.abs(x - t) >= gap)) out.push(t);
    }
    return out.sort((a, b) => a - b);
  }

  async function grabStills(item, times) {
    if (!times.length) return [];
    const v = await openVideo(item.url);
    const c = document.createElement("canvas");
    c.width = 320; c.height = 180;
    const cx = c.getContext("2d");
    const out = [];
    try {
      for (const t of times) {
        await seekTo(v, t);
        try {
          cx.drawImage(v, 0, 0, 320, 180);
          out.push({ t: Math.round(t * 10) / 10, data: c.toDataURL("image/jpeg", 0.6) });
        } catch (e) {}
      }
    } finally { v.removeAttribute("src"); v.load(); }
    return out;
  }

  /* Keyframes from INSIDE a clip, for its edit. The file's own keyframes are
     spread over the whole hour, so an edit of minute 12 would otherwise be
     shown minute 0, 10, 20... and nothing of what it is cutting. */
  function rangeKeyframes(item, start, end, n) {
    n = n || 6;
    const times = [];
    for (let i = 0; i < n; i++) times.push(start + ((i + 0.5) * (end - start)) / n);
    return grabStills(item, times);
  }

  function speechShare(units, win) {
    let s = 0;
    units.forEach((u) => { s += Math.max(0, Math.min(u.e, win.end) - Math.max(u.s, win.start)); });
    return s / Math.max(1, win.end - win.start);
  }

  /* Everything measured for one file, from cache if the same file was measured
     before. opts.cache is app.js's IndexedDB: {get(key), put(key, value)}. */
  async function measure(item, jb, say, cache) {
    const key = "l" + item.id;
    const size = item.file ? item.file.size : 0;
    if (item._measured) return item._measured;
    if (cache) {
      try {
        const c = await cache.get(key);
        if (c && c.v === CACHE_V && c.name === item.name && (!size || c.size === size)) {
          item._measured = c;
          return c;
        }
      } catch (e) {}
    }
    let watched = 0, said = "";
    const tell = () => say(said + (watched > 0 && watched < 1 ? " · Watching " + Math.round(watched * 100) + "%" : ""));
    const [heard, seen] = await Promise.all([
      listen(item, jb, (s) => { said = s; tell(); }),
      watch(item, jb, (p) => { watched = p; tell(); }).catch((e) => {
        if (e instanceof Cancelled) throw e;
        return null;   // pictures are a bonus; words and sound still find clips
      })
    ]);
    const B = global.VevrisBrain;
    const units = B && B.groupWords ? B.groupWords(heard.words) : [];
    const out = {
      v: CACHE_V, name: item.name, size: size,
      duration: heard.duration || (seen && seen.duration) || item.duration || 0,
      words: heard.words,
      moments: fuse(heard, seen, units),
      noAudio: heard.noAudio,
      signals: !!(soundCls || faceLm)
    };
    item._measured = out;
    if (cache) { try { await cache.put(key, out); } catch (e) {} }
    return out;
  }

  // Free the models between finds. They hold memory, and MediaPipe reports
  // usage for as long as it is loaded.
  function release() {
    try { if (soundCls) soundCls.close(); } catch (e) {}
    try { if (faceLm) faceLm.close(); } catch (e) {}
    soundCls = null;
    faceLm = undefined;
  }

  /* opts: { prompt, length: key of LENGTHS, from, to (seconds or null),
             job, say(status), cache } */
  async function find(item, opts) {
    opts = opts || {};
    const jb = opts.job || noJob;
    const say = opts.say || function () {};
    const E = global.IntelligenceEngine, B = global.VevrisBrain;
    if (!E || !E.findClips) throw new Error("The AI Director isn't loaded. Reload the app and try again.");
    if (E.checkAccess) await E.checkAccess();

    let data;
    try { data = await measure(item, jb, say, opts.cache); }
    finally { release(); }
    jb.check();

    const units = B && B.groupWords ? B.groupWords(data.words) : [];
    // the rest of the app (edits, captions) reads these, so a made clip
    // never transcribes the same hour a second time
    item.words = data.words;
    item.transcript = units;

    const dur = data.duration || item.duration || 0;
    const from = opts.from != null && isFinite(opts.from) ? clamp(opts.from, 0, dur) : 0;
    let to = opts.to != null && isFinite(opts.to) ? clamp(opts.to, 0, dur) : dur;
    if (to - from < 5) to = dur;
    const win = { start: from, end: to };
    const len = LENGTHS[opts.length] || LENGTHS.auto;
    const count = clipCount(win.end - win.start);

    const lines = units.filter((u) => u.e > win.start && u.s < win.end).map((u) => u.s.toFixed(1) + " " + u.text);
    let moments = data.moments.filter((m) => m.t1 >= win.start && m.t0 <= win.end);
    if (moments.length > 220) {
      const keep = moments.slice().sort((a, b) => b.s - a.s).slice(0, 220);
      moments = moments.filter((m) => keep.indexOf(m) >= 0);
    }
    const share = speechShare(units, win);
    let keyframes = [];
    if (share < 0.35) {
      say("Looking at the strongest moments…");
      keyframes = await grabStills(item, stillTimes(data.moments, win, 12));
    }

    say("Finding the best clips…");
    const req = {
      prompt: (opts.prompt || "").trim(),
      window: win,
      length: { min: len.min, max: len.max },
      count: count,
      media: { id: item.id, name: item.name, duration: dur },
      lines: lines,
      moments: moments.map(momentLine),
      keyframes: keyframes
    };
    const raw = await E.findClips(req);
    jb.check();
    const clips = settle(raw, units, { window: win, min: len.min, max: len.max, count: count })
      .map((c, i) => Object.assign(c, { id: i + 1, mediaId: item.id }));
    if (E.record) {
      E.record({
        kind: "find", provider: (global.VevrisDiag && global.VevrisDiag.last && global.VevrisDiag.last.provider) || null,
        prompt: req.prompt, window: win, length: req.length, count: count,
        media: { id: item.id, name: item.name, duration: dur }, speechShare: Math.round(share * 100) / 100,
        moments: moments.length, stills: keyframes.length, director: raw, clips: clips
      });
    }
    return { clips: clips, window: win, length: opts.length || "auto", prompt: req.prompt, mediaId: item.id, at: new Date().toISOString(), signals: data.signals };
  }

  global.VevrisClips = {
    LENGTHS: LENGTHS,
    find: find,
    job: job,
    Cancelled: Cancelled,
    rangeKeyframes: rangeKeyframes,
    parseTime: parseTime,
    fmt: fmt,
    // pure pieces, exported for the tests
    _settle: settle,
    _fuse: fuse,
    _liveliness: liveliness,
    _soundSpans: soundSpans,
    _visualMoments: visualMoments,
    _soundFrames: soundFrames,
    _momentLine: momentLine,
    _clipCount: clipCount,
    _stillTimes: stillTimes,
    _resampler: resampler,
    _faceStats: faceStats
  };
})(window);
