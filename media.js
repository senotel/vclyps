/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — b-roll: GIFs, photos and stock video
   The editing app by Vevris.

   Finds a clip or image for a phrase and hands back something the editor can
   drop straight onto the timeline. Two sources, one shape:

     Klipy   GIFs, memes, stickers   (lifetime free)
     Pexels  photos + stock video    (free, no attribution required)

   Both go through the Cloudflare worker, never direct. Two reasons, and the
   second is the one that bites:

     1. the API keys must not exist in client code at all — Klipy puts its key
        in the URL PATH, so a direct call would publish it to every viewer;

     2. THE EXPORT. drawExportFrame() paints each frame onto a canvas and
        MediaRecorder captures it. Painting a cross-origin image onto that
        canvas TAINTS it, and captureStream() then throws — the export silently
        produces no file whatsoever. Relaying the bytes through the worker and
        holding them as a blob makes every asset same-origin, so it behaves
        exactly like footage the user uploaded: it can be trimmed, undone, and
        restored by the session-resume, and it can never break the exporter.

   Format choice matters just as much. An animated GIF drawn to a canvas comes
   out as ONE FROZEN FRAME, so a GIF b-roll would export as a still. Klipy
   offers mp4 and webm next to the gif, and pickFormat() always prefers those —
   the same asset then rides the normal video path and exports properly.

   Exposes window.VevrisBroll.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function proxy() {
    try {
      return (global.IntelligenceEngine && global.IntelligenceEngine.proxy()) || "";
    } catch (e) { return ""; }
  }

  const available = () => !!proxy();

  /* ═══════════ FORMAT CHOICE ═══════════ */

  /* Video beats still, always — see the header. Within video, webm is usually a
     fraction of the mp4's size for identical content, but Safari has never
     reliably decoded VP8/VP9 in webm, so mp4 leads and webm is the fallback. */
  const VIDEO_ORDER = ["mp4", "webm"];
  const STILL_ORDER = ["webp", "gif", "jpg"];

  /* Klipy sizes, biggest first. "md" leads rather than "hd": b-roll plays for a
     second or two inside someone else's frame, so hd is mostly wasted bytes on
     a phone connection — but take hd if md is missing. */
  const KLIPY_SIZES = ["md", "hd", "sm", "xs"];

  function pickKlipy(item) {
    const f = item && item.file;
    if (!f) return null;
    for (const size of KLIPY_SIZES) {
      const bucket = f[size];
      if (!bucket) continue;
      for (const fmt of VIDEO_ORDER.concat(STILL_ORDER)) {
        const v = bucket[fmt];
        if (v && v.url) {
          return {
            url: v.url,
            w: v.width || 0,
            h: v.height || 0,
            bytes: v.size || 0,
            kind: VIDEO_ORDER.indexOf(fmt) >= 0 ? "video" : "image"
          };
        }
      }
    }
    return null;
  }

  /* Pexels video: the SMALLEST rendition that still looks fine, not the best
     one available. These are full stock clips, so grabbing 720p pulled 16 MB for
     a two-second cutaway — the whole clip downloads even though the edit keeps a
     moment of it. Anything from 540p up survives being cropped into a vertical
     frame, and costs a fraction of the bytes on a phone connection. */
  const MIN_VIDEO_H = 540;

  function pickPexelsVideo(item) {
    const files = ((item && item.video_files) || [])
      .filter((f) => f && f.link && (!f.file_type || f.file_type.indexOf("mp4") >= 0));
    if (!files.length) return null;
    const big = files.filter((f) => (f.height || 0) >= MIN_VIDEO_H);
    // smallest of the acceptable ones; if none qualify, the largest we have
    const best = big.length
      ? big.reduce((a, b) => ((b.height || 0) < (a.height || 0) ? b : a))
      : files.reduce((a, b) => ((b.height || 0) > (a.height || 0) ? b : a));
    return { url: best.link, w: best.width || 0, h: best.height || 0, bytes: 0, kind: "video" };
  }

  function pickPexelsPhoto(item) {
    const s = (item && item.src) || {};
    const url = s.portrait || s.large || s.medium || s.original;
    if (!url) return null;
    return { url: url, w: item.width || 0, h: item.height || 0, bytes: 0, kind: "image" };
  }

  /* ═══════════ SEARCH ═══════════ */

  async function ask(path) {
    const res = await fetch(proxy().replace(/\/+$/, "") + path);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const msg = (json && json.error && json.error.message) || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return json;
  }

  /* kind: "gif" | "photo" | "video". Returns a normalised list; never throws
     for an empty result, only for a real failure the status line should show. */
  async function search(query, kind, limit) {
    if (!available()) throw new Error("b-roll needs the vClyps worker (PROXY_URL is empty)");
    const q = String(query || "").trim().slice(0, 100);
    if (!q) return [];
    const n = Math.min(Math.max(limit || 8, 1), 24);

    if (kind === "gif") {
      const j = await ask("/klipy?q=" + encodeURIComponent(q) + "&limit=" + n);
      const items = (j && j.data && j.data.data) || [];
      return items.map((it) => {
        const f = pickKlipy(it);
        return f && {
          source: "klipy", id: it.id, title: it.title || q,
          kind: f.kind, url: f.url, w: f.w, h: f.h, bytes: f.bytes
        };
      }).filter(Boolean);
    }

    const isVideo = kind === "video";
    const j = await ask("/pexels?q=" + encodeURIComponent(q) + "&limit=" + n + (isVideo ? "&type=video" : ""));
    const items = (j && (j.videos || j.photos)) || [];
    return items.map((it) => {
      const f = isVideo ? pickPexelsVideo(it) : pickPexelsPhoto(it);
      return f && {
        source: "pexels", id: it.id, title: it.alt || (it.user && it.user.name) || q,
        kind: f.kind, url: f.url, w: f.w, h: f.h, bytes: f.bytes,
        duration: it.duration || 0
      };
    }).filter(Boolean);
  }

  /* ═══════════ DOWNLOAD ═══════════ */

  const MAX_BYTES = 25 * 1024 * 1024;   // a cutaway is seconds long; anything huge is a mistake

  /* Pull the bytes through the worker and hand back a local blob URL. This is
     the step that keeps the export working — see the header. */
  async function toLocalFile(hit) {
    if (!hit || !hit.url) throw new Error("nothing to download");
    const res = await fetch(proxy().replace(/\/+$/, "") + "/media?url=" + encodeURIComponent(hit.url));
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try { const j = JSON.parse(await res.text()); if (j.error) msg = j.error.message; } catch (e) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (blob.size > MAX_BYTES) throw new Error("b-roll file too large (" + Math.round(blob.size / 1048576) + " MB)");
    if (!blob.size) throw new Error("b-roll download was empty");
    return {
      blob: blob,
      url: URL.createObjectURL(blob),
      type: hit.kind,                 // "video" | "image"
      name: (hit.title || "b-roll").slice(0, 40),
      w: hit.w, h: hit.h,
      source: hit.source
    };
  }

  /* ═══════════ RELEVANCE ═══════════
     A wrong GIF is worse than no GIF. It reads as the editor not understanding
     the video, which is precisely the impression this whole feature exists to
     avoid — so anything that cannot be tied back to what was asked for is
     dropped, and the moment simply plays uncut. */

  const STOP = Object.create(null);
  ("a an the of and or to in on for with at is it its this that these those " +
   "be being been am are was were do does did doing my your his her their our " +
   "some any very really just so as by from into about over under out up down " +
   // what the thing IS rather than what it shows: the Director writes "shocked
   // reaction gif", and no GIF's title says "gif"
   "gif gifs meme memes photo photos picture image video videos clip clips stock footage"
  ).split(" ").forEach(function (w) { STOP[w] = true; });

  /* Words that mean the same thing in a GIF title. Titles are written by
     whoever uploaded the GIF, so "happy dog" comes back as "Smiling Dog" and
     "shocked" as "Stunned" or "OMG"; matching the letters alone threw those
     away and kept whatever merely shared a word. Each family is read as one
     word. Small on purpose: the reactions short-form actually uses. */
  const FAMILIES = [
    "shocked shock shocking surprised surprise stunned omg gasp gasping speechless jaw",
    "happy smiling smile joy joyful glad cheerful",
    "excited excitement hype hyped yay celebrate celebrating celebration party",
    "sad crying cry cries tears sobbing upset",
    "angry mad rage furious annoyed",
    "confused confusion huh puzzled",
    "laugh laughing lol funny hilarious lmao",
    "mind blown blowing explode exploding",
    "facepalm facepalming",
    "money cash rich dollars dollar bills",
    "scared afraid fear terrified horror",
    "awkward cringe cringing embarrassed",
    "clap clapping applause applauding",
    "thinking think hmm pondering",
    "bored boring yawn tired sleepy",
    "dance dancing dances"
  ];
  const FAMILY = Object.create(null);
  FAMILIES.forEach(function (line) {
    const ws = line.split(" ");
    ws.forEach(function (w) { FAMILY[w] = ws[0]; });
  });

  function meaningful(text) {
    return String(text || "").toLowerCase().split(/[^a-z0-9]+/)
      .filter(function (w) { return w.length > 2 && !STOP[w]; })
      .map(function (w) { return FAMILY[w] || w; });
  }

  /* What FRACTION of the query survives in the result's title, 0..1.

     A single shared word is not enough — "completely unrelatable nonsense" and
     "Completely Optional Btw Tiktok" share one, and that is how junk gets in.
     Half is the bar: it tolerates the noise real GIF titles carry ("Byuntear
     Cachorro Smiling Dog" still matches "happy dog" on one of two words) while
     rejecting a clip that merely brushed against one term. */
  function relevance(query, title) {
    const q = meaningful(query);
    if (!q.length) return 1;                    // nothing to check against
    const t = " " + meaningful(title).join(" ") + " ";
    let hit = 0;
    for (var i = 0; i < q.length; i++) {
      // plurals and simple stems: "reaction"/"reactions", "shock"/"shocking"
      if (t.indexOf(" " + q[i]) >= 0 ||
          (q[i].length > 4 && t.indexOf(" " + q[i].slice(0, -1)) >= 0)) hit++;
    }
    return hit / q.length;
  }

  const MIN_RELEVANCE = 0.5;
  const relevant = (query, title) => relevance(query, title) >= MIN_RELEVANCE;

  /* Search and fetch in one call — what the Director path uses. Returns null
     rather than throwing when nothing matches, because a missing b-roll clip
     must never take down an otherwise good edit.
     `say` is the line the cutaway illustrates. It never lets a result in on
     its own, but between two that both match the search, the one whose title
     also matches what is being said wins. Klipy and Pexels rank by their own
     search engines, which are better than a title can show, so their order
     breaks the remaining ties. */
  function rank(hits, query, say) {
    const n = Math.max(1, hits.length);
    return hits
      .map(function (h, i) {
        const q = relevance(query, h.title);
        return { hit: h, q: q, score: q + (say ? 0.4 * relevance(say, h.title) : 0) + 0.3 * (1 - i / n) };
      })
      .filter(function (x) { return x.q >= MIN_RELEVANCE; })
      .sort(function (a, b) { return b.score - a.score; })
      .map(function (x) { return x.hit; });
  }

  async function find(query, kind, say) {
    try {
      const hits = await search(query, kind, 12);
      const good = rank(hits, query, say);
      if (!good.length) {
        if (global.VevrisDiag) {
          global.VevrisDiag.last.broll = 'nothing relevant for "' + query + '" — skipped';
        }
        return null;                            // no b-roll beats wrong b-roll
      }
      for (const hit of good) {
        try { return await toLocalFile(hit); } catch (e) { /* try the next one */ }
      }
    } catch (e) {
      if (global.VevrisDiag) global.VevrisDiag.last.broll = (e && e.message) || String(e);
    }
    return null;
  }

  global.VevrisBroll = {
    available: available,
    relevant: relevant,
    relevance: relevance,
    rank: rank,
    search: search,
    toLocalFile: toLocalFile,
    find: find
  };
})(window);
