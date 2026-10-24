/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — fast export
   Exports by rendering every frame as fast as the device can and handing it
   to the device's own video encoder (WebCodecs), instead of playing the edit
   in real time and recording the screen. Exposes window.SenotelFastExport.

   Why: the real-time recorder takes as long as the video, drops frames at
   1080p on phones (so it was held to 720p) and needs the tab kept awake. Here
   nothing plays, so nothing is dropped: 1080p always, usually several times
   faster than the video's length, and it keeps going in a background tab.

   The parts, each with a fallback:
     · FRAMES. Footage in MP4/MOV is read straight from the file (mp4box,
       already used by Find clips) and decoded with VideoDecoder, in order,
       frame-exact. Anything else, or a codec this device cannot decode, uses
       a hidden <video> jumped to each frame's time (slower, but it plays
       whatever the browser can). Photos are pictures.
     · SOUND. app.js renders the whole mix offline (renderMixOffline) with the
       live mix's rules; audioOf() here decodes a media item's sound.
     · ENCODE. H.264 (hardware first) and AAC, written into an MP4 by
       mp4-muxer 5.2.1, loaded the first time someone exports.
   If any part is missing on a device, supported() says no and app.js uses
   the real-time export, unchanged. Everything stays on the device.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/build/mp4-muxer.mjs";
  const MP4BOX_URL = "https://cdn.jsdelivr.net/npm/mp4box@2.4.1/dist/mp4box.all.mjs";
  const AUDIO_RATE = 48000;
  // a whole-file audio decode holds the sound as 48 kHz stereo floats: past
  // this length MP4/MOV is decoded only where the edit uses it (audioRange)
  const WHOLE_AUDIO_MAX_S = 8 * 60;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* A yield that a background tab does not slow down: setTimeout is held to
     once a second (then once a minute) in a hidden tab; a message port is not. */
  function breathe() {
    return new Promise((r) => {
      const c = new MessageChannel();
      c.port1.onmessage = () => { c.port1.close(); r(); };
      c.port2.postMessage(null);
    });
  }

  /* ═══════════ WHAT THIS DEVICE CAN DO ═══════════ */

  // H.264 profiles from most to least capable; each also tried in software.
  const H264 = ["avc1.640028", "avc1.4d0028", "avc1.42e028"];
  function bitrateFor(w, h) { return Math.round(Math.min(16e6, Math.max(4e6, w * h * 30 * 0.16))); }
  // a bitrate the caller chose (export settings), or the default for the size

  async function videoConfig(w, h, fps, bitrate) {
    if (typeof VideoEncoder === "undefined") return null;
    for (const codec of H264) {
      for (const hw of ["prefer-hardware", "no-preference"]) {
        const cfg = {
          codec: codec, width: w, height: h, framerate: fps, bitrate: bitrate || bitrateFor(w, h),
          hardwareAcceleration: hw, latencyMode: "quality", avc: { format: "avc" }
        };
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) {}
      }
    }
    return null;
  }

  async function audioConfig() {
    if (typeof AudioEncoder === "undefined") return null;
    const cfg = { codec: "mp4a.40.2", sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 192000 };
    try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) return cfg; } catch (e) {}
    return null;
  }

  /* Yes only when the whole chain is here: a video encoder for this size, an
     AAC encoder (an MP4 with AAC plays everywhere people post), canvas
     frames, and offline audio. */
  async function supported(w, h, fps, bitrate) {
    if (typeof VideoFrame === "undefined" || typeof AudioData === "undefined") return { ok: false, why: "no WebCodecs" };
    if (!(global.OfflineAudioContext || global.webkitOfflineAudioContext)) return { ok: false, why: "no offline audio" };
    const v = await videoConfig(w, h, fps, bitrate);
    if (!v) return { ok: false, why: "no H.264 encoder for " + w + "x" + h };
    const a = await audioConfig();
    if (!a) return { ok: false, why: "no AAC encoder" };
    return { ok: true, video: v, audio: a };
  }

  /* ═══════════ READING AN MP4/MOV ═══════════ */

  async function blobOf(item) {
    if (item.file) return item.file;
    return (await fetch(item.url)).blob();
  }

  async function findBox(blob, want) {
    let off = 0;
    for (let n = 0; n < 4096 && off + 8 <= blob.size; n++) {
      const h = new DataView(await blob.slice(off, Math.min(blob.size, off + 16)).arrayBuffer());
      let size = h.getUint32(0);
      const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (size === 1 && h.byteLength >= 16) size = Number(h.getBigUint64(8));
      else if (size === 0) size = blob.size - off;
      if (size < 8) return null;
      if (type === want) return { off: off, size: size };
      off += size;
    }
    return null;
  }

  /* The moov alone, parsed: sample tables, codecs, the rotation. Sample
     offsets are absolute, so sample bytes are read from the file on demand
     and the parser never holds the media. The parser wants a type box in
     front; a minimal one is added (as clips.js does). */
  const parsed = new WeakMap();
  async function parseMp4(blob) {
    if (parsed.has(blob)) return parsed.get(blob);
    const job = (async () => {
      const moov = await findBox(blob, "moov");
      if (!moov || moov.size > 256 * 1024 * 1024) return null;
      const MP4Box = await import(MP4BOX_URL);
      const file = MP4Box.createFile();
      let info = null;
      file.onReady = (i) => { info = i; };
      file.onError = () => {};
      const ftyp = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]);
      const moovBytes = new Uint8Array(await blob.slice(moov.off, moov.off + moov.size).arrayBuffer());
      const body = new Uint8Array(ftyp.length + moovBytes.length);
      body.set(ftyp, 0);
      body.set(moovBytes, ftyp.length);
      file.appendBuffer(MP4Box.MP4BoxBuffer.fromArrayBuffer(body.buffer, 0));
      file.flush();
      if (!info || info.isFragmented) return null;
      return { file: file, info: info, moov: moovBytes };
    })();
    parsed.set(blob, job);
    return job;
  }

  /* The decoder's configuration record (avcC / hvcC / vpcC / av1C), copied
     out of the moov bytes: its payload is exactly what VideoDecoder wants as
     `description`. Read straight from the bytes rather than re-serialised
     through the parser, which is one less thing to go wrong. */
  function configRecord(moovBytes, fourcc) {
    const a = fourcc.charCodeAt(0), b = fourcc.charCodeAt(1), c = fourcc.charCodeAt(2), d = fourcc.charCodeAt(3);
    for (let i = 4; i + 4 <= moovBytes.length; i++) {
      if (moovBytes[i] === a && moovBytes[i + 1] === b && moovBytes[i + 2] === c && moovBytes[i + 3] === d) {
        const size = ((moovBytes[i - 4] << 24) >>> 0) + (moovBytes[i - 3] << 16) + (moovBytes[i - 2] << 8) + moovBytes[i - 1];
        if (size > 8 && i - 4 + size <= moovBytes.length) return moovBytes.slice(i + 4, i - 4 + size);
      }
    }
    return null;
  }

  // Degrees clockwise the picture is turned for display, from the track matrix.
  function rotationOf(track) {
    const m = track && track.matrix;
    if (!m || m.length < 2) return 0;
    const deg = Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI);
    return ((deg % 360) + 360) % 360;
  }

  /* ═══════════ FRAMES ═══════════ */

  /* Frame-exact decoding of one MP4/MOV video track. frameAt(t) returns the
     picture shown at source time t: the latest frame whose presentation time
     is at or before t. Calls should mostly move forward (an export does);
     a jump backwards, or far ahead, starts again from the nearest key frame.
     Frames come out of the decoder in presentation order. */
  async function decoderSource(item) {
    if (typeof VideoDecoder === "undefined") return null;
    const blob = await blobOf(item);
    const p = await parseMp4(blob);
    if (!p || !p.info.videoTracks || !p.info.videoTracks.length) return null;
    const track = p.info.videoTracks[0];
    const trak = p.file.getTrackById(track.id);
    const samples = trak && trak.samples;
    if (!samples || !samples.length) return null;
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    const type = String(entry && entry.type || "");
    const recordBox = { avc1: "avcC", avc3: "avcC", hvc1: "hvcC", hev1: "hvcC", vp09: "vpcC", av01: "av1C" }[type];
    const description = recordBox ? configRecord(p.moov, recordBox) : null;
    const cfg = {
      codec: track.codec,
      codedWidth: track.video ? track.video.width : track.track_width,
      codedHeight: track.video ? track.video.height : track.track_height
    };
    if (description) cfg.description = description;
    let ok = false;
    try { ok = (await VideoDecoder.isConfigSupported(cfg)).supported; } catch (e) {}
    if (!ok) return null;

    const ts = (s) => (s.cts / s.timescale);              // presentation time, seconds
    const rotation = rotationOf(track);
    // the stream's own start: an edit list or a first CTS above zero
    const first = samples.reduce((m, s) => Math.min(m, ts(s)), Infinity);
    const offset = isFinite(first) ? first : 0;

    let dec = null, fault = null, next = 0, waiting = null;
    const ready = [];          // decoded frames, oldest first: {t, frame}
    let shown = null;          // the frame last handed out
    let drained = false;       // every sample fed, flush asked for
    let flushed = false;       // and the flush has finished
    let target = 0;            // the time being decoded towards
    const pending = () => (dec ? dec.decodeQueueSize : 0);

    /* A hardware decoder has a small pool of frames and stops when they are
       all held. So a frame is closed the moment a later one at or before the
       target exists: only the frame to show and the ones after it are kept.
       (Holding every frame on the way to a target stalled the decoder and
       left the export showing a stale picture: found 2026-10-22.) */
    function prune() {
      while (ready.length > 1 && ready[1].t <= target + 1e-4) ready.shift().frame.close();
    }

    function start(fromIndex) {
      if (dec) { try { dec.close(); } catch (e) {} }
      ready.splice(0).forEach((r) => r.frame.close());
      fault = null;
      drained = false;
      flushed = false;
      dec = new VideoDecoder({
        output: (frame) => {
          ready.push({ t: frame.timestamp / 1e6, frame: frame });
          prune();
          if (waiting) { const w = waiting; waiting = null; w(); }
        },
        error: (e) => { fault = e; if (waiting) { const w = waiting; waiting = null; w(); } }
      });
      dec.configure(cfg);
      next = fromIndex;
    }

    // The key frame to start decoding from for time t (decode order).
    function keyBefore(t) {
      let k = 0;
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].is_sync && ts(samples[i]) - offset <= t + 1e-4) k = i;
        if (ts(samples[i]) - offset > t + 2) break;
      }
      return k;
    }

    /* Feed up to n samples, reading contiguous bytes in one slice. At the end
       of the samples, flush once; not awaited, so the frames it releases can
       be taken (and closed) while it finishes. */
    async function feed(n) {
      if (next >= samples.length) {
        if (!drained) {
          drained = true;
          dec.flush().catch((e) => { fault = fault || e; }).then(() => {
            flushed = true;
            if (waiting) { const w = waiting; waiting = null; w(); }
          });
        }
        return;
      }
      let j = next;
      const s0 = samples[next];
      let end = s0.offset + s0.size;
      while (j + 1 < samples.length && j + 1 - next < n && samples[j + 1].offset === end) { j++; end += samples[j].size; }
      const buf = new Uint8Array(await blob.slice(s0.offset, end).arrayBuffer());
      for (let k = next; k <= j; k++) {
        const s = samples[k];
        dec.decode(new EncodedVideoChunk({
          type: s.is_sync ? "key" : "delta",
          timestamp: Math.round((ts(s) - offset) * 1e6),
          duration: Math.round((s.duration / s.timescale) * 1e6),
          data: buf.subarray(s.offset - s0.offset, s.offset - s0.offset + s.size)
        }));
      }
      next = j + 1;
    }

    const lastT = () => (ready.length ? ready[ready.length - 1].t : shown ? shown.t : -Infinity);

    async function frameAt(t) {
      t = Math.max(0, t);
      target = t;
      // backwards, or more than 3 s past what is decoded: start from a key frame
      if (!dec || (shown && t < shown.t - 1e-4) || (t > lastT() + 3 && next < samples.length)) {
        if (shown) { shown.frame.close(); shown = null; }
        start(keyBefore(t));
      }
      prune();
      /* Decode until a frame AFTER t exists (so the one at or before t is
         final), or the end. At most IN_FLIGHT frames are queued or decoded
         ahead of t at any moment: enough to keep the decoder busy, never
         enough to empty its frame pool (the end-of-file flush included). */
      const IN_FLIGHT = 4;
      let guard = 0;
      while (lastT() <= t + 1e-4 && !flushed) {
        if (fault) throw fault;
        let ahead = 0;
        for (let i = 0; i < ready.length; i++) if (ready[i].t > t + 1e-4) ahead++;
        if (next < samples.length && pending() + ahead < IN_FLIGHT) await feed(2);
        else if (next >= samples.length && !drained) await feed(1);   // the flush
        else await new Promise((r) => { waiting = r; setTimeout(() => { if (waiting === r) { waiting = null; r(); } }, 200); });
        if (++guard > 50000) break;
      }
      if (fault) throw fault;
      // the latest frame at or before t; everything before it is no longer needed
      let pick = -1;
      for (let i = 0; i < ready.length; i++) if (ready[i].t <= t + 1e-4) pick = i;
      if (pick >= 0) {
        if (shown) shown.frame.close();
        shown = ready[pick];
        ready.splice(0, pick + 1).slice(0, -1).forEach((r) => r.frame.close());
      } else if (!shown && ready.length) {
        // t falls before the first frame: show the first
        shown = ready.shift();
      }
      return shown ? picture(shown.frame) : null;
    }

    // A frame as something drawImage takes, turned upright when the file says so.
    let turnCanvas = null;
    function picture(frame) {
      const w = frame.displayWidth, h = frame.displayHeight;
      if (!rotation) return { el: frame, w: w, h: h };
      const quarter = rotation === 90 || rotation === 270;
      const W = quarter ? h : w, H = quarter ? w : h;
      if (!turnCanvas) turnCanvas = new OffscreenCanvas(W, H);
      if (turnCanvas.width !== W) turnCanvas.width = W;
      if (turnCanvas.height !== H) turnCanvas.height = H;
      const c = turnCanvas.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (rotation === 90) { c.translate(W, 0); c.rotate(Math.PI / 2); }
      else if (rotation === 180) { c.translate(W, H); c.rotate(Math.PI); }
      else if (rotation === 270) { c.translate(0, H); c.rotate(-Math.PI / 2); }
      c.drawImage(frame, 0, 0, w, h);
      return { el: turnCanvas, w: W, h: H };
    }

    function close() {
      if (shown) { shown.frame.close(); shown = null; }
      ready.splice(0).forEach((r) => r.frame.close());
      if (dec) { try { dec.close(); } catch (e) {} dec = null; }
    }

    return { kind: "decoder", frameAt: frameAt, close: close, rotation: rotation };
  }

  /* Any video the browser plays: a hidden element jumped to each frame. */
  async function seekSource(item) {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.src = item.url;
    await new Promise((res, rej) => {
      v.addEventListener("loadeddata", res, { once: true });
      v.addEventListener("error", () => rej(new Error("This video couldn't be opened for export")), { once: true });
    });
    async function frameAt(t) {
      const want = clamp(t, 0, Math.max(0, (v.duration || 0) - 0.001));
      if (Math.abs(v.currentTime - want) > 0.0005) {
        await new Promise((r) => {
          const done = () => { clearTimeout(timer); r(); };
          const timer = setTimeout(done, 3000);
          v.addEventListener("seeked", done, { once: true });
          v.currentTime = want;
        });
      }
      return { el: v, w: v.videoWidth, h: v.videoHeight };
    }
    function close() { try { v.removeAttribute("src"); v.load(); } catch (e) {} }
    return { kind: "seek", frameAt: frameAt, close: close };
  }

  async function imageSource(item) {
    const img = new Image();
    img.decoding = "async";
    img.src = item.url;
    try { await img.decode(); } catch (e) {
      await new Promise((r) => { if (img.complete) r(); else { img.onload = r; img.onerror = r; } });
    }
    const pic = { el: img, w: img.naturalWidth, h: img.naturalHeight };
    return { kind: "image", frameAt: async () => pic, close: () => {} };
  }

  // The best way to get frames out of this media item.
  async function frameSource(item) {
    if (item.type === "image") return imageSource(item);
    try {
      const d = await decoderSource(item);
      if (d) return d;
    } catch (e) { try { console.warn("fast export: decoder unavailable for " + item.name + ", seeking instead", e); } catch (e2) {} }
    return seekSource(item);
  }

  /* ═══════════ SOUND ═══════════ */

  /* A media item's sound as an AudioBuffer. The whole file through the
     browser's decoder when it is short; for long MP4/MOV, only the stretch
     [from, to] (seconds), decoded with AudioDecoder from the file in pieces,
     returned with `startsAt` = the source second its first sample is. */
  async function audioOf(item, from, to) {
    const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const dur = item.duration || 0;
    if (!dur || dur <= WHOLE_AUDIO_MAX_S) {
      const bytes = await (await blobOf(item)).arrayBuffer();
      const ctx = new Ctx(2, 1, AUDIO_RATE);
      try {
        const buf = await new Promise((res, rej) => {
          const pr = ctx.decodeAudioData(bytes, res, rej);
          if (pr && pr.then) pr.then(res, rej);
        });
        return { buffer: buf, startsAt: 0 };
      } catch (e) { return null; }     // no sound track
    }
    return audioRange(item, Math.max(0, from), Math.min(dur, to));
  }

  async function audioRange(item, from, to) {
    if (typeof AudioDecoder === "undefined") throw new Error("This recording is too long to export quickly in this browser");
    const blob = await blobOf(item);
    const p = await parseMp4(blob);
    if (!p) throw new Error("This recording is too long to export quickly unless it is an MP4 or MOV");
    const track = (p.info.audioTracks || []).find((t) => /^mp4a/.test(t.codec || ""));
    if (!track) return null;
    const trak = p.file.getTrackById(track.id);
    const samples = (trak && trak.samples) || [];
    const entry = trak.mdia.minf.stbl.stsd.entries[0];
    const esds = entry.esds || (entry.wave && entry.wave.esds);
    let desc;
    try {
      const dcd = esds && esds.esd && esds.esd.findDescriptor(4);
      const dsi = dcd && dcd.findDescriptor(5);
      if (dsi && dsi.data) desc = dsi.data;
    } catch (e) {}
    const rate = (track.audio && track.audio.sample_rate) || 48000;
    const chans = Math.min(2, (track.audio && track.audio.channel_count) || 2);
    const cfg = { codec: track.codec, sampleRate: rate, numberOfChannels: (track.audio && track.audio.channel_count) || 2 };
    if (desc) cfg.description = desc;
    const sec = (s) => s.cts / s.timescale;
    const lo = samples.findIndex((s) => sec(s) >= from - 0.25);
    if (lo < 0) return null;
    let hi = lo;
    while (hi + 1 < samples.length && sec(samples[hi + 1]) <= to + 0.25) hi++;
    const startsAt = sec(samples[lo]);
    const total = Math.ceil((sec(samples[hi]) - startsAt + 0.2) * rate);
    const planes = [new Float32Array(total), new Float32Array(total)];
    let fault = null, pos = 0;
    const dec = new AudioDecoder({
      output: (ad) => {
        try {
          const n = Math.min(ad.numberOfFrames, total - pos);
          if (n > 0) {
            for (let c = 0; c < 2; c++) {
              const tmp = new Float32Array(ad.numberOfFrames);
              ad.copyTo(tmp, { planeIndex: Math.min(c, ad.numberOfChannels - 1), format: "f32-planar" });
              planes[c].set(tmp.subarray(0, n), pos);
            }
            pos += n;
          }
        } finally { ad.close(); }
      },
      error: (e) => { fault = e; }
    });
    dec.configure(cfg);
    for (let i = lo; i <= hi;) {
      if (fault) throw fault;
      let j = i;
      const s0 = samples[i];
      let end = s0.offset + s0.size;
      while (j + 1 <= hi && samples[j + 1].offset === end && end - s0.offset < 4 * 1024 * 1024) { j++; end += samples[j].size; }
      const buf = new Uint8Array(await blob.slice(s0.offset, end).arrayBuffer());
      for (let k = i; k <= j; k++) {
        const s = samples[k];
        dec.decode(new EncodedAudioChunk({
          type: "key", timestamp: Math.round(sec(s) * 1e6), duration: Math.round((s.duration / s.timescale) * 1e6),
          data: buf.subarray(s.offset - s0.offset, s.offset - s0.offset + s.size)
        }));
      }
      i = j + 1;
      while (dec.decodeQueueSize > 120) await breathe();
    }
    await dec.flush();
    dec.close();
    if (fault) throw fault;
    const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    const ctx = new Ctx(2, 1, AUDIO_RATE);
    const out = ctx.createBuffer(chans === 1 ? 1 : 2, Math.max(1, pos), rate);
    for (let c = 0; c < out.numberOfChannels; c++) out.getChannelData(c).set(planes[c].subarray(0, Math.max(1, pos)));
    return { buffer: out, startsAt: startsAt };
  }

  /* Change speed WITHOUT changing pitch, the way the preview plays a sped-up
     clip (an element keeps its pitch by default). WSOLA: overlapping windows
     are laid down at the output's pace, each taken from near where the input
     has got to, nudged to the offset that best continues the last one so
     voices do not warble. The nudge is searched on a quarter-rate copy, so it
     costs little. rate 2 = twice as fast. Returns new channel arrays. */
  function stretch(channels, rate) {
    if (!rate || Math.abs(rate - 1) < 1e-3) return channels.map((c) => c.slice());
    const N = 2048, Hs = N / 2, Ha = Hs * rate, TOL = 512;
    const inLen = channels[0].length;
    const outLen = Math.max(1, Math.floor(inLen / rate));
    const out = channels.map(() => new Float32Array(outLen + N));
    const norm = new Float32Array(outLen + N);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    // a mono copy at quarter rate for the search
    const mono = new Float32Array(Math.ceil(inLen / 4));
    for (let i = 0; i < mono.length; i++) {
      let s = 0, k = i * 4;
      for (let c = 0; c < channels.length; c++) s += channels[c][Math.min(inLen - 1, k)];
      mono[i] = s / channels.length;
    }
    let prev = 0;     // where the last window was taken from in the input
    for (let o = 0, n = 0; o < outLen; o += Hs, n++) {
      const nominal = Math.round(n * Ha);
      let best = nominal;
      if (n > 0) {
        // compare with the natural continuation of the previous window
        const cont = prev + Hs;
        let bestScore = -Infinity;
        for (let d = -TOL; d <= TOL; d += 4) {
          const cand = nominal + d;
          if (cand < 0 || cand + N >= inLen) continue;
          let score = 0;
          for (let i = 0; i < N / 2; i += 16) {
            const a = mono[(cand + i) >> 2] || 0, b = mono[(cont + i) >> 2] || 0;
            score += a * b;
          }
          if (score > bestScore) { bestScore = score; best = cand; }
        }
      }
      best = clamp(best, 0, Math.max(0, inLen - 1));
      for (let i = 0; i < N && o + i < out[0].length; i++) {
        const w = win[i];
        const src = best + i;
        if (src >= inLen) break;
        for (let c = 0; c < channels.length; c++) out[c][o + i] += channels[c][src] * w;
        norm[o + i] += w;
      }
      prev = best;
    }
    for (let c = 0; c < out.length; c++) {
      const o = out[c];
      for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) o[i] /= norm[i];
    }
    return out.map((o) => o.subarray(0, outLen));
  }

  /* The same WSOLA, but the input position follows a map instead of one
     rate (ccl12 speed curves): posAt(output sample) → input sample. Output
     is outLen samples long. */
  function stretchMap(channels, outLen, posAt) {
    const N = 2048, Hs = N / 2, TOL = 512;
    const inLen = channels[0].length;
    const out = channels.map(() => new Float32Array(outLen + N));
    const norm = new Float32Array(outLen + N);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    const mono = new Float32Array(Math.ceil(inLen / 4));
    for (let i = 0; i < mono.length; i++) {
      let s = 0, k = i * 4;
      for (let c = 0; c < channels.length; c++) s += channels[c][Math.min(inLen - 1, k)];
      mono[i] = s / channels.length;
    }
    let prev = 0;
    for (let o = 0, n = 0; o < outLen; o += Hs, n++) {
      // the window centred on output o comes from around the input the map says
      const nominal = Math.round(posAt(o + Hs) - Hs);
      let best = nominal;
      if (n > 0) {
        const cont = prev + Hs;
        let bestScore = -Infinity;
        for (let d = -TOL; d <= TOL; d += 4) {
          const cand = nominal + d;
          if (cand < 0 || cand + N >= inLen) continue;
          let score = 0;
          for (let i = 0; i < N / 2; i += 16) score += (mono[(cand + i) >> 2] || 0) * (mono[(cont + i) >> 2] || 0);
          if (score > bestScore) { bestScore = score; best = cand; }
        }
      }
      best = clamp(best, 0, Math.max(0, inLen - 1));
      for (let i = 0; i < N && o + i < out[0].length; i++) {
        const src = best + i;
        if (src >= inLen) break;
        for (let c = 0; c < channels.length; c++) out[c][o + i] += channels[c][src] * win[i];
        norm[o + i] += win[i];
      }
      prev = best;
    }
    for (let c = 0; c < out.length; c++) {
      const o = out[c];
      for (let i = 0; i < outLen; i++) if (norm[i] > 1e-3) o[i] /= norm[i];
    }
    return out.map((o) => o.subarray(0, outLen));
  }

  /* ═══════════ ENCODE AND WRITE ═══════════ */

  let muxerLib = null;
  async function muxer() {
    if (!muxerLib) muxerLib = import(MUXER_URL);
    return muxerLib;
  }

  /* opts: canvas (drawn by renderFrame), fps, bitrate (optional), duration (s), audio
     (AudioBuffer at 48 kHz or null), renderFrame(t) async, onProgress(done,
     total, framesPerSecond), cancelled() → bool. Returns a video/mp4 Blob. */
  async function encode(opts) {
    const W = opts.canvas.width, H = opts.canvas.height, fps = opts.fps || 30;
    const sup = await supported(W, H, fps, opts.bitrate);
    if (!sup.ok) throw new Error("Fast export is not available here: " + sup.why);
    const lib = await muxer();
    const target = new lib.ArrayBufferTarget();
    const mux = new lib.Muxer({
      target: target,
      video: { codec: "avc", width: W, height: H, frameRate: fps },
      audio: opts.audio ? { codec: "aac", numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset"
    });

    let fault = null;
    const venc = new VideoEncoder({
      output: (chunk, meta) => { try { mux.addVideoChunk(chunk, meta); } catch (e) { fault = e; } },
      error: (e) => { fault = e; }
    });
    venc.configure(sup.video);

    const frames = Math.max(1, Math.round(opts.duration * fps));
    const step = 1e6 / fps;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      if (opts.cancelled && opts.cancelled()) { try { venc.close(); } catch (e) {} return null; }
      if (fault) throw fault;
      await opts.renderFrame(i / fps);
      const vf = new VideoFrame(opts.canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 4) await breathe();
      if (opts.onProgress && (i % 5 === 0 || i === frames - 1)) {
        const secs = (performance.now() - t0) / 1000;
        opts.onProgress(i + 1, frames, secs > 0 ? (i + 1) / secs : 0);
      }
    }
    await venc.flush();
    venc.close();
    if (fault) throw fault;

    if (opts.audio) {
      const aenc = new AudioEncoder({
        output: (chunk, meta) => { try { mux.addAudioChunk(chunk, meta); } catch (e) { fault = e; } },
        error: (e) => { fault = e; }
      });
      aenc.configure(sup.audio);
      const buf = opts.audio;
      const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
      const total = Math.min(buf.length, Math.round(opts.duration * AUDIO_RATE));
      const CH = 4800;   // a tenth of a second at a time
      for (let s = 0; s < total; s += CH) {
        if (opts.cancelled && opts.cancelled()) { try { aenc.close(); } catch (e) {} return null; }
        if (fault) throw fault;
        const n = Math.min(CH, total - s);
        const data = new Float32Array(n * 2);
        data.set(L.subarray(s, s + n), 0);
        data.set(R.subarray(s, s + n), n);
        const ad = new AudioData({ format: "f32-planar", sampleRate: AUDIO_RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((s / AUDIO_RATE) * 1e6), data: data });
        aenc.encode(ad);
        ad.close();
        while (aenc.encodeQueueSize > 16) await breathe();
      }
      await aenc.flush();
      aenc.close();
      if (fault) throw fault;
    }
    mux.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  }

  global.SenotelFastExport = {
    AUDIO_RATE: AUDIO_RATE,
    supported: supported,
    frameSource: frameSource,
    audioOf: audioOf,
    stretch: stretch,
    stretchMap: stretchMap,
    encode: encode,
    breathe: breathe,
    // exported for the tests
    _configRecord: configRecord,
    _rotationOf: rotationOf
  };
})(window);
