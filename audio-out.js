/* ═══════════════════════════════════════════════════════════
   vClyps — audio out
   Saves the sound of something in Your audio as a file of its own, for
   the Download button there. Exposes window.VevrisAudioOut.

   · An audio file is handed back exactly as it came in.
   · A video's sound is COPIED out, not re-encoded. Phones and cameras
     record ordinary MP4/MOV files with AAC sound, and that sound is moved
     into an .m4a byte for byte: the download is the very sound that was
     recorded, and it is ready in a moment however long the video is.
   · Anything else (WebM, a fragmented MP4, an unusual codec) is decoded
     by the browser and saved as a WAV: full quality, a bigger file.

   Everything happens on the device. Nothing is uploaded, nothing costs.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  const MOOV_MAX = 256 * 1024 * 1024;     // a moov past this is not a real one
  const WAV_SOURCE_MAX = 1200 * 1024 * 1024;  // the browser decodes it whole
  const COPYABLE = ["mp4a", "alac"];      // codecs an .m4a may carry

  const fourcc = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

  // Top-level boxes of a file, reading only their headers.
  async function topBoxes(blob) {
    const out = [];
    let off = 0;
    for (let n = 0; n < 4096 && off + 8 <= blob.size; n++) {
      const h = new DataView(await blob.slice(off, Math.min(blob.size, off + 16)).arrayBuffer());
      let size = h.getUint32(0);
      const type = fourcc(h, 4);
      if (size === 1 && h.byteLength >= 16) size = Number(h.getBigUint64(8));
      else if (size === 0) size = blob.size - off;
      if (size < 8) break;
      out.push({ type: type, off: off, size: size });
      off += size;
    }
    return out;
  }

  // The boxes inside a box that has been read into memory.
  function children(dv, box) {
    const out = [];
    const end = box.off + box.size;
    let o = box.body;
    while (o + 8 <= end) {
      let size = dv.getUint32(o), head = 8;
      const type = fourcc(dv, o + 4);
      if (size === 1) { size = Number(dv.getBigUint64(o + 8)); head = 16; }
      else if (size === 0) size = end - o;
      if (size < head || o + size > end) break;
      out.push({ type: type, off: o, size: size, body: o + head });
      o += size;
    }
    return out;
  }
  const child = (dv, box, type) => (box ? children(dv, box).find((b) => b.type === type) : null) || null;

  /* Where each chunk of the sound sits in the file, from the track's own
     tables: stsc says how many samples are in each chunk, stsz how big each
     sample is, stco/co64 where each chunk starts. */
  function chunksOf(dv, stbl) {
    const stsc = child(dv, stbl, "stsc"), stsz = child(dv, stbl, "stsz");
    const stco = child(dv, stbl, "stco") || child(dv, stbl, "co64");
    if (!stsc || !stsz || !stco) return null;      // stz2 and friends: not worth copying by hand
    const wide = stco.type === "co64";
    const chunkCount = dv.getUint32(stco.body + 4);
    const offsets = new Array(chunkCount);
    for (let i = 0; i < chunkCount; i++) {
      offsets[i] = wide ? Number(dv.getBigUint64(stco.body + 8 + i * 8)) : dv.getUint32(stco.body + 8 + i * 4);
    }
    const fixed = dv.getUint32(stsz.body + 4), sampleCount = dv.getUint32(stsz.body + 8);
    const sizeOf = (i) => (fixed ? fixed : dv.getUint32(stsz.body + 12 + i * 4));
    const runs = dv.getUint32(stsc.body + 4);
    const perChunk = new Array(chunkCount).fill(0);
    for (let r = 0; r < runs; r++) {
      const first = dv.getUint32(stsc.body + 8 + r * 12);
      const per = dv.getUint32(stsc.body + 8 + r * 12 + 4);
      const next = r + 1 < runs ? dv.getUint32(stsc.body + 8 + (r + 1) * 12) : chunkCount + 1;
      for (let c = first; c < next && c <= chunkCount; c++) perChunk[c - 1] = per;
    }
    const sizes = new Array(chunkCount);
    let s = 0;
    for (let c = 0; c < chunkCount; c++) {
      let bytes = 0;
      for (let k = 0; k < perChunk[c]; k++, s++) {
        if (s >= sampleCount) return null;
        bytes += sizeOf(s);
      }
      sizes[c] = bytes;
    }
    if (s !== sampleCount) return null;            // the tables disagree: don't guess
    return { stco: stco, wide: wide, offsets: offsets, sizes: sizes };
  }

  /* The sound of an MP4/MOV as an .m4a Blob, or null when it can't be copied
     (no moov, fragmented, no sound track, a codec .m4a doesn't carry). The new
     file is the movie header, the sound track exactly as it was except for
     where its chunks now sit, and those chunks, in order. The chunk bytes are
     never read: the Blob is built from slices of the original, so a long
     video costs no memory. Everything else in the file, the picture and any
     metadata such as where it was filmed, is left behind. */
  async function m4aOf(blob) {
    const boxes = await topBoxes(blob);
    const moovAt = boxes.find((b) => b.type === "moov");
    if (!moovAt || moovAt.size > MOOV_MAX || boxes.some((b) => b.type === "moof")) return null;
    const buf = new Uint8Array(await blob.slice(moovAt.off, moovAt.off + moovAt.size).arrayBuffer());
    const dv = new DataView(buf.buffer);
    const head = dv.getUint32(0) === 1 ? 16 : 8;
    const moov = { type: "moov", off: 0, size: buf.length, body: head };
    if (child(dv, moov, "mvex")) return null;        // fragmented: the samples are elsewhere
    const mvhd = child(dv, moov, "mvhd");
    if (!mvhd) return null;

    let trak = null, stbl = null, tkhd = null;
    for (const t of children(dv, moov).filter((b) => b.type === "trak")) {
      const mdia = child(dv, t, "mdia");
      const hdlr = child(dv, mdia, "hdlr");
      if (!hdlr || fourcc(dv, hdlr.body + 8) !== "soun") continue;
      const st = child(dv, child(dv, mdia, "minf"), "stbl");
      const stsd = child(dv, st, "stsd");
      if (!stsd || dv.getUint32(stsd.body + 4) < 1) continue;
      if (COPYABLE.indexOf(fourcc(dv, stsd.body + 12)) < 0) continue;
      trak = t; stbl = st; tkhd = child(dv, t, "tkhd");
      break;
    }
    if (!trak) return null;
    const ch = chunksOf(dv, stbl);
    if (!ch || !ch.offsets.length) return null;
    const dataBytes = ch.sizes.reduce((a, b) => a + b, 0);
    if (!dataBytes) return null;
    for (let i = 0; i < ch.offsets.length; i++) {
      if (ch.offsets[i] + ch.sizes[i] > blob.size) return null;   // a cut-off file
    }

    const ftyp = new Uint8Array([0, 0, 0, 28, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0,
      0x4d, 0x34, 0x41, 0x20, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d]);   // M4A , M4A  mp42 isom
    const moovSize = 8 + mvhd.size + trak.size;
    const out = new Uint8Array(moovSize);
    const ov = new DataView(out.buffer);
    ov.setUint32(0, moovSize);
    out.set([0x6d, 0x6f, 0x6f, 0x76], 4);
    out.set(buf.subarray(mvhd.off, mvhd.off + mvhd.size), 8);
    const trakAt = 8 + mvhd.size;
    out.set(buf.subarray(trak.off, trak.off + trak.size), trakAt);

    // The movie lasts as long as the sound, not as long as the picture did.
    if (tkhd) {
      const tv = dv.getUint8(tkhd.body), mv = dv.getUint8(mvhd.body);
      const dur = tv === 1 ? dv.getBigUint64(tkhd.body + 28) : BigInt(dv.getUint32(tkhd.body + 20));
      const mAt = 8 + (mvhd.body - mvhd.off);
      if (mv === 1) ov.setBigUint64(mAt + 24, dur);
      else if (dur <= 0xffffffffn) ov.setUint32(mAt + 16, Number(dur));
    }

    const big = dataBytes + 8 > 0xffffffff;
    const mdatHead = new Uint8Array(big ? 16 : 8);
    const hv = new DataView(mdatHead.buffer);
    if (big) { hv.setUint32(0, 1); hv.setBigUint64(8, BigInt(dataBytes + 16)); }
    else hv.setUint32(0, dataBytes + 8);
    mdatHead.set([0x6d, 0x64, 0x61, 0x74], 4);

    // The chunks, end to end, and the table that says where each one now is.
    const at = trakAt + (ch.stco.body - trak.off) + 8;
    let pos = ftyp.length + moovSize + mdatHead.length;
    const parts = [ftyp, out, mdatHead];
    for (let i = 0; i < ch.offsets.length; i++) {
      if (ch.wide) ov.setBigUint64(at + i * 8, BigInt(pos));
      else {
        if (pos > 0xffffffff) return null;
        ov.setUint32(at + i * 4, pos);
      }
      parts.push(blob.slice(ch.offsets[i], ch.offsets[i] + ch.sizes[i]));
      pos += ch.sizes[i];
    }
    return new Blob(parts, { type: "audio/mp4" });
  }

  /* Anything that can't be copied: the browser's own decoder, then a 16-bit
     WAV. Needs the whole file in memory, so a huge one is refused with a
     reason rather than crashing the tab. */
  async function wavOf(blob) {
    if (blob.size > WAV_SOURCE_MAX) throw new Error("This video is too big to take the sound out of here. Trim it shorter first.");
    const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
    if (!Ctx) throw new Error("This browser can't save sound on its own.");
    const ctx = new Ctx(2, 1, 48000);
    const data = await blob.arrayBuffer();
    const audio = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(data, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    }).catch(() => { throw new Error("This video doesn't seem to have any sound to save."); });
    return encodeWav(audio);
  }

  function encodeWav(audio) {
    const ch = Math.min(2, audio.numberOfChannels), rate = audio.sampleRate, frames = audio.length;
    const planes = [];
    for (let c = 0; c < ch; c++) planes.push(audio.getChannelData(c));
    const bytes = frames * ch * 2;
    const head = new DataView(new ArrayBuffer(44));
    const str = (o, s) => { for (let i = 0; i < 4; i++) head.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); head.setUint32(4, 36 + bytes, true); str(8, "WAVE");
    str(12, "fmt "); head.setUint32(16, 16, true); head.setUint16(20, 1, true); head.setUint16(22, ch, true);
    head.setUint32(24, rate, true); head.setUint32(28, rate * ch * 2, true); head.setUint16(32, ch * 2, true); head.setUint16(34, 16, true);
    str(36, "data"); head.setUint32(40, bytes, true);
    // a few seconds at a time, so an hour never needs one enormous array
    const parts = [head.buffer];
    const STEP = 262144;
    for (let f = 0; f < frames; f += STEP) {
      const n = Math.min(STEP, frames - f);
      const pcm = new Int16Array(n * ch);
      for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) {
          const v = Math.max(-1, Math.min(1, planes[c][f + i]));
          pcm[i * ch + c] = v < 0 ? v * 32768 : v * 32767;
        }
      }
      parts.push(pcm.buffer);
    }
    return new Blob(parts, { type: "audio/wav" });
  }

  const EXT = {
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
    "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/ogg": "ogg", "audio/opus": "opus",
    "audio/flac": "flac", "audio/x-flac": "flac", "audio/webm": "webm", "audio/aiff": "aiff", "audio/x-aiff": "aiff"
  };
  function extOf(file) {
    const named = (String((file && file.name) || "").match(/\.([a-z0-9]{2,5})$/i) || [])[1];
    if (named) return named.toLowerCase();
    return EXT[String((file && file.type) || "").split(";")[0].toLowerCase()] || "audio";
  }

  // Characters every system accepts in a file name, as the export does.
  function safeName(name) {
    const s = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
    return s || "vclyps-audio";
  }

  /* The file to download for a Your audio item: {blob, name, how}, where how
     is "original" (an audio file as it came), "copied" (a video's sound,
     byte for byte) or "decoded" (a WAV). */
  async function soundFile(item) {
    const src = item.file || (await (await fetch(item.url)).blob());
    const base = safeName(item.name);
    if (!item.fromVideo && item.type !== "video") return { blob: src, name: base + "." + extOf(src), how: "original" };
    let m4a = null;
    try { m4a = await m4aOf(src); } catch (e) { m4a = null; }
    if (m4a) return { blob: m4a, name: base + ".m4a", how: "copied" };
    return { blob: await wavOf(src), name: base + ".wav", how: "decoded" };
  }

  global.VevrisAudioOut = {
    soundFile: soundFile,
    // exported for the tests
    _m4aOf: m4aOf,
    _encodeWav: encodeWav,
    _safeName: safeName,
    _extOf: extOf
  };
})(window);
