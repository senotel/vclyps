/* ═══════════════════════════════════════════════════════════
   cutout.js — remove the background behind a person (ccl16, 0.47.0)
   window.SenotelCutout

   CapCut's Remove background, with no green screen: the person stays,
   everything behind them goes. Google's MediaPipe image segmenter (Apache-
   2.0) with its selfie multiclass model (hair, skin, clothes; 256 x 256),
   about 16 MB in all, downloaded the first time it is used and run on the
   device's GPU: free, private, about 15 ms a frame.

   apply(ctx, W, H, key, opts) cuts the person out of what is already on
   ctx (W x H at 0,0): everything else becomes see-through. key names the
   frame (clip + frame number), so a frame is worked out once; frames that
   follow each other are blended a little so the edge does not flicker.
   Returns false (and starts loading) when the model is not ready yet.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite";
  const SIDE = 256;
  /* A failed download is not final: load() always tries again (and clears
     the failure), and after RETRY ms failed() goes quiet so the next frame
     tries by itself, for a connection that was only down for a moment. */
  const RETRY = 20000;
  let seg = null, loading = null, failed = null, failedAt = 0;
  const listeners = [];
  const failedNow = () => (failed && Date.now() - failedAt < RETRY ? failed : null);

  function load() {
    if (seg) return Promise.resolve(seg);
    if (!loading) {
      failed = null;
      loading = (async () => {
        const V = await import(BASE + "/vision_bundle.mjs");
        const fs = await V.FilesetResolver.forVisionTasks(BASE + "/wasm");
        const make = (delegate) => V.ImageSegmenter.createFromOptions(fs, {
          baseOptions: { modelAssetPath: MODEL, delegate: delegate },
          runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false
        });
        try { seg = await make("GPU"); } catch (e) { seg = await make("CPU"); }
        // the first frames compile the GPU's programs: do that now, not in the middle of playback
        const warm = document.createElement("canvas");
        warm.width = 144; warm.height = SIDE;
        for (let i = 0; i < 3; i++) { const r = seg.segment(warm); r.confidenceMasks.forEach((m) => m.close()); }
        listeners.splice(0).forEach((f) => { try { f(); } catch (e) {} });
        return seg;
      })().catch((e) => { failed = e; failedAt = Date.now(); loading = null; throw e; });
    }
    return loading;
  }
  const ready = () => !!seg;
  const onReady = (f) => { if (seg) f(); else listeners.push(f); };

  // small working canvases
  let inCv = null, maskCv = null;
  const cache = new Map();          // key → Uint8ClampedArray of alpha (mw x mh)
  const last = new Map();           // stream → {t, alpha}
  /* Frames this close in the source are neighbours and share a little of
     their edge. By source time, not frame number: on a sped-up clip the
     frame number jumps by 2 or more between frames that follow each other. */
  const NEAR = 0.15;
  // key null: worked out afresh and never kept (the body effects)
  function alphaFor(source, W, H, key, stream, t) {
    const hit = key != null ? cache.get(key) : null;
    if (hit) return hit;
    const k = SIDE / Math.max(W, H);
    const mw = Math.max(8, Math.round(W * k)), mh = Math.max(8, Math.round(H * k));
    if (!inCv) inCv = document.createElement("canvas");
    if (inCv.width !== mw) inCv.width = mw;
    if (inCv.height !== mh) inCv.height = mh;
    const ix = inCv.getContext("2d");
    ix.clearRect(0, 0, mw, mh);
    ix.drawImage(source, 0, 0, mw, mh);
    const r = seg.segment(inCv);
    const bg = r.confidenceMasks[0].getAsFloat32Array();
    r.confidenceMasks.forEach((m) => m.close());
    const a = new Uint8ClampedArray(mw * mh);
    for (let i = 0; i < a.length; i++) a[i] = (1 - bg[i]) * 255;
    // one frame after another: a little of the last frame's edge, so it holds still
    const prev = last.get(stream);
    const gap = prev ? Math.abs(t - prev.t) : 0;
    if (prev && prev.alpha.length === a.length && gap > 1e-4 && gap <= NEAR) {
      for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.65 + prev.alpha[i] * 0.35;
    }
    last.set(stream, { t: t, alpha: a });
    if (key != null) {
      if (cache.size > 900) cache.delete(cache.keys().next().value);
      cache.set(key, a);
    }
    a.mw = mw; a.mh = mh;
    return a;
  }
  // the source time of a frame: opts.time (seconds), else its frame number at 30 a second
  const timeOf = (o) => (o.time != null ? o.time : (o.index || 0) / 30);

  /* opts: {stream (an id), time (source seconds) or index (frame number at
     30 a second), soft (0..1 edge softness)} */
  function apply(ctx, W, H, key, opts) {
    if (!seg) { if (!failedNow()) load().catch(() => {}); return false; }
    const o = opts || {};
    const a = alphaFor(ctx.canvas, W, H, key, o.stream || "x", timeOf(o));
    const mw = a.mw || Math.round(W * SIDE / Math.max(W, H)), mh = a.mh || Math.round(H * SIDE / Math.max(W, H));
    if (!maskCv) maskCv = document.createElement("canvas");
    if (maskCv.width !== mw) maskCv.width = mw;
    if (maskCv.height !== mh) maskCv.height = mh;
    const mx = maskCv.getContext("2d");
    const img = mx.createImageData(mw, mh);
    for (let i = 0; i < a.length; i++) { img.data[i * 4 + 3] = a[i]; }
    mx.putImageData(img, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    const soft = Math.max(0, Math.min(1, o.soft == null ? 0.3 : o.soft));
    ctx.filter = soft > 0.02 ? "blur(" + (soft * Math.max(W, H) * 0.006).toFixed(1) + "px)" : "none";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(maskCv, 0, 0, W, H);
    ctx.restore();
    return true;
  }

  /* The person mask alone, as a canvas (white where the person is, see-
     through elsewhere) at the working size, for the body effects (ccl19).
     key may be null to always work it out afresh. Null when not ready. */
  let outMask = null;
  function mask(source, W, H, key, opts) {
    if (!seg) { if (!failedNow()) load().catch(() => {}); return null; }
    const o = opts || {};
    const a = alphaFor(source, W, H, key || null, o.stream || "fx", timeOf(o));
    const mw = a.mw, mh = a.mh;
    if (!outMask) outMask = document.createElement("canvas");
    if (outMask.width !== mw) outMask.width = mw;
    if (outMask.height !== mh) outMask.height = mh;
    const x = outMask.getContext("2d");
    const img = x.createImageData(mw, mh);
    for (let i = 0; i < a.length; i++) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = a[i]; }
    x.putImageData(img, 0, 0);
    return outMask;
  }

  // a new project: no masks from the last one (ids start again at 1)
  function clear() {
    generation++; choiceRetries.clear(); choices.clear(); cache.clear(); last.clear();
    for (const slot of choiceWorkers.values()) {
      slot.discard = true;
      if (!slot.busy) slot.worker.terminate();
    }
    choiceWorkers.clear();
  }

  // Auto's rolling cache must not evict an analysed clip during export.
  const choices = new Map();
  const CHOOSE_STRIDE = 3, CHOOSE_WASM_STRIDE = 6;
  // Keep recent workers alive so Add/Erase can reuse the anchor embedding.
  const choiceWorkers = new Map();
  // A failed source read must not make a retry encode completed frames again.
  const choiceRetries = new Map();
  let generation = 0;
  function points(pts) {
    return (pts || []).filter((p) => p.length >= 3 && Number.isFinite(p[0]) && Number.isFinite(p[1]))
      .map((p) => [Math.max(0, Math.min(1, p[0])), Math.max(0, Math.min(1, p[1])), p[2] > 0 ? 1 : -1]);
  }
  function chooseKey(item, media, geometry) {
    return JSON.stringify([media.url, item.id, item.cutout.pts, item.cutout.at, item.in, item.out, item.dur, geometry]);
  }
  function seed(a, w, h) {
    let sx = 0, sy = 0, n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > 127) {
      const x = i % w, y = Math.floor(i / w);
      sx += x; sy += y; n++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (!n) throw new Error("The object was lost. Choose it again with more points.");
    let best = Infinity, at = 0;
    for (let i = 0; i < a.length; i++) if (a[i] > 127) {
      const d = (i % w - sx / n) ** 2 + (Math.floor(i / w) - sy / n) ** 2;
      if (d < best) { best = d; at = i; }
    }
    const pts = [[(at % w + 0.5) / w, (Math.floor(at / w) + 0.5) / h, 1]];
    // A little room around the box lets the object move between source frames.
    pts.box = [Math.max(0, x0 / w - 0.05), Math.max(0, y0 / h - 0.05),
      Math.min(1, (x1 + 1) / w + 0.05), Math.min(1, (y1 + 1) / h + 0.05)];
    return pts;
  }
  function analyse(key, spec, progress) {
    const old = choices.get(key);
    if (old) return old.promise;
    if (spec.owner != null) for (const [k, oldJob] of choices) if (oldJob.owner === spec.owner) {
      oldJob.cancelled = true; choices.delete(k);
    }
    const predecessor = spec.owner != null && choiceWorkers.get(spec.owner);
    const job = { frames: choiceRetries.get(key) || new Map(), p: 0, ms: 0, owner: spec.owner }, epoch = generation;
    choiceRetries.delete(key);
    choices.set(key, job);
    job.promise = (async () => {
      if (predecessor && predecessor.busy) await predecessor.done;
      if (epoch !== generation || job.cancelled) { if (spec.close) spec.close(); throw new Error("Object analysis cancelled"); }
      const owner = spec.owner == null ? key : spec.owner;
      let slot = choiceWorkers.get(owner);
      if (!slot) {
        for (const [id, idle] of choiceWorkers) if (!idle.busy && choiceWorkers.size >= 2) { idle.worker.terminate(); choiceWorkers.delete(id); }
        slot = { worker: new Worker(new URL("cutout-worker.js", document.baseURI), { type: "module" }) };
        choiceWorkers.set(owner, slot);
      }
      slot.busy = true;
      let release;
      slot.done = new Promise((r) => { release = r; });
      const worker = slot.worker;
      let bootError = null;
      worker.onerror = (e) => { bootError = new Error(e.message || "Object worker failed"); };
      const infer = (image, pts, index, anchor) => new Promise((resolve, reject) => {
        if (bootError) { reject(bootError); return; }
        const timer = setTimeout(() => { slot.discard = true; reject(new Error("Object analysis timed out. Try again.")); }, 180000);
        worker.onerror = (e) => { slot.discard = true; clearTimeout(timer); reject(new Error(e.message || "Object worker failed")); };
        worker.onmessage = ({ data }) => {
          if (data.progress) { if (progress) progress(job.p, data.progress); return; }
          clearTimeout(timer);
          if (data.error) reject(new Error(data.error)); else resolve(data);
        };
        let identity;
        try { const parts = JSON.parse(key); parts[2] = null; identity = JSON.stringify(parts); } catch (e) { identity = key; }
        worker.postMessage(image ? { rgba: image.data, w: image.width, h: image.height, pts, box: pts.box,
          frameKey: identity + ":" + index, anchor } : { init: true });
      });
      try {
        const backend = await infer(null);
        job.device = backend.device;
        const stride = job.stride = backend.device === "webgpu" ? CHOOSE_STRIDE : CHOOSE_WASM_STRIDE;
        if (progress) progress(job.p);
        const lo = Math.round(spec.from * 30), hi = Math.round(spec.to * 30);
        const first = Math.max(lo, Math.min(hi, Math.round(spec.at * 30)));
        const forward = [], backward = [];
        for (let i = first + stride; i < hi; i += stride) forward.push(i);
        if (hi > first) forward.push(hi);
        for (let i = first - stride; i > lo; i -= stride) backward.push(i);
        if (lo < first) backward.push(lo);
        const total = 1 + forward.length + backward.length;
        let count = 0, previous = null, warmMs = 0, warmCount = 0;
        const frame = async (index, pts) => {
          if (epoch !== generation || job.cancelled) throw new Error("Object analysis cancelled");
          const cached = job.frames.get(index);
          if (cached) { previous = cached; job.p = ++count / total; if (progress) progress(job.p); return cached.next || seed(cached, cached.mw, cached.mh); }
          const began = performance.now(), image = await spec.frame(index / 30);
          const result = await infer(image, pts, index, index === first), a = result.alpha;
          if (epoch !== generation || job.cancelled) throw new Error("Object analysis cancelled");
          job.ms = performance.now() - began;
          const next = seed(a, image.width, image.height);
          if (previous) for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.65 + previous[i] * 0.35;
          a.mw = image.width; a.mh = image.height; a.next = next;
          job.frames.set(index, a); previous = a;
          if (count > 0) { warmMs += job.ms; warmCount++; }
          job.p = ++count / total;
          if (warmCount >= 2) job.remaining = warmMs / warmCount * (total - count) / 1000;
          if (progress) progress(job.p);
          return next;
        };
        const original = await frame(first, points(spec.pts));
        let pts = original;
        for (const i of forward) pts = await frame(i, pts);
        previous = job.frames.get(first); pts = original;
        for (const i of backward) pts = await frame(i, pts);
        job.p = 1;
      } finally {
        slot.busy = false; release();
        if (slot.discard || spec.owner == null) { worker.terminate(); if (choiceWorkers.get(owner) === slot) choiceWorkers.delete(owner); }
        if (spec.close) spec.close();
      }
    })().catch((e) => {
      if (!job.cancelled && epoch === generation && spec.owner != null) {
        if (choiceRetries.size >= 2) choiceRetries.delete(choiceRetries.keys().next().value);
        choiceRetries.set(key, job.frames);
      }
      if (choices.get(key) === job) choices.delete(key);
      throw e;
    });
    return job.promise;
  }
  function choiceStatus(key) { return choices.get(key); }
  let choiceMaskCv = null;
  function applyChoice(ctx, W, H, key, time, soft) {
    const job = choices.get(key), index = time * 30;
    let a = job && job.frames.get(index);
    if (job && !a) {
      let lo = -Infinity, hi = Infinity;
      for (const i of job.frames.keys()) { if (i <= index && i > lo) lo = i; if (i >= index && i < hi) hi = i; }
      const left = job.frames.get(lo), right = job.frames.get(hi);
      if (!left && hi - index <= 0.5) a = right;
      if (!right && index - lo <= 0.5) a = left;
      if (left && right) {
        const weight = (index - lo) / (hi - lo);
        a = new Uint8ClampedArray(left.length); a.mw = left.mw; a.mh = left.mh;
        for (let i = 0; i < a.length; i++) a[i] = left[i] * (1 - weight) + right[i] * weight;
      }
    }
    if (!a) return false;
    const cv = choiceMaskCv || (choiceMaskCv = document.createElement("canvas"));
    if (cv.width !== a.mw) cv.width = a.mw;
    if (cv.height !== a.mh) cv.height = a.mh;
    const x = cv.getContext("2d"), img = x.createImageData(a.mw, a.mh);
    for (let i = 0; i < a.length; i++) img.data[i * 4 + 3] = a[i];
    x.putImageData(img, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "destination-in";
    ctx.filter = "blur(" + ((soft == null ? 0.3 : soft) * Math.max(W, H) * 0.006).toFixed(1) + "px)";
    ctx.drawImage(cv, 0, 0, W, H); ctx.restore();
    return true;
  }

  global.SenotelCutout = { points, chooseKey, seed, analyse, choiceStatus, applyChoice, load: load, ready: ready, onReady: onReady, apply: apply, mask: mask, failed: failedNow, clear: clear };
})(typeof window !== "undefined" ? window : globalThis);
