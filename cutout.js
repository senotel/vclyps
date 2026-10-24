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
  let seg = null, loading = null, failed = null;
  const listeners = [];

  function load() {
    if (seg) return Promise.resolve(seg);
    if (!loading) {
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
      })().catch((e) => { failed = e; loading = null; throw e; });
    }
    return loading;
  }
  const ready = () => !!seg;
  const onReady = (f) => { if (seg) f(); else listeners.push(f); };

  // small working canvases
  let inCv = null, maskCv = null;
  const cache = new Map();          // key → Uint8ClampedArray of alpha (mw x mh)
  const last = new Map();           // stream → {i, alpha}
  function alphaFor(source, W, H, key, stream, index) {
    const hit = cache.get(key);
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
    if (prev && prev.alpha.length === a.length && Math.abs(index - prev.i) === 1) {
      for (let i = 0; i < a.length; i++) a[i] = a[i] * 0.65 + prev.alpha[i] * 0.35;
    }
    last.set(stream, { i: index, alpha: a });
    if (cache.size > 900) cache.delete(cache.keys().next().value);
    cache.set(key, a);
    a.mw = mw; a.mh = mh;
    return a;
  }

  /* opts: {stream (an id), index (frame number), soft (0..1 edge softness)} */
  function apply(ctx, W, H, key, opts) {
    if (!seg) { if (!failed) load().catch(() => {}); return false; }
    const o = opts || {};
    const a = alphaFor(ctx.canvas, W, H, key, o.stream || "x", o.index || 0);
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

  global.SenotelCutout = { load: load, ready: ready, onReady: onReady, apply: apply, failed: () => failed };
})(typeof window !== "undefined" ? window : globalThis);
