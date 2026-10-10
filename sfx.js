/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — sound effects
   The editing app by Vevris.

   ── RECORDINGS FIRST (0.25.0) ─────────────────────────────────────────────
   Twenty short-form sound effects, each a REAL RECORDING released as CC0
   (public domain: commercial use, no credit owed) on Freesound, picked on
   2026-10-08 by downloads and rating, then checked by measurement: no
   clipping, a clean noise floor, a body that starts where it should. Each
   one is trimmed, faded and levelled here (see RECORDED below), so a file is
   used exactly as it was published and nothing had to be re-encoded.

   Why: the owner listened to the synthesised set on 2026-10-08 and called
   it "completely horrible, it sounds nothing like the real ones". He was
   right, and the reason is in the section below: a listener knows an
   airhorn, applause or a record scratch as a RECORDING, and no oscillator
   reproduces a particular recording. The 2026-08-22 decision to close that
   gap with better synthesis was tried and failed.

   The synthesised voices below are kept ONLY as a fallback for the first
   ten, for a device that is offline before the recordings have loaded. The
   ten added in 0.25.0 have no fallback.

   Licensing: CC0 only, checked on each sound's own page, and nothing whose
   title points at a meme, a show or a brand, because those are often
   someone else's recording re-uploaded under a label that is not theirs to
   give. Credit is not required; RECORDED keeps the author and page anyway.

   ── THE OLD SYNTHESIS, AND WHERE IT RAN OUT ────────────────────────────────
   Synthesis is not a compromise for most of these. An 808 boom IS a sine
   sweep; so are the sub drop, the riser's tone layer, the coin and the ding.
   Those are how the real ones are made too.

   It runs out for sounds the listener knows as a RECORDING — air moving past
   a microphone in a real room. The owner judged the set on 2026-08-22 and
   named WHOOSH and RISER as the two that miss.

   The decision was to close that gap with better synthesis rather than by
   downloading files. Both were rebuilt, but NOT the same way — they fail for
   different reasons, and the second attempt at the riser is where that became
   obvious.

   WHOOSH is a recording of AIR, so it was rebuilt around what makes air
   sound real:
     PINK NOISE, not white — white puts half its energy in the top octave and
       comes out as hiss, which is precisely the complaint. Real air is pink.
     A ROOM — every recorded effect was captured in a space, and the ear reads
       perfectly dry as fake long before it can say why. A ConvolverNode fed a
       generated impulse response costs nothing and no file.
     IRREGULARITY — real air flutters, so a perfectly smooth envelope is a
       tell. The whoosh wobbles as it passes.

   RISER is not a recording of anything. It is a PRODUCED sound — every one
   you have heard was built in a DAW from noise and a filter — so the target
   is not realism, it is the production recipe. The first rebuild missed by
   treating it like the whoosh: pink noise through a high-Q bandpass, which
   gives noise a voice and turns a build into a siren. See riser() for what
   it does now. White noise, a 24dB lowpass sweep, unison rather than octaves,
   and a dip before the cut.

   ── USING IT ───────────────────────────────────────────────────────────────
     VevrisSFX.prepare();                 // fetch and decode the recordings (once)
     VevrisSFX.ready(["boom"]);           // a Promise, for the export to wait on
     VevrisSFX.play("boom");
     VevrisSFX.play("whoosh", { ctx: audioCtx, dest: audioDest, when: t, gain: 0.8 });

   `dest` is the one that matters for the editor. app.js already builds
   ensureAudioGraph(): the preview element feeds ctx.destination (speakers) AND
   a MediaStreamDestination that MediaRecorder captures. Handing that same
   destination node in as `dest` is the whole of "put this sound in the
   exported file" — extra sources just mix into a graph that already exists, so
   nothing about the exporter has to change.

   ── WHY THE LOW SOUNDS ARE DISTORTED ON PURPOSE ────────────────────────────
   A phone speaker physically cannot move air at 38Hz. A pure sine down there
   is silence on the device this content is actually watched on. So the low
   voices run through soft saturation and carry deliberate harmonics: the ear
   reconstructs a missing fundamental from its overtones and hears a boom the
   speaker never produced. Take the saturation out and the sound dies on every
   phone.

   ── LEVELS ─────────────────────────────────────────────────────────────────
   Each voice is built to peak near 1.0 internally, then a per-sound `level`
   trims it so the ten sit at a comparable loudness and the sum stays under the
   output's clipping point. There is deliberately no compressor in the chain: a
   fast compressor across a 38Hz sub distorts it rather than controlling it,
   and arithmetic we can predict beats a black box nobody here can hear.

   Exposes window.VevrisSFX.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* Scheduling a hair into the future rather than at currentTime: nodes told
     to start exactly "now" are already late by the time the graph runs, and
     that lateness is audible as a click on the attack. */
  var LOOKAHEAD = 0.02;

  /* exponentialRampToValueAtTime cannot reach zero — it throws. Envelopes ramp
     to this instead, and a final linear step closes the last hair to silence. */
  var TINY = 0.00012;

  /* ═══════════ RECORDED ═══════════
     name: [Freesound id, preview path, trim start, trim end, fade-out,
            level, author, fade-in]
       · trim start/end are seconds into the published file: the silence
         before the sound and the part of a long tail nobody needs are cut
       · fade-out is the seconds over which the cut end is faded, so it
         never clicks; 0.012 on the riser, which is meant to stop dead
       · level brings each to the same LOUDNESS, measured the way broadcast
         meters do it (bass rolled off, as a phone speaker hears it, over
         400ms blocks), with the peak kept under 0.9
       · fade-in, where given, is a slow cosine swell over that many
         seconds, for a sound cut out of the middle of a build (the riser);
         without it the cut start gets the usual few milliseconds
     Measured 2026-10-08. Change a trim and `hit` below has to be measured
     again: it is where the sound lands, in seconds from the trim start.

     Replaced 2026-10-09 after the owner listened (riser, sparkle, drum
     roll "don't sound quite right", the drum roll's end "kinda weird"):
       · the old riser only got LOUDER: its pitch sat at ~2.4kHz from start
         to end, so it swelled without rising. The new one is a noise
         uplifter whose brightness climbs ~2kHz → 7.7kHz into a dead stop.
       · the old sparkle was a dull ~2kHz pad recorded very quietly (level
         11.7, so its noise was lifted with it). The new one is a bright
         chime cascade (~8kHz) that starts at once and decays cleanly.
       · the old drum roll never built (flat level) and ended on a thin
         ~7kHz splash with a hiss tail. The new one is a real snare roll
         (Ludwig snare, 16" K Dark crash, recorded by zemidlo) that
         crescendos ~28dB into the crash and rings out to silence. */
  var CDN = "https://cdn.freesound.org/previews/";
  var RECORDED = {
    boom:        [201571, "201/201571_1535323-hq.mp3", 0, 2.9, 0.7, 0.909, "Julien_Matthey"],
    whoosh:      [486234, "486/486234_7254895-hq.mp3", 0, 0.44, 0.08, 1.364, "BennettFilmTeacher"],
    riser:       [204758, "204/204758_1897295-hq.mp3", 4.39, 7.38, 0.012, 0.736, "maqsim", 0.5],
    subdrop:     [212768, "212/212768_71257-hq.mp3", 0, 3.0, 0.9, 0.532, "qubodup, after pepe2"],
    pop:         [202230, "202/202230_3725006-hq.mp3", 0.15, 0.46, 0.04, 1.659, "deraj"],
    ding:        [611113, "611/611113_1629501-hq.mp3", 0.04, 1.6, 0.3, 0.659, "5ro4"],
    buzz:        [648462, "648/648462_11771918-hq.mp3", 0, 1.06, 0.05, 0.453, "-Andreas"],
    airhorn:     [528807, "528/528807_3482490-hq.mp3", 0, 2.0, 0.12, 0.766, "pfranzen"],
    sparkle:     [462095, "462/462095_6142149-hq.mp3", 0, 2.2, 0.5, 0.638, "LilMati"],
    coin:        [402067, "402/402067_6142149-hq.mp3", 0, 0.446, 0.03, 0.524, "LilMati"],
    scratch:     [71853, "71/71853_1062668-hq.mp3", 0.02, 0.448, 0.04, 0.666, "ludvique"],
    rimshot:     [713649, "713/713649_14535773-hq.mp3", 0, 2.4, 0.6, 1.5, "Vein_Adams"],
    sadtrombone: [175409, "175/175409_1326576-hq.mp3", 0.18, 5.0, 0.35, 0.779, "kirbydx"],
    crickets:    [829810, "829/829810_17988013-hq.mp3", 0.46, 3.1, 0.5, 6.834, "Attia.phonatics"],
    applause:    [221567, "221/221567_1282865-hq.mp3", 0, 4.6, 1.4, 0.514, "AlaskaRobotics"],
    laugh:       [403058, "403/403058_6094808-hq.mp3", 0.27, 3.6, 0.9, 0.905, "wrc4all"],
    shutter:     [270435, "270/270435_3177988-hq.mp3", 0, 0.16, 0.01, 0.9, "chrisvink"],
    kaching:     [209578, "209/209578_2558531-hq.mp3", 0.08, 2.3, 0.5, 0.762, "Zott820, after CapsLok"],
    drumroll:    [165523, "165/165523_1080202-hq.mp3", 6.03, 12.4, 1.4, 1.183, "zemidlo", 0.45],
    gasp:        [324898, "324/324898_2104797-hq.mp3", 0.55, 2.4, 0.5, 0.796, "a Freesound member, account since deleted"]
  };

  /* Where the files come from. BUNDLED false: Freesound's own CDN, which
     sends CORS headers (the music library already depends on it), so the
     decoded audio reaches the export. BUNDLED true: copies kept beside the
     app in sfx/, named by sound, which also works offline from the first
     use and inside an app with no network. A relative path either way, so it
     works wherever the files are (see platform.js). */
  var BUNDLED = false;
  function fileFor(name) {
    var r = RECORDED[name];
    return BUNDLED ? "sfx/" + name + ".mp3" : CDN + r[1];
  }

  /* ═══════════ AUDIO CONTEXT ═══════════ */

  var shared = null, warned = false;

  function Ctor() {
    return global.AudioContext || global.webkitAudioContext || null;
  }

  /* The shared context is lazy on purpose: building one at page load leaves a
     suspended context on every visit, including the visits that never play a
     sound. The editor passes its own context in anyway — this is for the
     soundboard and for standalone use. */
  function context() {
    var C = Ctor();
    if (!C) {
      if (!warned) { warned = true; try { console.warn("VevrisSFX: no Web Audio in this browser"); } catch (e) {} }
      return null;
    }
    if (!shared) { try { shared = new C(); } catch (e) { return null; } }
    return shared;
  }

  /* Mobile browsers hold every context suspended until a user gesture. Call
     this from a click handler once and scheduling behaves normally after. */
  function unlock(ctx) {
    ctx = ctx || context();
    if (ctx && ctx.state === "suspended" && ctx.resume) { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  /* ═══════════ SMALL DSP TOOLKIT ═══════════ */

  /* One noise buffer per context, shared by every voice that needs noise. Two
     seconds is long enough that no effect here ever hears it loop, and each
     source reads from a different offset so two layers are uncorrelated —
     correlated noise sums into a comb filter and sounds like a phaser. */
  var noiseCache = [];

  /* WHITE vs PINK, and it matters more than anything else in here.

     White noise has equal energy per Hz, so half of it lives in the top
     octave. Hearing is roughly logarithmic, so white noise sounds like HISS —
     which is exactly what a synthesised whoosh gets accused of. Pink noise
     falls 3dB per octave, which is the spectrum of nearly everything in the
     physical world: wind, breath, waves, air moving past your ear. Anything
     meant to sound like real air is built on pink; white is for transients and
     the top-end sparkle where the brightness is the point. */
  function noiseBuffer(ctx, pink) {
    var slot = null;
    for (var i = 0; i < noiseCache.length; i++) if (noiseCache[i].ctx === ctx) slot = noiseCache[i];
    if (!slot) { slot = { ctx: ctx, white: null, pink: null }; noiseCache.push(slot); }
    var key = pink ? "pink" : "white";
    if (slot[key]) return slot[key];

    var len = Math.floor(ctx.sampleRate * 2);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);

    /* Seeded, not Math.random: the export re-plays the timeline in real time,
       so a sound that comes out different the second time is a bug waiting to
       be reported as one. Everything in this file is reproducible. */
    var s = (pink ? 0x51f3a7 : 0x2f6e2b1) >>> 0;
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, peak = 0;

    for (var j = 0; j < len; j++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      var w = (s / 2147483648) - 1;
      if (!pink) { d[j] = w; continue; }
      /* Paul Kellet's filter bank — six one-pole sections summed, the cheapest
         thing that holds a true -3dB/octave slope across the audible range. */
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      var p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      d[j] = p;
      var a = p < 0 ? -p : p;
      if (a > peak) peak = a;
    }
    /* The filter bank has no defined output level, so scale it to sit where
       the white buffer sits and every gain downstream stays comparable. */
    if (pink && peak > 0) { var k = 0.9 / peak; for (var m = 0; m < len; m++) d[m] *= k; }

    slot[key] = buf;
    return buf;
  }

  /* A reverb tail, built rather than loaded.

     This is the single biggest "sounds real" upgrade available for free. Every
     recorded sound effect was captured in a space; a synthesised one is
     perfectly dry, and the ear reads perfectly dry as fake long before it can
     say why. A ConvolverNode fed a procedurally generated impulse response —
     decaying noise, darkening as it falls, exactly what a room does — puts the
     sound somewhere. No file, no download, a few KB of arithmetic. */
  var irCache = [];
  function impulse(ctx, seconds, decay) {
    var key = seconds + "/" + decay;
    for (var i = 0; i < irCache.length; i++) {
      if (irCache[i].ctx === ctx && irCache[i].key === key) return irCache[i].buf;
    }
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    var s = 0x7a1c93 >>> 0;
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0;
      for (var j = 0; j < len; j++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        var n = (s / 2147483648) - 1;
        /* The tail gets darker as it decays — air and soft surfaces absorb
           treble first, so a tail that stays bright sounds like a spring, not
           a room. */
        lp += (n - lp) * (0.85 - 0.55 * (j / len));
        d[j] = lp * Math.pow(1 - j / len, decay);
      }
    }
    irCache.push({ ctx: ctx, key: key, buf: buf });
    return buf;
  }

  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* tanh soft clip, normalised so full scale in is full scale out. WaveShaper
     clamps its input to ±1 before the lookup, so anything past that folds onto
     the endpoint — which makes this a hard ceiling as well as a saturator. */
  var curves = {};
  function satCurve(k) {
    var key = String(k);
    if (curves[key]) return curves[key];
    var n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    curves[key] = c;
    return c;
  }

  function chain() {
    for (var i = 0; i < arguments.length - 1; i++) arguments[i].connect(arguments[i + 1]);
    return arguments[arguments.length - 1];
  }

  /* Linear breakpoints — for amplitude, where the ear wants an even swell.
     Points are [secondsFromStart, value]. */
  function ramp(p, t0, pts) {
    p.cancelScheduledValues(t0);
    p.setValueAtTime(pts[0][1], t0 + pts[0][0]);
    for (var i = 1; i < pts.length; i++) p.linearRampToValueAtTime(pts[i][1], t0 + pts[i][0]);
    return t0 + pts[pts.length - 1][0];
  }

  /* Exponential breakpoints — for pitch and cutoff, which are heard
     logarithmically. A linear sweep from 200Hz to 8kHz spends almost all of
     its time in the top octave and sounds like it jumps. */
  function sweep(p, t0, pts) {
    p.cancelScheduledValues(t0);
    p.setValueAtTime(Math.max(pts[0][1], TINY), t0 + pts[0][0]);
    for (var i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(Math.max(pts[i][1], TINY), t0 + pts[i][0]);
    return t0 + pts[pts.length - 1][0];
  }

  /* Percussive envelope: near-instant attack, exponential decay. Exponential
     decay is what a struck object does; a linear one sounds like a fade-out. */
  function env(p, t0, peak, attack, hold, decay) {
    var top = Math.max(peak, TINY), d0 = t0 + attack + hold, endT = d0 + decay;
    p.cancelScheduledValues(t0);
    p.setValueAtTime(TINY, t0);
    p.exponentialRampToValueAtTime(top, t0 + attack);
    if (hold > 0) p.setValueAtTime(top, d0);
    p.exponentialRampToValueAtTime(TINY, endT);
    p.linearRampToValueAtTime(0, endT + 0.006);
    return endT + 0.006;
  }

  /* ═══════════ VOICE ═══════════
     One playing sound. Builders ask it for nodes; it remembers every source so
     play() can start and stop them, and remembers how long the sound runs so
     the graph is torn down at the right moment and not a second early. */

  function Voice(ctx, t0, out) {
    this.ctx = ctx;
    this.t0 = t0;
    this.out = out;
    this.src = [];     // { n, a, off }
    this.end = t0;
    this._n = 0;
  }

  Voice.prototype.until = function (t) { if (t > this.end) this.end = t; return t; };

  Voice.prototype.osc = function (type, freq, at) {
    var o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this.src.push({ n: o, a: at == null ? this.t0 : at });
    return o;
  };

  /* Pink noise — for anything meant to sound like real air. See noiseBuffer(). */
  Voice.prototype.pink = function (at) {
    var s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx, true);
    s.loop = true;
    this.src.push({ n: s, a: at == null ? this.t0 : at, off: (this._n++ * 0.371) % 1.9 });
    return s;
  };

  /* A room to put the sound in. Returns null where ConvolverNode is missing,
     and every caller treats that as "stay dry" rather than failing — a drier
     whoosh is still a whoosh. */
  Voice.prototype.verb = function (seconds, decay) {
    if (!this.ctx.createConvolver) return null;
    try {
      var c = this.ctx.createConvolver();
      c.buffer = impulse(this.ctx, seconds, decay);
      return c;
    } catch (e) { return null; }
  };

  Voice.prototype.noise = function (at) {
    var s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx);
    s.loop = true;
    this.src.push({ n: s, a: at == null ? this.t0 : at, off: (this._n++ * 0.371) % 1.9 });
    return s;
  };

  Voice.prototype.gain = function (v) {
    var g = this.ctx.createGain();
    g.gain.value = v == null ? 1 : v;
    return g;
  };

  Voice.prototype.filter = function (type, freq, q) {
    var f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q != null) f.Q.value = q;
    return f;
  };

  Voice.prototype.sat = function (k) {
    var w = this.ctx.createWaveShaper();
    w.curve = satCurve(k);
    w.oversample = "4x";   // without this the harmonics it adds alias back down as buzz
    return w;
  };

  /* Stereo movement, with a mono passthrough where StereoPanner is missing
     (older Safari). Returning a real node either way keeps the builders free
     of feature checks. */
  Voice.prototype.pan = function (from, to, at, dur) {
    if (!this.ctx.createStereoPanner) return this.gain(1);
    var p = this.ctx.createStereoPanner();
    p.pan.setValueAtTime(from, at);
    if (dur > 0) p.pan.linearRampToValueAtTime(to, at + dur);
    return p;
  };

  /* ═══════════════════════════════════════════════════════════════════════
     THE TEN VOICES

     Each builder wires its nodes into v.out and calls v.until() with the
     moment it falls silent. Everything else — starting sources, stopping
     them, disconnecting — is play()'s job.
     ═══════════════════════════════════════════════════════════════════════ */

  /* BOOM — the cinematic low hit, for a reveal or a hard cut.
     Three layers doing three different jobs:
       sub        the weight itself, 110Hz sliding down to 38Hz
       harmonic   an octave-and-a-bit above the sub, so a speaker that cannot
                  reproduce 38Hz still tells the ear a 38Hz note happened
       thump      90ms of filtered noise: the air of the hit landing, which is
                  what stops it sounding like a test tone
     Sub and harmonic share a saturator, both for the extra harmonics and
     because it hard-limits the pair to ±1 no matter how they line up. */
  function boom(v) {
    var t = v.t0, sat = v.sat(2.6), bus = v.gain(1);
    chain(sat, bus, v.out);

    var sub = v.osc("sine", 110);
    sweep(sub.frequency, t, [[0, 110], [0.45, 38]]);
    var sg = v.gain(0);
    env(sg.gain, t, 0.95, 0.006, 0.02, 1.25);
    chain(sub, sg, sat);

    var h = v.osc("triangle", 220);
    sweep(h.frequency, t, [[0, 220], [0.45, 76]]);
    var hg = v.gain(0);
    env(hg.gain, t, 0.24, 0.004, 0, 0.5);
    chain(h, hg, sat);

    var n = v.noise(), nf = v.filter("bandpass", 160, 0.9), ng = v.gain(0);
    env(ng.gain, t, 0.5, 0.002, 0, 0.09);
    chain(n, nf, ng, bus);

    v.until(t + 1.4);
  }

  /* WHOOSH — a transition, or motion under a cut.
     Band-limited noise sweeping up then falling away, panned across the
     stereo field. The second layer is a much narrower band running slightly
     ahead of the first: that thin whistle is what makes a whoosh read as
     something MOVING rather than as a burst of hiss. */
  function whoosh(v) {
    var t = v.t0, D = 0.78;

    /* Everything goes through one panner so the whole object moves together,
       then a send into a short room. The reverb is what stops this reading as
       "a filter sweep on a noise generator" — see impulse(). */
    var pan = v.pan(-0.7, 0.7, t, D);
    pan.connect(v.out);
    var wet = v.verb(0.7, 2.6);
    if (wet) { var send = v.gain(0.34); chain(pan, send, wet, v.out); }

    /* BODY. Pink, not white — half of white noise's energy sits in the top
       octave and comes out as hiss. A resonant lowpass opening and shutting
       is what "past your ear" actually sounds like; a plain bandpass is what
       a synthesiser sounds like. */
    var n = v.pink();
    var lp = v.filter("lowpass", 380, 4.5);
    sweep(lp.frequency, t, [[0, 380], [D * 0.55, 5200], [D, 700]]);
    var hp = v.filter("highpass", 140, 0.7);
    var flut = v.gain(0.85);
    var g = v.gain(0);
    ramp(g.gain, t, [[0, 0], [D * 0.58, 0.75], [D, 0]]);
    chain(n, lp, hp, flut, g, pan);

    /* TURBULENCE. Air is never smooth. A perfectly even envelope is the
       giveaway that a sound came out of an oscillator, so the body gets a
       wobble that speeds up as the thing passes. */
    var flo = v.osc("sine", 11), fAmt = v.gain(0.15);
    sweep(flo.frequency, t, [[0, 11], [D, 27]]);
    chain(flo, fAmt, flut.gain);

    /* WHISTLE. A narrow resonance running slightly ahead of the body — this
       is the layer that reads as movement rather than as noise. */
    var n2 = v.pink();
    var bp = v.filter("bandpass", 800, 9);
    sweep(bp.frequency, t, [[0, 800], [D * 0.5, 4800], [D, 1500]]);
    var g2 = v.gain(0);
    ramp(g2.gain, t, [[0, 0], [D * 0.5, 0.22], [D, 0]]);
    chain(n2, bp, g2, pan);

    /* WEIGHT. Without a low layer the whole thing lives above 1kHz and sounds
       like a hi-hat opening. */
    var n3 = v.pink();
    var lp3 = v.filter("lowpass", 300, 1.2);
    var g3 = v.gain(0);
    ramp(g3.gain, t, [[0, 0], [D * 0.6, 0.3], [D, 0]]);
    chain(n3, lp3, g3, pan);

    v.until(t + D + (wet ? 0.7 : 0.06));
  }

  /* RISER — the build before a drop or a punchline.

     Rebuilt 2026-09-05. The first version whistled: it ran pink noise through
     a bandpass at Q 5.5, and a narrow resonant band does not sound like a
     riser, it sounds like a siren. High Q gives noise a VOICE, which is
     exactly wrong here — a riser is meant to be broadband and featureless,
     getting brighter and wider until it stops. This follows the way they are
     actually produced instead:

       WHITE noise, not pink   the top octave is the point; pink is for air
       LOWPASS, not bandpass   24dB (two stages), ~140Hz opening to ~11kHz
       one to two octaves      not the six-fold climb, which reads as a siren
       unison, not octaves     five saws on ONE note, detuned in cents
       a long room             2.6s of tail, not 1.0
       peak, dip, cut          -3dB right before the end, then dead silence

     The dip is the least obvious and does the most work: dropping the level
     just before the cut makes whatever lands next hit harder, because the ear
     measures the drop against where the riser left off rather than against
     its own peak. */
  function riser(v) {
    var t = v.t0, D = 2.80;

    var bus = v.gain(1);
    bus.connect(v.out);
    /* Long and fairly wet. The tail grows as the riser climbs, which is most
       of why a build feels like it is filling a space rather than just getting
       louder — and it keeps ringing through the cut, so the silence at the end
       is a room emptying rather than a switch being thrown. */
    var wet = v.verb(2.6, 2.0);
    if (wet) { var send = v.gain(0.30); chain(bus, send, wet, v.out); }

    /* The pulse, 3Hz to 14Hz, and its DEPTH opens up as it accelerates —
       barely there at the start, unmistakable by the end. Fixed-depth tremolo
       announces itself immediately and stops meaning anything.
       Past ~16Hz a tremolo stops being rhythm and becomes a buzz, which is
       why this tops out where it does.
       It rides its own node rather than the amplitude ramp, because added onto
       a ramp that starts at zero it would swing the gain negative, and a gain
       crossing zero inverts phase instead of going quiet. */
    var trem = v.gain(0.78);
    trem.connect(bus);
    var lfo = v.osc("triangle", 3), amt = v.gain(0.06);
    sweep(lfo.frequency, t, [[0, 3], [D, 14]]);
    ramp(amt.gain, t, [[0, 0.06], [D, 0.34]]);
    chain(lfo, amt, trem.gain);

    /* THE NOISE — this is the riser. Everything else supports it.
       Two lowpass stages in series make a 24dB slope; a single 12dB pole
       leaves too much bottom in and the sweep reads as a wash rather than as
       something opening. The second stage carries the resonance. */
    var n = v.noise();                                   // white
    var hp = v.filter("highpass", 150, 0.7);             // keeps the low end for the sub
    var lp1 = v.filter("lowpass", 140, 0.6);
    var lp2 = v.filter("lowpass", 140, 2.0);
    sweep(lp1.frequency, t, [[0, 140], [D, 11000]]);
    sweep(lp2.frequency, t, [[0, 140], [D, 11000]]);

    /* Exponential swell — roughly -34dB to -3dB. A linear ramp spends its
       first half already audible and its second half barely changing, which is
       the opposite of the shape tension has. Written out rather than through
       ramp()/sweep() because it needs both curves: exponential up, then linear
       through the dip and into the cut, and those helpers each clear the
       schedule before writing. */
    var ng = v.gain(0);
    ng.gain.cancelScheduledValues(t);
    ng.gain.setValueAtTime(0.02, t);
    ng.gain.exponentialRampToValueAtTime(0.72, t + D * 0.93);
    ng.gain.linearRampToValueAtTime(0.51, t + D * 0.99);   // the dip
    ng.gain.linearRampToValueAtTime(0, t + D + 0.02);      // dead cut
    chain(n, hp, lp1, lp2, ng, trem);

    /* THE CLIMB, underneath. Five saws on ONE note detuned within 14 cents,
       not three an octave apart: unison is a thickness, octaves are a melody,
       and a riser must not have a melody. An octave and a half of rise is
       plenty — the six-fold sweep the old one used is what a siren does. */
    var saws = v.gain(0.18), slp = v.filter("lowpass", 400, 1.0), sg = v.gain(0);
    sweep(slp.frequency, t, [[0, 400], [D, 7000]]);
    sg.gain.cancelScheduledValues(t);
    sg.gain.setValueAtTime(0.01, t);
    sg.gain.exponentialRampToValueAtTime(0.30, t + D * 0.93);
    sg.gain.linearRampToValueAtTime(0.21, t + D * 0.99);
    sg.gain.linearRampToValueAtTime(0, t + D + 0.02);
    chain(saws, slp, sg, trem);
    var cents = [-14, -7, 0, 7, 14];
    for (var k = 0; k < cents.length; k++) {
      var o = v.osc("sawtooth", 110);
      o.detune.value = cents[k];
      sweep(o.frequency, t, [[0, 110], [D, 311]]);       // A2 → D#4, an octave and a half
      o.connect(saws);
    }

    /* WEIGHT. A sub that swells in LEVEL rather than pitch, so the build has
       a floor without a second thing competing for the ear's attention. It
       bypasses the tremolo — a pulsing sub sounds like a fault. */
    var sub = v.osc("sine", 41);
    sweep(sub.frequency, t, [[0, 41], [D, 55]]);
    var subg = v.gain(0);
    ramp(subg.gain, t, [[0, 0], [D * 0.93, 0.46], [D, 0.34], [D + 0.02, 0]]);
    chain(sub, subg, bus);

    v.until(t + D + (wet ? 2.6 : 0.06));
  }

  /* SUBDROP — the 808 slide under a reveal or a reaction.
     Same missing-fundamental trick as boom but slower and deeper: 170Hz down
     to 31Hz over three quarters of a second, with a third harmonic that fades
     out as the slide finishes so small speakers hear the fall happen even
     though they never reproduce where it lands. */
  function subdrop(v) {
    var t = v.t0, D = 1.5, sat = v.sat(3.2);
    chain(sat, v.out);

    var s = v.osc("sine", 170);
    sweep(s.frequency, t, [[0, 170], [0.75, 31]]);
    var g = v.gain(0);
    ramp(g.gain, t, [[0, 0], [0.006, 1], [0.75, 0.9], [D, 0]]);
    chain(s, g, sat);

    var h = v.osc("sine", 510);
    sweep(h.frequency, t, [[0, 510], [0.75, 93]]);
    var hg = v.gain(0);
    ramp(hg.gain, t, [[0, 0], [0.006, 0.32], [0.6, 0.06], [D, 0]]);
    chain(h, hg, sat);

    v.until(t + D + 0.05);
  }

  /* POP — a caption appearing, an emoji landing, a bullet arriving.
     A sine falling an octave and a half in 55ms. The 20ms of top end over it
     is what separates a pop from a beep. */
  function pop(v) {
    var t = v.t0;
    var s = v.osc("sine", 1000);
    sweep(s.frequency, t, [[0, 1000], [0.055, 190]]);
    var g = v.gain(0);
    env(g.gain, t, 0.9, 0.0015, 0, 0.1);
    chain(s, g, v.out);

    var n = v.noise(), hp = v.filter("highpass", 1800, 0.7), ng = v.gain(0);
    env(ng.gain, t, 0.22, 0.001, 0, 0.02);
    chain(n, hp, ng, v.out);

    v.until(t + 0.14);
  }

  /* DING — a notification, a tick, a point being made.
     The partials are the whole trick. A bell's overtones are INHARMONIC —
     2.00, 2.76, 5.40, 8.93 times the fundamental rather than 2, 3, 4 — and
     the high ones die first. Stack plain harmonics instead and it comes out
     as an organ. */
  var BELL = [[1, 1, 1], [2.0, 0.42, 0.7], [2.76, 0.3, 0.55], [5.4, 0.14, 0.35], [8.93, 0.07, 0.22]];
  function ding(v) {
    var t = v.t0, base = 880, D = 1.5;
    for (var i = 0; i < BELL.length; i++) {
      var p = BELL[i];
      var o = v.osc("sine", base * p[0]);
      var g = v.gain(0);
      env(g.gain, t, p[1] * 0.55, 0.002, 0, D * p[2]);
      chain(o, g, v.out);
    }
    var n = v.noise(), hp = v.filter("highpass", 4000, 0.7), ng = v.gain(0);
    env(ng.gain, t, 0.12, 0.001, 0, 0.03);   // the strike, not the ring
    chain(n, hp, ng, v.out);

    v.until(t + D + 0.06);
  }

  /* BUZZ — wrong answer, rejected, denied.
     A saw and a square a fraction of a Hz apart, so they beat against each
     other, gated by a 24Hz square LFO. The pitch sags a few Hz across the
     half second: that little sag is the difference between "incorrect" and
     "a machine is broken". */
  function buzz(v) {
    var t = v.t0, D = 0.5;
    var mix = v.gain(0.42), lp = v.filter("lowpass", 1300, 1.1), trem = v.gain(0.6), g = v.gain(0);
    ramp(g.gain, t, [[0, 0], [0.006, 1], [D - 0.04, 1], [D, 0]]);
    chain(mix, lp, trem, g, v.out);

    var a = v.osc("sawtooth", 95), b = v.osc("square", 95.7);
    sweep(a.frequency, t, [[0, 95], [D, 84]]);
    sweep(b.frequency, t, [[0, 95.7], [D, 84.6]]);
    a.connect(mix); b.connect(mix);

    var lfo = v.osc("square", 24), amt = v.gain(0.4);
    chain(lfo, amt, trem.gain);

    v.until(t + D + 0.04);
  }

  /* AIRHORN — the loudest joke in short form.
     A stack of saws at the fundamental, its fifth and two octaves, bent up
     into pitch over 90ms because a real horn arrives flat and pulls up as it
     gets air. A +11dB peak at 2.6kHz gives it the pierce, and heavy
     saturation gives it the honk — clean oscillators sound like a synth pad
     playing a chord, which is not the joke. */
  function airhorn(v) {
    var t = v.t0, D = 1.05, f = 466;
    var bus = v.gain(0.3), hp = v.filter("highpass", 260, 0.7), pk = v.filter("peaking", 2600, 1.1);
    pk.gain.value = 11;
    var sat = v.sat(4.5), g = v.gain(0);
    ramp(g.gain, t, [[0, 0], [0.045, 1], [D - 0.13, 1], [D, 0]]);
    chain(bus, hp, pk, sat, g, v.out);

    var vib = v.osc("sine", 5.4), vibAmt = v.gain(7);   // ±7 cents of wobble
    chain(vib, vibAmt);

    var ratios = [1, 1.5, 2.005, 3.01], levels = [1, 0.6, 0.4, 0.4];
    for (var i = 0; i < ratios.length; i++) {
      var hz = f * ratios[i];
      var o = v.osc("sawtooth", hz);
      sweep(o.frequency, t, [[0, hz * 0.94], [0.09, hz]]);
      vibAmt.connect(o.detune);
      chain(o, v.gain(levels[i]), bus);
    }

    v.until(t + D + 0.04);
  }

  /* SPARKLE — magic, a transformation, a before-and-after.
     Nine short sine blips scattered across two thirds of a second, drawn from
     a pentatonic scale so no two of them can land on a dissonance however the
     scatter falls, over a thin bed of very high noise for shimmer. The seed
     is fixed, so this sparkles exactly the same way every time it plays. */
  var PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  function sparkle(v) {
    var t = v.t0, base = 1046.5, D = 1.15, count = 9, r = rng(0x5eed17);
    for (var i = 0; i < count; i++) {
      var at = t + (i / count) * 0.62 + r() * 0.02;
      var semi = PENTA[(r() * PENTA.length) | 0];
      var o = v.osc("sine", base * Math.pow(2, semi / 12), at);
      var g = v.gain(0);
      env(g.gain, at, 0.22, 0.004, 0, 0.32);
      var p = v.pan(r() * 1.2 - 0.6, 0, at, 0);
      chain(o, g, p, v.out);
    }
    var n = v.noise(), hp = v.filter("highpass", 6500, 0.7), ng = v.gain(0);
    ramp(ng.gain, t, [[0, 0], [0.3, 0.07], [D, 0]]);
    chain(n, hp, ng, v.out);

    v.until(t + D + 0.05);
  }

  /* COIN — a win, a total, a number going up.
     Two square-wave notes, B5 for 70ms then E6 held and faded. The jump is
     the sound; everyone recognises it and nobody can name why. */
  function coin(v) {
    var t = v.t0, D = 0.42;
    var o = v.osc("square", 987.77);
    o.frequency.setValueAtTime(987.77, t);
    o.frequency.setValueAtTime(1318.51, t + 0.07);
    var lp = v.filter("lowpass", 7000, 0.7), g = v.gain(0);
    ramp(g.gain, t, [[0, 0], [0.004, 0.5], [0.07, 0.5], [0.09, 0.45], [D, 0]]);
    chain(o, lp, g, v.out);

    v.until(t + D + 0.02);
  }

  /* ═══════════ REGISTRY ═══════════
     `dur` is what the editor reserves on the timeline: the recording's
     trimmed length, tail included, since a recording's room is part of it.

     `hit` is where the sound LANDS, in seconds from its start: the strike
     for anything struck, the peak of the whoosh, the very END of the riser
     (it exists to stop dead on the moment it builds to), the cymbal crash of
     the drum roll. The AI Director names moments ("the cut into clip 3", "the
     word free") and brain.js starts each sound `hit` seconds early so its
     impact lands exactly there, so the model never does envelope arithmetic.
     Change a recording or its trim and `hit` has to be measured again.

     `use` is what the AI Director is TAUGHT about the sound: when it earns its
     place, and when it must not be used. It is read straight into the
     Director's brief, so it is written for an editor, not for a listener.
     A voice with no `use` line is never offered to the Director: a sound it
     has not been taught is a sound it will use wrongly. */

  /* `dur` is the recording's trimmed length (filled in from RECORDED below)
     and `hit` where it lands, measured on the recording. `max` is how many
     times one video may use it; brain.js enforces it. `level` and `build`
     belong to the synthesised fallback only. */
  var SOUNDS = {
    boom:    { label: "Boom",     hit: 0, max: 2, level: 0.78, build: boom,
               tags: ["impact", "reveal", "cut"],
               about: "Deep cinematic impact. Under a hard cut or a reveal.",
               use: "The heaviest hit there is. The reveal, the bold claim, the payoff landing, a hard cut to something big. Two per video at most." },
    whoosh:  { label: "Whoosh",   hit: 0.08, level: 1.53, build: whoosh,
               tags: ["transition", "motion", "swipe", "zoom"],
               about: "Fast whip whoosh. A transition or a zoom.",
               use: "A transition: the cut to a new place, a new topic or a time jump, a punch-in zoom, or a cutaway sweeping in. Never on jump cuts inside one continuous thought." },
    riser:   { label: "Riser",    hit: 2.99, level: 0.66, build: riser,
               tags: ["build", "tension", "drop"],
               about: "A rising sweep that stops dead. Runs into the punchline.",
               use: "Tension climbing into the payoff or reveal and stopping dead on it. Only where the seconds before it are a build-up or a pause, and pair it with a boom or sub drop landing on the same moment. Once per video." },
    subdrop: { label: "Sub drop", hit: 0, level: 0.80, build: subdrop,
               tags: ["drop", "reveal", "bass"],
               about: "Bass drop sliding down. The moment after a riser.",
               use: "A deep bass drop sliding down. A reveal, a dramatic reaction, the drop after a riser. Weightier and slower than boom; never both on one moment." },
    pop:     { label: "Pop",      hit: 0.04, level: 0.85, build: pop,
               tags: ["caption", "emoji", "ui"],
               about: "Small pop. A caption word or an emoji landing.",
               use: "Something appearing: on-screen text, a sticker, a cutaway panel popping in. The lightest touch there is, and the natural sound for the hook text arriving." },
    ding:    { label: "Ding",     hit: 0.03, level: 0.88, build: ding,
               tags: ["notify", "correct", "point"],
               about: "A bell. A point landing or a box being ticked.",
               use: "A point landing: a tip, the right answer, a fact worth remembering, a step ticked off." },
    buzz:    { label: "Buzz",     hit: 0.02, level: 0.72, build: buzz,
               tags: ["wrong", "reject", "fail"],
               about: "Game-show wrong answer. Denied, failed, nope.",
               use: "Wrong: a mistake, a fail, a myth being busted, a \"don't do this\". Comedy and tutorials only, never a serious moment." },
    airhorn: { label: "Airhorn",  hit: 0, max: 1, level: 0.80, build: airhorn,
               tags: ["hype", "joke", "meme"],
               about: "DJ airhorn. Use once per video, at most.",
               use: "A genuine joke, a flex or an absurd moment, in comedy only. Once per video at most, and never in anything sincere." },
    sparkle: { label: "Sparkle",  hit: 0.02, level: 2.40, build: sparkle,
               tags: ["magic", "reveal", "transform"],
               about: "Bright chime sparkle. A before-and-after or a transformation.",
               use: "A transformation: the before and after, something new, clean or magical appearing." },
    coin:    { label: "Coin",     hit: 0, level: 1.30, build: coin,
               tags: ["win", "score", "count"],
               about: "Arcade pickup. A number going up, a win, a tally.",
               use: "A number or score going up: a point scored, a win, a level up, a tally ticking over. For real money, kaching is the better fit." },
    scratch: { label: "Record scratch", hit: 0.03, max: 1,
               tags: ["stop", "wait", "reversal"],
               about: "Needle dragged across a record. Wait, what?",
               use: "The story stops dead: a 'wait, what?', a sudden reversal, the freeze before 'let me explain'. Comedy only, once per video." },
    rimshot: { label: "Ba-dum-tss", hit: 0, max: 1,
               tags: ["joke", "pun", "punchline"],
               about: "Drum sting after a joke.",
               use: "In the pause right after a pun or a deliberately bad joke lands. Comedy only, once per video, never after a sincere line." },
    sadtrombone: { label: "Sad trombone", hit: 0.16, max: 1,
               tags: ["fail", "flop", "disappointed"],
               about: "Wah wah wah waaah. Something flopped.",
               use: "A plan that flopped, a fail, a disappointing result, played in a pause after it. Comedy only, once per video, never over real bad news." },
    crickets: { label: "Crickets", hit: 0.07, max: 1,
               tags: ["silence", "awkward", "nobody"],
               about: "Awkward silence.",
               use: "Awkward silence: after a joke that falls flat, a question nobody answers, a dead pause. Only in a pause, never under speech. Once per video." },
    applause: { label: "Applause", hit: 0.21, max: 1,
               tags: ["win", "crowd", "cheer", "success"],
               about: "A crowd clapping and cheering.",
               use: "A win, a finished result, an achievement, the end of a transformation. In a pause or the closing beat, never under a line that matters. Once per video." },
    laugh:   { label: "Audience laugh", hit: 0.2, max: 2,
               tags: ["joke", "crowd", "funny"],
               about: "A room of people laughing.",
               use: "The breath right after the punchline of a real joke. Comedy only, at most twice per video, never on a sincere moment." },
    shutter: { label: "Camera shutter", hit: 0,
               tags: ["photo", "screenshot", "freeze"],
               about: "A camera taking a photo.",
               use: "A photo being taken, a screenshot, a freeze frame, a 'save this' moment." },
    kaching: { label: "Ka-ching", hit: 0.32,
               tags: ["money", "price", "sale", "cash"],
               about: "Cash register. Money in.",
               use: "Real money: a price, a sale, a profit, a paycheck, money coming in or being spent. It lands on the number being said." },
    drumroll: { label: "Drum roll", hit: 2.4, max: 1,
               tags: ["build", "anticipation", "reveal"],
               about: "Snare roll building into a crash. The big reveal.",
               use: "Anticipation before a reveal: the snare builds for about 2.4 seconds and lands its cymbal crash on the moment (the result, the answer, the number). Only where the seconds before are build-up, never with a riser on the same moment. Once per video." },
    gasp:    { label: "Crowd gasp", hit: 0.32, max: 1,
               tags: ["shock", "reveal", "crowd"],
               about: "A crowd, shocked.",
               use: "A shocking reveal, a surprising number, something going badly wrong, in the breath after it. Once per video, never on something genuinely tragic." }
  };

  /* Fixed order — the soundboard, any future picker and this file's own
     documentation all read from here, so they can never drift apart. */
  var NAMES = ["boom", "whoosh", "riser", "subdrop", "pop", "ding", "buzz", "airhorn", "sparkle", "coin",
               "scratch", "rimshot", "sadtrombone", "crickets", "applause", "laugh", "shutter", "kaching", "drumroll", "gasp"];
  NAMES.forEach(function (n) {
    var r = RECORDED[n];
    SOUNDS[n].dur = Math.round((r[3] - r[2]) * 1000) / 1000;
  });

  /* ═══════════ REAL RECORDINGS ═══════════

     Synthesis wins for anything that is synthesised in real production too —
     an 808 boom IS a sine sweep, and so are the sub drop, the coin and the
     ding. It loses badly for sounds that are, in the listener's head, a
     specific RECORDING: air moving past a microphone in a real room. No
     oscillator reproduces a particular recording, so for those the answer is
     to play the recording.

     Since 0.25.0 that is every sound: see RECORDED and the header. */

  var samples = {};   // name -> { buffer (trimmed and faded), gain, url }

  /* decodeAudioData has two forms in the wild: the old callback one (Safari)
     and the promise one. Support both, because the difference is invisible
     until it fails on somebody's phone. */
  function decode(ctx, bytes) {
    return new Promise(function (res, rej) {
      var p;
      try { p = ctx.decodeAudioData(bytes, res, rej); } catch (e) { rej(e); return; }
      if (p && p.then) p.then(res, rej);
    });
  }

  /* Decoding needs a context but not a running one: an OfflineAudioContext
     decodes without a user gesture, so the recordings can be ready before
     anyone presses play. An AudioBuffer then plays in any context. */
  var decoder = null;
  function decodingContext() {
    if (decoder) return decoder;
    var O = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    try { decoder = O ? new O(2, 44100, 44100) : context(); } catch (e) { decoder = context(); }
    return decoder;
  }

  /* The published file, cut to its trim and faded at both ends: 3ms in where
     it was cut (1.5ms where the file itself starts, since some start at full
     level on their first sample, which clicks), and the given time out. Done
     once, here, so play() only ever schedules a buffer. */
  function cut(ctx, buf, r) {
    var sr = buf.sampleRate, ch = buf.numberOfChannels;
    var a = Math.max(0, Math.floor(r[2] * sr)), b = Math.min(buf.length, Math.ceil(r[3] * sr));
    var len = Math.max(1, b - a);
    var out;
    try { out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: sr }); }
    catch (e) { out = ctx.createBuffer(ch, len, sr); }
    var swell = r[7] > 0;   // a slow cosine fade-in, see RECORDED
    var fin = Math.min(len, Math.round((swell ? r[7] : a > 0 ? 0.003 : 0.0015) * sr)), fout = Math.min(len, Math.round(r[4] * sr));
    for (var c = 0; c < ch; c++) {
      var src = buf.getChannelData(c), dst = out.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var g = 1;
        if (i < fin) g = swell ? 0.5 - 0.5 * Math.cos(Math.PI * i / fin) : i / fin;
        var left = len - 1 - i;
        if (left < fout) g *= 0.5 - 0.5 * Math.cos(Math.PI * left / fout);   // a smooth close
        dst[i] = src[a + i] * g;
      }
    }
    return out;
  }

  /* A copy kept on the device after the first download (Cache Storage), so
     the second visit, a flaky connection and a long export never wait on the
     network. Anything the browser does not offer is skipped, not an error. */
  var CACHE = "vclyps-sfx-1";
  function getBytes(url) {
    var C = global.caches;
    function network() {
      return global.fetch(url, { mode: "cors" }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        if (C && C.open) {
          var copy = r.clone();
          C.open(CACHE).then(function (c) { return c.put(url, copy); }).catch(function () {});
        }
        return r.arrayBuffer();
      });
    }
    if (!C || !C.open) return network();
    return C.open(CACHE)
      .then(function (c) { return c.match(url); })
      .then(function (hit) { return hit ? hit.arrayBuffer() : network(); })
      .catch(network);
  }

  var pending = {};   // name -> Promise, so a sound is fetched once however often it is asked for
  function loadOne(name) {
    if (samples[name]) return Promise.resolve(true);
    if (pending[name]) return pending[name];
    var r = RECORDED[name];
    if (!r || !global.fetch || !global.Promise) return global.Promise ? Promise.resolve(false) : null;
    var ctx = decodingContext();
    if (!ctx) return Promise.resolve(false);
    var url = fileFor(name);
    pending[name] = getBytes(url)
      .then(function (bytes) { return decode(ctx, bytes); })
      .then(function (buf) {
        samples[name] = { buffer: cut(ctx, buf, r), gain: r[5], url: url };
        return true;
      })
      .catch(function (e) {
        delete pending[name];   // a later prepare() may try again
        try { console.warn("VevrisSFX: could not load " + name + " (" + (e && e.message) + ")" + (SOUNDS[name].build ? "; the built-in version plays instead" : "")); } catch (e2) {}
        return false;
      });
    return pending[name];
  }

  /* Fetch and decode the recordings, all of them unless names are given.
     Safe to call as often as you like; the app calls it as the editor opens.
     Resolves to { loaded, failed } and never rejects. */
  function prepare(names) {
    var list = (names && names.length ? names : NAMES).filter(function (n) { return RECORDED[n]; });
    if (!global.Promise) return null;
    return Promise.all(list.map(loadOne)).then(function (ok) {
      var done = { loaded: [], failed: [] };
      list.forEach(function (n, i) { (ok[i] ? done.loaded : done.failed).push(n); });
      return done;
    });
  }

  /* For the export: the recordings it uses, ready, or `ms` gone by. A sound
     still missing then plays its built-in version, or nothing. */
  function ready(names, ms) {
    if (!global.Promise) return null;
    var wait = prepare(names);
    if (!ms) return wait;
    return Promise.race([wait, new Promise(function (res) { setTimeout(function () { res(null); }, ms); })]);
  }

  /* load() from before 0.25.0, kept for anything outside the app that used
     it: { name: url } replaces a sound with another file, untrimmed. */
  function load(map) {
    var names = [];
    for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k) && SOUNDS[k]) names.push(k);
    var ctx = decodingContext();
    var done = { loaded: [], failed: [] };
    if (!ctx || !global.fetch || !global.Promise) { done.failed = names; return global.Promise ? Promise.resolve(done) : null; }
    return Promise.all(names.map(function (name) {
      return global.fetch(map[name])
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
        .then(function (bytes) { return decode(ctx, bytes); })
        .then(function (buf) { samples[name] = { buffer: buf, gain: 1, url: map[name] }; done.loaded.push(name); })
        .catch(function () { done.failed.push(name); });
    })).then(function () { return done; });
  }

  /* ═══════════ PLAYBACK ═══════════ */

  var live = [];   // every voice currently sounding, for stopAll()

  function connectOuts(node, ctx, opts) {
    var wired = 0, list = [];
    if (opts.speaker !== false && ctx.destination) list.push(ctx.destination);
    if (opts.dest) list = list.concat(Array.isArray(opts.dest) ? opts.dest : [opts.dest]);
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || !d.context) continue;
      /* Nodes cannot be connected across contexts, and the throw would take
         down whatever called us — an export, most likely. Skip and say so. */
      if (d.context !== ctx) {
        try { console.warn("VevrisSFX: destination belongs to another AudioContext — skipped"); } catch (e) {}
        continue;
      }
      try { node.connect(d); wired++; } catch (e) {}
    }
    return wired;
  }

  /* play(name, opts)
       ctx      AudioContext to schedule into      (default: shared)
       dest     AudioNode, or an array of them — the export's audioDest goes here
       when     ctx-clock start time in seconds    (default: now + lookahead)
       gain     0..2 volume multiplier             (default: 1)
       speaker  also send to ctx.destination       (default: true)
     Returns { name, when, end, duration, stop() }, or null if it could not
     play. It never throws: a sound effect must not be able to break a render. */
  function play(name, opts) {
    opts = opts || {};
    var spec = SOUNDS[name];
    if (!spec) { try { console.warn("VevrisSFX: no sound named " + name); } catch (e) {} return null; }

    var ctx = opts.ctx || context();
    if (!ctx) return null;
    unlock(ctx);

    try {
      var t0 = (typeof opts.when === "number" && opts.when > ctx.currentTime) ? opts.when : ctx.currentTime + LOOKAHEAD;

      /* A loaded recording replaces the synthesised voice outright, and brings
         its own trim — load() measured its peak, so a file at any level lands
         beside the synthesised ones instead of towering over them. `synth:true`
         forces the built-in version, which is what an A/B comparison needs. */
      var rec = opts.synth ? null : samples[name];
      /* Not loaded yet: ask for it, and play the built-in voice meanwhile if
         this sound has one. The ten added in 0.25.0 have none, so they are
         silent until their recording arrives (the editor loads them all as it
         opens, and the export waits for them). */
      if (!rec) {
        if (!opts.synth) loadOne(name);
        if (!spec.build) return null;
      }
      var g = (typeof opts.gain === "number" ? Math.max(0, Math.min(2, opts.gain)) : 1) * (rec ? rec.gain : spec.level);

      var out = ctx.createGain();
      out.gain.value = g;
      if (!connectOuts(out, ctx, opts)) { try { out.disconnect(); } catch (e) {} return null; }

      var v = new Voice(ctx, t0, out);
      if (rec) {
        var src = ctx.createBufferSource();
        src.buffer = rec.buffer;
        src.connect(out);
        v.src.push({ n: src, a: t0 });
        v.until(t0 + rec.buffer.duration);
      } else {
        spec.build(v);
      }

      var stopAt = v.end + 0.02;
      for (var i = 0; i < v.src.length; i++) {
        var s = v.src[i];
        if (s.off != null) s.n.start(s.a, s.off); else s.n.start(s.a);
        if (s.n.stop) s.n.stop(stopAt);
      }

      /* Torn down on a timer rather than on an ended event: the sources here
         stop at different moments, and the tail of a boom outlives most of
         them. One timer keyed to the whole voice is simpler and cannot leave
         a node connected because an event did not fire. */
      var voice = {
        name: name,
        when: t0,
        end: v.end,
        duration: v.end - t0,
        stop: function () {
          var n = ctx.currentTime;
          try {
            out.gain.cancelScheduledValues(n);
            out.gain.setValueAtTime(out.gain.value, n);
            out.gain.linearRampToValueAtTime(0, n + 0.04);   // ramped, or it clicks
          } catch (e) {}
          for (var k = 0; k < v.src.length; k++) { try { v.src[k].n.stop(n + 0.05); } catch (e) {} }
        }
      };
      live.push(voice);

      setTimeout(function () {
        try { out.disconnect(); } catch (e) {}
        var at = live.indexOf(voice);
        if (at >= 0) live.splice(at, 1);
      }, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 150);

      return voice;
    } catch (e) {
      try { console.warn("VevrisSFX: " + name + " failed to play", e); } catch (e2) {}
      return null;
    }
  }

  function stopAll() {
    for (var i = live.length - 1; i >= 0; i--) { try { live[i].stop(); } catch (e) {} }
  }

  function source(name) { return samples[name] ? "recording" : (SOUNDS[name] && SOUNDS[name].build ? "synth" : "loading"); }

  function info(name) {
    var s = SOUNDS[name];
    if (!s) return null;
    var r = RECORDED[name];
    return {
      name: name,
      label: s.label,
      /* The recording's numbers, loaded or not: the timeline and the
         Director plan around what the export will play. */
      duration: s.dur,
      tail: 0,
      hit: s.hit,
      // how many times one video may use it (brain.js); 0 = no limit of its own
      max: s.max || 0,
      use: s.use || "",
      about: s.about,
      tags: s.tags.slice(),
      source: source(name),
      credit: r ? { id: r[0], by: r[6], page: "https://freesound.org/s/" + r[0] + "/", license: "CC0" } : null
    };
  }

  function list() {
    var out = [];
    for (var i = 0; i < NAMES.length; i++) out.push(info(NAMES[i]));
    return out;
  }

  global.VevrisSFX = {
    names: NAMES.slice(),
    list: list,
    info: info,
    duration: function (name) { return SOUNDS[name] ? SOUNDS[name].dur : 0; },
    has: function (name) { return !!SOUNDS[name]; },
    play: play,
    stopAll: stopAll,
    unlock: unlock,
    context: context,
    prepare: prepare,
    ready: ready,
    load: load,
    source: source,
    available: function () { return !!Ctor(); }
  };
})(window);
