/* vClyps landing, the experience (0.68.0)
   Two things, both drawn with plain elements and transforms, no libraries:

   1. The hero's wall of shorts (#lpWall): columns of finished vertical videos
      drifting past, as Prime Video's wall of posters says "this is a place
      full of films" before a word is read.
   2. The show (#lpShow): a tall section whose stage stays pinned while you
      scroll through it. Scroll IS the edit's clock:
        raw    the pieces of a shoot float loose: clips, spoken words, a
               voice, a song
        build  they fly onto a timeline and snap into their tracks
        cut    the playhead runs, the dull parts and the filler words drop
               out, the rest closes up
        fold   the timeline folds into a phone playing the finished short
        wall   that phone becomes one of a wall of shorts
      Nothing is hijacked: the page scrolls as normal, so scrolling back
      plays it backwards. With reduced motion it is one still frame.

   The tiles are placeholders made of colour and caption type. When real
   footage exists, give a tile a picture with SHORTS[i].img (a still or a
   poster frame) and it is used as the background. */
(function () {
  "use strict";
  var home = document.getElementById("screen-home");
  if (!home) return;
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ── the shorts ──
     Real footage (0.70.0): free Pexels stock, edited in NO UPLOAD/stock/make.mjs
     (one grade, stabilised, seamless 3.2 s loops, 320x568). Each has a poster
     (v.webp, shown at once) and a loop (v.mp4) that only plays while on
     screen, never with reduced motion or data saver. Captions are what the
     clip shows, written the way creators caption; no names, counts or likes. */
  var MEDIA = "site/wall/";
  var SHORTS = [
    { t: "he finally landed it", hi: 2, v: "skate" },
    { t: "dinner in 10 minutes", hi: 2, v: "cook" },
    { t: "first time baking these", hi: 2, v: "cupcake" },
    { t: "we learned it in a day", hi: 3, v: "dance" },
    { t: "the drop was unreal", hi: 1, v: "fest" },
    { t: "wrote this last night", hi: 0, v: "guitar" },
    { t: "day 3 on the trail", hi: 1, v: "hike" },
    { t: "100 shots before school", hi: 1, v: "hoop" },
    { t: "my first latte heart", hi: 3, v: "latte" },
    { t: "painting every single day", hi: 2, v: "paint" },
    { t: "best beach day ever", hi: 1, v: "picnic" },
    { t: "meet the new puppy", hi: 3, v: "puppy" },
    { t: "biggest wave so far", hi: 1, v: "surf" },
    { t: "ride to work with me", hi: 0, v: "bike" },
    { t: "one more try", hi: 2, v: "laugh" }
  ];
  var CAPS = ["cap-punch", "cap-box", "cap-serif", "cap-outline", "cap-marker", "cap-mono", "cap-karaoke", "cap-bubble", "cap-block", "cap-quiet"];
  var saveData = !!(navigator.connection && navigator.connection.saveData);
  // loops play only while they are on screen (and the home page is showing)
  var playing = [];
  var watch = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { e.target._seen = e.isIntersecting; tend(e.target); });
  }, { root: home, rootMargin: "80px" }) : null;
  function canPlay() { return !still.matches && !saveData && !document.hidden && document.body.dataset.screen === "home"; }
  function tend(v) {
    if (v._seen && canPlay()) {
      if (!v.src) v.src = v.dataset.src;
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () {});
    } else if (!v.paused) v.pause();
  }
  function tendAll() { playing.forEach(tend); }
  function loop(src, poster) {
    var v = document.createElement("video");
    v.muted = true; v.loop = true; v.playsInline = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("aria-hidden", "true");
    v.preload = "none"; v.poster = poster; v.dataset.src = src;
    playing.push(v);
    if (watch) watch.observe(v);
    return v;
  }
  function short(i, moving) {
    var s = SHORTS[i % SHORTS.length];
    var el = document.createElement("div");
    // ten caption styles, spread so neighbours differ (landing.css .cap-*)
    el.className = "lp-short has-media " + CAPS[(i * 3 + Math.floor(i / 5)) % CAPS.length];
    el.style.backgroundImage = "url(" + MEDIA + s.v + ".webp)";
    if (moving) el.appendChild(loop(MEDIA + s.v + ".mp4", MEDIA + s.v + ".webp"));
    var cap = document.createElement("div");
    cap.className = "lp-short-cap";
    s.t.split(" ").forEach(function (w, k) {
      var span = document.createElement("span");
      span.textContent = w;
      if (k === s.hi) span.className = "hi";
      cap.appendChild(span);
      cap.appendChild(document.createTextNode(" "));
    });
    var bar = document.createElement("i");
    bar.className = "lp-short-bar";
    bar.style.setProperty("--done", (20 + ((i * 37) % 70)) + "%");
    el.appendChild(cap);
    el.appendChild(bar);
    return el;
  }
  new MutationObserver(tendAll).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  document.addEventListener("visibilitychange", tendAll);
  if (still.addEventListener) still.addEventListener("change", tendAll);

  /* ── 1. the wall ── */
  var wall = document.getElementById("lpWall");
  if (wall) {
    var cols = 4;
    for (var c = 0; c < cols; c++) {
      var col = document.createElement("div");
      col.className = "lp-wall-col" + (c % 2 ? " is-down" : "");
      col.style.setProperty("--dur", (46 + c * 9) + "s");
      var strip = document.createElement("div");
      strip.className = "lp-wall-strip";
      // the column twice over, so the loop has no seam
      for (var rep = 0; rep < 2; rep++) for (var r = 0; r < 5; r++) strip.appendChild(short(c * 4 + r, true));
      col.appendChild(strip);
      wall.appendChild(col);
    }
  }

  /* ── 2. the show ── */
  var show = document.getElementById("lpShow");
  var stage = document.getElementById("lpStage");
  if (!show || !stage) return;
  var says = Array.prototype.slice.call(show.querySelectorAll(".lp-show-say p"));
  var bar = document.getElementById("lpShowBar");

  var CLIPS = [
    // one shoot, six takes: fold, a wait, the throw, again, a wait, made it
    { name: "IMG_4821.MOV", d: 3.2, img: "fold", keep: true },
    { name: "IMG_4822.MOV", d: 2.1, img: "wait", keep: false },
    { name: "IMG_4825.MOV", d: 3.8, img: "throw", keep: true },
    { name: "IMG_4827.MOV", d: 2.6, img: "again", keep: true },
    { name: "IMG_4830.MOV", d: 2.4, img: "idle", keep: false },
    { name: "IMG_4831.MOV", d: 2.9, img: "made", keep: true }
  ];
  var WORDS = [
    { w: "fold it", clip: 0, keep: true }, { w: "right", clip: 0, keep: true },
    { w: "um", clip: 1, keep: false },
    { w: "and throw", clip: 2, keep: true }, { w: "nope", clip: 2, keep: true },
    { w: "one more", clip: 3, keep: true },
    { w: "like", clip: 4, keep: false },
    { w: "made it!", clip: 5, keep: true }
  ];
  var RAW = CLIPS.reduce(function (a, c) { return a + c.d; }, 0);
  var KEPT = CLIPS.reduce(function (a, c) { return a + (c.keep ? c.d : 0); }, 0);

  function mk(cls, html) {
    var el = document.createElement("div");
    el.className = cls;
    if (html != null) el.innerHTML = html;
    stage.appendChild(el);
    return el;
  }
  function wave(n, seed) {
    var h = "";
    for (var i = 0; i < n; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var v = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55) * 0.6 + (seed / 233280) * 0.4);
      h += '<i style="height:' + Math.round(v * 100) + '%"></i>';
    }
    return h;
  }

  // lanes and ruler, under everything
  var lanes = ["text", "video", "voice", "music"].map(function (k) { return mk("lp-lane lp-lane-" + k); });
  var ruler = mk("lp-ruler");
  for (var s = 0; s <= 16; s += 2) ruler.innerHTML += "<span class=\"" + (s % 4 ? "is-odd" : "") + "\" style=\"left:" + (s / 16 * 100) + "%\">00:" + (s < 10 ? "0" : "") + s + "</span>";
  var clipEls = CLIPS.map(function (c) {
    return mk("lp-clip", "<b>" + c.name + "</b><em>0:0" + Math.round(c.d) + "</em>");
  });
  clipEls.forEach(function (el, i) { el.style.backgroundImage = "linear-gradient(180deg, rgba(0,0,0,0.42), rgba(0,0,0,0) 48%), url(site/story/" + CLIPS[i].img + ".webp)"; });
  var wordEls = WORDS.map(function (w) { return mk("lp-word" + (w.keep ? "" : " is-filler"), w.w); });
  var voice = mk("lp-voice", '<span>Voice</span><div class="lp-wave">' + wave(90, 7) + "</div>");
  var music = mk("lp-music", '<span>Music</span><div class="lp-wave">' + wave(70, 31) + "</div>");
  var playhead = mk("lp-playhead");
  var phone = mk("lp-phone-f");
  var phoneScreen = document.createElement("div");
  phoneScreen.className = "lp-phone-s";
  phone.appendChild(phoneScreen);
  // the finished short: the five best moments of the shoot, cut and graded (story/short.mp4)
  var heroShort = document.createElement("div");
  heroShort.className = "lp-short has-media is-hero";
  heroShort.style.backgroundImage = "url(site/story/short.webp)";
  var shortVid = loop("site/story/short.mp4", "site/story/short.webp");
  heroShort.appendChild(shortVid);
  heroShort.insertAdjacentHTML("beforeend", '<div class="lp-short-cap"><span class="lp-live"></span></div>');
  phoneScreen.appendChild(heroShort);
  var live = heroShort.querySelector(".lp-live");
  var tiles = [];   // made in layout(), as many as the screen needs
  /* The field's footage (0.71.3): 1,510 different videos, one frame each
     (free Pexels stock; NO UPLOAD/stock/field2/build.mjs drops siblings from
     one shoot and any picture that looks like another), one sprite sheet of
     64x114 frames, 40 across. Loaded only when the show is reached.
     No image appears twice: every cell maps to its own frame (cellFrame), and
     the pull-back stops before the screen holds more cells than there are
     frames (layout: FC, FR). The 15 captioned clips are not in the sheet. */
  var ATLAS = { src: "site/field.webp", n: 1510, cols: 40, w: 64, h: 114 };
  var FC = 1, FR = 1;   // the field's half width and half height in cells, set in layout()
  ATLAS.rows = Math.ceil(ATLAS.n / ATLAS.cols);
  var atlas = new Image(), atlasTiles = [], atlasAwake = false;
  atlas.decoding = "async";
  function wakeAtlas() {
    if (atlasAwake) return;
    atlasAwake = true;
    atlas.src = ATLAS.src;
    atlasTiles.forEach(function (el) { el.style.backgroundImage = "url(" + ATLAS.src + ")"; });
  }
  /* A frame for a grid cell, never the same for two cells: the cells are
     numbered row by row inside the field's rectangle (fewer than n of them),
     and the number is multiplied by 389 mod n, which only reorders 0..n-1
     (389 shares no factor with 1510), so neighbours look unrelated. */
  function cellFrame(c, r) {
    if (Math.abs(c) > FC || Math.abs(r) > FR) return -1;
    var idx = (r + FR) * (2 * FC + 1) + (c + FC);
    return (idx * 389) % ATLAS.n;
  }
  function paintAtlasTile(el) {
    var f = cellFrame(el._c, el._r);
    if (f < 0) { el.style.visibility = "hidden"; return; }
    el.style.visibility = "";
    var x = f % ATLAS.cols, y = Math.floor(f / ATLAS.cols);
    el.style.backgroundPosition = (x / (ATLAS.cols - 1) * 100).toFixed(4) + "% " + (y / (ATLAS.rows - 1) * 100).toFixed(4) + "%";
  }
  function atlasTile(c, r) {
    var el = document.createElement("div");
    el.className = "lp-short lp-atlas";
    el._c = c; el._r = r;
    el.style.backgroundSize = ATLAS.cols * 100 + "% " + ATLAS.rows * 100 + "%";
    if (atlasAwake) el.style.backgroundImage = "url(" + ATLAS.src + ")";
    atlasTiles.push(el);
    return el;
  }
  var nearUsed = 0;

  /* ── maths ── */
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  var ease = function (x) { x = clamp(x, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  var mix = function (a, b, k) { return a + (b - a) * k; };
  var span = function (p, a, b) { return clamp((p - a) / (b - a), 0, 1); };
  function rnd(i, k) { var x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); }

  var W = 0, H = 0, L = null;
  function layout() {
    W = stage.clientWidth; H = stage.clientHeight;
    var narrow = W < 700;
    var tlX = W * (narrow ? 0.04 : 0.08), tlW = W - tlX * 2;
    var vh = clamp(H * 0.17, 48, 130), th = clamp(H * 0.075, 26, 52), ah = clamp(H * 0.1, 34, 76);
    var gap = clamp(H * 0.016, 6, 14);
    var top = (H - (th + vh + ah * 2 + gap * 3)) / 2 + 14;   // the timeline sits in the middle
    stage.style.setProperty("--th", th.toFixed(1) + "px");
    var y = { ruler: top - 26, text: top, video: top + th + gap, voice: top + th + vh + gap * 2, music: top + th + vh + ah + gap * 3 };
    var pH = H * 0.96, pW = Math.min(pH * 9 / 19.5, W * 0.7); pH = pW * 19.5 / 9;
    // the wall: small tiles, enough of them to run past every edge of the screen
    var tf = clamp(W / (narrow ? 6.5 : 13), 56, 120), tg = tf * 0.12, tfh = tf * 16 / 9;
    var pinH = stage.parentNode.clientHeight;
    var cols = Math.ceil(W / (tf + tg)) + 2, rows = Math.ceil(pinH * 1.25 / (tfh + tg)) + 2;
    if (cols % 2 === 0) cols++; if (rows % 2 === 0) rows++;
    // how far the field may pull back: until the screen would need more cells than there are frames
    var zEnd = narrow ? 0.34 : 0.24;
    for (;;) {
      FC = Math.ceil(W / 2 / ((tf + tg) * zEnd)) + 1;
      FR = Math.ceil(pinH * 0.66 / ((tfh + tg) * zEnd)) + 2;   // +2: columns slide up to a tile apart
      if ((2 * FC + 1) * (2 * FR + 1) <= ATLAS.n || zEnd >= 1) break;
      zEnd *= 1.04;
    }
    // the wall mixes its clips, so no column repeats one
    // the tiles near the phone are the 15 captioned clips, each once; the rest come from the field's 815
    while (tiles.length < cols * rows) {
      var ti = tiles.length, tc = ti % cols - Math.floor(cols / 2), tr = Math.floor(ti / cols) - Math.floor(rows / 2);
      var near = Math.abs(tc) <= 2 && Math.abs(tr) <= 1 && nearUsed < SHORTS.length;
      var nt = near ? short(nearUsed++, false) : atlasTile(tc, tr);
      nt.classList.add("lp-tile"); stage.insertBefore(nt, phone); tiles.push(nt);
    }
    atlasTiles.forEach(paintAtlasTile);   // the field's rectangle may have changed size
    L = { narrow: narrow, tlX: tlX, tlW: tlW, vh: vh, th: th, ah: ah, y: y, pps: tlW / RAW, pW: pW, pH: pH, px: (W - pW) / 2, py: (H - pH) / 2,
      tf: tf, tg: tg, tfh: tfh, cols: cols, rows: rows, zEnd: zEnd };
    lanes[0].style.cssText = box(tlX, y.text, tlW, th);
    lanes[1].style.cssText = box(tlX, y.video, tlW, vh);
    lanes[2].style.cssText = box(tlX, y.voice, tlW, ah);
    lanes[3].style.cssText = box(tlX, y.music, tlW, ah);
    ruler.style.cssText = box(tlX, y.ruler, tlW, 20);
    // where each piece starts, loose in the air
    L.loose = function (i, kind) {
      var a = rnd(i, kind), b = rnd(i, kind + 9);
      return { x: W * (0.06 + a * 0.78), y: H * (0.1 + b * 0.62), r: (rnd(i, kind + 3) - 0.5) * 26 };
    };
  }
  function box(x, y, w, h) { return "transform:translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px);width:" + w.toFixed(1) + "px;height:" + h.toFixed(1) + "px;"; }

  function place(el, x, y, w, h, r, sc, o) {
    el.style.transform = "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) rotate(" + (r || 0).toFixed(2) + "deg) scale(" + (sc == null ? 1 : sc).toFixed(3) + ")";
    // size only when it changes: a width or height write costs a layout, a transform does not
    if (w != null) { var ws = w.toFixed(1); if (el._w !== ws) { el._w = ws; el.style.width = ws + "px"; } }
    if (h != null) { var hs = h.toFixed(1); if (el._h !== hs) { el._h = hs; el.style.height = hs + "px"; } }
    var os = o == null ? "1" : o.toFixed(3);
    if (el._o !== os) { el._o = os; el.style.opacity = os; }
  }

  var clock = 0;
  /* The ending (0.70.2): the show is longer (760vh, was 560vh). The original
     story keeps its pace in the first 74% (p = pAll x STRETCH); the rest is
     the pull-back, the wall shrinking into a field of hundreds of videos, the
     far ones drawn on one canvas so it stays smooth. */
  var STRETCH = 760 / 560;
  var field = document.createElement("canvas");
  field.className = "lp-field";
  field.setAttribute("aria-hidden", "true");
  stage.parentNode.insertBefore(field, stage);
  var fx = field.getContext("2d"), fieldOn = false;
  function render(pAll) {
    var p = Math.min(1, pAll * STRETCH);
    var tail = ease(span(pAll, 0.70, 0.97));
    if (!L) layout();
    var t = clock / 1000;
    var fold = ease(span(p, 0.58, 0.7));   // the timeline folding into the phone
    var cut = ease(span(p, 0.42, 0.54));
    var cx = W / 2, cy = L.py + L.pH / 2;
    // toward the phone's centre, shrinking, as the fold happens
    function folded(x, y, w, h) {
      return { x: mix(x, cx - w * 0.1, fold), y: mix(y, cy - h * 0.1, fold), s: mix(1, 0.2, fold), o: 1 - span(fold, 0.5, 1) };
    }

    // tracks
    var lane = ease(span(p, 0.1, 0.24)) * (1 - span(fold, 0.2, 0.7));
    lanes.forEach(function (el) { el.style.opacity = lane.toFixed(3); });
    ruler.style.opacity = lane.toFixed(3);

    // clips: loose, then in place, then closed up
    var before = 0, kept = 0;
    CLIPS.forEach(function (c, i) {
      var el = clipEls[i], w = c.d * L.pps;
      var lo = L.loose(i, 1);
      var fly = ease(span(p, 0.12 + i * 0.02, 0.3 + i * 0.02));
      var sx = L.tlX + before * L.pps, sy = L.y.video;
      var ex = L.tlX + kept * L.pps;
      var bob = (1 - fly) * Math.sin(t * 1.1 + i) * 8;
      var x = mix(lo.x, sx, fly), y = mix(lo.y + bob, sy, fly);
      var o = 1, r = mix(lo.r, 0, fly), sc = mix(0.8, 1, fly);
      if (c.keep) x = mix(x, ex, cut);
      else { y += cut * L.vh * 1.4; r += cut * 8; o = 1 - cut; }
      var f = folded(x, y, w, L.vh);
      place(el, f.x, f.y, mix(w * 0.9, w, fly), L.vh, r, sc * f.s, o * f.o);
      before += c.d; if (c.keep) kept += c.d;
    });

    // spoken words: loose, then onto the text track over their clip, filler drops out
    var starts = [], acc = 0, accK = 0, startsK = [];
    CLIPS.forEach(function (c) { starts.push(acc); startsK.push(accK); acc += c.d; if (c.keep) accK += c.d; });
    var perClip = {}, lastRight = -1e9;
    WORDS.forEach(function (wd, i) {
      var el = wordEls[i];
      var n = perClip[wd.clip] = (perClip[wd.clip] || 0) + 1;
      var lo = L.loose(i, 2);
      var fly = ease(span(p, 0.16 + i * 0.018, 0.34 + i * 0.018));
      var sx = L.tlX + (starts[wd.clip] + (n - 1) * 1.4 + 0.15) * L.pps;
      var ex = L.tlX + (startsK[wd.clip] + (n - 1) * 1.4 + 0.15) * L.pps;
      var bob = (1 - fly) * Math.sin(t * 1.4 + i * 2) * 10;
      var x = mix(lo.x, sx, fly), y = mix(lo.y + bob, L.y.text + 2, fly), o = 1;
      if (wd.keep) x = mix(x, ex, cut);
      else { y -= cut * 30; o = 1 - cut; }
      // once on the track, a word never sits on top of the one before it
      var ws = L.narrow ? 0.7 : 1;
      if (fly > 0.9 && o > 0.5) { x = Math.max(x, lastRight + 4); lastRight = x + el.offsetWidth * ws; }
      var f = folded(x, y, 60, L.th);
      place(el, f.x, f.y, null, L.th - 4, mix(lo.r * 0.6, 0, fly), ws * f.s, o * f.o);
    });

    // voice and song: one each, they stretch onto their tracks, then fit the kept length
    [[voice, L.y.voice, 3], [music, L.y.music, 4]].forEach(function (a, k) {
      var lo = L.loose(k, a[2]);
      var fly = ease(span(p, 0.2 + k * 0.04, 0.38 + k * 0.04));
      var bob = (1 - fly) * Math.sin(t + k * 3) * 9;
      var w = mix(L.tlW * 0.3, L.tlW, fly) * mix(1, KEPT / RAW, cut);
      var x = mix(lo.x, L.tlX, fly), y = mix(lo.y + bob, a[1], fly);
      var f = folded(x, y, w, L.ah);
      place(a[0], f.x, f.y, w, L.ah, mix(lo.r * 0.5, 0, fly), f.s, f.o);
    });

    // the playhead runs while the cut happens, and keeps running
    var ph = span(p, 0.3, 0.58), run = (t * 0.12) % 1;
    var phx = L.tlX + (ph > 0 && ph < 1 ? ph : run) * (cut > 0.5 ? KEPT : RAW) * L.pps;
    place(playhead, phx, L.y.ruler, 2, L.y.music + L.ah - L.y.ruler, 0, 1, lane);

    // the phone: grows out of the fold, then becomes one tile of the wall
    var ph1 = ease(span(p, 0.6, 0.72));
    var wallK = ease(span(p, 0.76, 0.94));
    var cols = L.cols, tw = L.tf, thh = L.tfh, g = L.tg;
    // the wall settles back as it fills, then keeps pulling away into the field
    var zoom = mix(1.3, 1, wallK) * mix(1, L.zEnd, tail);
    var drift = function (col) { return (col % 2 ? 1 : -1) * tail * thh * 0.9; };   // neighbouring columns slide apart
    var pw = mix(L.pW, tw, wallK), phh = mix(L.pH, thh, wallK);
    var pS = mix(0.55, 1, ph1);
    var pz = wallK > 0 ? zoom : 1;
    place(phone, cx - pw * pS * pz / 2, cy - phh * pS * pz / 2 + drift(0) * pz, pw, phh, 0, pS * pz, ph1);
    phone.classList.toggle("is-tile", wallK > 0.5);
    // the caption the finished short is playing
    // captions cut with the short's own shots (make.mjs: 2.3 / 2.4 / 2.2 / 2.6 / 2.5 s)
    var vt = shortVid.currentTime || 0;
    var line = shortVid.paused && !vt ? "ONE MORE TRY" : vt < 2.3 ? "FOLD IT" : vt < 4.7 ? "AND THROW" : vt < 6.9 ? "ONE MORE TRY" : "MADE IT";
    if (live.textContent !== line) live.textContent = line;

    // the wall: tiles arrive from the phone's place outward, the whole wall zooms out
    var rows = L.rows;
    tiles.forEach(function (el, i) {
      if (i >= cols * rows) { el.style.opacity = 0; return; }
      var col = i % cols - Math.floor(cols / 2), row = Math.floor(i / cols) - Math.floor(rows / 2);
      if (col === 0 && row === 0) { el.style.opacity = 0; return; }   // the phone's own place
      var dist = Math.sqrt(col * col + row * row);
      var k = ease(span(wallK, Math.min(0.5, dist * 0.05), Math.min(0.5, dist * 0.05) + 0.4));
      var x = cx - tw / 2 + col * (tw + g), y = cy - thh / 2 + row * (thh + g);
      var bob = Math.sin(t * 0.6 + i) * 4 * k * (1 - tail);
      if (k <= 0) { el.style.opacity = 0; return; }
      place(el, cx + (x - cx) * zoom, cy + (y + bob + drift(col) - cy) * zoom, tw, thh, 0, zoom * mix(0.6, 1, k), k);
    });

    // the field: every cell beyond the DOM tiles, drawn once per frame on the canvas
    var fa = ease(span(pAll, 0.66, 0.76));
    if (fa > 0 || fieldOn) {
      var dpr = Math.min(1.5, window.devicePixelRatio || 1), FW = field.clientWidth, FH = field.clientHeight;
      if (field.width !== Math.round(FW * dpr) || field.height !== Math.round(FH * dpr)) { field.width = Math.round(FW * dpr); field.height = Math.round(FH * dpr); }
      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fx.clearRect(0, 0, FW, FH);
      fieldOn = fa > 0;
      if (fieldOn) {
        var oy = stage.offsetTop, hc = Math.floor(cols / 2), hr = Math.floor(rows / 2);
        var sx = (tw + g) * zoom, sy = (thh + g) * zoom, w0 = tw * zoom, h0 = thh * zoom;
        var nc = Math.ceil(W / 2 / sx) + 2, nr = Math.ceil(FH / sy) + 3;
        fx.globalAlpha = fa;
        for (var c2 = -nc; c2 <= nc; c2++) {
          var dy = drift(c2) * zoom;
          for (var r2 = -nr; r2 <= nr; r2++) {
            if (Math.abs(c2) <= hc && Math.abs(r2) <= hr) continue;   // a DOM tile is there
            var X = cx + c2 * sx - w0 / 2, Y = oy + cy + r2 * sy - h0 / 2 + dy;
            if (X > FW || X + w0 < 0 || Y > FH || Y + h0 < 0) continue;
            var fr = cellFrame(c2, r2);
            if (fr < 0) continue;
            if (atlas.complete && atlas.naturalWidth) fx.drawImage(atlas, (fr % ATLAS.cols) * ATLAS.w, Math.floor(fr / ATLAS.cols) * ATLAS.h, ATLAS.w, ATLAS.h, X, Y, w0, h0);
            else { fx.fillStyle = "#1c1c1c"; fx.fillRect(X, Y, w0, h0); }
          }
        }
        fx.globalAlpha = 1;
      }
    }

    // the words on screen
    var idx = p < 0.1 ? 0 : p < 0.36 ? 1 : p < 0.5 ? 2 : p < 0.6 ? 3 : p < 0.76 ? 4 : 5;
    says.forEach(function (el, i) { el.classList.toggle("is-on", i === idx); });
  }

  /* ── driving it ── */
  function progress() {
    var r = show.getBoundingClientRect(), h = home.clientHeight;
    return clamp(-r.top / Math.max(1, r.height - h), 0, 1);
  }
  var visible = false, raf = 0, last = -1;

  /* Autoplay, as lusion.co's astronaut scene (owner, 2026-11-01): scroll a
     little into the show and it plays by itself, with no progress bar.
     It plays in the direction the visitor last scrolled (0.71.4, owner:
     "if i scroll back the autoplay should play in reverse"): scroll down and
     it plays on; scroll up and it plays backwards, at the same pace, until
     they scroll down again. Their own scrolling always wins and adds to it.
     It stops at either end of the show and never runs with reduced motion.
     Smoothness (0.71.1): the picture eases toward the scroll position
     (shown += (target - shown) x (1 - e^(-k dt))) and the page is moved by
     fractions of a pixel, so it glides. */
  var PLAY_SECS = 34;                 // the whole show, start to end, untouched
  var auto = { on: false, pos: 0, dir: 1, touched: 0, expect: -1, seen: -1 };
  function autoplay(ts, dt) {
    var pr = progress();
    var range = Math.max(1, show.offsetHeight - home.clientHeight);
    if (pr <= 0 || pr >= 1) { auto.on = false; auto.touched = 0; return; }   // outside the show: nothing to play
    // the visitor scrolled inside the show: play on from there, in their direction
    if (auto.touched) { auto.on = true; auto.pos = home.scrollTop; auto.touched = 0; }
    if (!auto.on) return;
    // the far end in the direction of play: stop there
    if ((auto.dir > 0 && pr >= 0.995) || (auto.dir < 0 && pr <= 0.004)) { auto.on = false; return; }
    auto.pos += auto.dir * (range / PLAY_SECS) * Math.min(dt, 0.05);
    home.scrollTop = auto.pos;       // fractional: browsers keep sub-pixel scroll offsets
    auto.expect = home.scrollTop;
  }
  var lastTs = 0, shown = -1;
  // softer on touch: a finger's flick arrives in bursts, a wheel in small steps
  var coarse = window.matchMedia("(pointer: coarse)");
  var EASE_K = coarse.matches ? 7 : 12;
  if (coarse.addEventListener) coarse.addEventListener("change", function () { EASE_K = coarse.matches ? 7 : 12; });
  function frame(ts) {
    raf = 0;
    clock = ts || 0;
    var dt = lastTs ? (ts - lastTs) / 1000 : 0;
    lastTs = ts;
    if (!still.matches && document.body.dataset.screen === "home") autoplay(ts, dt);
    var target = progress();
    // ease toward the scroll position; snap when far away (a jump, a link, a resize)
    if (shown < 0 || Math.abs(target - shown) > 0.08) shown = target;
    else shown += (target - shown) * (1 - Math.exp(-EASE_K * Math.min(dt || 0.016, 0.05)));
    render(shown);
    var moving = Math.abs(target - shown) > 0.00005;
    if ((visible || moving) && !still.matches && !document.hidden) raf = requestAnimationFrame(frame);
    else lastTs = 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(frame); }

  function settle() {
    show.classList.toggle("is-still", still.matches);
    layout();
    if (still.matches) { clock = 0; render(0.5 / STRETCH); says.forEach(function (el, i) { el.classList.toggle("is-on", i === 2); }); }
    else kick();
  }
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (es) {
      visible = es[0].isIntersecting;
      if (visible) wakeAtlas();
      document.body.classList.toggle("lp-cinema", visible && es[0].intersectionRatio > 0);
      if (visible) kick();
    }, { root: home, threshold: [0, 0.02] }).observe(show);
  } else { visible = true; }
  home.addEventListener("scroll", function () {
    // autoplay's own step lands where it put the page; anything else is the visitor,
    // and the way they moved sets the way it plays
    var st = home.scrollTop;
    if (!(auto.on && Math.abs(st - auto.expect) < 1.5)) {
      if (auto.seen >= 0 && Math.abs(st - auto.seen) > 0.5) auto.dir = st > auto.seen ? 1 : -1;
      auto.touched = 1;
    }
    auto.seen = st;
    if (!still.matches) kick();
  }, { passive: true });
  window.addEventListener("resize", function () { L = null; settle(); });
  if (still.addEventListener) still.addEventListener("change", settle);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) kick(); });
  settle();
})();
