/* ═══════════════════════════════════════════════════════════
   voice-fx.js — voice effects and the voice changer (ccl9, 0.40.0)
   window.SenotelVoice

   CapCut's Voice effects: make a voice sound like a chipmunk, a monster, a
   robot, on the phone, in a cave... 16 effects, each a small chain of the
   browser's own audio nodes. The pitch effects use one pitch shifter
   written here (an AudioWorklet), so nothing is downloaded and it is free.

   The SAME chain is built in the live preview's audio graph and in the
   export's offline render, so what you hear is what the file has.

     build(ctx, id, amount) → Promise<{input, output}>  (null for "none")
   amount 0..1: how far the effect goes (pitch effects: how many
   semitones; the others: how much of the effected sound is mixed in).
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const LIST = [
    ["none", "None", ""],
    ["chipmunk", "Chipmunk", "Character"], ["elf", "Elf", "Character"], ["deep", "Deep", "Character"],
    ["monster", "Monster", "Character"], ["robot", "Robot", "Character"], ["alien", "Alien", "Character"],
    ["echo", "Echo", "Space"], ["hall", "Hall", "Space"], ["cave", "Cave", "Space"], ["underwater", "Underwater", "Space"],
    ["phone", "Phone", "Device"], ["megaphone", "Megaphone", "Device"], ["radio", "Radio", "Device"], ["lofi", "Lo-fi", "Device"],
    ["vibrato", "Vibrato", "Wobble"], ["tremolo", "Tremolo", "Wobble"]
  ];
  // semitones for the pitch effects (scaled by amount)
  const SEMI = { chipmunk: 7, elf: 4, deep: -5, monster: -9, alien: 5 };

  /* The pitch shifter's core, kept as plain code so the tests can run it
     without a browser: two read heads sweep a short delay line at the new
     speed, each faded in and out (sine-squared windows that add to one) so
     the jump back when a head wraps is never heard. */
  function pitchCore() {
    return class PitchCore {
      constructor(sampleRate, channels) {
        this.N = Math.round(sampleRate * 0.045);   // 45 ms windows: voice-friendly
        this.len = this.N * 2 + 8;
        this.buf = [];
        for (let c = 0; c < channels; c++) this.buf.push(new Float32Array(this.len));
        this.w = 0;
        this.phase = 0;
      }
      read(b, pos) {
        const L = this.len;
        let p = pos % L; if (p < 0) p += L;
        const i = Math.floor(p), f = p - i;
        return b[i] * (1 - f) + b[(i + 1) % L] * f;
      }
      // in/out: arrays of channel data (Float32Array), same length
      run(ins, outs, ratio) {
        const N = this.N, L = this.len, n = outs[0].length;
        const step = (1 - ratio) / N;
        for (let s = 0; s < n; s++) {
          for (let c = 0; c < outs.length; c++) this.buf[c][this.w] = ins[c] ? ins[c][s] || 0 : 0;
          let pa = this.phase, pb = pa + 0.5; if (pb >= 1) pb -= 1;
          const ga = Math.sin(Math.PI * pa) ** 2, gb = Math.sin(Math.PI * pb) ** 2;
          const da = pa * N + 2, db = pb * N + 2;
          for (let c = 0; c < outs.length; c++) {
            const b = this.buf[c];
            outs[c][s] = ratio === 1 ? b[this.w] : ga * this.read(b, this.w - da) + gb * this.read(b, this.w - db);
          }
          this.w = (this.w + 1) % L;
          this.phase += step;
          if (this.phase >= 1) this.phase -= 1; else if (this.phase < 0) this.phase += 1;
        }
      }
    };
  }
  const WORKLET = "const PitchCore = (" + pitchCore.toString() + ")();\n" +
    "class SenotelPitch extends AudioWorkletProcessor {\n" +
    "  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }]; }\n" +
    "  constructor() { super(); this.core = null; }\n" +
    "  process(inputs, outputs, params) {\n" +
    "    const out = outputs[0]; if (!out || !out.length) return true;\n" +
    "    if (!this.core) this.core = new PitchCore(sampleRate, out.length);\n" +
    "    this.core.run(inputs[0] || [], out, params.ratio[0]);\n" +
    "    return true;\n" +
    "  }\n" +
    "}\n" +
    "registerProcessor('senotel-pitch', SenotelPitch);\n";
  let workletUrl = null;
  const ready = new WeakMap();   // context → Promise of the module being there
  function prepare(ctx) {
    if (!ctx.audioWorklet) return Promise.resolve(false);
    if (!ready.has(ctx)) {
      if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      ready.set(ctx, ctx.audioWorklet.addModule(workletUrl).then(() => true, () => false));
    }
    return ready.get(ctx);
  }

  // a room: decaying noise, a little different in each ear (made here, no files)
  function roomIR(ctx, seconds, tone) {
    const rate = ctx.sampleRate, n = Math.round(rate * seconds), ir = ctx.createBuffer(2, n, rate);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        lp += (rnd() - lp) * tone;            // darker rooms ring softer highs
        d[i] = lp * Math.pow(1 - i / n, 3.2);
      }
    }
    return ir;
  }
  function shaper(ctx, drive) {
    const ws = ctx.createWaveShaper(), n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    ws.curve = curve;
    ws.oversample = "2x";
    return ws;
  }
  function crusher(ctx, levels) {
    const ws = ctx.createWaveShaper(), n = 4096, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.round(x * levels) / levels; }
    ws.curve = curve;
    return ws;
  }
  const filt = (ctx, type, f, q, gain) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; if (gain != null) b.gain.value = gain; return b; };
  const lfo = (ctx, hz, depth, target, live) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = hz; g.gain.value = depth;
    o.connect(g); g.connect(target); o.start(0);
    if (live) live.push(o);
    return o;
  };
  function chain(ctx, nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes; }

  async function build(ctx, id, amount) {
    if (!id || id === "none") return null;
    const k = amount == null ? 1 : Math.max(0, Math.min(1, amount));
    const input = ctx.createGain(), output = ctx.createGain();
    const live = [];   // the wobble generators, stopped when the chain is taken out
    // wet/dry for the effects that add to the voice
    const mix = (wetEnd, wetStart) => {
      const dry = ctx.createGain(), wet = ctx.createGain();
      dry.gain.value = 1 - k * 0.5; wet.gain.value = k;
      input.connect(dry); dry.connect(output);
      input.connect(wetStart || wetEnd); wetEnd.connect(wet); wet.connect(output);
    };
    // replace the voice (the device and wobble effects): fade from clean to fully effected
    const swap = (first, last) => {
      const dry = ctx.createGain(), wet = ctx.createGain();
      dry.gain.value = 1 - k; wet.gain.value = k;
      input.connect(dry); dry.connect(output);
      input.connect(first); last.connect(wet); wet.connect(output);
    };
    const pitch = async (semi) => {
      if (!(await prepare(ctx))) return null;
      const node = new AudioWorkletNode(ctx, "senotel-pitch", { outputChannelCount: [2] });
      node.parameters.get("ratio").value = Math.pow(2, (semi * k) / 12);
      return node;
    };
    switch (id) {
      case "chipmunk": case "elf": case "deep": {
        const p = await pitch(SEMI[id]);
        if (!p) { input.connect(output); break; }
        if (id === "deep") chain(ctx, [input, p, filt(ctx, "lowshelf", 220, null, 3), output]);   // a little more chest
        else chain(ctx, [input, p, output]);
        break;
      }
      case "monster": {
        const p = await pitch(SEMI.monster);
        const d = shaper(ctx, 1.6), lows = filt(ctx, "lowshelf", 180, null, 5), g = ctx.createGain();
        g.gain.value = 0.8;
        if (p) chain(ctx, [input, p, d, lows, g, output]); else chain(ctx, [input, d, lows, g, output]);
        break;
      }
      case "robot": {
        // ring modulation, then a short metal comb
        const ring = ctx.createGain(); ring.gain.value = 0;
        lfo(ctx, 70, 1, ring.gain, live);
        const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.008;
        const fb = ctx.createGain(); fb.gain.value = 0.45;
        const sum = ctx.createGain(); sum.gain.value = 1.6;
        ring.connect(sum); ring.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(sum);
        swap(ring, sum);
        break;
      }
      case "alien": {
        const p = await pitch(SEMI.alien);
        const ring = ctx.createGain(); ring.gain.value = 0.5;
        lfo(ctx, 31, 0.5, ring.gain, live);
        const g = ctx.createGain(); g.gain.value = 1.3;
        if (p) chain(ctx, [input, p, ring, g, output]); else chain(ctx, [input, ring, g, output]);
        break;
      }
      case "echo": {
        const dl = ctx.createDelay(1); dl.delayTime.value = 0.28;
        const fb = ctx.createGain(); fb.gain.value = 0.42;
        const tone = filt(ctx, "lowpass", 3800, 0.7);
        dl.connect(tone); tone.connect(fb); fb.connect(dl);
        mix(dl);
        break;
      }
      case "hall": case "cave": {
        const cv = ctx.createConvolver();
        cv.buffer = roomIR(ctx, id === "hall" ? 1.9 : 3.6, id === "hall" ? 0.55 : 0.25);
        const g = ctx.createGain(); g.gain.value = id === "hall" ? 0.55 : 0.75;
        cv.connect(g);
        if (id === "cave") {
          const pre = ctx.createDelay(0.2); pre.delayTime.value = 0.06;
          pre.connect(cv);
          mix(g, pre);
        } else mix(g, cv);
        break;
      }
      case "underwater": {
        const lp = filt(ctx, "lowpass", 480, 1.2);
        const dl = ctx.createDelay(0.1); dl.delayTime.value = 0.02;
        lfo(ctx, 0.35, 0.006, dl.delayTime, live);
        const g = ctx.createGain(); g.gain.value = 1.4;
        chain(ctx, [lp, dl, g]);
        swap(lp, g);
        break;
      }
      case "phone": {
        const a = filt(ctx, "highpass", 420, 0.9), b = filt(ctx, "lowpass", 3000, 0.9), d = shaper(ctx, 2.2), g = ctx.createGain();
        g.gain.value = 1.2;
        chain(ctx, [a, b, d, g]);
        swap(a, g);
        break;
      }
      case "megaphone": {
        const a = filt(ctx, "highpass", 700, 0.8), p = filt(ctx, "peaking", 2000, 1.1, 9), b = filt(ctx, "lowpass", 4500, 0.8), d = shaper(ctx, 5), g = ctx.createGain();
        g.gain.value = 0.7;
        chain(ctx, [a, p, b, d, g]);
        swap(a, g);
        break;
      }
      case "radio": {
        const a = filt(ctx, "highpass", 260, 0.7), p = filt(ctx, "peaking", 1600, 0.8, 5), b = filt(ctx, "lowpass", 5200, 0.7), d = shaper(ctx, 1.8);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -28; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.12;
        const g = ctx.createGain(); g.gain.value = 0.85;
        chain(ctx, [a, p, b, d, comp, g]);
        swap(a, g);
        break;
      }
      case "lofi": {
        const a = filt(ctx, "highpass", 150, 0.7), b = filt(ctx, "lowpass", 3200, 0.7), c = crusher(ctx, 24);
        chain(ctx, [a, b, c]);
        swap(a, c);
        break;
      }
      case "vibrato": {
        const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.006;
        lfo(ctx, 5.6, 0.0025, dl.delayTime, live);
        swap(dl, dl);
        break;
      }
      case "tremolo": {
        const g = ctx.createGain(); g.gain.value = 0.65;
        lfo(ctx, 6.5, 0.35, g.gain, live);
        swap(g, g);
        break;
      }
      default: input.connect(output);
    }
    return { input: input, output: output, stop: () => live.forEach((o) => { try { o.stop(); } catch (e) {} }) };
  }

  const nameOf = (id) => { const e = LIST.find((x) => x[0] === id); return e ? e[1] : ""; };
  global.SenotelVoice = { LIST: LIST, SEMI: SEMI, build: build, prepare: prepare, nameOf: nameOf, pitchCore: pitchCore };
})(typeof window !== "undefined" ? window : globalThis);
