/* ═══════════════════════════════════════════════════════════
   SENOTEL — app engine
   Real features: upload, library, manual timeline editing
   (trim / split / reorder / text / filters / speed / volume),
   AI edit engine (prompt → real timeline), playback engine,
   real in-browser export via MediaRecorder, undo/redo,
   adaptive UI levels.
   ═══════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ═══════════ STATE ═══════════ */

  const S = {
    media: [],               // {id,url,type,name,duration,thumb}
    clips: [],               // {id,mediaId,in,out,speed,volume,muted,filter}
    texts: [],               // {id,text,start,dur,size,color,pos}
    broll: [],               // {id,mediaId,start,dur,mode} — OVERLAYS in TIMELINE time,
                             // never clips: a clip would silence the speaker
    music: null,             // {id,title,url,duration,creator,landing,gain}: one bed per
                             // project, looped under the whole edit, as TikTok does.
    effects: [],             // {id,type,start,dur,amount}: video effects on their own lane (fx-library.js)
    sfx: [],                 // {id,name,start,gain} — sound effects in TIMELINE time.
                             // Free placement like broll; sfx.js generates the audio,
                             // so nothing is stored but a name and a moment.
    audio: [],               // {id,mediaId,start,in,out,speed,gain,fadeIn,fadeOut,name}:
                             // audio CLIPS in TIMELINE time. An imported audio file, or
                             // the sound of a video pulled onto its own track (Extract
                             // audio). in/out are SOURCE seconds, like a video clip's.
    captions: [],            // word-timed animated cues, in TIMELINE time
    capOpts: capDefaults(),  // how they look and read: see capDefaults()
    capLang: "",             // the language heard in the footage (Whisper's guess or the person's pick)
    sel: null,               // {type:'clip'|'text'|'all', id}
    time: 0,
    playing: false,
    pps: 40,
    userMuted: false,
    seed: 1,
    format: "auto",
    mode: "entertainment",   // "entertainment" (short videos) or "business" (product videos, 0.34.0)
    // Business mode's brief (the Business row): the Director's source of names and claims
    brief: { name: "", what: "", cta: "", tone: "polished" },
    aspect: "9:16",          // short-form default; see exportSize()
    vertical: false,
    // Find clips (clips.js): the bar's mode, its options, and what it found
    find: { on: false, len: "auto", genre: "auto", from: "", to: "" },
    found: null              // {mediaId, prompt, window, length, clips:[{id,start,end,title,hook,why,type,made}]}
  };
  let nextId = 1;
  const IMG_DUR = 3;
  let finding = null;        // a running Find clips job, so the button can stop it

  function global_SenotelCaptions() { return window.SenotelCaptions || null; }

  const FILTERS = {
    none:      { label: "Original",  css: "none" },
    cinematic: { label: "Cinematic", css: "contrast(1.12) saturate(1.18) brightness(0.98)" },
    vivid:     { label: "Vivid",     css: "saturate(1.45) contrast(1.05)" },
    warm:      { label: "Warm",      css: "sepia(0.28) saturate(1.25) brightness(1.04)" },
    cool:      { label: "Cool",      css: "saturate(1.05) hue-rotate(14deg) brightness(1.02)" },
    noir:      { label: "Noir",      css: "grayscale(1) contrast(1.2) brightness(0.95)" },
    vintage:   { label: "Vintage",   css: "sepia(0.45) contrast(0.92) brightness(1.05) saturate(0.85)" },
    dreamy:    { label: "Dreamy",    css: "brightness(1.06) contrast(0.88) saturate(0.9)" }
  };

  /* ═══════════ TOAST ═══════════ */

  let toastTimer = null;
  function toast(msg, ms) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), ms || 2600);
  }

  /* ═══════════ HELPERS ═══════════ */

  const mediaById = (id) => S.media.find((m) => m.id === id) || null;
  const clipById = (id) => S.clips.find((c) => c.id === id) || null;
  const textById = (id) => S.texts.find((t) => t.id === id) || null;
  const dispDur = (c) => (c.out - c.in) / c.speed;
  const total = () => S.clips.reduce((s, c) => s + dispDur(c), 0);

  function clipAt(t) {
    let acc = 0;
    for (const c of S.clips) {
      const d = dispDur(c);
      if (t < acc + d) return { clip: c, offset: t - acc, start: acc };
      acc += d;
    }
    return null;
  }

  // Where a clip starts on the timeline.
  function clipStartOf(clip) {
    let acc = 0;
    for (const c of S.clips) {
      if (c === clip) return acc;
      acc += dispDur(c);
    }
    return 0;
  }

  function fmt(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  const fmt1 = (sec) => fmt(sec) + "." + Math.floor((sec % 1) * 10);

  function rand(seed) {
    let a = seed * 1103515245 + 12345;
    return () => {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      return a / 0x7fffffff;
    };
  }

  /* ═══════════ HISTORY (undo / redo) ═══════════ */

  let hist = [], histIdx = -1;
  function commit() {
    hist = hist.slice(0, histIdx + 1);
    hist.push(JSON.stringify({ c: S.clips, t: S.texts, cap: S.captions, co: S.capOpts, b: S.broll, s: S.sfx, m: S.music, a: S.audio, e: S.effects }));
    if (hist.length > 80) hist.shift();
    histIdx = hist.length - 1;
    saveSession();   // every edit is also a resume point
  }
  function restore(json) {
    const o = JSON.parse(json);
    S.clips = o.c;
    S.texts = o.t;
    S.captions = o.cap || []; // captions travel with undo/redo
    if (o.co) S.capOpts = Object.assign(capDefaults(), o.co);   // and so do their settings
    if ($("captionSheet") && !$("captionSheet").classList.contains("hidden")) renderCaptionSheet();
    S.broll = o.b || [];      // so does b-roll
    S.sfx = o.s || [];        // and so do sound effects
    S.music = o.m || null;    // and the music bed
    S.audio = o.a || [];      // and the audio clips
    S.effects = o.e || [];    // and the video effects
    loadMusicElement();
    S.sel = null;
    S.time = clamp(S.time, 0, total());
    renderTimeline();
    renderInspector();
  }
  function undo() {
    if (histIdx > 0) { histIdx--; restore(hist[histIdx]); }
    else toast("Nothing to undo");
  }
  function redo() {
    if (histIdx < hist.length - 1) { histIdx++; restore(hist[histIdx]); }
    else toast("Nothing to redo");
  }

  /* ═══════════ SCREENS ═══════════ */

  function mountPreview(container) {
    container.appendChild($("previewWrap"));
  }

  const SCREENS = ["home", "modes", "editor", "settings", "admin"];

  /* Where "back" goes from a screen you can reach from anywhere. Settings and
     admin are not a level in the hierarchy, they are a detour, so leaving one
     returns you to whatever you were doing rather than to a fixed parent. */
  let cameFrom = "home";

  function showScreen(name) {
    const prev = document.body.dataset.screen;
    if (prev && prev !== name && name !== "settings" && name !== "admin") cameFrom = name;
    document.body.dataset.screen = name;
    SCREENS.forEach((n) => {
      const el = $("screen-" + n);
      if (el) el.classList.toggle("active", n === name);
    });
    $("backBtn").classList.toggle("hidden", name === "home");
    $("exportBtn").classList.toggle("hidden", name !== "editor");
    if (name !== "editor") pause();
  }

  /* landing "+" lands here, not straight in the editor: the mode has to be
     chosen first now that Entertainment is one of several. */
  function showModes() { showScreen("modes"); }

  function enterEditor() {
    showScreen("editor");
    if (hasRestored) {
      hasRestored = false;
      toast("Picked up where you left off", 3000);
    }
    mountPreview($("editorStage"));
    $("mediaStrip").classList.remove("hidden");
    renderStrips();
    renderTimeline();
    /* The sound effects are recordings (sfx.js, 0.25.0): about 1 MB, fetched
       once and kept on the device. Fetched now, so a sound placed by hand or
       by the Director plays the first time it is reached. */
    if (sfxEngine() && sfxEngine().prepare) sfxEngine().prepare();
    if (!S.media.length) {
      toast("Add your footage with +, then tell vClyps what you want or let it decide");
    }
  }

  /* Every screen change goes through the transition when experience.js has
     provided one, and straight through when it has not — so the app is never
     dependent on the atmosphere layer being present.

     The whole navigation runs SYNCHRONOUSLY inside this callback, at the
     moment the curtain is closed. That is deliberate: enterEditor() measures
     the timeline immediately after showing the screen, and a hidden element
     measures zero — deferring only part of the sequence would leave the
     centre-locked playhead computing its offset against nothing. */
  function go(fn) {
    if (window.vcCurtain) window.vcCurtain(fn);
    else fn();
  }

  /* Lets anything that measured itself while the curtain covered it settle up
     afterwards. Guarded on both sides; harmless if never called. */
  window.vcRelayout = function () {
    if (document.body.dataset.screen === "editor") renderTimeline();
  };

  // landing.js calls this on the "+" — it opens the mode picker.
  // vcEnterEditor stays a direct jump, used by the session-resume path: a
  // resumed edit on boot should land in the editor, not play a transition at
  // someone who has not asked for one yet.
  window.vcBegin = function () { go(showModes); };
  window.vcEnterEditor = enterEditor;

  document.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      go(() => {
        S.mode = card.dataset.mode || "entertainment";
        applyModeUI();
        enterEditor();
      });
    });
  });

  /* What changes with the mode: the label, the Business row (the brief the
     Director works from) and Find clips, which is an entertainment tool for
     long recordings. */
  /* On a phone the brief folds behind a Brief button once it is filled in:
     four fields above the picture squeezed the timeline off the screen
     (0.34.1). It opens by itself while the product is still blank, and
     folds away when Edit is pressed. A wider screen always shows it. */
  let briefOpen = null;   // null = decide from whether the brief is filled in
  const narrow = () => window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
  function showBrief() {
    const biz = S.mode === "business";
    const open = biz && (!narrow() || (briefOpen === null ? !S.brief.name : briefOpen));
    $("bizRow").classList.toggle("hidden", !open);
    $("briefChip").classList.toggle("hidden", !biz || !narrow());
    $("briefChip").setAttribute("aria-pressed", open ? "true" : "false");
  }
  $("briefChip").addEventListener("click", () => {
    briefOpen = $("bizRow").classList.contains("hidden");
    showBrief();
    if (briefOpen) $("bizName").focus();
  });
  if (window.matchMedia) {
    const mq = window.matchMedia("(max-width: 760px)");
    if (mq.addEventListener) mq.addEventListener("change", showBrief);
  }
  // the edit's summary is one line on a phone; a tap shows the rest
  $("aiStatus").addEventListener("click", () => $("aiStatus").classList.toggle("open"));

  function applyModeUI() {
    const biz = S.mode === "business";
    $("fmtLabel").textContent = biz ? "Business" : "Entertainment";
    showBrief();
    $("findChip").classList.toggle("hidden", biz);
    if (biz && S.find.on) $("findChip").click();
    $("bizName").value = S.brief.name || "";
    $("bizWhat").value = S.brief.what || "";
    $("bizCta").value = S.brief.cta || "";
    $("bizTone").value = S.brief.tone || "polished";
    $("semiPrompt").placeholder = biz ? "Anything else? e.g. make it 20 seconds, lead with the price" : "Describe your edit…";
  }
  [["bizName", "name"], ["bizWhat", "what"], ["bizCta", "cta"], ["bizTone", "tone"]].forEach(([id, key]) => {
    const el = $(id);
    el.addEventListener("input", () => { S.brief[key] = el.value; });
    el.addEventListener("change", () => { S.brief[key] = el.value; writeSession(); });
  });

  // back steps one level: editor → modes → landing
  $("backBtn").addEventListener("click", () => {
    const at = document.body.dataset.screen;
    const to = (at === "settings" || at === "admin") ? cameFrom
      : at === "editor" ? "modes" : "home";
    go(() => showScreen(to));
  });
  $("logoHome").addEventListener("click", () => go(() => showScreen("home")));

  /* ═══════════ UPLOAD & LIBRARY ═══════════ */

  const picker = $("filePicker");
  /* What the person was doing when they asked to add something, which decides
     where it lands: "editor" the end of the timeline, "overlay" the overlay
     track, "audio" and "extract" the audio track at the playhead, "library"
     only the library. */
  let pickerCtx = "editor";

  // Every "add" in the app opens the Add media sheet, which offers the device
  // first and every other source after it.
  function openPicker(ctx) { openAddSheet(ctx); }

  $("libraryBtn").addEventListener("click", () => openSheet("librarySheet"));
  $("libAddBtn").addEventListener("click", () => openPicker("library"));
  $("stageAddBtn").addEventListener("click", () => openPicker("editor"));
  $("tbAdd").addEventListener("click", () => openPicker("editor"));
  $("tbTidy").addEventListener("click", () => openTidy());
  $("tidyPauses").addEventListener("click", () => runTidy("pauses"));
  $("tidyFillers").addEventListener("click", () => runTidy("fillers"));
  $("tidyTakes").addEventListener("click", () => runTidy("takes"));
  $("tidyShowWords").addEventListener("click", () => runTidy("transcript"));
  $("tidyCutWords").addEventListener("click", () => cutStruck());

  picker.addEventListener("change", () => {
    const files = Array.prototype.slice.call(picker.files || []);
    picker.value = "";
    if (files.length) addFiles(files, pickerCtx);
  });

  /* What a file is: by its type, else by its name, because some systems hand
     over an .m4a or an .mkv with no type at all. */
  const EXT_KIND = {
    mp4: "video", m4v: "video", mov: "video", webm: "video", mkv: "video", avi: "video", "3gp": "video",
    mp3: "audio", m4a: "audio", aac: "audio", wav: "audio", ogg: "audio", oga: "audio", opus: "audio",
    flac: "audio", aif: "audio", aiff: "audio",
    jpg: "image", jpeg: "image", png: "image", webp: "image", gif: "image", heic: "image"
  };
  function kindOf(file) {
    const t = String((file && file.type) || "");
    if (t.indexOf("video/") === 0) return "video";
    if (t.indexOf("audio/") === 0) return "audio";
    if (t.indexOf("image/") === 0) return "image";
    const ext = (String((file && file.name) || "").match(/\.([a-z0-9]+)$/i) || [])[1];
    return (ext && EXT_KIND[ext.toLowerCase()]) || null;
  }

  /* Every way into the project ends here: the device, Google Drive, Dropbox,
     a link, Zoom and Vimeo all hand over Files, and from here on a file is a
     file, wherever it came from. */
  function addFiles(files, ctx) {
    ctx = ctx || "editor";
    let added = 0, skipped = 0, onTimeline = 0, overlayPending = null;
    const sounds = [];   // media whose sound goes onto the audio track
    files.forEach((file) => {
      const kind = kindOf(file);
      // "extract" wants a video's sound; anything else would be a surprise
      if (!kind || (ctx === "extract" && kind !== "video")) { skipped++; return; }
      added++;
      /* A video chosen for its sound joins the project AS a sound, as in
         CapCut: it is kept in Your audio and never turns up as footage. An
         audio element plays a video file's sound as it is, so nothing is
         converted. */
      const asSound = kind === "video" && (ctx === "extract" || ctx === "audio");
      const item = {
        id: nextId++,
        url: URL.createObjectURL(file),
        type: asSound ? "audio" : kind,
        name: String(file.name || "file").replace(/\.[^.]+$/, ""),
        duration: kind === "image" ? IMG_DUR : 0,
        thumb: kind === "image" ? URL.createObjectURL(file) : null,
        /* The File itself, never saved: clips.js reads a long recording in
           pieces from it, which a blob: URL cannot do. */
        file: file
      };
      if (asSound) item.fromVideo = true;
      S.media.push(item);
      keepFile(item, file);   // so the footage survives the tab being discarded
      if (item.type === "audio") loadAudioMeta(item);
      else {
        queueAnalysis(item);
        if (kind === "video") loadVideoMeta(item);
        else loadImageMeta(item);
      }
      /* Sound goes where sound goes. An audio file added while editing lands
         on the audio track at the playhead, as in CapCut; "audio" and
         "extract" put the sound of whatever was chosen there. */
      if (item.type === "audio" && ctx !== "library" && ctx !== "overlay") {
        sounds.push(item);
      } else if (ctx === "editor" && kind !== "audio") {
        appendClip(item, false);
        onTimeline++;
      }
      /* Imported FOR the overlay track — the first picture lands as an overlay
         at the playhead rather than on the end of the main track, because that
         is what was asked for. The rest just join the library. */
      else if (ctx === "overlay" && !overlayPending && kind !== "audio") overlayPending = item;
    });
    if (!added) {
      toast(ctx === "extract" ? "Choose a video to take its sound from"
        : "Only videos, photos and audio files can be added");
      return 0;
    }

    if (onTimeline) { commit(); renderTimeline(); }
    if (overlayPending) { addOverlayAt(overlayPending); libPick = null; }
    renderAll();
    // the length is only known once the file's metadata has loaded
    const at = S.time;
    if (ctx === "extract" && !S.clips.length) {
      toast("Saved to Your audio. Put a video or photo on the timeline, then add it from Audio, Your audio", 6000);
    } else {
      sounds.forEach((m) => mediaDuration(m).then(() => {
        const a = addAudioClip(m, { at: at, quiet: ctx === "extract" });
        if (a && ctx === "extract") toast("Audio from “" + m.name + "” is on the timeline and saved to Your audio");
      }));
    }
    if (!sounds.length) {
      toast(added + (added === 1 ? " file" : " files") + " added" +
        (skipped ? " (" + skipped + " skipped: not a video, photo or audio file)" : "") +
        (onTimeline ? ". Describe your edit above, or press play" : ""));
    }
    return added;
  }

  /* An audio file has no picture and no frames to analyse: only its length,
     which the audio track needs before the clip can be drawn. */
  function loadAudioMeta(item) {
    const a = document.createElement("audio");
    a.preload = "metadata";
    a.src = item.url;
    a.addEventListener("loadedmetadata", () => {
      item.duration = isFinite(a.duration) ? a.duration : 0;
      a.removeAttribute("src");
      renderAll();
    });
    a.addEventListener("error", () => { item.duration = item.duration || 0; renderAll(); });
  }

  // Resolves with a media item's length, waiting for its metadata if it must.
  function mediaDuration(m) {
    if (m.duration > 0) return Promise.resolve(m.duration);
    return new Promise((resolve) => {
      const el = document.createElement(m.type === "audio" ? "audio" : "video");
      el.preload = "metadata";
      el.muted = true;
      let done = false;
      const end = (d) => {
        if (done) return;
        done = true;
        if (d > 0 && !(m.duration > 0)) m.duration = d;
        el.removeAttribute("src");
        resolve(m.duration || d || 0);
      };
      el.onloadedmetadata = () => end(isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => end(0);
      setTimeout(() => end(0), 20000);
      el.src = m.url;
    });
  }

  /* ═══════════ ADD MEDIA ═══════════
     One sheet for every way in (sources.js does the fetching). Whatever comes
     back is a File, handed to addFiles() like one picked from the device. */

  const ADD_TITLE = {
    editor: "Add media", library: "Add media", overlay: "Add an overlay",
    audio: "Add audio", extract: "Extract audio from a video"
  };
  const ADD_SUB = {
    overlay: "A photo or a video", audio: "Audio files, or a video for its sound",
    extract: "A video, for its sound"
  };
  const ADD_ACCEPT = { overlay: "video/*,image/*", audio: "audio/*,video/*", extract: "video/*" };

  /* The ways into a phone. Android opens its own photo picker (the gallery,
     with Google Photos in it) only when a page asks for nothing but photos
     and videos; ask for anything else and it opens the file browser, which
     is also where the other apps (a gallery app, Drive, a file manager) are
     listed. So the gallery asks for pictures only, and Files adds one type
     that is neither, which is what sends Android to the browser of apps. An
     iPhone shows its own menu for both. The camera is for footage only. */
  const ADD_WAYS = {
    editor: { gallery: "video/*,image/*", files: "video/*,image/*,audio/*", camera: "video/*" },
    library: { gallery: "video/*,image/*", files: "video/*,image/*,audio/*", camera: "video/*" },
    overlay: { gallery: "video/*,image/*", files: "video/*,image/*,.mov,.mkv,.heic", camera: "video/*" },
    audio: { gallery: "video/*", files: "audio/*,video/*", camera: null },
    extract: { gallery: "video/*", files: "video/*,.mp4,.mov,.m4v,.webm,.mkv", camera: null }
  };
  const touchDevice = window.matchMedia("(pointer: coarse)");
  let addCtx = "editor";
  let importing = null;   // the AbortController of a download in progress

  function openAddSheet(ctx) {
    if (!importing) {
      addCtx = ctx || "editor";
      $("addStatus").textContent = "";
      $("addList").innerHTML = "";
      document.querySelectorAll(".add-src").forEach((b) => b.classList.remove("on"));
    }
    $("addTitle").textContent = ADD_TITLE[addCtx] || "Add media";
    const phone = touchDevice.matches, ways = ADD_WAYS[addCtx] || ADD_WAYS.editor;
    // importing audio on a phone: sound files first, a video's sound second
    const audioFirst = phone && addCtx === "audio";
    $("addDeviceMain").textContent = !phone ? "From this computer" : audioFirst ? "Audio files"
      : addCtx === "extract" ? "Videos" : "Photos and videos";
    $("addDeviceSub").textContent = !phone ? (ADD_SUB[addCtx] || "Videos, photos and audio")
      : audioFirst ? "Songs, voiceovers and other sound files"
      : addCtx === "extract" ? "From your phone's gallery, for their sound" : "Your phone's gallery";
    $("addFiles").firstElementChild.textContent = audioFirst ? "Videos" : "Files and other apps";
    $("addFiles").lastElementChild.textContent = audioFirst ? "From your gallery, for their sound" : "Files, gallery apps, Drive";
    $("addWays").classList.toggle("hidden", !phone);
    $("addCamera").classList.toggle("hidden", !ways.camera);
    openSheet("addSheet");
    refreshAddSources();
    // the pop-up sources load now, so a press can open them straight away
    if (window.SenotelSources) SenotelSources.warm();
  }

  function refreshAddSources() {
    if (!window.SenotelSources) return;
    SenotelSources.available().then((av) => {
      let any = false;
      document.querySelectorAll(".add-src").forEach((b) => {
        const on = !!av[b.dataset.src];
        b.classList.toggle("hidden", !on);
        if (on) any = true;
      });
      $("addSources").classList.toggle("hidden", !any);
    });
  }

  function pickFromDevice(accept, camera) {
    if (importing) return;
    pickerCtx = addCtx;
    picker.accept = accept;
    if (camera) picker.setAttribute("capture", "environment");
    else picker.removeAttribute("capture");
    closeSheets();
    picker.click();   // still inside this click, which is what the picker needs
  }
  const waysNow = () => ADD_WAYS[addCtx] || ADD_WAYS.editor;
  const audioFirstNow = () => touchDevice.matches && addCtx === "audio";
  $("addDevice").addEventListener("click", () => {
    // a computer has one file dialog: it gets everything this sheet takes
    pickFromDevice(touchDevice.matches && !audioFirstNow() ? waysNow().gallery : waysNow().files, false);
  });
  $("addFiles").addEventListener("click", () => pickFromDevice(audioFirstNow() ? waysNow().gallery : waysNow().files, false));
  $("addCamera").addEventListener("click", () => pickFromDevice(waysNow().camera, true));

  /* Extract audio, as in CapCut: one press opens the device's videos, and the
     sound of the one chosen goes on the audio track at the playhead and into
     Your audio. Straight to the picker, because that is the whole job. */
  function extractFromDevice() {
    if (importing) return;
    pickerCtx = "extract";
    picker.accept = ADD_ACCEPT.extract;
    picker.removeAttribute("capture");
    closeSheets();
    primeAudioForClick();   // the new sound has to reach the preview and the export
    picker.click();
  }
  $("tbExtract").addEventListener("click", extractFromDevice);

  function mbText(n) { return (n / 1048576).toFixed(n >= 100 * 1048576 ? 0 : 1); }

  function setImporting(on) {
    $("addCancel").classList.toggle("hidden", !on);
    document.querySelectorAll(".add-src, #addList .snd-add").forEach((b) => { b.disabled = on; });
  }

  /* Runs one import. `start` is called straight away, inside the click, which
     matters: Google, Dropbox, Zoom and Vimeo all open a window, and browsers
     only allow that during the click itself. */
  async function importWith(start, opening) {
    if (importing) { toast("One download at a time. Cancel it, or wait for it to finish"); return; }
    const ctl = new AbortController();
    importing = ctl;
    setImporting(true);
    const status = $("addStatus");
    status.textContent = opening || "Opening…";
    const onProgress = (got, total, name) => {
      status.textContent = "Downloading " + (name || "the file") + "… " + mbText(got) +
        (total ? " of " + mbText(total) : "") + " MB";
    };
    const ctx = addCtx;
    try {
      const got = await start({ onProgress: onProgress, signal: ctl.signal });
      // one File (Zoom, Vimeo) or several (Google Photos, Drive, Dropbox)
      const files = Array.isArray(got) ? got : got ? [got] : [];
      status.textContent = "";
      if (files.length) {
        closeSheets();
        addFiles(files, ctx);
      }
      return files;
    } catch (e) {
      const stopped = window.SenotelSources && e instanceof SenotelSources.Cancelled;
      status.textContent = stopped ? "" : ((e && e.message) || "That didn't work. Try again.");
      return null;
    } finally {
      importing = null;
      setImporting(false);
    }
  }

  $("addCancel").addEventListener("click", () => { if (importing) importing.abort(); });

  /* There is no "paste a link" box, on purpose (removed 0.23.1). The links
     people actually have are YouTube, TikTok, Instagram and the like, none
     of which allow downloading, so the box mostly promised what it could not
     do. Files come from the device and the sign-in sources below. */

  document.querySelectorAll(".add-src").forEach((b) => {
    b.addEventListener("click", () => {
      const src = b.dataset.src;
      if (!window.SenotelSources || importing) return;
      document.querySelectorAll(".add-src").forEach((x) => x.classList.toggle("on", x === b));
      $("addList").innerHTML = "";
      if (src === "gphotos") openGooglePhotos();
      else if (src === "drive") importWith((o) => SenotelSources.fromDrive(o), "Opening Google Drive…");
      else if (src === "dropbox") importWith((o) => SenotelSources.fromDropbox(o), "Opening Dropbox…");
      else if (src === "zoom" || src === "vimeo") browseCloud(src);
    });
  });

  /* Google Photos: one tap signs in with Google, the next opens Google Photos
     (a browser allows one pop-up per tap). Once signed in, one tap does it. */
  const PHOTOS_WAIT = "Choose in Google Photos, then come back here…";
  function openGooglePhotos() {
    if (SenotelSources.photos.signedIn()) {
      importWith((o) => SenotelSources.fromGooglePhotos(o), PHOTOS_WAIT);
      return;
    }
    const status = $("addStatus");
    status.textContent = "Waiting for you to sign in with Google…";
    SenotelSources.photos.signIn().then(() => {
      status.textContent = "";
      $("addList").appendChild(cloudRow("Google Photos", "Signed in. Choose your videos and photos", "", "Open", () => {
        $("addList").innerHTML = "";
        importWith((o) => SenotelSources.fromGooglePhotos(o), PHOTOS_WAIT);
      }));
    }).catch((e) => {
      status.textContent = e instanceof SenotelSources.Cancelled ? "" : ((e && e.message) || "Sign-in didn't work. Try again.");
    });
  }

  /* Zoom and Vimeo: sign in once per visit (the window opens inside this
     click), then a list of the person's recordings or videos to choose from. */
  function browseCloud(src) {
    const status = $("addStatus");
    const ctl = new AbortController();
    importing = ctl;
    setImporting(true);
    status.textContent = "Waiting for you to sign in to " + (src === "zoom" ? "Zoom" : "Vimeo") + "…";
    SenotelSources.connect(src, { signal: ctl.signal })
      .then(() => {
        importing = null;
        setImporting(false);
        status.textContent = "";
        return src === "zoom" ? listZoom(0) : listVimeo(1);
      })
      .catch((e) => {
        importing = null;
        setImporting(false);
        status.textContent = e instanceof SenotelSources.Cancelled ? "" : ((e && e.message) || "Sign-in didn't work. Try again.");
      });
  }

  function cloudRow(title, sub, len, label, onAdd) {
    const row = mk("div", "snd-row mus-row");
    const meta = mk("div", "mus-meta");
    const n = mk("span", "snd-name", "");
    n.textContent = title;
    meta.appendChild(n);
    const s = mk("span", "mus-by", "");
    s.textContent = sub;
    meta.appendChild(s);
    row.appendChild(meta);
    row.appendChild(mk("span", "snd-dur", len));
    const add = mk("button", "snd-add", label);
    if (onAdd) add.addEventListener("click", onAdd);
    else add.disabled = true;
    row.appendChild(add);
    return row;
  }

  function moreButton(label, onMore) {
    const b = mk("button", "secondary-btn add-more", "");
    b.textContent = label;
    b.addEventListener("click", () => { b.remove(); onMore(); });
    return b;
  }

  function niceDay(iso) {
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  // monthsBack 0 = the last 30 days; "Earlier recordings" walks back a month at a time
  function listZoom(monthsBack) {
    const status = $("addStatus"), list = $("addList");
    status.textContent = monthsBack ? "Looking further back…" : "Finding your recordings…";
    return SenotelSources.zoom.list(monthsBack).then((d) => {
      status.textContent = "";
      const meetings = d.meetings || [];
      if (!meetings.length && !list.children.length) {
        status.textContent = monthsBack ? "No cloud recordings in that month either." : "No cloud recordings in the last 30 days.";
      }
      meetings.forEach((m) => {
        const f = SenotelSources.zoom.pick(m.files);
        if (!f) return;
        const what = f.type === "M4A" ? "audio only" : "video";
        list.appendChild(cloudRow(m.topic, niceDay(m.start) + " · " + what + (f.size ? " · " + mbText(f.size) + " MB" : ""),
          m.duration ? m.duration + " min" : "", "Add",
          () => importWith((o) => SenotelSources.zoom.file(m, f, o), "Starting the download from Zoom…")));
      });
      list.appendChild(moreButton("Earlier recordings", () => listZoom(monthsBack + 1)));
    }).catch((e) => { status.textContent = (e && e.message) || "Couldn't list your Zoom recordings."; });
  }

  function listVimeo(page) {
    const status = $("addStatus"), list = $("addList");
    status.textContent = page > 1 ? "Loading more…" : "Finding your videos…";
    return SenotelSources.vimeo.list(page).then((d) => {
      status.textContent = "";
      const videos = d.videos || [];
      if (!videos.length && page === 1) status.textContent = "There are no videos on this Vimeo account yet.";
      videos.forEach((v) => {
        const can = !!v.file;
        list.appendChild(cloudRow(v.name,
          niceDay(v.created) + (can ? (v.file.height ? " · " + v.file.height + "p" : "") + (v.file.size ? " · " + mbText(v.file.size) + " MB" : "")
            : " · Vimeo allows downloads on Standard plans and up"),
          v.duration ? fmtLen(v.duration) : "", can ? "Add" : "Locked",
          can ? () => importWith((o) => SenotelSources.vimeo.file(v, o), "Starting the download from Vimeo…") : null));
      });
      if (d.next) list.appendChild(moreButton("More videos", () => listVimeo(page + 1)));
    }).catch((e) => { status.textContent = (e && e.message) || "Couldn't list your Vimeo videos."; });
  }

  /* Photos need their natural size recorded too, for the same reason videos do:
     a timeline of portrait photos should export a portrait file. */
  function loadImageMeta(item) {
    const img = new Image();
    img.onload = () => { item.w = img.naturalWidth || 0; item.h = img.naturalHeight || 0; };
    img.src = item.url;
  }

  function loadVideoMeta(item) {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.playsInline = true;
    v.src = item.url;
    v.addEventListener("loadedmetadata", () => {
      item.duration = isFinite(v.duration) ? v.duration : 0;
      // Natural size drives the export frame — without it a portrait phone clip
      // got pillarboxed into a 16:9 file, a narrow strip in a sea of black.
      item.w = v.videoWidth || 0;
      item.h = v.videoHeight || 0;
      // clips created before metadata arrived get their real length
      S.clips.forEach((c) => {
        if (c.mediaId === item.id && c.out === IMG_DUR && item.duration > 0) c.out = item.duration;
      });
      v.currentTime = Math.min(0.4, (item.duration || 1) / 2);
    });
    v.addEventListener("seeked", () => {
      try {
        const cnv = document.createElement("canvas");
        cnv.width = 160; cnv.height = 90;
        cnv.getContext("2d").drawImage(v, 0, 0, 160, 90);
        item.thumb = cnv.toDataURL("image/jpeg", 0.7);
      } catch (e) { /* cross-codec draw can fail; strip shows a dark tile */ }
      v.removeAttribute("src");
      renderAll();
      renderTimeline();
    });
    v.addEventListener("error", () => renderAll());
    queueFrames(item);
  }

  /* ─── The frame strip ───
     CapCut fills each clip on the timeline with pictures from inside it, so
     you can see where things happen without playing. Up to 60 small square
     frames per video, taken in the background one video at a time and kept
     in memory only; the timeline picks the nearest one for each tile. */
  const frameQueue = [];
  let framing = false;
  function queueFrames(item) {
    if (!item || item.frames || frameQueue.indexOf(item) >= 0) return;
    frameQueue.push(item);
    if (!framing) nextFrames();
  }
  function nextFrames() {
    const item = frameQueue.shift();
    if (!item) { framing = false; return; }
    framing = true;
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = item.url;
    const cnv = document.createElement("canvas");
    const SZ = 96;
    cnv.width = SZ; cnv.height = SZ;
    const ctx = cnv.getContext("2d");
    const out = [];
    let times = [], i = 0, lastDraw = 0;
    const done = () => {
      v.removeAttribute("src");
      try { v.load(); } catch (e) {}
      item.frames = out;
      renderTimeline();
      setTimeout(nextFrames, 50);
    };
    v.addEventListener("loadedmetadata", () => {
      const d = isFinite(v.duration) ? v.duration : 0;
      if (!d) { done(); return; }
      const n = Math.max(2, Math.min(60, Math.ceil(d)));
      for (let k = 0; k < n; k++) times.push(Math.min(d - 0.05, (k + 0.5) * d / n));
      v.currentTime = times[0];
    });
    v.addEventListener("seeked", () => {
      try {
        const vw = v.videoWidth, vh = v.videoHeight, s = Math.min(vw, vh);
        ctx.drawImage(v, (vw - s) / 2, (vh - s) / 2, s, s, 0, 0, SZ, SZ);
        out.push({ t: times[i], url: cnv.toDataURL("image/jpeg", 0.62) });
      } catch (e) {}
      i++;
      // show the strip filling in as it goes, without redrawing on every frame
      if (performance.now() - lastDraw > 700) { lastDraw = performance.now(); item.frames = out.slice(); renderTimeline(); item.frames = null; }
      if (i < times.length) v.currentTime = times[i];
      else done();
    });
    v.addEventListener("error", done);
  }
  // the strip frame nearest a source time
  function frameAt(m, t) {
    const f = m && m.frames;
    if (!f || !f.length) return m ? m.thumb : null;
    let best = f[0];
    f.forEach((x) => { if (Math.abs(x.t - t) < Math.abs(best.t - t)) best = x; });
    return best.url;
  }

  function removeMedia(id) {
    const i = S.media.findIndex((m) => m.id === id);
    if (i === -1) return;
    URL.revokeObjectURL(S.media[i].url);
    idbDel("m" + id).catch(() => {});   // stop resuming footage the user removed
    idbDel("l" + id).catch(() => {});   // and what the clip finder measured in it
    if (S.found && S.found.mediaId === id) { S.found = null; renderClipsChip(); }
    S.media.splice(i, 1);
    saveSession();
    const before = S.clips.length + S.broll.length;
    S.clips = S.clips.filter((c) => c.mediaId !== id);
    /* Overlays point at media too. This only filtered clips, which was
       invisible while overlays were Director-only and drawn from whatever
       happened to be there — now they have a track of their own, a dangling
       one renders as an empty box you cannot explain or get rid of. */
    S.broll = S.broll.filter((b) => b.mediaId !== id);
    // and so do audio clips: a sound whose file is gone cannot play
    const hadAudio = S.audio.length;
    S.audio = S.audio.filter((a) => a.mediaId !== id);
    if (S.clips.length + S.broll.length !== before || S.audio.length !== hadAudio) commit();
    if (S.sel && S.sel.type === "clip" && !clipById(S.sel.id)) S.sel = null;
    if (S.sel && S.sel.type === "broll" && !brollById(S.sel.id)) S.sel = null;
    if (S.sel && S.sel.type === "uaudio" && !audioById(S.sel.id)) S.sel = null;
    S.time = clamp(S.time, 0, total());
    renderAll();
    renderTimeline();
    renderInspector();
  }

  /* background footage understanding (brain.js) — starts the moment a file lands */
  function queueAnalysis(item) {
    if (!window.SenotelBrain || item.type === "audio") return;   // nothing to watch in a sound
    item._an = "working";
    SenotelBrain.analyze(item).then(() => {
      item._an = "done";
      renderStrips();
    }).catch(() => { item._an = "done"; });
  }

  function speechOn() { return localStorage.getItem("vclyps-speech") === "1"; }

  /* ═══════════ RENDER: strips, library, home note ═══════════ */

  // A sound file has no picture, so its tile shows a waveform mark instead.
  const AUDIO_MARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>';

  function stripItem(m, withPlus) {
    const el = document.createElement("div");
    el.className = "ms-item" + (m.type === "audio" ? " ms-audio" : "");
    el.title = m.name;
    if (m.type === "audio") {
      el.insertAdjacentHTML("beforeend", AUDIO_MARK);
      const n = document.createElement("span");
      n.className = "ms-name"; n.textContent = m.name;
      el.appendChild(n);
    }
    if (m.thumb) {
      const img = document.createElement("img");
      img.src = m.thumb; img.alt = m.name;
      el.appendChild(img);
    }
    if ((m.type === "video" || m.type === "audio") && m.duration) {
      const d = document.createElement("span");
      d.className = "ms-dur"; d.textContent = fmt(m.duration);
      el.appendChild(d);
    }
    if (m._an) {
      const st = document.createElement("span");
      st.className = "ms-state" + (m._an === "working" ? " work" : "");
      st.title = m._an === "working" ? "vClyps is watching this clip…" : "Analyzed ✓";
      el.appendChild(st);
    }
    if (withPlus) {
      // a sound goes onto the audio track at the playhead, a picture onto the end
      const use = () => {
        if (m.type === "audio") { primeAudioForClick(); addAudioClip(m); }
        else appendClip(m, true);
      };
      const p = document.createElement("button");
      p.className = "ms-plus"; p.textContent = "+";
      p.title = m.type === "audio" ? "Add to the audio track at the playhead" : "Add to timeline";
      p.addEventListener("click", (e) => {
        e.stopPropagation();
        use();
      });
      el.appendChild(p);
      el.addEventListener("click", use);
    }
    return el;
  }

  function addTile(ctx, big) {
    const b = document.createElement("button");
    b.className = "ms-add";
    b.innerHTML = "<span style='font-size:" + (big ? 18 : 15) + "px;line-height:1'>+</span><span>Add</span>";
    b.addEventListener("click", () => openPicker(ctx));
    return b;
  }

  function renderStrips() {
    const ms = $("mediaStrip");
    ms.innerHTML = "";
    ms.appendChild(addTile("editor", false));
    S.media.forEach((m) => ms.appendChild(stripItem(m, true)));
  }

  /* null = browsing; "overlay" = the next tap puts that item on the overlay
     track at the playhead. Same grid either way — a second sheet listing the
     same media would be a second thing to keep in sync for no gain. */
  let libPick = null;

  function renderLibrary() {
    const grid = $("libGrid");
    grid.innerHTML = "";
    $("libEmpty").classList.toggle("hidden", S.media.length > 0);
    const note = $("libNote");
    if (note) {
      note.classList.toggle("hidden", libPick !== "overlay");
      note.textContent = "Tap a photo or clip to lay it over your footage at " + fmt(S.time) + ".";
    }
    S.media.forEach((m) => {
      const el = document.createElement("div");
      // a sound cannot be an overlay, so it is never offered as one
      const pickable = libPick === "overlay" && m.type !== "audio";
      el.className = "lib-item" + (pickable ? " pickable" : "") + (m.type === "audio" ? " li-audio" : "");
      if (m.type === "audio") el.insertAdjacentHTML("beforeend", AUDIO_MARK);
      if (pickable) {
        el.addEventListener("click", (ev) => {
          if (ev.target.classList.contains("li-x")) return;
          addOverlayAt(m);
          libPick = null;
          closeSheets();
        });
      }
      if (m.thumb) {
        const img = document.createElement("img");
        img.src = m.thumb; img.alt = m.name;
        el.appendChild(img);
      }
      const b = document.createElement("span");
      b.className = "li-badge";
      b.textContent = m.type === "video" ? "video " + fmt(m.duration)
        : m.type === "audio" ? "audio " + fmt(m.duration) : "photo";
      el.appendChild(b);
      const x = document.createElement("button");
      x.className = "li-x"; x.textContent = "✕";
      x.title = "Remove from library";
      x.addEventListener("click", () => removeMedia(m.id));
      el.appendChild(x);
      grid.appendChild(el);
    });
  }

  function renderAll() {
    renderStrips();
    renderLibrary();
    refreshFindSrc();
  }

  /* ═══════════ TIMELINE MODEL OPS ═══════════ */

  function appendClip(m, withCommit) {
    S.clips.push({
      id: nextId++,
      mediaId: m.id,
      in: 0,
      out: m.duration || IMG_DUR,
      speed: 1,
      volume: 1,
      muted: false,
      filter: "none",
      fadeIn: 0,
      fadeOut: 0
    });
    if (withCommit) {
      commit();
      toast('"' + m.name + '" added to timeline');
    }
    renderTimeline();
  }

  function splitAtPlayhead() {
    /* A selected overlay splits instead of the footage — the playhead is over
       both at once, and the thing you are looking at is the thing you picked. */
    if (S.sel && S.sel.type === "broll") {
      const b = brollById(S.sel.id);
      if (b && S.time > b.start + 0.12 && S.time < b.start + b.dur - 0.12) {
        const right = Object.assign({}, b, { id: nextId++, start: S.time, dur: b.start + b.dur - S.time });
        b.dur = S.time - b.start;
        S.broll.push(right);
        S.sel = { type: "broll", id: right.id };
        commit(); renderTimeline(); renderInspector();
        return;
      }
      toast("Move the playhead further into the overlay to split it");
      return;
    }
    // a selected audio clip splits the same way: two windows on the same sound
    if (S.sel && S.sel.type === "uaudio") {
      const a = audioById(S.sel.id);
      if (a && S.time > a.start + 0.1 && S.time < a.start + audioDur(a) - 0.1) {
        const cut = a.in + (S.time - a.start) * (a.speed || 1);
        const right = Object.assign({}, a, { id: nextId++, start: S.time, in: cut, fadeIn: 0 });
        a.out = cut;
        a.fadeOut = 0;
        S.audio.push(right);
        S.sel = { type: "uaudio", id: right.id };
        commit(); renderTimeline(); renderInspector();
        return;
      }
      toast("Move the playhead further into the audio clip to split it");
      return;
    }
    const info = clipAt(S.time);
    if (!info) { toast("Move the playhead over a clip to split it"); return; }
    const { clip, offset } = info;
    if (offset < 0.12 || dispDur(clip) - offset < 0.12) {
      toast("Move the playhead a little further into the clip");
      return;
    }
    const srcT = clip.in + offset * clip.speed;
    const second = Object.assign({}, clip, { id: nextId++, in: srcT });
    clip.out = srcT;
    S.clips.splice(S.clips.indexOf(clip) + 1, 0, second);
    S.sel = { type: "clip", id: second.id };
    commit();
    recordEdit("split", { at: Math.round(S.time * 10) / 10 });
    renderTimeline();
    renderInspector();
  }

  /* ─── Freeze frame (CapCut's Freeze) ───
     The picture under the playhead becomes a still that holds for three
     seconds: the clip is split there and the still goes in between, with
     the clip's look, adjustments, flip and turn. The still is a real photo
     in the project, saved on the device like any other. */
  async function freezeFrame(c) {
    const info = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
    if (!info || info.clip !== c) { toast("Move the playhead onto this clip, to the moment to freeze"); return; }
    const m = mediaById(c.mediaId);
    if (!m || m.type !== "video") return;
    pause();
    syncMedia();
    const target = c.in + info.offset * c.speed;
    // the preview must be showing exactly that frame before it is copied
    await new Promise((resolve) => {
      if (!pv.seeking && Math.abs(pv.currentTime - target) < 0.02 && pv.readyState >= 2) { resolve(); return; }
      const ok = () => { pv.removeEventListener("seeked", ok); resolve(); };
      pv.addEventListener("seeked", ok);
      try { pv.currentTime = target; } catch (e) { resolve(); }
      setTimeout(ok, 1500);
    });
    const vw = pv.videoWidth, vh = pv.videoHeight;
    if (!vw || !vh) { toast("That frame isn't ready yet. Try again in a moment"); return; }
    const cnv = document.createElement("canvas");
    cnv.width = vw; cnv.height = vh;
    try { cnv.getContext("2d").drawImage(pv, 0, 0, vw, vh); } catch (e) { toast("This video's frames can't be copied"); return; }
    const blob = await new Promise((r) => cnv.toBlob(r, "image/jpeg", 0.93));
    if (!blob) { toast("Couldn't make the still"); return; }
    const base = (c.name || m.name || "clip").slice(0, 40);
    const file = new File([blob], base + " freeze.jpg", { type: "image/jpeg" });
    const url = URL.createObjectURL(file);
    const item = { id: nextId++, url: url, type: "image", name: base + " (freeze)", duration: IMG_DUR, thumb: url, file: file, w: vw, h: vh };
    S.media.push(item);
    keepFile(item, file);

    let at = S.clips.indexOf(c);
    if (info.offset > 0.05 && dispDur(c) - info.offset > 0.05) {
      const second = Object.assign({}, c, { id: nextId++, in: target });
      delete second.name;
      c.out = target;
      S.clips.splice(at + 1, 0, second);
      at += 1;
    } else if (info.offset > 0.05) {
      at += 1;   // at the very end: the still goes after the clip
    }
    const still = {
      id: nextId++, mediaId: item.id, in: 0, out: 3, speed: 1, volume: 1, muted: true,
      filter: c.filter, fadeIn: 0, fadeOut: 0, freeze: true
    };
    ["adj", "rot", "flipH", "flipV"].forEach((k) => { if (c[k] != null) still[k] = k === "adj" ? Object.assign({}, c[k]) : c[k]; });
    S.clips.splice(at, 0, still);
    S.sel = { type: "clip", id: still.id };
    commit();
    recordEdit("freeze", { at: Math.round(S.time * 10) / 10 });
    renderAll();
    renderTimeline();
    renderInspector();
    syncNow();
    toast("Frozen for 3 seconds. Drag its edge to make it longer");
  }

  /* ─── Replace (CapCut's Replace) ───
     A new video or photo takes a clip's place: same spot, same length where
     the new footage is long enough, same look, adjustments and transition. */
  function replaceClip(c) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "video/*,image/*";
    inp.addEventListener("change", () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const before = S.media.length;
      if (!addFiles([f], "library") || S.media.length === before) return;
      const m = S.media[S.media.length - 1];
      const keep = dispDur(c);
      mediaDuration(m).then((d) => {
        if (!clipById(c.id)) return;
        c.mediaId = m.id;
        c.in = 0;
        if (m.type === "image") { c.out = keep; c.speed = 1; delete c.layout; }
        else c.out = Math.min(d || keep * c.speed, keep * c.speed);
        delete c.freeze;
        delete c.kb;
        commit();
        recordEdit("replace", { type: m.type });
        renderTimeline();
        renderInspector();
        syncNow();
        toast(m.type !== "image" && d && d < keep * c.speed - 0.05
          ? "Replaced. The new video is shorter, so the clip is too"
          : "Replaced. Same place, length and look");
      });
    });
    inp.click();
  }

  function addText() {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    const t = {
      id: nextId++,
      text: "Your text",
      start: clamp(S.time, 0, Math.max(0, total() - 0.5)),
      dur: 3,
      size: 34,
      color: "#ffffff",
      pos: "center",   // the middle of the picture, where CapCut puts a new text
      // a new text starts in a text font (fonts.js), never a caption one
      font: TEXT_NEW_FONT,
      weight: 700
    };
    S.texts.push(t);
    pendingTool = "edit";   // a new text opens on its words, as CapCut opens the keyboard
    S.sel = { type: "text", id: t.id };
    commit();
    renderTimeline();
    renderInspector();
  }

  function deleteSelection() {
    if (!S.sel || S.sel.type === "all") { toast("Tap something on the timeline first, then delete"); return; }
    if (S.sel.type === "music") {
      S.music = null;
      loadMusicElement();
      S.sel = null;
      commit();
      renderTimeline();
      renderInspector();
      toast("Music removed");
      return;
    }
    const selType = S.sel.type;
    const removed = selType === "effect" ? effectById(S.sel.id) : selType === "clip" ? clipById(S.sel.id)
      : selType === "text" ? textById(S.sel.id)
      : selType === "broll" ? brollById(S.sel.id)
      : selType === "uaudio" ? audioById(S.sel.id) : sfxById(S.sel.id);
    if (selType === "clip") S.clips = S.clips.filter((c) => c.id !== S.sel.id);
    else if (selType === "text") S.texts = S.texts.filter((t) => t.id !== S.sel.id);
    else if (selType === "broll") S.broll = S.broll.filter((b) => b.id !== S.sel.id);
    else if (selType === "uaudio") S.audio = S.audio.filter((a) => a.id !== S.sel.id);
    else if (selType === "effect") S.effects = S.effects.filter((x) => x.id !== S.sel.id);
    else S.sfx = S.sfx.filter((x) => x.id !== S.sel.id);
    S.sel = null;
    S.time = clamp(S.time, 0, total());
    commit();
    recordEdit("delete", {
      type: selType,
      mediaId: removed && removed.mediaId,
      in: removed && removed.in, out: removed && removed.out
    });
    renderTimeline();
    renderInspector();
  }

  /* ═══════════ TIDY: pauses, filler words, editing by the transcript ═══════
     Three tools, one engine. Each names stretches of SOURCE time to take out
     ("this media, from a to b"); cutSourceSpans() removes them from every
     clip that shows them and closes the gap, the way deleting a word in a
     transcript editor does. Everything placed on the timeline after a cut
     (texts, overlays, sound effects, audio clips) moves up with the picture,
     so nothing drifts off the moment it was put on, and captions are mapped
     again from the words. All on the device; undo puts it all back. */

  // The timed words of a video: the captions' (Whisper, the best timings)
  // or, failing that, whatever the Director's transcription left.
  function timedWords(m) {
    const ws = (m && m.capWords && m.capWords.length ? m.capWords : (m && m.words)) || [];
    return ws.filter((w) => w && isFinite(w.start) && isFinite(w.end) && w.end > w.start && !w.hide);
  }

  /* Whether anything filled a gap (laughter, applause, music): measured
     the same way the Director's tightening does, so a pause that IS the
     moment is never taken out. */
  function gapAudible(m, s, e) {
    const aud = m && m.analysis && m.analysis.aud;
    if (!aud || !aud.energy || !aud.energy.length) return false;
    const hop = aud.hop || 0.05;
    let sum = 0, n = 0;
    for (let i = Math.floor(s / hop); i < Math.min(aud.energy.length, Math.ceil(e / hop)); i++) { sum += aud.energy[i]; n++; }
    return n > 0 && sum / n > 0.2;
  }

  // Where timeline time t lands after removing [at, at + len].
  function rippleTime(t, at, len) {
    if (t <= at) return t;
    return t >= at + len ? t - len : at;
  }

  /* spans: [{ mediaId, a, b }] in source seconds. Returns { cuts, seconds }.
     Pieces shorter than 0.1 s are not kept: a frame or two of picture
     between two cuts reads as a glitch. */
  function cutSourceSpans(spans) {
    const MIN_PIECE = 0.1;
    const was = JSON.parse(JSON.stringify(S.clips));   // clips are changed in place below
    const cuts = [];             // timeline [at, len], in order
    const out = [];
    let at = 0;
    S.clips.forEach((c) => {
      const sp = c.speed || 1;
      const mine = spans.filter((s) => s.mediaId === c.mediaId && s.b > c.in + 0.01 && s.a < c.out - 0.01)
        .map((s) => [Math.max(c.in, s.a), Math.min(c.out, s.b)])
        .sort((x, y) => x[0] - y[0]);
      // merge overlapping stretches
      const holes = [];
      mine.forEach((h) => {
        const last = holes[holes.length - 1];
        if (last && h[0] <= last[1] + 0.02) last[1] = Math.max(last[1], h[1]);
        else holes.push(h.slice());
      });
      // `at` is where this clip starts on the timeline BEFORE any cut: the
      // ripple below applies the cuts last-first, in those coordinates
      if (!holes.length) { out.push(c); at += dispDur(c); return; }
      const keep = [];
      let from = c.in;
      holes.forEach((h) => { keep.push([from, h[0]]); from = h[1]; });
      keep.push([from, c.out]);
      // a sliver between two holes goes too, and its time with it
      const kept = keep.filter((k) => k[1] - k[0] >= MIN_PIECE);
      if (!kept.length) {           // the whole clip was removed
        cuts.push([at, dispDur(c)]);
        at += dispDur(c);
        return;
      }
      const fadeIn = c.fadeIn, fadeOut = c.fadeOut, kb = c.kb, start = c.in, end = c.out;
      const pre = (s) => at + (s - start) / sp;     // source time → timeline, before cuts
      let cursor = start;
      const pieces = kept.map((k, i) => {
        if (k[0] > cursor + 1e-6) cuts.push([pre(cursor), (k[0] - cursor) / sp]);
        const piece = i === 0 ? c : Object.assign({}, c, { id: nextId++ });
        piece.in = k[0];
        piece.out = k[1];
        piece.fadeIn = i === 0 ? fadeIn : 0;
        piece.fadeOut = i === kept.length - 1 ? fadeOut : 0;
        cursor = k[1];
        return piece;
      });
      // one zoom per original clip, on its last piece (as retention.js does)
      if (kb && pieces.length > 1) {
        pieces.forEach((p, i) => { if (i < pieces.length - 1) delete p.kb; else p.kb = Object.assign({}, kb); });
      }
      pieces.forEach((p) => out.push(p));
      if (end > cursor + 1e-6) cuts.push([pre(cursor), (end - cursor) / sp]);
      at = pre(end);
    });
    if (!out.length) { S.clips = was; return { cuts: 0, seconds: 0, everything: true }; }
    S.clips = out;
    // later cuts first, so each one's position is still right when it applies
    let seconds = 0;
    cuts.slice().sort((x, y) => y[0] - x[0]).forEach(([cAt, len]) => {
      seconds += len;
      S.texts.forEach((x) => {
        const e = rippleTime(x.start + x.dur, cAt, len);
        x.start = rippleTime(x.start, cAt, len);
        x.dur = Math.max(0.2, e - x.start);
      });
      S.broll.forEach((x) => {
        const e = rippleTime(x.start + x.dur, cAt, len);
        x.start = rippleTime(x.start, cAt, len);
        x.dur = Math.max(0.2, e - x.start);
      });
      S.sfx.forEach((x) => { x.start = rippleTime(x.start, cAt, len); });
      S.audio.forEach((x) => { x.start = rippleTime(x.start, cAt, len); });
    });
    if (S.captions.length) remapCaptions();
    S.time = clamp(S.time, 0, total());
    return { cuts: cuts.length, seconds: seconds };
  }

  /* Silences between words longer than `min` seconds close to a breath:
     0.2 s after the last word and 0.12 s before the next, about the pause
     a good speaker leaves (E48 in the research: keep the breath). Only
     silences: a laugh or applause in the gap is part of the moment. */
  function pauseSpans(min) {
    const spans = [];
    const seen = new Set();
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (!m || m.type !== "video" || seen.has(m.id)) return;
      seen.add(m.id);
      const ws = timedWords(m);
      for (let k = 1; k < ws.length; k++) {
        const gs = ws[k - 1].end, ge = ws[k].start;
        if (ge - gs <= min) continue;
        if (gapAudible(m, gs + 0.1, ge - 0.1)) continue;
        spans.push({ mediaId: m.id, a: gs + 0.2, b: ge - 0.12 });
      }
    });
    return spans;
  }

  /* Filler words: the sounds that are only hesitation (um, uh, er, hmm),
     and a word said twice in a row because the speaker tripped ("I I",
     "the the"). Words people repeat on purpose ("no no", "very very") are
     left alone. "Like" and "you know" are NOT taken: too often they are
     meant, and cutting a meant word breaks the sentence. */
  const FILLER = /^(u+m+|u+h+m*|e+r+m*|e+h+|a+h+|h+m+|m+h*m+|mm+-?hmm+)$/i;
  const MEANT_TWICE = /^(no|yes|yeah|very|really|so|bye|ha|go|come|knock|well|now|more|again|okay|ok|wait|stop|run)$/i;
  function fillerSpans() {
    const spans = [];
    const seen = new Set();
    const norm = (w) => String(w.text || "").toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, "");
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (!m || m.type !== "video" || seen.has(m.id)) return;
      seen.add(m.id);
      const ws = timedWords(m);
      ws.forEach((w, k) => {
        const t = norm(w);
        if (!t) return;
        const next = ws[k + 1];
        if (FILLER.test(t)) {
          const prevEnd = k ? ws[k - 1].end : w.start - 0.05;
          spans.push({ mediaId: m.id, a: Math.max(prevEnd, w.start - 0.04), b: next ? Math.min(next.start, w.end + 0.04) : w.end + 0.04, filler: t });
        } else if (next && norm(next) === t && !MEANT_TWICE.test(t) && next.start - w.end < 0.6) {
          spans.push({ mediaId: m.id, a: w.start - 0.02, b: next.start - 0.02, filler: t + " " + t });
        }
      });
    });
    return spans;
  }

  /* Bad takes: a speaker who stops and says the line again. The words are cut
     into lines at pauses (over 0.45 s) and at full stops; when a line opens
     with the same three words as the next line, or is all but contained in
     it, the earlier one was the false start and goes, along with the pause
     after it. The last take is kept because it is the one the speaker
     finished. Pure word matching, on the device, no AI call. */
  function takeLines(ws) {
    const lines = [];
    let cur = null;
    ws.forEach((w) => {
      const gap = cur ? w.start - cur.end : 0;
      const ended = cur && /[.!?]["')\]]?$/.test(String(cur.last));
      if (!cur || gap > 0.45 || ended) { cur = { start: w.start, end: w.end, words: [], last: "" }; lines.push(cur); }
      cur.words.push(String(w.text || "").toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ""));
      cur.end = w.end;
      cur.last = String(w.text || "");
    });
    lines.forEach((l) => { l.words = l.words.filter(Boolean); });
    return lines.filter((l) => l.words.length);
  }
  function badTakeSpans() {
    const spans = [];
    const seen = new Set();
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (!m || m.type !== "video" || seen.has(m.id)) return;
      seen.add(m.id);
      const lines = takeLines(timedWords(m));
      for (let i = 0; i + 1 < lines.length; i++) {
        const a = lines[i], b = lines[i + 1];
        if (b.start - a.end > 4) continue;              // too far apart to be a retake
        const n = Math.min(3, a.words.length, b.words.length);
        const sameOpen = n >= 3 && a.words.slice(0, n).join(" ") === b.words.slice(0, n).join(" ");
        const inB = new Set(b.words);
        const covered = a.words.length >= 3 && a.words.filter((w) => inB.has(w)).length / a.words.length >= 0.8 &&
          a.words[0] === b.words[0] && a.words.length < b.words.length + 2;
        if (sameOpen || covered) spans.push({ mediaId: m.id, a: a.start - 0.05, b: b.start - 0.05, take: a.words.join(" ") });
      }
    });
    return spans;
  }

  /* Words are needed for all three. If no video on the timeline has any yet,
     they are transcribed now, the same way captions are (on the device),
     without turning captions on. */
  async function ensureTimedWords(say) {
    const vids = captionSources();
    if (!vids.length) return false;
    if (vids.some((m) => timedWords(m).length)) return true;
    const C = global_SenotelCaptions();
    if (!C || !C.transcribeCaptions) return false;
    const o = S.capOpts;
    for (const m of vids) {
      try { await C.transcribeCaptions(m, { lang: o.lang, tier: o.tier || C.defaultTier(), speakers: o.speakers }, say); }
      catch (e) { console.warn("tidy transcription failed", e); }
    }
    saveSession();
    return vids.some((m) => timedWords(m).length);
  }

  let tidyBusy = false;
  async function runTidy(kind) {
    if (tidyBusy) return;
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    const say = (msg) => { $("tidyStatus").textContent = msg || ""; };
    tidyBusy = true;
    document.querySelectorAll("#tidySheet button").forEach((b) => { b.disabled = true; });
    try {
      say("Finding the words…");
      if (!(await ensureTimedWords(say))) { say("No speech found. These tools work on talking videos."); return; }
      if (kind === "transcript") { say(""); renderTranscript(); return; }
      const spans = kind === "pauses" ? pauseSpans(+$("tidyGap").value || 0.6)
        : kind === "takes" ? badTakeSpans() : fillerSpans();
      if (!spans.length) {
        say(kind === "pauses" ? "No pauses that long. Nothing changed."
          : kind === "takes" ? "No repeated takes found. Nothing changed." : "No filler words found. Nothing changed.");
        return;
      }
      const before = total();
      const r = cutSourceSpans(spans);
      if (r.everything) { say("That would take out the whole video, so nothing was changed."); return; }
      if (!r.cuts) { say("Nothing to take out in what is on the timeline."); return; }
      commit();
      recordEdit("remove-" + kind, { spans: spans.length, seconds: Math.round(r.seconds * 10) / 10 });
      renderTimeline();
      renderInspector();
      syncNow();
      const noun = kind === "pauses" ? ["pause", "pauses"] : kind === "takes" ? ["bad take", "bad takes"] : ["filler word", "filler words"];
      const msg = spans.length + " " + noun[spans.length === 1 ? 0 : 1] +
        " removed, " + (before - total()).toFixed(1) + "s shorter. Undo puts them back.";
      say(msg);
      toast(msg);
    } finally {
      tidyBusy = false;
      document.querySelectorAll("#tidySheet button").forEach((b) => { b.disabled = false; });
    }
  }

  /* EDIT BY THE TRANSCRIPT. Every word on the timeline, in the order it is
     heard; tap a word to strike it, then cut what is struck. Tapping a word
     also moves the playhead to it, so you can hear what you are about to
     take out. */
  let struck = new Set();   // "mediaId:start" of each struck word
  function transcriptRows() {
    const rows = [];
    let at = 0;
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      const sp = c.speed || 1;
      if (m && m.type === "video") {
        timedWords(m).forEach((w) => {
          const mid = (w.start + w.end) / 2;
          if (mid < c.in || mid >= c.out) return;
          rows.push({ m: m, w: w, t: at + (Math.max(w.start, c.in) - c.in) / sp, key: m.id + ":" + w.start.toFixed(3) });
        });
      }
      at += dispDur(c);
    });
    return rows;
  }

  function renderTranscript() {
    const box = $("tidyWords");
    box.innerHTML = "";
    const rows = transcriptRows();
    $("tidyTranscript").classList.remove("hidden");
    if (!rows.length) { box.appendChild(mk("p", "tidy-note", "No words on the timeline yet.")); updateStruck(); return; }
    rows.forEach((r) => {
      const b = mk("button", "tw" + (struck.has(r.key) ? " struck" : ""));
      b.type = "button";
      b.textContent = String(r.w.text || "").trim();
      b.setAttribute("aria-pressed", struck.has(r.key) ? "true" : "false");
      b.addEventListener("click", () => {
        if (struck.has(r.key)) struck.delete(r.key); else struck.add(r.key);
        b.classList.toggle("struck", struck.has(r.key));
        b.setAttribute("aria-pressed", struck.has(r.key) ? "true" : "false");
        S.time = clamp(r.t, 0, total());
        syncNow();
        updateStruck();
      });
      box.appendChild(b);
    });
    updateStruck();
  }

  function updateStruck() {
    const n = transcriptRows().filter((r) => struck.has(r.key)).length;
    const go = $("tidyCutWords");
    go.disabled = !n;
    go.textContent = n ? "Cut " + n + (n === 1 ? " word" : " words") : "Cut struck words";
  }

  function cutStruck() {
    const rows = transcriptRows();
    const spans = [];
    rows.forEach((r) => {
      if (!struck.has(r.key)) return;
      const ws = timedWords(r.m);
      const k = ws.indexOf(r.w);
      const next = ws[k + 1];
      // from the word to the next word, so the silence it leaves goes with it
      spans.push({ mediaId: r.m.id, a: r.w.start - 0.02, b: next ? next.start - 0.02 : r.w.end + 0.08 });
    });
    if (!spans.length) return;
    const before = total();
    const r = cutSourceSpans(spans);
    if (r.everything) { $("tidyStatus").textContent = "That would cut every word, so nothing was changed."; return; }
    struck = new Set();
    commit();
    recordEdit("cut-words", { words: spans.length, seconds: Math.round(r.seconds * 10) / 10 });
    renderTimeline();
    renderInspector();
    syncNow();
    renderTranscript();
    const msg = spans.length + (spans.length === 1 ? " word" : " words") + " cut, " + (before - total()).toFixed(1) + "s shorter. Undo puts them back.";
    $("tidyStatus").textContent = msg;
    toast(msg);
  }

  /* ═══════════ POST: title, description, hashtags ═══════════
     Written from what is said in the edit as it stands now (the captions,
     else the timed words, else the Director's transcript lines), so a cut
     line is never quoted. One text-only call (intelligence.js postText). */
  function editTranscript() {
    const C = global_SenotelCaptions();
    if (S.captions.length && C && C.cueText) return S.captions.map((c) => C.cueText(c)).join(" ");
    const rows = transcriptRows();
    if (rows.length) return rows.map((r) => String(r.w.text || "").trim()).join(" ");
    const lines = [];
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      ((m && m.transcript) || []).forEach((l) => {
        const mid = (l.s + l.e) / 2;
        if (mid >= c.in && mid < c.out) lines.push(l.text);
      });
    });
    return lines.join(" ");
  }

  let postBusy = false;
  async function writePost() {
    if (postBusy) return;
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    const E = window.IntelligenceEngine;
    const say = (m) => { $("postStatus").textContent = m || ""; };
    if (!E || !E.postText || !E.hasGemini()) { say("The AI Director isn't set up here, so it can't write the post text."); return; }
    postBusy = true;
    $("postWrite").disabled = true;
    say("Writing…");
    try {
      const out = await E.postText({
        transcript: editTranscript(),
        texts: S.texts.map((t) => t.text).filter(Boolean),
        note: $("postNote").value.trim(),
        platform: $("postPlatform").value
      });
      $("postTitle").value = out.title || "";
      $("postDesc").value = out.description || "";
      $("postTags").value = (out.hashtags || []).map((h) => "#" + h).join(" ");
      $("postOut").classList.remove("hidden");
      $("postWrite").textContent = "Write again";
      say("Edit anything you like, then copy it into the app you post from.");
      recordEdit("post-text", { platform: $("postPlatform").value, tags: (out.hashtags || []).length });
    } catch (e) {
      say((e && e.message) || "Couldn't write the post text. Try again in a moment.");
    } finally {
      postBusy = false;
      $("postWrite").disabled = false;
    }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
    // older browsers and some app views: a hidden box and the copy command
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    ta.remove();
    return ok;
  }

  document.querySelectorAll("#postPanel [data-copy]").forEach((b) => {
    b.addEventListener("click", async () => {
      const ok = await copyText($(b.dataset.copy).value);
      b.textContent = ok ? "Copied" : "Select and copy";
      setTimeout(() => { b.textContent = "Copy"; }, 1600);
    });
  });
  $("postCopyAll").addEventListener("click", async () => {
    const all = [$("postTitle").value, $("postDesc").value, $("postTags").value].map((s) => s.trim()).filter(Boolean).join("\n\n");
    const ok = await copyText(all);
    $("postCopyAll").textContent = ok ? "Copied" : "Select and copy";
    setTimeout(() => { $("postCopyAll").textContent = "Copy all"; }, 1600);
  });
  $("postWrite").addEventListener("click", writePost);

  /* ═══════════ FILES FOR OTHER EDITORS ═══════════
     CAPTIONS (.srt): the captions as shown, or, with none made, the words
     on the timeline in short lines. Every editor and every platform that
     takes a subtitle file reads SRT.
     THE EDIT (.xml): Final Cut Pro 7 XML ("xmeml"), the interchange format
     Premiere Pro and DaVinci Resolve both import. It carries the cuts (each
     clip's in and out on its source, where it sits, its speed) and the
     footage's sound, plus the audio clips. Files are named, not embedded:
     the editor asks you to point it at the originals ("link media"). Music,
     sound effects, texts, looks and captions are not in it (captions come
     as the .srt). Everything is built on the device. */
  const XML_FPS = 30;
  const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
  const fr = (sec) => Math.max(0, Math.round(sec * XML_FPS));

  function srtTime(t) {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    const p = (n, w) => String(n).padStart(w, "0");
    return p(h, 2) + ":" + p(m, 2) + ":" + p(s, 2) + "," + p(ms % 1000, 3);
  }

  function captionLines() {
    const C = global_SenotelCaptions();
    if (S.captions.length && C && C.cueText) {
      const tr = S.capOpts.translate;
      return S.captions.map((c) => ({
        s: c.start, e: c.end,
        text: tr && c.tr && c.trLang === tr ? String(c.tr) : C.cueText(c)
      }));
    }
    // no captions made: the timed words, a few to a line, broken at pauses
    const out = [];
    let cur = null;
    transcriptRows().forEach((r) => {
      const len = (r.w.end - r.w.start);
      const s = r.t, e = r.t + len;
      if (!cur || cur.n >= 6 || s - cur.e > 0.6) { cur = { s: s, e: e, text: String(r.w.text).trim(), n: 1 }; out.push(cur); }
      else { cur.e = e; cur.text += " " + String(r.w.text).trim(); cur.n++; }
    });
    return out;
  }

  function buildSRT() {
    return captionLines().filter((l) => l.text && l.e > l.s)
      .map((l, i) => (i + 1) + "\n" + srtTime(l.s) + " --> " + srtTime(l.e) + "\n" + l.text.trim() + "\n")
      .join("\n");
  }

  function buildXML() {
    const size = exportSize();
    const dims = size.w === size.h ? { w: 1080, h: 1080 } : size.w > size.h ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
    const name = ($("projectName").value || "").trim() || "vClyps edit";
    const rate = "<rate><timebase>" + XML_FPS + "</timebase><ntsc>FALSE</ntsc></rate>";
    const files = new Map();
    let fileSeq = 0, itemSeq = 0;
    // the first mention of a file describes it; later ones point back to it
    const fileRef = (m) => {
      if (files.has(m.id)) return '<file id="' + files.get(m.id) + '"/>';
      const id = "file-" + (++fileSeq);
      files.set(m.id, id);
      const kinds = (m.type === "audio" ? "" : "<video><samplecharacteristics>" + rate + "</samplecharacteristics></video>") +
        (m.type === "image" ? "" : "<audio><channelcount>2</channelcount></audio>");
      return '<file id="' + id + '"><name>' + xmlEsc(m.name || id) + "</name><pathurl>file://localhost/" +
        encodeURIComponent(m.name || id) + "</pathurl>" + rate +
        // a still has no length of its own; ten minutes covers any use of it
        "<duration>" + (m.type === "image" ? fr(600) : fr(m.duration || 0)) + "</duration><media>" + kinds + "</media></file>";
    };
    const speedFx = (sp) => sp && sp !== 1
      ? "<filter><effect><name>Time Remap</name><effectid>timeremap</effectid><effectcategory>motion</effectcategory><effecttype>motion</effecttype><mediatype>video</mediatype>" +
        "<parameter><parameterid>speed</parameterid><name>speed</name><value>" + Math.round(sp * 100) + "</value></parameter></effect></filter>"
      : "";
    const item = (m, start, end, inS, outS, sp, track, label) => {
      const id = "clipitem-" + (++itemSeq);
      return '<clipitem id="' + id + '"><name>' + xmlEsc(label || m.name || id) + "</name><duration>" + fr(m.duration || (outS - inS)) + "</duration>" + rate +
        "<start>" + start + "</start><end>" + end + "</end><in>" + fr(inS) + "</in><out>" + fr(outS) + "</out>" +
        fileRef(m) + (track === "video" ? speedFx(sp) : "") + "</clipitem>";
    };
    const vItems = [], aItems = [], uItems = [];
    let at = 0;
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      const len = dispDur(c);
      const start = fr(at), end = fr(at + len);
      at += len;
      if (!m || end <= start) return;
      vItems.push(item(m, start, end, c.in, c.out, c.speed || 1, "video", c.name));
      if (m.type === "video" && !c.muted) aItems.push(item(m, start, end, c.in, c.out, c.speed || 1, "audio", c.name));
    });
    S.audio.forEach((a) => {
      const m = mediaById(a.mediaId);
      if (!m) return;
      const len = audioDur(a);
      uItems.push(item(m, fr(a.start), fr(a.start + len), a.in, a.out, a.speed || 1, "audio"));
    });
    const track = (items) => "<track>" + items.join("") + "</track>";
    return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1"><name>' + xmlEsc(name) + "</name>" +
      "<duration>" + fr(total()) + "</duration>" + rate +
      "<media><video><format><samplecharacteristics>" + rate + "<width>" + dims.w + "</width><height>" + dims.h + "</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>" +
      track(vItems) + "</video><audio>" + track(aItems) + (uItems.length ? track(uItems) : "") + "</audio></media></sequence></xmeml>\n";
  }

  function fileBase() {
    return (($("projectName").value || "").trim() || "vclyps-edit").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 80);
  }
  async function saveOut(text, type, ext, okMsg) {
    const blob = new Blob([text], { type: type });
    try {
      const how = await window.SenotelPlatform.save(blob, fileBase() + "." + ext);
      $("postFileStatus").textContent = how === "cancelled" ? "" : okMsg;
    } catch (e) {
      $("postFileStatus").textContent = "Couldn't save the file: " + ((e && e.message) || e);
    }
  }
  $("postSrt").addEventListener("click", () => {
    const srt = buildSRT();
    if (!srt.trim()) { $("postFileStatus").textContent = "No words on the timeline yet. Make captions, or use Tidy to find the words, first."; return; }
    saveOut(srt, "application/x-subrip", "srt", "Captions saved. Import the .srt into your editor or upload it with the video.");
  });
  $("postXml").addEventListener("click", () => {
    saveOut(buildXML(), "application/xml", "xml",
      "Edit saved. In Premiere Pro or DaVinci Resolve, import the .xml, then point it at your original video files.");
  });

  /* One panel, two homes: the Post sheet, and the export card while a video
     renders (the real-time render takes as long as the video, which is time
     enough to write and copy the words). */
  function movePostPanel(where) {
    const panel = $("postPanel");
    const home = where === "export" ? $("expPostSlot") : $("postSheet");
    if (panel.parentNode !== home) home.appendChild(panel);
  }
  /* Follows the export card wherever it is shown or hidden from (start,
     finish, cancel, the failure paths), rather than five calls to keep in
     step. Words written while it rendered are put in front of you again
     when the card closes, so they are not lost with it. */
  new MutationObserver(() => {
    const showing = !$("exportOverlay").classList.contains("hidden");
    const inCard = $("postPanel").parentNode === $("expPostSlot");
    if (showing && !inCard) movePostPanel("export");
    else if (!showing && inCard) {
      movePostPanel("sheet");
      if (!$("postOut").classList.contains("hidden")) setTimeout(() => openSheet("postSheet"), 400);
    }
  }).observe($("exportOverlay"), { attributes: true, attributeFilter: ["class"] });

  $("tbPost").addEventListener("click", () => {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    movePostPanel("sheet");
    openSheet("postSheet");
  });

  function openTidy() {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    struck = new Set();
    $("tidyStatus").textContent = "";
    $("tidyTranscript").classList.add("hidden");
    openSheet("tidySheet");
  }

  /* A title card as its own clip, before or after the footage: the card is
     drawn once, at the export's size, by the same drawStyledText, saved as a
     picture and put on the timeline like any photo (so it is resumed, shown
     and exported the way photos already are). Before the video, everything
     on the timeline moves later by the card's length. */
  function makeCardClip(t, where) { return cardClip(t, where, false); }

  /* A title card drawn to a still and placed as its own clip. `generated` is
     the Director's end card in business mode: it is not a text on the
     timeline to remove, nothing gets selected, and nothing is announced. */
  async function cardClip(t, where, generated) {
    const size = exportSize();
    const k = 1080 / Math.min(size.w, size.h);           // drawn at 1080p, sharp at any export size
    const cv = document.createElement("canvas");
    cv.width = Math.round(size.w * k); cv.height = Math.round(size.h * k);
    const ctx = cv.getContext("2d");
    try { await document.fonts.load("400 40px Anton"); } catch (e) {}
    drawStyledText(ctx, Object.assign({}, t, { style: "card", start: -60, dur: 1e6 }), { x: 0, y: 0, w: cv.width, h: cv.height }, 0);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    if (!blob) { toast("Couldn't make the card on this device"); return; }
    const label = String(t.text || "Card").replace(/[\\/:*?"<>|\n]+/g, " ").trim().slice(0, 40) || "Card";
    const file = new File([blob], "Card - " + label + ".png", { type: "image/png" });
    if (!addFiles([file], "library")) return;
    const m = S.media[S.media.length - 1];
    const len = clamp(t.dur || 2, 0.5, 15);
    const clip = { id: nextId++, mediaId: m.id, in: 0, out: len, speed: 1, volume: 1, muted: false, filter: "none", fadeIn: 0, fadeOut: 0 };
    if (generated && where === "end" && S.clips.length) {
      // the footage hands over to the card through black, and the card holds to the end
      clip.tIn = "black"; clip.tDur = 0.6;
      const last = S.clips[S.clips.length - 1];
      last.fadeOut = 0;
    }
    S.texts = S.texts.filter((x) => x !== t);
    if (where === "start") {
      S.texts.forEach((x) => { x.start += len; });
      S.broll.forEach((x) => { x.start += len; });
      S.sfx.forEach((x) => { x.start += len; });
      S.audio.forEach((x) => { x.start += len; });
      S.clips.unshift(clip);
      S.time = 0;
    } else {
      S.clips.push(clip);
      S.time = Math.max(0, total() - len);
    }
    if (S.captions.length) remapCaptions();
    if (generated) {
      S.time = 0;
      commit();
      renderTimeline();
      return clip;
    }
    S.sel = { type: "clip", id: clip.id };
    commit();
    recordEdit("card-clip", { where: where, seconds: len });
    renderTimeline();
    renderInspector();
    syncNow();
    toast(where === "start" ? "The card now opens the video" : "The card now ends the video");
  }

  function duplicateSelection() {
    if (!S.sel || S.sel.type === "all") { toast("Select something on the timeline to copy"); return; }
    if (S.sel.type === "broll") {
      const b = brollById(S.sel.id);
      if (!b) return;
      const copy = Object.assign({}, b, { id: nextId++, start: b.start + b.dur });
      S.broll.push(copy);
      S.sel = { type: "broll", id: copy.id };
      commit(); renderTimeline(); renderInspector();
      return;
    }
    if (S.sel.type === "sfx") {
      const x = sfxById(S.sel.id);
      if (!x) return;
      const copy = Object.assign({}, x, { id: nextId++, start: x.start + sfxDur(x.name) + 0.2 });
      delete copy.by;   // a copy you made is yours: the next generate leaves it alone
      S.sfx.push(copy);
      S.sel = { type: "sfx", id: copy.id };
      commit(); renderTimeline(); renderInspector();
      return;
    }
    if (S.sel.type === "music") {
      toast("A video has one music track. Use Change to swap it");
      return;
    }
    if (S.sel.type === "effect") {
      const e = effectById(S.sel.id);
      if (!e) return;
      const copy = Object.assign({}, e, { id: nextId++, start: e.start + e.dur });
      S.effects.push(copy);
      S.sel = { type: "effect", id: copy.id };
      commit(); renderTimeline(); renderInspector(); syncOverlays();
      return;
    }
    if (S.sel.type === "uaudio") {
      const a = audioById(S.sel.id);
      if (!a) return;
      const copy = Object.assign({}, a, { id: nextId++, start: a.start + audioDur(a) });
      S.audio.push(copy);
      S.sel = { type: "uaudio", id: copy.id };
      commit(); renderTimeline(); renderInspector();
      return;
    }
    if (S.sel.type === "clip") {
      const c = clipById(S.sel.id);
      if (!c) return;
      const copy = Object.assign({}, c, { id: nextId++ });
      S.clips.splice(S.clips.indexOf(c) + 1, 0, copy);
      S.sel = { type: "clip", id: copy.id };
    } else {
      const t = textById(S.sel.id);
      if (!t) return;
      const copy = Object.assign({}, t, { id: nextId++, start: t.start + t.dur });
      S.texts.push(copy);
      S.sel = { type: "text", id: copy.id };
    }
    commit();
    renderTimeline();
    renderInspector();
  }

  $("tbOverlay").addEventListener("click", () => {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    if (!S.media.length) { libPick = "overlay"; openPicker("overlay"); return; }
    libPick = "overlay";
    openSheet("librarySheet");
  });

  (function wireSoundSearch() {
    const box = $("sndSearch");
    if (!box) return;
    box.addEventListener("input", renderSoundSheet);
    box.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !box.value) return;
      e.stopPropagation();
      box.value = "";
      renderSoundSheet();
    });
  })();

  /* ═══════════ MUSIC ═══════════

     Where it comes from, and why it is this and not something else:

     TikTok and Instagram can offer popular songs because they pay record
     labels for licences. There is no free API that does that legally, so the
     honest target is royalty-free music that anyone may use commercially.

     Openverse (the Creative Commons search engine) indexes Freesound, and its
     audio API can be restricted to CC0: public domain, commercial use allowed,
     no credit required. Anything looser (CC-BY, CC-BY-NC) is unusable for
     people who post what they make. Verified 2026-09-21:

       · no API key, no account, and CORS open, so the browser calls it
         directly and the worker needs no new route
       · the audio itself comes from cdn.freesound.org, also CORS-open, so it
         can be tapped into Web Audio and reaches the exported file
       · anonymous limit is 200 searches a day PER VISITOR (per IP), which is
         why results are cached for the session

     Two filters are applied to every result, and both matter:
       CC0 checked again here, not only trusted from the query string
       the file must be on cdn.freesound.org, the host verified to send CORS;
         a track from anywhere else could play in the preview and then vanish
         from the export, which is the worst way for this to fail
       20 seconds or longer, which separates music beds from the one-shot hits
         and whooshes that share the same catalogue */
  const MUSIC_API = "https://api.openverse.org/v1/audio/";
  const MUSIC_DEFAULT = "chill music";
  const musicCache = new Map();
  let musicQueryToken = 0;

  function cleanTrackTitle(t) {
    return String(t || "Untitled")
      .replace(/\.(wav|mp3|ogg|flac|aiff?)$/i, "")
      .replace(/[_]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim() || "Untitled";
  }

  async function searchMusic(q) {
    const key = (q || "").trim().toLowerCase() || MUSIC_DEFAULT;
    if (musicCache.has(key)) return musicCache.get(key);
    /* 20 is the ceiling for anonymous requests. Asking for 40 is not rounded
       down, it is refused outright with a 401, so the whole library looked
       unreachable. */
    const url = MUSIC_API + "?q=" + encodeURIComponent(key) + "&license=cc0&page_size=20";
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (res.status === 429) throw new Error("rate");
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    const tracks = (data.results || [])
      .filter((r) => r && r.license === "cc0" && typeof r.url === "string"
        && r.url.indexOf("https://cdn.freesound.org/") === 0
        && (r.duration || 0) >= 20000)
      .map((r) => ({
        id: String(r.id),
        title: cleanTrackTitle(r.title),
        url: r.url,
        duration: r.duration / 1000,
        creator: r.creator || "",
        landing: r.foreign_landing_url || "",
        /* How the Director's pick tells a music bed from a field recording or
           a vocal track; see pickTrack() in brain.js. Not stored with S.music. */
        tags: (Array.isArray(r.tags) ? r.tags : []).map((x) => x && x.name).filter(Boolean).slice(0, 16)
      }));
    musicCache.set(key, tracks);
    return tracks;
  }

  /* Auditioning uses its own element, never the bed's. A preview must not be
     able to end up in an export that happens to be running, and should not
     disturb the track already on the timeline. */
  const musicPreview = new Audio();
  musicPreview.crossOrigin = "anonymous";
  musicPreview.preload = "none";
  let previewingId = null;

  function stopMusicPreview() {
    previewingId = null;
    try { musicPreview.pause(); } catch (e) {}
    document.querySelectorAll("#musicGrid .snd-row.lit").forEach((r) => r.classList.remove("lit"));
  }

  function previewMusic(t, row) {
    if (previewingId === t.id) { stopMusicPreview(); return; }
    stopMusicPreview();
    previewingId = t.id;
    musicPreview.src = t.url;
    musicPreview.currentTime = 0;
    musicPreview.volume = 0.8;
    musicPreview.play().then(() => { if (row) row.classList.add("lit"); })
      .catch(() => { previewingId = null; toast("That track would not play. Try another"); });
  }
  musicPreview.addEventListener("ended", stopMusicPreview);

  function useMusic(t) {
    stopMusicPreview();
    S.music = {
      id: t.id, title: t.title, url: t.url, duration: t.duration,
      creator: t.creator, landing: t.landing,
      /* 35%: a bed, not a lead. Loud enough to set the mood, quiet enough
         that the speaker is still the subject. Adjustable in the inspector. */
      gain: 0.35
    };
    loadMusicElement();
    primeAudio();          // this is a click, so Web Audio may start here
    S.sel = { type: "music" };
    commit();
    renderTimeline();
    renderInspector();
    syncNow();
    closeSheets();
    toast("Music added: " + t.title);
  }

  function fmtLen(sec) {
    const m = Math.floor(sec / 60), r = Math.round(sec % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
  }

  async function renderMusic() {
    const grid = $("musicGrid"), status = $("musicStatus");
    if (!grid || !status) return;
    const q = ($("musicSearch").value || "").trim();
    const token = ++musicQueryToken;
    status.textContent = "Searching…";
    status.classList.remove("hidden");
    let tracks;
    try {
      tracks = await searchMusic(q);
    } catch (e) {
      if (token !== musicQueryToken) return;
      grid.innerHTML = "";
      status.textContent = e && e.message === "rate"
        ? "Too many searches from this connection today. It resets within 24 hours."
        : "Couldn't reach the music library. Check your connection and try again.";
      return;
    }
    /* A slower, older search must not overwrite a newer one's results. */
    if (token !== musicQueryToken) return;

    grid.innerHTML = "";
    if (!tracks.length) {
      status.textContent = 'No music matches "' + (q || MUSIC_DEFAULT) + '". Try a mood, a genre or a tempo.';
      return;
    }
    status.textContent = q ? tracks.length + " tracks" : "Try a mood, a genre or a tempo";

    tracks.forEach((t) => {
      const row = mk("div", "snd-row mus-row");
      const meta = mk("div", "mus-meta");
      meta.appendChild(mk("span", "snd-name", ""));
      meta.lastChild.textContent = t.title;
      if (t.creator) {
        const by = mk("span", "mus-by", "");
        by.textContent = t.creator;
        meta.appendChild(by);
      }
      row.appendChild(meta);
      row.appendChild(mk("span", "snd-dur", fmtLen(t.duration)));

      const hear = mk("button", "snd-hear", "");
      hear.title = "Preview";
      hear.setAttribute("aria-label", "Preview " + t.title);
      hear.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
      hear.addEventListener("click", () => previewMusic(t, row));

      const use = mk("button", "snd-add", S.music && S.music.id === t.id ? "In use" : "Use");
      use.addEventListener("click", () => useMusic(t));

      row.appendChild(hear);
      row.appendChild(use);
      grid.appendChild(row);
    });
  }

  function showAudioPane(which) {
    [["music", "musicPane", "tabMusic"], ["fx", "fxPane", "tabFx"], ["mine", "minePane", "tabMine"]].forEach(([k, pane, tab]) => {
      const on = k === which;
      $(pane).classList.toggle("hidden", !on);
      $(tab).classList.toggle("active", on);
      $(tab).setAttribute("aria-selected", on ? "true" : "false");
    });
    if (which !== "music") stopMusicPreview();
    if (which !== "mine") stopMineListen();
  }

  /* YOUR AUDIO: audio files brought in, and every sound extracted from a
     video, ready to put on the audio track at the playhead again. */
  function renderMine() {
    const grid = $("mineGrid");
    stopMineListen();
    grid.innerHTML = "";
    const items = S.media.filter((m) => m.type === "audio" || m.soundSaved);
    $("mineNone").classList.toggle("hidden", items.length > 0);
    items.forEach((m) => {
      const row = mk("div", "snd-row mus-row mine-row");
      row.tabIndex = 0;
      row.title = "Listen or download";
      row.addEventListener("click", (e) => { if (!e.target.closest("button")) toggleMine(m, row); });
      row.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === row) toggleMine(m, row); });
      const meta = mk("div", "mus-meta");
      const name = mk("span", "snd-name", "");
      name.textContent = m.name;
      meta.appendChild(name);
      meta.appendChild(mk("span", "mus-by", m.fromVideo || m.type === "video" ? "Extracted from a video" : "Audio file"));
      row.appendChild(meta);
      row.appendChild(mk("span", "snd-dur", m.duration ? fmtLen(m.duration) : ""));
      const add = mk("button", "snd-add", "Add");
      add.title = "Put this sound on the audio track at " + fmt(S.time);
      add.addEventListener("click", () => {
        primeAudioForClick();
        mediaDuration(m).then(() => {
          const a = addAudioClip(m);
          if (a) closeSheets();
        });
      });
      row.appendChild(add);
      grid.appendChild(row);
    });
  }

  /* Tapping a sound in Your audio opens it: a player to hear all of it, and
     Download, which saves the sound on its own (see audio-out.js: a video's
     sound is copied out as it was recorded, never re-encoded). One open at a
     time. */
  function stopMineListen() {
    document.querySelectorAll("#mineGrid audio").forEach((a) => { try { a.pause(); } catch (e) {} });
  }

  function toggleMine(m, row) {
    const was = row.nextElementSibling && row.nextElementSibling.classList.contains("mine-open");
    stopMineListen();
    document.querySelectorAll("#mineGrid .mine-open").forEach((p) => p.remove());
    document.querySelectorAll("#mineGrid .mine-row.lit").forEach((r) => r.classList.remove("lit"));
    if (was) return;
    row.classList.add("lit");
    const panel = mk("div", "mine-open");
    const player = document.createElement("audio");
    player.controls = true;
    player.preload = "metadata";
    player.src = m.url;
    panel.appendChild(player);
    const line = mk("div", "mine-dl");
    const dl = mk("button", "secondary-btn", "Download");
    const note = mk("span", "mine-fmt", m.fromVideo || m.type === "video"
      ? "The sound only, exactly as it was recorded" : "The file as you added it");
    dl.addEventListener("click", () => downloadSound(m, dl, note));
    line.appendChild(dl);
    line.appendChild(note);
    panel.appendChild(line);
    row.after(panel);
  }

  const soundFiles = new WeakMap();
  async function downloadSound(m, btn, note) {
    if (!window.SenotelAudioOut) { toast("Download isn't available. Reload the page and try again"); return; }
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      /* kept, so a second tap saves at once: a share sheet must open within
         seconds of the tap, and preparing a long sound can take longer */
      const out = soundFiles.get(m) || await SenotelAudioOut.soundFile(m);
      soundFiles.set(m, out);
      // a download in a browser, the share sheet inside an app (platform.js)
      if (await SenotelPlatform.save(out.blob, out.name) === "cancelled") throw new Error("Not saved.");
      note.textContent = out.name + ", " + mbText(out.blob.size) + " MB" +
        (out.how === "decoded" ? ". Saved as WAV: full quality, a bigger file" : "");
      btn.textContent = "Download again";
    } catch (e) {
      note.textContent = (e && e.message) || "Couldn't save that sound. Try again.";
      btn.textContent = "Download";
    }
    btn.disabled = false;
  }

  (function wireMusic() {
    $("tabMusic").addEventListener("click", () => { showAudioPane("music"); renderMusic(); });
    $("tabFx").addEventListener("click", () => { showAudioPane("fx"); renderSoundSheet(); });
    $("tabMine").addEventListener("click", () => { showAudioPane("mine"); renderMine(); });
    $("mineImport").addEventListener("click", () => openAddSheet("audio"));
    $("mineExtract").addEventListener("click", extractFromDevice);

    /* Debounced: a request per keystroke would spend the visitor's daily
       search allowance on half-typed words. */
    let t = null;
    $("musicSearch").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(renderMusic, 380);
    });
    $("musicSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") { clearTimeout(t); renderMusic(); }
    });
  })();

  $("tbAudio").addEventListener("click", () => {
    if (!sfxAvailable()) { toast("This browser has no Web Audio, so sounds cannot play"); return; }
    const box = $("sndSearch");
    if (box) box.value = "";
    renderSoundSheet();
    showAudioPane("music");
    openSheet("soundSheet");
    renderMusic();
    const mbox = $("musicSearch");
    if (mbox && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      setTimeout(() => mbox.focus(), 60);
    }
  });

  $("tbSplit").addEventListener("click", splitAtPlayhead);
  $("tbText").addEventListener("click", addText);
  $("tbStickers").addEventListener("click", () => openStickers(null));
  $("tbEffects").addEventListener("click", () => openEffects(null));
  $("tbVoice").addEventListener("click", startVoiceover);
  $("voiceStop").addEventListener("click", (e) => {
    e.stopPropagation();
    if (VO.rec) stopVoiceover();
    else { clearInterval(VO.timer); cleanupVoice(); toast("Recording cancelled"); }
  });
  $("stkSearch").addEventListener("input", renderStickerSheet);

  /* ═══════════ CAPTIONS ═══════════
     The Captions button opens the Captions sheet. Making captions:
     transcribe each video once, on the device (caption-worker.js: Whisper in
     100 languages), spell the person's names their way, map SOURCE time to
     TIMELINE time clip by clip (a trimmed or moved clip must not drag its
     captions out of sync), mark keywords, translate if asked.
     How they LOOK (style, font, size, position, keyword and speaker
     colours, hidden swear words) is applied as they are drawn, so changing
     it is instant and never transcribes again. */

  function capDefaults() {
    return {
      style: "punch",      // caption-styles.js
      font: "",            // "" = the style's own
      scale: 1,            // size, as a multiple of the style's
      y: null,             // centre, 0 top to 1 bottom; null = the style's
      words: 0,            // most words at a time; 0 = the style's
      lang: "auto",        // spoken language, or detect it
      tier: "",            // "best" | "balanced" | "fast"; "" = the best this device runs
      highlight: true,     // colour each caption's keyword
      speakers: false,     // a colour per voice
      emoji: true,
      censor: "off",       // "off" | "hide" | "bleep"
      swears: [],          // the person's own words to hide
      vocab: [],           // names and terms, spelled their way
      translate: ""        // show the captions in this language
      ,look: {}            // changes to the style's look: see lookedStyle()
    };
  }

  /* The style with the person's changes on top ("Make it yours"). Only the
     fields they touched differ; picking another style clears them. */
  const CAP_LOOK_KEYS = ["fill", "active", "stroke", "strokeW", "box", "boxColor", "shadow", "case", "italic", "anim", "tracking"];
  function lookedStyle(st) {
    const L = S.capOpts.look || {};
    if (!st || !CAP_LOOK_KEYS.some((k) => L[k] != null)) return st;
    const o = Object.assign({}, st);
    if (L.fill) { o.fill = L.fill; delete o.gradient; }
    if (L.active) o.active = L.active;
    if (L.stroke) o.stroke = L.stroke;
    if (L.strokeW != null) { o.strokeW = L.strokeW; if (!o.stroke) o.stroke = L.stroke || "#000000"; }
    if (L.box === "none") delete o.box;
    else if (L.box) {
      const was = st.box || {};
      o.box = { on: L.box, color: L.boxColor || was.color || "#000000", text: was.text, pad: was.pad || (L.box === "line" ? 0.26 : 0.14), radius: was.radius != null ? was.radius : 0.14, alpha: L.box === "line" ? (was.alpha || 0.8) : was.alpha };
    } else if (L.boxColor && st.box) o.box = Object.assign({}, st.box, { color: L.boxColor });
    if (L.shadow === "off") { delete o.shadow; delete o.hard; }
    else if (L.shadow === "on" && !o.shadow) o.shadow = ["rgba(0,0,0,0.65)", 0.3, 0, 0.04];
    if (L.case === "upper") { o.upper = true; o.lower = false; }
    else if (L.case === "lower") { o.lower = true; o.upper = false; }
    else if (L.case === "none") { o.upper = false; o.lower = false; }
    if (L.italic === "on") o.italic = true; else if (L.italic === "off") o.italic = false;
    if (L.anim) o.anim = L.anim;
    if (L.tracking != null) o.tracking = L.tracking;
    return o;
  }

  const CapT = () => window.SenotelCaptionTools || null;
  const langName = (c) => { const T = CapT(); return (T && T.LANG_NAME[c]) || c || ""; };
  const capSheetOpen = () => !$("captionSheet").classList.contains("hidden");

  function capMatcher(lang) {
    const T = CapT();
    return T ? T.censorMatcher(lang || "", S.capOpts.swears) : null;
  }

  // Everything drawCaptions needs, the same for the preview and the export.
  function capDrawOpts(box) {
    const o = S.capOpts;
    return {
      style: lookedStyle(capStyle()) || o.style, font: o.font || null, scale: o.scale || 1, y: o.y,
      highlight: o.highlight, speakers: o.speakers, emoji: o.emoji,
      censor: o.censor, isBad: o.censor === "off" ? null : capMatcher(o.translate || S.capLang),
      translate: o.translate || null, box: box || null
    };
  }

  function capStyle() {
    const C = global_SenotelCaptions();
    return C ? C.styleOf(S.capOpts.style) : null;
  }
  function capWordsAtATime() {
    const st = capStyle();
    return S.capOpts.words || (st && st.words) || 3;
  }

  let capBusy = false;
  function capSay(msg, quiet) {
    $("capStatus").textContent = msg || "";
    if (msg && !quiet && !capSheetOpen()) toast(msg, 4000);
  }
  function setCapBusy(on) {
    capBusy = on;
    ["capMake", "capRemove", "capTrGo"].forEach((id) => { $(id).disabled = on; });
    $("tbCaptions").disabled = on;
  }

  // The videos on the timeline, once each: what gets transcribed.
  function captionSources() {
    const out = [];
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (m && m.type === "video" && out.indexOf(m) < 0) out.push(m);
    });
    return out;
  }

  /* Words → captions on the timeline, from what is already transcribed.
     Runs again when the word list or "words at a time" changes, or the edit
     changes underneath the captions. Never transcribes. */
  function remapCaptions() {
    const C = global_SenotelCaptions(), T = CapT();
    if (!C) return false;
    let at = 0;
    const mapped = [];
    S.clips.forEach((clip) => {
      const media = mediaById(clip.mediaId);
      if (media && media.type === "video" && media.capWords && media.capWords.length) {
        if (T) T.applyVocab(media.capWords, S.capOpts.vocab);
        mapped.push({ words: media.capWords, in: clip.in, out: clip.out, speed: clip.speed || 1, timelineStart: at, lang: media.capLang });
      }
      at += dispDur(clip);
    });
    if (!mapped.length) return false;
    const old = S.captions;
    S.captions = C.mapCuesToTimeline(mapped, { maxWords: capWordsAtATime(), lang: S.capLang, emoji: S.capOpts.emoji });
    carryTranslations(old, S.captions);
    return true;
  }

  // A caption that did not change keeps its translation: no paying twice.
  function carryTranslations(from, to) {
    if (!from || !from.length) return;
    const C = global_SenotelCaptions();
    const key = (c) => c.start.toFixed(2) + "|" + C.cueText(c);
    const was = {};
    from.forEach((c) => { if (c.tr) was[key(c)] = c; });
    to.forEach((c) => {
      const w = was[key(c)];
      if (w) { c.tr = w.tr; c.trLang = w.trLang; c.trWords = w.trWords; }
    });
  }

  async function buildCaptions(opts) {
    opts = opts || {};
    const C = global_SenotelCaptions();
    if (!C) { if (!opts.silent) toast("captions.js did not load"); return false; }
    if (!S.clips.length) { if (!opts.silent) capSay("Add footage to the timeline first"); return false; }
    if (capBusy) return false;
    const sources = captionSources();
    if (!sources.length) { if (!opts.silent) capSay("There's no video on the timeline to caption"); return false; }
    setCapBusy(true);
    const say = (m) => capSay(m, opts.silent);
    const o = S.capOpts;
    let heard = "";
    try {
      for (const media of sources) {
        try {
          const r = await C.transcribeCaptions(media, { lang: o.lang, tier: o.tier || C.defaultTier(), speakers: o.speakers }, say);
          if (!heard && r.words.length) heard = r.lang;
        } catch (e) {
          // one unreadable clip must not lose the captions for the rest
          console.warn("caption transcription failed", e);
          say("Couldn't caption “" + media.name + "”: " + ((e && e.message) || e));
        }
      }
      if (heard) S.capLang = heard;
      if (!remapCaptions() || !S.captions.length) { capSay("No speech found to caption", opts.silent); return false; }
      if (o.translate && o.translate !== S.capLang) {
        try { await C.translateCues(S.captions, o.translate, S.capLang, (m) => capSay(m, true)); }
        catch (e) { capSay("Captions are in " + langName(S.capLang) + ". " + ((e && e.message) || "The translation didn't work"), true); }
      }
      commit();
      syncOverlays();
      capSay(capSummary(), true);
      if (!opts.silent && !capSheetOpen()) toast(S.captions.length + " captions added");
      return true;
    } finally {
      setCapBusy(false);
      if (capSheetOpen()) renderCaptionSheet();
    }
  }

  function capSummary() {
    if (!S.captions.length) return "";
    const tr = S.capOpts.translate;
    const shown = tr && S.captions.some((c) => c.trLang === tr);
    return S.captions.length + " captions" + (S.capLang ? ", heard in " + langName(S.capLang) : "") +
      (shown ? ", shown in " + langName(tr) : "");
  }

  async function applyTranslation() {
    const C = global_SenotelCaptions();
    const target = S.capOpts.translate;
    if (!target || target === S.capLang || !S.captions.length) {
      commit(); syncOverlays(); renderCaptionSheet();
      if (S.captions.length) capSay(capSummary(), true);
      return;
    }
    setCapBusy(true);
    try {
      await C.translateCues(S.captions, target, S.capLang, (m) => capSay(m, true));
      capSay(capSummary(), true);
    } catch (e) {
      capSay((e && e.message) || "Couldn't translate the captions", true);
    } finally {
      setCapBusy(false);
      commit(); syncOverlays(); renderCaptionSheet();
    }
  }

  /* A setting changed: keep it, redraw, and rebuild only what it needs. */
  function capChanged(what) {
    if (what === "remap" && S.captions.length) remapCaptions();
    commit();
    syncOverlays();
    renderCaptionSheet();
  }

  /* ── the style tiles: every style moving, on a sample line ── */
  // two words: big enough to judge a style at a glance, one of them a keyword
  const CAP_SAMPLE = {
    en: { start: 0, end: 2.2, lang: "en", words: [
      { text: "Changes", raw: "Changes", start: 0.05, end: 0.6, sp: false },
      { text: "everything", raw: "everything", start: 0.6, end: 1.5, sp: true, key: true }
    ] },
    th: { start: 0, end: 2.2, lang: "th", words: [
      { text: "เปลี่ยน", raw: "เปลี่ยน", start: 0.05, end: 0.6, sp: false },
      { text: "ทุกอย่าง", raw: "ทุกอย่าง", start: 0.6, end: 1.5, sp: false, key: true }
    ] }
  };
  const TILE_LOOP = 2.2;
  let tileRaf = 0, tileObserver = null, tilesBuilt = false, capCat = "All";
  const tileVisible = new Set();

  function drawTile(cv, t) {
    const C = global_SenotelCaptions();
    const st = C && C.styleOf(cv.dataset.style);
    if (!st) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 104, h = cv.clientHeight || 64;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sample = st.cat === "Thai" ? CAP_SAMPLE.th : CAP_SAMPLE.en;
    C.drawCaptions(ctx, [sample], t % TILE_LOOP, {
      style: st, font: S.capOpts.font || null, scale: (h * 0.36) / (Math.min(w, h) * (st.size || 0.07)),
      y: 0.5, highlight: S.capOpts.highlight, emoji: false, box: { x: 0, y: 0, w: w, h: h }
    });
  }

  function animateTiles() {
    if (tileRaf) return;
    const loop = (ts) => {
      if (!capSheetOpen() || $("capStylePane").classList.contains("hidden")) { tileRaf = 0; return; }
      tileVisible.forEach((cv) => drawTile(cv, ts / 1000));
      tileRaf = requestAnimationFrame(loop);
    };
    tileRaf = requestAnimationFrame(loop);
  }

  function buildTiles() {
    const SL = window.SenotelCaptionStyles;
    if (!SL || tilesBuilt) return;
    tilesBuilt = true;
    const cats = $("capCats"), grid = $("capGrid");
    ["All"].concat(SL.CATEGORIES).forEach((c) => {
      const b = mk("button", "chip cap-cat", c);
      b.dataset.cat = c;
      b.addEventListener("click", () => { capCat = c; filterTiles(); });
      cats.appendChild(b);
    });
    if ("IntersectionObserver" in window) {
      tileObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => { if (e.isIntersecting) tileVisible.add(e.target); else tileVisible.delete(e.target); });
      }, { root: $("captionSheet") });
    }
    SL.LIST.forEach((st) => {
      const b = mk("button", "cap-tile");
      b.type = "button";
      b.dataset.style = st.id;
      b.dataset.cat = st.cat;
      b.setAttribute("aria-label", st.name + " caption style");
      const cv = mk("canvas", "cap-tile-cv");
      cv.dataset.style = st.id;
      b.appendChild(cv);
      b.appendChild(mk("span", "cap-tile-name", st.name));
      b.addEventListener("click", () => {
        S.capOpts.style = st.id;
        S.capOpts.look = {};   // a new style comes with its own look
        // words at a time follows the new style unless the person set it
        capChanged(S.capOpts.words ? "" : "remap");
        if (!S.captions.length) capSay("Style set. Tap Add captions to caption your video", true);
      });
      grid.appendChild(b);
      if (tileObserver) tileObserver.observe(cv); else tileVisible.add(cv);
    });
    filterTiles();
  }

  function filterTiles() {
    document.querySelectorAll("#capCats .cap-cat").forEach((b) => b.classList.toggle("selected", b.dataset.cat === capCat));
    document.querySelectorAll("#capGrid .cap-tile").forEach((b) => {
      b.classList.toggle("hidden", capCat !== "All" && b.dataset.cat !== capCat);
    });
    // one still frame each, for browsers that are not animating right now
    document.querySelectorAll("#capGrid .cap-tile:not(.hidden) canvas").forEach((cv) => drawTile(cv, 1.0));
  }

  function fillLangSelects() {
    const T = CapT();
    if (!T || $("capLang").options.length) return;
    const sorted = T.LANGUAGES.slice().sort((a, b) => a[1].localeCompare(b[1]));
    const add = (sel, v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); };
    add($("capLang"), "auto", "Detect automatically");
    add($("capTr"), "", "The language spoken");
    sorted.forEach((l) => { add($("capLang"), l[0], l[1]); add($("capTr"), l[0], l[1]); });
  }

  /* The caption font button shows the chosen font in that font, and opens
     the caption library (fonts.js), with your own fonts at the top. */
  function fillFontSelect() {
    const btn = $("capFont"), SF = window.SenotelFonts;
    const name = S.capOpts.font || "";
    const label = btn.querySelector(".font-btn-name");
    label.textContent = name || "The style's own font";
    label.style.fontFamily = name ? "'" + name + "', system-ui, sans-serif" : "";
    if (name && SF) SF.load(name, 700);
    btn.querySelector(".font-btn-more").textContent = SF ? SF.CAPTION.length + " fonts" : "";
  }
  function openCaptionFonts() {
    const SF = window.SenotelFonts, T = CapT();
    if (!SF) return;
    const extra = [{ value: "", label: "The style's own font", note: "Each style comes with its own" }];
    (T ? T.customFonts() : []).forEach((f) => extra.push({ value: f, label: f, family: f, note: "Your font, kept on this device" }));
    SF.openPicker({
      kind: "caption", value: S.capOpts.font || "", extra: extra,
      onPick: (v) => { S.capOpts.font = v; fillFontSelect(); capChanged(); filterTiles(); }
    });
  }

  // "Make it yours": the controls show the style's own values until changed
  const CAP_ANIMS = [["", "The style's own"], ["none", "Still"], ["pop", "Pop"], ["bounce", "Bounce"], ["zoom", "Zoom in"], ["fade", "Fade"],
    ["slide", "Slide up"], ["rise", "Rise"], ["drop", "Drop"], ["shake", "Shake"], ["swing", "Swing"], ["wave", "Wave"], ["flash", "Flash"],
    ["reveal", "Word by word"], ["sweep", "Karaoke sweep"], ["type", "Typewriter"], ["single", "One word at a time"]];
  function renderCapLook() {
    const st = capStyle(), L = S.capOpts.look || {}, eff = lookedStyle(st) || {};
    const hex = (c, d) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : d);
    $("capFill").value = hex(eff.fill || (eff.gradient && eff.gradient[0]), "#ffffff");
    $("capActive").value = hex(eff.active, "#ffe600");
    $("capStroke").value = hex(eff.stroke, "#000000");
    $("capStrokeW").value = Math.round((eff.stroke ? eff.strokeW || 0 : 0) * 100);
    $("capBoxColor").value = hex(eff.box && eff.box.color, "#000000");
    document.querySelectorAll("#capBox button").forEach((b) => b.classList.toggle("active", b.dataset.b === (L.box || "")));
    document.querySelectorAll("#capShadow button").forEach((b) => b.classList.toggle("active", b.dataset.s === (L.shadow || "")));
    document.querySelectorAll("#capCase button").forEach((b) => b.classList.toggle("active", b.dataset.k === (L.case || "")));
    document.querySelectorAll("#capSlant button").forEach((b) => b.classList.toggle("active", b.dataset.i === (L.italic || "")));
    $("capTrack").value = Math.round((eff.tracking || 0) * 100);
    $("capTrackOut").textContent = L.tracking != null ? Math.round(L.tracking * 100) + "" : "Style's";
    const sel = $("capAnim");
    if (!sel.options.length) CAP_ANIMS.forEach(([v, label]) => { const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o); });
    sel.value = L.anim || "";
  }
  function setCapLook(k, v, final) {
    S.capOpts.look = Object.assign({}, S.capOpts.look || {});
    if (v == null || v === "") delete S.capOpts.look[k]; else S.capOpts.look[k] = v;
    if (final) capChanged(); else syncOverlays();
    renderCapLook();
  }

  function renderCaptionSheet() {
    const C = global_SenotelCaptions(), T = CapT(), o = S.capOpts;
    if (!C) return;
    if (T) T.loadFontCss();
    buildTiles();
    fillLangSelects();
    fillFontSelect();
    renderCapLook();
    const has = S.captions.length > 0;
    $("capMake").textContent = has ? "Update captions" : "Add captions";
    $("capRemove").classList.toggle("hidden", !has);
    $("capHeard").textContent = has && S.capLang ? "Heard in " + langName(S.capLang) : "";
    document.querySelectorAll("#capGrid .cap-tile").forEach((b) => b.classList.toggle("selected", b.dataset.style === o.style));
    document.querySelectorAll("#capWords button").forEach((b) => b.classList.toggle("active", +b.dataset.w === (o.words || 0)));
    const st = capStyle();
    $("capSize").value = Math.round((o.scale || 1) * 100);
    $("capSizeOut").textContent = Math.round((o.scale || 1) * 100) + "%";
    $("capPos").value = Math.round((o.y != null ? o.y : (st && st.y) || 0.72) * 100);
    $("capPosOut").textContent = o.y != null ? Math.round(o.y * 100) + "% down" : "Style's";
    $("capKeys").checked = o.highlight !== false;
    $("capSpk").checked = !!o.speakers;
    $("capEmoji").checked = o.emoji !== false;
    document.querySelectorAll("#capCensor button").forEach((b) => b.classList.toggle("active", b.dataset.c === o.censor));
    if (document.activeElement !== $("capSwears")) $("capSwears").value = (o.swears || []).join(", ");
    if (document.activeElement !== $("capVocab")) $("capVocab").value = (o.vocab || []).join("\n");
    $("capLang").value = o.lang || "auto";
    $("capTr").value = o.translate || "";
    const tier = C.effectiveTier(o.tier || C.defaultTier());
    document.querySelectorAll("#capTier button").forEach((b) => {
      b.classList.toggle("active", b.dataset.t === tier);
      b.disabled = !C.hasGPU() && b.dataset.t !== "fast";
    });
    const tinfo = C.TIERS[tier];
    $("capTierNote").textContent = !C.hasGPU()
      ? "This browser can't use the graphics chip, so captions use the Fast model (" + tinfo.mb + " MB, downloaded once)."
      : tinfo.label + ": a " + tinfo.mb + " MB model, downloaded once and kept on this device. " +
        (tier === "best" ? "The most accurate, and the best for names, numbers and accents." : tier === "balanced" ? "Good accuracy, a third of the download time." : "Quickest to download; misses more.");
    if (S.captions.length && !capBusy && !$("capStatus").textContent) capSay(capSummary(), true);
    animateTiles();
  }

  function openCaptionSheet() {
    openSheet("captionSheet");
    $("capStatus").textContent = "";
    renderCaptionSheet();
    // the model loads while a style is chosen, if it is already on the device
    const C = global_SenotelCaptions();
    if (C && C.warm && captionSources().length) C.warm(S.capOpts.tier || C.defaultTier());
  }

  (function wireCaptions() {
    $("tbCaptions").addEventListener("click", openCaptionSheet);
    $("capMake").addEventListener("click", () => buildCaptions());
    $("capRemove").addEventListener("click", () => {
      S.captions = [];
      commit();
      syncOverlays();
      capSay("Captions removed", true);
      renderCaptionSheet();
    });
    document.querySelectorAll("#captionSheet .aud-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const which = tab.dataset.cap;
        document.querySelectorAll("#captionSheet .aud-tab").forEach((t) => {
          const on = t === tab;
          t.classList.toggle("active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        $("capStylePane").classList.toggle("hidden", which !== "style");
        $("capTextPane").classList.toggle("hidden", which !== "text");
        $("capLangPane").classList.toggle("hidden", which !== "lang");
        if (which === "style") { filterTiles(); animateTiles(); }
      });
    });
    $("capFont").addEventListener("click", openCaptionFonts);
    // Make it yours: colours apply live and are saved when let go
    [["capFill", "fill"], ["capActive", "active"], ["capStroke", "stroke"], ["capBoxColor", "boxColor"]].forEach(([id, k]) => {
      $(id).addEventListener("input", () => setCapLook(k, $(id).value, false));
      $(id).addEventListener("change", () => setCapLook(k, $(id).value, true));
    });
    $("capStrokeW").addEventListener("input", () => setCapLook("strokeW", +$("capStrokeW").value / 100, false));
    $("capStrokeW").addEventListener("change", () => setCapLook("strokeW", +$("capStrokeW").value / 100, true));
    $("capTrack").addEventListener("input", () => setCapLook("tracking", +$("capTrack").value / 100, false));
    $("capTrack").addEventListener("change", () => setCapLook("tracking", +$("capTrack").value / 100, true));
    document.querySelectorAll("#capLook [data-reset]").forEach((b) => {
      b.addEventListener("click", () => {
        if (b.dataset.reset === "stroke") { S.capOpts.look = Object.assign({}, S.capOpts.look); delete S.capOpts.look.strokeW; }
        setCapLook(b.dataset.reset, null, true);
      });
    });
    [["capBox", "box", "b"], ["capShadow", "shadow", "s"], ["capCase", "case", "k"], ["capSlant", "italic", "i"]].forEach(([id, k, d]) => {
      document.querySelectorAll("#" + id + " button").forEach((b) => b.addEventListener("click", () => setCapLook(k, b.dataset[d], true)));
    });
    $("capAnim").addEventListener("change", () => setCapLook("anim", $("capAnim").value, true));
    $("capLookReset").addEventListener("click", () => { S.capOpts.look = {}; capChanged(); });
    $("capFontUpload").addEventListener("click", () => $("capFontFile").click());
    $("capFontFile").addEventListener("change", async () => {
      const f = $("capFontFile").files && $("capFontFile").files[0];
      $("capFontFile").value = "";
      if (!f || !CapT()) return;
      const note = $("capFontNote");
      note.classList.remove("hidden");
      note.textContent = "Adding " + f.name + "…";
      try {
        const name = await CapT().addCustomFont(f);
        S.capOpts.font = name;
        note.textContent = "“" + name + "” is added and kept on this device.";
        fillFontSelect();
        capChanged();
        filterTiles();
      } catch (e) {
        note.textContent = (e && e.message) || "That font couldn't be added.";
      }
    });
    document.querySelectorAll("#capWords button").forEach((b) => {
      b.addEventListener("click", () => { S.capOpts.words = +b.dataset.w; capChanged("remap"); });
    });
    $("capSize").addEventListener("input", () => {
      S.capOpts.scale = +$("capSize").value / 100;
      $("capSizeOut").textContent = $("capSize").value + "%";
      syncOverlays();
    });
    $("capPos").addEventListener("input", () => {
      S.capOpts.y = +$("capPos").value / 100;
      $("capPosOut").textContent = $("capPos").value + "% down";
      syncOverlays();
    });
    $("capSize").addEventListener("change", () => capChanged());
    $("capPos").addEventListener("change", () => capChanged());
    $("capResetPlace").addEventListener("click", () => { S.capOpts.scale = 1; S.capOpts.y = null; capChanged(); });
    $("capKeys").addEventListener("change", () => { S.capOpts.highlight = $("capKeys").checked; capChanged(); filterTiles(); });
    $("capEmoji").addEventListener("change", () => { S.capOpts.emoji = $("capEmoji").checked; capChanged("remap"); });
    $("capSpk").addEventListener("change", () => {
      S.capOpts.speakers = $("capSpk").checked;
      // voices are told apart once per clip; after that this is only colour
      const need = S.capOpts.speakers && captionSources().some((m) => m.capWords && !m.capSpk);
      if (need) buildCaptions();
      else capChanged();
    });
    document.querySelectorAll("#capCensor button").forEach((b) => {
      b.addEventListener("click", () => {
        S.capOpts.censor = b.dataset.c;
        primeAudioForClick();   // a bleep has to reach the preview and the export
        capChanged();
      });
    });
    const listFrom = (s, sep) => String(s || "").split(sep).map((x) => x.trim()).filter(Boolean).slice(0, 300);
    let swearTimer = null, vocabTimer = null;
    $("capSwears").addEventListener("input", () => {
      clearTimeout(swearTimer);
      swearTimer = setTimeout(() => { S.capOpts.swears = listFrom($("capSwears").value, /[,\n]/); capChanged(); }, 500);
    });
    $("capVocab").addEventListener("input", () => {
      clearTimeout(vocabTimer);
      vocabTimer = setTimeout(() => { S.capOpts.vocab = listFrom($("capVocab").value, /[\n,]/); capChanged("remap"); }, 600);
    });
    $("capLang").addEventListener("change", () => {
      S.capOpts.lang = $("capLang").value;
      commit();
      if (S.captions.length) capSay("Tap Update captions to listen again in " + (S.capOpts.lang === "auto" ? "the detected language" : langName(S.capOpts.lang)), true);
    });
    $("capTr").addEventListener("change", () => {
      S.capOpts.translate = $("capTr").value;
      // switching back to the spoken language, or to a translation already made, is instant
      const ready = !S.capOpts.translate || S.capOpts.translate === S.capLang ||
        (S.captions.length && S.captions.every((c) => c.trLang === S.capOpts.translate));
      if (ready) { capChanged(); capSay(capSummary(), true); }
      else capSay(S.captions.length ? "Tap Translate to show the captions in " + langName(S.capOpts.translate) : "", true);
    });
    $("capTrGo").addEventListener("click", () => {
      if (!S.captions.length) { capSay("Add captions first, then translate them", true); return; }
      applyTranslation();
    });
    document.querySelectorAll("#capTier button").forEach((b) => {
      b.addEventListener("click", () => {
        S.capOpts.tier = b.dataset.t;
        commit();
        renderCaptionSheet();
        if (S.captions.length) capSay("Tap Update captions to caption again with this model", true);
      });
    });
    // custom fonts come back each visit; a caption made with one exports with it
    const T = CapT();
    if (T) {
      T.onFont = () => { syncOverlays(); if (capSheetOpen()) filterTiles(); };
      T.restoreCustomFonts().then(() => { if (capSheetOpen()) fillFontSelect(); });
    }
  })();

  $("tbDelete").addEventListener("click", deleteSelection);
  $("tbDuplicate").addEventListener("click", duplicateSelection);
  $("tbFilter").addEventListener("click", () => {
    if (!S.clips.length) { toast("Add clips to the timeline first"); return; }
    S.sel = { type: "all" };
    renderTimeline();
    renderInspector();
  });

  /* ═══════════ TIMELINE RENDER & INTERACTION ═══════════ */

  const PADX = 20;
  const CLIP_TILE = 56;   // width of one frame in the strip; about the main track's height

  function renderTimeline() {
    const vt = $("videoTrack"), tt = $("textTrack"), ruler = $("ruler");
    const ot = $("overlayTrack"), at = $("audioTrack"), mt = $("musicTrack"), ut = $("uaudioTrack"), et = $("effectTrack");
    vt.innerHTML = ""; tt.innerHTML = ""; ot.innerHTML = ""; at.innerHTML = ""; mt.innerHTML = ""; ut.innerHTML = ""; et.innerHTML = "";

    const totSec = Math.max(total(), 12);
    const W = Math.max(totSec * S.pps + 200, $("tlScroll").clientWidth - PADX * 2);
    [vt, tt, ot, at, mt, ut, et, ruler].forEach((x) => { x.style.width = W + "px"; });

    /* Half a viewport of padding at each end so the first and last frame can
       both sit under a centred playhead — the same reason CapCut lets you
       scroll past both ends of your edit. */
    $("tlInner").style.padding = "0 " + padL() + "px";

    /* The ruler, as CapCut spaces it: a time every so often, never closer
       than about 70px apart, and a single dot halfway between. No tick
       forest, nothing to read that isn't needed. */
    ruler.innerHTML = "";
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * S.pps >= 70) || 600;
    for (let s = 0; s <= W / S.pps; s += step) {
      const lb = document.createElement("span");
      lb.className = "rt";
      lb.style.left = s * S.pps + "px";
      lb.textContent = fmt(s);
      ruler.appendChild(lb);
      const dot = document.createElement("i");
      dot.className = "rdot";
      dot.style.left = (s + step / 2) * S.pps + "px";
      ruler.appendChild(dot);
    }

    // video clips
    let x = 0;
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      const w = Math.max(dispDur(c) * S.pps, 26);
      const cel = document.createElement("div");
      cel.className = "clip" + (S.sel && S.sel.type === "clip" && S.sel.id === c.id ? " sel" : "");
      cel.style.left = x + "px";
      cel.style.width = w + "px";
      /* Pictures from inside the clip, edge to edge (the frame strip), the
         way CapCut shows footage. Only what helps is written on top: a name
         you gave the clip, and its length while it is selected. */
      const strip = mk("div", "cstrip");
      const tile = CLIP_TILE;
      const n = Math.min(240, Math.ceil(w / tile));
      for (let i = 0; i < n; i++) {
        const src = m && m.type === "video" ? frameAt(m, c.in + ((i + 0.5) * tile / S.pps) * c.speed) : m && m.thumb;
        const img = document.createElement("img");
        img.draggable = false;
        img.alt = "";
        if (src) img.src = src;
        strip.appendChild(img);
      }
      cel.appendChild(strip);
      if (c.name) {
        const nm = document.createElement("span");
        nm.className = "cname";
        nm.textContent = c.name;
        cel.appendChild(nm);
      }
      if (c.freeze) cel.appendChild(mk("span", "cbadge", "Freeze"));
      if (S.sel && S.sel.type === "clip" && S.sel.id === c.id) {
        const du = document.createElement("span");
        du.className = "cdur";
        du.textContent = dispDur(c).toFixed(1) + "s";
        cel.appendChild(du);
      }

      if (S.sel && S.sel.type === "clip" && S.sel.id === c.id) {
        const hl = document.createElement("div");
        hl.className = "handle hl";
        const hr = document.createElement("div");
        hr.className = "handle hr";
        cel.appendChild(hl);
        cel.appendChild(hr);
        hl.addEventListener("pointerdown", (e) => startTrim(e, c, "l"));
        hr.addEventListener("pointerdown", (e) => startTrim(e, c, "r"));
      }
      cel.addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("handle")) return;
        holdToDrag(e, (ev) => startClipDrag(ev, c, cel));
      });
      vt.appendChild(cel);
      x += w;
    });

    /* CapCut's cut button: a small square on every cut between two clips.
       Tap it for the transitions into the clip after it; it is filled in when
       that cut already has one. */
    {
      let at = 0;
      S.clips.forEach((c, i) => {
        if (i > 0) {
          const b = mk("button", "cut-btn" + (c.tIn && c.tIn !== "none" ? " on" : ""));
          b.type = "button";
          b.title = c.tIn && window.SenotelFX ? SenotelFX.nameOf(c.tIn) : "Add a transition";
          b.setAttribute("aria-label", b.title);
          b.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>';
          b.style.left = at + "px";
          b.addEventListener("pointerdown", (ev) => ev.stopPropagation());
          b.addEventListener("click", (ev) => {
            ev.stopPropagation();
            pendingTool = "trans";
            S.sel = { type: "clip", id: c.id };
            lastSelKey = "";   // open the panel even if this clip was already selected
            renderTimeline();
            renderInspector();
          });
          vt.appendChild(b);
        }
        at += Math.max(dispDur(c) * S.pps, 26);
      });
    }

    /* The + at the end of the main track. CapCut puts one here and it is the
       only "add" control that tells you WHERE the thing will land, which is
       why the toolbar button alone was never quite enough. */
    const plus = mk("button", "clip-add", "+");
    plus.title = "Add a video or photo to the end";
    plus.style.left = x + "px";
    plus.addEventListener("click", (ev) => { ev.stopPropagation(); openPicker("editor"); });
    vt.appendChild(plus);

    renderEffectTrack(et);
    renderOverlayTrack(ot);
    renderUserAudioTrack(ut);
    renderAudioTrack(at);
    renderMusicTrack(mt);

    // text clips
    S.texts.forEach((t) => {
      const tel = document.createElement("div");
      tel.className = "tclip" + (S.sel && S.sel.type === "text" && S.sel.id === t.id ? " sel" : "");
      tel.style.left = t.start * S.pps + "px";
      tel.style.width = Math.max(t.dur * S.pps, 24) + "px";
      tel.appendChild(mk("span", "tname", ""));
      tel.firstChild.textContent = t.sticker === "emoji" ? t.text : t.sticker === "shape" ? "\u25C6  " + t.text : "T  " + t.text;
      // a selected text stretches from either edge, as CapCut's do
      if (S.sel && S.sel.type === "text" && S.sel.id === t.id) {
        const hl = mk("div", "handle hl"), hr = mk("div", "handle hr");
        tel.appendChild(hl);
        tel.appendChild(hr);
        hl.addEventListener("pointerdown", (ev) => startOverlayTrim(ev, t, "l", tel));
        hr.addEventListener("pointerdown", (ev) => startOverlayTrim(ev, t, "r", tel));
      }
      tel.addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("handle")) return;
        holdToDrag(e, (ev) => startTextDrag(ev, t, tel));
      });
      tt.appendChild(tel);
    });

    // a phone folds away the lanes with nothing on them (styles.css)
    [et, ot, tt, ut, at, mt].forEach((t) => t.classList.toggle("empty", !t.children.length));
    /* ...except that, as in CapCut, an empty text lane and an empty sound
       lane offer to be filled: "+ Add text", "+ Add audio", along the edit. */
    const offer = (track, label, go) => {
      const b = mk("button", "lane-add", "+ " + label);
      b.type = "button";
      b.style.width = Math.max(total() * S.pps, 200) + "px";
      b.addEventListener("click", (ev) => { ev.stopPropagation(); go(); });
      track.appendChild(b);
      track.classList.add("offer");
    };
    [tt, ut].forEach((t) => t.classList.remove("offer"));
    if (S.clips.length) {
      if (!S.texts.length) offer(tt, "Add text", addText);
      if (!S.audio.length && !S.sfx.length && !S.music) offer(ut, "Add audio", () => $("tbAudio").click());
    }
    updatePlayheadUI();
  }

  /* On a touchscreen a finger on a clip means one of three things, as in
     CapCut. A swipe scrolls the timeline sideways, and only sideways: the
     browser does it (touch-action: pan-x), with its own momentum, so a flick
     glides on. Holding still for a moment picks the clip up to move it, and
     from then on the finger belongs to the drag (touchLocked stops the
     browser scrolling under it). A quick tap selects. A mouse goes straight
     through to the drag. (Until 2026-10-22 the swipe was done by hand here:
     it stopped dead on release and could scroll the whole editor up and
     down, which CapCut never does.) */
  const HOLD_MS = 280;
  // one tap of the phone's vibration motor, wherever vClyps runs (platform.js haptic)
  function buzz(kind) { try { if (window.SenotelPlatform && SenotelPlatform.haptic) SenotelPlatform.haptic(kind); } catch (e) {} }
  function holdToDrag(e, start) {
    if (e.pointerType !== "touch") { start(e); return; }
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    let mode = "wait";
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    const timer = setTimeout(() => {
      if (mode !== "wait" || pinching) return;
      finish();
      touchLocked = true;
      const release = (ev) => {
        if (ev.pointerId !== id) return;
        touchLocked = false;
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", release);
      };
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", release);
      buzz("medium");   // picked up
      start(e);   // picked up: the drag code takes the rest of the gesture
    }, HOLD_MS);
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (mode === "wait" && Math.max(Math.abs(dx), Math.abs(dy)) > 6) {
        // a swipe: the browser scrolls the timeline; nothing more to do here
        mode = "swipe";
        clearTimeout(timer);
        if (S.playing) pause();
      }
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      // pointercancel is the browser taking the gesture over to scroll
      const tap = mode === "wait" && ev.type === "pointerup";
      finish();
      if (!tap) return;
      /* A tap. The drag code's own release is what selects, and a listener
         added during this release would not hear it, so it gets one of its
         own, at the spot the finger went down. */
      start(e);
      window.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: id, pointerType: "touch", clientX: x0, clientY: y0
      }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /* clip drag = select + reorder */
  function startClipDrag(e, clip, cel) {
    e.preventDefault();
    const startX = e.clientX;
    let moved = false;
    const origIdx = S.clips.indexOf(clip);
    // how far the clip has travelled: the finger, plus any scrolling done under it
    const sc = $("tlScroll"), s0 = sc.scrollLeft;
    let lastX = startX;
    const travel = () => lastX - startX + (sc.scrollLeft - s0);
    const place = () => { if (moved) cel.style.transform = "translateX(" + travel() + "px)"; };
    const edge = edgeScroller(place);

    const move = (ev) => {
      lastX = ev.clientX;
      if (!moved && Math.abs(lastX - startX) > 8) { moved = true; cel.classList.add("dragging"); }
      if (moved) { place(); edge.at(ev.clientX); }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      edge.stop();
      if (!moved) {
        S.sel = { type: "clip", id: clip.id };
        renderTimeline();
        renderInspector();
        return;
      }
      lastX = ev.clientX;
      const dx = travel();
      const center = parseFloat(cel.style.left) + cel.offsetWidth / 2 + dx;
      // find which slot the dragged center falls into
      let acc = 0, newIdx = S.clips.length - 1;
      for (let i = 0; i < S.clips.length; i++) {
        const w = Math.max(dispDur(S.clips[i]) * S.pps, 26);
        if (center < acc + w) { newIdx = i; break; }
        acc += w;
      }
      if (newIdx !== origIdx) {
        S.clips.splice(origIdx, 1);
        S.clips.splice(newIdx, 0, clip);
        commit();
        recordEdit("reorder", { from: origIdx, to: newIdx });
      }
      S.sel = { type: "clip", id: clip.id };
      renderTimeline();
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* trim handles */
  function startTrim(e, clip, side) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const m = mediaById(clip.mediaId);
    const maxOut = m && m.type === "video" && m.duration ? m.duration : 120;
    const oIn = clip.in, oOut = clip.out;
    /* The end of a trimmed clip snaps to the playhead and to the texts,
       overlays and sounds above it. Not to the cuts after it: those move
       with the trim, so they are no place to aim for. */
    const at = clipStartOf(clip);
    const marks = [S.time];
    S.texts.forEach((t) => marks.push(t.start, t.start + t.dur));
    S.broll.forEach((b) => marks.push(b.start, b.start + b.dur));
    S.audio.forEach((a) => marks.push(a.start, a.start + audioDur(a)));
    S.sfx.forEach((x) => marks.push(x.start, x.start + sfxDur(x.name)));

    const move = (ev) => {
      const dSrc = ((ev.clientX - startX) / S.pps) * clip.speed;
      if (side === "l") clip.in = clamp(oIn + dSrc, 0, clip.out - 0.15);
      else {
        const end = snapPoint(at + (oOut + dSrc - clip.in) / clip.speed, null, null, marks);
        clip.out = clamp(clip.in + (end - at) * clip.speed, clip.in + 0.15, maxOut);
      }
      renderTimeline();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      hideSnap();
      S.time = clamp(S.time, 0, total());
      commit();
      recordEdit("trim", {
        mediaId: clip.mediaId,
        in: Math.round(clip.in * 100) / 100,
        out: Math.round(clip.out * 100) / 100
      });
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* text drag / select */
  function startTextDrag(e, t, el) {
    e.preventDefault();
    const startX = e.clientX;
    const oStart = t.start;
    let moved = false;
    const sc = $("tlScroll"), s0 = sc.scrollLeft;
    let lastX = startX;
    // keep the finger on this element for the whole drag
    try { if (el && el.setPointerCapture && e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (err) {}
    /* Only the dragged text moves while the finger does; the timeline is
       redrawn once, on release. Redrawing on every move took the element
       out from under the finger, and a phone then scrolled instead. */
    const apply = () => {
      if (!moved) return;
      const dx = lastX - startX + (sc.scrollLeft - s0);
      const lim = Math.max(0, total() - 0.3);
      t.start = clamp(snapSpan(clamp(oStart + dx / S.pps, 0, lim), t.dur, t), 0, lim);
      if (el && el.isConnected) { el.style.left = t.start * S.pps + "px"; el.classList.add("dragging"); }
      else renderTimeline();
      syncOverlays();
    };
    const edge = edgeScroller(apply);

    const move = (ev) => {
      lastX = ev.clientX;
      if (!moved && Math.abs(lastX - startX) > 6) moved = true;
      if (moved) { apply(); edge.at(ev.clientX); }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      edge.stop();
      hideSnap();
      window.removeEventListener("pointercancel", up);
      if (moved) commit();
      S.sel = { type: "text", id: t.id };
      renderTimeline();
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);   // whatever happens, the text is put down where it is
  }

  /* scrub on ruler / empty track */
  function scrubHandler(trackEl) {
    trackEl.addEventListener("pointerdown", (e) => {
      if (e.target !== trackEl) return;
      const rect = trackEl.getBoundingClientRect();
      const setT = (ev) => {
        S.time = clamp((ev.clientX - rect.left) / S.pps, 0, total());
        syncNow();
      };
      setT(e);
      const move = (ev) => setT(ev);
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
  }
  scrubHandler($("ruler"));

  /* Dragging the timeline scrubs it. Touch gets this free from overflow-x, but
     a mouse does not scroll a div by dragging it, so the gesture is
     reproduced here — otherwise the whole interaction only works on a phone. */
  (function dragToScrub() {
    const sc = $("tlScroll");
    let down = false, x0 = 0, s0 = 0, moved = false;
    let touch = false;
    sc.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".clip, .tclip, .oclip, .aclip, .uclip, .mclip, .clip-add, .lane-add, .cut-btn, .handle, .ruler")) return;
      down = true; moved = false; x0 = e.clientX; s0 = sc.scrollLeft;
      touch = e.pointerType === "touch";
    });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      if (S.playing) pause();
      // a finger is scrolled by the browser itself, with momentum; only a mouse is moved here
      if (!touch) sc.scrollLeft = s0 - dx;
    });
    // the browser took a touch over to scroll it: that was a swipe, not a tap
    window.addEventListener("pointercancel", () => { down = false; });
    window.addEventListener("pointerup", () => {
      /* A tap on empty timeline deselects — the same gesture that means
         "nothing here" everywhere else in the app. */
      if (down && !moved) {
        S.sel = null;
        renderTimeline();
        renderInspector();
      }
      down = false;
    });
  })();

  /* A finger on the timeline while it plays pauses it, as CapCut does. The
     playing timeline re-centres on the playhead every frame, so without this
     a swipe was fought back on every frame and nothing could be reached until
     the video was paused by hand (owner, 2026-10-24). */
  $("tlScroll").addEventListener("pointerdown", () => { if (S.playing) pause(); }, { passive: true });
  $("tlScroll").addEventListener("touchstart", () => { if (S.playing) pause(); }, { passive: true });

  /* Scroll position IS the playhead position. One listener closes the loop, so
     a flick, a trackpad, a scrollbar and the drag above all scrub identically. */
  $("tlScroll").addEventListener("scroll", () => {
    if (scrollLock || S.playing) return;
    const t = clamp($("tlScroll").scrollLeft / S.pps, 0, total());
    if (Math.abs(t - S.time) < 0.0005) return;
    S.time = t;
    resetSfxCursor();
    syncMedia();
    syncOverlays();
    updateTransport();
    $("playhead").style.left = padL() + S.time * S.pps + "px";
  });

  $("zoomSlider").addEventListener("input", () => {
    S.pps = +$("zoomSlider").value;
    renderTimeline();
  });

  /* One way to zoom, for every gesture that zooms (the slider, a pinch, Ctrl
     or Cmd with the wheel or +/-): the playhead stays where it is and the
     timeline grows or shrinks around it, as in CapCut. */
  const PPS_MIN = 4, PPS_MAX = 160;
  function zoomTimeline(pps) {
    const next = clamp(pps, PPS_MIN, PPS_MAX);
    if (Math.abs(next - S.pps) < 0.01) return;
    S.pps = next;
    $("zoomSlider").value = String(Math.round(next));
    renderTimeline();   // ends in updatePlayheadUI, which re-centres on the playhead
  }

  /* ═══════════ TOUCH AND WHEEL, THE CAPCUT WAY (2026-10-22) ═══════════
     The owner: "when i move the timeline, it doesnt move up or down" in
     CapCut. Here a swipe on the timeline used to scroll the whole editor up
     and down as well, and a swipe that began on a clip moved the timeline by
     hand, stopping dead the moment the finger lifted. Now:
       · the timeline takes sideways swipes ONLY (touch-action: pan-x in
         styles.css), everywhere on it, clips included, and the browser's own
         scrolling carries it, momentum and all;
       · pressing and holding a clip still picks it up (holdToDrag): from
         that moment the finger belongs to the drag (touchLocked below stops
         the browser from scrolling as well);
       · two fingers pinch the timeline in and out;
       · with a mouse, the wheel scrolls the timeline sideways and Ctrl or Cmd
         with the wheel (or a trackpad pinch) zooms it. */
  let touchLocked = false, pinching = false;
  /* On the document, not the timeline: a touch keeps reporting to the
     element it started on even after a redraw has taken that element out of
     the page, and from there it no longer bubbles up to the timeline. That
     is how dragging a text stopped dead on phones until 0.31.1. */
  document.addEventListener("touchmove", (e) => {
    if (touchLocked || pinching) e.preventDefault();
  }, { passive: false, capture: true });

  (function pinchToZoom() {
    const sc = $("tlScroll");
    let d0 = 0, p0 = 0;
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    sc.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 2) return;
      pinching = true;
      d0 = dist(e.touches) || 1;
      p0 = S.pps;
      if (S.playing) pause();
    }, { passive: true });
    sc.addEventListener("touchmove", (e) => {
      if (!pinching || e.touches.length !== 2) return;
      zoomTimeline(p0 * (dist(e.touches) / d0));
    }, { passive: true });
    const end = (e) => { if (pinching && e.touches.length < 2) pinching = false; };
    sc.addEventListener("touchend", end);
    sc.addEventListener("touchcancel", end);
  })();

  /* Double-tap the timeline (double-click with a mouse) to put the zoom back
     to normal, the way CapCut does after a pinch went too far. Only clean
     taps count: a swipe or a hold never does. */
  const PPS_DEFAULT = 40;   // about CapCut's opening zoom: a time label every 2 seconds
  (function doubleTapToResetZoom() {
    const sc = $("tlScroll");
    let down = null, lastTap = null;
    sc.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || e.target.closest(".handle")) { down = null; return; }
      down = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
    });
    sc.addEventListener("pointercancel", () => { down = null; lastTap = null; });
    sc.addEventListener("pointerup", (e) => {
      if (!down || e.pointerId !== down.id || pinching) { down = null; return; }
      const still = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10 && e.timeStamp - down.t < 250;
      down = null;
      if (!still) { lastTap = null; return; }
      if (lastTap && e.timeStamp - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        lastTap = null;
        zoomTimeline(PPS_DEFAULT);
        return;
      }
      lastTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    });
    sc.addEventListener("dblclick", (e) => {
      if (e.target.closest(".handle")) return;
      e.preventDefault();
      zoomTimeline(PPS_DEFAULT);
    });
  })();

  $("tlScroll").addEventListener("wheel", (e) => {
    const sc = $("tlScroll");
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoomTimeline(S.pps * Math.exp(-e.deltaY * 0.0025));
      return;
    }
    // an ordinary wheel turn moves along the timeline, not up the page
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      if (S.playing) pause();
      sc.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    }
  }, { passive: false });

  /* While a clip is being dragged, holding it near either edge of the
     timeline scrolls the timeline that way, faster the closer it gets, so a
     clip can be carried anywhere (CapCut does the same). onScroll lets the
     drag keep the clip under the finger as the timeline moves. */
  function edgeScroller(onScroll) {
    const sc = $("tlScroll");
    let x = null, raf = 0;
    const tick = () => {
      raf = 0;
      if (x == null) return;
      const r = sc.getBoundingClientRect(), zone = 48;
      let v = 0;
      if (x < r.left + zone) v = -((r.left + zone - x) / zone) * 14;
      else if (x > r.right - zone) v = ((x - (r.right - zone)) / zone) * 14;
      if (!v) return;
      const before = sc.scrollLeft;
      sc.scrollLeft = before + v;
      if (sc.scrollLeft !== before) onScroll();
      raf = requestAnimationFrame(tick);
    };
    return {
      at(clientX) { x = clientX; if (!raf) raf = requestAnimationFrame(tick); },
      stop() { x = null; if (raf) cancelAnimationFrame(raf); raf = 0; }
    };
  }

  /* ═══════════ OVERLAY + AUDIO TRACKS ═══════════

     The main video track is MAGNETIC — clips butt up against each other and
     reordering shuffles them, because that is the sequence the exporter walks
     and what every downstream step (captions, b-roll anchoring, the Director's
     clip indices) assumes. CapCut's main track behaves the same way, so this
     is not a shortcut around free placement; it is the same design.

     Overlays and sounds are FREE. They carry an absolute `start` in TIMELINE
     time and can sit anywhere, including over nothing, which is what makes
     "put a photo here and a whoosh there" work at all. */

  const brollById = (id) => S.broll.find((b) => b.id === id) || null;
  const effectById = (id) => S.effects.find((e) => e.id === id) || null;
  const sfxById = (id) => S.sfx.find((s) => s.id === id) || null;
  const OVERLAY_DUR = 3;

  function sfxEngine() { return window.SenotelSFX || null; }
  function sfxAvailable() { const e = sfxEngine(); return !!(e && e.available()); }
  function sfxDur(name) {
    const e = sfxEngine();
    return e && e.has(name) ? e.duration(name) : 0.5;
  }

  /* Sound effects go through the SAME audio graph the exporter records from,
     so anything audible in the preview is in the exported file — that is the
     whole reason ensureAudioGraph() takes a destination.

     This only USES the graph; it never builds it. It runs inside the
     animation loop, where there is no user gesture, and a graph built there
     is born suspended and takes the video's own sound down with it (see
     primeAudio). Every path that puts a sound on the timeline builds the graph
     from a click first: adding a sound, pressing play, exporting, and for the
     Director's sounds the Edit click itself (warmAudio). Where there is no
     graph, sfx.js falls back to its own context: the sound still plays, it
     just does not reach a recording, and no export runs without the graph. */
  function sfxTarget() {
    if (!audioCtx || !audioDest) return {};
    /* Cheap, and it covers the context being suspended again later — phones
       suspend audio on a call, on a screen lock, and on a tab switch. */
    if (audioCtx.state === "suspended" && audioCtx.resume) {
      try { audioCtx.resume(); } catch (e) {}
    }
    // through the master bus, which already reaches the speakers and the file
    return { ctx: audioCtx, dest: masterBus, speaker: false };
  }

  /* THE ONE THING THAT MADE SOUNDS SILENT.

     An AudioContext created without user activation is born SUSPENDED, and it
     was being created inside the animation loop — which is never a gesture, no
     matter that a click started the playback that led to it. Nothing scheduled
     into a suspended context is heard.

     Worse than silent sound effects: ensureAudioGraph() also runs
     createMediaElementSource(pv), which permanently re-routes the preview's
     own audio through that context. Building it suspended therefore took the
     VIDEO's sound down with it, and that tap cannot be undone on an element.

     So the graph is built here, from a real click, and only once there is
     actually a sound to play — a project with no sound effects should never
     have its audio re-routed at all. */
  function primeAudio() {
    // a transition blends the two clips' sound through the graph too (ccl1, mixBlend)
    const blends = S.clips.some((c, i) => i > 0 && c.tIn && c.tIn !== "none" && c.tAudio !== false);
    if (!S.sfx.length && !S.music && !S.audio.length && !blends) return;
    try { ensureAudioGraph(); } catch (e) { return; }
    ensureMusicRoute();
    routeAudioVoices();
    if (audioCtx && audioCtx.state === "suspended" && audioCtx.resume) {
      try { audioCtx.resume(); } catch (e) {}
    }
  }

  /* The Director adds music and sound effects long after the Edit click, when
     no gesture is left to start Web Audio with. So the Edit click starts the
     context HERE, synchronously, before its first await, and taps nothing
     into it: if the edit comes back without sound, this project's audio is
     exactly as it was. */
  function warmAudio() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (audioGraphFailed || !C) return;
    if (!audioCtx) {
      try { audioCtx = new C(); } catch (e) { audioCtx = null; return; }
    }
    if (audioCtx.state === "suspended" && audioCtx.resume) {
      try { const p = audioCtx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    }
  }

  /* After a generate: route the Director's sounds into the graph before
     playback starts, using the context the Edit click started. Only a RUNNING
     one: tapping the video into a suspended context is the silent-video fault
     primeAudio() exists to prevent, so without one the route waits for the
     next click (play, space, the stage) to build it. */
  function routeDirectorAudio() {
    if (!audioCtx) return;
    if (!S.sfx.length && !S.music && !S.audio.length) {
      /* The edit came back without sound, so nothing needs the context the
         click started: let it sleep rather than leave an audio thread running
         on a phone. Only while nothing is routed through it; once the video
         is, suspending would silence it. The next click that needs sound
         wakes it (primeAudio, addSfxAt and the export all resume). */
      if (!audioDest && audioCtx.state === "running" && audioCtx.suspend) {
        try { const p = audioCtx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
      }
      return;
    }
    if (audioCtx.state !== "running") return;
    try { ensureAudioGraph(); } catch (e) { return; }
    ensureMusicRoute();
    routeAudioVoices();
  }

  function addOverlayAt(m, at) {
    if (!m) return null;
    const b = {
      id: nextId++,
      mediaId: m.id,
      start: clamp(at == null ? S.time : at, 0, Math.max(0, total() - 0.2)),
      dur: m.type === "image" ? OVERLAY_DUR : Math.min(m.duration || OVERLAY_DUR, 5),
      mode: "inset"
    };
    S.broll.push(b);
    S.sel = { type: "broll", id: b.id };
    commit();
    renderTimeline();
    renderInspector();
    syncNow();
    toast(m.name + " added as an overlay. Drag it anywhere");
    return b;
  }

  function addSfxAt(name, at) {
    const e = sfxEngine();
    if (!e || !e.has(name)) return null;
    /* Deliberately before the push: primeAudio() is a no-op while S.sfx is
       empty, so it has to run on the click that creates the first sound. */
    try { ensureAudioGraph(); } catch (err) {}
    if (audioCtx && audioCtx.state === "suspended" && audioCtx.resume) {
      try { audioCtx.resume(); } catch (err) {}
    }
    const s = {
      id: nextId++,
      name: name,
      start: clamp(at == null ? S.time : at, 0, Math.max(0, total())),
      gain: 1
    };
    S.sfx.push(s);
    S.sel = { type: "sfx", id: s.id };
    commit();
    renderTimeline();
    renderInspector();
    return s;
  }

  /* Preview from the soundboard plays on the shared context, NOT through
     sfxTarget() — auditioning a sound should never be capable of ending up in
     an export that happens to be running. A recording still on its way is
     waited for (a second, usually) rather than standing in with nothing. */
  function previewSfx(name) {
    const e = sfxEngine();
    if (!e) return;
    if (e.source && e.source(name) !== "recording" && e.prepare) {
      e.unlock();   // inside the tap, so the context may start
      e.prepare([name]).then(() => e.play(name));
      return;
    }
    e.play(name);
  }

  function renderSoundSheet() {
    const grid = $("sndGrid");
    if (!grid) return;
    grid.innerHTML = "";
    const e = sfxEngine();
    const ok = sfxAvailable();
    $("sndEmpty").classList.toggle("hidden", ok);
    $("sndWhere").textContent = "at " + fmt(S.time);
    if (!ok || !e) return;

    /* Name first, then tags: a sound is easier to find by what it is FOR than
       by what it is called, and the registry already carries those words. */
    const q = (($("sndSearch") && $("sndSearch").value) || "").trim().toLowerCase();
    const all = e.list();
    const shown = !q ? all : all.filter(function (s) {
      if (s.label.toLowerCase().indexOf(q) >= 0) return true;
      return s.tags.some(function (t) { return t.toLowerCase().indexOf(q) >= 0; });
    });
    const none = $("sndNone");
    if (none) {
      none.textContent = 'No sound matches "' + q + '"';
      none.classList.toggle("hidden", !!shown.length || !q);
    }

    /* A name, a listen, an add. Nothing else — a sound library is a list you
       scan, and prose about what a whoosh is for is prose nobody reads twice.
       The length stays because it is the one fact that changes what you do
       with it on a timeline. */
    shown.forEach((s) => {
      const row = mk("div", "snd-row");
      row.appendChild(mk("span", "snd-name", s.label));
      row.appendChild(mk("span", "snd-dur", s.duration.toFixed(1) + "s"));

      const hear = mk("button", "snd-hear", "");
      hear.title = "Preview";
      hear.setAttribute("aria-label", "Preview " + s.label);
      hear.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
      hear.addEventListener("click", () => {
        previewSfx(s.name);
        row.classList.add("lit");
        setTimeout(() => row.classList.remove("lit"), Math.max(220, s.duration * 1000));
      });

      const add = mk("button", "snd-add", "Add");
      add.addEventListener("click", () => {
        addSfxAt(s.name);
        closeSheets();
        toast(s.label + " added at " + fmt(S.time));
      });

      row.appendChild(hear);
      row.appendChild(add);
      grid.appendChild(row);
    });
  }

  /* ── free placement: drag along the timeline ──────────────────────────────
     Overlays and sounds move in TIME rather than in order, so the gesture is a
     straight pixel→seconds conversion.

     It snaps to the playhead and to every clip boundary, on EITHER edge of the
     thing being dragged — landing a whoosh on a cut is the single most common
     thing anyone does with a sound, and doing it by eye at 24px per second is
     not reasonable. The tolerance is defined in pixels and converted, so it
     tightens automatically as you zoom in: 8px of slack is forgiving at a
     glance and precise under magnification, which one fixed number in seconds
     could never be at both ends of the zoom range.

     Nothing here calls renderTimeline(). Rebuilding every clip, thumbnail and
     handle on each pointermove is what makes a timeline feel like it is
     dragging its feet; moving the one element under the finger and settling up
     once on release is what makes it feel like CapCut. */

  /* What an edge can land on: the playhead, every cut, and both ends of
     every text, overlay and sound, except the thing being moved. */
  function snapMarks(except) {
    const marks = [S.time, 0];
    let acc = 0;
    S.clips.forEach((c) => { acc += dispDur(c); marks.push(acc); });
    const span = (list, len) => list.forEach((x) => { if (x !== except) { marks.push(x.start, x.start + len(x)); } });
    span(S.texts, (t) => t.dur);
    span(S.broll, (b) => b.dur);
    span(S.audio, (a) => audioDur(a));
    span(S.sfx, (x) => sfxDur(x.name));
    span(S.effects, (e) => e.dur);
    if (S.music && S.music !== except) { const m = musicSpan(); marks.push(m.from, m.to); }
    // ccl5: things snap onto the beat marks too
    if (S.music !== except) musicBeatTimes().forEach((b) => marks.push(b.t));
    return marks;
  }

  /* The snap line. When an edge lands on a mark, a thin line shows where,
     and a phone gives one short buzz on landing (not on every move), as in
     CapCut. lastSnap is the mark the latest snap landed on, or null. */
  let lastSnap = null, shownSnap = null;
  function showSnap() {
    const line = $("snapLine");
    if (lastSnap == null) { line.classList.add("hidden"); shownSnap = null; return; }
    if (shownSnap == null || Math.abs(shownSnap - lastSnap) > 1e-6) {
      buzz("light");
    }
    shownSnap = lastSnap;
    line.style.left = padL() + lastSnap * S.pps + "px";
    line.classList.remove("hidden");
  }
  function hideSnap() { lastSnap = null; showSnap(); }

  /* Returns the start time to use, having tried to land either edge on a mark. */
  function snapSpan(start, span, except) {
    const tol = 8 / S.pps;
    let best = start, bestD = tol;
    lastSnap = null;
    snapMarks(except).forEach((m) => {
      const dStart = Math.abs(m - start);
      if (dStart < bestD) { bestD = dStart; best = m; lastSnap = m; }
      const dEnd = Math.abs(m - (start + span));
      if (dEnd < bestD) { bestD = dEnd; best = m - span; lastSnap = m; }
    });
    showSnap();
    return best;
  }
  // One edge on its own (a trim): the time to use for it
  function snapPoint(t, except, skip, marks) {
    const tol = 8 / S.pps;
    let best = t, bestD = tol;
    lastSnap = null;
    (marks || snapMarks(except)).forEach((m) => {
      if (skip != null && Math.abs(m - skip) < 1e-6) return;
      const d = Math.abs(m - t);
      if (d < bestD) { bestD = d; best = m; lastSnap = m; }
    });
    showSnap();
    return best;
  }

  function startFreeDrag(e, item, kind, el) {
    e.preventDefault();
    e.stopPropagation();
    const already = S.sel && S.sel.type === kind && (kind === "music" || S.sel.id === item.id);
    S.sel = kind === "music" ? { type: "music" } : { type: kind, id: item.id };
    if (!already) {
      /* Selecting used to redraw the whole timeline, which DESTROYED the
         element this drag is holding — every later move then set `left` on a
         node no longer in the document, so nothing appeared to move. Picking
         up an unselected clip is how a drag normally starts, so that was the
         normal case, not an edge one.

         A sound has no trim handles, so its selection is purely a class and
         needs no redraw at all — the element under the finger survives
         untouched, which is also the smoothest thing that can happen. An
         overlay does grow handles when selected, so it must redraw, and then
         take hold of the replacement. */
      const track = kind === "broll" ? $("overlayTrack") : kind === "uaudio" ? $("uaudioTrack") : kind === "music" ? $("musicTrack") : kind === "effect" ? $("effectTrack") : $("audioTrack");
      // overlays, audio clips, effects and the music grow trim handles when selected, so they redraw
      if (kind === "broll" || kind === "uaudio" || kind === "music" || kind === "effect") {
        renderTimeline();
        el = (kind === "music" ? track.querySelector(".mclip") : track.querySelector('[data-id="' + item.id + '"]')) || el;
      } else {
        track.querySelectorAll(".sel").forEach((n) => n.classList.remove("sel"));
        if (el) el.classList.add("sel");
        /* The other tracks still hold the old highlight. */
        [$("videoTrack"), $("textTrack"), $("overlayTrack")].forEach((t) => {
          t.querySelectorAll(".sel").forEach((n) => n.classList.remove("sel"));
        });
      }
      renderInspector();
    }
    /* Route the rest of the gesture to this element even if the finger leaves
       it — without capture a touch drag stops the moment it crosses out of a
       26px-wide clip, which at a normal zoom is immediately. */
    try { if (el && el.setPointerCapture && e.pointerId != null) el.setPointerCapture(e.pointerId); } catch (err) {}

    const startX = e.clientX;
    const startAt = kind === "music" ? musicSpan().from : item.start;
    const span = kind === "broll" || kind === "effect" ? item.dur : kind === "uaudio" ? audioDur(item) : kind === "music" ? musicSpan().to - musicSpan().from : sfxDur(item.name);
    const limit = Math.max(0, total() - 0.05);
    let moved = false;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const raw = clamp(startAt + dx / S.pps, 0, limit);
      item.start = clamp(snapSpan(raw, span, item), 0, limit);
      if (kind === "music") { item.end = item.start + span; syncMusic(); }   // moves as one piece
      if (el) el.style.left = item.start * S.pps + "px";
      syncOverlays();
      if (kind === "uaudio") syncAudioClips();   // its row is settled on release
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      hideSnap();
      if (moved) {
        commit();
        renderTimeline();
        renderInspector();
      } else if (kind === "sfx") {
        /* Tapping a sound plays it. There is no other way to find out what a
           sound on the timeline actually is without moving the playhead onto
           it and pressing play. */
        previewSfx(item.name);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* Overlays trim from either edge. A sound does not: it is a fixed shape of a
     fixed length, and a half-played whoosh is a mistake, not an edit. */
  function startOverlayTrim(e, b, side, el) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const at0 = b.start, dur0 = b.dur;
    const MIN = 0.3;

    const move = (ev) => {
      const d = (ev.clientX - startX) / S.pps;
      if (side === "l") {
        const at = clamp(snapPoint(at0 + d, b), 0, at0 + dur0 - MIN);
        b.start = at;
        b.dur = dur0 + (at0 - at);
      } else {
        b.dur = Math.max(MIN, snapPoint(at0 + dur0 + d, b) - at0);
      }
      if (el) {
        el.style.left = b.start * S.pps + "px";
        el.style.width = Math.max(b.dur * S.pps, 26) + "px";
      }
      syncOverlays();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      hideSnap();
      commit();
      renderTimeline();
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function renderOverlayTrack(ot) {
    S.broll.forEach((b) => {
      const m = mediaById(b.mediaId);
      const on = S.sel && S.sel.type === "broll" && S.sel.id === b.id;
      const el = mk("div", "oclip" + (on ? " sel" : ""));
      el.dataset.id = String(b.id);
      el.style.left = b.start * S.pps + "px";
      el.style.width = Math.max(b.dur * S.pps, 26) + "px";
      if (m && m.thumb) {
        const img = document.createElement("img");
        img.src = m.thumb;
        el.appendChild(img);
      }
      el.appendChild(mk("span", "oname", (m ? m.name : "overlay")));
      if (on) {
        const hl = mk("div", "handle hl"), hr = mk("div", "handle hr");
        el.appendChild(hl);
        el.appendChild(hr);
        hl.addEventListener("pointerdown", (ev) => startOverlayTrim(ev, b, "l", el));
        hr.addEventListener("pointerdown", (ev) => startOverlayTrim(ev, b, "r", el));
      }
      el.addEventListener("pointerdown", (ev) => {
        if (ev.target.classList.contains("handle")) return;
        holdToDrag(ev, (x) => startFreeDrag(x, b, "broll", el));
      });
      ot.appendChild(el);
    });
  }

  /* The music is a clip like any other (0.30.1): it starts under the whole
     edit, and can be held and moved, or trimmed from either end (the song
     keeps its place under a left trim, as in CapCut). Tap to set its level. */
  function renderMusicTrack(mt) {
    if (!S.music) return;
    const on = S.sel && S.sel.type === "music";
    const sp = musicSpan();
    const el = mk("div", "mclip" + (on ? " sel" : ""));
    el.style.left = sp.from * S.pps + "px";
    el.style.width = Math.max((sp.to - sp.from) * S.pps, 40) + "px";
    const name = mk("span", "mname", "");
    name.textContent = S.music.title;
    el.appendChild(name);
    // the song's real shape under its name, looped as it plays
    const pk = S.music.url ? peaksOf("u" + S.music.url, S.music.url, 0) : null;
    if (pk) {
      const len = pk.length / PEAKS_PER_SEC, w = (sp.to - sp.from) * S.pps;
      const strip = mk("div", "mwave");
      for (let at = 0; at < sp.to - sp.from; ) {
        const from = (sp.at + at) % len, take = Math.min(len - from, sp.to - sp.from - at);
        strip.appendChild(waveCanvas(pk, from, from + take, take * S.pps, 18, "rgba(220,20,60,0.55)"));
        at += take;
        if (take <= 0.01) break;
      }
      el.appendChild(strip);
    }
    // ccl5: the beat marks, a dot per beat, bigger on the strong ones and on the user's own
    const bt = musicBeatTimes();
    if (bt.length) {
      const dots = mk("div", "mbeats");
      bt.forEach((b) => {
        const d = mk("i", b.mine ? "mine" : b.strong ? "strong" : "");
        d.style.left = (b.t - sp.from) * S.pps + "px";
        dots.appendChild(d);
      });
      el.appendChild(dots);
    }
    if (on) {
      const hl = mk("div", "handle hl"), hr = mk("div", "handle hr");
      el.appendChild(hl);
      el.appendChild(hr);
      hl.addEventListener("pointerdown", (ev) => startMusicTrim(ev, "l", el));
      hr.addEventListener("pointerdown", (ev) => startMusicTrim(ev, "r", el));
    }
    el.addEventListener("pointerdown", (ev) => {
      if (ev.target.classList.contains("handle")) return;
      ev.stopPropagation();
      holdToDrag(ev, (x) => startFreeDrag(x, S.music, "music", el));
    });
    mt.appendChild(el);
  }

  function startMusicTrim(e, side, el) {
    e.preventDefault();
    e.stopPropagation();
    const m = S.music, sp0 = musicSpan(), x0 = e.clientX;
    const move = (ev) => {
      const d = (ev.clientX - x0) / S.pps;
      if (side === "l") {
        // no earlier than the song's own start
        const from = clamp(snapPoint(sp0.from + d, m), Math.max(0, sp0.from - sp0.at), sp0.to - 0.5);
        m.start = from;
        m.in = Math.max(0, sp0.at + (from - sp0.from));
        if (m.end == null) m.end = sp0.to;
      } else {
        m.end = clamp(snapPoint(sp0.to + d, m), sp0.from + 0.5, total());
      }
      const s = musicSpan();
      el.style.left = s.from * S.pps + "px";
      el.style.width = Math.max((s.to - s.from) * S.pps, 40) + "px";
      syncMusic();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      hideSnap();
      commit();
      renderTimeline();
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function renderAudioTrack(at) {
    S.sfx.forEach((s) => {
      const on = S.sel && S.sel.type === "sfx" && S.sel.id === s.id;
      const el = mk("div", "aclip" + (on ? " sel" : ""));
      el.dataset.id = String(s.id);
      el.style.left = s.start * S.pps + "px";
      el.style.width = Math.max(sfxDur(s.name) * S.pps, 22) + "px";
      const e = sfxEngine();
      const info = e ? e.info(s.name) : null;
      el.appendChild(mk("span", "aname", info ? info.label : s.name));
      /* A crude waveform: enough to read as audio at a glance without
         pretending to be an analysis of a sound that does not exist yet. */
      const wav = mk("div", "awave");
      for (let i = 0; i < 14; i++) {
        const bar = mk("i");
        bar.style.height = (22 + ((i * 37) % 60)) + "%";
        wav.appendChild(bar);
      }
      el.appendChild(wav);
      el.addEventListener("pointerdown", (ev) => holdToDrag(ev, (x) => startFreeDrag(x, s, "sfx", el)));
      at.appendChild(el);
    });
  }

  /* ═══════════ AUDIO CLIPS ═══════════
     Imported audio files, and the sound of a video pulled onto its own track
     (Extract audio, as in CapCut). Each clip is a window of its SOURCE, like a
     video clip (in/out in source seconds), placed freely in timeline time like
     an overlay. A video's sound plays straight from the video file: an audio
     element plays the sound track of a video happily, so extracting copies
     nothing and costs nothing. */

  const audioById = (id) => S.audio.find((a) => a.id === id) || null;
  const audioDur = (a) => (a.out - a.in) / (a.speed || 1);

  /* Sounds that play at the same time sit on separate rows, as CapCut's audio
     tracks do; the lane grows a row for each layer and shrinks back. Each clip
     takes the first row that is free where it starts. */
  const AUDIO_ROW = 30;
  function audioRows() {
    const rows = [], at = new Map();
    S.audio.slice().sort((x, y) => x.start - y.start || x.id - y.id).forEach((a) => {
      let r = rows.findIndex((end) => end <= a.start + 0.001);
      if (r < 0) { r = rows.length; rows.push(0); }
      rows[r] = a.start + audioDur(a);
      at.set(a.id, r);
    });
    return { count: Math.max(1, rows.length), at: at };
  }

  function renderUserAudioTrack(ut) {
    const layout = audioRows();
    ut.style.height = layout.count * AUDIO_ROW + "px";
    S.audio.forEach((a) => {
      const on = S.sel && S.sel.type === "uaudio" && S.sel.id === a.id;
      const el = mk("div", "uclip" + (on ? " sel" : ""));
      el.dataset.id = String(a.id);
      el.style.left = a.start * S.pps + "px";
      el.style.top = (layout.at.get(a.id) || 0) * AUDIO_ROW + 1 + "px";
      el.style.width = Math.max(audioDur(a) * S.pps, 26) + "px";
      const nm = mk("span", "uname");
      nm.textContent = a.name || "Audio";
      el.appendChild(nm);
      /* The sound's real shape (peaksOf: decoded once, kept in memory);
         plain bars until it has been read, or for a file too big to read. */
      const m = mediaById(a.mediaId);
      const p = m ? peaksOf("m" + m.id, m.url, m.file && m.file.size) : null;
      if (p) el.appendChild(waveCanvas(p, a.in, a.out, audioDur(a) * S.pps, AUDIO_ROW - 12, "rgba(43,127,184,0.85)"));
      else {
        const wav = mk("div", "awave");
        for (let i = 0; i < 40; i++) {
          const bar = mk("i");
          bar.style.height = (25 + (((i + a.id) * 37) % 65)) + "%";
          wav.appendChild(bar);
        }
        el.appendChild(wav);
      }
      if (on) {
        const hl = mk("div", "handle hl"), hr = mk("div", "handle hr");
        el.appendChild(hl);
        el.appendChild(hr);
        hl.addEventListener("pointerdown", (ev) => startAudioTrim(ev, a, "l", el));
        hr.addEventListener("pointerdown", (ev) => startAudioTrim(ev, a, "r", el));
      }
      el.addEventListener("pointerdown", (ev) => {
        if (ev.target.classList.contains("handle")) return;
        holdToDrag(ev, (x) => startFreeDrag(x, a, "uaudio", el));
      });
      ut.appendChild(el);
    });
  }

  /* Trimming moves the window over the source, never the sound inside it: the
     left edge takes the start and the in-point together, so what you hear at
     any moment stays where it was. Nothing past either end of the file. */
  function startAudioTrim(e, a, side, el) {
    e.preventDefault();
    e.stopPropagation();
    const m = mediaById(a.mediaId);
    const sp = a.speed || 1;
    const in0 = a.in, out0 = a.out, start0 = a.start;
    const maxOut = m && m.duration ? m.duration : out0;
    const MIN = 0.2;
    const startX = e.clientX;
    const move = (ev) => {
      let d = (ev.clientX - startX) / S.pps;
      // the moving edge lands on cuts, the playhead and other items' edges
      const edge0 = side === "l" ? start0 : start0 + (out0 - in0) / sp;
      d = snapPoint(edge0 + d, a) - edge0;
      if (side === "l") {
        d = clamp(d, Math.max(-start0, -in0 / sp), (out0 - in0) / sp - MIN);
        a.in = in0 + d * sp;
        a.start = start0 + d;
      } else {
        d = clamp(d, -((out0 - in0) / sp - MIN), (maxOut - out0) / sp);
        a.out = out0 + d * sp;
      }
      if (el) {
        el.style.left = a.start * S.pps + "px";
        el.style.width = Math.max(audioDur(a) * S.pps, 26) + "px";
      }
      syncAudioClips();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      hideSnap();
      commit();
      renderTimeline();
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /* Puts a media item's sound on the audio track. opts: at (timeline time,
     default the playhead), in/out (source window, default all of it), and the
     level, fades and speed when it is taking over from a video clip. */
  function addAudioClip(m, opts) {
    opts = opts || {};
    if (!m) return null;
    if (!S.clips.length) {
      toast("“" + m.name + "” is in your library. Put a video or photo on the timeline first, then add its sound", 5000);
      return null;
    }
    const len = m.duration || 0;
    if (!(len > 0)) { toast("Couldn't read how long “" + m.name + "” is. It may not have any sound"); return null; }
    const a = {
      id: nextId++,
      mediaId: m.id,
      start: clamp(opts.at == null ? S.time : opts.at, 0, Math.max(0, total() - 0.1)),
      in: clamp(opts.in || 0, 0, len),
      out: clamp(opts.out == null ? len : opts.out, 0, len),
      speed: opts.speed || 1,
      gain: opts.gain == null ? 1 : opts.gain,
      fadeIn: opts.fadeIn || 0,
      fadeOut: opts.fadeOut || 0,
      name: opts.name || m.name
    };
    if (a.out - a.in < 0.1) return null;
    S.audio.push(a);
    S.sel = { type: "uaudio", id: a.id };
    commit();
    renderTimeline();
    renderInspector();
    syncNow();
    if (!opts.quiet) toast("“" + a.name + "” added to the audio track at " + fmt(a.start) + ". Drag it anywhere");
    return a;
  }

  /* Extract audio: the clip's sound moves onto the audio track, lined up under
     the clip, and the clip goes quiet so it is not heard twice. From then on
     the two are separate, as in CapCut: trim, move, fade or replace either. */
  function extractClipAudio(c) {
    const m = mediaById(c.mediaId);
    if (!m || m.type !== "video") return null;
    const idx = S.clips.indexOf(c);
    let at = 0;
    for (let i = 0; i < idx; i++) at += dispDur(S.clips[i]);
    primeAudioForClick();
    /* Muted BEFORE the sound is added, so both land in the one history step
       addAudioClip commits: one undo puts the clip back exactly as it was. */
    const wasMuted = c.muted;
    const level = wasMuted ? 1 : (typeof c.volume === "number" ? c.volume : 1);
    c.muted = true;
    const a = addAudioClip(m, {
      at: at, in: c.in, out: c.out, speed: c.speed || 1, gain: level,
      fadeIn: c.fadeIn || 0, fadeOut: c.fadeOut || 0, quiet: true
    });
    if (!a) { c.muted = wasMuted; return null; }
    m.soundSaved = true;   // kept in Your audio from now on
    recordEdit("extract-audio", { mediaId: m.id, in: c.in, out: c.out });
    renderTimeline();
    renderInspector();
    saveSession();
    toast("Audio extracted to its own track and saved to Your audio. The clip is muted so you don't hear it twice");
    return a;
  }

  /* From a click only. The audio graph has to be built during a gesture or it
     is born suspended and silences the video's own sound (see primeAudio).
     Building it now means the new sound reaches an export too. */
  function primeAudioForClick() {
    try { ensureAudioGraph(); } catch (e) { return; }
    if (audioCtx && audioCtx.state === "suspended" && audioCtx.resume) {
      try { audioCtx.resume(); } catch (e) {}
    }
    ensureMusicRoute();
    routeAudioVoices();
  }

  /* One audio element per clip, created on first need. Once the audio graph
     exists each element is tapped into it, through its own gain, exactly the
     way the music bed is, so it is heard in the preview AND recorded in the
     export. An element can be tapped only once, so it lives as long as its
     clip does. */
  const voices = new Map();   // clip id → {el, gain, failed}

  function voiceFor(a) {
    let v = voices.get(a.id);
    const m = mediaById(a.mediaId);
    if (!m) return null;
    if (v && v.url !== m.url) { dropVoice(a.id); v = null; }   // the file came back with a new address
    if (!v) {
      const el = new Audio();
      el.preload = "auto";
      el.src = m.url;
      el.preservesPitch = true;   // a sped-up clip keeps the voice's pitch, as the video does
      // a video's own sound is speech: it goes through the bleep's speech stage
      v = { el: el, gain: null, failed: false, url: m.url, speech: !!(m.fromVideo || m.type === "video") };
      voices.set(a.id, v);
    }
    if (!v.gain && !v.failed) routeVoice(v);
    return v;
  }

  function routeVoice(v) {
    if (v.gain || v.failed || !audioCtx || !audioDest) return;
    try {
      const src = audioCtx.createMediaElementSource(v.el);
      const g = audioCtx.createGain();
      src.connect(g);
      if (v.speech && speechGain) g.connect(speechGain);   // bleeped with the footage
      else g.connect(masterBus);           // speakers and the exported file
      v.gain = g;
    } catch (e) {
      v.failed = true;
      if (window.SenotelDiag) window.SenotelDiag.last.audioClips = "not routed into the export: " + ((e && e.message) || e);
    }
  }

  function routeAudioVoices() {
    S.audio.forEach((a) => { const v = voiceFor(a); if (v) routeVoice(v); });
  }

  function dropVoice(id) {
    const v = voices.get(id);
    if (!v) return;
    try { v.el.pause(); v.el.removeAttribute("src"); v.el.load(); } catch (e) {}
    if (v.gain) { try { v.gain.disconnect(); } catch (e) {} }
    voices.delete(id);
  }

  // The clip's level at timeline time t, with its fades.
  function audioLevel(a, t) {
    const d = audioDur(a), pos = t - a.start;
    let k = typeof a.gain === "number" ? a.gain : 1;
    if (a.fadeIn > 0 && pos < a.fadeIn) k *= clamp(pos / a.fadeIn, 0, 1);
    if (a.fadeOut > 0 && pos > d - a.fadeOut) k *= clamp((d - pos) / a.fadeOut, 0, 1);
    return k;
  }

  /* Kept locked to the playhead the way the music bed is: sampled every
     frame, corrected only on a real drift, because seeking an element every
     frame makes it stutter. Silent outside its own span and past the end of
     the edit. */
  function syncAudioClips() {
    if (!S.audio.length && !voices.size) return;
    const end = total();
    const live = new Set();
    S.audio.forEach((a) => {
      live.add(a.id);
      const v = voiceFor(a);
      if (!v) return;
      const sp = a.speed || 1;
      const inside = S.time >= a.start && S.time < Math.min(a.start + audioDur(a), end);
      const silent = S.userMuted && !EXP.active;
      const level = inside && !silent ? audioLevel(a, S.time) : 0;
      if (v.gain) { v.el.volume = 1; v.gain.gain.value = clamp(level, 0, 2); }
      else v.el.volume = clamp(level, 0, 1);
      if (v.el.playbackRate !== sp) v.el.playbackRate = sp;
      const want = a.in + (S.time - a.start) * sp;
      if (S.playing && inside) {
        if (!v.el.seeking && Math.abs(v.el.currentTime - want) > 0.25) { try { v.el.currentTime = want; } catch (e) {} }
        if (v.el.paused) v.el.play().catch(() => {});
      } else {
        if (!v.el.paused) v.el.pause();
        if (inside && !v.el.seeking && Math.abs(v.el.currentTime - want) > 0.05) { try { v.el.currentTime = want; } catch (e) {} }
      }
    });
    // clips deleted or undone away take their element with them
    voices.forEach((v, id) => { if (!live.has(id)) dropVoice(id); });
  }

  function pauseAudioClips() {
    voices.forEach((v) => { try { if (!v.el.paused) v.el.pause(); } catch (e) {} });
  }

  /* ── firing sounds during playback and export ────────────────────────────
     One cursor walking forward with the playhead. Anything whose start is
     crossed between the last frame and this one fires exactly once, which is
     the only way to be sure a sound neither doubles on a slow frame nor is
     skipped on a fast one. Seeking moves the cursor without firing, so
     scrubbing backwards over a sound does not replay it. */
  let sfxCursor = 0;
  /* A hair BEHIND the playhead, not on it. The test is `start > from`, so a
     sound sitting exactly where playback begins — start 0.0 on a press of
     play, the single most likely thing anyone tries first — was skipped. */
  function resetSfxCursor() { sfxCursor = S.time - 0.0001; }

  function fireSfxUpTo(t) {
    if (!S.sfx.length) return;
    const e = sfxEngine();
    if (!e) return;
    const from = sfxCursor;
    sfxCursor = t;
    if (t <= from) return;
    /* The preview's mute silences sound effects too; it used to reach only
       the video and the music. The cursor above still moves, so unmuting
       mid-play does not dump every sound that was skipped. An export always
       has them (startExport unmutes), and EXP.active guards that regardless. */
    if (S.userMuted && !EXP.active) return;
    const opts = sfxTarget();
    S.sfx.forEach((s) => {
      if (s.start > from && s.start <= t) {
        e.play(s.name, {
          ctx: opts.ctx, dest: opts.dest, speaker: opts.speaker,
          gain: typeof s.gain === "number" ? s.gain : 1
        });
      }
    });
  }

  function stopSfx() {
    const e = sfxEngine();
    if (e) e.stopAll();
  }

  /* ═══════════ INSPECTOR ═══════════ */

  function mk(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  function group(labelText, child, min) {
    const g = mk("div", "ins-group");
    if (min) g.dataset.min = String(min);
    g.appendChild(mk("label", null, labelText));
    g.appendChild(child);
    return g;
  }

  function slider(min, max, step, val, oninput, onchange, fmtOut) {
    const wrap = mk("span", "ins-group");
    const r = document.createElement("input");
    r.type = "range"; r.min = min; r.max = max; r.step = step; r.value = val;
    const o = mk("output", null, fmtOut(val));
    r.addEventListener("input", () => { oninput(+r.value); o.textContent = fmtOut(+r.value); });
    r.addEventListener("change", () => onchange && onchange(+r.value));
    wrap.appendChild(r);
    wrap.appendChild(o);
    return wrap;
  }

  /* The Filters panel (ccl4, 0.35.0), CapCut's: group tabs, a tile per
     filter showing the user's own clip in that look, and Strength. */
  let filterCat = null;   // the group tab showing; null = the current filter's own group
  function filterPanel(box, getCur, apply, getAmt, setAmt, thumbClip) {
    const FL = window.SenotelFilters;
    if (!FL) { box.appendChild(filterChips(getCur, apply)); return; }
    const cur = getCur() || "none";
    const curF = FL.LIST.find((f) => f.id === cur);
    const cat = filterCat || (curF && curF.group) || FL.GROUPS[0];
    const cats = mk("div", "filter-chips");
    FL.GROUPS.forEach((g) => {
      const b = mk("button", "fchip" + (cat === g ? " active" : ""), g);
      b.type = "button";
      b.addEventListener("click", () => { filterCat = g; renderInspector(); });
      cats.appendChild(b);
    });
    box.appendChild(cats);
    const grid = mk("div", "anim-grid filter-grid");
    [FL.LIST[0]].concat(FL.LIST.filter((f) => f.group === cat)).forEach((f) => {
      const b = mk("button", "anim-tile" + (cur === f.id ? " selected" : ""));
      b.type = "button";
      b.title = f.name;
      const cv = document.createElement("canvas");
      cv.dataset.filter = f.id;
      b.appendChild(cv);
      b.appendChild(mk("span", "anim-name", f.name));
      b.addEventListener("click", () => { apply(f.id); commit(); syncOverlays(); renderInspector(); recordEdit("filter", { id: f.id }); });
      grid.appendChild(b);
    });
    box.appendChild(grid);
    if (cur !== "none") {
      box.appendChild(group("Strength", slider(0, 1, 0.01, getAmt(), (v) => { setAmt(v); syncOverlays(); }, () => commit(), pct)));
    }
    requestAnimationFrame(() => drawFilterTiles(box, thumbClip));
  }
  /* Each tile: the clip's still in that filter (the same colour table the
     picture uses). A still that isn't decoded yet is waited for, a few times,
     instead of leaving flat tiles. */
  function drawFilterTiles(box, clip, tries) {
    const FL = window.SenotelFilters;
    const still = clip ? clipThumb(clip) : null;
    const ready = still && still.complete !== false && still.naturalWidth;
    if (clip && !ready && (tries || 0) < 12 && box.isConnected) {
      setTimeout(() => drawFilterTiles(box, clip, (tries || 0) + 1), 250);
    }
    box.querySelectorAll("canvas[data-filter]").forEach((cv) => {
      const w = Math.max(40, cv.clientWidth || 72), h = Math.max(40, cv.clientHeight || 72);
      cv.width = Math.round(w * 2); cv.height = Math.round(h * 2);
      const ctx = cv.getContext("2d");
      coverInto(ctx, still, cv.width, cv.height, "#6a5a48");
      const id = cv.dataset.filter;
      if (id === "none") return;
      const out = FL.apply(cv, id, 1);
      if (out) {
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(out, 0, 0, cv.width, cv.height);
        ctx.globalCompositeOperation = "source-over";
      } else {
        const tmp = document.createElement("canvas");
        tmp.width = cv.width; tmp.height = cv.height;
        tmp.getContext("2d").drawImage(cv, 0, 0);
        ctx.filter = FL.cssOf(id);
        ctx.drawImage(tmp, 0, 0);
        ctx.filter = "none";
      }
    });
  }

  function filterChips(getCur, apply) {
    const wrap = mk("div", "filter-chips");
    Object.keys(FILTERS).forEach((key) => {
      const b = mk("button", "fchip" + (getCur() === key ? " active" : ""), FILTERS[key].label);
      b.addEventListener("click", () => {
        apply(key);
        commit();
        wrap.querySelectorAll(".fchip").forEach((c) => c.classList.remove("active"));
        b.classList.add("active");
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* ═══════════ TOOLS: CapCut's bottom bar and its panels ═══════════
     One row of tools at the bottom of the screen, where a thumb reaches
     (most phone use is one-handed, thumb on the lower screen), three levels
     deep at most, exactly as CapCut does it:
       nothing selected   the main tools (Edit, Audio, Text, Stickers...)
       a group open       that group's tools (Audio: Music, Sound effects...)
       something selected that thing's tools (a clip: Split, Speed, Volume...)
     A tool either acts at once (Split, Delete) or slides up ONE panel with
     only its own controls and a check mark to close it. Never a wall of
     settings. Every target is at least 48px. */
  let activeTool = null, toolGroup = null, lastSelKey = "", pendingTool = null;
  const selKey = () => (S.sel ? S.sel.type + ":" + (S.sel.id != null ? S.sel.id : "") : "");

  const I = (d, extra) => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"' + (extra || "") + ">" + d + "</svg>";
  const ICON = {
    back: I('<polyline points="15 18 9 12 15 6"/>'),
    check: I('<polyline points="20 6 9 17 4 12"/>', ' stroke-width="2.2"'),
    // ccl5 beats: a waveform with dots on its beats
    beats: I('<path d="M3 12h2l2-5 3 10 3-14 3 12 2-3h3"/><circle cx="7" cy="20" r="1"/><circle cx="13" cy="20" r="1"/><circle cx="19" cy="20" r="1"/>'),
    // ccl2 copy and paste style: a brush, and a brush onto a page
    copyStyle: I('<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 20h6"/>'),
    pasteStyle: I('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/><path d="M9 13l2 2 4-4"/>'),
    // ccl3 text templates: a framed T
    tmpl: I('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M12 9v7"/>'),
    edit: I('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>'),
    split: I('<line x1="12" y1="3" x2="12" y2="21"/><path d="M8 7H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h3M16 7h3a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-3"/>'),
    audio: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    text: I('<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>'),
    sticker: I('<path d="M15 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h7l8-8V6a3 3 0 0 0-3-3z"/><path d="M13 21v-5a3 3 0 0 1 3-3h5"/>'),
    effects: I('<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
    overlay: I('<rect x="3" y="3" width="13" height="13" rx="2"/><rect x="8" y="8" width="13" height="13" rx="2"/>'),
    captions: I('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="6" y1="14" x2="10" y2="14"/><line x1="13" y1="14" x2="18" y2="14"/>'),
    filters: I('<circle cx="9" cy="9" r="6"/><circle cx="15" cy="15" r="6"/>'),
    adjust: I('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'),
    tidy: I('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="14" y2="18"/><line x1="10" y1="10" x2="14" y2="14"/><line x1="14" y1="10" x2="10" y2="14"/>'),
    post: I('<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>'),
    add: I('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    speed: I('<path d="M12 21a9 9 0 1 1 9-9"/><polyline points="12 7 12 12 15.5 14"/>'),
    volume: I('<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14"/>'),
    anim: I('<circle cx="12" cy="12" r="3"/><path d="M12 3a9 9 0 0 1 9 9M3 12a9 9 0 0 1 9-9" stroke-dasharray="2 3"/><path d="M21 12a9 9 0 0 1-9 9"/>'),
    trans: I('<rect x="2" y="6" width="8" height="12" rx="1.5"/><rect x="14" y="6" width="8" height="12" rx="1.5"/><path d="M10 12h4"/>'),
    crop: I('<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'),
    canvas: I('<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="8" width="10" height="8" rx="1"/>'),
    rotate: I('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
    freeze: I('<line x1="12" y1="2" x2="12" y2="22"/><line x1="4" y1="7" x2="20" y2="17"/><line x1="4" y1="17" x2="20" y2="7"/>'),
    replace: I('<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>'),
    extract: I('<path d="M3 12h3l3-7 4 14 3-7h5"/>'),
    layout: I('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/>'),
    fade: I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l6-6M7 19l14-14" opacity="0.6"/>'),
    rename: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    duplicate: I('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    trash: I('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    font: I('<polyline points="4 20 9 4 14 20"/><line x1="5.8" y1="14" x2="12.2" y2="14"/><path d="M17 10a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM20 10v10"/>'),
    style: I('<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c.9 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.4-.7-.4-1.1 0-.9.7-1.6 1.6-1.6H16a6 6 0 0 0 6-6c0-4.9-4.5-8.6-10-8.6z"/>'),
    place: I('<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>'),
    opacity: I('<path d="M12 2.7l5.7 5.6a8 8 0 1 1-11.4 0z"/><path d="M12 9v11" opacity="0.6"/>'),
    blend: I('<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'),
    arrange: I('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><path d="M14 6h4a2 2 0 0 1 2 2v2M10 18H6a2 2 0 0 1-2-2v-2"/>'),
    strength: I('<line x1="4" y1="20" x2="4" y2="14"/><line x1="10" y1="20" x2="10" y2="9"/><line x1="16" y1="20" x2="16" y2="5"/><line x1="22" y1="20" x2="22" y2="2" opacity="0.4"/>'),
    music: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
    sfx: I('<path d="M2 12h2M6 8v8M10 5v14M14 9v6M18 7v10M22 12h-2"/>'),
    mine: I('<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>'),
    voice: I('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><line x1="12" y1="18" x2="12" y2="22"/>'),
    duck: I('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><polyline points="13 12 16 15 19 12" opacity="0.7"/>'),
    play: I('<polygon points="6 3 20 12 6 21 6 3"/>'),
    timing: I('<circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 14.5"/><line x1="9" y1="2" x2="15" y2="2"/>')
  };

  // selecting the clip under the playhead, for the tools that act on "this clip"
  function selectClipHere(tool) {
    const info = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
    if (!info) { toast("Add footage to the timeline first"); return; }
    pendingTool = tool || null;
    S.sel = { type: "clip", id: info.clip.id };
    renderTimeline();
    renderInspector();
  }

  function mainTools() {
    return [
      { id: "edit", label: "Edit", icon: ICON.edit, run: () => selectClipHere(null) },
      { id: "audio", label: "Audio", icon: ICON.audio, group: "audio" },
      { id: "text", label: "Text", icon: ICON.text, group: "text" },
      { id: "stickers", label: "Stickers", icon: ICON.sticker, run: () => openStickers(null) },
      { id: "effects", label: "Effects", icon: ICON.effects, run: () => openEffects(null) },
      { id: "overlay", label: "Overlay", icon: ICON.overlay, run: () => $("tbOverlay").click() },
      { id: "captions", label: "Captions", icon: ICON.captions, run: () => $("tbCaptions").click() },
      { id: "filters", label: "Filters", icon: ICON.filters, run: () => { if (!S.clips.length) { toast("Add clips to the timeline first"); return; } pendingTool = "filters"; S.sel = { type: "all" }; renderTimeline(); renderInspector(); } },
      { id: "adjust", label: "Adjust", icon: ICON.adjust, run: () => selectClipHere("adjust") },
      { id: "tidy", label: "Tidy", icon: ICON.tidy, run: () => $("tbTidy").click() },
      { id: "post", label: "Post", icon: ICON.post, run: () => $("tbPost").click() },
      { id: "add", label: "Add", icon: ICON.add, run: () => $("tbAdd").click() }
    ];
  }
  function groupTools(g) {
    if (g === "audio") {
      const sheet = (pane) => { $("tbAudio").click(); if (pane !== "music") showAudioPane(pane); };
      return [
        { id: "music", label: "Music", icon: ICON.music, run: () => sheet("music") },
        { id: "sfx", label: "Sound effects", icon: ICON.sfx, run: () => sheet("fx") },
        { id: "mine", label: "Your audio", icon: ICON.mine, run: () => sheet("mine") },
        { id: "extract", label: "Extract", icon: ICON.extract, run: () => $("tbExtract").click() },
        { id: "voice", label: "Voiceover", icon: ICON.voice, run: startVoiceover }
      ];
    }
    return [
      { id: "addtext", label: "Add text", icon: ICON.text, run: () => { pendingTool = "edit"; addText(); } },
      // ccl3: CapCut keeps Text templates right next to Add text
      { id: "templates", label: "Templates", icon: ICON.tmpl, run: openTemplates },
      { id: "captions", label: "Captions", icon: ICON.captions, run: () => $("tbCaptions").click() },
      { id: "stickers", label: "Stickers", icon: ICON.sticker, run: () => openStickers(null) }
    ];
  }
  const act = (id, label, icon, run) => ({ id: id, label: label, icon: icon, run: run });
  const tool = (id, label, icon, panel, extra) => Object.assign({ id: id, label: label, icon: icon, panel: panel }, extra || {});
  const common = () => [act("duplicate", "Duplicate", ICON.duplicate, duplicateSelection), act("delete", "Delete", ICON.trash, deleteSelection)];

  // small builders every panel shares
  const redrawPanel = () => { commit(); renderInspector(); syncOverlays(); };
  function chipsRow(items, cur, pick, after) {
    const row = mk("div", "filter-chips");
    items.forEach(([v, label]) => {
      const b = mk("button", "fchip" + (cur === v ? " active" : ""), label);
      b.type = "button";
      b.addEventListener("click", () => { pick(v); (after || redrawPanel)(); });
      row.appendChild(b);
    });
    return row;
  }
  function colorPick(val, set) {
    const c = document.createElement("input");
    c.type = "color";
    c.value = /^#[0-9a-f]{6}$/i.test(val || "") ? val : "#ffffff";
    c.addEventListener("input", () => { set(c.value); syncOverlays(); });
    c.addEventListener("change", () => commit());
    return c;
  }
  const pct = (v) => Math.round(v * 100) + "%";

  /* The tools for whatever is selected, CapCut's order: the most used first
     (Split, Speed, Volume, Animation), Delete last. */
  function selectionTools() {
    const s = S.sel;
    if (!s) return [];
    if (s.type === "all") {
      return [tool("filters", "Filters", ICON.filters, (box) => {
        box.appendChild(mk("p", "panel-note", "On every clip"));
        filterPanel(box, () => (S.clips[0] ? S.clips[0].filter : "none"),
          (key) => { S.clips.forEach((c) => { c.filter = key; }); },
          () => (S.clips[0] && S.clips[0].filterAmt != null ? S.clips[0].filterAmt : 1),
          (v) => { S.clips.forEach((c) => { c.filterAmt = v; }); },
          S.clips[0]);
      })];
    }
    if (s.type === "clip") {
      const c = clipById(s.id);
      if (!c) return [];
      const m = mediaById(c.mediaId), isVid = m && m.type === "video", idx = S.clips.indexOf(c);
      const list = [act("split", "Split", ICON.split, splitAtPlayhead)];
      if (isVid) {
        list.push(tool("speed", "Speed", ICON.speed, (box) => {
          box.appendChild(group("Speed", slider(0.25, 3, 0.05, c.speed, (v) => { c.speed = v; renderTimeline(); }, () => commit(), (v) => v.toFixed(2) + "×")));
          box.appendChild(chipsRow([[0.5, "0.5×"], [1, "1×"], [1.5, "1.5×"], [2, "2×"], [3, "3×"]], c.speed, (v) => { c.speed = v; renderTimeline(); }));
        }));
        list.push(tool("volume", "Volume", ICON.volume, (box) => {
          box.appendChild(group("Volume", slider(0, 1, 0.05, c.volume, (v) => { c.volume = v; }, () => commit(), pct)));
          box.appendChild(group("Sound", chipsRow([[false, "On"], [true, "Muted"]], !!c.muted, (v) => { c.muted = v; })));
        }));
      } else {
        list.push(tool("duration", "Duration", ICON.timing, (box) => {
          box.appendChild(group("Shows for", slider(0.5, 15, 0.1, c.out - c.in, (v) => { c.out = c.in + v; renderTimeline(); }, () => commit(), (v) => v.toFixed(1) + "s")));
        }));
      }
      list.push(tool("anim", "Animation", ICON.anim, (box) => clipAnimPanel(box, c, redrawPanel)));
      if (idx > 0) list.push(tool("trans", "Transition", ICON.trans, (box) => transitionPanel(box, c, S.clips[idx - 1], redrawPanel)));
      list.push(tool("filters", "Filters", ICON.filters, (box) => {
        filterPanel(box, () => c.filter, (k) => { c.filter = k; }, () => (c.filterAmt == null ? 1 : c.filterAmt), (v) => { c.filterAmt = v; }, c);
        if (c.filter && c.filter !== "none" && S.clips.length > 1) {
          const all = mk("button", "fchip", "Use on every clip");
          all.type = "button";
          all.addEventListener("click", () => { S.clips.forEach((x) => { x.filter = c.filter; if (c.filterAmt != null) x.filterAmt = c.filterAmt; else delete x.filterAmt; }); commit(); syncNow(); toast("This filter is on every clip now"); });
          box.appendChild(group("", all));
        }
      }));
      list.push(tool("adjust", "Adjust", ICON.adjust, (box) => {
        ADJ.forEach(([k, label, lo, hi]) => {
          box.appendChild(group(label, slider(lo, hi, 1, (c.adj && c.adj[k]) || 0,
            (v) => { c.adj = Object.assign({}, c.adj, { [k]: v }); if (!v) delete c.adj[k]; syncOverlays(); },
            () => commit(), (v) => (v > 0 && lo < 0 ? "+" : "") + v)));
        });
        const row = mk("div", "filter-chips");
        const all = mk("button", "fchip", "Use on every clip");
        all.addEventListener("click", () => { S.clips.forEach((x) => { if (c.adj) x.adj = Object.assign({}, c.adj); else delete x.adj; }); commit(); syncNow(); toast("Adjustments copied to every clip"); });
        const reset = mk("button", "fchip", "Reset");
        reset.addEventListener("click", () => { delete c.adj; redrawPanel(); });
        row.appendChild(all); row.appendChild(reset);
        box.appendChild(row);
      }));
      list.push(tool("crop", "Crop", ICON.crop, (box) => cropPanel(box, c), { onDone: () => endCrop(true), onClose: () => { if (cropEdit) endCrop(false); } }));
      list.push(tool("canvas", "Canvas", ICON.canvas, (box) => {
        box.appendChild(group("Frame", chipsRow([["fill", "Fill the frame"], ["fit", "Whole picture"]], c.fit === "fit" ? "fit" : "fill", (v) => { if (v === "fit") c.fit = "fit"; else delete c.fit; })));
        if (c.fit === "fit") {
          const bg = chipsRow(FIT_BACKGROUNDS, c.bg || "blur", (v) => { if (v === "blur") delete c.bg; else c.bg = v; });
          if (c.bg === "color") { const ci = colorPick(c.bgColor || "#111210", (v) => { c.bgColor = v; }); bg.appendChild(ci); }
          box.appendChild(group("Background", bg));
          const all = mk("button", "fchip", "Use on every clip");
          all.addEventListener("click", () => { S.clips.forEach((x) => { x.fit = "fit"; if (c.bg) x.bg = c.bg; else delete x.bg; if (c.bgColor) x.bgColor = c.bgColor; }); redrawPanel(); });
          box.appendChild(all);
        }
      }));
      list.push(tool("rotate", "Rotate", ICON.rotate, (box) => {
        const row = mk("div", "filter-chips");
        const flip = (label, key) => { const b = mk("button", "fchip" + (c[key] ? " active" : ""), label); b.addEventListener("click", () => { if (c[key]) delete c[key]; else c[key] = true; redrawPanel(); }); row.appendChild(b); };
        flip("Mirror", "flipH");
        flip("Upside down", "flipV");
        const rot = mk("button", "fchip" + (c.rot ? " active" : ""), "Rotate" + (c.rot ? " " + c.rot + "°" : ""));
        rot.addEventListener("click", () => { c.rot = ((c.rot || 0) + 90) % 360; if (!c.rot) delete c.rot; redrawPanel(); });
        row.appendChild(rot);
        box.appendChild(row);
      }));
      if (isVid) {
        list.push(act("freeze", "Freeze", ICON.freeze, () => freezeFrame(c)));
        list.push(act("extract", "Extract audio", ICON.extract, () => extractClipAudio(c)));
        list.push(tool("layout", "Layout", ICON.layout, (box) => {
          const lay = layoutOf(c);
          box.appendChild(group("Layout", chipsRow(Object.keys(LAYOUTS).map((k) => [k, LAYOUTS[k]]), lay ? lay.type : "fill", (k) => {
            if (k === "fill") delete c.layout;
            else if (!lay || lay.type !== k) c.layout = k === "split" ? { type: "split", a: 0.27, b: 0.73 } : { type: "screen", fx: 0.85, fy: 0.2, fs: 0.32, sx: 0.5 };
          })));
          const laySlider = (label, key, min, max) => box.appendChild(group(label, slider(min, max, 0.01, lay[key], (v) => { lay[key] = v; syncNow(); }, () => commit(), pct)));
          if (lay && lay.type === "split") { laySlider("First person, across", "a", 0, 1); laySlider("Second person, across", "b", 0, 1); }
          else if (lay && lay.type === "screen") { laySlider("Face, across", "fx", 0, 1); laySlider("Face, down", "fy", 0, 1); laySlider("Face size", "fs", 0.1, 1); laySlider("Screen, across", "sx", 0, 1); }
        }));
      }
      list.push(act("replace", "Replace", ICON.replace, () => replaceClip(c)));
      list.push(tool("fade", "Fade", ICON.fade, (box) => {
        box.appendChild(group("Fade in", slider(0, 1.5, 0.05, c.fadeIn || 0, (v) => { c.fadeIn = v; syncOverlays(); }, () => commit(), (v) => v.toFixed(2) + "s")));
        box.appendChild(group("Fade out", slider(0, 1.5, 0.05, c.fadeOut || 0, (v) => { c.fadeOut = v; syncOverlays(); }, () => commit(), (v) => v.toFixed(2) + "s")));
      }));
      list.push(tool("rename", "Rename", ICON.rename, (box) => {
        const nameIn = document.createElement("input");
        nameIn.type = "text"; nameIn.maxLength = 60; nameIn.value = c.name || ""; nameIn.placeholder = m ? m.name : "Clip name";
        nameIn.className = "panel-input";
        nameIn.addEventListener("input", () => { const v = nameIn.value.replace(/\s+/g, " ").trim(); if (v) c.name = v; else delete c.name; renderTimeline(); });
        nameIn.addEventListener("change", () => { commit(); recordEdit("rename-clip", { named: !!c.name }); });
        nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") nameIn.blur(); });
        box.appendChild(group("Name", nameIn));
        setTimeout(() => nameIn.focus(), 50);
      }));
      return list.concat(common());
    }
    if (s.type === "text") {
      const t = textById(s.id);
      if (!t) return [];
      const tp = (id, label, icon, tab) => tool(id, label, icon, (box) => textPanel(box, t, tab));
      if (t.sticker) {
        return [tp("stk", "Sticker", ICON.sticker, "stk"), tp("anim", "Animation", ICON.anim, "anim"), tp("place", "Position", ICON.place, "place"),
          act("replace", "Replace", ICON.replace, () => openStickers(t))].concat(common());
      }
      const heading = textStyleOf(t) === "heading";
      const list = [tp("edit", "Edit", ICON.rename, "text"), tp("font", "Font", ICON.font, "font")];
      if (heading) list.push(tp("style", "Style", ICON.style, "style"), tp("anim", "Animation", ICON.anim, "anim"), tp("place", "Position", ICON.place, "place"));
      // ccl2: copy this text's whole look, paste it on another (or on every text)
      list.push(act("copystyle", "Copy style", ICON.copyStyle, () => copyTextStyle(t)));
      if (styleClip) {
        list.push(act("pastestyle", "Paste style", ICON.pasteStyle, () => pasteTextStyle([t])));
        if (S.texts.filter((x) => !x.sticker).length > 2) list.push(act("pasteall", "Paste on all", ICON.pasteStyle, () => pasteTextStyle(S.texts.filter((x) => !x.sticker))));
      }
      return list.concat(common());
    }
    if (s.type === "broll") {
      const b = brollById(s.id);
      if (!b) return [];
      return [
        act("split", "Split", ICON.split, splitAtPlayhead),
        tool("arrange", "Arrange", ICON.arrange, (box) => {
          box.appendChild(group("Size", chipsRow([["inset", "Panel"], ["cover", "Full frame"]], b.mode === "cover" ? "cover" : "inset", (k) => { b.mode = k; })));
          if (b.mode !== "cover") {
            box.appendChild(mk("p", "panel-note", "Drag it on the picture to move it. Two fingers make it bigger or smaller and turn it."));
            box.appendChild(group("Shape", chipsRow([["square", "Square"], ["original", "Its own shape"], ["round", "Round"]], b.shape || "square", (k) => { if (k === "square") delete b.shape; else b.shape = k; })));
            box.appendChild(group("Scale", slider(0.08, 1.6, 0.01, b.scale || BROLL_SIZE, (v) => { b.scale = v; syncOverlays(); }, () => commit(), pct)));
            box.appendChild(group("Rotate", slider(-180, 180, 1, b.rot || 0, (v) => { b.rot = v; syncOverlays(); }, () => commit(), (v) => v + "°")));
            const reset = mk("button", "fchip", "Back to the middle");
            reset.addEventListener("click", () => { delete b.x; delete b.y; delete b.scale; delete b.rot; redrawPanel(); });
            box.appendChild(reset);
          }
        }),
        tool("opacity", "Opacity", ICON.opacity, (box) => box.appendChild(group("Opacity", slider(0, 1, 0.01, b.opacity == null ? 1 : b.opacity, (v) => { b.opacity = v; syncOverlays(); }, () => commit(), pct)))),
        tool("blend", "Blend", ICON.blend, (box) => box.appendChild(group("Blend", chipsRow(BLENDS, b.blend || "normal", (v) => { if (v === "normal") delete b.blend; else b.blend = v; })))),
        tool("timing", "Timing", ICON.timing, (box) => {
          box.appendChild(group("Length", slider(0.3, 12, 0.1, b.dur, (v) => { b.dur = v; renderTimeline(); syncOverlays(); }, () => commit(), (v) => v.toFixed(1) + "s")));
          box.appendChild(group("Starts at", slider(0, Math.max(0.1, total()), 0.05, Math.min(b.start, total()), (v) => { b.start = v; renderTimeline(); syncOverlays(); }, () => commit(), (v) => fmt(v))));
        })
      ].concat(common());
    }
    if (s.type === "effect") {
      const e = effectById(s.id);
      if (!e) return [];
      return [
        act("change", "Change", ICON.replace, () => openEffects(e)),
        tool("strength", "Adjust", ICON.strength, (box) => effectPanel(box, e))
      ].concat(common());
    }
    if (s.type === "uaudio") {
      const a = audioById(s.id);
      if (!a) return [];
      const m = mediaById(a.mediaId);
      const list = [
        act("split", "Split", ICON.split, splitAtPlayhead),
        tool("volume", "Volume", ICON.volume, (box) => box.appendChild(group("Volume", slider(0, 1.5, 0.05, typeof a.gain === "number" ? a.gain : 1, (v) => { a.gain = v; syncAudioClips(); }, () => commit(), pct)))),
        tool("fade", "Fade", ICON.fade, (box) => {
          box.appendChild(group("Fade in", slider(0, 3, 0.05, a.fadeIn || 0, (v) => { a.fadeIn = v; }, () => commit(), (v) => v.toFixed(2) + "s")));
          box.appendChild(group("Fade out", slider(0, 3, 0.05, a.fadeOut || 0, (v) => { a.fadeOut = v; }, () => commit(), (v) => v.toFixed(2) + "s")));
        })
      ];
      if (m && m.type === "video") list.push(tool("speed", "Speed", ICON.speed, (box) => box.appendChild(group("Speed", slider(0.25, 3, 0.05, a.speed || 1, (v) => { a.speed = v; renderTimeline(); syncAudioClips(); }, () => commit(), (v) => v.toFixed(2) + "×")))));
      return list.concat(common());
    }
    if (s.type === "music") {
      if (!S.music) return [];
      const change = () => { renderSoundSheet(); showAudioPane("music"); openSheet("soundSheet"); renderMusic(); };
      return [
        tool("volume", "Volume", ICON.volume, (box) => box.appendChild(group("Volume", slider(0, 1, 0.05, typeof S.music.gain === "number" ? S.music.gain : 0.35, (v) => { S.music.gain = v; applyMusicGain(); }, () => commit(), pct)))),
        tool("fade", "Fade", ICON.fade, (box) => {
          box.appendChild(group("Fade in", slider(0, 5, 0.1, typeof S.music.fadeIn === "number" ? S.music.fadeIn : 0.3, (v) => { S.music.fadeIn = v; applyMusicGain(); }, () => commit(), (v) => v.toFixed(1) + "s")));
          box.appendChild(group("Fade out", slider(0, 8, 0.1, typeof S.music.fadeOut === "number" ? S.music.fadeOut : 1.5, (v) => { S.music.fadeOut = v; applyMusicGain(); }, () => commit(), (v) => v.toFixed(1) + "s")));
        }),
        tool("beats", "Beats", ICON.beats, (box) => beatsPanel(box)),
        tool("duck", "Lower for voices", ICON.duck, (box) => box.appendChild(group("Lower the music while someone talks", chipsRow([[true, "On"], [false, "Off"]], S.music.duck !== false, (v) => { S.music.duck = v; })))),
        act("replace", "Replace", ICON.replace, change),
        act("delete", "Delete", ICON.trash, deleteSelection)
      ];
    }
    if (s.type === "sfx") {
      const x = sfxById(s.id);
      if (!x) return [];
      return [
        act("play", "Play", ICON.play, () => previewSfx(x.name)),
        tool("volume", "Volume", ICON.volume, (box) => box.appendChild(group("Volume", slider(0, 2, 0.05, typeof x.gain === "number" ? x.gain : 1, (v) => { x.gain = v; }, () => commit(), pct))))
      ].concat(common());
    }
    return [];
  }

  // the crop tool opens the crop box on the picture straight away
  function cropPanel(box, c) {
    if (!cropEdit || cropEdit.clip !== c) { setTimeout(() => { if (activeTool === "crop" && S.sel && S.sel.id === c.id && !cropEdit) startCrop(c); }, 0); }
    box.appendChild(mk("p", "panel-note", "Drag the box or its corners on the picture."));
    const ratios = mk("div", "filter-chips");
    CROP_RATIOS.forEach(([v, label]) => {
      const b = mk("button", "fchip" + (cropEdit && cropEdit.ratio === v ? " active" : ""), label);
      b.type = "button";
      b.addEventListener("click", () => { if (cropEdit) { setCropRatio(v); renderInspector(); } });
      ratios.appendChild(b);
    });
    box.appendChild(group("Shape", ratios));
    const row = mk("div", "filter-chips");
    const whole = mk("button", "fchip", "Whole picture");
    whole.addEventListener("click", () => { if (cropEdit) { cropEdit.rect = { x: 0, y: 0, w: 1, h: 1 }; cropEdit.ratio = null; renderInspector(); syncOverlays(); } });
    const cancel = mk("button", "fchip", "Cancel");
    cancel.addEventListener("click", () => { activeTool = null; endCrop(false); });
    row.appendChild(whole); row.appendChild(cancel);
    box.appendChild(row);
  }

  function currentTools() { return S.sel ? selectionTools() : toolGroup ? groupTools(toolGroup) : mainTools(); }

  function renderActionBar() {
    const bar = $("actionBar");
    if (!bar) return;
    bar.innerHTML = "";
    const level = S.sel ? "context" : toolGroup ? "group" : "main";
    bar.dataset.level = level;
    if (level !== "main") {
      const back = mk("button", "ab-back", ICON.back);
      back.type = "button";
      back.setAttribute("aria-label", "Back");
      back.addEventListener("click", () => {
        if (cropEdit) endCrop(false);
        if (S.sel) { S.sel = null; activeTool = null; renderTimeline(); }
        else toolGroup = null;
        renderInspector();
      });
      bar.appendChild(back);
    }
    const strip = mk("div", "ab-strip");
    currentTools().forEach((t) => {
      const b = mk("button", "ab-tool" + (activeTool === t.id && S.sel ? " active" : "") + (t.id === "delete" ? " danger" : ""));
      b.type = "button";
      b.innerHTML = t.icon + '<span class="ab-label"></span>';
      b.lastChild.textContent = t.label;
      b.addEventListener("click", () => {
        if (t.group) { toolGroup = t.group; renderInspector(); return; }
        if (t.panel) {
          if (cropEdit && t.id !== "crop") endCrop(false);
          activeTool = activeTool === t.id ? null : t.id;
          renderInspector();
          return;
        }
        if (t.run) t.run();
      });
      strip.appendChild(b);
    });
    bar.appendChild(strip);
  }

  function renderInspector() {
    const key = selKey();
    if (key !== lastSelKey) {
      lastSelKey = key;
      if (cropEdit && (!S.sel || S.sel.type !== "clip" || cropEdit.clip.id !== S.sel.id)) { const ce = cropEdit; cropEdit = null; void ce; }
      activeTool = pendingTool;
      if (S.sel) toolGroup = null;
    }
    pendingTool = null;
    renderActionBar();
    const ins = $("inspector");
    ins.innerHTML = "";
    const t = S.sel && activeTool ? selectionTools().find((x) => x.id === activeTool) : null;
    if (!t || !t.panel) {
      activeTool = null;
      ins.classList.add("hidden");
      document.body.classList.remove("panel-open");
      return;
    }
    ins.classList.remove("hidden");
    document.body.classList.add("panel-open");
    const head = mk("div", "panel-head");
    head.appendChild(mk("span", "panel-title", ""));
    head.firstChild.textContent = t.label;
    const done = mk("button", "panel-done", ICON.check);
    done.type = "button";
    done.setAttribute("aria-label", "Done");
    done.addEventListener("click", () => {
      const fn = t.onDone;
      activeTool = null;
      if (fn) fn(); else renderInspector();
    });
    head.appendChild(done);
    ins.appendChild(head);
    const body = mk("div", "panel-body");
    ins.appendChild(body);
    t.panel(body);
  }

  /* The text and sticker panels: one tool each (Edit, Font, Style,
     Animation, Position, Sticker), CapCut's text tabs as separate tools. */
  function textPanel(ins, t, tab) {
    textTab = tab;
    const sticker = t.sticker || null;
    const style = textStyleOf(t);
    const heading = style === "heading";
    const k = textLook(t);
    const live = () => { syncOverlays(); };
    const save = () => commit();
    const redo = redrawPanel;
    const colorIn = colorPick;
    const chips = (items, cur, pick) => chipsRow(items, cur, pick);
    const onOff = (on, set) => chips([[true, "On"], [false, "Off"]], !!on, set);
    const row = (...els) => { const r = mk("div", "ins-row"); els.forEach((e) => r.appendChild(e)); return r; };

    if (textTab === "stk" && sticker) {
      ins.appendChild(group("Size", slider(10, 220, 1, t.size, (v) => { t.size = v; live(); }, save, (v) => v + "")));
      if (sticker === "shape") ins.appendChild(group("Colour", colorIn(t.color, (v) => { t.color = v; })));
      ins.appendChild(group("Opacity", slider(0, 1, 0.05, k.opacity, (v) => { t.opacity = v; live(); }, save, pct)));
      ins.appendChild(group("Shadow", onOff(k.shadow, (v) => { t.shadow = v; if (v && t.shOpacity == null) { t.shOpacity = 0.6; t.shBlur = 0.3; t.shDist = 0.05; t.shAngle = 90; } })));
      ins.appendChild(group("Shows for", slider(0.5, 20, 0.5, t.dur, (v) => { t.dur = v; renderTimeline(); }, save, (v) => v.toFixed(1) + "s")));
    }

    if (textTab === "text") {
      const ti = document.createElement("textarea");
      ti.rows = 2; ti.value = t.text; ti.maxLength = 200;
      ti.className = "ins-textarea";
      ti.addEventListener("input", () => { t.text = ti.value; renderTimeline(); live(); });
      ti.addEventListener("change", save);
      ins.appendChild(group(style === "lower" ? "Name" : "Text", ti));
      if (t.text === "Your text") setTimeout(() => { ti.focus(); ti.select(); }, 60);
      ins.appendChild(group("Kind", chips([["heading", "Heading"], ["lower", "Lower third"], ["card", "Title card"]], style, (kk) => {
        if (kk === "heading") delete t.style; else t.style = kk;
        if (kk === "card" && !t.bg) t.bg = BRAND.main;
        if (kk === "lower" && !t.accent) t.accent = BRAND.accent;
        if (kk !== "heading" && (!t.color || t.color.toLowerCase() === "#ffffff")) t.color = BRAND.text;
      })));
      if (!heading) {
        const si = document.createElement("input");
        si.type = "text"; si.value = t.sub || ""; si.maxLength = 80; si.className = "panel-input";
        si.placeholder = style === "lower" ? "Who they are (optional)" : "A second line (optional)";
        si.addEventListener("input", () => { t.sub = si.value; live(); });
        si.addEventListener("change", save);
        ins.appendChild(group("Second line", si));
      }
      if (style === "card") {
        ins.appendChild(group("Background", colorIn(t.bg || "#111210", (v) => { t.bg = v; })));
        const own = mk("div", "filter-chips");
        const before = mk("button", "fchip", "Put before the video");
        const after = mk("button", "fchip", "Put after the video");
        before.addEventListener("click", () => makeCardClip(t, "start"));
        after.addEventListener("click", () => makeCardClip(t, "end"));
        own.appendChild(before); own.appendChild(after);
        ins.appendChild(group("As its own clip", own));
      }
      ins.appendChild(group("Size", slider(10, 160, 1, t.size, (v) => { t.size = v; live(); }, save, (v) => v + "")));
      ins.appendChild(group("Colour", colorIn(t.color, (v) => { t.color = v; })));
      ins.appendChild(group("Shows for", slider(0.5, 20, 0.5, t.dur, (v) => { t.dur = v; renderTimeline(); }, save, (v) => v.toFixed(1) + "s")));
    }

    if (textTab === "font") {
      const SF = window.SenotelFonts;
      const fam = t.font || (heading ? "Anton" : "");
      const fb = mk("button", "font-btn");
      fb.type = "button";
      const fname = mk("span", "font-btn-name", "");
      fname.textContent = fam || "vClyps' own";
      if (fam) fname.style.fontFamily = "'" + fam + "', system-ui, sans-serif";
      fb.appendChild(fname);
      fb.appendChild(mk("span", "font-btn-more", SF ? SF.TEXT.length + " fonts" : ""));
      fb.addEventListener("click", () => {
        if (!SF) return;
        const extra = [{ value: "", label: heading ? "Anton (the original)" : "vClyps' own", family: heading ? "Anton" : null, note: "What texts used before fonts could be picked" }];
        SF.openPicker({
          kind: "text", value: t.font || "", extra: extra,
          onPick: (v) => {
            if (v) { t.font = v; t.weight = SF.pick(v, heading ? 700 : 400); SF.load(v, t.weight, t.italic); }
            else { delete t.font; delete t.weight; }
            redo();
          }
        });
      });
      ins.appendChild(group("Font", fb));
      const info = t.font && SF ? SF.info(t.font) : null;
      if (info && info.weights.length > 1) {
        const NAMES = { 100: "Thin", 200: "Extra light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra bold", 900: "Black" };
        ins.appendChild(group("Weight", chips(info.weights.map((w) => [w, NAMES[w] || String(w)]), SF.pick(t.font, k.weight), (w) => { t.weight = w; })));
      }
      ins.appendChild(group("Slant", chips([[false, "Upright"], [true, "Italic"]], !!k.italic, (v) => { t.italic = v; })));
      ins.appendChild(group("Letters", chips([[false, "As typed"], [true, "ALL CAPS"]], !!k.upper, (v) => { t.upper = v; })));
    }

    if (textTab === "style") {
      // one-tap looks: they change the styling, never the words, font or place
      const pres = mk("div", "tx-presets");
      TEXT_PRESETS.forEach((p) => {
        const b = mk("button", "tx-preset");
        b.type = "button";
        b.title = p.name;
        const cv = document.createElement("canvas");
        cv.width = 120; cv.height = 64;
        b.appendChild(cv);
        b.addEventListener("click", () => { applyTextPreset(t, p); redo(); });
        pres.appendChild(b);
        requestAnimationFrame(() => drawPresetTile(cv, t, p));
      });
      ins.appendChild(group("Looks", pres));
      ins.appendChild(group("Text", row(colorIn(t.color, (v) => { t.color = v; }), slider(0, 1, 0.05, k.opacity, (v) => { t.opacity = v; live(); }, save, pct))));
      ins.appendChild(group("Outline", row(colorIn(k.strokeColor, (v) => { t.strokeColor = v; }), slider(0, 0.3, 0.01, k.strokeW, (v) => { t.strokeW = v; live(); }, save, (v) => Math.round(v * 100) + ""))));
      ins.appendChild(group("Background", onOff(k.boxOn, (v) => { t.boxOn = v; })));
      if (k.boxOn) {
        ins.appendChild(group("Background colour", row(colorIn(k.boxColor, (v) => { t.boxColor = v; }), slider(0, 1, 0.05, k.boxOpacity, (v) => { t.boxOpacity = v; live(); }, save, pct))));
        ins.appendChild(group("Corners", slider(0, 1, 0.05, k.boxRadius, (v) => { t.boxRadius = v; live(); }, save, pct)));
      }
      ins.appendChild(group("Shadow", onOff(k.shadow, (v) => { t.shadow = v; })));
      if (k.shadow) {
        ins.appendChild(group("Shadow colour", row(colorIn(k.shColor, (v) => { t.shColor = v; }), slider(0, 1, 0.05, k.shOpacity, (v) => { t.shOpacity = v; live(); }, save, pct))));
        ins.appendChild(group("Blur", slider(0, 1, 0.01, k.shBlur, (v) => { t.shBlur = v; live(); }, save, (v) => Math.round(v * 100) + "")));
        ins.appendChild(group("Distance", slider(0, 0.3, 0.01, k.shDist, (v) => { t.shDist = v; live(); }, save, (v) => Math.round(v * 100) + "")));
        ins.appendChild(group("Angle", slider(0, 359, 1, k.shAngle, (v) => { t.shAngle = v; live(); }, save, (v) => v + "°")));
      }
      ins.appendChild(group("Glow", onOff(k.glowOn, (v) => { t.glowOn = v; })));
      if (k.glowOn) ins.appendChild(group("Glow colour", row(colorIn(k.glowColor, (v) => { t.glowColor = v; }), slider(0.1, 1.5, 0.05, k.glowSize, (v) => { t.glowSize = v; live(); }, save, (v) => Math.round(v * 100) + ""))));
      ins.appendChild(group("Letter spacing", slider(-0.1, 0.5, 0.01, k.spacing, (v) => { t.spacing = v; live(); }, save, (v) => Math.round(v * 100) + "")));
      ins.appendChild(group("Line spacing", slider(0.8, 2, 0.05, k.lineH, (v) => { t.lineH = v; live(); }, save, (v) => v.toFixed(2))));
      ins.appendChild(group("Align", chips([["left", "Left"], ["center", "Centre"], ["right", "Right"]], k.align, (v) => { t.align = v; })));
    }

    if (textTab === "anim" && TA()) {
      /* CapCut's layout: In, Out and Loop, each a grid of moving previews
         of this very text's look, and the length bar under them. */
      const lib = TA();
      const KIND = { in: ["animIn", lib.IN], out: ["animOut", lib.OUT], loop: ["animLoop", lib.LOOP] };
      const sub = mk("div", "ins-seg anim-kinds");
      [["in", "In"], ["out", "Out"], ["loop", "Loop"]].forEach(([key, label]) => {
        const b = mk("button", animKind === key ? "active" : "", label + (t[KIND[key][0]] ? " •" : ""));
        b.type = "button";
        b.addEventListener("click", () => { animKind = key; renderInspector(); });
        sub.appendChild(b);
      });
      ins.appendChild(sub);
      const [field, list] = KIND[animKind];
      const grid = mk("div", "anim-grid");
      [["none", "None"]].concat(list).forEach(([id, label]) => {
        const b = mk("button", "anim-tile" + ((t[field] || "none") === id ? " selected" : ""));
        b.type = "button";
        b.title = label;
        if (id !== "none") { const cv = document.createElement("canvas"); cv.dataset.anim = id; b.appendChild(cv); }
        else b.appendChild(mk("span", "anim-none", "None"));
        b.appendChild(mk("span", "anim-name", label));
        b.addEventListener("click", () => {
          if (id === "none") delete t[field];
          else {
            t[field] = id;
            const lenKey = animKind === "in" ? "animInLen" : "animOutLen";
            if (animKind !== "loop" && !t[lenKey + "Set"]) t[lenKey] = lib.lengthFor(id);
          }
          redo();
          if (id !== "none") previewTextAnim(t, animKind === "out" ? "out" : "in");
        });
        grid.appendChild(b);
      });
      ins.appendChild(grid);
      if (animKind !== "loop") {
        const lenKey = animKind === "in" ? "animInLen" : "animOutLen";
        const max = Math.max(0.2, Math.min(5, t.animIn && t.animOut ? t.dur / 2 : t.dur));
        const cur = clamp(t[lenKey] || t.animLen || 0.5, 0.1, max);
        ins.appendChild(group("Duration", slider(0.1, max, 0.05, cur, (v) => { t[lenKey] = v; t[lenKey + "Set"] = true; }, () => { save(); previewTextAnim(t, animKind); }, (v) => v.toFixed(1) + "s")));
      } else {
        ins.appendChild(group("Speed", slider(0.25, 3, 0.05, t.animLoopSpeed || 1, (v) => { t.animLoopSpeed = v; syncOverlays(); }, save, (v) => v.toFixed(2) + "×")));
      }
      animateAnimTiles(t, animKind);
    }

    if (textTab === "place") {
      ins.appendChild(mk("p", "panel-note", "Drag it on the picture to move it. Two fingers make it bigger or smaller and turn it."));
      const seg = mk("div", "ins-seg");
      ["top", "center", "bottom"].forEach((p) => {
        const b = mk("button", t.pos === p && t.y == null ? "active" : "", p[0].toUpperCase() + p.slice(1));
        b.addEventListener("click", () => { t.pos = p; delete t.x; delete t.y; redo(); });
        seg.appendChild(b);
      });
      ins.appendChild(group("Place", seg));
      const L = headingLayout(t, 1, 1);
      ins.appendChild(group("Across", slider(0, 1, 0.01, t.x != null ? t.x : 0.5, (v) => { t.x = v; live(); }, save, pct)));
      ins.appendChild(group("Down", slider(0, 1, 0.01, t.y != null ? t.y : L.cy, (v) => { t.y = v; live(); }, save, pct)));
      ins.appendChild(group("Rotate", slider(-180, 180, 1, k.rotate, (v) => { t.rotate = v; live(); }, save, (v) => v + "°")));
      if (!sticker) ins.appendChild(group("Curve", slider(-100, 100, 1, k.curve, (v) => { t.curve = v; live(); }, save, (v) => String(v))));
    }
  }


  /* ═══════════ PLAYBACK ENGINE ═══════════ */

  const pv = $("pv"), pi = $("pi");
  let lastTs = 0;

  function play() {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    if (S.time >= total() - 0.05) S.time = 0;
    S.playing = true;
    /* Start the sound cursor where the playhead is, so pressing play halfway
       through does not dump every earlier sound at once. */
    resetSfxCursor();
    $("playIco").classList.add("hidden");
    $("pauseIco").classList.remove("hidden");
  }
  function pause(keepSfx) {
    S.playing = false;
    pv.pause();
    if (musicEl && !musicEl.paused) musicEl.pause();
    pauseAudioClips();
    // A 2.6s riser tail outliving a deliberate pause is not a feature — but at
    // the natural end of the timeline it is exactly what should happen.
    if (!keepSfx) stopSfx();
    $("playIco").classList.remove("hidden");
    $("pauseIco").classList.add("hidden");
  }
  $("playBtn").addEventListener("click", () => {
    primeAudio();          // this click is the user activation Web Audio needs
    if (S.playing) pause(); else play();
  });

  $("muteBtn").addEventListener("click", () => {
    S.userMuted = !S.userMuted;
    applyMusicGain();
    syncAudioClips();
    if (S.userMuted) stopSfx();   // a riser's tail should not ring on after mute
    $("mOn").classList.toggle("hidden", S.userMuted);
    $("mOff").classList.toggle("hidden", !S.userMuted);
  });

  /* ─── Fullscreen preview (with exit + scrubber, phone-friendly) ─── */
  function inFs() { return document.body.classList.contains("previewFs"); }
  /* Our own full-viewport mode, NOT the Fullscreen API. Every browser shows an
     unsuppressable "press Esc to exit full screen" toast when you call
     requestFullscreen(), and the owner does not want it — so we simply never
     call it. The CSS class was always what guaranteed the fill and the controls
     on every phone anyway; the API only added the browser chrome hiding, and
     its own popup with it. */
  function enterFs() {
    document.body.classList.add("previewFs");
    fsNotice("Fullscreen preview", "Press Esc or use the exit button to return.");
  }
  function exitFs() {
    document.body.classList.remove("previewFs");
    fsNotice("Back to the editor", "Your preview is now in compact view.");
  }

  /* Shared accessible notice: close, swipe, keyboard and attention-aware timer. */
  function fsNotice(title, detail) {
    if (window.SenotelNotices) SenotelNotices.show("fsNotice", title, detail, 5000);
  }
  function toggleFs() { if (inFs()) exitFs(); else enterFs(); }

  $("fsBtn").addEventListener("click", toggleFs);
  $("fsExit").addEventListener("click", exitFs);
  // keep our state in sync if the user leaves real fullscreen via a system gesture
  /* Kept for the case where a browser puts the PAGE into fullscreen by some
     other route (F11). We never request it ourselves any more, so this only
     tidies up if the two states ever disagree. */
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && inFs()) document.body.classList.remove("previewFs");
  });

  // tap the video: enter fullscreen, or toggle play/pause once already fullscreen
  /* ─── Text on the picture (CapCut) ───
     Touch a heading on the picture to select it; drag to move it; two
     fingers pinch it bigger or smaller and turn it (snapping level within a
     few degrees). Hits come from where drawHeading last drew each text. */
  let textGestureUsed = false;

  /* ─── The bin (Instagram's) ───
     While a text, sticker or overlay is dragged on the picture, a bin sits
     at the bottom of the picture. Over it, the bin grows and the item fades
     as if going in; nothing is deleted until the finger lets go, and then
     only after "Delete this?" unless the person said not to ask again.
     Both can be switched off in Settings. */
  const BIN = (() => {
    const base = { on: true, ask: true };
    try { return Object.assign(base, JSON.parse(localStorage.getItem("vclyps-bin") || "{}")); } catch (e) { return base; }
  })();
  const saveBin = () => { try { localStorage.setItem("vclyps-bin", JSON.stringify(BIN)); } catch (e) {} };
  var binHover = null;   // the key of the thing over the bin right now (drawn faded); var: read while drawing from the start
  function binShow(on, box) {
    const bin = $("trashBin");
    bin.classList.toggle("hidden", !on);
    if (on && box) { bin.style.left = box.x + box.w / 2 + "px"; bin.style.top = box.y + box.h - Math.min(76, box.h * 0.16) + "px"; }
    if (!on) bin.classList.remove("over");
  }
  function binOver(p, box) {
    const cx = box.x + box.w / 2, cy = box.y + box.h - Math.min(76, box.h * 0.16);
    return Math.hypot(p.x - cx, p.y - cy) < Math.max(44, box.w * 0.14) || p.y > box.y + box.h * 0.93;
  }
  // after the drop: ask, then delete (or put it back where it was)
  function binDrop(it, putBack) {
    const what = it.kind === "broll" ? "overlay" : it.item.sticker ? "sticker" : "text";
    const go = () => {
      S.sel = { type: it.kind, id: it.item.id };
      deleteSelection();
      buzz("medium");
      toast("Deleted. Undo brings it back");
    };
    if (!BIN.ask) { go(); return; }
    const box = $("binConfirm");
    $("binQ").textContent = "Delete this " + what + "?";
    box.classList.remove("hidden");
    const close = () => { box.classList.add("hidden"); $("binDelete").onclick = $("binCancel").onclick = $("binNever").onclick = null; };
    $("binDelete").onclick = () => { close(); go(); };
    $("binNever").onclick = () => { BIN.ask = false; saveBin(); syncBinSettings(); close(); go(); };
    $("binCancel").onclick = () => { close(); putBack(); };
    setTimeout(() => $("binDelete").focus(), 30);
  }
  function syncBinSettings() {
    document.querySelectorAll("#binSeg button").forEach((b) => b.classList.toggle("active", (b.dataset.b === "1") === BIN.on));
    document.querySelectorAll("#binAskSeg button").forEach((b) => b.classList.toggle("active", (b.dataset.a === "1") === BIN.ask));
  }
  (function wireBinSettings() {
    document.querySelectorAll("#binSeg button").forEach((b) => b.addEventListener("click", () => { BIN.on = b.dataset.b === "1"; saveBin(); syncBinSettings(); }));
    document.querySelectorAll("#binAskSeg button").forEach((b) => b.addEventListener("click", () => { BIN.ask = b.dataset.a === "1"; saveBin(); syncBinSettings(); }));
    syncBinSettings();
  })();

  /* Alignment while a text is dragged, CapCut's guides: its centre lands on
     the picture's centre lines, its edges on the safe margins (5% in from
     each side), and its centre or edges on another text's. Whatever it
     lands on is drawn as a line (textGuides, drawn by drawPreviewCaptions)
     and the phone ticks once as it lands. x, y and the result are
     fractions of the picture. */
  let textGuides = null, guideKey = "";
  function alignText(key, x, y, box) {
    const me = textHits.get(key);
    const hw = me ? me.w / 2 / box.w : 0, hh = me ? me.h / 2 / box.h : 0;
    const tolX = 7 / box.w, tolY = 7 / box.h;
    const xs = [[0.5, 0.5, "c"]], ys = [[0.5, 0.5, "c"]];   // [where my centre goes, where the line is]
    xs.push([0.05 + hw, 0.05, "m"], [0.95 - hw, 0.95, "m"]);
    ys.push([0.05 + hh, 0.05, "m"], [0.95 - hh, 0.95, "m"]);
    textHits.forEach((h, id) => {
      if (id === key) return;
      const cx = (h.x - box.x) / box.w, cy = (h.y - box.y) / box.h, ow = h.w / 2 / box.w, oh = h.h / 2 / box.h;
      xs.push([cx, cx, "t"], [cx - ow + hw, cx - ow, "t"], [cx + ow - hw, cx + ow, "t"]);
      ys.push([cy, cy, "t"], [cy - oh + hh, cy - oh, "t"], [cy + oh - hh, cy + oh, "t"]);
    });
    const pick = (v, list, tol) => {
      let best = null;
      list.forEach((c) => { const d = Math.abs(c[0] - v); if (d < tol && (!best || d < best.d)) best = { d: d, to: c[0], line: c[1], kind: c[2] }; });
      return best;
    };
    const bx = pick(x, xs, tolX), by = pick(y, ys, tolY);
    textGuides = { v: bx ? [bx.line] : [], h: by ? [by.line] : [] };
    const lines = (bx ? bx.line.toFixed(3) : "") + "|" + (by ? by.line.toFixed(3) : "");
    if (lines !== guideKey && lines !== "|") buzz("light");
    guideKey = lines;
    return { x: bx ? bx.to : x, y: by ? by.to : y };
  }
  /* The overlay on the picture can be held like a text: it is registered
     for touch (in textHits, as "b" + id, under any text) and, when selected,
     wears the same plain frame a selected text does. Preview only. */
  function drawOverlayHandle(ctx, box) {
    const b = brollAt(S.time);
    if (!b || b.mode === "cover") return;
    const g = brollGeom(b, box);
    textHits.set("b" + b.id, { x: g.cx, y: g.cy, w: g.w, h: g.h, rot: g.rot });
    if (!(S.sel && S.sel.type === "broll" && S.sel.id === b.id)) return;
    ctx.save();
    ctx.translate(g.cx, g.cy);
    if (g.rot) ctx.rotate((g.rot * Math.PI) / 180);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-g.w / 2, -g.h / 2, g.w, g.h);
    ctx.fillStyle = "#ffffff";
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => ctx.fillRect(sx * g.w / 2 - 3, sy * g.h / 2 - 3, 6, 6));
    ctx.restore();
  }

  // the guides, over the picture, in the preview only
  function drawTextGuides(ctx, box) {
    if (!textGuides || (!textGuides.v.length && !textGuides.h.length)) return;
    ctx.save();
    ctx.strokeStyle = "#e8c547";
    ctx.lineWidth = 1;
    ctx.beginPath();
    textGuides.v.forEach((fx) => { const x = Math.round(box.x + fx * box.w) + 0.5; ctx.moveTo(x, box.y); ctx.lineTo(x, box.y + box.h); });
    textGuides.h.forEach((fy) => { const y = Math.round(box.y + fy * box.h) + 0.5; ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); });
    ctx.stroke();
    ctx.restore();
  }

  (function textOnPicture() {
    const stage = $("stage");
    const pts = new Map();
    let g = null;   // the gesture: {it, box, x0, y0, size0, rot0, d0, a0}
    const local = (e) => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    /* What a finger can hold on the picture: a text (or sticker), or an
       overlay that isn't full frame. Each says where it sits, how big it is
       and how it turns, so one gesture moves, sizes and turns any of them. */
    function holdable(key) {
      if (typeof key === "string" && key[0] === "b") {
        const b = brollById(+key.slice(1));
        if (!b || b.mode === "cover") return null;
        return {
          key: key, item: b, kind: "broll",
          x: () => (b.x != null ? b.x : 0.5), y: () => (b.y != null ? b.y : BROLL_CY),
          setXY: (x, y) => { b.x = x; b.y = y; },
          size: () => b.scale || BROLL_SIZE, setSize: (v) => { b.scale = clamp(v, 0.08, 1.6); },
          rot: () => b.rot || 0, setRot: (v) => { b.rot = v; }
        };
      }
      const t = textById(key);
      if (!t) return null;
      return {
        key: key, item: t, kind: "text",
        x: () => (t.x != null ? t.x : 0.5), y: () => { if (t.y != null) return t.y; const bx = pictureBox(); return headingLayout(t, bx.w, bx.h).cy / bx.h; },
        setXY: (x, y) => { t.x = x; t.y = y; },
        size: () => t.size, setSize: (v) => { t.size = clamp(v, 10, 220); },
        rot: () => t.rotate || 0, setRot: (v) => { t.rotate = v; }
      };
    }
    function hitAt(p) {
      let text = null, other = null;
      textHits.forEach((h, id) => {
        const r = (-(h.rot || 0) * Math.PI) / 180;
        const dx = p.x - h.x, dy = p.y - h.y;
        const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
        const slop = 10;   // a fingertip's worth of forgiveness
        if (Math.abs(lx) <= h.w / 2 + slop && Math.abs(ly) <= h.h / 2 + slop) {
          if (typeof id === "string") other = id; else text = id;   // texts sit above overlays
        }
      });
      return text != null ? text : other;
    }
    const twoFinger = () => {
      const [a, b] = Array.from(pts.values());
      return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    };
    const startFrom = () => {
      g.p0 = new Map(pts);
      g.size0 = g.it.size();
      g.rot0 = g.it.rot();
      g.x0 = g.it.x();
      g.y0 = g.it.y();
      g.d0 = 0;
      if (pts.size === 2) { const tf = twoFinger(); g.d0 = tf.d; g.a0 = tf.a; g.c0 = tf; }
    };
    stage.addEventListener("pointerdown", (e) => {
      if (inFs() || EXP.active) return;
      // setting a crop: the box takes every touch on the picture
      if (cropEdit) {
        cropPointer(e, stage, (ev) => { const q = local(ev), b = cropEdit.view.box; return { x: q.x - b.x, y: q.y - b.y }; });
        e.stopPropagation();
        textGestureUsed = true;
        return;
      }
      const p = local(e);
      if (!g) {
        const it = holdable(hitAt(p));
        if (!it) return;
        e.preventDefault();
        e.stopPropagation();
        textGestureUsed = true;
        if (S.playing) pause();
        const id = it.item.id;
        if (!(S.sel && S.sel.type === it.kind && S.sel.id === id)) {
          S.sel = { type: it.kind, id: id };
          renderTimeline();
          renderInspector();
          syncOverlays();
        }
        g = { it: it, box: pictureBox(), moved: false, start: { x: it.x(), y: it.y() } };
        guideKey = "";
      }
      pts.set(e.pointerId, p);
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      startFrom();
    }, true);
    stage.addEventListener("pointermove", (e) => {
      if (!g || !pts.has(e.pointerId)) return;
      e.preventDefault();
      pts.set(e.pointerId, local(e));
      const it = g.it, box = g.box;
      if (pts.size >= 2 && g.d0) {
        const tf = twoFinger();
        textGuides = null;   // pinching: size and turn, no alignment lines
        it.setSize(g.size0 * (tf.d / g.d0));
        let rot = g.rot0 + ((tf.a - g.a0) * 180) / Math.PI;
        rot = ((rot + 540) % 360) - 180;
        if (Math.abs(rot) < 4) rot = 0;   // level is easy to land on
        if (rot === 0 && it.rot() !== 0) buzz("light");
        it.setRot(Math.round(rot));
        it.setXY(clamp(g.x0 + (tf.cx - g.c0.cx) / box.w, 0, 1), clamp(g.y0 + (tf.cy - g.c0.cy) / box.h, 0, 1));
      } else {
        const p = pts.get(e.pointerId), p0 = g.p0.get(e.pointerId);
        if (!p0) return;
        const al = alignText(it.key, g.x0 + (p.x - p0.x) / box.w, g.y0 + (p.y - p0.y) / box.h, box);
        it.setXY(clamp(al.x, 0, 1), clamp(al.y, 0, 1));
        // the bin: shown while dragging, "over" when the finger reaches it
        if (BIN.on) {
          binShow(true, box);
          const over = binOver(p, box);
          if (over && binHover !== it.key) buzz("light");
          binHover = over ? it.key : null;
          $("trashBin").classList.toggle("over", over);
          if (over) textGuides = null;
        }
      }
      g.moved = true;
      syncOverlays();
    }, true);
    const end = (e) => {
      if (!g || !pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size) { startFrom(); return; }   // one finger lifted from a pinch: carry on dragging with the other
      const dropped = binHover === g.it.key;
      binHover = null;
      binShow(false);
      if (dropped) {
        // into the bin: put it back where it started if they change their mind
        const it = g.it, x0 = g.start.x, y0 = g.start.y;
        g = null;
        textGuides = null;
        syncOverlays();
        binDrop(it, () => { it.setXY(x0, y0); syncOverlays(); });
        return;
      }
      if (g.moved) {
        commit();
        recordEdit(g.it.kind === "text" ? "text-move" : "overlay-move", {});
        renderInspector();
      }
      g = null;
      textGuides = null;
      syncOverlays();
    };
    stage.addEventListener("pointerup", end, true);
    stage.addEventListener("pointercancel", end, true);
  })();


  $("stage").addEventListener("click", (e) => {
    if (e.target.closest("#stageEmpty")) return; // the add-button handles itself
    // a touch on a text was about the text, not the video
    if (textGestureUsed) { textGestureUsed = false; return; }
    if (!S.clips.length) return;
    if (inFs()) { primeAudio(); if (S.playing) pause(); else play(); }
    else enterFs();
  });

  let seekDragging = false;
  function paintSeek() {
    const sb = $("seekBar");
    const pct = clamp(sb.value / 10, 0, 100); // max=1000 → percent
    sb.style.background =
      "linear-gradient(90deg, var(--acc) 0%, var(--acc) " + pct + "%, var(--seek-rest, var(--bg3)) " + pct + "%, var(--seek-rest, var(--bg3)) 100%)";
  }
  $("seekBar").addEventListener("input", () => {
    seekDragging = true;
    S.time = ($("seekBar").value / 1000) * total();
    paintSeek();
    syncNow();
  });
  $("seekBar").addEventListener("change", () => { seekDragging = false; });

  function syncNow() {
    resetSfxCursor();   // a seek moves the cursor without firing what it passed
    syncMedia();
    syncAudioClips();
    syncOverlays();
    updateTransport();
    updatePlayheadUI();
  }

  /* ═══════════ ADJUST, FLIP AND ROTATE (preview == export) ═══════════
     Adjust is CapCut's: brightness, contrast, saturation, warmth and a
     vignette, per clip. The first three are filters on the picture; warmth
     is a colour laid over it in soft light, and the vignette a darkening
     toward the corners. Each is worked out here once and drawn the same way
     in the preview (CSS) and the export (canvas). */
  const ADJ = [
    ["bright", "Brightness", -100, 100], ["contrast", "Contrast", -100, 100], ["sat", "Saturation", -100, 100],
    ["warmth", "Warmth", -100, 100], ["vignette", "Vignette", 0, 100]
  ];
  function pictureFilter(c, blurPx) {
    const parts = [];
    /* 0.35.0: a filter is a colour table applied on the graphics card after
       the picture is drawn (drawClipPicture → SenotelFilters.apply); only a
       device without WebGL gets the nearest CSS look here instead. */
    const FL = window.SenotelFilters;
    const look = !c.filter || c.filter === "none" ? "none"
      : FL && FL.has(c.filter) ? (FL.gpu() ? "none" : FL.cssOf(c.filter))
      : FILTERS[c.filter] ? FILTERS[c.filter].css : "none";
    if (look !== "none") parts.push(look);
    const a = c.adj;
    if (a) {
      if (a.bright) parts.push("brightness(" + (1 + a.bright / 200).toFixed(3) + ")");
      if (a.contrast) parts.push("contrast(" + (1 + a.contrast / 200).toFixed(3) + ")");
      if (a.sat) parts.push("saturate(" + (1 + a.sat / 100).toFixed(3) + ")");
    }
    if (blurPx) parts.push("blur(" + blurPx.toFixed(1) + "px)");
    return parts.join(" ") || "none";
  }
  // warm: an amber; cool: a blue. At full strength, 55% of it in soft light.
  function warmthOf(c) {
    const w = (c && c.adj && c.adj.warmth) || 0;
    if (!w) return null;
    return { color: w > 0 ? "255,138,36" : "36,120,255", alpha: (Math.abs(w) / 100) * 0.55 };
  }
  function vignetteOf(c) {
    const v = (c && c.adj && c.adj.vignette) || 0;
    return v ? (v / 100) * 0.8 : 0;
  }
  // the same two layers on the export canvas, over the frame f
  function drawAdjustVeils(ctx, c, f) {
    const warm = warmthOf(c), vig = vignetteOf(c);
    if (warm) {
      ctx.save();
      ctx.globalCompositeOperation = "soft-light";
      ctx.fillStyle = "rgba(" + warm.color + "," + warm.alpha + ")";
      ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.restore();
    }
    if (vig) {
      // CSS's "ellipse at center" reaches the corners: radii w/2·√2 and h/2·√2
      ctx.save();
      ctx.translate(f.x + f.w / 2, f.y + f.h / 2);
      ctx.scale(1, f.h / f.w);
      const r = (f.w / 2) * Math.SQRT2;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0.45, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0," + vig + ")");
      ctx.fillStyle = g;
      ctx.fillRect(-f.w / 2, -f.w / 2, f.w, f.w);
      ctx.restore();
    }
  }

  /* Flip and rotate. rot is 0, 90, 180 or 270; flipH mirrors and flipV
     turns upside down, both as seen on screen, after the rotation.
     drawOrientedSrc (renderPicture) draws them. */
  const turned = (c) => !!c && (c.rot === 90 || c.rot === 270);

  /* Keeps the players in time with the playhead. What you SEE is drawn by
     drawPreviewPicture from them (renderPicture), so nothing here styles
     them; #pv is still what you HEAR. */
  function syncMedia() {
    $("stageEmpty").classList.toggle("hidden", S.clips.length > 0);
    const info = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
    if (!info) { pv.pause(); return; }
    const { clip, offset } = info;
    const m = mediaById(clip.mediaId);
    if (!m) return;

    if (m.type === "video") {
      if (pv.dataset.mid !== String(m.id)) {
        pv.src = m.url;
        pv.dataset.mid = String(m.id);
      }
      const target = clip.in + offset * clip.speed;
      // only correct on a real jump (clip boundary), and never while a seek is
      // already in flight — repeated seeks to the same spot cause thrashing
      if (!pv.seeking && Math.abs(pv.currentTime - target) > 0.28) {
        try { pv.currentTime = target; } catch (e) { /* metadata not ready yet */ }
      }
      pv.playbackRate = clip.speed;
      pv.volume = clip.volume;
      pv.muted = clip.muted || (EXP.active ? false : S.userMuted);
      if (S.playing && pv.paused) pv.play().catch(() => {});
      if (!S.playing && !pv.paused) pv.pause();
    } else {
      pv.pause();
      if (pi.dataset.mid !== String(m.id)) {
        pi.src = m.url;
        pi.dataset.mid = String(m.id);
      }
    }
  }


  /* ═══════════ HEADING GEOMETRY (preview == export) ═══════════
     One source of truth for how large a heading is and where it sits. The
     preview and the export renderer used to work this out separately — the
     preview against the STAGE box, the export against the canvas with an
     extra 1.55× — so the same heading changed size between the window,
     fullscreen, and the finished file.

     Everything below is a fraction of the FRAME the picture occupies, never
     of the container it floats in. That is the actual fix for fullscreen:
     the stage grows to fill the screen, but the letterboxed picture inside
     it does not grow nearly as much, so a heading measured against the stage
     ballooned away from the video. Measured against the picture, it holds. */
  const HEADING_REF_H = 420;   // the frame height t.size was authored against
  const HEADING_SCALE = 1;     // single dial for overall heading size
  const HEADING_LINE = 1.15;   // line height, must equal .overlay-text's
  const HEADING_FONT = '"Anton", "Arial Narrow", Impact, sans-serif';

  function headingLayout(t, frameW, frameH) {
    const size = (t.size / HEADING_REF_H) * frameH * HEADING_SCALE;
    const boxW = frameW * 0.9;
    return {
      size: size,
      lineH: size * HEADING_LINE,
      // centre of the text block: where it was dragged to, else its top / centre / bottom place
      cx: frameW * (t.x != null ? t.x : 0.5),
      cy: t.y != null ? frameH * t.y : t.pos === "top" ? frameH * 0.14 : t.pos === "center" ? frameH * 0.5 : frameH * 0.86,
      // the box is a FIXED share of the frame, given to the DOM as an explicit
      // width and to the canvas as the wrap limit. Both therefore break lines
      // at the same place, and the ratio of text width to box width no longer
      // changes between the preview and fullscreen.
      x: (frameW - boxW) / 2,
      maxW: boxW
    };
  }

  /* Break a heading into lines exactly the way the DOM box does: greedy words,
     honouring any explicit newlines. ctx.font must already be set. Canvas has
     no wrapping of its own — fillText's maxWidth argument CONDENSES the glyphs
     instead, which is why an export could look squashed where the preview
     wrapped. */
  function wrapHeading(ctx, text, maxW) {
    const out = [];
    String(text).split("\n").forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      let line = "";
      words.forEach((w) => {
        const test = line ? line + " " + w : w;
        if (line && ctx.measureText(test).width > maxW) { out.push(line); line = w; }
        else line = test;
      });
      out.push(line);
    });
    return out.length ? out : [""];
  }

  /* ═══════════ TEXT: everything about how a heading looks ═══════════
     Every control in the text panel ends up here. drawHeading() draws a
     heading in the preview (on the caption canvas, inside the picture) and
     in the export, so the two cannot disagree. Every length is a fraction of
     the text size, so a look holds at any frame size.
     A text that never had a font chosen keeps the look headings always had
     (Anton with a soft shadow); a new one starts in TEXT_NEW_FONT. Text
     fonts come from fonts.js's text library, never the caption one. */
  const TEXT_NEW_FONT = "Outfit";
  const TEXT_LOOK = {
    font: "Anton", weight: 400, italic: false, upper: false, align: "center",
    spacing: 0, lineH: HEADING_LINE, opacity: 1,
    strokeColor: "#000000", strokeW: 0,
    shadow: true, shColor: "#000000", shOpacity: 0.8, shBlur: 0.22, shDist: 0, shAngle: 45,
    boxOn: false, boxColor: "#000000", boxOpacity: 0.75, boxRadius: 0.25,
    glowOn: false, glowColor: "#00e5ff", glowSize: 0.6,
    curve: 0, rotate: 0
  };
  function textLook(t) {
    const o = Object.assign({}, TEXT_LOOK);
    Object.keys(TEXT_LOOK).forEach((k) => { if (t[k] != null) o[k] = t[k]; });
    return o;
  }
  function rgba(hex, a) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    const n = m ? parseInt(m[1], 16) : 0;
    return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + clamp(a, 0, 1) + ")";
  }
  // The CSS font for a text, with its weight snapped to one the family has
  function textFontCss(t, px, wantWeight, fallback) {
    if (!t.font) return wantWeight + " " + px + "px " + fallback;
    const k = textLook(t), SF = window.SenotelFonts;
    const w = SF ? SF.pick(k.font, wantWeight || k.weight) : (wantWeight || k.weight);
    if (SF && !SF.ready(k.font, w, k.italic)) SF.load(k.font, w, k.italic);
    return (k.italic ? "italic " : "") + w + " " + px + "px \"" + k.font + "\", " + fallback;
  }

  // where each heading was last drawn in the preview, so it can be dragged
  const textHits = new Map();
  // a text font arrives after the first draw (in the fallback): draw again in it
  if (window.SenotelFonts) window.SenotelFonts.onLoad(() => { try { syncOverlays(); } catch (e) {} });

  function drawHeading(ctx, t, f, hits, time) {
    if (t.sticker === "shape") { drawShapeHeading(ctx, t, f, hits, time); return; }
    const A = textAnimAt(t, time);
    const L = headingLayout(t, f.w, f.h), k = textLook(t);
    const size = L.size;
    ctx.save();
    ctx.font = t.font ? textFontCss(t, size, k.weight, '"Noto Sans", system-ui, sans-serif') : "400 " + size + "px " + HEADING_FONT;
    const sp = k.spacing * size;
    const nativeLS = "letterSpacing" in ctx;
    if (nativeLS) ctx.letterSpacing = sp + "px";
    const text = k.upper ? String(t.text).toLocaleUpperCase() : String(t.text);
    const lines = wrapHeading(ctx, text, L.maxW);
    const lineH = size * k.lineH;
    const widths = lines.map((l) => ctx.measureText(l).width + (nativeLS ? 0 : sp * Math.max(0, l.length - 1)));
    const blockW = Math.max(1, ...widths), blockH = lines.length * lineH;
    const pad = size * 0.32;
    const bend = (k.curve / 100) * Math.PI;   // the arc a line spans: 100 = half a circle
    const sag = bend ? (blockW / Math.abs(bend)) * (1 - Math.cos(Math.abs(bend) / 2)) : 0;

    ctx.translate(f.x + L.cx, f.y + L.cy);
    // where it rests, for grabbing it on the picture (the animation doesn't move the target)
    if (hits) hits.set(t.id, { x: f.x + L.cx, y: f.y + L.cy, w: blockW + pad * 2, h: blockH + pad * 2 + sag, rot: k.rotate });
    if (A.dx || A.dy) ctx.translate(A.dx * size, A.dy * size);
    if (k.rotate || A.r) ctx.rotate(((k.rotate + A.r) * Math.PI) / 180);
    if (A.s !== 1 || A.sx !== 1 || A.sy !== 1) ctx.scale(A.s * A.sx, A.s * A.sy);
    if (A.kx) ctx.transform(1, 0, A.kx, 1, 0, 0);
    ctx.globalAlpha *= clamp(k.opacity * A.a, 0, 1);
    // shadows are in device pixels and ignore the transform; scale them by hand
    const m = ctx.getTransform ? ctx.getTransform() : { a: 1, b: 0 };
    const px = Math.hypot(m.a, m.b) || 1;
    const canBlur = "filter" in ctx;
    if (A.blur > 0.005 && canBlur) ctx.filter = "blur(" + (A.blur * size * px / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1)).toFixed(1) + "px)";
    // a wipe uncovers the text from one side (or the middle)
    if (A.wipe && A.wipe.f < 1) {
      const wx = -blockW / 2 - pad, wy = -blockH / 2 - pad - sag, ww = blockW + pad * 2, wh = blockH + pad * 2 + sag * 2;
      const f = clamp(A.wipe.f, 0, 1);
      ctx.beginPath();
      if (A.wipe.dir === "y") ctx.rect(wx, wy + wh * (1 - f), ww, wh * f);
      else if (A.wipe.dir === "c") ctx.rect(-ww * f / 2, wy, ww * f, wh);
      else ctx.rect(wx, wy, ww * f, wh);
      ctx.clip();
    }

    if (k.boxOn) {
      const bw = blockW + pad * 2, bh = blockH + pad * 1.2 + sag;
      const bx = k.align === "left" ? -blockW / 2 - pad : k.align === "right" ? -blockW / 2 - pad : -bw / 2;
      ctx.fillStyle = rgba(k.boxColor, k.boxOpacity);
      roundRectPath(ctx, bx, -bh / 2 - (bend > 0 ? sag / 2 : bend < 0 ? -sag / 2 : 0), bw, bh, Math.min(bh / 2, size * k.boxRadius));
      ctx.fill();
    }

    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const xFor = (w) => (k.align === "left" ? -blockW / 2 : k.align === "right" ? blockW / 2 - w : -w / 2);
    /* Letter-by-letter animations need every letter's number in the whole
       text and the number of its word, across the line breaks. */
    const lineChars = lines.map((l) => Array.from(l));
    const allChars = lineChars.reduce((n, cs) => n + cs.length, 0);
    const wordOf = [];
    let words = 0;
    lineChars.forEach((cs) => {
      let inWord = false;
      cs.forEach((c) => {
        if (/\s/.test(c)) { inWord = false; wordOf.push(Math.max(0, words - 1)); return; }
        if (!inWord) { words++; inWord = true; }
        wordOf.push(words - 1);
      });
    });
    const each = A.letter || null;
    const TAL = TA();
    // draws one letter at (x, y) with what its animation says for it
    function letterAt(c, x, y, gi, draw) {
      if (!each) { draw(c, x, y); return; }
      const q = TAL ? TAL.base() : { a: 1, dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, kx: 0, blur: 0 };
      each(q, gi, allChars, wordOf[gi] || 0, Math.max(1, words));
      if (q.a <= 0.003) return;
      ctx.save();
      ctx.translate(x + q.dx * size, y + q.dy * size);
      if (q.r) ctx.rotate((q.r * Math.PI) / 180);
      if (q.s !== 1 || q.sx !== 1 || q.sy !== 1) ctx.scale(q.s * q.sx, q.s * q.sy);
      if (q.kx) ctx.transform(1, 0, q.kx, 1, 0, 0);
      if (q.a < 1) ctx.globalAlpha *= q.a;
      if (q.blur > 0.005 && canBlur) ctx.filter = "blur(" + (q.blur * size * px / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1)).toFixed(1) + "px)";
      draw(c, 0, 0);
      ctx.restore();
    }
    // one line, straight or bent, letter by letter when the spacing, the curve or an animation needs it
    function line(str, y, w, op, g0) {
      const draw = (s, x, yy) => (op === "stroke" ? ctx.strokeText(s, x, yy) : ctx.fillText(s, x, yy));
      if (!bend && !each && (nativeLS || !sp)) { ctx.textAlign = "left"; draw(str, xFor(w), y); return; }
      const chars = Array.from(str);
      const cw = chars.map((c) => ctx.measureText(c).width + (nativeLS ? 0 : sp));
      ctx.textAlign = "center";
      if (!bend) {
        let x = xFor(w);
        chars.forEach((c, i) => { letterAt(c, x + cw[i] / 2, y, g0 + i, draw); x += cw[i]; });
        return;
      }
      const R = w / Math.abs(bend), up = bend > 0;
      let run = 0;
      chars.forEach((c, i) => {
        const th = (run + cw[i] / 2) / w * Math.abs(bend) - Math.abs(bend) / 2;
        run += cw[i];
        ctx.save();
        if (up) { ctx.translate(R * Math.sin(th), y + R - R * Math.cos(th)); ctx.rotate(th); }
        else { ctx.translate(R * Math.sin(th), y - R + R * Math.cos(th)); ctx.rotate(-th); }
        letterAt(c, 0, 0, g0 + i, draw);
        ctx.restore();
      });
    }
    // the typewriter shows the first so many letters, each line where it will end up
    const showN = A.chars >= 1 ? Infinity : Math.floor(A.chars * allChars);
    function all(op) {
      let left = showN, g0 = 0;
      lines.forEach((l, i) => {
        const cs = lineChars[i];
        if (left > 0) {
          const part = left >= cs.length ? l : cs.slice(0, left).join("");
          line(part, -blockH / 2 + lineH / 2 + i * lineH - (bend > 0 ? sag / 2 : bend < 0 ? -sag / 2 : 0), widths[i], op, g0);
        }
        left -= cs.length;
        g0 += cs.length;
      });
    }
    const stroked = k.strokeW > 0;
    ctx.strokeStyle = k.strokeColor;
    ctx.lineWidth = k.strokeW * size * 2;   // half of it is hidden under the fill
    ctx.fillStyle = t.color || "#ffffff";

    if (k.glowOn) {
      ctx.save();
      ctx.shadowColor = k.glowColor;
      ctx.shadowBlur = k.glowSize * size * px;
      ctx.fillStyle = k.glowColor;
      all("fill"); all("fill");
      ctx.restore();
    }
    if (k.shadow && k.shOpacity > 0) {
      ctx.save();
      const a = (k.shAngle * Math.PI) / 180;
      ctx.shadowColor = rgba(k.shColor, k.shOpacity);
      ctx.shadowBlur = k.shBlur * size * px;
      ctx.shadowOffsetX = Math.cos(a) * k.shDist * size * px;
      ctx.shadowOffsetY = Math.sin(a) * k.shDist * size * px;
      all(stroked ? "stroke" : "fill");
      ctx.restore();
    }
    if (stroked) all("stroke");
    all("fill");

    // the selected text wears a plain frame in the preview (never in the export)
    if (hits && S.sel && S.sel.type === "text" && S.sel.id === t.id) {
      const fw = blockW + pad * 2, fh = blockH + pad * 2 + sag;
      ctx.globalAlpha = 1;
      if (canBlur) ctx.filter = "none";
      ctx.shadowColor = "transparent";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 / (px / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1));
      ctx.strokeRect(-fw / 2, -fh / 2, fw, fh);
      const hs = ctx.lineWidth * 4;
      ctx.fillStyle = "#ffffff";
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => ctx.fillRect(sx * fw / 2 - hs / 2, sy * fh / 2 - hs / 2, hs, hs));
    }
    ctx.restore();
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Every text showing at `time`, in layer order: lower thirds and cards,
     then headings. The preview and the export both call this. */
  function drawTexts(ctx, f, time, hits) {
    const karaoke = S.captions && S.captions.length > 0;
    const on = S.texts.filter((t) => time >= t.start && time <= t.start + t.dur);
    on.forEach((t) => { if (textStyleOf(t) !== "heading") drawStyledText(ctx, t, f, time); });
    if (hits) hits.clear();
    on.forEach((t) => {
      if (textStyleOf(t) !== "heading") return;
      if (karaoke && t.cap) return;   // word-timed captions own the caption layer: no doubling
      // over the bin: drawn faded, as if already going in
      if (binHover === t.id) { ctx.save(); ctx.globalAlpha *= 0.35; drawHeading(ctx, t, f, hits, time); ctx.restore(); }
      else drawHeading(ctx, t, f, hits, time);
    });
  }

  /* ─── Text animations (CapCut's In, Out and Loop) ───
     The library is text-anims.js; drawHeading applies what it says for each
     frame, so the preview and the export run them identically. */
  let textTab = "text";
  let animKind = "in";   // which list the Animation tab shows
  const TA = () => window.SenotelTextAnims || null;
  function textAnimAt(t, time) {
    const lib = TA();
    if (!lib) return { a: 1, dx: 0, dy: 0, s: 1, sx: 1, sy: 1, r: 0, kx: 0, blur: 0, chars: 1 };
    return lib.at(t, time);
  }

  /* The Animation tab's tiles: each plays its animation on the selected
     text's own look (font, colours, outline...), over and over, until the
     tab closes. In: arrives, holds. Out: holds, leaves, gap. Loop: runs. */
  let animTilesRaf = 0;
  function animateAnimTiles(t, kind) {
    cancelAnimationFrame(animTilesRaf);
    const t0 = performance.now();
    let last = 0;
    const loop = (now) => {
      const tiles = document.querySelectorAll("#inspector .anim-tile canvas");
      if (!tiles.length) { animTilesRaf = 0; return; }
      animTilesRaf = requestAnimationFrame(loop);
      if (now - last < 33) return;   // 30 frames a second is plenty for a thumbnail
      last = now;
      const ph = (now - t0) / 1000;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      tiles.forEach((cv) => {
        const w = cv.clientWidth || 72, h = cv.clientHeight || 44;
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        const ctx = cv.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#2a2b29";
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const id = cv.dataset.anim;
        const sample = Object.assign({}, t, { id: -2, text: "Text", x: 0.5, y: 0.5, rotate: 0, curve: 0, align: "center",
          size: (17 / h) * HEADING_REF_H, animIn: null, animOut: null, animLoop: null });
        let time;
        if (kind === "in") {
          const len = TA().lengthFor(id);
          Object.assign(sample, { animIn: id, animInLen: len, start: 0, dur: 100 });
          time = ph % (len + 1.1);
        } else if (kind === "out") {
          const len = TA().lengthFor(id), P = len + 1.2;
          Object.assign(sample, { animOut: id, animOutLen: len, start: -100, dur: 100.5 + len });
          time = ph % P;
          if (time > 0.5 + len) return;   // gone: the gap before it plays again
        } else {
          Object.assign(sample, { animLoop: id, animLoopSpeed: t.animLoopSpeed || 1, start: 0, dur: 100 });
          time = ph;
        }
        drawHeading(ctx, sample, { x: 0, y: 0, w: w, h: h }, null, time);
      });
    };
    animTilesRaf = requestAnimationFrame(loop);
  }

  // plays the part of the text an animation just changed, then stops
  function previewTextAnim(t, which) {
    if (S.playing) return;
    const len = Math.min((which === "out" ? t.animOutLen : t.animInLen) || t.animLen || 0.5, t.dur);
    S.time = clamp(which === "out" ? t.start + t.dur - len - 0.3 : t.start, 0, total());
    syncNow();
    play();
    clearTimeout(previewTextAnim.timer);
    previewTextAnim.timer = setTimeout(() => { if (S.playing) pause(); }, (len + 0.6) * 1000);
  }

  /* ═══════════ CLIP PANEL: animation, transition, crop ═══════════ */
  let clipTab = "edit", clipAnimKind = "in", transCat = "Basic";

  // the small previews redraw ~30 times a second while they are on screen
  let tileLoopRaf = 0;
  function runTiles(selector, draw) {
    cancelAnimationFrame(tileLoopRaf);
    const t0 = performance.now();
    let last = 0;
    const loop = (now) => {
      const tiles = document.querySelectorAll(selector);
      if (!tiles.length) { tileLoopRaf = 0; return; }
      tileLoopRaf = requestAnimationFrame(loop);
      if (now - last < 33) return;
      last = now;
      const ph = (now - t0) / 1000, dpr = Math.min(2, window.devicePixelRatio || 1);
      tiles.forEach((cv) => {
        const w = cv.clientWidth || 72, h = cv.clientHeight || 44;
        if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
        const ctx = cv.getContext("2d");
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        draw(cv, ctx, cv.width, cv.height, ph);
      });
    };
    tileLoopRaf = requestAnimationFrame(loop);
  }
  // a still of a clip for its previews: a frame from its middle
  const thumbImgs = new Map();
  function thumbImage(url) {
    if (!url) return null;
    let im = thumbImgs.get(url);
    if (!im) { im = new Image(); im.src = url; thumbImgs.set(url, im); }
    return im.complete && im.naturalWidth ? im : null;
  }
  function clipThumb(c) {
    const m = c && mediaById(c.mediaId);
    if (!m) return null;
    return thumbImage(m.type === "video" ? frameAt(m, c.in + (c.out - c.in) / 2) : m.url);
  }
  function coverInto(ctx, img, w, h, fallback) {
    ctx.fillStyle = fallback || "#2a2b29";
    ctx.fillRect(0, 0, w, h);
    if (!img) return;
    const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight), dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  // plays the stretch of the timeline something new happens in, then stops
  function previewSpan(from, len) {
    if (S.playing) return;
    S.time = clamp(from, 0, total());
    syncNow();
    play();
    clearTimeout(previewSpan.timer);
    previewSpan.timer = setTimeout(() => { if (S.playing) pause(); }, (len + 0.4) * 1000);
  }

  // A clip animation tile: the clip's own still, doing the animation
  function applyAnimTransform(ctx, a, W, H) {
    if (!a) return;
    ctx.translate(W / 2 + a.dx * W * 0.5, H / 2 + a.dy * H * 0.5);
    if (a.r) ctx.rotate((a.r * Math.PI) / 180);
    ctx.scale(a.s * a.sx, a.s * a.sy);
    if (a.kx) ctx.transform(1, 0, a.kx, 1, 0, 0);
    ctx.translate(-W / 2, -H / 2);
    ctx.globalAlpha *= clamp(a.a, 0, 1);
    if (a.wipe && a.wipe.f < 1) {
      const f = clamp(a.wipe.f, 0, 1);
      ctx.beginPath();
      if (a.wipe.dir === "y") ctx.rect(0, H * (1 - f), W, H * f);
      else if (a.wipe.dir === "c") ctx.rect(W * (1 - f) / 2, 0, W * f, H);
      else ctx.rect(0, 0, W * f, H);
      ctx.clip();
    }
  }

  function clipAnimPanel(ins, c, redo) {
    const L = clipAnimLists(), lib = TA();
    if (!L) return;
    const KIND = { in: ["animIn", L.IN], out: ["animOut", L.OUT], loop: ["animLoop", L.LOOP] };
    const sub = mk("div", "ins-seg anim-kinds");
    [["in", "In"], ["out", "Out"], ["loop", "Loop"]].forEach(([key, label]) => {
      const b = mk("button", clipAnimKind === key ? "active" : "", label + (c[KIND[key][0]] ? " •" : ""));
      b.type = "button";
      b.addEventListener("click", () => { clipAnimKind = key; renderInspector(); });
      sub.appendChild(b);
    });
    ins.appendChild(sub);
    const [field, list] = KIND[clipAnimKind];
    const grid = mk("div", "anim-grid");
    [["none", "None"]].concat(list).forEach(([id, label]) => {
      const b = mk("button", "anim-tile" + ((c[field] || "none") === id ? " selected" : ""));
      b.type = "button";
      b.title = label;
      if (id !== "none") { const cv = document.createElement("canvas"); cv.dataset.canim = id; b.appendChild(cv); }
      else b.appendChild(mk("span", "anim-none", "None"));
      b.appendChild(mk("span", "anim-name", label));
      b.addEventListener("click", () => {
        if (id === "none") delete c[field];
        else {
          c[field] = id;
          const lenKey = clipAnimKind === "in" ? "animInLen" : "animOutLen";
          if (clipAnimKind !== "loop" && !c[lenKey + "Set"]) c[lenKey] = 0.6;
        }
        redo();
        const st = clipStartOf(c), d = dispDur(c);
        if (id !== "none") previewSpan(clipAnimKind === "out" ? st + d - (c.animOutLen || 0.6) - 0.3 : st, clipAnimKind === "loop" ? 2 : (c.animInLen || 0.6) + 0.4);
      });
      grid.appendChild(b);
    });
    ins.appendChild(grid);
    if (clipAnimKind !== "loop") {
      const lenKey = clipAnimKind === "in" ? "animInLen" : "animOutLen";
      const d = dispDur(c), max = Math.max(0.2, Math.min(5, c.animIn && c.animOut ? d / 2 : d));
      ins.appendChild(group(clipAnimKind === "in" ? "In length" : "Out length", slider(0.1, max, 0.05, clamp(c[lenKey] || 0.6, 0.1, max),
        (v) => { c[lenKey] = v; c[lenKey + "Set"] = true; syncOverlays(); }, () => commit(), (v) => v.toFixed(2) + "s")));
    } else {
      ins.appendChild(group("Loop speed", slider(0.25, 3, 0.05, c.animLoopSpeed || 1,
        (v) => { c.animLoopSpeed = v; syncOverlays(); }, () => commit(), (v) => v.toFixed(2) + "×")));
    }
    runTiles("#inspector canvas[data-canim]", (cv, ctx, w, h, ph) => {
      const id = cv.dataset.canim, img = clipThumb(c);
      const sample = { start: 0, dur: 100, animIn: null, animOut: null, animLoop: null };
      let time = ph;
      if (clipAnimKind === "in") { Object.assign(sample, { animIn: id, animInLen: 0.6 }); time = ph % 1.8; }
      else if (clipAnimKind === "out") { Object.assign(sample, { animOut: id, animOutLen: 0.6, start: -100, dur: 101.1 }); time = ph % 1.9; }
      else Object.assign(sample, { animLoop: id });
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      if (clipAnimKind === "out" && time > 1.1) return;
      ctx.save();
      applyAnimTransform(ctx, lib.at(sample, time), w, h);
      coverInto(ctx, img, w, h, "#3a3b38");
      ctx.restore();
    });
  }

  // CapCut's transitions: groups, moving previews of these two clips, a length, and "every cut"
  const OLD_TRANS = { fade: "black", flash: "white", zoom: "zoom-in", whip: "whip-left" };
  function transitionPanel(ins, c, prev, redo) {
    const FX = window.SenotelFX;
    if (!FX) return;
    const cur = OLD_TRANS[c.tIn] || c.tIn || "none";
    const cats = mk("div", "filter-chips");
    FX.TRANSITIONS.forEach(([cat]) => {
      const b = mk("button", "fchip" + (transCat === cat ? " active" : ""), cat);
      b.type = "button";
      b.addEventListener("click", () => { transCat = cat; renderInspector(); });
      cats.appendChild(b);
    });
    ins.appendChild(cats);
    const grp = FX.TRANSITIONS.find((g) => g[0] === transCat) || FX.TRANSITIONS[0];
    const grid = mk("div", "anim-grid");
    [["none", "None"]].concat(grp[1]).forEach(([id, label]) => {
      const b = mk("button", "anim-tile" + (cur === id ? " selected" : ""));
      b.type = "button";
      b.title = label;
      if (id !== "none") { const cv = document.createElement("canvas"); cv.dataset.trans = id; b.appendChild(cv); }
      else b.appendChild(mk("span", "anim-none", "None"));
      b.appendChild(mk("span", "anim-name", label));
      b.addEventListener("click", () => {
        if (id === "none") delete c.tIn; else c.tIn = id;
        redo();
        if (id !== "none") { const d = transDur(c); previewSpan(clipStartOf(c) - d / 2 - 0.4, d + 0.8); }
      });
      grid.appendChild(b);
    });
    ins.appendChild(grid);
    if (c.tIn) {
      const max = Math.max(0.2, Math.min(3, 2 * Math.min(dispDur(prev), dispDur(c))));
      ins.appendChild(group("Length", slider(0.1, max, 0.05, Math.min(transDur(c), max),
        (v) => { c.tDur = v; syncOverlays(); },
        () => { commit(); previewSpan(clipStartOf(c) - transDur(c) / 2 - 0.4, transDur(c) + 0.8); }, (v) => v.toFixed(2) + "s")));
      // ccl1: the sound blends across the transition too, unless switched off
      ins.appendChild(group("Blend sound", chipsRow([[true, "On"], [false, "Off"]], c.tAudio !== false, (v) => { if (v) delete c.tAudio; else c.tAudio = false; }, redo)));
      const all = mk("button", "fchip", "Use on every cut");
      all.addEventListener("click", () => {
        S.clips.forEach((x, i) => { if (i > 0) { x.tIn = c.tIn; if (c.tDur != null) x.tDur = c.tDur; else delete x.tDur; if (c.tAudio === false) x.tAudio = false; else delete x.tAudio; } });
        commit(); renderTimeline(); toast(FX.nameOf(c.tIn) + " is on every cut now");
      });
      ins.appendChild(group("", all));
    }
    runTiles("#inspector canvas[data-trans]", (cv, ctx, w, h, ph) => {
      const A = FX.scratch("tileA", w, h), B = FX.scratch("tileB", w, h);
      coverInto(A.getContext("2d"), clipThumb(prev), w, h, "#4a3d2c");
      coverInto(B.getContext("2d"), clipThumb(c), w, h, "#2c3d4a");
      const q = ph % 2.2, p = clamp((q - 0.5) / 1.1, 0, 1);
      FX.transition(cv.dataset.trans, ctx, A, B, p, w, h);
    });
  }

  /* ─── Crop (CapCut's Crop) ───
     Opens on the picture: the whole of the clip's footage with the kept part
     in a frame. Drag inside to move it, a corner to size it, in a fixed
     shape if one is picked. clip.crop holds the kept part as fractions of
     the footage; renderPicture draws only that, filling the frame. */
  const CROP_RATIOS = [[null, "Free"], [9 / 16, "9:16"], [1, "1:1"], [4 / 5, "4:5"], [3 / 4, "3:4"], [16 / 9, "16:9"]];
  function cropSrcSize(c) {
    const m = mediaById(c.mediaId);
    return m && m.w && m.h ? { w: m.w, h: m.h } : null;
  }
  function startCrop(c) {
    const st = clipStartOf(c);
    if (!(S.time >= st && S.time < st + dispDur(c))) S.time = st + Math.min(0.2, dispDur(c) / 2);
    if (S.playing) pause();
    cropEdit = { clip: c, rect: Object.assign({ x: 0, y: 0, w: 1, h: 1 }, c.crop || {}), ratio: c.cropRatio || null, map: null };
    renderInspector();
    syncNow();
  }
  function endCrop(keep) {
    const ce = cropEdit;
    cropEdit = null;
    if (keep && ce) {
      const r = ce.rect;
      if (r.w > 0.995 && r.h > 0.995) { delete ce.clip.crop; delete ce.clip.cropRatio; }
      else {
        ce.clip.crop = { x: r.x, y: r.y, w: r.w, h: r.h };
        if (ce.ratio) ce.clip.cropRatio = ce.ratio; else delete ce.clip.cropRatio;
      }
      commit();
      recordEdit("crop", { kept: Math.round(r.w * r.h * 100) });
    }
    renderInspector();
    syncNow();
  }
  // the largest box of that shape around the current one's centre
  function setCropRatio(ratio) {
    cropEdit.ratio = ratio;
    const src = cropSrcSize(cropEdit.clip);
    if (ratio && src) {
      const r = cropEdit.rect, cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      let wpx = src.w, hpx = wpx / ratio;
      if (hpx > src.h) { hpx = src.h; wpx = hpx * ratio; }
      const w = wpx / src.w, h = hpx / src.h;
      cropEdit.rect = { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w: w, h: h };
    }
    syncOverlays();
  }
  function drawCropEditor(ctx, W, H) {
    const ce = cropEdit, c = ce.clip;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const st = clipStartOf(c);
    const src = previewSrc(c, srcTimeAt(c, st, clamp(S.time, st, st + dispDur(c) - 0.01)));
    if (!src) return;
    const pad = Math.round(Math.min(W, H) * 0.05);
    const sc = Math.min((W - pad * 2) / src.w, (H - pad * 2) / src.h), dw = src.w * sc, dh = src.h * sc;
    const ox = (W - dw) / 2, oy = (H - dh) / 2;
    try { ctx.drawImage(src.el, ox, oy, dw, dh); } catch (e) {}
    const r = ce.rect, rx = ox + r.x * dw, ry = oy + r.y * dh, rw = r.w * dw, rh = r.h * dh;
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.beginPath();
    ctx.rect(ox, oy, dw, dh);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill("evenodd");
    const lw = Math.max(1, W / 400);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) { ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); }
    ctx.stroke();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lw * 2;
    ctx.strokeRect(rx, ry, rw, rh);
    const k = Math.min(W, H) * 0.06;
    ctx.lineWidth = lw * 4;
    [[rx, ry, 1, 1], [rx + rw, ry, -1, 1], [rx, ry + rh, 1, -1], [rx + rw, ry + rh, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.beginPath(); ctx.moveTo(x + sx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * k); ctx.stroke();
    });
    ce.map = { ox: ox, oy: oy, dw: dw, dh: dh };
  }
  // dragging the crop box on the picture: inside moves it, near a corner sizes it
  function cropPointer(e, stage, pictureXY) {
    const ce = cropEdit;
    if (!ce || !ce.map || !ce.view) return false;
    const p = pictureXY(e), dpr = ce.view.dpr, mp = ce.map;
    const fx = (p.x * dpr - mp.ox) / mp.dw, fy = (p.y * dpr - mp.oy) / mp.dh;
    const r = Object.assign({}, ce.rect);
    const near = 26 * dpr / Math.min(mp.dw, mp.dh);
    const corners = [["tl", r.x, r.y], ["tr", r.x + r.w, r.y], ["bl", r.x, r.y + r.h], ["br", r.x + r.w, r.y + r.h]];
    let mode = null;
    corners.forEach(([k, x, y]) => { if (!mode && Math.abs(fx - x) < near && Math.abs(fy - y) < near) mode = k; });
    if (!mode && fx > r.x && fx < r.x + r.w && fy > r.y && fy < r.y + r.h) mode = "move";
    if (!mode) return false;
    e.preventDefault();
    e.stopPropagation();
    const src = cropSrcSize(ce.clip) || { w: 16, h: 9 };
    const id = e.pointerId, r0 = r, f0 = { x: fx, y: fy };
    try { stage.setPointerCapture(id); } catch (err) {}
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const q = pictureXY(ev);
      const gx = (q.x * dpr - mp.ox) / mp.dw, gy = (q.y * dpr - mp.oy) / mp.dh;
      const dx = gx - f0.x, dy = gy - f0.y, MIN = 0.08;
      let n;
      if (mode === "move") n = { x: clamp(r0.x + dx, 0, 1 - r0.w), y: clamp(r0.y + dy, 0, 1 - r0.h), w: r0.w, h: r0.h };
      else {
        let x0 = r0.x, y0 = r0.y, x1 = r0.x + r0.w, y1 = r0.y + r0.h;
        if (mode[1] === "l") x0 = clamp(r0.x + dx, 0, x1 - MIN); else x1 = clamp(r0.x + r0.w + dx, x0 + MIN, 1);
        if (mode[0] === "t") y0 = clamp(r0.y + dy, 0, y1 - MIN); else y1 = clamp(r0.y + r0.h + dy, y0 + MIN, 1);
        n = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        if (ce.ratio) {
          // keep the shape: the height follows the width, inside the footage
          let h = (n.w * src.w / ce.ratio) / src.h;
          if (mode[0] === "t") { if (y1 - h < 0) { h = y1; n.w = h * src.h * ce.ratio / src.w; if (mode[1] === "l") n.x = x1 - n.w; } n.y = y1 - h; }
          else { if (y0 + h > 1) { h = 1 - y0; n.w = h * src.h * ce.ratio / src.w; if (mode[1] === "l") n.x = x1 - n.w; } }
          n.h = h;
        }
      }
      ce.rect = n;
      syncOverlays();
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
      stage.removeEventListener("pointermove", move, true);
      stage.removeEventListener("pointerup", up, true);
      stage.removeEventListener("pointercancel", up, true);
    };
    stage.addEventListener("pointermove", move, true);
    stage.addEventListener("pointerup", up, true);
    stage.addEventListener("pointercancel", up, true);
    textGestureUsed = true;
    return true;
  }

  /* ═══════════ EFFECTS LANE (fx-library.js) ═══════════
     CapCut's video effects: each is a clip on its own lane, over everything
     under it, moved and trimmed like an overlay. {id, type, start, dur,
     amount}. renderPicture lays them over the picture in the preview and
     the export alike. */
  let fxCat = "Basic";
  function renderEffectTrack(et) {
    const FX = window.SenotelFX;
    S.effects.forEach((e) => {
      const on = S.sel && S.sel.type === "effect" && S.sel.id === e.id;
      const el = mk("div", "eclip" + (on ? " sel" : ""));
      el.dataset.id = String(e.id);
      el.style.left = e.start * S.pps + "px";
      el.style.width = Math.max(e.dur * S.pps, 26) + "px";
      el.appendChild(mk("span", "ename", ""));
      el.firstChild.textContent = FX ? FX.nameOf(e.type) : e.type;
      if (on) {
        const hl = mk("div", "handle hl"), hr = mk("div", "handle hr");
        el.appendChild(hl);
        el.appendChild(hr);
        hl.addEventListener("pointerdown", (ev) => startOverlayTrim(ev, e, "l", el));
        hr.addEventListener("pointerdown", (ev) => startOverlayTrim(ev, e, "r", el));
      }
      el.addEventListener("pointerdown", (ev) => {
        if (ev.target.classList.contains("handle")) return;
        holdToDrag(ev, (x) => startFreeDrag(x, e, "effect", el));
      });
      et.appendChild(el);
    });
  }
  function openEffects(replace) {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    fxReplace = replace || null;
    renderEffectSheet();
    openSheet("effectSheet");
  }
  let fxReplace = null;   // an effect being changed rather than a new one added
  function renderEffectSheet() {
    const FX = window.SenotelFX;
    if (!FX) return;
    $("fxWhere").textContent = fxReplace ? "Change the effect" : "at " + fmt1(S.time);
    const cats = $("fxCats"), grid = $("fxGrid");
    cats.innerHTML = "";
    grid.innerHTML = "";
    FX.EFFECTS.forEach(([cat]) => {
      const b = mk("button", "fchip" + (fxCat === cat ? " active" : ""), cat);
      b.type = "button";
      b.addEventListener("click", () => { fxCat = cat; renderEffectSheet(); });
      cats.appendChild(b);
    });
    const grp = FX.EFFECTS.find((g) => g[0] === fxCat) || FX.EFFECTS[0];
    grp[1].forEach(([id, label]) => {
      const b = mk("button", "anim-tile" + (fxReplace && fxReplace.type === id ? " selected" : ""));
      b.type = "button";
      const cv = document.createElement("canvas");
      cv.dataset.fx = id;
      b.appendChild(cv);
      b.appendChild(mk("span", "anim-name", label));
      b.addEventListener("click", () => {
        if (fxReplace) { fxReplace.type = id; S.sel = { type: "effect", id: fxReplace.id }; }
        else {
          const at = clamp(S.time, 0, Math.max(0, total() - 0.3));
          const e = { id: nextId++, type: id, start: at, dur: Math.min(3, Math.max(0.5, total() - at)), amount: 1 };
          S.effects.push(e);
          S.sel = { type: "effect", id: e.id };
          recordEdit("effect", { type: id });
        }
        commit();
        closeSheets();
        renderTimeline();
        renderInspector();
        const e = effectById(S.sel.id);
        if (e) previewSpan(e.start, Math.min(e.dur, 3));
      });
      grid.appendChild(b);
    });
    // each tile plays its effect on the picture under the playhead
    runTiles("#fxGrid canvas[data-fx]", (cv, ctx, w, h, ph) => {
      const now = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
      coverInto(ctx, now ? clipThumb(now.clip) : null, w, h, "#3a3b38");
      FX.effect(cv.dataset.fx, ctx, w, h, ph % 3, 1);
    });
  }
  function effectPanel(ins, e) {
    const FX = window.SenotelFX;
    ins.appendChild(mk("span", "ins-title", "<em>✦</em>" + escHtml(FX ? FX.nameOf(e.type) : e.type)));
    const change = mk("button", "fchip", "Change effect");
    change.addEventListener("click", () => openEffects(e));
    ins.appendChild(group("Effect", change));
    ins.appendChild(group("Strength", slider(0.05, 1, 0.05, e.amount == null ? 1 : e.amount,
      (v) => { e.amount = v; syncOverlays(); }, () => commit(), (v) => Math.round(v * 100) + "%")));
    ins.appendChild(group("Length", slider(0.2, Math.max(0.3, total()), 0.1, e.dur,
      (v) => { e.dur = v; renderTimeline(); syncOverlays(); }, () => commit(), (v) => v.toFixed(1) + "s")));
    ins.appendChild(group("Starts at", slider(0, Math.max(0.1, total()), 0.05, Math.min(e.start, total()),
      (v) => { e.start = v; renderTimeline(); syncOverlays(); }, () => commit(), (v) => fmt(v))));
    const whole = mk("button", "fchip", "Whole video");
    whole.title = "Make it run from the start to the end";
    whole.addEventListener("click", () => { e.start = 0; e.dur = total(); commit(); renderTimeline(); renderInspector(); syncOverlays(); });
    ins.appendChild(group("", whole));
  }

  /* ═══════════ STICKERS (stickers.js) ═══════════
     A sticker is a text with t.sticker: "emoji" (t.text is the emoji, drawn
     in Noto Color Emoji) or "shape" (t.shape, drawn in code in t.color).
     So it moves, pinches, turns, aligns and animates exactly like a text. */
  let stkCat = "Shapes", stkReplace = null;
  /* ── Text templates (ccl3, 0.35.0) ──
     A sheet of designed titles in groups; each tile is drawn by the same
     code as the picture (drawHeading / drawStyledText), in its own font, so
     what you tap is what lands on the video. */
  let tmplCat = "Titles";
  function openTemplates() {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    if (!window.SenotelTextTemplates) { toast("Templates aren't available here. Reload the page."); return; }
    renderTemplateSheet();
    openSheet("tmplSheet");
  }
  function renderTemplateSheet() {
    const TT = window.SenotelTextTemplates;
    const cats = $("tmplCats"), grid = $("tmplGrid");
    cats.innerHTML = "";
    grid.innerHTML = "";
    TT.GROUPS.forEach((g) => {
      const b = mk("button", "fchip" + (tmplCat === g ? " active" : ""), g);
      b.type = "button";
      b.addEventListener("click", () => { tmplCat = g; renderTemplateSheet(); });
      cats.appendChild(b);
    });
    TT.LIST.filter((x) => x.group === tmplCat).forEach((x) => {
      const b = mk("button", "tmpl-tile");
      b.type = "button";
      b.title = x.name;
      const cv = document.createElement("canvas");
      cv.width = 320; cv.height = 200;
      b.appendChild(cv);
      b.appendChild(mk("span", "anim-name", x.name));
      b.addEventListener("click", () => addTemplate(x.id));
      grid.appendChild(b);
      drawTemplateTile(cv, x.t);
    });
  }
  function drawTemplateTile(cv, f) {
    const draw = () => {
      const ctx = cv.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#2a2b29";
      ctx.fillRect(0, 0, cv.width, cv.height);
      const frame = { x: 0, y: 0, w: cv.width, h: cv.height };
      const s = Object.assign({ id: -1, start: -60, dur: 1e6, color: "#ffffff" }, f);
      // a tile is wide where the picture is tall: text sized against its height reads larger
      s.size = f.size * (s.style === "lower" ? 2.3 : s.style === "card" ? 0.9 : 1.45);
      if (s.style !== "lower") { s.x = 0.5; s.y = 0.5; }
      delete s.animIn; delete s.animOut; delete s.animLoop;
      if (s.style === "lower" || s.style === "card") drawStyledText(ctx, s, frame, 0);
      else drawHeading(ctx, s, frame, null, null);
    };
    draw();
    const SF = window.SenotelFonts;
    if (SF && f.font) { try { SF.load(f.font, f.weight || 400, !!f.italic).then(draw, () => {}); } catch (e) {} }
  }
  function addTemplate(id) {
    const TT = window.SenotelTextTemplates;
    const f = TT && TT.fields(id);
    if (!f) return;
    const t = Object.assign({ id: nextId++, start: clamp(S.time, 0, Math.max(0, total() - 0.5)), dur: 3, color: "#ffffff", pos: "center" }, f);
    S.texts.push(t);
    S.sel = { type: "text", id: t.id };
    commit();
    closeSheets();
    renderTimeline();
    renderInspector();
    syncOverlays();
    recordEdit("text-template", { id: id });
    toast("Template added. Tap Edit to change the words");
  }

  function openStickers(replace) {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    stkReplace = replace || null;
    const SK = window.SenotelStickers;
    if (SK) SK.loadEmojiFont();
    $("stkSearch").value = "";
    renderStickerSheet();
    openSheet("stickerSheet");
  }
  function renderStickerSheet() {
    const SK = window.SenotelStickers;
    if (!SK) return;
    const cats = $("stkCats"), grid = $("stkGrid"), q = $("stkSearch").value.trim().toLowerCase();
    cats.innerHTML = "";
    grid.innerHTML = "";
    ["Shapes"].concat(SK.EMOJI.map((g) => g[0])).forEach((cat) => {
      const b = mk("button", "fchip" + (!q && stkCat === cat ? " active" : ""), cat);
      b.type = "button";
      b.addEventListener("click", () => { stkCat = cat; $("stkSearch").value = ""; renderStickerSheet(); });
      cats.appendChild(b);
    });
    const pick = (props) => {
      if (stkReplace) {
        Object.assign(stkReplace, props);
        if (props.sticker === "emoji") delete stkReplace.shape;
        S.sel = { type: "text", id: stkReplace.id };
      } else {
        const t = Object.assign({
          id: nextId++, start: clamp(S.time, 0, Math.max(0, total() - 0.5)), dur: 3, size: 70, pos: "center",
          shadow: false, color: "#ffffff"
        }, props);
        S.texts.push(t);
        S.sel = { type: "text", id: t.id };
        recordEdit("sticker", { kind: props.sticker });
      }
      textTab = "stk";
      commit();
      closeSheets();
      renderTimeline();
      renderInspector();
      syncOverlays();
    };
    const shapes = (list) => list.forEach(([id, label, color]) => {
      const b = mk("button", "stk-tile stk-shape");
      b.type = "button";
      b.title = label;
      const cv = document.createElement("canvas");
      cv.width = 120; cv.height = 120;
      b.appendChild(cv);
      requestAnimationFrame(() => {
        const ctx = cv.getContext("2d");
        ctx.translate(60, 60);
        const s = 64, w = SK.shapeWidth(id, s), k = Math.min(1, 100 / w);
        ctx.scale(k, k);
        SK.drawShape(ctx, id, s, color);
      });
      b.addEventListener("click", () => pick({ sticker: "shape", shape: id, text: label, color: color, size: 60 }));
      grid.appendChild(b);
    });
    const emoji = (list) => list.forEach(([e, words]) => {
      const b = mk("button", "stk-tile", "");
      b.type = "button";
      b.textContent = e;
      b.title = words;
      b.addEventListener("click", () => pick({ sticker: "emoji", text: e, font: SK.EMOJI_FONT, weight: 400, size: 70 }));
      grid.appendChild(b);
    });
    if (q) {
      shapes(SK.SHAPES.filter((r) => r[1].toLowerCase().indexOf(q) >= 0 || r[0].indexOf(q) >= 0));
      SK.EMOJI.forEach((g) => emoji(g[1].filter((r) => r[1].indexOf(q) >= 0)));
      if (!grid.children.length) grid.appendChild(mk("p", "fp-none", "No sticker matches that."));
      return;
    }
    if (stkCat === "Shapes") shapes(SK.SHAPES);
    else emoji((SK.EMOJI.find((g) => g[0] === stkCat) || SK.EMOJI[0])[1]);
  }

  /* A shape sticker, drawn where and as a heading would be: the same place,
     size, turn, animation, shadow and selection frame (see drawHeading). */
  function drawShapeHeading(ctx, t, f, hits, time) {
    const SK = window.SenotelStickers;
    if (!SK) return;
    const A = textAnimAt(t, time);
    const L = headingLayout(t, f.w, f.h), k = textLook(t);
    const s = L.size * 1.6;
    const w = SK.shapeWidth(t.shape, s), h = s;
    ctx.save();
    ctx.translate(f.x + L.cx, f.y + L.cy);
    if (hits) hits.set(t.id, { x: f.x + L.cx, y: f.y + L.cy, w: w, h: h, rot: k.rotate });
    if (A.dx || A.dy) ctx.translate(A.dx * L.size, A.dy * L.size);
    if (k.rotate || A.r) ctx.rotate(((k.rotate + A.r) * Math.PI) / 180);
    if (A.s !== 1 || A.sx !== 1 || A.sy !== 1) ctx.scale(A.s * A.sx, A.s * A.sy);
    if (A.kx) ctx.transform(1, 0, A.kx, 1, 0, 0);
    ctx.globalAlpha *= clamp(k.opacity * A.a, 0, 1);
    const m = ctx.getTransform ? ctx.getTransform() : { a: 1, b: 0 };
    const px = Math.hypot(m.a, m.b) || 1;
    if (A.wipe && A.wipe.f < 1) {
      const fr = clamp(A.wipe.f, 0, 1);
      ctx.beginPath();
      if (A.wipe.dir === "y") ctx.rect(-w / 2, -h / 2 + h * (1 - fr), w, h * fr);
      else if (A.wipe.dir === "c") ctx.rect(-w * fr / 2, -h / 2, w * fr, h);
      else ctx.rect(-w / 2, -h / 2, w * fr, h);
      ctx.clip();
    }
    if (k.shadow && k.shOpacity > 0) {
      const a = (k.shAngle * Math.PI) / 180;
      ctx.shadowColor = rgba(k.shColor, k.shOpacity);
      ctx.shadowBlur = k.shBlur * L.size * px;
      ctx.shadowOffsetX = Math.cos(a) * k.shDist * L.size * px;
      ctx.shadowOffsetY = Math.sin(a) * k.shDist * L.size * px;
    }
    SK.drawShape(ctx, t.shape, s, t.color || "#ffffff");
    ctx.shadowColor = "transparent";
    if (hits && S.sel && S.sel.type === "text" && S.sel.id === t.id) {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 / (px / (window.devicePixelRatio > 1 ? Math.min(2, window.devicePixelRatio) : 1));
      ctx.strokeRect(-w / 2, -h / 2, w, h);
    }
    ctx.restore();
  }

  /* ═══════════ VOICEOVER (CapCut's Record) ═══════════
     Tap Voiceover: a count of three, then the video plays from the
     playhead (silent, so the microphone hears only you) while you speak.
     Stop puts the recording on the audio track where it began. The file
     stays on this device like any other. */
  const VO = { rec: null, stream: null, startAt: 0, t0: 0, timer: 0, chunks: [], n: 0 };
  async function startVoiceover() {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    if (VO.rec) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("This browser can't record sound. Try Chrome, Edge or Safari", 5000);
      return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast("vClyps needs the microphone to record. Allow it in the browser's address bar and try again", 6000); return; }
    if (S.playing) pause();
    VO.stream = stream;
    VO.startAt = clamp(S.time, 0, Math.max(0, total() - 0.2));
    const box = $("voiceRec");
    box.classList.remove("hidden");
    $("voiceLive").classList.add("hidden");
    $("voiceStop").textContent = "Cancel";
    let n = 3;
    $("voiceCount").textContent = String(n);
    $("voiceCount").classList.remove("hidden");
    VO.timer = setInterval(() => {
      n--;
      if (n > 0) { $("voiceCount").textContent = String(n); buzz("light"); return; }
      clearInterval(VO.timer);
      beginVoiceRecording();
    }, 1000);
  }
  function beginVoiceRecording() {
    $("voiceCount").classList.add("hidden");
    $("voiceLive").classList.remove("hidden");
    $("voiceStop").textContent = "Stop";
    const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"];
    const type = types.find((x) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(x)) || "";
    const rec = new MediaRecorder(VO.stream, type ? { mimeType: type } : undefined);
    VO.rec = rec;
    VO.chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) VO.chunks.push(e.data); };
    rec.onstop = finishVoiceover;
    rec.start(250);
    VO.t0 = performance.now();
    VO.wasMuted = S.userMuted;
    S.userMuted = true;   // the speakers stay quiet so the microphone hears only the voice
    applyMusicGain();
    S.time = VO.startAt;
    syncNow();
    play();
    VO.timer = setInterval(() => {
      const secs = (performance.now() - VO.t0) / 1000;
      $("voiceTime").textContent = fmt(secs).replace(/^0/, "");
      if (!S.playing && secs > 0.5) stopVoiceover();   // the end of the video ends the take
    }, 200);
  }
  function stopVoiceover() {
    clearInterval(VO.timer);
    if (VO.rec && VO.rec.state !== "inactive") { VO.dur = (performance.now() - VO.t0) / 1000; VO.rec.stop(); }
    else cleanupVoice();
    if (S.playing) pause();
  }
  function cleanupVoice() {
    clearInterval(VO.timer);
    if (VO.stream) VO.stream.getTracks().forEach((tr) => tr.stop());
    VO.stream = null;
    VO.rec = null;
    $("voiceRec").classList.add("hidden");
    if (VO.wasMuted != null) { S.userMuted = VO.wasMuted; VO.wasMuted = null; applyMusicGain(); }
  }
  function finishVoiceover() {
    const type = (VO.rec && VO.rec.mimeType) || "audio/webm";
    const dur = VO.dur || 0;
    cleanupVoice();
    if (!VO.chunks.length || dur < 0.3) { toast("Nothing was recorded"); return; }
    VO.n++;
    const ext = /mp4/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : "webm";
    const name = "Voiceover " + VO.n;
    const file = new File(VO.chunks, name + "." + ext, { type: type.split(";")[0] });
    const item = { id: nextId++, url: URL.createObjectURL(file), type: "audio", name: name, duration: dur, thumb: null, file: file, voice: true };
    S.media.push(item);
    keepFile(item, file);
    renderAll();
    const a = addAudioClip(item, { at: VO.startAt });
    S.time = VO.startAt;
    syncNow();
    if (a) toast(name + " is on the audio track", 4000);
  }

  /* ═══════════ WAVEFORMS ═══════════
     The real shape of a sound on its clip, as CapCut draws it: the file is
     decoded once at a low rate (8 kHz mono is plenty to see loudness),
     reduced to its loudest sample every 20 ms, and kept in memory. Files
     over 200 MB keep the plain bars rather than be read whole. */
  const PEAKS_PER_SEC = 50;
  const peaks = new Map();   // key → Float32Array, or "busy"
  function peaksOf(key, url, size) {
    const have = peaks.get(key);
    if (have) return have === "busy" ? null : have;
    if (size && size > 200 * 1048576) return null;
    peaks.set(key, "busy");
    (async () => {
      try {
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const bytes = await (await fetch(url)).arrayBuffer();
        const ctx = new Ctx(1, 1, 8000);
        const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(bytes, res, rej); if (p && p.then) p.then(res, rej); });
        const n = Math.ceil(buf.duration * PEAKS_PER_SEC), out = new Float32Array(n), step = buf.sampleRate / PEAKS_PER_SEC;
        const chs = [];
        for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
        let top = 0;
        for (let i = 0; i < n; i++) {
          let mx = 0;
          for (let j = Math.floor(i * step), e = Math.min(buf.length, Math.floor((i + 1) * step)); j < e; j++) {
            for (let c = 0; c < chs.length; c++) { const v = Math.abs(chs[c][j]); if (v > mx) mx = v; }
          }
          out[i] = mx;
          if (mx > top) top = mx;
        }
        if (top > 0) for (let i = 0; i < n; i++) out[i] = Math.min(1, out[i] / top);
        peaks.set(key, out);
        renderTimeline();
      } catch (e) { peaks.delete(key); peaks.set(key, "busy"); }   // undecodable: keep the plain bars
    })();
    return null;
  }
  // a canvas the clip's width, with the stretch [from, to] of the sound in it
  function waveCanvas(p, from, to, wpx, hpx, color) {
    const cv = document.createElement("canvas");
    cv.className = "wave";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(4000, Math.round(wpx))), h = Math.max(1, Math.round(hpx));
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    ctx.fillStyle = color;
    const span = Math.max(0.01, to - from), bar = 2, gap = 1;
    for (let x = 0; x < w; x += bar + gap) {
      const t0 = from + (x / w) * span, t1 = from + ((x + bar + gap) / w) * span;
      let mx = 0;
      for (let i = Math.floor(t0 * PEAKS_PER_SEC), e = Math.min(p.length, Math.ceil(t1 * PEAKS_PER_SEC)); i < e; i++) if (p[i] > mx) mx = p[i];
      const bh = Math.max(1, mx * (h - 2));
      ctx.fillRect(x, (h - bh) / 2, bar, bh);
    }
    return cv;
  }

  /* ─── One-tap looks (CapCut's text Styles) ───
     Each sets colour, outline, background, shadow and glow together, and
     leaves the words, font, size and place alone. */
  const PRESET_BASE = { color: "#ffffff", opacity: 1, strokeW: 0, strokeColor: "#000000", boxOn: false, boxColor: "#000000", boxOpacity: 0.75, boxRadius: 0.25,
    shadow: false, shColor: "#000000", shOpacity: 0.8, shBlur: 0.22, shDist: 0, shAngle: 45, glowOn: false, glowColor: "#00e5ff", glowSize: 0.6 };
  /* ── Copy and paste style (ccl2, 0.35.0) ──
     Everything about how a text LOOKS and MOVES: font, colours, outline,
     shadow, label box, glow, spacing, curve, size, kind (title, lower
     third, card) and its animations. Never what it says, where it sits or
     when it shows. A key the copied text doesn't have is removed from the
     pasted one, so the result is identical, not a mix of the two. */
  const STYLE_KEYS = Object.keys(TEXT_LOOK).concat(["color", "size", "style", "accent", "bg",
    "animIn", "animOut", "animLoop", "animInLen", "animOutLen", "animLoopSpeed", "animLen", "animLenSet"]);
  let styleClip = null;
  function copyTextStyle(t) {
    styleClip = {};
    STYLE_KEYS.forEach((k) => { styleClip[k] = t[k] == null ? null : JSON.parse(JSON.stringify(t[k])); });
    buzz("light");
    toast("Style copied. Select another text and tap Paste style");
    renderActionBar();
  }
  function pasteTextStyle(list) {
    if (!styleClip) return;
    list.forEach((t) => STYLE_KEYS.forEach((k) => { if (styleClip[k] == null) delete t[k]; else t[k] = JSON.parse(JSON.stringify(styleClip[k])); }));
    commit();
    syncOverlays();
    renderTimeline();
    renderInspector();
    recordEdit("paste-style", { texts: list.length });
    toast(list.length > 1 ? "Style pasted on " + list.length + " texts" : "Style pasted");
  }

  const TEXT_PRESETS = [
    { name: "Soft shadow", shadow: true, shOpacity: 0.6, shBlur: 0.3 },
    { name: "Outline", strokeW: 0.08 },
    { name: "Yellow outline", color: "#ffe600", strokeW: 0.1 },
    { name: "Comic", strokeW: 0.14, shadow: true, shOpacity: 1, shBlur: 0, shDist: 0.07 },
    { name: "White label", color: "#111111", boxOn: true, boxColor: "#ffffff", boxOpacity: 1 },
    { name: "Dark label", boxOn: true, boxColor: "#000000", boxOpacity: 0.72 },
    { name: "Crimson label", boxOn: true, boxColor: "#dc143c", boxOpacity: 1, boxRadius: 0.15 },
    { name: "Yellow label", color: "#111111", boxOn: true, boxColor: "#ffe600", boxOpacity: 1, boxRadius: 0.15 },
    { name: "Mint tag", color: "#0b2a12", boxOn: true, boxColor: "#b7f36b", boxOpacity: 1, boxRadius: 0.5 },
    { name: "Frosted", boxOn: true, boxColor: "#ffffff", boxOpacity: 0.2, boxRadius: 0.5 },
    { name: "Hard shadow", shadow: true, shOpacity: 1, shBlur: 0, shDist: 0.07, shAngle: 45 },
    { name: "Retro 3D", color: "#ffd23f", strokeW: 0.04, shadow: true, shColor: "#ee4266", shOpacity: 1, shBlur: 0, shDist: 0.09, shAngle: 45 },
    { name: "Gold", color: "#e8c468", strokeW: 0.05, strokeColor: "#3b2a06", shadow: true, shOpacity: 0.6, shBlur: 0.25 },
    { name: "Ink on paper", color: "#111111", boxOn: true, boxColor: "#f2efe6", boxOpacity: 1, boxRadius: 0.05 },
    { name: "Neon pink", glowOn: true, glowColor: "#ff2e88", glowSize: 0.7 },
    { name: "Neon cyan", glowOn: true, glowColor: "#00e5ff", glowSize: 0.7 }
  ];
  function applyTextPreset(t, p) {
    Object.keys(PRESET_BASE).forEach((key) => { t[key] = p[key] != null ? p[key] : PRESET_BASE[key]; });
    recordEdit("text-look", { look: p.name });
  }
  function drawPresetTile(cv, t, p) {
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#2a2b29";
    ctx.fillRect(0, 0, cv.width, cv.height);
    const sample = Object.assign({}, t, PRESET_BASE, p, { id: -1, text: "Aa", x: 0.5, y: 0.5, rotate: 0, curve: 0, size: (34 / cv.height) * HEADING_REF_H, align: "center" });
    delete sample.animIn; delete sample.animOut; delete sample.animLoop;
    drawHeading(ctx, sample, { x: 0, y: 0, w: cv.width, h: cv.height }, null, null);
  }

  // Before an export: the fonts every text uses, four seconds at most
  function textFontsReady() {
    const SF = window.SenotelFonts;
    if (!SF) return Promise.resolve();
    const jobs = S.texts.filter((t) => t.font).map((t) => {
      const k = textLook(t);
      return SF.load(k.font, k.weight, k.italic);
    });
    return Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 4000))]);
  }

  /* ═══════════ LOWER THIRDS AND TITLE CARDS ═══════════
     Two more ways a text can look, besides the heading. Both are DRAWN, in
     the preview (on the caption canvas, inside the picture) and in the
     export (on the export canvas), by this one function, so they cannot
     differ between the two.
       lower  a name and a second line in a dark box at the lower left, with a
              crimson rule; slides in, fades out. For who is speaking.
       card   the whole frame in one colour with the text centred on it, a
              second line under it; fades in and out. A title, a chapter, an
              end card. "Put before / after the video" turns one into its own
              clip (makeCardClip) so it adds time instead of covering it.
     Sizes are fractions of the frame, like headings. */
  const LOWER_FONT = '"Switzer", -apple-system, "Segoe UI", Roboto, sans-serif';

  /* The brand kit (Settings → Your brand), for every project on this device:
     the colours new title cards and lower thirds start from, and a logo
     drawn as a watermark in the preview and the export alike. */
  const BRAND = (() => {
    const base = { main: "#111210", accent: "#dc143c", text: "#edeae2", logo: "", mark: "off" };
    try { return Object.assign(base, JSON.parse(localStorage.getItem("vclyps-brand") || "{}")); } catch (e) { return base; }
  })();
  let brandImg = null;
  function brandLogo() {
    if (!BRAND.logo) return null;
    if (!brandImg || brandImg.dataset.src !== BRAND.logo.slice(-64)) {
      brandImg = new Image();
      brandImg.dataset.src = BRAND.logo.slice(-64);
      brandImg.onload = () => { try { syncOverlays(); } catch (e) {} };
      brandImg.src = BRAND.logo;
    }
    return brandImg.complete && brandImg.naturalWidth ? brandImg : null;
  }
  function saveBrand() {
    try { localStorage.setItem("vclyps-brand", JSON.stringify(BRAND)); return true; } catch (e) { return false; }
  }

  // The logo in its corner: 16% of the frame's width (22% on a wide frame's height), a margin of 4%.
  function drawWatermark(ctx, f) {
    if (!BRAND.mark || BRAND.mark === "off") return;
    const img = brandLogo();
    if (!img) return;
    const ar = img.naturalWidth / img.naturalHeight;
    let w = f.w * (f.h >= f.w ? 0.16 : 0.1);
    let h = w / ar;
    if (h > f.h * 0.12) { h = f.h * 0.12; w = h * ar; }
    const m = Math.min(f.w, f.h) * 0.04;
    const x = BRAND.mark === "tl" ? f.x + m : f.x + f.w - m - w;
    const y = BRAND.mark === "br" ? f.y + f.h - m - h : f.y + m;
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }
  function textStyleOf(t) { return t.style === "lower" || t.style === "card" ? t.style : "heading"; }

  function drawStyledText(ctx, t, f, time) {
    const style = textStyleOf(t);
    const local = time - t.start, left = t.start + t.dur - time;
    const unit = (t.size / HEADING_REF_H) * f.h;
    ctx.save();
    ctx.textBaseline = "middle";
    if (style === "card") {
      const a = clamp(Math.min(t.start <= 0.05 ? 1 : local / 0.25, left / 0.25), 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = t.bg || "#111210";
      ctx.fillRect(f.x, f.y, f.w, f.h);
      const size = unit * 1.15;
      ctx.font = textFontCss(t, size, 400, HEADING_FONT);
      ctx.textAlign = "center";
      ctx.fillStyle = t.color || "#edeae2";
      const lines = wrapHeading(ctx, t.text, f.w * 0.84);
      const subSize = size * 0.36;
      const blockH = lines.length * size * HEADING_LINE + (t.sub ? subSize * 2.2 : 0);
      let y = f.y + f.h * 0.48 - blockH / 2 + (size * HEADING_LINE) / 2;
      lines.forEach((l) => { ctx.fillText(l, f.x + f.w / 2, y); y += size * HEADING_LINE; });
      if (t.sub) {
        ctx.font = "500 " + subSize + "px " + LOWER_FONT;
        ctx.globalAlpha = a * 0.72;
        ctx.fillText(t.sub, f.x + f.w / 2, y - size * HEADING_LINE / 2 + subSize * 1.6, f.w * 0.84);
      }
    } else {
      // lower third
      const ease = (p) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);
      const inP = ease(local / 0.35);
      const a = clamp(Math.min(local / 0.2, left / 0.25), 0, 1);
      const name = unit * 0.62, sub = name * 0.66, pad = name * 0.5;
      ctx.font = textFontCss(t, name, 600, LOWER_FONT);
      const maxW = f.w * 0.8;
      const nameW = Math.min(maxW, ctx.measureText(t.text).width);
      ctx.font = "500 " + sub + "px " + LOWER_FONT;
      const subW = t.sub ? Math.min(maxW, ctx.measureText(t.sub).width) : 0;
      const rule = Math.max(3, f.w * 0.01);
      const boxW = Math.max(nameW, subW) + pad * 2 + rule;
      const boxH = pad * 2 + name + (t.sub ? sub * 1.35 : 0);
      const x = f.x + f.w * 0.06 - (1 - inP) * boxW * 0.25;
      const y = f.y + f.h * 0.78 - boxH;
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(17, 18, 16, 0.86)";
      ctx.fillRect(x, y, boxW, boxH);
      ctx.fillStyle = t.accent || "#dc143c";
      ctx.fillRect(x, y, rule, boxH);
      ctx.textAlign = "left";
      ctx.fillStyle = t.color || "#edeae2";
      ctx.font = textFontCss(t, name, 600, LOWER_FONT);
      ctx.fillText(t.text, x + rule + pad, y + pad + name / 2, maxW);
      if (t.sub) {
        ctx.font = "500 " + sub + "px " + LOWER_FONT;
        ctx.globalAlpha = a * 0.75;
        ctx.fillText(t.sub, x + rule + pad, y + pad + name + sub * 0.85, maxW);
      }
    }
    ctx.restore();
  }

  /* ═══════════ THE PICTURE (preview == export) ═══════════
     Since 0.32.0 the preview no longer shows the <video> itself: every frame
     is drawn by renderPicture() onto a canvas, exactly as the export draws
     it, in the export's shape. That is what lets two clips mix in a
     transition, an effect change the whole frame, a clip sit inside its own
     background or be cropped, and an overlay take any place, size, turn,
     see-through and blend, all looking the same in the preview and the file.
     The <video> elements still play (and carry the sound); they just aren't
     what you see.

     TRANSITIONS (fx-library.js). A transition belongs to the clip it leads
     INTO (clip.tIn, length clip.tDur) and mixes the two whole pictures across
     the cut: for tDur seconds centred on the cut the outgoing clip runs on
     past its end and the incoming one starts before its start, from the
     footage around them (held on the last or first frame where there is
     none), so the timeline keeps its length, as CapCut's does. */
  const TRANS_DEFAULT = 0.5;
  function transDur(c) { return clamp(typeof c.tDur === "number" ? c.tDur : TRANS_DEFAULT, 0.1, 3); }
  // the transition playing at t: {a, b, aStart, bStart, p, kind}, or null
  function transitionAt(t) {
    let acc = 0;
    for (let i = 0; i < S.clips.length; i++) {
      const c = S.clips[i], d = dispDur(c);
      if (i > 0 && c.tIn && c.tIn !== "none") {
        const prev = S.clips[i - 1];
        const half = Math.min(transDur(c), dispDur(prev) * 2, d * 2) / 2;
        if (t >= acc - half && t < acc + half) {
          return { a: prev, b: c, aStart: acc - dispDur(prev), bStart: acc, p: (t - (acc - half)) / (2 * half), kind: c.tIn };
        }
      }
      if (t < acc - 3) break;
      acc += d;
    }
    return null;
  }
  /* ccl1 (0.35.0): the SOUND crosses a transition too. Half the window of
     the transition into clip i, as transitionAt measures it, or 0 when there
     is none or its "Blend sound" is off (clip.tAudio === false). Across the
     window the two clips' sound is mixed with equal-power curves (cos/sin),
     so the loudness never dips in the middle, in the preview (mixBlend) and
     the export (renderMixOffline) alike. */
  function transHalf(i) {
    const c = S.clips[i], prev = S.clips[i - 1];
    if (!c || !prev || !c.tIn || c.tIn === "none" || c.tAudio === false) return 0;
    return Math.min(transDur(c), dispDur(prev) * 2, dispDur(c) * 2) / 2;
  }
  const blendOut = (p) => Math.cos(clamp(p, 0, 1) * Math.PI / 2);
  const blendIn = (p) => Math.sin(clamp(p, 0, 1) * Math.PI / 2);

  // where in its footage a clip is at timeline time t, inside the file
  function srcTimeAt(clip, start, t) {
    const m = mediaById(clip.mediaId);
    const s = clip.in + (t - start) * (clip.speed || 1);
    const max = m && m.duration ? m.duration - 0.04 : clip.out;
    return clamp(s, 0, Math.max(0, max));
  }

  /* Clip animations: CapCut's In, Out and Loop for a whole clip, from the
     same library as text (text-anims.js), without the letter-by-letter ones.
     A clip moves in half-frame steps where a text moves in text heights. */
  const CLIP_ANIM_SKIP = /^(l-|w-)|^type$/;
  function clipAnimLists() {
    const A = TA();
    if (!A) return null;
    return { IN: A.IN.filter((r) => !CLIP_ANIM_SKIP.test(r[0])), OUT: A.OUT.filter((r) => !CLIP_ANIM_SKIP.test(r[0])), LOOP: A.LOOP.filter((r) => !/^l-/.test(r[0])) };
  }
  function clipAnimAt(clip, local) {
    if (!clip.animIn && !clip.animOut && !clip.animLoop) return null;
    const A = TA();
    if (!A) return null;
    return A.at({ start: 0, dur: dispDur(clip), animIn: clip.animIn, animOut: clip.animOut, animLoop: clip.animLoop,
      animInLen: clip.animInLen, animOutLen: clip.animOutLen, animLoopSpeed: clip.animLoopSpeed }, local);
  }

  // part of a picture (s = {x, y, w, h} of the source) into a rect, turned and flipped as the clip says
  function drawOrientedSrc(ctx, el, s, dx, dy, dw, dh, c) {
    if (!c || (!c.rot && !c.flipH && !c.flipV)) { ctx.drawImage(el, s.x, s.y, s.w, s.h, dx, dy, dw, dh); return; }
    ctx.save();
    ctx.translate(dx + dw / 2, dy + dh / 2);
    ctx.scale(c.flipH ? -1 : 1, c.flipV ? -1 : 1);
    if (c.rot) ctx.rotate((c.rot * Math.PI) / 180);
    const w = turned(c) ? dh : dw, h = turned(c) ? dw : dh;
    ctx.drawImage(el, s.x, s.y, s.w, s.h, -w / 2, -h / 2, w, h);
    ctx.restore();
  }

  const FIT_BACKGROUNDS = [["blur", "Blur"], ["black", "Black"], ["white", "White"], ["color", "Colour"]];
  // behind a clip shown whole ("Fit"): its own picture blurred, or a colour
  function drawFitBackground(ctx, clip, el, s, W, H) {
    const bg = clip.bg || "blur";
    if (bg === "black") return;
    if (bg === "white" || bg === "color") { ctx.fillStyle = bg === "white" ? "#ffffff" : (clip.bgColor || "#111210"); ctx.fillRect(0, 0, W, H); return; }
    const side = turned(clip), ew = side ? s.h : s.w, eh = side ? s.w : s.h;
    const sc = Math.max(W / ew, H / eh) * 1.12, dw = ew * sc, dh = eh * sc;
    ctx.save();
    const blur = window.SenotelFX && SenotelFX.canFilter;
    if (blur) ctx.filter = "blur(" + (Math.max(W, H) * 0.035).toFixed(1) + "px) brightness(0.78) saturate(1.1)";
    drawOrientedSrc(ctx, el, s, (W - dw) / 2, (H - dh) / 2, dw, dh, clip);
    ctx.restore();
    if (!blur) { ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillRect(0, 0, W, H); }
  }

  /* One clip's picture, filling a W x H frame: its crop, Fill or Fit (with
     the background), layout, flip and turn, slow zoom, look, adjustments
     and animation. local is seconds into the clip (it can run past either
     end inside a transition). */
  function drawClipPicture(ctx, clip, src, W, H, local) {
    ctx.save();
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (!src || !src.w || !src.h) { ctx.restore(); return; }
    const m = mediaById(clip.mediaId);
    const isVid = m && m.type === "video";
    const el = src.el;
    const cr = clip.crop;
    const s = cr ? { x: cr.x * src.w, y: cr.y * src.h, w: Math.max(1, cr.w * src.w), h: Math.max(1, cr.h * src.h) } : { x: 0, y: 0, w: src.w, h: src.h };
    const anim = clipAnimAt(clip, local);
    if (anim) {
      ctx.translate(W / 2 + anim.dx * W * 0.5, H / 2 + anim.dy * H * 0.5);
      if (anim.r) ctx.rotate((anim.r * Math.PI) / 180);
      ctx.scale(anim.s * anim.sx, anim.s * anim.sy);
      if (anim.kx) ctx.transform(1, 0, anim.kx, 1, 0, 0);
      ctx.translate(-W / 2, -H / 2);
      ctx.globalAlpha *= clamp(anim.a, 0, 1);
      if (anim.wipe && anim.wipe.f < 1) {
        const f = clamp(anim.wipe.f, 0, 1);
        ctx.beginPath();
        if (anim.wipe.dir === "y") ctx.rect(0, H * (1 - f), W, H * f);
        else if (anim.wipe.dir === "c") ctx.rect(W * (1 - f) / 2, 0, W * f, H);
        else ctx.rect(0, 0, W * f, H);
        ctx.clip();
      }
    }
    const blur = anim && anim.blur > 0.005 ? anim.blur * H * 0.06 : 0;
    const L = isVid && !cr ? layoutOf(clip) : null;
    try {
      if (L) {
        ctx.filter = pictureFilter(clip, blur);
        drawLayout(ctx, el, src.w, src.h, L, { x: 0, y: 0, w: W, h: H });
      } else {
        const side = turned(clip);
        const ew = side ? s.h : s.w, eh = side ? s.w : s.h;
        const fit = clip.fit === "fit";
        if (fit) drawFitBackground(ctx, clip, el, s, W, H);
        const sc = fit ? Math.min(W / ew, H / eh) : Math.max(W / ew, H / eh);
        const dw = ew * sc, dh = eh * sc;
        let dx = (W - dw) / 2, dy = (H - dh) / 2;
        if (!fit && !cr && dw > W + 1 && !side && !clip.flipH) {
          // smart crop: keep the frame centred on where the motion lives
          const mcx = (m && m.analysis && m.analysis.vis && m.analysis.vis.avgMcx) || 0.5;
          dx = clamp(W / 2 - mcx * dw, W - dw, 0);
        }
        ctx.filter = pictureFilter(clip, blur);
        const k = clip.kb;
        if (k) {
          const p = clamp(local / Math.max(dispDur(clip), 0.01), 0, 1);
          const zs = k.s0 + (k.s1 - k.s0) * p;
          ctx.save();
          ctx.translate(W / 2 + (k.x0 + (k.x1 - k.x0) * p) * dw, H / 2 + (k.y0 + (k.y1 - k.y0) * p) * dh);
          ctx.scale(zs, zs);
          ctx.translate(-W / 2, -H / 2);
          drawOrientedSrc(ctx, el, s, dx, dy, dw, dh, clip);
          ctx.restore();
        } else {
          drawOrientedSrc(ctx, el, s, dx, dy, dw, dh, clip);
        }
      }
    } catch (e) { /* a frame not ready yet: skip it, never break */ }
    ctx.filter = "none";
    drawAdjustVeils(ctx, clip, { x: 0, y: 0, w: W, h: H });
    ctx.restore();
    // ccl4: the filter's colour table over the clip's own picture (the canvas is W x H here)
    const FL = window.SenotelFilters;
    if (clip.filter && clip.filter !== "none" && FL && FL.has(clip.filter)) {
      const out = FL.apply(ctx.canvas, clip.filter, clip.filterAmt == null ? 1 : clip.filterAmt);
      if (out) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.globalCompositeOperation = "copy";
        ctx.drawImage(out, 0, 0, W, H);
        ctx.restore();
      }
    }
  }

  /* An overlay's place: its centre (b.x, b.y, fractions of the frame), its
     size (b.scale, of the frame's width), its turn (b.rot) and shape
     (square, the footage's own, or round). Full frame covers everything. */
  const BLENDS = [["normal", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["darken", "Darken"],
    ["lighten", "Lighten"], ["color-dodge", "Colour dodge"], ["color-burn", "Colour burn"], ["hard-light", "Hard light"],
    ["soft-light", "Soft light"], ["difference", "Difference"], ["exclusion", "Exclusion"], ["hue", "Hue"], ["saturation", "Saturation"],
    ["color", "Colour"], ["luminosity", "Luminosity"]];
  function brollGeom(b, box) {
    if (b.mode === "cover") return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, w: box.w, h: box.h, rot: 0, shape: "square" };
    const s = box.w * (b.scale || BROLL_SIZE);
    const shape = b.shape || "square";
    const m = mediaById(b.mediaId);
    const ar = shape === "original" && m && m.w && m.h ? m.w / m.h : 1;
    return {
      cx: box.x + box.w * (b.x != null ? b.x : 0.5),
      cy: box.y + box.h * (b.y != null ? b.y : BROLL_CY),
      w: ar >= 1 ? s : s * ar, h: ar >= 1 ? s / ar : s,
      rot: b.rot || 0, shape: shape
    };
  }
  function drawBroll(ctx, W, H, t, getSrc) {
    const b = brollAt(t);
    if (!b) return;
    const m = mediaById(b.mediaId);
    if (!m) return;
    const local = t - b.start;
    const src = getSrc(b, m.type === "video" && m.duration ? local % m.duration : 0);
    if (!src || !src.w || !src.h) return;
    const g = brollGeom(b, { x: 0, y: 0, w: W, h: H });
    ctx.save();
    ctx.globalAlpha = clamp(b.opacity == null ? 1 : b.opacity, 0, 1) * (binHover === "b" + b.id ? 0.35 : 1);
    if (b.blend && b.blend !== "normal") ctx.globalCompositeOperation = b.blend;
    ctx.translate(g.cx, g.cy);
    if (g.rot) ctx.rotate((g.rot * Math.PI) / 180);
    ctx.beginPath();
    if (g.shape === "round") ctx.ellipse(0, 0, g.w / 2, g.h / 2, 0, 0, Math.PI * 2);
    else ctx.rect(-g.w / 2, -g.h / 2, g.w, g.h);
    ctx.clip();
    // cover the shape, cropped toward the subject rather than the middle
    const sc = Math.max(g.w / src.w, g.h / src.h), dw = src.w * sc, dh = src.h * sc;
    const mcx = (m.analysis && m.analysis.vis && m.analysis.vis.avgMcx) || 0.5;
    const dx = dw > g.w + 1 ? clamp(g.w / 2 - mcx * dw, g.w - dw, 0) : (g.w - dw) / 2;
    try { ctx.drawImage(src.el, -g.w / 2 + dx, -g.h / 2 + (g.h - dh) / 2, dw, dh); } catch (e) {}
    ctx.restore();
  }

  /* The whole picture at time t on a W x H canvas, for the preview and the
     export alike: the clip (or the two clips of a transition), the overlay,
     the clips' fades, then the effects on their lane. getSrc(item, t)
     returns {el, w, h} for a clip or overlay at that point in its footage. */
  function renderPicture(ctx, W, H, t, getSrc) {
    const FX = window.SenotelFX;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    const tr = FX ? transitionAt(t) : null;
    if (tr) {
      const A = FX.scratch("tA", W, H), B = FX.scratch("tB", W, H);
      drawClipPicture(A.getContext("2d"), tr.a, getSrc(tr.a, srcTimeAt(tr.a, tr.aStart, t)), W, H, t - tr.aStart);
      drawClipPicture(B.getContext("2d"), tr.b, getSrc(tr.b, srcTimeAt(tr.b, tr.bStart, t)), W, H, t - tr.bStart);
      FX.transition(tr.kind, ctx, A, B, tr.p, W, H);
    } else {
      const info = clipAt(Math.min(t, Math.max(total() - 0.001, 0)));
      if (info) drawClipPicture(ctx, info.clip, getSrc(info.clip, srcTimeAt(info.clip, info.start, t)), W, H, info.offset);
    }
    drawBroll(ctx, W, H, t, getSrc);
    const fa = fadeAlpha(clipAt(Math.min(t, Math.max(total() - 0.001, 0))));
    if (fa > 0) { ctx.fillStyle = "rgba(0,0,0," + fa + ")"; ctx.fillRect(0, 0, W, H); }
    if (FX) S.effects.forEach((e) => {
      if (t >= e.start && t < e.start + e.dur) FX.effect(e.type, ctx, W, H, t - e.start, e.amount == null ? 1 : e.amount);
    });
    ctx.restore();
  }

  /* ─── Where the preview gets its pictures ───
     The clip under the playhead from #pv (synced by syncMedia, and the one
     whose sound you hear); the other clip of a transition from #pvT, a
     silent second player kept in step; overlays from #pvB; photos from a
     small cache of images. */
  const pvT = $("pvT");
  const imgCache = new Map();
  function imageOf(m) {
    let im = imgCache.get(m.id);
    if (!im || im.dataset.src !== m.url) {
      im = new Image();
      im.dataset.src = m.url;
      im.onload = () => { try { syncOverlays(); } catch (e) {} };
      im.src = m.url;
      imgCache.set(m.id, im);
    }
    return im.complete && im.naturalWidth ? { el: im, w: im.naturalWidth, h: im.naturalHeight } : null;
  }
  const vidSrc = (v) => (v.readyState >= 2 && v.videoWidth ? { el: v, w: v.videoWidth, h: v.videoHeight } : null);
  let pvTUsed = false;
  function previewSrc(item, srcT) {
    const m = mediaById(item.mediaId);
    if (!m) return null;
    if (m.type !== "video") return imageOf(m);
    if (S.broll.indexOf(item) >= 0) return vidSrc(pvB);
    const main = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
    if (main && main.clip === item && pv.dataset.mid === String(m.id)) return vidSrc(pv);
    pvTUsed = true;
    if (pvT.dataset.mid !== String(m.id)) { pvT.src = m.url; pvT.dataset.mid = String(m.id); }
    if (pvT.readyState >= 1) {
      const drift = Math.abs(pvT.currentTime - srcT);
      if (S.playing) {
        pvT.playbackRate = item.speed || 1;
        if (pvT.paused) pvT.play().catch(() => {});
        if (drift > 0.3 && !pvT.seeking) { try { pvT.currentTime = srcT; } catch (e) {} }
      } else {
        if (!pvT.paused) pvT.pause();
        if (drift > 0.04 && !pvT.seeking) { try { pvT.currentTime = srcT; } catch (e) {} }
      }
    }
    return vidSrc(pvT);
  }

  let cropEdit = null;   // the clip whose crop is being set (drawCropEditor), or null

  // The preview: renderPicture into the picture's box on the stage canvas
  const previewPic = { cv: null };
  function drawPreviewPicture() {
    const cv = $("layoutCanvas");
    const stage = $("stage");
    const sw = stage.clientWidth || 0, sh = stage.clientHeight || 0;
    const show = S.clips.length > 0 && sw > 0 && sh > 0;
    cv.classList.toggle("hidden", !show);
    if (!show) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(sw * dpr), ph = Math.round(sh * dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    const box = pictureBox();
    const W = Math.max(2, Math.round(box.w * dpr)), H = Math.max(2, Math.round(box.h * dpr));
    if (!previewPic.cv) previewPic.cv = document.createElement("canvas");
    const P = previewPic.cv;
    if (P.width !== W) P.width = W;
    if (P.height !== H) P.height = H;
    pvTUsed = false;
    if (cropEdit) cropEdit.view = { box: box, dpr: dpr };
    if (cropEdit) drawCropEditor(P.getContext("2d"), W, H);
    else renderPicture(P.getContext("2d"), W, H, S.time, previewSrc);
    if (!pvTUsed && !pvT.paused) pvT.pause();
    ctx.drawImage(P, Math.round(box.x * dpr), Math.round(box.y * dpr));
  }

  /* ═══════════ LAYOUTS: split screen, screen and face ═══════════
     For wide footage in a tall video, two ways to use the frame besides
     cropping to one spot (the default, "Fill"), both cut from the SAME
     clip, so they need nothing but the one video:
       split   two people in one wide shot, one above the other (side by
               side when the video itself is wide). layout.a and layout.b say
               where each person is across the source, 0 to 1.
       screen  a webcam corner and the screen or game: the face on top,
               the screen below. layout.fx/fy are where the face is in the
               source, layout.fs how much of the source's height it takes;
               layout.sx where to centre the screen.
     drawLayout() paints it, for the export canvas and for the preview's
     layout canvas alike, so what you see is what the file has. */
  const LAYOUTS = { fill: "Fill", split: "Split screen", screen: "Screen and face" };
  function layoutOf(c) {
    return c && c.layout && (c.layout.type === "split" || c.layout.type === "screen") ? c.layout : null;
  }

  // The source cropped to COVER rect r, centred as near (cx, cy) as the edges allow.
  function coverDraw(ctx, el, vw, vh, r, cx, cy) {
    const sc = Math.max(r.w / vw, r.h / vh);
    const dw = vw * sc, dh = vh * sc;
    const dx = clamp(r.w / 2 - cx * dw, r.w - dw, 0);
    const dy = clamp(r.h / 2 - cy * dh, r.h - dh, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(el, r.x + dx, r.y + dy, dw, dh);
    ctx.restore();
  }

  function drawLayout(ctx, el, vw, vh, L, f) {
    const tall = f.h >= f.w;
    const line = Math.max(2, Math.round(Math.min(f.w, f.h) * 0.004));
    ctx.fillStyle = "#000";
    ctx.fillRect(f.x, f.y, f.w, f.h);
    if (L.type === "split") {
      const a = tall ? { x: f.x, y: f.y, w: f.w, h: f.h / 2 } : { x: f.x, y: f.y, w: f.w / 2, h: f.h };
      const b = tall ? { x: f.x, y: f.y + f.h / 2, w: f.w, h: f.h / 2 } : { x: f.x + f.w / 2, y: f.y, w: f.w / 2, h: f.h };
      coverDraw(ctx, el, vw, vh, a, L.a != null ? L.a : 0.27, 0.45);
      coverDraw(ctx, el, vw, vh, b, L.b != null ? L.b : 0.73, 0.45);
      ctx.fillStyle = "#111210";
      if (tall) ctx.fillRect(f.x, f.y + f.h / 2 - line / 2, f.w, line);
      else ctx.fillRect(f.x + f.w / 2 - line / 2, f.y, line, f.h);
      return;
    }
    // screen and face
    const face = tall ? { x: f.x, y: f.y, w: f.w, h: f.h * 0.36 } : { x: f.x, y: f.y, w: f.w * 0.32, h: f.h };
    const screen = tall ? { x: f.x, y: f.y + face.h, w: f.w, h: f.h - face.h } : { x: f.x + face.w, y: f.y, w: f.w - face.w, h: f.h };
    // the face region of the source, at the face band's own shape
    let sh = clamp(L.fs != null ? L.fs : 0.32, 0.08, 1) * vh;
    let sw = sh * (face.w / face.h);
    if (sw > vw) { sw = vw; sh = sw * (face.h / face.w); }
    const sx = clamp((L.fx != null ? L.fx : 0.85) * vw - sw / 2, 0, vw - sw);
    const sy = clamp((L.fy != null ? L.fy : 0.2) * vh - sh / 2, 0, vh - sh);
    try { ctx.drawImage(el, sx, sy, sw, sh, face.x, face.y, face.w, face.h); } catch (e) {}
    coverDraw(ctx, el, vw, vh, screen, L.sx != null ? L.sx : 0.5, 0.5);
    ctx.fillStyle = "#111210";
    if (tall) ctx.fillRect(f.x, f.y + face.h - line / 2, f.w, line);
    else ctx.fillRect(f.x + face.w - line / 2, f.y, line, f.h);
  }

  /* Where the picture is inside the stage: the export's frame, as large as
     the stage allows. Since 0.32.0 the preview IS a drawing of the export
     frame (drawPreviewPicture), so texts, captions and overlays are placed
     against exactly the frame the file has, in the window and fullscreen. */
  function pictureBox() {
    const stage = $("stage");
    const sw = stage.clientWidth || 0, sh = stage.clientHeight || 0;
    if (!sw || !sh) return { x: 0, y: 0, w: sw || 1, h: sh || 1 };
    const size = exportSize();
    const k = Math.min(sw / size.w, sh / size.h);
    const w = size.w * k, h = size.h * k;
    return { x: (sw - w) / 2, y: (sh - h) / 2, w: w, h: h };
  }

  function fadeAlpha(info) {
    if (!info) return 0;
    const c = info.clip, d = dispDur(c), o = info.offset;
    let a = 0;
    if (c.fadeIn && o < c.fadeIn) a = 1 - o / c.fadeIn;
    if (c.fadeOut && d - o < c.fadeOut) a = Math.max(a, 1 - (d - o) / c.fadeOut);
    return clamp(a, 0, 1);
  }

  /* Every frame: the overlay player in time, the picture drawn (clips,
     transitions, overlay, fades, effects: drawPreviewPicture), then texts
     and captions on top (drawPreviewCaptions). */
  function syncOverlays() {
    syncBroll();
    drawPreviewPicture();
    drawPreviewCaptions();
  }


  // live karaoke captions on a canvas over the video — what you see here is
  // the same drawCaptions() code the export uses, so preview matches output
  function drawPreviewCaptions() {
    const cv = $("capCanvas");
    if (!cv) return;
    const stage = $("stage");
    const w = stage.clientWidth || 0, h = stage.clientHeight || 0;
    if (!w || !h) return;
    // drawn at the screen's own pixel density, so captions are as sharp as the export
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw) cv.width = pw;
    if (cv.height !== ph) cv.height = ph;
    const ctx = cv.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    // lower thirds and title cards, inside the picture, under the captions; then the logo
    const marked = S.clips.length && BRAND.mark && BRAND.mark !== "off" && BRAND.logo;
    if (S.texts.length || marked || brollAt(S.time)) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const box = pictureBox();
      drawTexts(ctx, box, S.time, textHits);
      drawOverlayHandle(ctx, box);
      drawTextGuides(ctx, box);
      // headings on the picture can be pinched, so the browser must not take two fingers for itself
      $("stage").classList.toggle("text-on", textHits.size > 0);
      if (marked) drawWatermark(ctx, box);
    }
    const C = global_SenotelCaptions();
    if (C && S.captions && S.captions.length) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // inside the picture, not the whole stage: the export frame IS the picture
      C.drawCaptions(ctx, S.captions, S.time, capDrawOpts(pictureBox()));
    }
  }

  function updateTransport() {
    $("tCur").textContent = fmt(S.time);
    $("tTot").textContent = fmt(total());
    if (!seekDragging) { $("seekBar").value = total() ? (S.time / total()) * 1000 : 0; paintSeek(); }
    $("tlTimecode").textContent = fmt1(S.time);
  }

  /* The playhead does not travel — the timeline does, and the playhead stays
     under your thumb in the middle of the screen. That is the single thing
     that makes a timeline feel like CapCut rather than like a video player
     with a progress bar, and it costs almost nothing here: with half a
     viewport of padding at each end, keeping the playhead centred is exactly
     scrollLeft === time × pps. The inverse is just as cheap, which is what
     makes dragging the timeline scrub (see the scroll listener below). */
  let scrollLock = false;      // true while WE move the scroll, so the listener stays quiet

  function padL() {
    return Math.max(PADX, Math.round($("tlScroll").clientWidth / 2));
  }

  function updatePlayheadUI() {
    const sc = $("tlScroll");
    $("playhead").style.left = padL() + S.time * S.pps + "px";
    const want = S.time * S.pps;
    if (Math.abs(sc.scrollLeft - want) > 0.5) {
      scrollLock = true;
      sc.scrollLeft = want;
      /* Released on the next frame, not immediately: the scroll event this
         assignment causes is delivered asynchronously, and clearing the flag
         synchronously would let it through and fight the playhead. */
      requestAnimationFrame(() => { scrollLock = false; });
    }
  }

  // Advance the timeline. When a video clip is playing, DERIVE the time from
  // the video element's own hardware clock instead of the wall clock. The old
  // wall-clock approach drifted from the video (worse when frames ran slow,
  // e.g. drawing captions), and every time drift passed 0.28s syncMedia forced
  // a corrective seek — the ~1s stutter. Sampling the video's clock keeps them
  // in lockstep, so the only remaining seek is one per cut, at the boundary.
  function advanceTime(dt) {
    const info = clipAt(S.time);
    if (!info) { S.time += dt; return; }
    const m = mediaById(info.clip.mediaId);
    const ready = m && m.type === "video" &&
      pv.dataset.mid === String(m.id) && pv.readyState >= 2 && !pv.seeking;
    if (!ready) { S.time += dt; return; } // image, or video still loading/seeking
    if (pv.currentTime >= info.clip.out - 0.03) {
      S.time = info.start + dispDur(info.clip) + 0.001; // clip done → next boundary
    } else {
      const derived = info.start + (pv.currentTime - info.clip.in) / (info.clip.speed || 1);
      S.time = clamp(derived, info.start, info.start + dispDur(info.clip));
    }
  }

  function frameTick(ts) {
    // the fast export owns S.time while it renders; the preview sits still
    if (EXP.fast) { lastTs = ts; return; }
    const dt = Math.min((ts - lastTs) / 1000, 0.1);
    lastTs = ts;
    if (S.playing) {
      advanceTime(dt);
      /* Fire BEFORE the end check. pause() clears S.playing, so a sound sitting
         on the final frame was skipped every time — and on an export that is
         the stinger the whole edit was building to. */
      fireSfxUpTo(S.time);
      if (S.time >= total() - 0.001) {
        S.time = total();
        if (EXP.active) finishExport();
        /* Reaching the end is not the same as being stopped: let whatever is
           still ringing ring out, or the last sound is clipped in the file. */
        pause(true);
      }
    }
    syncMedia();
    syncMusic();
    mixMusic();
    mixBlend();
    syncAudioClips();
    applyBleep();
    syncOverlays();
    updateTransport();
    updatePlayheadUI();
    if (EXP.active && !EXP.suspended) { drawExportFrame(); watchExportStall(ts); }
  }

  function loop(ts) {
    // Exactly one owner advances playback: worker while exporting, rAF otherwise.
    if (!EXP.active || !window.SenotelRenderClock || !SenotelRenderClock.running) frameTick(ts);
    requestAnimationFrame(loop);
  }

  /* ═══════════ AI EDIT ENGINE ═══════════ */

  function aiGenerate(prompt, seed) {
    const p = (prompt || "").toLowerCase();
    const rnd = rand(seed * 7919 + 13);

    // target length
    let target = null;
    let m = p.match(/(\d+)\s*(?:seconds|second|secs|sec|s\b)/);
    if (m) target = +m[1];
    else if ((m = p.match(/(\d+)\s*(?:minutes|minute|mins|min)/))) target = +m[1] * 60;
    const srcTotal = S.media.reduce((s, x) => s + (x.duration || IMG_DUR), 0);
    if (!target) target = clamp(Math.round(srcTotal * 0.45), 10, 60);

    // pacing
    const fast = /fast|quick|energetic|upbeat|punchy|hype|exciting|action|reel|tiktok/.test(p);
    const slow = /slow(?![ -]?mo)|calm|emotional|relax|chill|peaceful|gentle/.test(p);
    const cutMin = fast ? 1.0 : slow ? 3.6 : 2.0;
    const cutMax = fast ? 2.2 : slow ? 6.5 : 4.0;

    // look
    let filter = "none";
    if (/cinema|film|movie/.test(p)) filter = "cinematic";
    else if (/vintage|retro|old school|8mm|90s|80s/.test(p)) filter = "vintage";
    else if (/black and white|b&w|noir|monochrome|dramatic|moody/.test(p)) filter = "noir";
    else if (/vibrant|colorful|colourful|vivid|pop/.test(p)) filter = "vivid";
    else if (/warm|golden|sunset|summer|cozy/.test(p)) filter = "warm";
    else if (/cool|cold|winter|blue/.test(p)) filter = "cool";
    else if (/dream|soft|hazy|aesthetic/.test(p)) filter = "dreamy";

    const slowmo = /slow[- ]?mo|slow motion/.test(p);

    // title
    let title = null;
    m = prompt.match(/"([^"]{1,40})"|'([^']{1,40})'/);
    if (m) title = m[1] || m[2];
    else if ((m = p.match(/titled\s+([a-z0-9 ,!&']{2,36})/))) {
      title = m[1].trim().replace(/\b\w/g, (ch) => ch.toUpperCase());
    }

    // build clips: cycle footage, sampling different parts each pass
    const clips = [];
    const cursors = {};
    let t = 0, guard = 0;
    const pool = S.media.slice();
    if (rnd() > 0.5 && pool.length > 2) pool.push(pool.shift()); // variation per take

    while (t < target && guard < 400) {
      const mItem = pool[guard % pool.length];
      guard++;
      let len = cutMin + rnd() * (cutMax - cutMin);
      let cin = 0, cout;
      if (mItem.type === "video" && mItem.duration > 0.5) {
        const dur = mItem.duration;
        len = Math.min(len, dur);
        let cur = cursors[mItem.id];
        if (cur === undefined) cur = rnd() * Math.max(0, dur - len) * 0.3;
        cin = cur + len > dur ? Math.max(0, dur - len) : cur;
        cout = Math.min(cin + len, dur);
        cursors[mItem.id] = cout + dur * 0.08 >= dur ? 0 : cout + dur * 0.05;
      } else {
        cout = Math.min(len, 3.5);
      }
      const speed = slowmo && mItem.type === "video" ? 0.5 : 1;
      clips.push({
        id: nextId++, mediaId: mItem.id, in: cin, out: cout,
        speed: speed, volume: 1, muted: false, filter: filter
      });
      t += (cout - cin) / speed;
    }

    const texts = [];
    if (title && t > 1) {
      texts.push({ id: nextId++, text: title, start: 0.3, dur: Math.min(2.8, t - 0.4), size: 46, color: "#ffffff", pos: "center" });
    }

    return {
      clips: clips,
      texts: texts,
      summary: clips.length + " cuts · " + Math.round(t) + "s · " +
        (filter === "none" ? "natural look" : FILTERS[filter].label + " look") +
        (title ? " · titled “" + title + "”" : "")
    };
  }

  function applyGenerated(g) {
    S.vertical = !!g.vertical;
    g.clips.forEach((c) => { if (c.id === undefined) c.id = nextId++; });
    g.texts.forEach((t) => { if (t.id === undefined) t.id = nextId++; });
    S.clips = g.clips;
    S.texts = g.texts;
    S.captions = []; // fresh edit → drop any prior karaoke; rebuilt below
    S.broll = [];    // and any b-roll from the previous draft
    /* The Director's sounds and music belong to the edit they were made for,
       so a new edit replaces them. Anything placed or chosen by hand carries
       no `by` mark and stays exactly where it is. */
    S.sfx = S.sfx.filter((x) => x.by !== "director");
    if (S.music && S.music.by === "director") { S.music = null; loadMusicElement(); }
    S.sel = null;
    S.time = 0;
    commit();
    renderTimeline();
    renderInspector();
  }

  // The AI edit's captions ARE the karaoke system now: build them word-timed
  // right after a generation, so the "process" produces karaoke, not the old
  // sentence-captions. Best-effort — a failure just leaves the edit uncaptioned.
  /* ═══════════ B-ROLL INSERTION ═══════════
     The Director asks for GIFs/images by DESCRIPTION; the fetching happens here,
     after the timeline already exists. That ordering is deliberate — the edit is
     usable the moment the draft lands, and a search that fails or a download
     that times out costs one cutaway rather than the whole generate.
     Each item arrives as a blob (see media.js) so it behaves exactly like
     uploaded footage: trimmable, undoable, and safe for the export canvas. */
  /* Where a b-roll overlay begins is worked out by brain.js (placeBroll):
     on the words it illustrates, in timeline seconds (`want.at`). It used to
     be a third of a second into a whole clip, whatever was being said there,
     which is what made the GIFs look random (owner, 2026-10-08). */

  /* Returns the entrance sounds of the cutaways it placed, as timeline
     moments for placeSounds(): a cutaway the search never found takes its
     sound with it, which is why sounds are placed after this and not before. */
  async function addBroll(list, say) {
    const D = (window.SenotelDiag && window.SenotelDiag.last) || {};
    const entrances = [];
    if (!list || !list.length) { D.broll = "none requested by the Director"; return entrances; }
    if (!window.SenotelBroll || !SenotelBroll.available()) { D.broll = "not configured"; return entrances; }

    let added = 0;
    const total0 = total();

    for (const want of list) {
      // no moment, no cutaway: searching would only spend the quota
      if (typeof want.at !== "number" || !isFinite(want.at)) continue;
      const start = want.at;
      const latest = total0 - want.dur - 1.2;
      if (latest < 0.2 || start > latest) continue;
      if (say) say("Finding b-roll: " + want.query + "…");
      let file = null;
      try { file = await SenotelBroll.find(want.query, want.kind, want.say); } catch (e) {}
      if (!file) continue;

      const media = {
        id: nextId++, url: file.url, type: file.type, name: file.name,
        duration: file.type === "image" ? want.dur : 0,
        w: file.w || 0, h: file.h || 0,
        thumb: file.type === "image" ? file.url : null,
        broll: true
      };
      S.media.push(media);
      keepFile(media, file.blob);          // survives a tab discard like any clip
      // analysed like any other footage, so the square crop can follow the
      // subject rather than blindly centre-cropping — see drawExportFrame
      queueAnalysis(media);
      if (file.type === "video") loadVideoMeta(media);

      /* An OVERLAY, not a clip. Inserting b-roll as a clip meant the speaker's
         clip stopped playing for its duration — so the narration cut out every
         time a GIF appeared, which is the opposite of how b-roll works. Laid
         over the timeline instead, the voice underneath simply keeps going. */
      /* Never in the closing stretch (checked above, before any search): a
         cutaway over the final moments has nothing left to illustrate and
         reads as a stray clip bolted on the end. */
      S.broll.push({
        id: nextId++, mediaId: media.id,
        start: Math.max(0, start),
        dur: want.dur,
        mode: want.mode === "cover" ? "cover" : "square"   // square is the default
      });
      added++;
      if (want.sfx) entrances.push({ name: want.sfx, at: Math.max(0, start), why: "cutaway appears" });
    }
    if (added) {
      S.broll.sort((a, b) => a.start - b.start);
      D.broll = added + " of " + list.length + " placed";
      commit();
      renderAll();
      renderTimeline();
    } else if (!D.broll || D.broll.indexOf("relevant") < 0) {
      D.broll = "0 of " + list.length + " placed";
    }
    return entrances;
  }

  /* Draw/position the active overlay. Sized against the PICTURE box, exactly
     like headings, so window / fullscreen / export all agree. */
  function brollAt(t) {
    for (const b of S.broll) if (t >= b.start && t < b.start + b.dur) return b;
    return null;
  }

  /* ═══════════ B-ROLL GEOMETRY ═══════════
     Default is a SQUARE, centred, sitting above the caption band.

     0.60 of frame width is not arbitrary: a square that wide occupies almost
     exactly ONE FIFTH of the frame's area (0.60² = 0.36 of width² — on 9:16
     that works out at ~20%), which is the proportion short-form editors
     actually use for a reaction overlay. Big enough to read on a phone, small
     enough that the speaker is still the subject.

     0.42 for the vertical centre keeps it clear of two things: the platform's
     top chrome (TikTok reserves the first ~160px of 1920 for username and
     track) and the captions, which sit at 0.76 of frame height. */
  const BROLL_SIZE = 0.60;    // of frame WIDTH — ≈1:5 of frame area
  const BROLL_CY = 0.42;      // centre, above the 0.76 caption band


  const pvB = $("pvB"), piB = $("piB");

  /* The overlay's player, kept at the overlay's own point in its footage
     (looping, as in the export). It is drawn by renderPicture, not shown. */
  function syncBroll() {
    const b = brollAt(S.time);
    const m = b ? mediaById(b.mediaId) : null;
    if (!m || m.type !== "video") { if (!pvB.paused) pvB.pause(); return; }
    if (pvB.dataset.mid !== String(m.id)) {
      pvB.src = m.url;
      pvB.dataset.mid = String(m.id);
    }
    if (pvB.readyState < 1) return;
    const local = S.time - b.start;
    const want = m.duration ? local % m.duration : local;
    const drift = Math.abs(pvB.currentTime - want);
    if (S.playing) {
      if (pvB.paused) pvB.play().catch(() => {});
      if (drift > 0.3 && !pvB.seeking) { try { pvB.currentTime = want; } catch (e) {} }
    } else {
      if (!pvB.paused) pvB.pause();
      if (drift > 0.05 && !pvB.seeking) { try { pvB.currentTime = want; } catch (e) {} }
    }
  }

  async function autoCaption() {
    const hasSpeech = S.clips.some((c) => {
      const m = mediaById(c.mediaId);
      return m && m.type === "video";
    });
    if (!hasSpeech) return;
    /* Auto-captioning must never be the thing that silently starts a ~40 MB
       model download. brain.js already refuses to transcribe unless the model
       is cached, but this path ran straight afterwards on EVERY generate and
       pulled it anyway — so a first edit appeared to hang right after the draft
       landed. Once the model is on the device this costs nothing and captions
       appear on their own; before that, the Captions button is the opt-in. */
    let ready = false;
    const C = global_SenotelCaptions();
    // the CAPTION model (caption-worker.js), not the Director's small one
    if (C && C.tierReady) { try { ready = await C.tierReady(C.defaultTier()); } catch (e) {} }
    if (!ready) {
      toast("Tap Captions to add word-by-word subtitles (one-time model download)", 5000);
      return;
    }
    try { await buildCaptions({ silent: true }); } catch (e) { /* leave uncaptioned */ }
  }

  /* ═══════════ THE DIRECTOR'S SOUND ═══════════
     The Director chose moments and a music brief; brain.js decides the
     placements, the levels and the track. This is only the part that touches
     the project: the timeline, the library search, the status line.

     Ownership is the one rule. What the Director adds carries by:"director"
     and belongs to the edit it was made for, so the next generate replaces it
     (applyGenerated). Anything placed or chosen by hand carries no mark and is
     never touched: the Director's sounds make room for it, and its music is
     never swapped out. */

  function diagLast() { return (window.SenotelDiag && window.SenotelDiag.last) || {}; }

  function placeDirectorSounds(moments, entrances) {
    const D = diagLast();
    const want = (moments || []).concat(entrances || []);
    if (!want.length) { D.sfx = "none chosen"; return 0; }
    if (!sfxAvailable() || !window.SenotelBrain || !SenotelBrain.placeSounds) {
      D.sfx = "unavailable in this browser";
      return 0;
    }
    const placed = SenotelBrain.placeSounds({ want: want, clips: S.clips, media: S.media, keep: S.sfx });
    const dropped = want.length - placed.length;
    if (!placed.length) { D.sfx = "none placed, " + dropped + " left out by the editing rules"; return 0; }
    placed.forEach((p) => {
      S.sfx.push({ id: nextId++, name: p.name, start: p.start, gain: p.gain, by: "director" });
    });
    /* "4 (whoosh ×2, pop, boom)" — what the status line needs to say whether
       the Director used the library well, without opening the timeline. */
    const tally = {};
    placed.forEach((p) => { tally[p.name] = (tally[p.name] || 0) + 1; });
    const e = sfxEngine();
    const names = Object.keys(tally).map((n) => {
      const info = e && e.info(n);
      const label = ((info && info.label) || n).toLowerCase();
      return tally[n] > 1 ? label + " ×" + tally[n] : label;
    });
    D.sfx = placed.length + " (" + names.join(", ") + ")" +
      (dropped ? ", " + dropped + " left out by the editing rules" : "");
    commit();
    renderTimeline();
    return placed.length;
  }

  /* Resolves true unless the library itself failed: "nothing suitable" and
     "no music" are answers, an unreachable library is a missing finishing
     touch, and the completion notice says so. */
  async function addDirectorMusic(want, say) {
    const D = diagLast();
    // Whatever music survived applyGenerated() was chosen by hand.
    if (S.music) { D.music = "kept your choice"; return true; }
    if (!want) { D.music = "none chosen"; return true; }
    if (!want.use) { D.music = "none" + (want.why ? " (" + want.why + ")" : ""); return true; }
    const B = window.SenotelBrain;
    const plan = B && B.musicPlan ? B.musicPlan(want, { clips: S.clips, media: S.media }) : null;
    if (!plan) { D.music = "none chosen"; return true; }
    if (say) say("Choosing music…");
    let track = null, failure = null;
    for (const q of plan.queries) {
      let found;
      try { found = await searchMusic(q); }
      catch (err) { failure = err; if (err && err.message === "rate") break; continue; }
      track = B.pickTrack(found, { query: q, length: total(), speech: plan.speech });
      if (track) break;
    }
    if (!track) {
      D.music = failure
        ? (failure.message === "rate" ? "the library's daily search limit was reached" : "the library could not be reached")
        : "nothing suitable for “" + want.query + "”";
      return !failure;
    }
    // A track picked by hand while the search ran wins over the Director's.
    if (S.music) { D.music = "kept your choice"; return true; }
    S.music = {
      id: track.id, title: track.title, url: track.url, duration: track.duration,
      creator: track.creator, landing: track.landing,
      gain: plan.gain, by: "director", query: want.query
    };
    loadMusicElement();
    commit();
    renderTimeline();
    D.music = "“" + track.title + "” for “" + want.query + "”" +
      (plan.level === "forward" ? ", leading" : "");
    return true;
  }

  /* ─── Format picker & speech toggle ─── */

  let generating = false;

  /* No format picker any more — this is Auto mode, so the brain infers the
     format from the footage and the prompt. Shorts/Recap/Film/Story become
     separate editing modes later, not chips in this one. */

  const spChip = $("speechChip");
  function refreshSpeechChip() {
    spChip.classList.toggle("selected", speechOn());
    spChip.textContent = speechOn() ? "Speech: on" : "Speech: off";
  }
  spChip.addEventListener("click", () => {
    localStorage.setItem("vclyps-speech", speechOn() ? "0" : "1");
    refreshSpeechChip();
    toast(speechOn()
      ? "Speech understanding on. The speech model (about 100 MB) downloads the first time it's used, and captions use it too"
      : "Speech understanding off");
  });
  refreshSpeechChip();

  /* ─── The AI bar ─── */

  /* Manual edits are learning signals for Vision-1.0: what users fix by
     hand is what the AI got wrong. Stored on-device only, like all data. */
  function recordEdit(action, details) {
    if (!window.IntelligenceEngine) return;
    IntelligenceEngine.record({
      kind: "user-edit", action: action, details: details || null,
      provider: (window.SenotelDiag && window.SenotelDiag.last && window.SenotelDiag.last.provider) || null
    });
  }

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function renderAiStatus(summary) {
    const el = $("aiStatus");
    const D = (window.SenotelDiag && window.SenotelDiag.last) || {};
    // every diagnostic dump carries the build, so a pasted console log is
    // enough to know exactly what the user was running
    if (window.SenotelVersion) D.build = window.SenotelVersion.label;
    const bits = [];
    const NAMES = { gemini: "Gemini", mistral: "Mistral", groq: "Groq", "vision-1": "Vision-1.0" };
    if (NAMES[D.provider]) {
      bits.push("<b>Director: " + NAMES[D.provider] + " ✓</b>");
      // a fallback that ran silently looks like nothing happened — say which
      // one stepped in, and why the preferred one didn't
      if (D.provider !== "gemini" && D.gemini && D.gemini !== "ok") {
        bits.push('<span class="warn">Gemini unavailable: ' + escHtml(D.gemini) + "</span>");
      }
    } else {
      bits.push("<b>Director: on-device brain</b>");
      ["gemini", "mistral", "groq"].forEach((k) => {
        if (D[k] && D[k] !== "ok") bits.push('<span class="warn">' + NAMES[k] + ": " + escHtml(D[k]) + "</span>");
      });
    }
    if (D.whisper) {
      bits.push(D.whisper.indexOf("failed") === 0
        ? '<span class="warn">Speech: ' + escHtml(D.whisper) + "</span>"
        : "Speech: " + escHtml(D.whisper));
    }
    if (D.analysis) bits.push("Vision: " + escHtml(D.analysis));
    // surfaced so a 503 that was survived is visible, not silent
    if (D.geminiRetry) bits.push("Retry: " + escHtml(D.geminiRetry));
    // the hook is the single most important element — if it's wrong or absent,
    // that must be readable from the status line rather than guessed at
    if (D.hook) {
      bits.push(D.hook === "none produced"
        ? '<span class="warn">Hook: none produced</span>'
        : "Hook: “" + escHtml(D.hook) + "”");
    }
    if (D.opener) bits.push("Opens: " + escHtml(D.opener));
    // "no GIFs appeared" has three very different causes — none asked for, none
    // relevant enough, or the fetch failed. Without this they look identical.
    if (D.broll) bits.push("B-roll: " + escHtml(D.broll));
    // same reasoning: "no music" and "no sounds" each have several causes
    if (D.music) bits.push("Music: " + escHtml(D.music));
    if (D.sfx) bits.push("Sounds: " + escHtml(D.sfx));
    /* The VERSION, last. Not decoration: an error that is impossible in the
       current code means the browser is running an older file — uploaded late,
       not yet published, or cached. Without this you cannot tell a real bug
       from stale code, and you debug something that isn't running. */
    if (window.SenotelVersion) bits.push("v" + window.SenotelVersion.version);
    if (D.brainError) bits.push('<span class="warn">Error: ' + escHtml(D.brainError) + "</span>");
    el.innerHTML = bits.join(" &nbsp;·&nbsp; ");
    el.classList.remove("hidden");
    try { console.log("[vClyps status]", JSON.parse(JSON.stringify(D)), summary || ""); } catch (e) {}
  }

  $("semiGenerate").addEventListener("click", () => {
    if (finding) { finding.cancel(); return; }          // the button reads Stop while finding
    if (S.find.on) { runFind(); return; }
    /* Audio files are not footage: the Director cuts pictures, and a sound
       file handed to it as a "source" would be planned as a black clip. */
    if (S.mode === "business" && narrow()) { briefOpen = false; showBrief(); }
    runEdit({ prompt: $("semiPrompt").value.trim(), media: S.media.filter((m) => m.type !== "audio") });
  });

  /* One edit, start to finish. Edit runs it over everything in the project;
     Make runs it over one found clip (opts.range), with the clip's own
     keyframes and a direction built from why it was chosen. */
  async function runEdit(opts) {
    if (EXP.active || EXP.starting) { toast("Let your export finish before starting another edit."); return; }
    if (!(opts.media || S.media).some((m) => m.type !== "audio")) { toast("Add footage first. Tap Add below the preview"); return; }
    if (generating) return;
    if (finding) { toast("Clips are still being found. Stop that first, or wait for it to finish."); return; }
    warmAudio();   // while this click still counts as a gesture: see warmAudio()
    if (window.SenotelNotices) SenotelNotices.dismiss("doneCard");
    generating = true;
    stayAwake("generate");
    if (window.SenotelDiag) window.SenotelDiag.last = {};
    const prompt = opts.prompt || "";
    const media = opts.media || S.media;
    pause();

    /* Progress goes to the STATUS LINE, not just a toast. Watching footage and
       transcribing can take tens of seconds, and toasts vanish after four —
       so the screen used to sit there looking broken with no way to tell
       whether anything was happening. The button also has to say so, or the
       obvious move is to press it again. */
    const btn = $("semiGenerate");
    const btnLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Working…";
    const line = $("aiStatus");
    const elapsed0 = Date.now();
    const progress = (s) => {
      const secs = Math.round((Date.now() - elapsed0) / 1000);
      line.innerHTML = "<b>✦ " + escHtml(s) + "</b>" + (secs > 3 ? " &nbsp;·&nbsp; " + secs + "s" : "");
      line.classList.remove("hidden");
    };
    progress("Getting started…");

    let g = null;
    let directorFailure = null;
    try {
      if (window.SenotelBrain) {
        if (window.IntelligenceEngine && IntelligenceEngine.checkAccess) await IntelligenceEngine.checkAccess();
        await SenotelBrain.prepare(media, { speech: speechOn(), status: progress });
        let range = null;
        if (opts.range) {
          progress("Looking at the clip…");
          const item = mediaById(opts.range.mediaId);
          let keyframes = [];
          try { keyframes = await SenotelClips.rangeKeyframes(item, opts.range.start, opts.range.end, 6); } catch (e) {}
          range = { mediaId: opts.range.mediaId, start: opts.range.start, end: opts.range.end, keyframes: keyframes };
        }
        progress("Directing the edit…");
        g = await SenotelBrain.plan({
          prompt: prompt, media: media, seed: S.seed++, format: S.format === "auto" ? null : S.format,
          range: range, target: opts.target || null,
          mode: S.mode, brief: S.mode === "business" ? Object.assign({}, S.brief) : null,
          /* A track the creator picked by hand is theirs: the Director is told
             it exists and plans around it rather than choosing another. */
          music: { available: navigator.onLine !== false, chosen: S.music && S.music.by !== "director" ? S.music.title : null }
        });
      }
    } catch (e) {
      g = null;
      directorFailure = e;
      if (window.SenotelDiag) window.SenotelDiag.last.brainError = (e && e.message) || String(e);
    }
    try {
      if (directorFailure) throw directorFailure;
      if (!g || !g.clips.length) throw new Error("The AI Director could not prepare an edit. Reload the app and retry; your timeline has not been changed.");
      applyGenerated(g);
      // Business mode: the product name and call to action, as the video's last clip
      if (g.endCard) {
        try {
          const card = await cardClip(Object.assign({ style: "card", size: 48, color: BRAND.text, bg: BRAND.main }, g.endCard), "end", true);
          if (card) {
            // the card is the last word: no title runs onto it
            const cardStart = total() - dispDur(card);
            S.texts = S.texts.filter((t) => t.start < cardStart - 0.6);
            S.texts.forEach((t) => { t.dur = Math.min(t.dur, cardStart - t.start); });
            commit();
            renderTimeline();
          }
        } catch (_) {}
      }
      progress("Finishing b-roll and captions…");
      // Caption timings depend on the final b-roll sequence. Keep this job
      // owned until both have settled; only then is a completion alert honest.
      let extrasFailed = false;
      let entrances = [];
      try { entrances = await addBroll(g.broll, progress); } catch (_) { extrasFailed = true; }
      try { await autoCaption(); } catch (_) { extrasFailed = true; }
      /* Sound last: effects are timed against the finished timeline, cutaways
         included, and a cutaway that was never found takes its sound with it. */
      try { placeDirectorSounds(g.sfx, entrances); } catch (_) { extrasFailed = true; }
      try { if (!(await addDirectorMusic(g.music, progress))) extrasFailed = true; } catch (_) { extrasFailed = true; }
      // ccl5: the cuts onto the music's beat (a failure leaves the edit as it is)
      try { progress("Putting the cuts on the beat…"); await beatsAfterEdit(); } catch (_) {}
      routeDirectorAudio();
      if (opts.onDone) opts.onDone();
      writeSession();
      $("doneDownload").classList.add("hidden");
      notifyDone("Your edit is ready", extrasFailed
        ? "Your draft is ready. Some finishing touches were unavailable."
        : "Your timeline is ready to review and export.", "edit");
      renderAiStatus(g.summary);
      if (!document.hidden) play();
    } catch (e) {
      const message = "Couldn't finish the edit. " + ((e && e.message) || "Please try again.");
      line.textContent = message;
      line.classList.remove("hidden");
      toast(message, 6000);
    } finally {
      /* Always, even if the above threw. Leaving generating true locks the
         Edit button on "Working…" for the rest of the session. */
      generating = false;
      letItSleep("generate");
      btn.disabled = false;
      btn.textContent = btnLabel;
    }
  }

  /* ═══════════ FIND CLIPS ═══════════
     The bar's second job. The prompt becomes "what should the clips be
     about", the row under it says how long and from where, and the result is
     a ranked list in the Clips sheet. clips.js does the work; this is only
     the controls, the progress and the list. */

  // Which recording to search: the one being worked on, else the longest.
  function findSource() {
    const sel = S.sel && S.sel.type === "clip" ? clipById(S.sel.id) : null;
    const pick = (id) => { const m = mediaById(id); return m && m.type === "video" ? m : null; };
    if (sel && pick(sel.mediaId)) return pick(sel.mediaId);
    const onTimeline = S.clips.map((c) => pick(c.mediaId)).filter(Boolean)[0];
    if (onTimeline) return onTimeline;
    return S.media.filter((m) => m.type === "video").sort((a, b) => (b.duration || 0) - (a.duration || 0))[0] || null;
  }

  function applyFindMode() {
    const on = !!S.find.on;
    const chip = $("findChip");
    chip.classList.toggle("selected", on);
    chip.setAttribute("aria-pressed", on ? "true" : "false");
    $("findRow").classList.toggle("hidden", !on);
    if (!finding) $("semiGenerate").textContent = on ? "Find" : "Edit";
    $("findLen").value = S.find.len || "auto";
    $("findGenre").value = S.find.genre || "auto";
    $("findFrom").value = S.find.from || "";
    $("findTo").value = S.find.to || "";
    refreshFindSrc();
    fitPromptPlaceholder();
  }

  function refreshFindSrc() {
    const el = $("findSrc");
    if (!el || !window.SenotelClips) return;
    const src = findSource();
    el.textContent = src ? "In " + src.name + (src.duration ? ", " + SenotelClips.fmt(src.duration) : "") : "Add a video to search";
  }

  function renderClipsChip() {
    const n = S.found && S.found.clips ? S.found.clips.length : 0;
    const chip = $("clipsChip");
    chip.classList.toggle("hidden", !n);
    chip.textContent = "Clips · " + n;
  }

  $("findChip").addEventListener("click", () => {
    if (finding) return;
    S.find.on = !S.find.on;
    applyFindMode();
    saveSession();
  });
  $("clipsChip").addEventListener("click", () => { renderClips(); openSheet("clipsSheet"); });
  $("findLen").addEventListener("change", () => { S.find.len = $("findLen").value; saveSession(); });
  $("findGenre").addEventListener("change", () => { S.find.genre = $("findGenre").value; saveSession(); });
  ["findFrom", "findTo"].forEach((id) => {
    $(id).addEventListener("input", () => {
      $(id).classList.remove("bad");
      S.find[id === "findFrom" ? "from" : "to"] = $(id).value.trim();
      saveSession();
    });
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") $("semiGenerate").click(); });
  });

  async function runFind() {
    if (EXP.active || EXP.starting) { toast("Let your export finish first."); return; }
    if (generating) { toast("Let your edit finish first."); return; }
    const item = findSource();
    if (!item) { toast("Add a video first. Find clips works on one recording at a time"); return; }
    const from = SenotelClips.parseTime($("findFrom").value);
    const to = SenotelClips.parseTime($("findTo").value);
    if (Number.isNaN(from)) { $("findFrom").classList.add("bad"); toast("Start time should look like 12:30"); return; }
    if (Number.isNaN(to)) { $("findTo").classList.add("bad"); toast("End time should look like 45:00"); return; }
    if (from != null && to != null && to <= from) { $("findTo").classList.add("bad"); toast("The end has to come after the start"); return; }

    if (window.SenotelDiag) window.SenotelDiag.last = {};
    if (window.SenotelNotices) SenotelNotices.dismiss("doneCard");
    pause();
    const jb = SenotelClips.job();
    finding = jb;
    stayAwake("find");
    const btn = $("semiGenerate");
    btn.textContent = "Stop";
    $("findChip").disabled = true;
    const line = $("aiStatus");
    const t0 = Date.now();
    let said = "Getting started…";
    const say = (s) => {
      said = s;
      const secs = Math.round((Date.now() - t0) / 1000);
      const clock = secs >= 60 ? Math.floor(secs / 60) + "m " + (secs % 60) + "s" : secs + "s";
      line.innerHTML = "<b>✦ " + escHtml(s) + "</b>" + (secs > 3 ? " &nbsp;·&nbsp; " + clock : "");
      line.classList.remove("hidden");
    };
    // the clock keeps moving between messages; a frozen one reads as a hang
    const ticker = setInterval(() => say(said), 1000);
    jb.onCancel(() => clearInterval(ticker));
    say(said);
    try {
      const res = await SenotelClips.find(item, {
        prompt: $("semiPrompt").value.trim(),
        length: S.find.len,
        genre: S.find.genre || "auto",
        from: from, to: to,
        job: jb, say: say,
        cache: { get: idbGet, put: idbPut }
      });
      S.found = res;
      renderClipsChip();
      saveSession();
      const n = res.clips.length;
      const D = (window.SenotelDiag && window.SenotelDiag.last) || {};
      line.innerHTML = n
        ? "<b>" + n + " clip" + (n === 1 ? "" : "s") + " found in " + escHtml(item.name) + "</b>" +
          (D.provider && D.provider !== "gemini" ? " &nbsp;·&nbsp; Director: " + escHtml(D.provider) : "") +
          (res.signals ? "" : ' &nbsp;·&nbsp; <span class="warn">Sound and face detection unavailable, found from speech and picture changes</span>')
        : "<b>No clips found</b>" + (res.prompt ? " about “" + escHtml(res.prompt) + "”. Try other words, or clear the box for the best moments." : ". Try a different stretch of the video.");
      if (n) {
        notifyDone("Your clips are ready", n + " clip" + (n === 1 ? "" : "s") + " found in " + item.name + ".", "edit");
        renderClips();
        openSheet("clipsSheet");
      }
    } catch (e) {
      if (e instanceof SenotelClips.Cancelled) {
        line.innerHTML = "<b>Stopped.</b> Nothing was changed.";
      } else {
        const message = "Couldn't find clips. " + ((e && e.message) || "Please try again.");
        line.textContent = message;
        toast(message, 6000);
      }
      line.classList.remove("hidden");
    } finally {
      clearInterval(ticker);
      finding = null;
      letItSleep("find");
      $("findChip").disabled = false;
      applyFindMode();
    }
  }

  function clipLabel(c) {
    const len = Math.round(c.end - c.start);
    const kind = c.type ? c.type.charAt(0).toUpperCase() + c.type.slice(1) : "";
    return SenotelClips.fmt(c.start) + " to " + SenotelClips.fmt(c.end) + " · " + len + "s" + (kind ? " · " + kind : "");
  }

  function renderClips() {
    const list = $("clipList"), none = $("clipsNone");
    list.innerHTML = "";
    stopClipWatch();
    const f = S.found;
    const item = f ? mediaById(f.mediaId) : null;
    $("clipsWhere").textContent = item ? item.name : "";
    if (!f || !item || !f.clips.length) {
      none.textContent = "No clips yet. Turn on Find clips and press Find.";
      none.classList.remove("hidden");
      return;
    }
    none.classList.add("hidden");
    f.clips.forEach((c, i) => {
      const row = mk("div", "snd-row mus-row clip-row" + (c.made ? " made" : ""));
      const meta = mk("div", "mus-meta");
      /* The title is the clip's name, and it can be changed right here:
         it names the project (and so the exported file) when the clip is
         made. */
      const head = mk("div", "clip-name-row");
      head.appendChild(mk("span", "clip-num", (i + 1) + "."));
      const title = document.createElement("input");
      title.type = "text";
      title.className = "clip-title";
      title.maxLength = 80;
      title.value = c.title;
      title.setAttribute("aria-label", "Name of clip " + (i + 1));
      title.addEventListener("change", () => {
        const v = title.value.replace(/\s+/g, " ").trim();
        if (v) { c.title = v; saveSession(); } else title.value = c.title;
      });
      title.addEventListener("keydown", (e) => { if (e.key === "Enter") title.blur(); });
      head.appendChild(title);
      meta.appendChild(head);
      const when = mk("span", "mus-by", "");
      when.textContent = clipLabel(c);
      meta.appendChild(when);
      if (c.why) {
        const why = mk("span", "clip-why", "");
        why.textContent = c.why;
        meta.appendChild(why);
      }
      row.appendChild(meta);

      const hear = mk("button", "snd-hear", "");
      hear.title = "Watch";
      hear.setAttribute("aria-label", "Watch clip " + (i + 1));
      hear.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
      hear.addEventListener("click", () => watchClip(item, c));

      const make = mk("button", "snd-add", c.made ? "Make again" : "Make");
      make.title = "Edit this clip into a finished short on the timeline";
      make.addEventListener("click", () => makeClip(c));

      row.appendChild(hear);
      row.appendChild(make);
      list.appendChild(row);
    });
  }

  let watchStop = null;
  function stopClipWatch() {
    const v = $("clipWatch");
    if (watchStop) { v.removeEventListener("timeupdate", watchStop); watchStop = null; }
    try { v.pause(); } catch (e) {}
  }
  function watchClip(item, c) {
    const v = $("clipWatch");
    stopClipWatch();
    pause();
    v.classList.remove("hidden");
    if (v.dataset.mid !== String(item.id)) { v.src = item.url; v.dataset.mid = String(item.id); }
    const go = () => {
      v.currentTime = c.start;
      v.play().catch(() => {});
      watchStop = () => { if (v.currentTime >= c.end) stopClipWatch(); };
      v.addEventListener("timeupdate", watchStop);
    };
    if (v.readyState >= 1) go(); else v.addEventListener("loadedmetadata", go, { once: true });
  }

  function makeClip(c) {
    const f = S.found;
    const item = f ? mediaById(f.mediaId) : null;
    if (!item) { toast("That recording isn't in the project any more"); return; }
    if (generating || finding) { toast("Let the current job finish first"); return; }
    closeSheets();
    const direction = "Make this one moment into a finished short. It was chosen because: " + (c.why || c.title) + "." +
      (c.hook ? " A hook idea from the speaker's own words: \"" + c.hook + "\"." : "") +
      (f.prompt ? " The creator asked for clips about: " + f.prompt + "." : "");
    runEdit({
      prompt: direction, media: [item],
      range: { mediaId: item.id, start: c.start, end: c.end },
      target: Math.round(c.end - c.start),
      onDone: () => {
        c.made = true;
        // the clip's name becomes the project's, and so the exported file's
        if (c.title) { $("projectName").value = c.title; $("projectName").dispatchEvent(new Event("input")); saveSession(); }
      }
    });
  }
  applyFindMode();
  renderClipsChip();
  $("semiPrompt").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("semiGenerate").click();
  });

  /* The prompt bar shares its row with ✦ and Edit, so on a phone there is
     very little width left. Keep the placeholder to something that actually
     fits and only spell the invitation out where there is room for it; the
     full sentence stays on the input's title either way. */
  function fitPromptPlaceholder() {
    const el = $("semiPrompt");
    const wide = el.clientWidth >= 340;
    el.placeholder = S.find.on
      ? (wide ? "What should the clips be about? Blank finds the best" : "Clips about…")
      : (wide ? "Tell vClyps what you want, or leave blank" : "Describe your edit…");
  }
  window.addEventListener("resize", fitPromptPlaceholder);
  window.addEventListener("resize", () => {
    if ($("screen-editor").classList.contains("active")) renderTimeline();
  });
  fitPromptPlaceholder();

  /* ═══════════ EXPORT (real, in-browser) ═══════════ */

  const EXP = {
    active: false,     // recording right now
    starting: false,   // priming the first frame — also blocks a second run
    cancelled: false,
    rec: null, chunks: [], canvas: null, ctx: null, ext: "webm",
    lastT: -1, stallTs: 0,  // stall watchdog
    suspended: false,       // browser cannot safely record while hidden
    stream: null, track: null, clockTs: 0, run: 0
  };
  let audioCtx = null, audioDest = null, audioGraphFailed = false;

  /* Desktop export uses a worker clock and explicit canvas capture, so it
     does not depend on visible-page animation frames. This is best effort:
     mobile suspension, closing the page and OS sleep still stop local work.
     No synthetic audio, wake-lock hacks, or server uploads are used. */

  function backgroundExportReady() {
    return window.SenotelRenderClock && SenotelRenderClock.running &&
      EXP.track && typeof EXP.track.requestFrame === "function";
  }

  function stopRenderClock() {
    if (window.SenotelRenderClock) SenotelRenderClock.stop();
    EXP.clockTs = 0;
    lastTs = performance.now();
  }

  function exportTick(ts) {
    if (!EXP.active || EXP.suspended) return;
    // A real-time recorder cannot repair a long scheduling gap after it has
    // happened. Discard that run rather than download a file with frozen frames.
    if (EXP.clockTs && ts - EXP.clockTs > 1000) {
      abortExport("The browser interrupted recording. Keep this tab visible and try again.");
      return;
    }
    EXP.clockTs = ts;
    if (document.hidden && audioCtx && audioCtx.state !== "running") { suspendExport(); return; }
    try { frameTick(ts); } catch (e) { abortExport((e && e.message) || "Frame rendering failed"); }
  }

  /* ── screen wake lock ─────────────────────────────────────────────────────
     Reference-counted, because an export and an AI edit can both want it and
     whichever finishes first must not drop the lock the other is relying on.
     The browser releases the lock on its own whenever the page is hidden, so
     it has to be re-taken on the way back — that is not an error case, it is
     the documented behaviour. */
  let wakeLock = null;
  /* Named owners rather than a count. A counter leaks the moment one path
     throws between its ++ and its --, and a leaked screen-wake lock is a phone
     that never sleeps again this session. With names, releasing twice is
     harmless and forgetting to release is the only way to leak. */
  const wakeOwners = new Set();

  async function takeWakeLock() {
    if (wakeLock || !wakeOwners.size) return;
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) {
      /* Refused on a page that is already hidden, in some embedded webviews,
         and when the battery is critically low. None of those are worth
         interrupting the user for — the job still runs, the screen just may
         sleep. */
      wakeLock = null;
    }
  }

  function stayAwake(who) {
    wakeOwners.add(who);
    takeWakeLock();
  }

  function letItSleep(who) {
    wakeOwners.delete(who);
    if (wakeOwners.size || !wakeLock) return;
    try { wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  /* ── an export that survives being backgrounded ───────────────────────────
     Pausing the RECORDER as well as the playback is the part that matters. The
     recorder is capturing a live canvas: leave it running while the page is
     frozen and it records however many seconds of the last painted frame the
     browser felt like giving it, which is a stutter in the middle of the file
     that nothing later can remove. */
  function suspendExport() {
    if (!EXP.active || EXP.suspended) return;
    EXP.suspended = true;
    try { if (EXP.rec && EXP.rec.state === "recording") EXP.rec.pause(); } catch (e) {}
    pause();
    $("expStatus").textContent = "paused, come back to vClyps to carry on";
  }

  function resumeExport() {
    if (!EXP.active || !EXP.suspended) return;
    EXP.suspended = false;
    /* The gap while hidden is not a stall. Without this reset the first frame
       back carries a timestamp seconds older than the watchdog's patience and
       the export is killed the instant the user returns. */
    EXP.lastT = -1;
    EXP.stallTs = 0;
    EXP.clockTs = 0;
    lastTs = performance.now();
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    try { if (EXP.rec && EXP.rec.state === "paused") EXP.rec.resume(); } catch (e) {}
    /* Deliberately NOT play(): it rewinds to 0 when the playhead is within a
       breath of the end, which on a render that was nearly finished would
       start the whole thing again. */
    S.playing = true;
    resetSfxCursor();
    $("playIco").classList.add("hidden");
    $("pauseIco").classList.remove("hidden");
    $("expStatus").textContent = "rendering…";
  }

  function notifyDone(title, body, kind) {
    if (window.SenotelNotices) SenotelNotices.complete(title, body, kind);
    else toast(title, 6000);
  }

  window.addEventListener("vclyps:open-result", () => {
    if (!booting) showScreen("editor");
  });

  /* ── the one listener that ties it together ───────────────────────────────
     There is already a visibilitychange handler for writing the session; this
     is a second, separate one on purpose. That one must run and finish even if
     anything here throws, because losing the session snapshot loses the user's
     project. */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (EXP.active && !backgroundExportReady()) suspendExport();
      return;
    }
    takeWakeLock();     // the browser dropped it when we were hidden
    resumeExport();
  });
  document.addEventListener("freeze", suspendExport);
  window.addEventListener("pagehide", suspendExport);

  function ensureAudioGraph() {
    /* audioDest, not audioCtx, is what says the graph exists: the context can
       be running with nothing tapped into it yet (warmAudio). */
    if (audioDest || audioGraphFailed) return;
    // Build into locals and only publish on FULL success. A media element can
    // be tapped by createMediaElementSource exactly once, so a throw halfway
    // through used to leave audioCtx set but audioDest undefined — every later
    // export then silently lost its audio. The failure is permanent by nature,
    // so remember it rather than rebuilding a broken graph on each attempt.
    try {
      const ctx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaElementSource(pv);
      const dest = ctx.createMediaStreamDestination();
      const bus = buildMasterBus(ctx, dest);
      /* The footage's sound goes through one gain, the "speech" stage, so a
         swear word can be silenced and bleeped in both places at once. */
      const speech = ctx.createGain();
      // pv's own level, for the sound blend across a transition (mixBlend)
      const pg = ctx.createGain();
      src.connect(pg);
      pg.connect(speech);
      pvGain = pg;
      speech.connect(bus);             // speakers and the export file, through the ceiling
      /* The music listens to the speech stage to know when to step back
         (see mixMusic). An analyser is a tap: nothing it hears changes. */
      const listen = ctx.createAnalyser();
      listen.fftSize = 1024;
      speech.connect(listen);
      audioCtx = ctx;
      audioDest = dest;
      masterBus = bus;
      speechGain = speech;
      speechListen = listen;
    } catch (e) {
      audioGraphFailed = true;
      throw e;
    }
    /* The other clip of a transition plays in #pvT. It was silent; it now
       feeds the speech stage through its own gain, at 0 until a transition
       blends it in. Separate, so a failure here leaves pvT muted and the
       footage's sound untouched. */
    try {
      const ts = audioCtx.createMediaElementSource(pvT);
      const tg = audioCtx.createGain();
      tg.gain.value = 0;
      ts.connect(tg);
      tg.connect(speechGain);
      pvTGain = tg;
      pvT.muted = false;
    } catch (e) { pvTGain = null; }
    buildBleep();
  }

  /* Every frame: the sound across a transition (ccl1). pv plays the clip
     under the playhead and pvT the other side; each gets its equal-power
     share of the window. Outside a transition pv is at 1 and pvT silent. */
  let pvGain = null, pvTGain = null;
  function mixBlend() {
    if (!pvGain || !audioCtx) return;
    let main = 1, other = 0;
    const live = S.playing || EXP.active;
    const tr = live ? transitionAt(S.time) : null;
    if (tr && tr.b.tAudio !== false) {
      const at = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
      const mainIsA = !!(at && at.clip === tr.a);
      const o = mainIsA ? tr.b : tr.a;
      main = mainIsA ? blendOut(tr.p) : blendIn(tr.p);
      const vol = o.muted ? 0 : (o.volume == null ? 1 : o.volume);
      other = (mainIsA ? blendIn(tr.p) : blendOut(tr.p)) * vol * (S.userMuted && !EXP.active ? 0 : 1);
    }
    const now = audioCtx.currentTime;
    try { pvGain.gain.setTargetAtTime(main, now, 0.01); } catch (e) { pvGain.gain.value = main; }
    if (pvTGain) { try { pvTGain.gain.setTargetAtTime(other, now, 0.01); } catch (e) { pvTGain.gain.value = other; } }
  }

  /* ── the bleep ────────────────────────────────────────────────────────────
     A 1 kHz tone that runs silently the whole time and is opened, while the
     speech stage is closed, for exactly the span of each swear word. Driven
     by the playhead every frame, so it lands in the preview and the export
     alike. Built separately so a failure here can never take the footage's
     sound down with it. */
  let speechGain = null, beepGain = null, bleepOn = false;
  let masterBus = null, speechListen = null;

  /* ── the master bus ───────────────────────────────────────────────────────
     Everything the edit makes a sound with (the footage, the music, audio
     clips, sound effects, the bleep) meets here, then goes through ONE
     ceiling to the speakers and to the export. Before this each source went
     out on its own, so a riser tail, a boom and a loud line could sum past
     full scale and clip in the file (measured: airhorn + boom peaked 1.55).
     The ceiling is a fast, hard compressor at -1.5 dB: below it nothing
     changes, above it the peak is held. Web Audio's compressor adds its own
     make-up gain (measured 1.1034 with these settings, 2026-10-21), so a
     trim after it puts quiet material back exactly where it was. */
  const CEILING_MAKEUP = 1.1034;
  function buildMasterBus(ctx, dest) {
    const bus = ctx.createGain();
    let out = bus;
    try {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1.5;
      lim.knee.value = 0;
      lim.ratio.value = 20;
      lim.attack.value = 0.002;
      lim.release.value = 0.15;
      const trim = ctx.createGain();
      trim.gain.value = 1 / CEILING_MAKEUP;
      bus.connect(lim);
      lim.connect(trim);
      out = trim;
    } catch (e) { out = bus; }   // no compressor: still one bus, just no ceiling
    out.connect(ctx.destination);  // speakers (preview)
    out.connect(dest);             // the export file
    return bus;
  }
  let bleepCache = { cues: null, key: "", spans: [] };
  function buildBleep() {
    if (beepGain || !audioCtx || !audioDest) return;
    try {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 1000;
      const g = audioCtx.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(masterBus);
      osc.start();
      beepGain = g;
    } catch (e) { beepGain = null; }
  }

  function bleepSpansNow() {
    const C = global_SenotelCaptions();
    const key = S.capLang + "|" + (S.capOpts.swears || []).join(",");
    if (bleepCache.cues === S.captions && bleepCache.key === key) return bleepCache.spans;
    const isBad = capMatcher(S.capLang);
    /* Started early on purpose. The footage's sound reaches the audio graph
       ahead of the playhead the bleep is timed by: the browser feeds a video's
       sound into Web Audio from a buffer, measured 0.06 to 0.27 s ahead in
       exports (2026-10-07), varying from run to run, not growing. A late
       bleep lets the first syllable through, which is the whole word heard,
       so the bleep is timed 0.32 s early; with that lead it always lands
       from just before the word to just after it. */
    const raw = C && isBad ? C.bleepSpans(S.captions, isBad) : [];
    const spans = [];
    raw.map((s) => [s[0] - 0.28, s[1]]).sort((a, b) => a[0] - b[0]).forEach((s) => {
      const last = spans[spans.length - 1];
      if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
      else spans.push(s);
    });
    bleepCache = { cues: S.captions, key: key, spans: spans };
    return spans;
  }

  function applyBleep() {
    if (!speechGain || !audioCtx) return;
    let on = false;
    if (S.capOpts.censor === "bleep" && S.captions.length && (S.playing || EXP.active)) {
      const spans = bleepSpansNow();
      for (let i = 0; i < spans.length; i++) {
        if (S.time >= spans[i][0] && S.time < spans[i][1]) { on = true; break; }
      }
    }
    if (on === bleepOn) return;
    bleepOn = on;
    const now = audioCtx.currentTime;
    try {
      speechGain.gain.setTargetAtTime(on ? 0 : 1, now, 0.004);
      if (beepGain) beepGain.gain.setTargetAtTime(on ? 0.2 : 0, now, 0.004);
    } catch (e) {}
  }

  /* The music bed is its own media element, and it has to be tapped into the
     SAME graph as the video or the export records the edit without it.

     Deliberately a separate, guarded step rather than part of
     ensureAudioGraph(): an element can be tapped exactly once, and if the
     music tap were inside that try, one failure there would take the video's
     audio down with it. Here a failure costs only this: the music still plays
     in the preview, straight from the element, but is missing from the file,
     and that is reported rather than hidden. */
  let musicRouted = false, musicRouteFailed = false, musicGain = null;
  const musicEl = $("musicEl");

  function ensureMusicRoute() {
    if (musicRouted || musicRouteFailed || !audioCtx || !audioDest || !musicEl) return;
    try {
      const src = audioCtx.createMediaElementSource(musicEl);
      musicGain = audioCtx.createGain();
      src.connect(musicGain);
      musicGain.connect(masterBus);              // speakers and the exported file
      musicRouted = true;
      applyMusicGain();
    } catch (e) {
      musicRouteFailed = true;
      if (window.SenotelDiag) window.SenotelDiag.last.music = "not routed into the export: " + ((e && e.message) || e);
    }
  }

  /* Loudness is set in exactly one place, and which place depends on the
     routing. Once the element feeds the graph, its own .volume is left at 1
     and the gain node does the work, because browsers disagree about whether
     an element's volume still applies after it has been tapped. */
  function applyMusicGain() {
    if (!musicEl) return;
    const g = clamp(musicBase(), 0, 1);
    if (musicRouted && musicGain) {
      musicEl.muted = false;
      musicEl.volume = 1;
      musicGain.gain.value = S.userMuted ? 0 : g * musicFade(S.time) * duck;
    } else {
      musicEl.volume = g;
      musicEl.muted = !!S.userMuted;
    }
  }

  /* ── the music's level, every frame ─────────────────────────────────────
     The bed's level is the volume chosen × a loudness match × its fades ×
     the duck. Set from the frame loop, so the preview and the export (which
     plays the same timeline) get the same mix.

     LOUDNESS MATCH: tracks arrive at any level, and the Director picks them
     unheard, so each is measured once (measureMusic) and brought to the same
     loudness before the volume slider applies. `norm` is kept on S.music.

     FADES: in over fadeIn seconds from the start of the edit, out over
     fadeOut seconds into its end, so the bed never starts or stops with a
     cut. Defaults 0.3 s and 1.5 s; both are in the music's settings.

     DUCKING: the music listens to the footage's own sound (the speech stage,
     through an analyser, which changes nothing it hears). While someone is
     talking it steps down to DUCK_TO, quickly (80 ms), and comes back up
     slowly (450 ms) once they have been quiet for DUCK_HOLD, so it does not
     pump between words. It works on any footage with nothing to analyse in
     advance, and the export hears exactly what the preview does. */
  const DUCK_TO = 0.4;        // about -8 dB under speech
  const DUCK_ON = 0.012;      // speech-stage RMS that counts as talking (about -38 dBFS)
  const DUCK_HOLD = 0.35;     // seconds of quiet before the music comes back
  /* The loudness every track is matched to (gated RMS, about -14 dBFS): where
     an ordinary finished track already sits, so a typical bed sounds as it
     always did and only the too-quiet and too-loud ones move. */
  const MUSIC_TARGET = 0.2;
  let duck = 1, duckHeld = 0, mixLast = 0, listenBuf = null;

  function musicBase() {
    if (!S.music) return 0;
    const g = clamp(typeof S.music.gain === "number" ? S.music.gain : 0.35, 0, 1);
    const norm = typeof S.music.norm === "number" ? S.music.norm : 1;
    return g * norm;
  }

  /* Where the music sits on the timeline. Like every other clip it can be
     moved and trimmed (0.30.1): start and end in timeline seconds (no end =
     to the end of the edit), and in, how far into the song it starts.
     Older projects have none of these and play from 0 to the end, as before. */
  function musicSpan() {
    if (!S.music) return { from: 0, to: 0, at: 0 };
    const end = total();
    const from = clamp(S.music.start || 0, 0, end);
    const to = S.music.end != null ? clamp(S.music.end, from, end) : end;
    return { from: from, to: to, at: S.music.in || 0 };
  }

  function musicFade(t) {
    if (!S.music) return 1;
    const fi = typeof S.music.fadeIn === "number" ? S.music.fadeIn : 0.3;
    const fo = typeof S.music.fadeOut === "number" ? S.music.fadeOut : 1.5;
    const sp = musicSpan();
    if (t < sp.from || t > sp.to) return 0;
    let k = 1;
    if (fi > 0 && t - sp.from < fi) k *= clamp((t - sp.from) / fi, 0, 1);
    if (fo > 0 && t > sp.to - fo) k *= clamp((sp.to - t) / fo, 0, 1);
    return k;
  }

  function speechLevel() {
    if (!speechListen) return 0;
    if (!listenBuf) listenBuf = new Float32Array(speechListen.fftSize);
    try { speechListen.getFloatTimeDomainData(listenBuf); } catch (e) { return 0; }
    let s = 0;
    for (let i = 0; i < listenBuf.length; i++) s += listenBuf[i] * listenBuf[i];
    return Math.sqrt(s / listenBuf.length);
  }

  function mixMusic() {
    if (!musicRouted || !musicGain || !audioCtx || !S.music) return;
    const now = performance.now();
    const dt = mixLast ? Math.min(0.25, (now - mixLast) / 1000) : 0;
    mixLast = now;
    const ducking = S.music.duck !== false;
    const live = S.playing || EXP.active;
    if (ducking && live && speechLevel() > DUCK_ON) duckHeld = DUCK_HOLD;
    else duckHeld = Math.max(0, duckHeld - dt);
    const want = ducking && duckHeld > 0 ? DUCK_TO : 1;
    const tau = want < duck ? 0.08 : 0.45;
    duck += (want - duck) * (dt ? 1 - Math.exp(-dt / tau) : 0);
    const level = S.userMuted && !EXP.active ? 0 : clamp(musicBase(), 0, 1) * musicFade(S.time) * duck;
    try { musicGain.gain.setTargetAtTime(level, audioCtx.currentTime, 0.015); }
    catch (e) { musicGain.gain.value = level; }
    if (window.SenotelDiag) window.SenotelDiag.mix = { level: level, duck: duck, norm: S.music.norm };
  }

  /* Measured once per track: the whole file decoded at a low rate (mono
     16 kHz is plenty to judge loudness and keeps a 3-minute track near
     11 MB), RMS over 400 ms blocks, blocks more than 20 dB under the loudest
     ignored so a quiet intro does not count as the track's level, and the
     result turned into a factor towards MUSIC_TARGET, capped at 4x so a near
     silent file is not blown up. */
  const musicNorms = new Map();   // url → factor, so undo/redo never re-measures
  async function measureMusic() {
    const m = S.music;
    if (!m || !m.url || typeof m.norm === "number") return;
    if (musicNorms.has(m.url)) { m.norm = musicNorms.get(m.url); applyMusicGain(); return; }
    musicNorms.set(m.url, 1);     // one measurement at a time per track
    try {
      const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Ctx) return;
      const bytes = await (await fetch(m.url)).arrayBuffer();
      const ctx = new Ctx(1, 1, 16000);
      const buf = await new Promise((res, rej) => {
        const p = ctx.decodeAudioData(bytes, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      const n = Math.round(buf.sampleRate * 0.4);
      const blocks = [];
      for (let o = 0; o + n <= buf.length; o += n) {
        let s = 0, chs = buf.numberOfChannels;
        for (let c = 0; c < chs; c++) {
          const d = buf.getChannelData(c);
          for (let i = o; i < o + n; i++) s += d[i] * d[i];
        }
        blocks.push(Math.sqrt(s / (n * chs)));
      }
      const top = Math.max(1e-6, ...blocks);
      const kept = blocks.filter((b) => b > top * 0.1);
      const rms = Math.sqrt(kept.reduce((a, b) => a + b * b, 0) / Math.max(1, kept.length));
      const norm = rms > 1e-4 ? clamp(MUSIC_TARGET / rms, 0.25, 4) : 1;
      musicNorms.set(m.url, norm);
      if (S.music && S.music.url === m.url) { S.music.norm = norm; applyMusicGain(); saveSession(); }
    } catch (e) {
      musicNorms.delete(m.url);   // a failed fetch can be tried again next time
    }
  }

  /* ═══════════ BEATS (ccl5, 0.35.0) ═══════════
     Where the music's beats are (beats.js), shown as marks on the music,
     used for snapping, for "Cut to the beat", and by the Director: after an
     AI edit picks its music, the cuts move onto the nearest beat (never
     into a spoken word), and in Business mode the cut into the end card
     lands on a strong one. Analysed once per track, kept in memory only. */
  const beatJobs = new Map();   // url → Promise of the analysis (or null)
  const beatDone = new Map();   // url → the analysis, once known
  function beatsOf(url) {
    if (!url || !window.SenotelBeats) return Promise.resolve(null);
    if (!beatJobs.has(url)) {
      beatJobs.set(url, (async () => {
        const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!Ctx) return null;
        const bytes = await (await fetch(url)).arrayBuffer();
        const ctx = new Ctx(1, 1, 16000);
        const buf = await new Promise((res, rej) => { const p = ctx.decodeAudioData(bytes, res, rej); if (p && p.then) p.then(res, rej); });
        const a = SenotelBeats.analyze(buf.getChannelData(0), buf.sampleRate);
        a.dur = buf.duration;
        beatDone.set(url, a);
        return a;
      })().catch(() => { beatJobs.delete(url); return null; }));
    }
    return beatJobs.get(url);
  }
  function analyzeCurrentBeats() {
    const url = S.music && S.music.url;
    if (!url || beatDone.has(url)) return;
    beatsOf(url).then((a) => { if (a && S.music && S.music.url === url) { renderTimeline(); if (S.sel && S.sel.type === "music") renderInspector(); } });
  }
  /* The beats on the timeline, in timeline seconds: the song's own beats
     wherever the (looping) bed plays them, plus the marks the user added
     (S.music.marks, seconds after the music's start, so they move with it). */
  function musicBeatTimes(all) {
    const m = S.music;
    if (!m) return [];
    const out = [];
    const sp = musicSpan();
    const a = beatDone.get(m.url);
    if (a && a.beats.length && a.dur > 1 && (all || m.beatMarks !== false)) {
      const strong = new Set(window.SenotelBeats.strongBeats(a));
      for (let k = 0; k < 2000; k++) {
        const base = sp.from - sp.at + k * a.dur;
        if (base > sp.to) break;
        a.beats.forEach((b) => { const t = base + b; if (t >= sp.from - 1e-6 && t <= sp.to + 1e-6) out.push({ t: t, strong: strong.has(b) }); });
      }
    }
    (m.marks || []).forEach((x) => { const t = sp.from + x; if (t >= sp.from && t <= sp.to) out.push({ t: t, strong: true, mine: true }); });
    return out.sort((p, q) => p.t - q.t);
  }
  // whether `t` (source seconds) falls inside a spoken word of media m
  function insideWord(m, t) {
    return !!(m && m.words && m.words.some((w) => t > w.start + 0.02 && t < w.end - 0.02));
  }
  /* Move each cut between clips onto the nearest beat within `win` seconds,
     by lengthening or shortening the clip before it; everything after the
     cut moves with it (texts, overlays, sounds, audio, effects; captions are
     remapped). A cut that would land inside a spoken word, or past the
     footage, stays. strongLast: the last cut takes only a strong beat (the
     Business end card). Returns how many cuts moved. */
  function cutsToBeats(win, strongLast) {
    const beats = musicBeatTimes(true);
    if (!beats.length || S.clips.length < 2) return 0;
    const lists = [S.texts, S.broll, S.sfx, S.audio, S.effects];
    let acc = 0, moved = 0;
    for (let i = 0; i < S.clips.length - 1; i++) {
      const c = S.clips[i];
      acc += dispDur(c);
      const pool = strongLast && i === S.clips.length - 2 ? beats.filter((b) => b.strong) : beats;
      let best = null;
      pool.forEach((b) => { const d = b.t - acc; if (Math.abs(d) <= win && (best === null || Math.abs(d) < Math.abs(best))) best = d; });
      if (best === null || Math.abs(best) < 0.01) continue;
      const sp = c.speed || 1, m = mediaById(c.mediaId);
      const out = c.out + best * sp;
      if (out - c.in < 0.3) continue;
      if (m && m.type === "video" && out > (m.duration || c.out) - 0.02) continue;
      if (insideWord(m, out)) continue;
      const was = acc;
      c.out = out;
      acc += best;
      moved++;
      lists.forEach((list) => list.forEach((x) => { if (x.start >= was - 1e-6) x.start += best; }));
    }
    if (moved && S.captions.length) remapCaptions();
    return moved;
  }
  // The music's Beats panel: marks on or off, your own marks, Cut to the beat
  function beatsPanel(box) {
    const m = S.music;
    if (!m) return;
    const a = beatDone.get(m.url);
    if (!a) {
      analyzeCurrentBeats();
      box.appendChild(mk("p", "panel-note", window.SenotelBeats ? "Finding the beat…" : "Beats aren't available here. Reload the page."));
    } else {
      box.appendChild(mk("p", "panel-note", a.bpm ? a.bpm + " BPM · " + musicBeatTimes(true).length + " beats under your video" : "No steady beat in this track."));
    }
    box.appendChild(group("Beat marks", chipsRow([[true, "Show"], [false, "Hide"]], m.beatMarks !== false, (v) => { if (v) delete m.beatMarks; else m.beatMarks = false; renderTimeline(); })));
    const row = mk("div", "filter-chips");
    const add = mk("button", "fchip", "Add a mark here");
    add.addEventListener("click", () => {
      const sp = musicSpan();
      if (S.time < sp.from || S.time > sp.to) { toast("Move the playhead over the music first"); return; }
      const x = +(S.time - sp.from).toFixed(3);
      m.marks = (m.marks || []).filter((y) => Math.abs(y - x) > 0.05).concat([x]).sort((p, q) => p - q);
      buzz("light");
      commit(); renderTimeline(); renderInspector();
    });
    row.appendChild(add);
    if (m.marks && m.marks.length) {
      const clear = mk("button", "fchip", "Clear my marks");
      clear.addEventListener("click", () => { delete m.marks; commit(); renderTimeline(); renderInspector(); });
      row.appendChild(clear);
    }
    box.appendChild(group("Your marks", row));
    const cut = mk("button", "primary-btn", "Cut to the beat");
    cut.type = "button";
    cut.addEventListener("click", async () => {
      await beatsOf(m.url);
      if (!musicBeatTimes(true).length) { toast("No beat found in this music"); return; }
      const n = cutsToBeats(0.25, false);
      if (!n) { toast("Your cuts are already on the beat, or too far from one to move"); return; }
      commit(); renderTimeline(); syncNow();
      recordEdit("cut-to-beat", { moved: n });
      toast(n + (n === 1 ? " cut" : " cuts") + " moved onto the beat");
    });
    box.appendChild(group("Cuts", cut));
  }

  // after an AI edit: wait (a little) for the beats, then put the cuts on them
  async function beatsAfterEdit() {
    const D = (window.SenotelDiag && window.SenotelDiag.last) || {};
    if (!S.music || !S.music.url) { D.beats = "no music"; return; }
    const url = S.music.url;
    const a = await Promise.race([beatsOf(url), new Promise((r) => setTimeout(() => r("late"), 20000))]);
    if (a === "late") { D.beats = "still analysing the music (cuts left as they are)"; return; }
    if (!a) { D.beats = "the music could not be read for beats"; return; }
    if (!a.beats.length) { D.beats = "no steady beat in this music"; return; }
    if (!S.music || S.music.url !== url) return;
    const moved = cutsToBeats(0.15, S.mode === "business");
    D.beats = a.bpm + " BPM · " + moved + (moved === 1 ? " cut" : " cuts") + " on the beat";
    if (moved) { commit(); renderTimeline(); }
  }

  /* Point the element at the current bed, or clear it. Idempotent, so every
     path that changes S.music (use, undo, redo, reload, reset) can call it
     without worrying whether anything actually changed. */
  function loadMusicElement() {
    if (!musicEl) return;
    if (!S.music || !S.music.url) {
      if (!musicEl.paused) musicEl.pause();
      if (musicEl.getAttribute("src")) { musicEl.removeAttribute("src"); try { musicEl.load(); } catch (e) {} }
      return;
    }
    if (musicEl.getAttribute("src") !== S.music.url) {
      musicEl.src = S.music.url;
      musicEl.loop = true;
      try { musicEl.load(); } catch (e) {}
    }
    applyMusicGain();
    measureMusic();
    analyzeCurrentBeats();
  }

  /* Kept locked to the playhead the same way the video is: sampled every
     frame, corrected only when it has genuinely drifted, because seeking an
     audio element on every frame makes it stutter. The bed loops, so the
     position is the playhead modulo the track length. */
  function syncMusic() {
    if (!musicEl || !S.music || !musicEl.getAttribute("src")) return;
    const dur = musicEl.duration || S.music.duration || 0;
    if (!dur || !isFinite(dur)) return;
    const sp = musicSpan();
    // outside its clip the music is silent: hold it still until the playhead comes back
    if (S.time < sp.from || S.time >= sp.to) { if (!musicEl.paused) musicEl.pause(); return; }
    const want = (S.time - sp.from + sp.at) % dur;
    if (S.playing) {
      if (Math.abs(musicEl.currentTime - want) > 0.3) {
        try { musicEl.currentTime = want; } catch (e) {}
      }
      if (musicEl.paused) musicEl.play().catch(() => {});
    } else {
      if (!musicEl.paused) musicEl.pause();
      if (Math.abs(musicEl.currentTime - want) > 0.05) {
        try { musicEl.currentTime = want; } catch (e) {}
      }
    }
  }

  /* Whether looks can be baked into the file at all. Canvas2D `filter` is the
     only way the export reproduces the grade the preview shows with a CSS
     filter; where it is missing (older Safari) the file comes out ungraded and
     nothing else in the pipeline notices. Better to warn than to ship it. */
  function canvasFilterSupported() {
    try {
      const c = document.createElement("canvas").getContext("2d");
      c.filter = "grayscale(1)";
      return c.filter === "grayscale(1)";
    } catch (e) { return false; }
  }

  /* Recording used to begin in the same tick as playback — before the video
     had loaded or seeked to the first clip's in-point — so exports opened on a
     black or stale frame. Hold until the real first frame is on the canvas,
     with a ceiling so a broken source delays the export instead of killing it. */
  function primeFirstFrame() {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tick = () => {
        syncMedia();
        const info = clipAt(0);
        const m = info && mediaById(info.clip.mediaId);
        const ready = !m || m.type !== "video" ||
          (pv.readyState >= 2 && !pv.seeking &&
           Math.abs(pv.currentTime - info.clip.in) < 0.35);
        if (ready || Date.now() - startedAt > 4000) resolve();
        else setTimeout(tick, 33);
      };
      tick();
    });
  }

  /* Choose the export frame from what is actually ON the timeline.
     Previously this was hardcoded 1280x720 unless the edit was flagged as a
     Short — so portrait phone footage exported on "Auto" landed pillarboxed
     inside a 16:9 frame: a narrow strip of picture surrounded by black, with
     the burned-in captions running out past the edges of the video.
     Orientation is weighted by how long each clip is on screen, so one stray
     landscape cutaway cannot flip an otherwise vertical edit. */
  /* Entertainment mode is SHORT-FORM, and short-form is 9:16 VERTICAL — TikTok,
     Reels and Shorts all render a 1080×1920 canvas. That is the default here
     regardless of how the footage was shot; landscape source gets cover-cropped
     toward the motion rather than letterboxed into bars.
     720×1280 keeps the ratio but encodes reliably in real time on a phone,
     where 1080×1920 drops frames.
     S.aspect overrides it when the user picks something else. */
  const ASPECTS = {
    "9:16": { w: 720, h: 1280 },
    "1:1":  { w: 1000, h: 1000 },
    "16:9": { w: 1280, h: 720 }
  };

  function exportSize() {
    if (S.aspect && ASPECTS[S.aspect]) return ASPECTS[S.aspect];
    if (S.vertical) return { w: 720, h: 1280 };   // Shorts are always 9:16
    let portrait = 0, landscape = 0, square = 0;
    S.clips.forEach((c) => {
      const m = mediaById(c.mediaId);
      if (!m || !m.w || !m.h) return;
      const d = dispDur(c);
      if (m.h > m.w * 1.05) portrait += d;
      else if (m.w > m.h * 1.05) landscape += d;
      else square += d;
    });
    // Nothing measured yet (metadata still loading) — fall back to whatever the
    // preview element currently reports, then to 16:9.
    if (!portrait && !landscape && !square) {
      const vw = pv.videoWidth, vh = pv.videoHeight;
      if (vw && vh) { if (vh > vw * 1.05) portrait = 1; else if (vw > vh * 1.05) landscape = 1; else square = 1; }
      else landscape = 1;
    }
    if (portrait >= landscape && portrait >= square) return { w: 720, h: 1280 };
    if (square > landscape) return { w: 900, h: 900 };
    return { w: 1280, h: 720 };
  }

  function pickMime() {
    // Every candidate names an AUDIO codec too — an mp4/webm string with only
    // a video codec makes MediaRecorder drop the audio track (that was the
    // "no sound on my phone" bug). MP4/H.264/AAC first for phone playback.
    const list = [
      ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "mp4"],
      ["video/mp4", "mp4"],
      ["video/webm;codecs=vp9,opus", "webm"],
      ["video/webm;codecs=vp8,opus", "webm"],
      ["video/webm;codecs=opus", "webm"],
      ["video/webm", "webm"]
    ];
    for (const pair of list) {
      if (MediaRecorder.isTypeSupported(pair[0])) return { mime: pair[0], ext: pair[1] };
    }
    return null;
  }

  /* ── Export settings (CapCut's export screen) ──
     Resolution on the short side, frame rate, and quality. Kept on this
     device, so the next export starts where the last one was set. The
     bitrate follows the picture: pixels × frames, then the quality step. */
  const EXPORT_OPTS = (() => {
    const base = { res: 1080, fps: 30, q: "rec", level: "on" };
    try { return Object.assign(base, JSON.parse(localStorage.getItem("vclyps-export") || "{}")); } catch (e) { return base; }
  })();
  const QUALITY = { low: 0.6, rec: 1, high: 1.6 };
  function exportBitrate(w, h, fps) {
    const perFrame = w * h * 0.16 * Math.pow(fps / 30, 0.75) * 30;
    return Math.round(clamp(perFrame * (QUALITY[EXPORT_OPTS.q] || 1), 2e6, 40e6));
  }
  function renderExportSheet() {
    [["exRes", "res"], ["exFps", "fps"], ["exQ", "q"], ["exLevel", "level"]].forEach(([id, k]) => {
      document.querySelectorAll("#" + id + " button").forEach((b) => b.classList.toggle("active", String(EXPORT_OPTS[k]) === b.dataset.v));
    });
    const s = fastSize();
    const br = exportBitrate(s.w, s.h, EXPORT_OPTS.fps);
    const mb = ((br + 192000) / 8 / 1048576) * total();
    $("exSize").textContent = s.w + " × " + s.h;
    $("exNote").textContent = "About " + (mb < 1 ? "under 1" : Math.round(mb)) + " MB for this " + Math.round(total()) + "-second video." +
      (EXPORT_OPTS.res >= 1440 ? " 2K needs a recent phone or computer; if this one can't, it exports at the size it can." : "");
  }
  (function wireExportSheet() {
    [["exRes", "res", Number], ["exFps", "fps", Number], ["exQ", "q", String], ["exLevel", "level", String]].forEach(([id, k, as]) => {
      document.querySelectorAll("#" + id + " button").forEach((b) => b.addEventListener("click", () => {
        EXPORT_OPTS[k] = as(b.dataset.v);
        try { localStorage.setItem("vclyps-export", JSON.stringify(EXPORT_OPTS)); } catch (e) {}
        renderExportSheet();
      }));
    });
    $("exGo").addEventListener("click", () => { closeSheets(); beginExport(); });
  })();

  $("exportBtn").addEventListener("click", () => {
    if (generating) { toast("Your edit is still finishing. Export when it's ready."); return; }
    if (EXP.active || EXP.starting) { toast("An export is already running"); return; }
    if (!S.clips.length) { toast("The timeline is empty. Add clips or generate an edit first"); return; }
    renderExportSheet();
    openSheet("exportSheet");
  });

  function beginExport() {
    if (EXP.active || EXP.starting) return;
    if (typeof MediaRecorder === "undefined") { toast("This browser can't record video. Try Chrome or Edge"); return; }
    const picked = pickMime();
    // the fast export first; it hands over to the real-time one if it can't run here
    if (window.SenotelFastExport) { startFastExport(picked); return; }
    if (!picked) { toast("This browser can't record video. Try Chrome or Edge"); return; }
    startExport(picked);
  }

  /* ═══════════ FAST EXPORT (export-fast.js) ═══════════
     Every frame rendered as fast as the device can, by drawExportFrame (the
     same drawing as the real-time export), and encoded by the device's video
     encoder; the sound mixed offline by renderMixOffline (the same rules as
     the live mix). 1080p, usually several times faster than real time, and it
     keeps going in a background tab. If this device lacks any part of it,
     or something fails, the real-time export runs instead, so an export
     never simply fails because the fast path did. */

  function fastSize() {
    const s = exportSize();
    const k = (EXPORT_OPTS.res || 1080) / Math.min(s.w, s.h);   // the chosen resolution on the short side
    // encoders want even sizes
    return { w: Math.round((s.w * k) / 2) * 2, h: Math.round((s.h * k) / 2) * 2 };
  }

  async function startFastExport(picked) {
    if (EXP.active || EXP.starting) return;
    const F = window.SenotelFastExport;
    /* The chosen size and frame rate, stepping down to the largest this
       device's encoder takes (2K, then 1080p, then 720p) rather than
       dropping to the slow export. */
    const FAST_FPS = EXPORT_OPTS.fps || 30;
    const want = EXPORT_OPTS.res || 1080;
    let size = fastSize(), sup = null;
    for (const res of [want, 1080, 720].filter((r, i, a) => r <= want && a.indexOf(r) === i)) {
      const s0 = exportSize(), k = res / Math.min(s0.w, s0.h);
      size = { w: Math.round((s0.w * k) / 2) * 2, h: Math.round((s0.h * k) / 2) * 2 };
      try { sup = await F.supported(size.w, size.h, FAST_FPS, exportBitrate(size.w, size.h, FAST_FPS)); } catch (e) { sup = { ok: false, why: (e && e.message) || "check failed" }; }
      if (sup.ok) break;
    }
    if (sup.ok && Math.min(size.w, size.h) < want) toast("This device can't encode " + (want >= 1440 ? "2K" : want + "p") + ", so it exports at " + Math.min(size.w, size.h) + "p", 5000);
    if (window.SenotelDiag) window.SenotelDiag.last.fastExport = sup.ok ? "yes" : "no: " + sup.why;
    if (!sup.ok) {
      if (!picked) { toast("This browser can't export video. Try Chrome or Edge"); return; }
      startExport(picked);
      return;
    }
    const run = ++EXP.run;
    if (window.SenotelNotices) SenotelNotices.dismiss("doneCard");
    EXP.starting = true;
    EXP.cancelled = false;
    EXP.fast = true;
    stayAwake("export");
    pause();
    const sources = new Map();
    const stillHere = () => run === EXP.run && !EXP.cancelled;
    try {
      $("exportOverlay").classList.remove("hidden");
      $("expTitle").textContent = "Exporting “" + ($("projectName").value.trim() || "Untitled") + "”…";
      $("expBar").style.width = "0%";
      $("expPct").textContent = "0%";
      $("expStatus").textContent = "getting ready…";
      await captionFontReady();
      await textFontsReady();
      await soundsReady();
      if (!stillHere()) return;

      $("expStatus").textContent = "mixing the sound…";
      const audio = await renderMixOffline();
      if (!stillHere()) return;
      levelExportSound(audio);

      EXP.canvas = document.createElement("canvas");
      EXP.canvas.width = size.w;
      EXP.canvas.height = size.h;
      EXP.vertical = size.h > size.w;
      EXP.ctx = EXP.canvas.getContext("2d");
      EXP.active = true;
      EXP.starting = false;

      const sourceFor = (m) => {
        if (!sources.has(m.id)) sources.set(m.id, F.frameSource(m));
        return sources.get(m.id);
      };
      const len = total();
      const blob = await F.encode({
        canvas: EXP.canvas,
        fps: FAST_FPS,
        bitrate: exportBitrate(size.w, size.h, FAST_FPS),
        duration: len,
        audio: audio,
        cancelled: () => !stillHere(),
        renderFrame: async (t) => {
          S.time = Math.min(t, Math.max(0, len - 0.001));
          /* Every picture renderPicture will ask for at this moment: the clip,
             or both clips of a transition, and the overlay. Decoded first,
             then handed over by the item they belong to. */
          const want = [];
          const tr = transitionAt(S.time);
          if (tr) {
            want.push([tr.a, srcTimeAt(tr.a, tr.aStart, S.time)], [tr.b, srcTimeAt(tr.b, tr.bStart, S.time)]);
          } else {
            const info = clipAt(S.time);
            if (info) want.push([info.clip, srcTimeAt(info.clip, info.start, S.time)]);
          }
          const b = brollAt(S.time);
          if (b) {
            const bm = mediaById(b.mediaId);
            // an overlay loops, as it does in the preview
            const local = S.time - b.start;
            if (bm) want.push([b, bm.type === "video" && bm.duration ? local % bm.duration : 0]);
          }
          const got = new Map();
          for (const [item, at] of want) {
            const m = mediaById(item.mediaId);
            if (!m) continue;
            const s = await sourceFor(m);
            /* Two clips of one recording in a transition need two different
               frames of it; the source hands out one at a time, so copy the
               first before asking for the second. */
            const f = await s.frameAt(at);
            if (f && want.length > 1 && got.size === 0 && want.some(([o]) => o !== item && o.mediaId === item.mediaId)) {
              const keep = document.createElement("canvas");
              keep.width = f.w; keep.height = f.h;
              try { keep.getContext("2d").drawImage(f.el, 0, 0); } catch (e) {}
              got.set(item, { el: keep, w: f.w, h: f.h });
            } else got.set(item, f);
          }
          drawExportFrame({ get: (item) => got.get(item) || null });
        },
        onProgress: (done, all, perSec) => {
          const pct = Math.min(100, Math.round((done / all) * 100));
          $("expBar").style.width = pct + "%";
          $("expPct").textContent = pct + "%";
          const x = perSec / FAST_FPS;
          $("expStatus").textContent = "rendering at " + Math.min(size.w, size.h) + "p" +
            (x >= 1.05 ? ", " + x.toFixed(1) + "x faster than real time" : x > 0 ? ", " + Math.round(x * 100) + "% of real time" : "");
        }
      });
      if (!stillHere() || !blob) return;
      $("expStatus").textContent = "saving file…";
      EXP.active = false;
      deliverExport(blob, "mp4");
      if (window.SenotelDiag) window.SenotelDiag.last.fastExport = "done: " + size.w + "x" + size.h + ", " + Math.round(blob.size / 1048576) + " MB";
    } catch (e) {
      console.warn("fast export failed", e);
      if (window.SenotelDiag) window.SenotelDiag.last.fastExport = "failed: " + ((e && e.message) || e);
      if (stillHere()) {
        // hand over to the real-time export rather than leave nothing
        endFast(sources);
        if (picked) {
          toast("The fast export stopped (" + ((e && e.message) || "an error") + "). Exporting the standard way instead", 6000);
          startExport(picked);
        } else {
          toast("Couldn't export: " + ((e && e.message) || "an error"), 6000);
        }
        return;
      }
    } finally {
      if (EXP.fast) endFast(sources);
    }
  }

  function endFast(sources) {
    sources.forEach((p) => { Promise.resolve(p).then((s) => s && s.close()).catch(() => {}); });
    sources.clear();
    EXP.fast = false;
    EXP.active = false;
    EXP.starting = false;
    letItSleep("export");
    $("exportOverlay").classList.add("hidden");
    S.time = 0;
    syncNow();
  }

  /* ── the mix, offline ─────────────────────────────────────────────────
     The same sound the live graph makes (ensureAudioGraph, mixMusic), built
     in an OfflineAudioContext so it renders in a fraction of real time:
       pass 1  the speech stage: each clip's own sound (pitch kept at any
               speed, as the preview does), the audio clips that are speech,
               and the swear-word silences.
       duck    the live ducker run over pass 1's level, 60 times a second,
               exactly as mixMusic does every frame.
       pass 2  speech + bleep + music (volume × loudness match × fades × duck)
               + the other audio clips + sound effects, through the same
               ceiling as the master bus. */
  async function renderMixOffline() {
    const F = window.SenotelFastExport;
    const SR = F.AUDIO_RATE;
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const len = total();
    const frames = Math.max(1, Math.ceil(len * SR));
    const audioCache = new Map();
    const soundOf = async (m, from, to) => {
      const key = m.id + (m.duration > 480 ? ":" + from.toFixed(2) + "-" + to.toFixed(2) : "");
      if (!audioCache.has(key)) audioCache.set(key, F.audioOf(m, from, to).catch(() => null));
      return audioCache.get(key);
    };
    const edge = 0.008;   // a few milliseconds of fade at every cut, so no clicks

    // Place [from, to] of a sound at timeline `at`, at `speed`, with `gain(t)`.
    async function place(ctx, dest, m, from, to, at, speed, level) {
      const a = await soundOf(m, from, to);
      if (!a || !a.buffer) return;
      const buf = a.buffer, r = buf.sampleRate;
      const s0 = Math.max(0, Math.round((from - a.startsAt) * r));
      const s1 = Math.min(buf.length, Math.round((to - a.startsAt) * r));
      if (s1 - s0 < 2) return;
      const chans = [];
      for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(s0, s1));
      const outCh = F.stretch(chans, speed || 1);
      const seg = ctx.createBuffer(outCh.length, outCh[0].length, r);
      outCh.forEach((d, c) => seg.getChannelData(c).set(d));
      const src = ctx.createBufferSource();
      src.buffer = seg;
      const g = ctx.createGain();
      const d = seg.duration;
      level(g.gain, at, d, edge);
      src.connect(g);
      g.connect(dest);
      src.start(at);
      src.stop(at + d + 0.01);
    }
    const flat = (v) => (p, at, d, e) => {
      p.setValueAtTime(0, at);
      p.linearRampToValueAtTime(v, at + Math.min(e, d / 2));
      p.setValueAtTime(v, Math.max(at, at + d - e));
      p.linearRampToValueAtTime(0, at + d);
    };
    const clipLevel = (a) => (p, at, d, e) => {
      // an audio clip's volume and fades (audioLevel), with the edge ramps
      const steps = Math.max(2, Math.ceil(d * 50));
      for (let i = 0; i <= steps; i++) {
        const t = a.start + (i / steps) * d;
        let v = audioLevel(a, t);
        if (i === 0 || i === steps) v = 0;
        p.linearRampToValueAtTime(v, at + (i / steps) * d);
      }
    };
    const isSpeech = (m) => !!(m && (m.fromVideo || m.type === "video"));
    /* A clip's level across its transitions (ccl1): it rises over the window
       of the transition into it and falls over the one out of it, with the
       same equal-power curves as the preview's mixBlend, plus the few
       milliseconds of edge every placed sound gets. */
    const blendLevel = (v, hIn, lead, hOut, tail) => (p, at0, d, e) => {
      const cutIn = at0 + lead, cutOut = at0 + d - tail;
      const n = Math.max(2, Math.ceil(d * 200));
      const curve = new Float32Array(n + 1);
      for (let k = 0; k <= n; k++) {
        const t = at0 + (k / n) * d;
        let g = v * clamp((t - at0) / e, 0, 1) * clamp((at0 + d - t) / e, 0, 1);
        if (hIn > 0) g *= blendIn((t - (cutIn - hIn)) / (2 * hIn));
        if (hOut > 0) g *= blendOut((t - (cutOut - hOut)) / (2 * hOut));
        curve[k] = g;
      }
      p.setValueCurveAtTime(curve, at0, d);
    };

    // ── pass 1: the speech stage ──
    const p1 = new Ctx(2, frames, SR);
    const speech = p1.createGain();
    speech.connect(p1.destination);
    let at = 0;
    for (let i = 0; i < S.clips.length; i++) {
      const c = S.clips[i];
      const m = mediaById(c.mediaId);
      const d = dispDur(c);
      if (m && m.type === "video" && !c.muted && (c.volume == null || c.volume > 0)) {
        const sp = c.speed || 1;
        /* Across a transition the picture runs on into the footage past the
           cut, so the sound does too: `lead` seconds before this clip's in
           point, `tail` after its out point, as far as the file has them. */
        const hIn = transHalf(i), hOut = transHalf(i + 1);
        const lead = Math.min(hIn, c.in / sp);
        const tail = Math.min(hOut, Math.max(0, ((m.duration || c.out) - c.out) / sp));
        const v = c.volume == null ? 1 : c.volume;
        const level = hIn > 0 || hOut > 0 ? blendLevel(v, hIn, lead, hOut, tail) : flat(v);
        await place(p1, speech, m, c.in - lead * sp, c.out + tail * sp, at - lead, sp, level);
      }
      at += d;
    }
    for (const a of S.audio) {
      const m = mediaById(a.mediaId);
      if (m && isSpeech(m)) await place(p1, speech, m, a.in, a.out, a.start, a.speed || 1, clipLevel(a));
    }
    // the bleep's silences (no lead here: nothing is late offline)
    const C = global_SenotelCaptions();
    const isBad = capMatcher(S.capLang);
    let spans = [];
    if (S.capOpts.censor === "bleep" && S.captions.length && C && isBad) {
      C.bleepSpans(S.captions, isBad).slice().sort((x, y) => x[0] - y[0]).forEach((s) => {
        const last = spans[spans.length - 1];
        if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else spans.push([s[0], s[1]]);
      });
      spans.forEach(([a, b]) => {
        speech.gain.setValueAtTime(1, Math.max(0, a - 0.004));
        speech.gain.linearRampToValueAtTime(0, a);
        speech.gain.setValueAtTime(0, b);
        speech.gain.linearRampToValueAtTime(1, b + 0.004);
      });
    }
    const speechBuf = await p1.startRendering();

    // ── the duck, as mixMusic computes it live ──
    const STEP = 1 / 60;
    const steps = Math.max(2, Math.ceil(len / STEP) + 1);
    const curve = new Float32Array(steps);
    if (S.music) {
      const L = speechBuf.getChannelData(0), R = speechBuf.numberOfChannels > 1 ? speechBuf.getChannelData(1) : L;
      let duckV = 1, held = 0;
      const ducking = S.music.duck !== false;
      for (let i = 0; i < steps; i++) {
        const t = i * STEP;
        // RMS over the 1024 samples before t, what the analyser would hold
        const end = Math.min(L.length, Math.round(t * SR)), begin = Math.max(0, end - 1024);
        let s = 0;
        for (let k = begin; k < end; k++) { const v = (L[k] + R[k]) / 2; s += v * v; }
        const rms = end > begin ? Math.sqrt(s / (end - begin)) : 0;
        if (ducking && rms > DUCK_ON) held = DUCK_HOLD; else held = Math.max(0, held - STEP);
        const want = ducking && held > 0 ? DUCK_TO : 1;
        const tau = want < duckV ? 0.08 : 0.45;
        duckV += (want - duckV) * (1 - Math.exp(-STEP / tau));
        curve[i] = clamp(musicBase(), 0, 1) * musicFade(Math.min(t, len)) * duckV;
      }
    }

    // ── pass 2: everything, through the ceiling ──
    const p2 = new Ctx(2, frames, SR);
    const bus = p2.createGain();
    const lim = p2.createDynamicsCompressor();
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.15;
    const trim = p2.createGain();
    trim.gain.value = 1 / CEILING_MAKEUP;
    bus.connect(lim); lim.connect(trim); trim.connect(p2.destination);

    const sp = p2.createBufferSource();
    sp.buffer = speechBuf;
    sp.connect(bus);
    sp.start(0);

    if (spans.length) {
      const osc = p2.createOscillator();
      osc.frequency.value = 1000;
      const bg = p2.createGain();
      bg.gain.value = 0;
      spans.forEach(([a, b]) => {
        bg.gain.setValueAtTime(0, Math.max(0, a - 0.004));
        bg.gain.linearRampToValueAtTime(0.2, a);
        bg.gain.setValueAtTime(0.2, b);
        bg.gain.linearRampToValueAtTime(0, b + 0.004);
      });
      osc.connect(bg); bg.connect(bus);
      osc.start(0); osc.stop(len);
    }

    if (S.music && S.music.url) {
      try {
        const bytes = await (await fetch(S.music.url)).arrayBuffer();
        const mbuf = await new Promise((res, rej) => { const pr = p2.decodeAudioData(bytes, res, rej); if (pr && pr.then) pr.then(res, rej); });
        const ms = p2.createBufferSource();
        ms.buffer = mbuf;
        ms.loop = true;     // the bed loops under a long edit, as the preview's does
        const mg = p2.createGain();
        mg.gain.setValueAtTime(curve[0], 0);
        mg.gain.setValueCurveAtTime(curve, 0, Math.max(STEP, len));
        ms.connect(mg); mg.connect(bus);
        // where the music clip sits, and how far into the song it starts (musicSpan)
        const span = musicSpan();
        ms.start(span.from, (span.at % mbuf.duration) || 0); ms.stop(Math.max(span.from + 0.01, span.to));
      } catch (e) {
        toast("The music couldn't be loaded, so it is missing from this export. Check your connection", 6000);
      }
    }

    for (const a of S.audio) {
      const m = mediaById(a.mediaId);
      if (m && !isSpeech(m)) await place(p2, bus, m, a.in, a.out, a.start, a.speed || 1, clipLevel(a));
    }

    const e = sfxEngine();
    if (e) {
      S.sfx.forEach((s) => {
        if (s.start > len) return;     // one on the very last frame still plays, as in the real-time export
        e.play(s.name, { ctx: p2, dest: bus, speaker: false, when: Math.max(0.0001, s.start), gain: typeof s.gain === "number" ? s.gain : 1 });
      });
    }
    return p2.startRendering();
  }

  /* The finished mix brought to -14 LUFS, the level TikTok, Reels and
     YouTube play everything at, under a -1.5 dBFS ceiling (loudness.js), in
     place, before encoding. "As mixed" on the export sheet leaves it alone. */
  function levelExportSound(audio) {
    const L = window.SenotelLoudness;
    if (!L || !audio || EXPORT_OPTS.level === "off") return;
    try {
      const chans = [];
      for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
      const r = L.level(chans, audio.sampleRate);
      if (window.SenotelDiag) window.SenotelDiag.last.loudness = r.skipped ? "silent, left alone"
        : r.before.toFixed(1) + " → " + r.after.toFixed(1) + " LUFS (" + (r.gainDb >= 0 ? "+" : "") + r.gainDb.toFixed(1) + " dB)";
    } catch (e) {
      if (window.SenotelDiag) window.SenotelDiag.last.loudness = "not levelled: " + ((e && e.message) || e);
    }
  }

  /* The finished file, however it was made: offered to save, kept for
     Settings, announced, and recorded as an approved edit. */
  function deliverExport(blob, ext) {
    letItSleep("export");
    EXP.starting = false;
    EXP.suspended = false;
    $("exportOverlay").classList.add("hidden");
    if (!blob || !blob.size) { toast("Export produced no data. Try again"); return; }
    const safeName = ($("projectName").value.trim() || "vclyps-export")
      .replace(/[^\p{L}\p{N} ()._,'&+-]+/gu, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\s-]+|[.\s-]+$/g, "")
      .slice(0, 80) || "vclyps-export";
    const fileName = safeName + "." + ext;
    offerExport(blob, fileName);
    idbPut("last-export", { blob, name: fileName }).catch(() => {});
    if (!document.hidden) $("doneDownload").click();
    notifyDone("Your video is ready", fileName + " is ready to save. You can also find it in Settings.", "export");
    if (window.IntelligenceEngine) {
      IntelligenceEngine.record({
        kind: "export-approved", format: S.format, vertical: S.vertical,
        clips: S.clips, texts: S.texts,
        sfx: S.sfx, music: S.music, audio: S.audio
      });
    }
  }

  /* The caption font has to be on the device before the first frame is
     drawn, or the opening captions export in the fallback font. Four
     seconds at most: a slow font must not hold the whole export hostage. */
  function captionFontReady() {
    const T = CapT(), C = global_SenotelCaptions(), st = capStyle();
    if (!T || !C || !st || !S.captions.length) return Promise.resolve();
    const fam = S.capOpts.font || st.font;
    return Promise.race([T.ensureFont(fam, C.weightFor(fam, st.weight || 700)), new Promise((r) => setTimeout(r, 4000))]);
  }

  /* Every sound effect the timeline uses, decoded before the first frame:
     the export plays them in real time and cannot wait for a download in the
     middle. Twelve seconds at most; a sound still missing then plays its
     built-in version, or nothing, and the person is told which. */
  async function soundsReady() {
    const e = sfxEngine();
    if (!e || !e.ready || !S.sfx.length) return;
    const names = Array.from(new Set(S.sfx.map((s) => s.name)));
    $("expStatus").textContent = "getting the sound effects ready…";
    await e.ready(names, 12000);
    const missing = names.filter((n) => e.source(n) !== "recording");
    if (missing.length) toast("Couldn't load " + missing.join(", ") + ". Check your connection; " + (missing.length > 1 ? "they" : "it") + " may be missing from this export", 6000);
    $("expStatus").textContent = "getting the first frame ready…";
  }

  async function startExport(picked) {
    // Guard the whole async run, not just the recording phase: priming takes a
    // moment, and a second click during it used to build a second recorder over
    // the first and corrupt both files.
    if (EXP.active || EXP.starting) return;
    const run = ++EXP.run;
    if (window.SenotelNotices) SenotelNotices.dismiss("doneCard");
    EXP.starting = true;
    EXP.cancelled = false;
    EXP.suspended = false;
    EXP.chunks = [];
    EXP.lastT = -1;
    EXP.stallTs = 0;
    EXP.clockTs = 0;
    /* Held for the whole render. A phone that sleeps mid-export is the most
       common way a long one dies, and this is the only thing that prevents it. */
    stayAwake("export");
    pause();
    S.time = 0;
    EXP.canvas = document.createElement("canvas");
    const size = exportSize();
    EXP.canvas.width = size.w;
    EXP.canvas.height = size.h;
    // "cover" (fill the frame, crop the overflow) whenever the footage and the
    // frame agree on orientation — which, now that the frame follows the
    // footage, is the normal case. Only a genuinely mismatched clip letterboxes.
    EXP.vertical = size.h > size.w;
    EXP.ctx = EXP.canvas.getContext("2d");
    EXP.chunks = [];
    EXP.ext = picked.ext;
    EXP.lastT = -1;
    EXP.stallTs = 0;

    if (S.clips.some((c) => c.filter && c.filter !== "none") && !canvasFilterSupported()) {
      toast("Heads up: this browser can't bake looks into the file, so colour will be missing from the export", 6000);
    }

    // Show the overlay BEFORE priming so a slow first seek looks like progress
    // rather than a frozen Export button.
    $("exportOverlay").classList.remove("hidden");
    $("expTitle").textContent = "Exporting “" + ($("projectName").value.trim() || "Untitled") + "”…";
    $("expStatus").textContent = "getting the first frame ready…";
    $("expBar").style.width = "0%";
    $("expPct").textContent = "0%";

    await captionFontReady();
    await textFontsReady();
    await soundsReady();
    await primeFirstFrame();
    if (run !== EXP.run) return;

    let stream;
    try {
      stream = EXP.canvas.captureStream(0);
      EXP.track = stream.getVideoTracks()[0];
      if (!EXP.track || typeof EXP.track.requestFrame !== "function") {
        stream.getTracks().forEach((track) => track.stop());
        stream = EXP.canvas.captureStream(EXPORT_OPTS.fps || 30);
        EXP.track = stream.getVideoTracks()[0];
      }
      EXP.stream = stream;
    } catch (_) {
      abortExport("Canvas recording is unavailable in this browser.");
      return;
    }
    let audioOk = false;
    try {
      ensureAudioGraph();
      /* Before recording starts, or the bed and the audio clips are missing
         from the file. */
      ensureMusicRoute();
      routeAudioVoices();
      if (audioCtx.state === "suspended") audioCtx.resume();
      // the preview element must actually output sound for the tap to carry it
      pv.muted = false;
      pv.volume = 1;
      S.userMuted = false;
      $("mOn").classList.remove("hidden");
      $("mOff").classList.add("hidden");
      const tracks = audioDest.stream.getAudioTracks();
      tracks.forEach((t) => stream.addTrack(t.clone()));
      audioOk = tracks.length > 0;
    } catch (e) { /* export continues silent if the audio graph is unavailable */ }
    if (window.SenotelDiag) window.SenotelDiag.last.exportAudio = audioOk ? "captured" : "no audio track";

    try {
      EXP.rec = new MediaRecorder(stream, {
        mimeType: picked.mime,
        videoBitsPerSecond: exportBitrate(EXP.canvas.width, EXP.canvas.height, EXPORT_OPTS.fps || 30),
        audioBitsPerSecond: 128000
      });
    } catch (e) {
      // Bail out CLEANLY — this path used to return with the overlay still up
      // and EXP.starting still true, which left the editor permanently stuck
      // behind a dialog that could never finish.
      EXP.starting = false;
      stream.getTracks().forEach((track) => track.stop());
      EXP.stream = null;
      letItSleep("export");
      $("exportOverlay").classList.add("hidden");
      toast("Couldn't start the recorder. Try a different browser");
      return;
    }
    EXP.rec.ondataavailable = (e) => { if (run === EXP.run && e.data && e.data.size) EXP.chunks.push(e.data); };
    EXP.rec.onstop = () => { if (run === EXP.run) saveExport(); };
    // Without this, an encoder failure mid-render never fires onstop and the
    // progress dialog sits at whatever percent it reached, forever.
    EXP.rec.onerror = (ev) => {
      if (run !== EXP.run) return;
      abortExport((ev && ev.error && (ev.error.message || ev.error.name)) || "the recorder failed");
    };

    if (window.SenotelRenderClock) {
      await SenotelRenderClock.start(exportTick, () => {
        if (document.hidden) suspendExport();
      });
    }
    if (run !== EXP.run) return;
    EXP.active = true;
    EXP.starting = false;
    lastTs = performance.now();
    $("expStatus").textContent = backgroundExportReady()
      ? "Rendering. You can switch tabs; keep this one open."
      : "Rendering. Keep this tab visible in this browser.";
    // NO timeslice argument, deliberately. start(250) made the recorder emit
    // the file in fragments, and a fragmented container is written without a
    // valid overall duration — which is why players showed "00:03" for a clip
    // that kept playing well past it, and why scrubbing misbehaved. Recording
    // in one piece lets the muxer write a real duration on stop. The cost is
    // that the whole file buffers in memory until then (~8 Mbit/s, so roughly
    // 60 MB per minute), which is the right trade for a correct file.
    try {
      EXP.rec.start();
      play();
      drawExportFrame();
      if (document.hidden && !backgroundExportReady()) suspendExport();
    } catch (e) { abortExport((e && e.message) || "Recording could not start"); }
  }

  /* Stop a run that cannot finish, and always leave the UI usable. */
  function abortExport(why) {
    if (!EXP.active && !EXP.starting) return;
    EXP.run++;
    EXP.chunks = [];
    EXP.cancelled = true;
    EXP.active = false;
    EXP.starting = false;
    EXP.suspended = false;
    stopRenderClock();
    letItSleep("export");
    pause();
    try { if (EXP.rec && EXP.rec.state !== "inactive") EXP.rec.stop(); } catch (e) {}
    if (EXP.stream) { EXP.stream.getTracks().forEach((track) => track.stop()); EXP.stream = null; }
    $("exportOverlay").classList.add("hidden");
    toast("Export stopped. " + why, 5000);
  }

  /* A source that stalls while still reporting readyState 2 freezes the
     timeline: advanceTime keeps deriving the same instant from the video clock,
     so the progress bar stops and the recorder runs on forever. Give up loudly
     after a few seconds of no movement instead of recording a stuck frame. */
  function watchExportStall(ts) {
    if (EXP.suspended) return;   // hidden is not stalled
    if (Math.abs(S.time - EXP.lastT) > 0.001) {
      EXP.lastT = S.time;
      EXP.stallTs = ts;
      return;
    }
    if (!EXP.stallTs) { EXP.stallTs = ts; return; }
    if (ts - EXP.stallTs > 8000) abortExport("The video stopped responding. Try exporting with this tab visible.");
  }

  /* src: the pictures to draw, when they do not come from the preview's own
     elements. The fast export (renderFast) decodes frames itself and passes
     { main: {el, w, h}, broll: {el, w, h} }; the real-time export passes
     nothing and draws #pv/#pi and #pvB/#piB as they play. Everything else
     (looks, layouts, transitions, texts, captions, the logo) is this one
     function either way, so the two exports cannot look different. */
  function drawExportFrame(src) {
    const ctx = EXP.ctx, W = EXP.canvas.width, H = EXP.canvas.height;
    /* The picture (clips, transitions, overlay, fades, effects) is the same
       renderPicture the preview draws. The fast export hands over frames it
       decoded itself (src.get); the real-time export reads the players. */
    renderPicture(ctx, W, H, S.time, src && src.get ? src.get : previewSrc);


    // every text, drawn by the same code as the preview (drawTexts)
    drawTexts(ctx, { x: 0, y: 0, w: W, h: H }, S.time, null);

    drawWatermark(ctx, { x: 0, y: 0, w: W, h: H });

    // Word-timed captions last, so they sit above every other overlay.
    if (S.captions && S.captions.length && global_SenotelCaptions()) {
      global_SenotelCaptions().drawCaptions(ctx, S.captions, S.time, capDrawOpts(null));
    }

    if (src) return;   // the fast export reports its own progress
    const pct = total() ? Math.min(100, Math.round((S.time / total()) * 100)) : 0;
    $("expBar").style.width = pct + "%";
    $("expPct").textContent = pct + "%";
    if (EXP.track && typeof EXP.track.requestFrame === "function") EXP.track.requestFrame();
  }

  function finishExport() {
    if (!EXP.active) return;
    EXP.active = false;
    EXP.starting = true; // finalizing still owns the recorder; block a second export
    stopRenderClock();
    $("expBar").style.width = "100%";
    $("expPct").textContent = "100%";
    $("expStatus").textContent = "saving file…";
    // Paint the closing frame (the loop skips drawing once active is false),
    // then let the encoder take one more slice. Stopping in the same tick as
    // the final frame clipped the last fraction of a second off the file.
    try { drawExportFrame(); } catch (e) {}
    // No requestData() here — with no timeslice that would cut the file in two
    // and defeat the whole point of recording in one piece. stop() flushes.
    const recorder = EXP.rec;
    setTimeout(() => {
      try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch (e) {}
    }, 340);
  }

  let latestExportUrl = null, latestExport = null;
  function offerExport(blob, name) {
    if (latestExportUrl) URL.revokeObjectURL(latestExportUrl);
    latestExportUrl = URL.createObjectURL(blob);
    latestExport = { blob, name };
    [$("doneDownload"), $("lastExportDownload")].forEach((link) => {
      link.href = latestExportUrl;
      link.download = name;
      link.classList.remove("hidden");
    });
  }
  /* The Save links download by themselves in a browser. Inside an app's
     view a download goes nowhere, so the tap saves through platform.js:
     the app's own save, or the share sheet ("Save to Files", Photos). */
  [$("doneDownload"), $("lastExportDownload")].forEach((link) => {
    link.addEventListener("click", (e) => {
      if (SenotelPlatform.linksDownload() || !latestExport) return;
      e.preventDefault();
      // the click made by the app itself at the end of an export has no tap behind it
      if (!e.isTrusted) return;
      SenotelPlatform.save(latestExport.blob, latestExport.name).catch((err) => toast((err && err.message) || "Couldn't save the video. Try again"));
    });
  });

  function saveExport() {
    letItSleep("export");
    stopRenderClock();
    if (EXP.stream) { EXP.stream.getTracks().forEach((track) => track.stop()); EXP.stream = null; }
    EXP.starting = false;
    EXP.suspended = false;
    $("exportOverlay").classList.add("hidden");
    if (EXP.cancelled) { EXP.chunks = []; return; }
    const blob = new Blob(EXP.chunks, { type: (EXP.rec && EXP.rec.mimeType) || "video/webm" });
    EXP.chunks = [];
    /* deliverExport (with the fast export): the file name is a whitelist of
       characters every OS accepts ("Trip 3/4: Rome?" was silently refused by
       Windows), the file is kept for Settings, and an export is recorded as
       an approved edit, the best training data there is. */
    deliverExport(blob, EXP.ext);
  }

  $("expCancel").addEventListener("click", () => {
    EXP.run++;
    EXP.chunks = [];
    EXP.cancelled = true;
    EXP.active = false;
    // Clearing `starting` matters: cancelling while the first frame is still
    // being primed left this true forever, and every later Export click was
    // turned away with "an export is already running".
    EXP.starting = false;
    EXP.suspended = false;
    stopRenderClock();
    letItSleep("export");
    pause();
    try { if (EXP.rec && EXP.rec.state !== "inactive") EXP.rec.stop(); } catch (e) {}
    if (EXP.stream) { EXP.stream.getTracks().forEach((track) => track.stop()); EXP.stream = null; }
    $("exportOverlay").classList.add("hidden");
    toast("Export cancelled");
  });

  /* ═══════════ SHEETS ═══════════ */

  function openSheet(id) {
    renderLibrary();
    $("sheetBackdrop").classList.remove("hidden");
    document.querySelectorAll(".sheet").forEach((s) => s.classList.add("hidden"));
    $(id).classList.remove("hidden");
  }
  function closeSheets() {
    libPick = null;
    if (typeof stopMusicPreview === "function") stopMusicPreview();
    stopClipWatch();
    stopMineListen();
    $("sheetBackdrop").classList.add("hidden");
    document.querySelectorAll(".sheet").forEach((s) => s.classList.add("hidden"));
  }
  $("sheetBackdrop").addEventListener("click", (e) => {
    if (e.target === $("sheetBackdrop")) closeSheets();
  });

  // each training-data Clear button's Restore refresher (guardDatasetClear)
  const guardRefreshers = [];

  /* ═══════════ ADMIN ═══════════

     Typing /clypsadmin anywhere opens the panel. The passphrase is a SOFT gate
     and is described as one in the panel itself: everything it shows lives in
     this browser's own localStorage, so it already belongs to whoever is
     sitting there. It stops the panel being stumbled into by a curious user;
     it does not protect a secret, and a constant in a public script never
     could. Say so rather than implying otherwise.

     Change the passphrase here. */
  const ADMIN_PASS = "senotel";
  let adminOpen = false;

  (function wireAdmin() {
    /* A rolling buffer rather than a key-by-key state machine: simpler, and it
       cannot get stuck half way through the word. */
    let typed = "";
    document.addEventListener("keydown", (e) => {
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key.length !== 1) return;
      typed = (typed + e.key.toLowerCase()).slice(-12);
      if (typed.indexOf("/clypsadmin") < 0) return;
      typed = "";
      adminOpen = false;
      $("adminLock").classList.remove("hidden");
      $("adminBody").classList.add("hidden");
      $("adminErr").classList.add("hidden");
      $("adminPass").value = "";
      go(() => showScreen("admin"));
      setTimeout(() => { try { $("adminPass").focus(); } catch (err) {} }, 420);
    });

    function unlock() {
      if ($("adminPass").value !== ADMIN_PASS) {
        $("adminErr").classList.remove("hidden");
        return;
      }
      adminOpen = true;
      $("adminErr").classList.add("hidden");
      $("adminLock").classList.add("hidden");
      $("adminBody").classList.remove("hidden");
      renderAdmin();
    }
    $("adminGo").addEventListener("click", unlock);
    $("adminPass").addEventListener("keydown", (e) => { if (e.key === "Enter") unlock(); });

    $("adminRefresh").addEventListener("click", renderAdmin);
    $("adminExport").addEventListener("click", () => {
      if (window.IntelligenceEngine) IntelligenceEngine.exportDataset().catch((e) => toast(e.message));
    });
    guardDatasetClear($("adminClear"), () => { renderAdmin(); guardRefreshers.forEach((f) => f()); });
  })();

  /* ═══════════ CLEARING THE TRAINING DATA ═══════════
     It used to go on one click (owner, 2026-10-21: "imagine it was a
     million"). Now, wherever a Clear button for it sits (Settings and the
     admin panel):
       1. the button only OPENS a panel under it, which says how many
          examples will go, offers a download first, and
       2. deletes only after "delete" is typed into it, then
       3. the cleared records are set aside on the device (intelligence.js
          clearDataset), and a Restore button brings them back until the
          next clear.
     Typing, not a second tap: two taps can happen by accident, a word
     cannot. */
  function guardDatasetClear(btn, after) {
    if (!btn) return;
    const row = btn.parentNode;
    const panel = mk("div", "ds-guard hidden");
    const msg = mk("p", "ds-guard-msg");
    const backup = mk("button", "secondary-btn", "Download a copy first");
    const label = mk("label", "ds-guard-label", "<span>Type <strong>delete</strong> to confirm</span>");
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("autocapitalize", "off");
    label.appendChild(input);
    const go = mk("button", "ghost-btn danger-btn", "Delete");
    go.disabled = true;
    const cancel = mk("button", "ghost-btn", "Cancel");
    const acts = mk("div", "set-row");
    [go, cancel].forEach((b) => acts.appendChild(b));
    [msg, backup, label, acts].forEach((x) => panel.appendChild(x));
    row.after(panel);
    const restore = mk("button", "ghost-btn hidden", "Restore");
    row.appendChild(restore);

    const E = () => window.IntelligenceEngine;
    const refreshRestore = () => {
      const c = E() && E().clearedInfo ? E().clearedInfo() : null;
      restore.classList.toggle("hidden", !c);
      if (c) restore.textContent = "Restore " + c.n + (c.n === 1 ? " cleared example" : " cleared examples");
    };
    const close = () => { panel.classList.add("hidden"); input.value = ""; go.disabled = true; btn.disabled = false; };

    btn.addEventListener("click", () => {
      const n = E() ? E().datasetCount() : 0;
      if (!n) { toast("There's no training data to clear"); return; }
      msg.innerHTML = "This deletes <strong>" + n.toLocaleString() + (n === 1 ? " example" : " examples") +
        "</strong> of training data from this device. Download a copy first if you might want it.";
      go.textContent = "Delete " + n.toLocaleString() + (n === 1 ? " example" : " examples");
      panel.classList.remove("hidden");
      btn.disabled = true;
      input.value = "";
      go.disabled = true;
      input.focus();
    });
    input.addEventListener("input", () => { go.disabled = input.value.trim().toLowerCase() !== "delete"; });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !go.disabled) go.click(); if (e.key === "Escape") close(); });
    backup.addEventListener("click", () => { if (E()) E().exportDataset().catch((e) => toast(e.message)); });
    cancel.addEventListener("click", close);
    go.addEventListener("click", () => {
      if (go.disabled || !E()) return;
      const r = E().clearDataset();
      close();
      if (!r.ok) { toast(r.reason, 7000); return; }
      refreshRestore();
      refreshSettings();
      if (after) after();
      toast(r.cleared + (r.cleared === 1 ? " example" : " examples") + " cleared. Restore brings them back", 6000);
    });
    restore.addEventListener("click", () => {
      const back = E() && E().restoreDataset ? E().restoreDataset() : 0;
      refreshRestore();
      refreshSettings();
      if (after) after();
      toast(back ? back + (back === 1 ? " example" : " examples") + " restored" : "Couldn't restore the data");
    });
    refreshRestore();
    // the other Clear button may have changed things: stay in step when shown
    $("settingsBtn").addEventListener("click", () => { close(); refreshRestore(); });
    guardRefreshers.push(refreshRestore);
  }

  function renderAdmin() {
    if (!adminOpen) return;
    let rows = [];
    try { rows = JSON.parse(localStorage.getItem("vclyps-dataset") || "[]"); } catch (e) { rows = []; }
    if (!Array.isArray(rows)) rows = [];

    /* A count, what kinds of record are in there, and when the last one
       landed. Enough to answer "is data actually being collected" without
       scrolling anything. */
    const kinds = {};
    rows.forEach((r) => { const k = (r && r.kind) || "unknown"; kinds[k] = (kinds[k] || 0) + 1; });
    const last = rows.length ? rows[rows.length - 1] : null;
    /* The recorder writes the timestamp as `t`; `at` was a guess and it read
       "none" for every dataset that actually had entries in it. */
    const when = last && (last.t || last.at) ? new Date(last.t || last.at) : null;

    const stats = $("adminStats");
    stats.innerHTML = "";
    const tile = (label, value) => {
      const d = mk("div", "admin-tile");
      d.appendChild(mk("span", "admin-tile-v", String(value)));
      d.appendChild(mk("span", "admin-tile-k", label));
      stats.appendChild(d);
    };
    tile("examples", rows.length);
    tile("kinds", Object.keys(kinds).length);
    tile("last entry", when ? when.toLocaleDateString() : "none");

    const list = $("adminList");
    list.innerHTML = "";
    if (!rows.length) {
      list.appendChild(mk("p", "set-note", "Nothing collected yet. Every AI edit adds one record."));
      return;
    }
    Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a]).forEach((k) => {
      const row = mk("div", "admin-row");
      row.appendChild(mk("span", "admin-row-k", k));
      row.appendChild(mk("span", "admin-row-n", String(kinds[k])));
      list.appendChild(row);
    });

    /* The newest record in full, because the shape of the data is the thing
       you actually want to check when you open this. */
    const pre = mk("pre", "admin-json");
    try { pre.textContent = JSON.stringify(last, null, 2).slice(0, 4000); }
    catch (e) { pre.textContent = "(could not read the last record)"; }
    list.appendChild(mk("p", "admin-sub", "Most recent record"));
    list.appendChild(pre);
  }

  /* ═══════════ TOP BAR MISC ═══════════ */

  $("undoBtn").addEventListener("click", undo);
  $("redoBtn").addEventListener("click", redo);
  $("projectName").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
  $("projectName").addEventListener("blur", (e) => {
    if (!e.target.value.trim()) e.target.value = "Untitled";
    e.target.scrollLeft = 0;   // a long title reads from its start, not its end
    saveSession();
  });
  $("projectName").addEventListener("input", saveSession);

  /* ═══════════ KEYBOARD ═══════════ */

  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if (e.key === "Escape") { if (inFs()) exitFs(); closeSheets(); return; }
    if (typing) return;
    if (document.body.dataset.screen !== "editor") return;

    if (e.key === "Escape" && inFs()) { e.preventDefault(); exitFs(); return; }
    if (e.code === "Space") { e.preventDefault(); primeAudio(); if (S.playing) pause(); else play(); }
    else if (e.key === "Delete" || e.key === "Backspace") { deleteSelection(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    else if (e.key === "s" && !e.ctrlKey && !e.metaKey) { splitAtPlayhead(); }
    /* CapCut's desktop keys (2026-10-22): Ctrl/Cmd+B splits, Ctrl/Cmd +/-
       zooms the timeline, the arrows step a frame (a second with Shift),
       Home and End jump to the ends. */
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); splitAtPlayhead(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomTimeline(S.pps * 1.25); }
    else if ((e.ctrlKey || e.metaKey) && e.key === "-") { e.preventDefault(); zoomTimeline(S.pps / 1.25); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      if (S.playing) pause();
      const step = e.shiftKey ? 1 : 1 / 30;
      S.time = clamp(S.time + (e.key === "ArrowLeft" ? -step : step), 0, total());
      syncNow();
    }
    else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      if (S.playing) pause();
      S.time = e.key === "Home" ? 0 : total();
      syncNow();
    }
  });

  /* ═══════════ SETTINGS: theme, director key, dataset ═══════════ */

  function applyTheme(t) {
    document.body.classList.toggle("dark", t === "dark");
    document.querySelectorAll("#themeSeg button").forEach((b) => b.classList.toggle("active", b.dataset.t === t));
  }
  // The editor defaults to DARK: it is a workspace you stare at beside video
  // footage, and a bright chrome washes out the picture you are judging. The
  // landing is unaffected — landing.css forces its own black stage regardless.
  // A saved preference always wins over this default.
  applyTheme(localStorage.getItem("vclyps-theme") || "dark");
  document.querySelectorAll("#themeSeg button").forEach((b) => {
    b.addEventListener("click", () => {
      localStorage.setItem("vclyps-theme", b.dataset.t);
      applyTheme(b.dataset.t);
    });
  });

  /* ── Brand (Settings → Your brand) ─────────────────────────────────────
     The logo is shrunk to 512 px on its longest side and kept as a PNG data
     address in this browser's storage, so it survives reloads and is used by
     every project without being uploaded anywhere. */
  function wireBrand() {
    const paint = () => {
      const has = !!BRAND.logo;
      $("brandLogoImg").classList.toggle("hidden", !has);
      $("brandLogoNone").classList.toggle("hidden", has);
      $("brandLogoClear").classList.toggle("hidden", !has);
      if (has) $("brandLogoImg").src = BRAND.logo;
      document.querySelectorAll("#brandMarkSeg button").forEach((b) => b.classList.toggle("active", b.dataset.m === (BRAND.mark || "off")));
      $("brandMain").value = BRAND.main;
      $("brandAccent").value = BRAND.accent;
      $("brandText").value = BRAND.text;
    };
    $("brandLogoPick").addEventListener("click", () => $("brandLogoFile").click());
    $("brandLogoFile").addEventListener("change", async () => {
      const f = $("brandLogoFile").files && $("brandLogoFile").files[0];
      $("brandLogoFile").value = "";
      if (!f) return;
      try {
        const url = URL.createObjectURL(f);
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
        const k = Math.min(1, 512 / Math.max(img.naturalWidth || 512, img.naturalHeight || 512));
        const cv = document.createElement("canvas");
        cv.width = Math.max(1, Math.round((img.naturalWidth || 512) * k));
        cv.height = Math.max(1, Math.round((img.naturalHeight || 512) * k));
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        BRAND.logo = cv.toDataURL("image/png");
        if (!BRAND.mark || BRAND.mark === "off") BRAND.mark = "tr";
        if (!saveBrand()) { BRAND.logo = ""; toast("That logo is too big to keep on this device. Try a smaller file"); }
        else toast("Logo saved. It goes on every video you export");
      } catch (e) { toast("That file couldn't be opened as a picture"); }
      paint();
      syncOverlays();
    });
    $("brandLogoClear").addEventListener("click", () => { BRAND.logo = ""; saveBrand(); paint(); syncOverlays(); });
    document.querySelectorAll("#brandMarkSeg button").forEach((b) => {
      b.addEventListener("click", () => { BRAND.mark = b.dataset.m; saveBrand(); paint(); syncOverlays(); });
    });
    [["brandMain", "main"], ["brandAccent", "accent"], ["brandText", "text"]].forEach(([id, key]) => {
      $(id).addEventListener("change", () => { BRAND[key] = $(id).value; saveBrand(); });
    });
    paint();
  }
  wireBrand();

  function refreshSettings() {
    const V = window.SenotelVersion;
    // Version only. The build number still travels with every diagnostics dump
    // and prints to the console on load, so support can still identify an exact
    // build — it just doesn't clutter the panel.
    if (V) $("aboutVersion").textContent = "Version " + V.version;
  }
  $("settingsBtn").addEventListener("click", () => {
    refreshSettings();
    go(() => showScreen("settings"));
  });
  /* The training data is the owner's: downloading and clearing it are in the
     admin panel only (owner, 2026-10-21), never in Settings. */

  /* ═══════════ SESSION PERSISTENCE ═══════════
     Phones discard background tabs under memory pressure, so switching apps
     mid-edit came back to a fresh page: the landing intro replaying, the
     timeline empty, the work gone. Nothing here is a "save button" — the editor
     simply survives being thrown away.

     Two stores, because the two halves have very different sizes. The project
     structure (clips, texts, captions, ids) is a few KB and lives in
     localStorage. The footage does not fit there at any size, so the original
     File objects go to IndexedDB and get fresh object URLs on the way back in —
     the blob: URLs from createObjectURL die with the page and cannot be saved. */

  const SESSION_KEY = "vclyps-session";
  const IDB_NAME = "vclyps-media", IDB_STORE = "files";
  const MAX_STORE_BYTES = 400 * 1024 * 1024;   // don't fight the quota over huge footage

  function idb() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(IDB_STORE); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  function idbDo(mode, fn) {
    return idb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, mode);
      const out = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
    }));
  }
  const idbPut = (k, v) => idbDo("readwrite", (s) => s.put(v, k));
  const idbGet = (k) => idbDo("readonly", (s) => s.get(k));
  const idbDel = (k) => idbDo("readwrite", (s) => s.delete(k));
  idbGet("last-export").then((saved) => {
    if (saved && saved.blob && !latestExportUrl) {
      offerExport(saved.blob, saved.name);
      if (new URLSearchParams(location.search).get("result") === "ready" && window.SenotelNotices) {
        SenotelNotices.show("doneCard", "Your saved video", saved.name + " is ready to save.", 12000);
      }
    }
  }).catch(() => {});

  let storedBytes = 0;
  function keepFile(item, file) {
    if (!file || storedBytes + file.size > MAX_STORE_BYTES) return;
    // First real footage on the device is the moment worth asking the browser
    // not to evict us — this protects the session-resume copies as well as the
    // speech model.
    if (!storedBytes) {
      const C = global_SenotelCaptions();
      if (C && C.keepStorage) C.keepStorage();
    }
    storedBytes += file.size;
    idbPut("m" + item.id, file).catch(() => {});   // best effort; quota may refuse
  }

  /* Nothing may be written until boot has settled. The first commit() of a fresh
     page runs with an empty timeline, and restoring is asynchronous (IndexedDB) —
     so without this the empty state could reach storage first and delete the
     snapshot that was still being read back. */
  let booting = true;

  function writeSession() {
    if (booting) return;
    try {
      if (!S.media.length) { localStorage.removeItem(SESSION_KEY); return; }
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        v: 1,
        // which build wrote this — lets a future version migrate or discard a
        // snapshot it can no longer read, instead of restoring it wrongly
        by: window.SenotelVersion ? window.SenotelVersion.stamp() : null,
        name: $("projectName").value,
        format: S.format, mode: S.mode, brief: S.brief, vertical: S.vertical, nextId: nextId,
        media: S.media.map((m) => ({ id: m.id, name: m.name, type: m.type, duration: m.duration, w: m.w, h: m.h,
          fromVideo: !!m.fromVideo, soundSaved: !!m.soundSaved,
          // the transcript, so captions can be restyled after a reload without listening again
          cap: m.capWords ? { words: m.capWords, lang: m.capLang, key: m.capKey, spk: !!m.capSpk } : null })),
        clips: S.clips, texts: S.texts, captions: S.captions, capOpts: S.capOpts, capLang: S.capLang,
        broll: S.broll, sfx: S.sfx, music: S.music, effects: S.effects,
        audio: S.audio, find: S.find, found: S.found
      }));
    } catch (e) { /* private mode or full — the editor still works, just won't resume */ }
  }

  let sessionTimer = null;
  function saveSession() {
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(writeSession, 500);
  }
  /* A discarded tab gets no unload event, so the last safe moment to write is
     when the page is hidden. Both events fire on mobile; writing twice is cheap. */
  document.addEventListener("visibilitychange", () => { if (document.hidden) writeSession(); });
  window.addEventListener("pagehide", writeSession);

  /* Read ONCE at boot, before anything can overwrite it. The first commit() of a
     fresh page has an empty timeline, and letting that reach writeSession would
     delete the very snapshot we are about to restore. */
  let bootSnapshot = null;

  async function restoreSession() {
    const snap = bootSnapshot;
    if (!snap || !snap.media || !snap.media.length) return false;

    const missing = [];
    for (const m of snap.media) {
      let file = null;
      try { file = await idbGet("m" + m.id); } catch (e) {}
      if (!file) { missing.push(m.name); continue; }
      const url = URL.createObjectURL(file);
      const item = {
        id: m.id, url: url, type: m.type, name: m.name,
        duration: m.duration || (m.type === "image" ? IMG_DUR : 0),
        w: m.w || 0, h: m.h || 0,
        thumb: m.type === "image" ? url : null,
        file: file
      };
      if (m.fromVideo) item.fromVideo = true;
      if (m.soundSaved) item.soundSaved = true;
      if (m.cap && m.cap.words) {
        item.capWords = m.cap.words; item.capLang = m.cap.lang; item.capKey = m.cap.key; item.capSpk = !!m.cap.spk;
        item.words = m.cap.words;
      }
      S.media.push(item);
      storedBytes += file.size;
      queueAnalysis(item);                       // brain analysis isn't stored; redo it quietly
      if (m.type === "video") loadVideoMeta(item);  // regenerates the strip thumbnail
    }
    if (!S.media.length) return false;

    // Drop clips whose footage didn't come back, so the timeline can't point at nothing.
    const have = {};
    S.media.forEach((m) => { have[m.id] = true; });
    S.clips = (snap.clips || []).filter((c) => have[c.mediaId]);
    S.texts = snap.texts || [];
    S.captions = snap.captions || [];
    // a project saved before 0.24 had one setting, captionStyle
    S.capOpts = Object.assign(capDefaults(), snap.capOpts || (snap.captionStyle ? { style: snap.captionStyle } : {}));
    S.capLang = snap.capLang || "";
    // drop overlays whose footage didn't come back, same rule as clips
    S.broll = (snap.broll || []).filter((b) => have[b.mediaId]);
    // Sounds reference no media at all — nothing to lose, nothing to filter.
    S.sfx = (snap.sfx || []).filter((x) => x && x.name);
    S.effects = (snap.effects || []).filter((x) => x && x.type);
    // audio clips do: one whose file did not come back is dropped, like a clip
    S.audio = (snap.audio || []).filter((a) => a && have[a.mediaId]);
    /* The bed is a remote URL, not uploaded footage, so nothing needs
       fetching back out of IndexedDB: it simply reloads from the CDN. */
    S.music = snap.music && snap.music.url ? snap.music : null;
    loadMusicElement();
    S.format = "auto";
    S.mode = snap.mode === "business" ? "business" : "entertainment";
    S.brief = Object.assign({ name: "", what: "", cta: "", tone: "polished" }, snap.brief && typeof snap.brief === "object" ? snap.brief : {});
    applyModeUI();
    S.vertical = !!snap.vertical;
    if (snap.find && typeof snap.find === "object") S.find = Object.assign({ on: false, len: "auto", genre: "auto", from: "", to: "" }, snap.find);
    // found clips only mean something while their recording is still here
    S.found = snap.found && have[snap.found.mediaId] ? snap.found : null;
    nextId = Math.max(snap.nextId || 1, ...S.media.map((m) => m.id + 1));
    if (snap.name) $("projectName").value = snap.name;

    hist = []; histIdx = -1; commit();   // resumed state becomes the undo baseline
    if (missing.length) {
      toast("Couldn't recover " + missing.length + " file" + (missing.length === 1 ? "" : "s") + ". Re-add: " + missing.join(", "), 6000);
    }
    return true;
  }

  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    S.media.forEach((m) => { idbDel("m" + m.id).catch(() => {}); idbDel("l" + m.id).catch(() => {}); });
    storedBytes = 0;
  }

  /* ═══════════ START A NEW VIDEO ═══════════

     Everything that makes up a project, taken down in one place. The order
     matters more than it looks: the media has to be released BEFORE the arrays
     are emptied, because releasing it means walking S.media for the object URLs
     and the IndexedDB keys — clear the array first and the browser holds those
     blobs (tens or hundreds of MB) until the tab is closed.

     There is no undo. The history is part of what gets thrown away, so the
     control is armed by one tap and fires on a second, and disarms itself if
     the second never comes. A confirm() dialog would do the same job, but it is
     blockable, it looks like a browser error, and on a phone it is a modal you
     cannot see the app behind. */

  function resetProject() {
    if (generating) { toast("Let your edit finish before starting a new project."); return false; }
    /* Refuse mid-export rather than pulling the footage out from under a
       running MediaRecorder — that would leave a half-written file and no
       explanation for it. */
    if (EXP.active || EXP.starting) {
      toast("An export is running. Let it finish first");
      return false;
    }

    pause();
    stopSfx();

    /* Release the footage. revokeObjectURL frees the blob; the IndexedDB copy
       is what would otherwise resurrect the whole project on the next visit. */
    S.media.forEach((m) => {
      try { URL.revokeObjectURL(m.url); } catch (e) {}
      if (m.thumb && m.thumb !== m.url) { try { URL.revokeObjectURL(m.thumb); } catch (e) {} }
      idbDel("m" + m.id).catch(() => {});
      idbDel("l" + m.id).catch(() => {});
    });
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    storedBytes = 0;
    bootSnapshot = null;
    window.vcHasSession = false;

    S.media = [];
    S.clips = [];
    S.texts = [];
    S.broll = [];
    S.sfx = [];
    S.effects = [];
    S.audio = [];
    syncAudioClips();   // lets go of every audio clip's element
    S.music = null;
    loadMusicElement();
    S.captions = [];
    S.capLang = "";   // the caption settings stay: they are the person's taste, not this video's
    S.sel = null;
    S.time = 0;
    S.seed = 1;
    S.format = "auto";
    S.vertical = false;
    S.found = null;
    renderClipsChip();
    nextId = 1;

    /* The media elements keep showing the last frame otherwise, and — worse —
       `dataset.mid` would still name a media id that no longer exists, so the
       next clip loaded with a recycled id would be judged "already loaded" and
       never actually swapped in. */
    [pv, pi, pvB, piB].forEach((el) => {
      if (!el) return;
      try { el.pause && el.pause(); } catch (e) {}
      el.removeAttribute("src");
      delete el.dataset.mid;
      try { el.load && el.load(); } catch (e) {}
    });
    pvB.classList.add("hidden");
    piB.classList.add("hidden");
    pi.classList.add("hidden");

    const cv = $("capCanvas");
    if (cv) {
      const c2 = cv.getContext("2d");
      if (c2) c2.clearRect(0, 0, cv.width, cv.height);
    }

    $("projectName").value = "Untitled";
    $("semiPrompt").value = "";
    $("aiStatus").classList.add("hidden");
    $("aiStatus").textContent = "";

    /* A fresh baseline, not an empty step appended to the old history — undo
       must not be able to walk back into a project whose footage is gone. */
    hist = [];
    histIdx = -1;
    commit();

    renderAll();
    renderTimeline();
    renderInspector();
    syncNow();
    return true;
  }

  /* Two-tap arming. The timer is held so a second sheet-open cannot leave a
     stale armed button waiting behind it. */
  (function wireReset() {
    const btn = $("resetProject");
    if (!btn) return;
    const LABEL = btn.textContent;
    let armed = false, timer = null;

    function disarm() {
      armed = false;
      clearTimeout(timer);
      btn.classList.remove("armed");
      btn.textContent = LABEL;
    }

    btn.addEventListener("click", () => {
      if (!armed) {
        if (!S.media.length && !S.clips.length) { toast("This project is already empty"); return; }
        armed = true;
        btn.classList.add("armed");
        btn.textContent = "Tap again to erase everything";
        timer = setTimeout(disarm, 5000);
        return;
      }
      disarm();
      if (resetProject()) {
        closeSheets();
        toast("New video started. Add your footage with +");
      }
    });

    /* Closing the sheet cancels a pending confirmation. Coming back to a
       button still counting down would be its own small trap. */
    $("sheetBackdrop").addEventListener("click", (e) => {
      /* Only a click on the backdrop ITSELF. Without this test the button's own
         click bubbles up here and disarms the thing it just armed, so the
         second tap never finds it armed and the button does nothing forever. */
      if (e.target === $("sheetBackdrop")) disarm();
    });
    $("settingsBtn").addEventListener("click", disarm);
  })();

  /* ═══════════ INIT ═══════════ */

  // A canvas cannot draw with a webfont until that font has actually loaded,
  // and the export writes headings straight to canvas. Warm Anton up front so
  // the first export isn't silently rendered in the fallback face.
  if (document.fonts && document.fonts.load) {
    try { document.fonts.load('400 64px "Anton"'); } catch (e) {}
  }

  /* Synchronous, and BEFORE landing.js runs: it reads window.vcHasSession to
     decide whether to play the cinematic intro. Resuming an edit should drop you
     straight back into the editor, not make you sit through the intro again. */
  try { bootSnapshot = JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch (e) {}
  /* landing.js reads this to decide whether to replay the opening. A restored
     project no longer jumps past the landing, so the intro is no longer
     something to skip: the flag stays for the resume notice below. */
  let hasRestored = false;
  window.vcHasSession = false;
  const hadSession = !!(bootSnapshot && bootSnapshot.media && bootSnapshot.media.length);

  mountPreview($("editorStage"));
  showScreen("home");
  renderAll();
  renderTimeline();
  commit();

  if (hadSession) {
    restoreSession().then((ok) => {
      booting = false;
      if (!ok) { clearSession(); return; }
      /* Restored, but NOT entered. A reload belongs on the landing page; the
         project is waiting behind the "+" rather than thrown at you. */
      saveSession();
      renderAll();
      applyFindMode();
      renderClipsChip();
      hasRestored = true;
      if (new URLSearchParams(location.search).get("result") === "ready") showScreen("editor");
    }).catch(() => { booting = false; });
  } else {
    booting = false;
  }
  requestAnimationFrame((ts) => { lastTs = ts; requestAnimationFrame(loop); });
  renderInspector();   // the bottom bar's main tools from the start
})();
