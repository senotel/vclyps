/* ═══════════════════════════════════════════════════════════
   loudness.js — every export at the loudness people expect (0.35.0)
   window.SenotelLoudness.level(channels, sampleRate, opts) → report

   Social apps play everything at about -14 LUFS. A quiet export sounds
   weak next to the video before it, a loud one gets turned down and
   squashed. So the finished mix is measured the broadcast way (ITU-R
   BS.1770 / EBU R128: K-weighting, 400 ms blocks every 100 ms, the -70
   LUFS absolute gate and the -10 LU relative gate), brought to the target,
   and held under a ceiling by a look-ahead limiter, so raising the level
   can never clip. The brag video was levelled like this by hand
   (2026-10-23); this does it on every export. Our own code, no library.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  // The two K-weighting stages for any sample rate (the libebur128 formulas).
  function kCoeffs(fs) {
    // stage 1: the head's high shelf
    let G = 3.999843853973347, Q = 0.7071752369554196, fc = 1681.974450955533;
    let K = Math.tan(Math.PI * fc / fs);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const s1 = {
      b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0],
      a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    };
    // stage 2: the low cut
    Q = 0.5003270373238773; fc = 38.13547087602444;
    K = Math.tan(Math.PI * fc / fs);
    a0 = 1 + K / Q + K * K;
    const s2 = { b: [1, -2, 1], a: [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
    return [s1, s2];
  }

  function biquad(x, f) {
    const y = new Float32Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const [b0, b1, b2] = f.b, [, a1, a2] = f.a;
    for (let i = 0; i < x.length; i++) {
      const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = v;
      y[i] = v;
    }
    return y;
  }

  // Integrated loudness in LUFS (-Infinity for silence). channels: Float32Array[]
  function integrated(channels, fs) {
    if (!channels || !channels.length || !channels[0].length) return -Infinity;
    const [s1, s2] = kCoeffs(fs);
    const weighted = channels.slice(0, 2).map((c) => biquad(biquad(c, s1), s2));
    const block = Math.round(0.4 * fs), step = Math.round(0.1 * fs);
    const n = weighted[0].length;
    const powers = [];
    for (let o = 0; o + block <= n; o += step) {
      let z = 0;
      weighted.forEach((w) => {
        let s = 0;
        for (let i = o; i < o + block; i++) s += w[i] * w[i];
        z += s / block;                    // left and right weigh 1 each
      });
      powers.push(z);
    }
    if (!powers.length) return -Infinity;
    const lufs = (p) => -0.691 + 10 * Math.log10(p);
    const abs = powers.filter((p) => p > 0 && lufs(p) > -70);
    if (!abs.length) return -Infinity;
    const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((p) => lufs(p) > rel);
    if (!gated.length) return -Infinity;
    return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }

  /* A look-ahead limiter, in place: the gain each sample needs to stay under
     the ceiling, then the smallest of those over the next `ahead` samples
     (so the gain is already down when the peak arrives), averaged over the
     same length (a smooth duck, never a click, and still under the ceiling
     at every peak), then a slow release back up. */
  function limit(channels, fs, ceiling) {
    const n = channels[0].length;
    const ahead = Math.max(1, Math.round(0.005 * fs));
    const need = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let p = 0;
      for (let c = 0; c < channels.length; c++) p = Math.max(p, Math.abs(channels[c][i]));
      need[i] = p > ceiling ? ceiling / p : 1;
    }
    // forward-looking minimum over [i, i + ahead]
    const mn = new Float32Array(n);
    const dq = new Int32Array(n);
    let h = 0, t = 0;
    for (let i = n - 1; i >= 0; i--) {
      while (t > h && need[dq[t - 1]] >= need[i]) t--;
      dq[t++] = i;
      while (dq[h] > i + ahead) h++;
      mn[i] = need[dq[h]];
    }
    // average over [i - ahead + 1, i], then release slowly
    const rel = 1 - Math.exp(-1 / (0.08 * fs));
    let sum = 0, g = 1, peakAfter = 0;
    for (let i = 0; i < n; i++) {
      sum += mn[i];
      if (i >= ahead) sum -= mn[i - ahead];
      const avg = sum / Math.min(i + 1, ahead);
      g = Math.min(avg, g + (1 - g) * rel);
      for (let c = 0; c < channels.length; c++) {
        const v = channels[c][i] * g;
        channels[c][i] = v;
        peakAfter = Math.max(peakAfter, Math.abs(v));
      }
    }
    return peakAfter;
  }

  /* Bring the mix to `target` LUFS (default -14), never more than +12 dB of
     lift, under a -1.5 dBFS ceiling. Changes the channels in place and says
     what it did. Near-silent mixes are left alone. */
  function level(channels, fs, opts) {
    const o = Object.assign({ target: -14, maxGainDb: 12, ceilingDb: -1.5 }, opts || {});
    const before = integrated(channels, fs);
    if (!isFinite(before) || before < -50) return { before: before, after: before, gainDb: 0, peak: 0, skipped: true };
    const gainDb = Math.min(o.maxGainDb, o.target - before);
    const g = Math.pow(10, gainDb / 20);
    channels.forEach((c) => { for (let i = 0; i < c.length; i++) c[i] *= g; });
    const peak = limit(channels, fs, Math.pow(10, o.ceilingDb / 20));
    return { before: before, after: integrated(channels, fs), gainDb: gainDb, peak: peak, skipped: false };
  }

  global.SenotelLoudness = { integrated: integrated, level: level, limit: limit, kCoeffs: kCoeffs };
})(typeof window !== "undefined" ? window : globalThis);
