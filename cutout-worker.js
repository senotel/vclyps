import { SamModel, AutoProcessor, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
// SlimSAM and Transformers.js are Apache-2.0. Weights stay in the device cache.
let model, processor, device, dtype;
const embeddings = new Map();
self.onmessage = async ({ data: d }) => {
  let inputs, outputs, masks, entry, reply;
  try {
    if (!model || !processor) {
      const progress_callback = (p) => self.postMessage({ progress: p });
      let adapter = null;
      try { adapter = await navigator.gpu?.requestAdapter(); } catch (e) {}
      device = adapter ? 'webgpu' : 'wasm';
      dtype = adapter ? (adapter.features.has('shader-f16') ? 'fp16' : 'fp32') : 'q8';
      model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform', { dtype, device, progress_callback });
      processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
    }
    if (d.init) { self.postMessage({ device, dtype }); return; }
    const image = new RawImage(d.rgba, d.w, d.h, 4);
    const coords = d.pts.map((p) => [p[0] * d.w, p[1] * d.h]);
    const labels = d.pts.map((p) => p[2] > 0 ? 1 : 0);
    // SAM's ONNX prompt encoder represents box corners with labels 2 and 3.
    if (d.box) {
      coords.push([d.box[0] * d.w, d.box[1] * d.h], [d.box[2] * d.w, d.box[3] * d.h]);
      labels.push(2, 3);
    }
    inputs = await processor(image, {
      input_points: [coords], input_labels: [labels]
    });
    entry = d.frameKey != null && embeddings.get(d.frameKey);
    if (!entry) {
      // Retain the anchor and latest frame only, even across prompt edits.
      for (const [key, old] of embeddings) if (!old.anchor || d.anchor) {
        for (const t of Object.values(old.value)) if (t.dispose) await t.dispose();
        embeddings.delete(key);
      }
      entry = { value: await model.get_image_embeddings(inputs), anchor: !!d.anchor };
      if (d.frameKey != null) embeddings.set(d.frameKey, entry);
    }
    outputs = await model({ ...inputs, ...entry.value });
    masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = outputs.iou_scores.data;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const n = d.w * d.h, a = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) a[i] = masks[0].data[best * n + i] ? 255 : 0;
    reply = { alpha: a, device, dtype };
  } catch (e) { reply = { error: e.message || String(e) }; }
  finally {
    // Cached image tensors belong to the worker, not to an individual prompt.
    const retained = new Set(entry ? Object.values(entry.value) : []);
    const temporary = new Set([...Object.values(outputs || {}), ...Object.values(inputs || {}), ...(masks || [])]);
    if (d.frameKey == null && entry) for (const t of retained) temporary.add(t);
    for (const t of temporary) if (t && t.dispose && (!retained.has(t) || d.frameKey == null)) await t.dispose();
  }
  if (reply) self.postMessage(reply, reply.alpha ? [reply.alpha.buffer] : []);
};
