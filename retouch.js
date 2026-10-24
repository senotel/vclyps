/* ═══════════════════════════════════════════════════════════
   retouch.js — face and body retouch (ccl19, 0.49.0)
   window.SenotelRetouch

   CapCut's Retouch on a clip: Smooth, Whiten, Eyes, Slim face (Face) and
   Slim, Longer legs (Body). Where the face and body are comes from Google's
   MediaPipe Face Landmarker (478 points) and Pose Landmarker lite (Apache-
   2.0), downloaded the first time and run on the device. The reshaping is
   one WebGL warp written here (each control point pushes or magnifies the
   picture around it, fading to nothing at its edge, so the background
   never bends); the skin smoothing is a blur kept to the skin (the face
   outline less eyes and mouth).

   apply(ctx, W, H, key, r) retouches what is on ctx (W x H at 0,0);
   r = {smooth, whiten, eyes, slim, body, legs}, each 0..1. False while
   the models load (the frame is left as it is).
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const FACE = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
  const POSE = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";
  const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
  const EYE_L = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
  const EYE_R = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
  const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
  const BROW_L = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
  const BROW_R = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];

  let face = null, pose = null, loading = null, failed = null;
  function load() {
    if (face && pose) return Promise.resolve();
    if (!loading) {
      loading = (async () => {
        const V = await import(BASE + "/vision_bundle.mjs");
        const fs = await V.FilesetResolver.forVisionTasks(BASE + "/wasm");
        const make = async (Task, model, extra) => {
          try { return await Task.createFromOptions(fs, Object.assign({ baseOptions: { modelAssetPath: model, delegate: "GPU" }, runningMode: "IMAGE" }, extra)); }
          catch (e) { return Task.createFromOptions(fs, Object.assign({ baseOptions: { modelAssetPath: model, delegate: "CPU" }, runningMode: "IMAGE" }, extra)); }
        };
        face = await make(V.FaceLandmarker, FACE, { numFaces: 3 });
        pose = await make(V.PoseLandmarker, POSE, { numPoses: 2 });
      })().catch((e) => { failed = e; loading = null; throw e; });
    }
    return loading;
  }
  const ready = () => !!(face && pose);

  /* ─── where the faces and bodies are (cached per frame, steadied over neighbours) ─── */
  let small = null;
  const cache = new Map(), last = new Map();
  function marks(source, W, H, key, stream, index, needPose) {
    const k = key + (needPose ? "|p" : "");
    const hit = cache.get(k);
    if (hit) return hit;
    const s = 384 / Math.max(W, H);
    const mw = Math.max(16, Math.round(W * s)), mh = Math.max(16, Math.round(H * s));
    if (!small) small = document.createElement("canvas");
    if (small.width !== mw) small.width = mw;
    if (small.height !== mh) small.height = mh;
    small.getContext("2d").drawImage(source, 0, 0, mw, mh);
    const fr = face.detect(small);
    const out = { faces: (fr.faceLandmarks || []).map((f) => f.map((p) => ({ x: p.x * W, y: p.y * H }))), poses: [] };
    if (needPose) {
      const pr = pose.detect(small);
      out.poses = (pr.landmarks || []).map((b) => b.map((p) => ({ x: p.x * W, y: p.y * H, v: p.visibility == null ? 1 : p.visibility })));
      if (pr.close) pr.close();
    }
    // a little of the last frame, so points don't jitter
    const prev = last.get(stream);
    if (prev && Math.abs(prev.i - index) === 1) {
      const blend = (a, b) => a.forEach((p, i) => { if (b[i]) { p.x = p.x * 0.6 + b[i].x * 0.4; p.y = p.y * 0.6 + b[i].y * 0.4; } });
      out.faces.forEach((f, i) => { if (prev.m.faces[i] && prev.m.faces[i].length === f.length) blend(f, prev.m.faces[i]); });
      out.poses.forEach((b, i) => { if (prev.m.poses[i] && prev.m.poses[i].length === b.length) blend(b, prev.m.poses[i]); });
    }
    last.set(stream, { i: index, m: out });
    if (cache.size > 600) cache.delete(cache.keys().next().value);
    cache.set(k, out);
    return out;
  }

  /* ─── the warp: up to 16 control points; kind 0 magnifies, kind 1 pushes ─── */
  const N = 16;
  const FS = [
    "precision highp float;",
    "varying vec2 uv; uniform sampler2D tex; uniform vec2 size;",
    "uniform vec4 op[" + N + "]; uniform vec3 dr[" + N + "]; uniform int count; uniform vec2 legs;",
    "void main(){",
    "  vec2 q = uv * size;",
    "  for (int i = 0; i < " + N + "; i++) {",
    "    if (i >= count) break;",
    "    vec2 d = q - op[i].xy; float r = length(d), R = op[i].z;",
    "    if (r < R) {",
    "      float w = 1.0 - (r * r) / (R * R); w = w * w;",
    "      if (dr[i].z < 0.5) q = op[i].xy + d * (1.0 - op[i].w * w);",
    "      else q -= dr[i].xy * op[i].w * w;",
    "    }",
    "  }",
    "  if (legs.y > 0.0 && q.y > legs.x) q.y = legs.x + (q.y - legs.x) / (1.0 + legs.y);",
    "  gl_FragColor = texture2D(tex, clamp(q / size, 0.0, 1.0));",
    "}"
  ].join("\n");
  const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
  let gl = null, glCv = null, prog = null, tex = null, U = null, glBad = false;
  function setupGL() {
    if (gl || glBad) return !!gl;
    try {
      glCv = document.createElement("canvas");
      gl = glCv.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true });
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog); gl.useProgram(prog);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach((p) => gl.texParameteri(gl.TEXTURE_2D, p, gl.LINEAR));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach((p) => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
      U = { size: gl.getUniformLocation(prog, "size"), op: gl.getUniformLocation(prog, "op"), dr: gl.getUniformLocation(prog, "dr"), count: gl.getUniformLocation(prog, "count"), legs: gl.getUniformLocation(prog, "legs") };
      return true;
    } catch (e) { gl = null; glBad = true; return false; }
  }
  // ops: [{x, y, r, a, kind: 0 magnify | 1 push, dx, dy}]
  function warp(ctx, W, H, ops, legs) {
    if ((!ops.length && !(legs && legs[1] > 0)) || !setupGL()) return;
    if (glCv.width !== W) glCv.width = W;
    if (glCv.height !== H) glCv.height = H;
    gl.viewport(0, 0, W, H);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
    const op = new Float32Array(N * 4), dr = new Float32Array(N * 3);
    ops.slice(0, N).forEach((o, i) => { op.set([o.x, o.y, o.r, o.a], i * 4); dr.set([o.dx || 0, o.dy || 0, o.kind], i * 3); });
    gl.uniform2f(U.size, W, H);
    gl.uniform4fv(U.op, op);
    gl.uniform3fv(U.dr, dr);
    gl.uniform1i(U.count, Math.min(N, ops.length));
    gl.uniform2f(U.legs, legs ? legs[0] : 0, legs ? legs[1] : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.drawImage(glCv, 0, 0, W, H);
    ctx.restore();
  }

  const mid = (pts, idx) => { let x = 0, y = 0; idx.forEach((i) => { x += pts[i].x; y += pts[i].y; }); return { x: x / idx.length, y: y / idx.length }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function poly(x, pts, idx) { idx.forEach((i, k) => { if (k) x.lineTo(pts[i].x, pts[i].y); else x.moveTo(pts[i].x, pts[i].y); }); x.closePath(); }

  /* The control points for a face and a body, at the strengths asked for. */
  function faceOps(f, r) {
    const ops = [];
    const fw = dist(f[234], f[454]);   // the face's width, cheek to cheek
    if (r.eyes > 0) {
      [EYE_L, EYE_R].forEach((eye) => {
        const c = mid(f, eye), ew = dist(f[eye[0]], f[eye[8]]);
        ops.push({ x: c.x, y: c.y, r: ew * 1.3, a: 0.22 * r.eyes, kind: 0 });
      });
    }
    if (r.slim > 0) {
      const cx = (f[234].x + f[454].x) / 2;
      [[172, 136, 150], [397, 365, 379]].forEach((side) => {
        const c = mid(f, side), dir = Math.sign(cx - c.x) || 1;
        ops.push({ x: c.x, y: c.y, r: fw * 0.42, a: fw * 0.06 * r.slim, kind: 1, dx: dir, dy: 0 });
      });
    }
    return ops;
  }
  function bodyOps(b, r, W, H) {
    const ops = [];
    const ok = (i) => b[i] && b[i].v > 0.5;
    if (r.body > 0 && ok(23) && ok(24) && ok(11) && ok(12)) {
      const cx = (b[23].x + b[24].x + b[11].x + b[12].x) / 4;
      const hipW = dist(b[23], b[24]);
      // the waist, between the hips and shoulders, and the hips themselves
      [[23, 11], [24, 12]].forEach(([h, s]) => {
        const w = { x: b[h].x * 0.65 + b[s].x * 0.35, y: b[h].y * 0.65 + b[s].y * 0.35 };
        const dir = Math.sign(cx - w.x) || 1;
        ops.push({ x: w.x, y: w.y, r: hipW * 0.9, a: hipW * 0.12 * r.body, kind: 1, dx: dir, dy: 0 });
        ops.push({ x: b[h].x, y: b[h].y, r: hipW * 0.7, a: hipW * 0.08 * r.body, kind: 1, dx: dir, dy: 0 });
      });
    }
    let legs = null;
    if (r.legs > 0 && ok(23) && ok(24) && (ok(27) || ok(28))) {
      const hipY = (b[23].y + b[24].y) / 2;
      if (hipY < H * 0.9) legs = [hipY, 0.14 * r.legs];
    }
    return { ops: ops, legs: legs };
  }

  // skin: the face outline less the eyes, brows and mouth, softened
  let skinCv = null, tmpCv = null;
  function skin(ctx, W, H, faces, r) {
    if (!(r.smooth > 0 || r.whiten > 0) || !faces.length) return;
    if (!skinCv) { skinCv = document.createElement("canvas"); tmpCv = document.createElement("canvas"); }
    [skinCv, tmpCv].forEach((c) => { if (c.width !== W) c.width = W; if (c.height !== H) c.height = H; });
    const s = skinCv.getContext("2d");
    s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = "source-over"; s.filter = "none"; s.clearRect(0, 0, W, H);
    let fwMax = 0;
    faces.forEach((f) => {
      const fw = dist(f[234], f[454]); fwMax = Math.max(fwMax, fw);
      s.filter = "blur(" + (fw * 0.03).toFixed(1) + "px)";
      s.globalCompositeOperation = "source-over"; s.fillStyle = "#fff"; s.beginPath(); poly(s, f, OVAL); s.fill();
      s.globalCompositeOperation = "destination-out";
      [EYE_L, EYE_R, LIPS, BROW_L, BROW_R].forEach((p) => { s.beginPath(); poly(s, f, p); s.fill(); });
    });
    s.filter = "none";
    const t = tmpCv.getContext("2d");
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = "source-over"; t.clearRect(0, 0, W, H);
    if (r.smooth > 0) {
      t.filter = "blur(" + (fwMax * 0.018 * (0.5 + r.smooth)).toFixed(1) + "px)";
      t.drawImage(ctx.canvas, 0, 0);
      t.filter = "none";
    } else t.drawImage(ctx.canvas, 0, 0);
    if (r.whiten > 0) { t.globalCompositeOperation = "screen"; t.fillStyle = "rgba(255,248,240," + (0.22 * r.whiten).toFixed(3) + ")"; t.fillRect(0, 0, W, H); }
    t.globalCompositeOperation = "destination-in"; t.drawImage(skinCv, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = Math.min(1, 0.85 * Math.max(r.smooth, r.whiten));
    ctx.drawImage(tmpCv, 0, 0);
    ctx.restore();
  }

  function apply(ctx, W, H, key, r, opts) {
    if (!r) return false;
    if (!ready()) { if (!failed) load().catch(() => {}); return false; }
    const o = opts || {};
    const needPose = r.body > 0 || r.legs > 0;
    const m = marks(ctx.canvas, W, H, key, o.stream || "r", o.index || 0, needPose);
    const ops = [];
    m.faces.forEach((f) => faceOps(f, r).forEach((x) => ops.push(x)));
    let legs = null;
    m.poses.forEach((b) => { const bo = bodyOps(b, r, W, H); bo.ops.forEach((x) => ops.push(x)); legs = legs || bo.legs; });
    warp(ctx, W, H, ops, legs);
    skin(ctx, W, H, m.faces, r);
    return true;
  }

  global.SenotelRetouch = { load: load, ready: ready, apply: apply, failed: () => failed, _faceOps: faceOps, _bodyOps: bodyOps, _warp: warp };
})(typeof window !== "undefined" ? window : globalThis);
