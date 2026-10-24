/* ═══════════════════════════════════════════════════════════
   beats.js — where the beats of a piece of music are (ccl5, 0.35.0)
   window.SenotelBeats.analyze(samples, sampleRate) →
     { bpm, period, offset, beats: [t…], strength: [0..1…] }

   Our own code, no library (the licence-safe beat trackers are thin, and
   the AGPL/GPL ones are not allowed in vClyps): an onset envelope (how
   suddenly the sound gets louder, 100 times a second), the tempo from its
   autocorrelation with a gentle preference for 120 BPM (where most music
   sits, as in librosa's beat tracker), then the phase: the grid offset
   whose beats land on the most onset energy. The grid is computed from
   its index (offset + k * period), never by adding a rounded period again
   and again, so it never drifts (the Hyperframes rule).

   Library music keeps a steady tempo, which is what a fixed grid assumes.
   Strength is the onset energy at each beat, scaled to the loudest one;
   the top quarter are the "strong" beats an edit's big moments land on.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const FPS = 100;          // onset envelope frames per second
  const MIN_BPM = 60, MAX_BPM = 200;

  /* How suddenly the sound gets louder, FPS times a second, from mono
     samples. "low" listens below about 150 Hz, where the kick drum marks
     the beat; "high" listens to attacks (a first difference), where the
     hi-hats and claps live. On real music the hi-hats alone lock onto the
     off-beat or onto triplets, so analyze() leans on the low band. */
  function lowPass(x, sr, fc) {
    const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
    const y = new Float32Array(x.length);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) { s1 += a * (x[i] - s1); s2 += a * (s1 - s2); y[i] = s2; }
    return y;
  }
  function onsetEnvelope(x, sr, band) {
    const hop = Math.max(1, Math.round(sr / FPS));
    const win = hop * 2;
    const n = Math.max(0, Math.floor((x.length - win) / hop) + 1);
    const logE = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const o = i * hop;
      if (band === "low") { for (let k = 0; k < win; k++) s += x[o + k] * x[o + k]; }
      else { for (let k = 1; k < win; k++) { const d = x[o + k] - x[o + k - 1]; s += d * d; } }
      logE[i] = Math.log(1e-10 + s / win);
    }
    const env = new Float32Array(n);
    for (let i = 1; i < n; i++) env[i] = Math.max(0, logE[i] - logE[i - 1]);
    // remove the slow average so only the attacks stand out
    const out = new Float32Array(n);
    const w = Math.round(FPS * 0.5);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += env[i];
      if (i >= w) sum -= env[i - w];
      out[i] = Math.max(0, env[i] - sum / Math.min(i + 1, w));
    }
    return out;
  }

  // The beat period, in envelope frames (fractional), from the autocorrelation.
  function tempoPeriod(env) {
    const lo = Math.floor((60 / MAX_BPM) * FPS), hi = Math.ceil((60 / MIN_BPM) * FPS);
    const n = env.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += env[i];
    mean /= Math.max(1, n);
    const ac = new Float32Array(hi + 2);
    for (let lag = lo - 1; lag <= hi + 1; lag++) {
      let s = 0;
      for (let i = lag; i < n; i++) s += (env[i] - mean) * (env[i - lag] - mean);
      ac[lag] = s / Math.max(1, n - lag);
    }
    let best = lo, bestScore = -Infinity;
    for (let lag = lo; lag <= hi; lag++) {
      // a log-normal preference centred on 120 BPM, one octave wide
      const bpm = (60 * FPS) / lag;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
      // a true beat period also lines up at twice its length
      const twice = 2 * lag <= hi + 1 ? ac[2 * lag] : 0;
      const score = (ac[lag] + 0.5 * Math.max(0, twice)) * prior;
      if (score > bestScore) { bestScore = score; best = lag; }
    }
    // parabolic interpolation around the peak for a fractional period
    const a = ac[best - 1], b = ac[best], c = ac[best + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / den)) : 0;
    const first = best + shift;
    /* Syncopated music (a bass or a hit every three-quarters of a beat) can
       win the autocorrelation at 4/3 or 3/2 of the real tempo. A real beat
       has subdivisions (8ths, 16ths) that also land on hits; a false one's
       halves fall between them. So the related periods are compared by how
       well the beat AND its halves and quarters line up. */
    const comb = (q) => {
      const steps = Math.max(6, Math.round(q));
      let bestS = 0;
      for (let s = 0; s < steps; s++) {
        const off = (s / steps) * q;
        let sum = 0, k = 0;
        for (let f = off; f < n; f += q) { sum += Math.max(at(env, f - 1), at(env, f), at(env, f + 1)); k++; }
        bestS = Math.max(bestS, k ? sum / k : 0);
      }
      return bestS - mean;
    };
    /* Each candidate first finds its own exact period (within 4%): a period
       1% off drifts a whole beat away from the hits over half a minute, and
       would lose to a wrong tempo that happens to be measured exactly. */
    const scoreOf = (p) => comb(p) + 0.6 * comb(p / 2) + 0.3 * comb(p / 4);
    let pick = first, pickScore = -Infinity;
    [1, 4 / 3, 3 / 4, 3 / 2, 2 / 3].forEach((r) => {
      let p = first * r;
      if (p < lo || p > hi) return;
      let bestP = p, bestS = -Infinity;
      for (let d = -0.04; d <= 0.0401; d += 0.004) {
        const q = p * (1 + d);
        const s = scoreOf(q);
        if (s > bestS) { bestS = s; bestP = q; }
      }
      p = bestP;
      const bpm = (60 * FPS) / p;
      const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 1.0, 2));
      const score = bestS * (0.6 + 0.4 * prior);
      if (score > pickScore + 1e-9) { pickScore = score; pick = p; }
    });
    return pick;
  }

  // the envelope's value at a fractional frame
  function at(env, f) {
    const i = Math.floor(f), t = f - i;
    if (i < 0 || i + 1 >= env.length) return 0;
    return env[i] * (1 - t) + env[i + 1] * t;
  }

  // The grid offset (in frames) whose beats carry the most onset energy.
  function phase(env, period) {
    const steps = Math.max(8, Math.round(period * 2));
    let best = 0, bestScore = -Infinity;
    for (let s = 0; s < steps; s++) {
      const off = (s / steps) * period;
      let score = 0;
      for (let f = off; f < env.length; f += period) {
        // a little tolerance either side of the grid point
        score += Math.max(at(env, f - 1), at(env, f), at(env, f + 1));
      }
      if (score > bestScore) { bestScore = score; best = off; }
    }
    return best;
  }

  /* The envelope's frames are 10 ms wide and lag the hit, and the period
     comes from whole-frame lags, so the first grid can sit tens of ms off.
     Second pass, in the samples themselves: near each grid point find the
     exact moment the sound jumps (1 ms steps), then fit the period and
     offset through those moments (least squares on beat index), so the grid
     goes through the hits, not near them. */
  function refine(x, sr, offSec, perSec) {
    const step = Math.max(1, Math.round(sr / 1000)), win = step * 2;
    const reach = Math.min(0.06, perSec * 0.25);
    const pts = [];
    const dur = x.length / sr;
    for (let k = 0; ; k++) {
      const t = offSec + k * perSec;
      if (t > dur - reach) break;
      if (t < reach) continue;
      let best = -Infinity, bestT = null, prev = null;
      for (let s = t - reach; s <= t + reach; s += step / sr) {
        const o = Math.round(s * sr);
        let e = 0;
        for (let i = 1; i < win; i++) { const d = x[o + i] - x[o + i - 1]; e += d * d; }
        const le = Math.log(1e-10 + e);
        if (prev !== null && le - prev > best) { best = le - prev; bestT = s; }
        prev = le;
      }
      if (bestT !== null && best > 1) pts.push([k, bestT]);
    }
    if (pts.length < 4) return { off: offSec, per: perSec };
    // least squares t = off + k * per, twice, the second time without outliers
    const fit = (p) => {
      const n = p.length;
      let sk = 0, st = 0, skk = 0, skt = 0;
      p.forEach(([k, t]) => { sk += k; st += t; skk += k * k; skt += k * t; });
      const per = (n * skt - sk * st) / (n * skk - sk * sk);
      return { per: per, off: (st - per * sk) / n };
    };
    let f = fit(pts);
    const kept = pts.filter(([k, t]) => Math.abs(t - (f.off + k * f.per)) < 0.02);
    if (kept.length >= 4) f = fit(kept);
    if (!(f.per > 0) || Math.abs(f.per - perSec) > perSec * 0.05) return { off: offSec, per: perSec };
    // the earliest beat at or after 0
    let off = f.off % f.per;
    if (off < 0) off += f.per;
    return { off: off, per: f.per };
  }

  function analyze(samples, sampleRate) {
    const empty = { bpm: 0, period: 0, offset: 0, beats: [], strength: [] };
    if (!samples || !sampleRate || samples.length < sampleRate * 2) return empty;
    // tempo and phase from the first minute (library music keeps its tempo);
    // the grid and each beat's strength then cover the whole track
    const work = samples.length > 60 * sampleRate ? samples.subarray(0, 60 * sampleRate) : samples;
    const low = onsetEnvelope(lowPass(work, sampleRate, 150), sampleRate, "low");
    const high = onsetEnvelope(work, sampleRate, "high");
    const n = Math.min(low.length, high.length);
    if (n < FPS * 2) return empty;
    // the kick leads, the attacks help (a track without a kick still has attacks)
    const norm = (e) => { let m = 0; for (let i = 0; i < n; i++) m += e[i]; return m / n || 1; };
    const nl = norm(low), nh = norm(high);
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) env[i] = low[i] / nl + 0.35 * high[i] / nh;
    let period = tempoPeriod(env);
    if (!(period > 0)) return empty;
    let off = phase(env, period);
    const r = refine(work, sampleRate, off / FPS, period / FPS);
    period = r.per * FPS;
    off = r.off * FPS;
    /* A slow reading (under 90 BPM) whose halfway points hit as hard as its
       beats is really twice as fast: a strummed or shuffled track can make
       every second beat look like the pulse. Measured in the samples, the
       same way a beat's strength is. */
    if ((60 * FPS) / period < 90) {
      const hit = (t) => {
        const o = Math.max(0, Math.round(t * sampleRate) - Math.round(0.005 * sampleRate)), n = Math.round(0.04 * sampleRate);
        let e = 0;
        for (let i = o; i < Math.min(work.length, o + n); i++) e += work[i] * work[i];
        return Math.sqrt(e / n);
      };
      let on = 0, half = 0, k = 0;
      for (let f = off; f / FPS < work.length / sampleRate - period / FPS; f += period) {
        on += hit(f / FPS); half += hit((f + period / 2) / FPS); k++;
      }
      if (k >= 4 && half >= 0.9 * on) period /= 2;
    }
    const dur = samples.length / sampleRate;
    const beats = [], raw = [];
    const hitLen = Math.round(0.04 * sampleRate);
    for (let k = 0; ; k++) {
      const f = off + k * period;       // from the index: never drifts
      const t = f / FPS;
      if (t > dur) break;
      beats.push(Math.round(t * 1000) / 1000);
      /* How hard this beat hits: the sound's own energy just after it, on a
         linear scale (on the envelope's log scale a soft hit after silence
         looks as big as a loud one). */
      const o = Math.max(0, Math.round(t * sampleRate) - Math.round(0.005 * sampleRate));
      let e = 0;
      for (let i = o; i < Math.min(samples.length, o + hitLen); i++) e += samples[i] * samples[i];
      raw.push(Math.sqrt(e / hitLen));
    }
    const top = raw.reduce((a, b) => Math.max(a, b), 0) || 1;
    return {
      bpm: Math.round(((60 * FPS) / period) * 10) / 10,
      period: period / FPS,
      offset: off / FPS,
      beats: beats,
      strength: raw.map((v) => Math.round((v / top) * 100) / 100)
    };
  }

  // the strong beats: the top quarter by strength, and never a weak one (under 0.6)
  function strongBeats(a) {
    if (!a || !a.beats.length) return [];
    const sorted = a.strength.slice().sort((x, y) => y - x);
    const cut = Math.max(0.6, sorted[Math.max(0, Math.floor(sorted.length / 4) - 1)] || 0.6);
    return a.beats.filter((t, i) => a.strength[i] >= cut - 1e-9);
  }

  global.SenotelBeats = { analyze: analyze, strongBeats: strongBeats, FPS: FPS };
})(typeof window !== "undefined" ? window : globalThis);
