import { SamModel, AutoProcessor, RawImage } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
// SlimSAM and Transformers.js are Apache-2.0. Weights stay in the device cache.
let model, processor;
self.onmessage = async ({ data: d }) => {
  try {
    if (!model) {
      const progress_callback = (p) => self.postMessage({ progress: p });
      model = await SamModel.from_pretrained('Xenova/slimsam-77-uniform', { dtype: 'q8', device: 'wasm', progress_callback });
      processor = await AutoProcessor.from_pretrained('Xenova/slimsam-77-uniform');
    }
    const image = new RawImage(d.rgba, d.w, d.h, 4);
    const coords = d.pts.map((p) => [p[0] * d.w, p[1] * d.h]);
    const labels = d.pts.map((p) => p[2] > 0 ? 1 : 0);
    // SAM's ONNX prompt encoder represents box corners with labels 2 and 3.
    if (d.box) {
      coords.push([d.box[0] * d.w, d.box[1] * d.h], [d.box[2] * d.w, d.box[3] * d.h]);
      labels.push(2, 3);
    }
    const inputs = await processor(image, {
      input_points: [coords], input_labels: [labels]
    });
    const outputs = await model(inputs);
    const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const scores = outputs.iou_scores.data;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
    const n = d.w * d.h, a = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) a[i] = masks[0].data[best * n + i] ? 255 : 0;
    self.postMessage({ alpha: a }, [a.buffer]);
    for (const value of Object.values(outputs)) if (value.dispose) await value.dispose();
    for (const value of Object.values(inputs)) if (value && value.dispose) await value.dispose();
    for (const value of masks) if (value.dispose) await value.dispose();
  } catch (e) { self.postMessage({ error: e.message || String(e) }); }
};
