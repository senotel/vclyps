/* ═══════════════════════════════════════════════════════════
   chroma.js — chroma key, green screen (ccl11, 0.42.0)
   window.SenotelChroma

   CapCut's Chroma key on an overlay: one colour (usually the green or blue
   behind a person) becomes see-through, so the person stands in front of
   the video underneath. The standard broadcast method, written here as one
   WebGL shader (no library):
     - distance from the key colour measured in chroma (Cb, Cr) only, so
       shadows and bright spots on the screen key the same;
     - Strength = how far from the colour still counts as background;
     - Edge = how softly the border fades (hair stays);
     - Spill = the green glow the screen throws on skin and hair edges,
       pulled back toward plain grey.
   A canvas fallback does the same maths when WebGL is missing.

     key(source, k) → a canvas the size of source with the key applied
       k = { color: "#rrggbb", strength 0..1, soft 0..1, spill 0..1 }
     detect(source) → "#rrggbb" of a flat green or blue border, or null
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const hex = (c) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c || "");
    const n = m ? parseInt(m[1], 16) : 0x00b140;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const toHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  // chroma of a colour (0..1 range, centred on 0)
  const cbcr = (r, g, b) => [(-0.168736 * r - 0.331264 * g + 0.5 * b) / 255, (0.5 * r - 0.418688 * g - 0.081312 * b) / 255];

  // the thresholds the shader and the fallback share
  function params(k) {
    const s = k.strength == null ? 0.5 : k.strength, soft = k.soft == null ? 0.3 : k.soft;
    const t0 = 0.02 + s * 0.22;
    return { t0: t0, t1: t0 + 0.01 + soft * 0.18, spill: k.spill == null ? 0.5 : k.spill };
  }
  // one pixel through the key: [r, g, b, a] (the tests use it, the fallback too)
  function keyPixel(r, g, b, k) {
    const P = params(k), key = hex(k.color), kc = cbcr(key[0], key[1], key[2]), c = cbcr(r, g, b);
    const d = Math.hypot(c[0] - kc[0], c[1] - kc[1]);
    const ss = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    const a = ss(P.t0, P.t1, d);
    const near = 1 - ss(P.t0, P.t1 + 0.15, d);
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const m = near * P.spill;
    return [r + (y - r) * m, g + (y - g) * m, b + (y - b) * m, a * 255];
  }

  const VS = "attribute vec2 p; varying vec2 uv; void main(){ uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }";
  const FS = [
    "precision mediump float;",
    "varying vec2 uv; uniform sampler2D tex; uniform vec2 kc; uniform float t0; uniform float t1; uniform float spill;",
    "void main(){",
    "  vec4 c = texture2D(tex, uv);",
    "  vec3 rgb = c.rgb;",
    "  vec2 cc = vec2(-0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b, 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b);",
    "  float d = distance(cc, kc);",
    "  float a = smoothstep(t0, t1, d);",
    "  float near = 1.0 - smoothstep(t0, t1 + 0.15, d);",
    "  float y = dot(rgb, vec3(0.299, 0.587, 0.114));",
    "  rgb = mix(rgb, vec3(y), near * spill);",
    "  gl_FragColor = vec4(rgb, a * c.a);",
    "}"
  ].join("\n");

  let gl = null, glCv = null, prog = null, tex = null, U = null, glFailed = false;
  function setup() {
    if (gl || glFailed || typeof document === "undefined") return !!gl;
    try {
      glCv = document.createElement("canvas");
      gl = glCv.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: true });
      if (!gl) throw new Error("no webgl");
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      U = { kc: gl.getUniformLocation(prog, "kc"), t0: gl.getUniformLocation(prog, "t0"), t1: gl.getUniformLocation(prog, "t1"), spill: gl.getUniformLocation(prog, "spill") };
      return true;
    } catch (e) { gl = null; glFailed = true; return false; }
  }

  let cpuCv = null;
  function key(source, k) {
    const W = source.width, H = source.height;
    if (!W || !H) return source;
    const P = params(k), c = hex(k.color), kc = cbcr(c[0], c[1], c[2]);
    if (setup()) {
      if (glCv.width !== W) glCv.width = W;
      if (glCv.height !== H) glCv.height = H;
      gl.viewport(0, 0, W, H);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.uniform2f(U.kc, kc[0], kc[1]);
      gl.uniform1f(U.t0, P.t0);
      gl.uniform1f(U.t1, P.t1);
      gl.uniform1f(U.spill, P.spill);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return glCv;
    }
    // no WebGL: the same maths on the processor
    if (!cpuCv) cpuCv = document.createElement("canvas");
    cpuCv.width = W; cpuCv.height = H;
    const x = cpuCv.getContext("2d");
    x.drawImage(source, 0, 0);
    const img = x.getImageData(0, 0, W, H), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const o = keyPixel(d[i], d[i + 1], d[i + 2], k);
      d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; d[i + 3] = (o[3] * d[i + 3]) / 255;
    }
    x.putImageData(img, 0, 0);
    return cpuCv;
  }

  /* A green or blue screen shows as a flat, strongly coloured border. Look
     at the outer tenth of the picture: if most of it is one saturated
     green or blue, that is the colour to key. */
  function detectPixels(d, W, H) {
    const band = Math.max(1, Math.round(Math.min(W, H) * 0.1));
    let n = 0, hits = 0, sr = 0, sg = 0, sb = 0;
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        if (x >= band && x < W - band && y >= band && y < H - band) continue;
        const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        n++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const green = g === mx && g > 70 && g - Math.max(r, b) > 40;
        const blue = b === mx && b > 70 && b - Math.max(r, g) > 40 && mx - mn > 50;
        if (green || blue) { hits++; sr += r; sg += g; sb += b; }
      }
    }
    if (!n || hits / n < 0.55) return null;
    return toHex(sr / hits, sg / hits, sb / hits);
  }
  function detect(source) {
    try {
      const W = 96, H = Math.max(8, Math.round((96 * (source.height || source.videoHeight || 96)) / (source.width || source.videoWidth || 96)));
      const cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      const x = cv.getContext("2d", { willReadFrequently: true });
      x.drawImage(source, 0, 0, W, H);
      return detectPixels(x.getImageData(0, 0, W, H).data, W, H);
    } catch (e) { return null; }
  }

  global.SenotelChroma = { key: key, keyPixel: keyPixel, detect: detect, detectPixels: detectPixels, hex: hex, toHex: toHex };
})(typeof window !== "undefined" ? window : globalThis);
