/* ═══════════════════════════════════════════════════════════
   denoise.js — Reduce noise (ccl14, 0.44.0)
   window.SenotelDenoise

   CapCut's Reduce noise: wind, traffic, fans and hum taken out from under
   a voice. The work is done by RNNoise, Xiph's small neural noise
   suppressor (BSD-3), in the @shiguredo/rnnoise-wasm build (Apache-2.0),
   about 4.6 MB, downloaded the first time someone uses it (never part of
   the app's own download). It runs on the device: free, private.

   clean(channels, amount, onProgress) → Promise<Float32Array[]>
     channels: Float32Array per channel at 48 kHz (-1..1). The result is
     the same length, the cleaned sound mixed with the original by amount
     (1 = fully cleaned), lined up sample for sample with the input.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const URL_ = "https://cdn.jsdelivr.net/npm/@shiguredo/rnnoise-wasm@2025.1.5/dist/rnnoise.js";
  const RATE = 48000;
  // RNNoise answers two frames (20 ms) late, measured on speech-like sound: the output is shifted back by this
  const DELAY = 960;
  let loading = null;
  function load() {
    if (!loading) loading = import(URL_).then((m) => m.Rnnoise.load()).catch((e) => { loading = null; throw e; });
    return loading;
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  async function clean(channels, amount, onProgress) {
    const rn = await load();
    const N = rn.frameSize, k = amount == null ? 1 : Math.max(0, Math.min(1, amount));
    const len = channels[0].length, frames = Math.ceil((len + DELAY) / N);
    const out = [];
    for (let c = 0; c < channels.length; c++) {
      const src = channels[c], st = rn.createDenoiseState();
      const wet = new Float32Array(frames * N);
      const f = new Float32Array(N);
      try {
        for (let i = 0; i < frames; i++) {
          for (let j = 0; j < N; j++) { const p = i * N + j; f[j] = p < len ? src[p] * 32768 : 0; }
          st.processFrame(f);
          for (let j = 0; j < N; j++) wet[i * N + j] = f[j] / 32768;
          if (i % 400 === 0) { if (onProgress) onProgress((c + i / frames) / channels.length); await tick(); }
        }
      } finally { st.destroy(); }
      const o = new Float32Array(len);
      for (let p = 0; p < len; p++) o[p] = wet[p + DELAY] * k + src[p] * (1 - k);
      out.push(o);
    }
    if (onProgress) onProgress(1);
    return out;
  }

  // 16-bit WAV of the channels, for an <audio> element to play in step with the video
  function wav(channels, rate) {
    const n = channels[0].length, ch = channels.length, bytes = 44 + n * ch * 2;
    const b = new ArrayBuffer(bytes), v = new DataView(b);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, "RIFF"); v.setUint32(4, bytes - 8, true); s(8, "WAVE"); s(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    s(36, "data"); v.setUint32(40, n * ch * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
    }
    return new Blob([b], { type: "audio/wav" });
  }

  global.SenotelDenoise = { RATE: RATE, DELAY: DELAY, load: load, clean: clean, wav: wav };
})(typeof window !== "undefined" ? window : globalThis);
