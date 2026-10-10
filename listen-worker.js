/* ═══════════════════════════════════════════════════════════
   vClyps — listen worker
   Runs off the page, so an hour of audio never freezes the editor.
   For each window of 16 kHz mono audio clips.js sends, it returns:
     · voice features every 0.1s: loudness and pitch, which is how
       "the speaker got louder, higher, faster" is measured
     · word timings from Whisper tiny (English), on the graphics chip
       where the browser has WebGPU, else the processor
   Nothing leaves the device. The model comes from the browser cache
   after its one-time download.
   ═══════════════════════════════════════════════════════════ */

/* Two ways to run the same Whisper (tiny, English), fastest first.

   GPU: transformers.js v4 on WebGPU. Measured 2026-10-05 on the same minute
   of speech: 11s on the graphics chip against 24s on the processor, with the
   same words. An hour of audio is ~11 minutes instead of ~25. Half precision
   where the GPU supports it gave identical words and timings at half the
   download (76 MB instead of 152 MB).

   PROCESSOR: transformers.js v2, the exact model and settings captions.js
   uses, for browsers without WebGPU. Usually already in the cache. */
const V4_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const V4_MODEL = "onnx-community/whisper-tiny.en_timestamped";
const V2_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
const V2_MODEL = "Xenova/whisper-tiny.en";
const RATE = 16000;
const HOP = 1600;          // 0.1s

let asr = null;

/* The model arrives as several files that are only discovered one after
   another, so any percentage jumps backwards each time a new file starts
   (99, 30, 70, 24...). Megabytes received only ever go up. */
function progress() {
  const files = {};
  let shown = -1;
  return (p) => {
    if (p.status !== "progress" || !p.file) return;
    files[p.file] = p.loaded || 0;
    let a = 0;
    Object.keys(files).forEach((k) => { a += files[k]; });
    const mb = Math.floor(a / 1e6);
    if (mb > shown) { shown = mb; self.postMessage({ type: "download", mb: mb }); }
  };
}

async function gpuASR() {
  if (!self.navigator || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const half = adapter.features.has("shader-f16");
  const T = await import(V4_URL);
  T.env.allowLocalModels = false;
  return T.pipeline("automatic-speech-recognition", V4_MODEL, {
    device: "webgpu",
    dtype: half ? { encoder_model: "fp16", decoder_model_merged: "fp16" } : { encoder_model: "fp32", decoder_model_merged: "fp32" },
    progress_callback: progress()
  });
}

async function cpuASR() {
  const T = await import(V2_URL);
  T.env.allowLocalModels = false;
  return T.pipeline("automatic-speech-recognition", V2_MODEL, { progress_callback: progress() });
}

let engine = null;
async function loadASR() {
  if (asr) return asr;
  engine = "gpu";
  try { asr = await gpuASR(); } catch (e) { asr = null; }
  if (!asr) { engine = "cpu"; asr = await cpuASR(); }
  self.postMessage({ type: "loaded", engine: engine });
  return asr;
}

/* A graphics chip can be lost partway through an hour (a driver reset, the
   laptop switching GPUs). That costs one window's retry on the processor,
   not the whole find. */
async function transcribe(audio) {
  const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word" };
  const model = await loadASR();
  try { return await model(audio, opts); }
  catch (err) {
    if (engine !== "gpu") throw err;
    engine = "cpu";
    asr = await cpuASR();
    self.postMessage({ type: "loaded", engine: engine });
    return asr(audio, opts);
  }
}

/* Loudness and pitch per hop. Pitch is a plain autocorrelation at 8 kHz over
   the human voice range (70-400 Hz); it only has to say "higher than this
   speaker usually is", which a coarse estimate does well. 0 = unvoiced. */
function features(x) {
  const n = Math.floor(x.length / HOP);
  const rms = new Float32Array(n), pitch = new Float32Array(n);
  const half = new Float32Array(HOP / 2);
  const LMIN = Math.floor(8000 / 400), LMAX = Math.ceil(8000 / 70);
  for (let k = 0; k < n; k++) {
    const o = k * HOP;
    let s = 0;
    for (let i = 0; i < HOP; i++) s += x[o + i] * x[o + i];
    rms[k] = Math.sqrt(s / HOP);
    if (rms[k] < 0.01) continue;                       // too quiet to be a voice
    for (let i = 0; i < half.length; i++) half[i] = (x[o + 2 * i] + x[o + 2 * i + 1]) * 0.5;
    let e0 = 0;
    for (let i = 0; i < half.length; i++) e0 += half[i] * half[i];
    let best = 0, lag = 0;
    for (let L = LMIN; L <= LMAX; L++) {
      let c = 0;
      for (let i = 0; i + L < half.length; i++) c += half[i] * half[i + L];
      c /= e0 || 1;
      if (c > best) { best = c; lag = L; }
    }
    if (best > 0.45 && lag) pitch[k] = 8000 / lag;
  }
  return { rms, pitch };
}

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.cmd === "load") {
      await loadASR();
      self.postMessage({ type: "ready" });
      return;
    }
    if (m.cmd === "window") {
      const f = features(m.audio);
      /* Whisper invents words over long silence and over music ("Thank you.",
         "Subtitles by…"), and a found clip built on an invented sentence is
         worse than none. A stretch with almost no voiced audio is skipped. */
      let voiced = 0;
      for (let i = 0; i < f.pitch.length; i++) if (f.pitch[i] > 0) voiced++;
      const quiet = voiced < f.pitch.length * 0.02;
      self.postMessage({ type: "features", id: m.id, start: m.start, rms: f.rms, pitch: f.pitch }, [f.rms.buffer, f.pitch.buffer]);
      if (quiet) { self.postMessage({ type: "words", id: m.id, start: m.start, words: [] }); return; }
      const out = await transcribe(m.audio);
      // the last word of a window can be stamped past its end; hold it inside
      const len = m.audio.length / RATE;
      const words = (out.chunks || []).map((c) => {
        const t = c.timestamp || [];
        const s = Math.min(t[0] || 0, len);
        const e2 = Math.min(t[1] || s + 0.3, len);
        return { text: String(c.text || "").trim(), start: m.start + s, end: m.start + e2 };
      }).filter((w) => w.text && w.end > w.start);
      self.postMessage({ type: "words", id: m.id, start: m.start, words: words });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: (err && err.message) || String(err) });
  }
};
