/* ═══════════════════════════════════════════════════════════
   vClyps — caption worker
   Turns a clip's speech into word-timed captions, off the page so the
   editor never freezes, and on the device so nothing is uploaded.

     · Whisper, multilingual: 100 spoken languages, with word timings.
       Three sizes, chosen by what the device can run (see TIERS).
     · Which language is spoken, measured from the first 30 seconds,
       because transformers.js would otherwise assume English.
     · Who is speaking (pyannote segmentation 3.0, about 6 MB), for a
       caption colour per speaker. Only when asked for.

   Messages in:  {cmd:"run", id, audio:Float32Array (16 kHz mono),
                  lang:"auto"|code, tier:"best"|"balanced"|"fast",
                  speakers:bool}
   Messages out: {type:"stage", id, text} · {type:"download", id, mb}
                 {type:"done", id, words, lang, turns, engine, tier}
                 {type:"error", id, message}
   ═══════════════════════════════════════════════════════════ */

const T_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const RATE = 16000;

/* Biggest first. Quality comes before download size, so the device gets the
   best model it can actually run; the person can step down in Captions.
   The "_timestamped" exports carry the attention the word timings need.
   Sizes are what the browser downloads once and then keeps. */
const TIERS = {
  // Whisper large-v3-turbo: the most accurate, ~540 MB in half precision
  best: {
    id: "onnx-community/whisper-large-v3-turbo_timestamped",
    f16: { encoder_model: "q4f16", decoder_model_merged: "q4f16" },
    f32: { encoder_model: "q4", decoder_model_merged: "q4" }
  },
  // Whisper small: ~300 MB
  balanced: {
    id: "onnx-community/whisper-small_timestamped",
    f16: { encoder_model: "fp16", decoder_model_merged: "q4f16" },
    f32: { encoder_model: "q4", decoder_model_merged: "q4" }
  },
  // Whisper base: ~100 MB, and the only one fast enough without a GPU
  fast: {
    id: "onnx-community/whisper-base_timestamped",
    f16: { encoder_model: "fp16", decoder_model_merged: "fp16" },
    f32: { encoder_model: "fp32", decoder_model_merged: "q4" },
    cpu: { encoder_model: "q8", decoder_model_merged: "q8" }
  }
};
const SEGMENTER = "onnx-community/pyannote-segmentation-3.0";

let T = null;
async function lib() {
  if (!T) {
    T = await import(T_URL);
    T.env.allowLocalModels = false;
  }
  return T;
}

/* Megabytes received only ever go up; a percentage would jump backwards each
   time the next file of the model starts. */
function progress(id) {
  const files = {};
  let shown = -1;
  return (p) => {
    if (p.status !== "progress" || !p.file) return;
    files[p.file] = p.loaded || 0;
    let a = 0;
    Object.keys(files).forEach((k) => { a += files[k]; });
    const mb = Math.floor(a / 1e6);
    if (mb > shown) { shown = mb; self.postMessage({ type: "download", id: id, mb: mb }); }
  };
}

let gpu = null;   // {half} once probed, false when there is no usable GPU
async function probeGPU() {
  if (gpu !== null) return gpu;
  gpu = false;
  try {
    if (self.navigator && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) gpu = { half: adapter.features.has("shader-f16") };
    }
  } catch (e) { gpu = false; }
  return gpu;
}

let asr = null, asrKey = "", engine = "", loading = null, loadingKey = "";
/* One load at a time: a warm-up and a real request arriving together share
   it instead of building the model twice. */
async function loadASR(tier, id) {
  const g = await probeGPU();
  const want = (g ? (TIERS[tier] ? tier : "best") : "fast") + (g ? "/gpu" : "/cpu");
  if (loading && loadingKey === want) { await loading; if (asr && asrKey === want) return { asr: asr, tier: want.split("/")[0] }; }
  loadingKey = want;
  loading = buildASR(tier, id, g);
  try { return await loading; } finally { loading = null; }
}

async function buildASR(tier, id, g) {
  // without a GPU the large models would take many times the clip's length
  const use = g ? (TIERS[tier] ? tier : "best") : "fast";
  const key = use + (g ? "/gpu" : "/cpu");
  if (asr && asrKey === key) return { asr: asr, tier: use };
  if (asr) { try { await asr.dispose(); } catch (e) {} asr = null; }
  const L = await lib();
  const t = TIERS[use];
  self.postMessage({ type: "stage", id: id, text: "Loading the speech model" });
  if (g) {
    try {
      asr = await L.pipeline("automatic-speech-recognition", t.id, {
        device: "webgpu", dtype: g.half ? t.f16 : t.f32, progress_callback: progress(id)
      });
      engine = "gpu";
    } catch (e) { asr = null; }
  }
  if (!asr) {
    const f = TIERS.fast;
    asr = await L.pipeline("automatic-speech-recognition", f.id, { device: "wasm", dtype: f.cpu, progress_callback: progress(id) });
    engine = "cpu";
    asrKey = "fast/cpu";
    return { asr: asr, tier: "fast" };
  }
  asrKey = key;
  return { asr: asr, tier: use };
}

/* Which language: the model's own first guess after "start of transcript",
   over the first 30 seconds, read straight from its language tokens. This is
   what Whisper does internally; transformers.js just doesn't expose it. */
async function detectLanguage(model, audio) {
  const L = await lib();
  const cfg = model.model.generation_config || {};
  const langs = cfg.lang_to_id || {};
  const codes = Object.keys(langs);
  if (!codes.length) return "en";
  const head = audio.subarray(0, Math.min(audio.length, 30 * RATE));
  const feats = await model.processor(head);
  const start = cfg.decoder_start_token_id || 50258;
  const ids = new L.Tensor("int64", BigInt64Array.from([BigInt(start)]), [1, 1]);
  const out = await model.model({ input_features: feats.input_features, decoder_input_ids: ids });
  const logits = out.logits.data;
  const V = out.logits.dims[out.logits.dims.length - 1];
  const row = logits.length - V;   // the last position
  let best = codes[0], score = -Infinity;
  codes.forEach((c) => {
    const v = logits[row + langs[c]];
    if (v > score) { score = v; best = c; }
  });
  return best.replace(/[<|>]/g, "");
}

let seg = null;
async function loadSegmenter(id) {
  if (seg) return seg;
  const L = await lib();
  const processor = await L.AutoProcessor.from_pretrained(SEGMENTER, { progress_callback: progress(id) });
  const model = await L.AutoModelForAudioFrameClassification.from_pretrained(SEGMENTER, {
    device: "wasm", dtype: "fp32", progress_callback: progress(id)
  });
  seg = { processor: processor, model: model };
  return seg;
}

/* Who speaks when. The segmentation model keeps track of up to three
   voices across what it hears in one go, so a long recording is taken in
   ten-minute pieces; beyond that the colours restart per piece, which is
   rare in short-form and said plainly in Captions. */
async function speakerTurns(audio, id) {
  const s = await loadSegmenter(id);
  const PIECE = 600 * RATE;
  const turns = [];
  for (let at = 0; at < audio.length; at += PIECE) {
    const part = audio.subarray(at, Math.min(audio.length, at + PIECE));
    const inputs = await s.processor(part);
    const { logits } = await s.model(inputs);
    const found = s.processor.post_process_speaker_diarization(logits, part.length)[0] || [];
    found.forEach((x) => turns.push({ id: x.id, start: x.start + at / RATE, end: x.end + at / RATE }));
  }
  return turns;
}

self.onmessage = async (e) => {
  const m = e.data || {};
  /* Get the model ready before it is asked for. The page sends this when the
     Captions sheet opens and the model is already on the device, so loading
     it (a minute or more for Best) overlaps with choosing a style. */
  if (m.cmd === "warm") {
    try { await loadASR(m.tier || "best", 0); } catch (err) {}
    return;
  }
  // speakers only, for a clip whose words are already written
  if (m.cmd === "turns") {
    try {
      self.postMessage({ type: "stage", id: m.id, text: "Telling the voices apart" });
      const turns = await speakerTurns(m.audio, m.id);
      self.postMessage({ type: "done", id: m.id, turns: turns });
    } catch (err) {
      self.postMessage({ type: "error", id: m.id, message: (err && err.message) || String(err) });
    }
    return;
  }
  if (m.cmd !== "run") return;
  /* Whisper invents words over silence ("Thank you.", "Subtitles by...").
     A clip with no sound at all gets no captions rather than invented ones. */
  let peak = 0;
  for (let i = 0; i < m.audio.length; i += 16) { const v = Math.abs(m.audio[i]); if (v > peak) peak = v; }
  if (peak < 0.004) { self.postMessage({ type: "done", id: m.id, words: [], lang: m.lang !== "auto" ? m.lang : "", turns: null, engine: "", tier: m.tier }); return; }
  try {
    // said here too: a load the warm-up started reports to nobody
    if (!asr) self.postMessage({ type: "stage", id: m.id, text: "Loading the speech model" });
    const got = await loadASR(m.tier || "best", m.id);
    let lang = m.lang && m.lang !== "auto" ? m.lang : null;
    if (!lang) {
      self.postMessage({ type: "stage", id: m.id, text: "Listening for the language" });
      try { lang = await detectLanguage(got.asr, m.audio); } catch (err) { lang = m.fallbackLang || "en"; }
    }
    self.postMessage({ type: "stage", id: m.id, text: "Writing the captions" });
    let out;
    const opts = { chunk_length_s: 30, stride_length_s: 5, return_timestamps: "word", language: lang, task: "transcribe" };
    try { out = await got.asr(m.audio, opts); }
    catch (err) {
      // a lost graphics chip costs a retry on the processor, not the captions
      if (engine !== "gpu") throw err;
      asr = null; gpu = false;
      const again = await loadASR("fast", m.id);
      out = await again.asr(m.audio, opts);
      got.tier = again.tier;
    }
    const len = m.audio.length / RATE;
    const words = (out.chunks || []).map((c) => {
      const t = c.timestamp || [];
      const s = Math.min(t[0] || 0, len);
      const en = Math.min(t[1] != null ? t[1] : s + 0.3, len);
      return { text: String(c.text || ""), start: s, end: Math.max(en, s + 0.05) };
    }).filter((w) => w.text.trim());
    let turns = null;
    if (m.speakers) {
      self.postMessage({ type: "stage", id: m.id, text: "Telling the voices apart" });
      try { turns = await speakerTurns(m.audio, m.id); } catch (err) { turns = null; }
    }
    self.postMessage({ type: "done", id: m.id, words: words, lang: lang, turns: turns, engine: engine, tier: got.tier });
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, message: (err && err.message) || String(err) });
  }
};
