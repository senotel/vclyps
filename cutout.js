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
  function clear() { cache.clear(); last.clear(); }

  global.SenotelCutout = { load: load, ready: ready, onReady: onReady, apply: apply, mask: mask, failed: failedNow, clear: clear };
})(typeof window !== "undefined" ? window : globalThis);
