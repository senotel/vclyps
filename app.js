/* ═══════════════════════════════════════════════════════════
   VEVRIS — app engine
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
    pps: 24,
    userMuted: false,
    seed: 1,
    format: "auto",
    mode: "entertainment",   // Short videos → Entertainment; more modes later
    aspect: "9:16",          // short-form default; see exportSize()
    vertical: false,
    // Find clips (clips.js): the bar's mode, its options, and what it found
    find: { on: false, len: "auto", from: "", to: "" },
    found: null              // {mediaId, prompt, window, length, clips:[{id,start,end,title,hook,why,type,made}]}
  };
  let nextId = 1;
  const IMG_DUR = 3;
  let finding = null;        // a running Find clips job, so the button can stop it

  function global_VevrisCaptions() { return window.VevrisCaptions || null; }

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
    hist.push(JSON.stringify({ c: S.clips, t: S.texts, cap: S.captions, co: S.capOpts, b: S.broll, s: S.sfx, m: S.music, a: S.audio }));
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
        enterEditor();
      });
    });
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
    if (window.VevrisSources) VevrisSources.warm();
  }

  function refreshAddSources() {
    if (!window.VevrisSources) return;
    VevrisSources.available().then((av) => {
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
      const stopped = window.VevrisSources && e instanceof VevrisSources.Cancelled;
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
      if (!window.VevrisSources || importing) return;
      document.querySelectorAll(".add-src").forEach((x) => x.classList.toggle("on", x === b));
      $("addList").innerHTML = "";
      if (src === "gphotos") openGooglePhotos();
      else if (src === "drive") importWith((o) => VevrisSources.fromDrive(o), "Opening Google Drive…");
      else if (src === "dropbox") importWith((o) => VevrisSources.fromDropbox(o), "Opening Dropbox…");
      else if (src === "zoom" || src === "vimeo") browseCloud(src);
    });
  });

  /* Google Photos: one tap signs in with Google, the next opens Google Photos
     (a browser allows one pop-up per tap). Once signed in, one tap does it. */
  const PHOTOS_WAIT = "Choose in Google Photos, then come back here…";
  function openGooglePhotos() {
    if (VevrisSources.photos.signedIn()) {
      importWith((o) => VevrisSources.fromGooglePhotos(o), PHOTOS_WAIT);
      return;
    }
    const status = $("addStatus");
    status.textContent = "Waiting for you to sign in with Google…";
    VevrisSources.photos.signIn().then(() => {
      status.textContent = "";
      $("addList").appendChild(cloudRow("Google Photos", "Signed in. Choose your videos and photos", "", "Open", () => {
        $("addList").innerHTML = "";
        importWith((o) => VevrisSources.fromGooglePhotos(o), PHOTOS_WAIT);
      }));
    }).catch((e) => {
      status.textContent = e instanceof VevrisSources.Cancelled ? "" : ((e && e.message) || "Sign-in didn't work. Try again.");
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
    VevrisSources.connect(src, { signal: ctl.signal })
      .then(() => {
        importing = null;
        setImporting(false);
        status.textContent = "";
        return src === "zoom" ? listZoom(0) : listVimeo(1);
      })
      .catch((e) => {
        importing = null;
        setImporting(false);
        status.textContent = e instanceof VevrisSources.Cancelled ? "" : ((e && e.message) || "Sign-in didn't work. Try again.");
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
    return VevrisSources.zoom.list(monthsBack).then((d) => {
      status.textContent = "";
      const meetings = d.meetings || [];
      if (!meetings.length && !list.children.length) {
        status.textContent = monthsBack ? "No cloud recordings in that month either." : "No cloud recordings in the last 30 days.";
      }
      meetings.forEach((m) => {
        const f = VevrisSources.zoom.pick(m.files);
        if (!f) return;
        const what = f.type === "M4A" ? "audio only" : "video";
        list.appendChild(cloudRow(m.topic, niceDay(m.start) + " · " + what + (f.size ? " · " + mbText(f.size) + " MB" : ""),
          m.duration ? m.duration + " min" : "", "Add",
          () => importWith((o) => VevrisSources.zoom.file(m, f, o), "Starting the download from Zoom…")));
      });
      list.appendChild(moreButton("Earlier recordings", () => listZoom(monthsBack + 1)));
    }).catch((e) => { status.textContent = (e && e.message) || "Couldn't list your Zoom recordings."; });
  }

  function listVimeo(page) {
    const status = $("addStatus"), list = $("addList");
    status.textContent = page > 1 ? "Loading more…" : "Finding your videos…";
    return VevrisSources.vimeo.list(page).then((d) => {
      status.textContent = "";
      const videos = d.videos || [];
      if (!videos.length && page === 1) status.textContent = "There are no videos on this Vimeo account yet.";
      videos.forEach((v) => {
        const can = !!v.file;
        list.appendChild(cloudRow(v.name,
          niceDay(v.created) + (can ? (v.file.height ? " · " + v.file.height + "p" : "") + (v.file.size ? " · " + mbText(v.file.size) + " MB" : "")
            : " · Vimeo allows downloads on Standard plans and up"),
          v.duration ? fmtLen(v.duration) : "", can ? "Add" : "Locked",
          can ? () => importWith((o) => VevrisSources.vimeo.file(v, o), "Starting the download from Vimeo…") : null));
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
    if (!window.VevrisBrain || item.type === "audio") return;   // nothing to watch in a sound
    item._an = "working";
    VevrisBrain.analyze(item).then(() => {
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

  function addText() {
    if (!S.clips.length) { toast("Add footage to the timeline first"); return; }
    const t = {
      id: nextId++,
      text: "Your text",
      start: clamp(S.time, 0, Math.max(0, total() - 0.5)),
      dur: 3,
      size: 34,
      color: "#ffffff",
      pos: "bottom"
    };
    S.texts.push(t);
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
    const removed = selType === "clip" ? clipById(S.sel.id)
      : selType === "text" ? textById(S.sel.id)
      : selType === "broll" ? brollById(S.sel.id)
      : selType === "uaudio" ? audioById(S.sel.id) : sfxById(S.sel.id);
    if (selType === "clip") S.clips = S.clips.filter((c) => c.id !== S.sel.id);
    else if (selType === "text") S.texts = S.texts.filter((t) => t.id !== S.sel.id);
    else if (selType === "broll") S.broll = S.broll.filter((b) => b.id !== S.sel.id);
    else if (selType === "uaudio") S.audio = S.audio.filter((a) => a.id !== S.sel.id);
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
    if (!window.VevrisAudioOut) { toast("Download isn't available. Reload the page and try again"); return; }
    btn.disabled = true;
    btn.textContent = "Preparing…";
    try {
      /* kept, so a second tap saves at once: a share sheet must open within
         seconds of the tap, and preparing a long sound can take longer */
      const out = soundFiles.get(m) || await VevrisAudioOut.soundFile(m);
      soundFiles.set(m, out);
      // a download in a browser, the share sheet inside an app (platform.js)
      if (await VevrisPlatform.save(out.blob, out.name) === "cancelled") throw new Error("Not saved.");
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
    };
  }

  const CapT = () => window.VevrisCaptionTools || null;
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
      style: o.style, font: o.font || null, scale: o.scale || 1, y: o.y,
      highlight: o.highlight, speakers: o.speakers, emoji: o.emoji,
      censor: o.censor, isBad: o.censor === "off" ? null : capMatcher(o.translate || S.capLang),
      translate: o.translate || null, box: box || null
    };
  }

  function capStyle() {
    const C = global_VevrisCaptions();
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
    const C = global_VevrisCaptions(), T = CapT();
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
    const C = global_VevrisCaptions();
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
    const C = global_VevrisCaptions();
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
    const C = global_VevrisCaptions();
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
    const C = global_VevrisCaptions();
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
    const SL = window.VevrisCaptionStyles;
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

  function fillFontSelect() {
    const T = CapT();
    const sel = $("capFont");
    sel.innerHTML = "";
    const add = (parent, v, label) => { const o = document.createElement("option"); o.value = v; o.textContent = label; parent.appendChild(o); };
    add(sel, "", "The style's own font");
    if (!T) return;
    const g1 = document.createElement("optgroup");
    g1.label = "Caption fonts";
    T.FONTS.map((f) => f[0]).sort().forEach((f) => add(g1, f, f));
    sel.appendChild(g1);
    const mine = T.customFonts();
    if (mine.length) {
      const g2 = document.createElement("optgroup");
      g2.label = "Your fonts";
      mine.forEach((f) => add(g2, f, f));
      sel.appendChild(g2);
    }
    sel.value = S.capOpts.font || "";
  }

  function renderCaptionSheet() {
    const C = global_VevrisCaptions(), T = CapT(), o = S.capOpts;
    if (!C) return;
    if (T) T.loadFontCss();
    buildTiles();
    fillLangSelects();
    if (!$("capFont").options.length || $("capFont").dataset.custom !== String(T ? T.customFonts().length : 0)) {
      fillFontSelect();
      $("capFont").dataset.custom = String(T ? T.customFonts().length : 0);
    }
    const has = S.captions.length > 0;
    $("capMake").textContent = has ? "Update captions" : "Add captions";
    $("capRemove").classList.toggle("hidden", !has);
    $("capHeard").textContent = has && S.capLang ? "Heard in " + langName(S.capLang) : "";
    document.querySelectorAll("#capGrid .cap-tile").forEach((b) => b.classList.toggle("selected", b.dataset.style === o.style));
    $("capFont").value = o.font || "";
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
    const C = global_VevrisCaptions();
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
    $("capFont").addEventListener("change", () => {
      S.capOpts.font = $("capFont").value;
      capChanged();
      filterTiles();
    });
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

  function renderTimeline() {
    const vt = $("videoTrack"), tt = $("textTrack"), ruler = $("ruler");
    const ot = $("overlayTrack"), at = $("audioTrack"), mt = $("musicTrack"), ut = $("uaudioTrack");
    vt.innerHTML = ""; tt.innerHTML = ""; ot.innerHTML = ""; at.innerHTML = ""; mt.innerHTML = ""; ut.innerHTML = "";

    const totSec = Math.max(total(), 12);
    const W = Math.max(totSec * S.pps + 200, $("tlScroll").clientWidth - PADX * 2);
    [vt, tt, ot, at, mt, ut, ruler].forEach((x) => { x.style.width = W + "px"; });

    /* Half a viewport of padding at each end so the first and last frame can
       both sit under a centred playhead — the same reason CapCut lets you
       scroll past both ends of your edit. */
    $("tlInner").style.padding = "0 " + padL() + "px";

    // ruler ticks
    ruler.innerHTML = "";
    const step = S.pps >= 40 ? 1 : S.pps >= 20 ? 2 : S.pps >= 12 ? 5 : 10;
    for (let s = 0; s <= W / S.pps; s += step) {
      const tick = document.createElement("div");
      tick.className = "rt";
      tick.style.left = s * S.pps + "px";
      const lb = document.createElement("span");
      lb.textContent = fmt(s);
      tick.appendChild(lb);
      ruler.appendChild(tick);
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
      if (m && m.thumb) {
        const img = document.createElement("img");
        img.src = m.thumb;
        cel.appendChild(img);
      }
      const nm = document.createElement("span");
      nm.className = "cname";
      nm.textContent = m ? m.name : "clip";
      cel.appendChild(nm);
      const du = document.createElement("span");
      du.className = "cdur";
      du.textContent = dispDur(c).toFixed(1) + "s";
      cel.appendChild(du);

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

    /* The + at the end of the main track. CapCut puts one here and it is the
       only "add" control that tells you WHERE the thing will land, which is
       why the toolbar button alone was never quite enough. */
    const plus = mk("button", "clip-add", "+");
    plus.title = "Add a video or photo to the end";
    plus.style.left = x + "px";
    plus.addEventListener("click", (ev) => { ev.stopPropagation(); openPicker("editor"); });
    vt.appendChild(plus);

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
      tel.textContent = "T  " + t.text;
      tel.addEventListener("pointerdown", (e) => holdToDrag(e, (ev) => startTextDrag(ev, t)));
      tt.appendChild(tel);
    });

    // a phone folds away the lanes with nothing on them (styles.css)
    [ot, tt, ut, at, mt].forEach((t) => t.classList.toggle("empty", !t.children.length));
    updatePlayheadUI();
  }

  /* On a touchscreen a finger on a clip means one of three things. A swipe
     scrolls, as it does everywhere else on a phone: sideways along the
     timeline, up and down through the editor. Holding still for a moment picks
     the clip up to move it, as in CapCut. A quick tap selects, as before.
     Without this a phone could only scroll the timeline from the thin gaps
     between clips, because every clip took the swipe as a drag. A mouse goes
     straight through. */
  const HOLD_MS = 280;
  function holdToDrag(e, start) {
    if (e.pointerType !== "touch") { start(e); return; }
    e.preventDefault();
    const sc = $("tlScroll"), page = $("screen-editor");
    const id = e.pointerId, x0 = e.clientX, y0 = e.clientY;
    const s0 = sc.scrollLeft, p0 = page.scrollTop;
    let mode = "wait";
    const finish = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    const timer = setTimeout(() => {
      if (mode !== "wait") return;
      finish();
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (err) {}
      start(e);   // picked up: the drag code takes the rest of the gesture
    }, HOLD_MS);
    const move = (ev) => {
      if (ev.pointerId !== id) return;
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (mode === "wait" && Math.max(Math.abs(dx), Math.abs(dy)) > 6) {
        clearTimeout(timer);
        mode = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        if (mode === "x" && S.playing) pause();
      }
      if (mode === "x") sc.scrollLeft = s0 - dx;
      else if (mode === "y") page.scrollTop = p0 - dy;
    };
    const up = (ev) => {
      if (ev.pointerId !== id) return;
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

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > 8) { moved = true; cel.classList.add("dragging"); }
      if (moved) cel.style.transform = "translateX(" + dx + "px)";
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {
        S.sel = { type: "clip", id: clip.id };
        renderTimeline();
        renderInspector();
        return;
      }
      const dx = ev.clientX - startX;
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

    const move = (ev) => {
      const dSrc = ((ev.clientX - startX) / S.pps) * clip.speed;
      if (side === "l") clip.in = clamp(oIn + dSrc, 0, clip.out - 0.15);
      else clip.out = clamp(oOut + dSrc, clip.in + 0.15, maxOut);
      renderTimeline();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
  function startTextDrag(e, t) {
    e.preventDefault();
    const startX = e.clientX;
    const oStart = t.start;
    let moved = false;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) > 6) moved = true;
      if (moved) {
        t.start = clamp(oStart + dx / S.pps, 0, Math.max(0, total() - 0.3));
        renderTimeline();
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (moved) commit();
      S.sel = { type: "text", id: t.id };
      renderTimeline();
      renderInspector();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
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
    sc.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".clip, .tclip, .oclip, .aclip, .uclip, .mclip, .clip-add, .handle, .ruler")) return;
      down = true; moved = false; x0 = e.clientX; s0 = sc.scrollLeft;
    });
    window.addEventListener("pointermove", (e) => {
      if (!down) return;
      const dx = e.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      if (S.playing) pause();
      sc.scrollLeft = s0 - dx;
    });
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
  const sfxById = (id) => S.sfx.find((s) => s.id === id) || null;
  const OVERLAY_DUR = 3;

  function sfxEngine() { return window.VevrisSFX || null; }
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
    return { ctx: audioCtx, dest: audioDest };
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
    if (!S.sfx.length && !S.music && !S.audio.length) return;
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

  function snapMarks() {
    const marks = [S.time, 0];
    let acc = 0;
    S.clips.forEach((c) => { acc += dispDur(c); marks.push(acc); });
    return marks;
  }

  /* Returns the start time to use, having tried to land either edge on a mark. */
  function snapSpan(start, span) {
    const tol = 8 / S.pps;
    let best = start, bestD = tol;
    snapMarks().forEach((m) => {
      const dStart = Math.abs(m - start);
      if (dStart < bestD) { bestD = dStart; best = m; }
      const dEnd = Math.abs(m - (start + span));
      if (dEnd < bestD) { bestD = dEnd; best = m - span; }
    });
    return best;
  }

  function startFreeDrag(e, item, kind, el) {
    e.preventDefault();
    e.stopPropagation();
    const already = S.sel && S.sel.type === kind && S.sel.id === item.id;
    S.sel = { type: kind, id: item.id };
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
      const track = kind === "broll" ? $("overlayTrack") : kind === "uaudio" ? $("uaudioTrack") : $("audioTrack");
      // overlays and audio clips grow trim handles when selected, so they redraw
      if (kind === "broll" || kind === "uaudio") {
        renderTimeline();
        el = track.querySelector('[data-id="' + item.id + '"]') || el;
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
    const startAt = item.start;
    const span = kind === "broll" ? item.dur : kind === "uaudio" ? audioDur(item) : sfxDur(item.name);
    const limit = Math.max(0, total() - 0.05);
    let moved = false;

    const move = (ev) => {
      const dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const raw = clamp(startAt + dx / S.pps, 0, limit);
      item.start = clamp(snapSpan(raw, span), 0, limit);
      if (el) el.style.left = item.start * S.pps + "px";
      syncOverlays();
      if (kind === "uaudio") syncAudioClips();   // its row is settled on release
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
        const at = clamp(at0 + d, 0, at0 + dur0 - MIN);
        b.start = at;
        b.dur = dur0 + (at0 - at);
      } else {
        b.dur = Math.max(MIN, dur0 + d);
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

  /* One bar the length of the edit, because that is what the bed does: it
     loops under everything. Tap to select it and set its level. */
  function renderMusicTrack(mt) {
    if (!S.music) return;
    const on = S.sel && S.sel.type === "music";
    const el = mk("div", "mclip" + (on ? " sel" : ""));
    el.style.left = "0px";
    el.style.width = Math.max(total() * S.pps, 60) + "px";
    const name = mk("span", "mname", "");
    name.textContent = S.music.title;
    el.appendChild(name);
    el.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      S.sel = { type: "music" };
      renderTimeline();
      renderInspector();
    });
    mt.appendChild(el);
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
      /* The same crude waveform the sound lane uses: it reads as audio at a
         glance without pretending to be an analysis of the file. */
      const wav = mk("div", "awave");
      for (let i = 0; i < 40; i++) {
        const bar = mk("i");
        bar.style.height = (25 + (((i + a.id) * 37) % 65)) + "%";
        wav.appendChild(bar);
      }
      el.appendChild(wav);
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
      else {
        g.connect(audioCtx.destination);   // speakers
        g.connect(audioDest);              // the exported file
      }
      v.gain = g;
    } catch (e) {
      v.failed = true;
      if (window.VevrisDiag) window.VevrisDiag.last.audioClips = "not routed into the export: " + ((e && e.message) || e);
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
          ctx: opts.ctx, dest: opts.dest,
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

  /* On a phone the settings open under the timeline, so a tap on a clip never
     shoves the clip itself off the screen. The editor scrolls just far enough
     to show that they have opened, leaving the timeline in view. */
  const phoneLayout = window.matchMedia("(max-width: 760px)");
  function revealInspector() {
    const ins = $("inspector"), page = $("screen-editor");
    if (!phoneLayout.matches || ins.classList.contains("hidden")) return;
    const r = ins.getBoundingClientRect(), view = page.getBoundingClientRect();
    const need = r.top + Math.min(r.height, 120) - view.bottom;
    if (need > 0) page.scrollBy({ top: need, behavior: "smooth" });
  }

  function renderInspector() {
    const ins = $("inspector");
    if (ins.classList.contains("hidden")) setTimeout(revealInspector, 0);   // once it has been filled
    ins.innerHTML = "";
    if (!S.sel) { ins.classList.add("hidden"); return; }
    ins.classList.remove("hidden");

    const closeBtn = mk("button", "ins-close", "✕");
    closeBtn.addEventListener("click", () => {
      S.sel = null;
      renderTimeline();
      renderInspector();
    });

    if (S.sel.type === "all") {
      ins.appendChild(mk("span", "ins-title", "<em>✦</em> Look, applies to every clip"));
      ins.appendChild(filterChips(
        () => (S.clips[0] ? S.clips[0].filter : "none"),
        (key) => { S.clips.forEach((c) => { c.filter = key; }); }
      ));
      ins.appendChild(closeBtn);
      return;
    }

    if (S.sel.type === "broll") {
      const b = brollById(S.sel.id);
      if (!b) { ins.classList.add("hidden"); return; }
      const m = mediaById(b.mediaId);
      ins.appendChild(mk("span", "ins-title", "<em>▣</em>" + (m ? m.name : "overlay")));

      /* Cover fills the frame; inset keeps the speaker visible. Which one is
         right depends entirely on whether their face IS the moment, so this
         is a choice rather than a setting with a correct value. */
      const modes = mk("div", "filter-chips");
      [["inset", "Panel"], ["cover", "Full frame"]].forEach(([key, label]) => {
        const ch = mk("button", "fchip" + (b.mode === key ? " active" : ""), label);
        ch.addEventListener("click", () => {
          b.mode = key;
          commit(); renderInspector(); syncOverlays();
        });
        modes.appendChild(ch);
      });
      ins.appendChild(group("Size", modes));
      ins.appendChild(group("Length", slider(0.3, 12, 0.1, b.dur,
        (v) => { b.dur = v; renderTimeline(); syncOverlays(); },
        () => commit(), (v) => v.toFixed(1) + "s")));
      ins.appendChild(group("Starts at", slider(0, Math.max(0.1, total()), 0.05, Math.min(b.start, total()),
        (v) => { b.start = v; renderTimeline(); syncOverlays(); },
        () => commit(), (v) => fmt(v))));
      ins.appendChild(closeBtn);
      return;
    }

    if (S.sel.type === "music") {
      if (!S.music) { ins.classList.add("hidden"); return; }
      const title = mk("span", "ins-title", "<em>\u266A</em>");
      title.appendChild(document.createTextNode(S.music.title));
      ins.appendChild(title);

      ins.appendChild(group("Volume", slider(0, 1, 0.05, typeof S.music.gain === "number" ? S.music.gain : 0.35,
        (v) => { S.music.gain = v; applyMusicGain(); },
        () => commit(), (v) => Math.round(v * 100) + "%")));

      const swap = mk("button", "fchip", "Change");
      swap.addEventListener("click", () => {
        renderSoundSheet();
        showAudioPane("music");
        openSheet("soundSheet");
        renderMusic();
      });
      const drop = mk("button", "fchip", "Remove");
      drop.addEventListener("click", () => {
        S.music = null;
        loadMusicElement();
        S.sel = null;
        commit();
        renderTimeline();
        renderInspector();
        toast("Music removed");
      });
      const row = mk("div", "filter-chips");
      row.appendChild(swap);
      row.appendChild(drop);
      ins.appendChild(group("Track", row));

      ins.appendChild(closeBtn);
      return;
    }

    if (S.sel.type === "sfx") {
      const x = sfxById(S.sel.id);
      if (!x) { ins.classList.add("hidden"); return; }
      const e = sfxEngine();
      const info = e ? e.info(x.name) : null;
      ins.appendChild(mk("span", "ins-title", "<em>♪</em>" + (info ? info.label : x.name)));

      const hear = mk("button", "fchip", "Preview");
      hear.addEventListener("click", () => previewSfx(x.name));
      ins.appendChild(group("Sound", hear));

      ins.appendChild(group("Volume", slider(0, 2, 0.05, typeof x.gain === "number" ? x.gain : 1,
        (v) => { x.gain = v; },
        () => commit(), (v) => Math.round(v * 100) + "%")));
      ins.appendChild(group("Starts at", slider(0, Math.max(0.1, total()), 0.05, Math.min(x.start, total()),
        (v) => { x.start = v; renderTimeline(); },
        () => commit(), (v) => fmt(v))));
      ins.appendChild(closeBtn);
      return;
    }

    if (S.sel.type === "uaudio") {
      const a = audioById(S.sel.id);
      if (!a) { ins.classList.add("hidden"); return; }
      const m = mediaById(a.mediaId);
      const title = mk("span", "ins-title", "<em>♪</em>");
      title.appendChild(document.createTextNode(a.name || "Audio"));
      ins.appendChild(title);

      // above 100% only once the sound runs through the audio graph (see voiceFor)
      ins.appendChild(group("Volume", slider(0, 1.5, 0.05, typeof a.gain === "number" ? a.gain : 1,
        (v) => { a.gain = v; syncAudioClips(); },
        () => commit(), (v) => Math.round(v * 100) + "%")));
      ins.appendChild(group("Fade in", slider(0, 3, 0.05, a.fadeIn || 0,
        (v) => { a.fadeIn = v; }, () => commit(), (v) => v.toFixed(2) + "s")));
      ins.appendChild(group("Fade out", slider(0, 3, 0.05, a.fadeOut || 0,
        (v) => { a.fadeOut = v; }, () => commit(), (v) => v.toFixed(2) + "s")));
      ins.appendChild(group("Starts at", slider(0, Math.max(0.1, total()), 0.05, Math.min(a.start, total()),
        (v) => { a.start = v; renderTimeline(); syncAudioClips(); },
        () => commit(), (v) => fmt(v))));
      if (m && m.type === "video") {
        ins.appendChild(group("Speed", slider(0.25, 3, 0.05, a.speed || 1,
          (v) => { a.speed = v; renderTimeline(); syncAudioClips(); },
          () => commit(), (v) => v.toFixed(2) + "×"), 3));
      }
      const meta = mk("span", "ins-meta", "");
      meta.textContent = (m && m.type === "video" ? "Sound from " : "From ") + (m ? m.name : "a file that is gone") +
        " · " + a.in.toFixed(1) + "s to " + a.out.toFixed(1) + "s · plays " + audioDur(a).toFixed(1) + "s";
      ins.appendChild(meta);
      ins.appendChild(closeBtn);
      return;
    }

    if (S.sel.type === "clip") {
      const c = clipById(S.sel.id);
      if (!c) { ins.classList.add("hidden"); return; }
      const m = mediaById(c.mediaId);
      const isVid = m && m.type === "video";

      ins.appendChild(mk("span", "ins-title", "<em>" + (isVid ? "▶" : "▣") + "</em>" + (m ? m.name : "clip")));
      ins.appendChild(group("Look", filterChips(() => c.filter, (k) => { c.filter = k; })));

      if (isVid) {
        ins.appendChild(group("Speed", slider(0.25, 3, 0.05, c.speed,
          (v) => { c.speed = v; renderTimeline(); },
          () => commit(),
          (v) => v.toFixed(2) + "×"), 2));
        ins.appendChild(group("Volume", slider(0, 1, 0.05, c.volume,
          (v) => { c.volume = v; },
          () => commit(),
          (v) => Math.round(v * 100) + "%"), 2));
        const mute = mk("button", "ins-toggle" + (c.muted ? " on" : ""), c.muted ? "Muted" : "Sound on");
        mute.dataset.min = "3";
        mute.addEventListener("click", () => {
          c.muted = !c.muted;
          mute.classList.toggle("on", c.muted);
          mute.textContent = c.muted ? "Muted" : "Sound on";
          commit();
        });
        ins.appendChild(mute);
        /* CapCut's Extract audio: the sound moves to the audio track, lined up
           under this clip, and the clip goes quiet. */
        const extract = mk("button", "fchip", "Extract audio");
        extract.title = "Move this clip's sound onto its own track";
        extract.addEventListener("click", () => extractClipAudio(c));
        ins.appendChild(group("Sound", extract));
      } else {
        ins.appendChild(group("Show for", slider(0.5, 15, 0.5, c.out - c.in,
          (v) => { c.out = c.in + v; renderTimeline(); },
          () => commit(),
          (v) => v.toFixed(1) + "s")));
      }

      ins.appendChild(group("Fade in", slider(0, 1.5, 0.05, c.fadeIn || 0,
        (v) => { c.fadeIn = v; }, () => commit(), (v) => v.toFixed(2) + "s"), 3));
      ins.appendChild(group("Fade out", slider(0, 1.5, 0.05, c.fadeOut || 0,
        (v) => { c.fadeOut = v; }, () => commit(), (v) => v.toFixed(2) + "s"), 3));

      const meta = mk("span", "ins-meta",
        "in " + c.in.toFixed(2) + "s · out " + c.out.toFixed(2) + "s · plays " + dispDur(c).toFixed(2) + "s");
      meta.dataset.min = "4";
      ins.appendChild(meta);
      ins.appendChild(closeBtn);
      return;
    }

    // text selection
    const t = textById(S.sel.id);
    if (!t) { ins.classList.add("hidden"); return; }
    ins.appendChild(mk("span", "ins-title", "<em>T</em> Text"));

    const ti = document.createElement("input");
    ti.type = "text"; ti.value = t.text; ti.maxLength = 80;
    ti.addEventListener("input", () => { t.text = ti.value; renderTimeline(); });
    ti.addEventListener("change", () => commit());
    ins.appendChild(group("Says", ti));

    ins.appendChild(group("Size", slider(14, 88, 2, t.size,
      (v) => { t.size = v; }, () => commit(), (v) => v + "px"), 2));

    const ci = document.createElement("input");
    ci.type = "color"; ci.value = t.color;
    ci.addEventListener("input", () => { t.color = ci.value; });
    ci.addEventListener("change", () => commit());
    ins.appendChild(group("Color", ci, 2));

    const seg = mk("div", "ins-seg");
    seg.dataset.min = "3";
    ["top", "center", "bottom"].forEach((p) => {
      const b = mk("button", t.pos === p ? "active" : "", p[0].toUpperCase() + p.slice(1));
      b.addEventListener("click", () => {
        t.pos = p;
        seg.querySelectorAll("button").forEach((y) => y.classList.remove("active"));
        b.classList.add("active");
        commit();
      });
      seg.appendChild(b);
    });
    ins.appendChild(seg);

    ins.appendChild(group("Shows for", slider(0.5, 20, 0.5, t.dur,
      (v) => { t.dur = v; renderTimeline(); }, () => commit(), (v) => v.toFixed(1) + "s")));

    ins.appendChild(closeBtn);
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
    if (window.VevrisNotices) VevrisNotices.show("fsNotice", title, detail, 5000);
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
  $("stage").addEventListener("click", (e) => {
    if (e.target.closest("#stageEmpty")) return; // the add-button handles itself
    if (!S.clips.length) return;
    if (inFs()) { primeAudio(); if (S.playing) pause(); else play(); }
    else enterFs();
  });

  let seekDragging = false;
  function paintSeek() {
    const sb = $("seekBar");
    const pct = clamp(sb.value / 10, 0, 100); // max=1000 → percent
    sb.style.background =
      "linear-gradient(90deg, var(--acc) 0%, var(--acc) " + pct + "%, var(--bg3) " + pct + "%, var(--bg3) 100%)";
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

  function syncMedia() {
    $("stageEmpty").classList.toggle("hidden", S.clips.length > 0);
    const info = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
    if (!info) { pv.pause(); return; }
    const { clip, offset } = info;
    const m = mediaById(clip.mediaId);
    if (!m) return;

    if (m.type === "video") {
      pi.classList.add("hidden");
      pv.classList.remove("hidden");
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
      pv.style.filter = FILTERS[clip.filter].css;
      if (clip.kb) {
        const p = clamp(offset / Math.max(dispDur(clip), 0.01), 0, 1);
        pv.style.transform = "scale(" + (clip.kb.s0 + (clip.kb.s1 - clip.kb.s0) * p) + ")";
      } else {
        pv.style.transform = "";
      }
      if (S.playing && pv.paused) pv.play().catch(() => {});
      if (!S.playing && !pv.paused) pv.pause();
    } else {
      pv.pause();
      pv.classList.add("hidden");
      pi.classList.remove("hidden");
      if (pi.dataset.mid !== String(m.id)) {
        pi.src = m.url;
        pi.dataset.mid = String(m.id);
      }
      pi.style.filter = FILTERS[clip.filter].css;
      if (clip.kb) {
        const p = clamp(offset / Math.max(dispDur(clip), 0.01), 0, 1);
        const k = clip.kb;
        const zs = k.s0 + (k.s1 - k.s0) * p;
        const tx = (k.x0 + (k.x1 - k.x0) * p) * 100;
        const ty = (k.y0 + (k.y1 - k.y0) * p) * 100;
        pi.style.transform = "scale(" + zs + ") translate(" + tx + "%, " + ty + "%)";
      } else {
        pi.style.transform = "";
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
      cx: frameW / 2,
      // vertical CENTRE of the text block — the DOM translates -50% onto it and
      // the canvas centres its stack of lines on it, so both land together
      cy: t.pos === "top" ? frameH * 0.14 : t.pos === "center" ? frameH * 0.5 : frameH * 0.86,
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

  /* Where the picture actually is inside the stage. The <video>/<img> stretches
     to the full stage box but the image letterboxes within it (object-fit:
     contain), and in fullscreen the stage becomes the whole screen — so this
     gap between "the box" and "the picture" is exactly what used to distort
     headings on the way into fullscreen. */
  function pictureBox() {
    const stage = $("stage");
    const sw = stage.clientWidth || 0, sh = stage.clientHeight || 0;
    const showingImg = !pi.classList.contains("hidden");
    const vw = showingImg ? pi.naturalWidth : pv.videoWidth;
    const vh = showingImg ? pi.naturalHeight : pv.videoHeight;
    if (!vw || !vh || !sw || !sh) return { x: 0, y: 0, w: sw || 1, h: sh || 1 };
    const sc = Math.min(sw / vw, sh / vh);
    const w = vw * sc, h = vh * sc;
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

  function syncOverlays() {
    const layer = $("overlayLayer");
    layer.innerHTML = "";
    const box = pictureBox();
    syncBroll(box);   // b-roll sits under the text/captions, over the footage
    const karaoke = S.captions && S.captions.length > 0;
    S.texts.forEach((t) => {
      // when word-timed captions are on, they own the caption layer —
      // don't also render the AI's sentence-captions (would double up)
      if (karaoke && t.cap) return;
      if (S.time >= t.start && S.time <= t.start + t.dur) {
        const L = headingLayout(t, box.w, box.h);
        const d = mk("div", "overlay-text");
        d.textContent = t.text;
        d.style.fontSize = L.size + "px";
        d.style.lineHeight = HEADING_LINE;
        d.style.color = t.color;
        // explicit left + width, NOT centre + shrink-to-fit — see styles.css
        d.style.left = (box.x + L.x) + "px";
        d.style.width = L.maxW + "px";
        d.style.top = (box.y + L.cy) + "px";
        layer.appendChild(d);
      }
    });
    $("fadeVeil").style.opacity = fadeAlpha(clipAt(Math.min(S.time, Math.max(total() - 0.001, 0))));
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
    const C = global_VevrisCaptions();
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
    syncAudioClips();
    applyBleep();
    syncOverlays();
    updateTransport();
    updatePlayheadUI();
    if (EXP.active && !EXP.suspended) { drawExportFrame(); watchExportStall(ts); }
  }

  function loop(ts) {
    // Exactly one owner advances playback: worker while exporting, rAF otherwise.
    if (!EXP.active || !window.VevrisRenderClock || !VevrisRenderClock.running) frameTick(ts);
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
    const D = (window.VevrisDiag && window.VevrisDiag.last) || {};
    const entrances = [];
    if (!list || !list.length) { D.broll = "none requested by the Director"; return entrances; }
    if (!window.VevrisBroll || !VevrisBroll.available()) { D.broll = "not configured"; return entrances; }

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
      try { file = await VevrisBroll.find(want.query, want.kind, want.say); } catch (e) {}
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

  function brollRect(b, box) {
    if (b.mode === "cover") return { x: box.x, y: box.y, w: box.w, h: box.h };
    const s = box.w * BROLL_SIZE;
    return {
      x: box.x + (box.w - s) / 2,
      y: box.y + box.h * BROLL_CY - s / 2,
      w: s,
      h: s
    };
  }

  const pvB = $("pvB"), piB = $("piB");

  function syncBroll(box) {
    const b = brollAt(S.time);
    if (!b) {
      pvB.classList.add("hidden");
      piB.classList.add("hidden");
      if (!pvB.paused) pvB.pause();
      return;
    }
    const m = mediaById(b.mediaId);
    if (!m) return;
    const r = brollRect(b, box);
    const el = m.type === "video" ? pvB : piB;
    const other = m.type === "video" ? piB : pvB;
    other.classList.add("hidden");
    if (el.dataset.mid !== String(m.id)) {
      el.src = m.url;
      el.dataset.mid = String(m.id);
    }
    el.classList.remove("hidden");
    el.classList.toggle("inset", b.mode !== "cover");
    el.style.left = r.x + "px";
    el.style.top = r.y + "px";
    el.style.width = r.w + "px";
    el.style.height = r.h + "px";
    // mirror the export's subject-aware crop, or preview and file disagree
    const mcx = (m.analysis && m.analysis.vis && m.analysis.vis.avgMcx) || 0.5;
    el.style.objectPosition = Math.round(mcx * 100) + "% 50%";
    if (m.type === "video") {
      if (S.playing && pvB.paused) pvB.play().catch(() => {});
      if (!S.playing && !pvB.paused) pvB.pause();
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
    const C = global_VevrisCaptions();
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

  function diagLast() { return (window.VevrisDiag && window.VevrisDiag.last) || {}; }

  function placeDirectorSounds(moments, entrances) {
    const D = diagLast();
    const want = (moments || []).concat(entrances || []);
    if (!want.length) { D.sfx = "none chosen"; return 0; }
    if (!sfxAvailable() || !window.VevrisBrain || !VevrisBrain.placeSounds) {
      D.sfx = "unavailable in this browser";
      return 0;
    }
    const placed = VevrisBrain.placeSounds({ want: want, clips: S.clips, media: S.media, keep: S.sfx });
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
    const B = window.VevrisBrain;
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
      ? "Speech understanding on. A small model downloads the first time it's used"
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
      provider: (window.VevrisDiag && window.VevrisDiag.last && window.VevrisDiag.last.provider) || null
    });
  }

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = String(s);
    return d.innerHTML;
  }

  function renderAiStatus(summary) {
    const el = $("aiStatus");
    const D = (window.VevrisDiag && window.VevrisDiag.last) || {};
    // every diagnostic dump carries the build, so a pasted console log is
    // enough to know exactly what the user was running
    if (window.VevrisVersion) D.build = window.VevrisVersion.label;
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
    if (window.VevrisVersion) bits.push("v" + window.VevrisVersion.version);
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
    if (window.VevrisNotices) VevrisNotices.dismiss("doneCard");
    generating = true;
    stayAwake("generate");
    if (window.VevrisDiag) window.VevrisDiag.last = {};
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
      if (window.VevrisBrain) {
        if (window.IntelligenceEngine && IntelligenceEngine.checkAccess) await IntelligenceEngine.checkAccess();
        await VevrisBrain.prepare(media, { speech: speechOn(), status: progress });
        let range = null;
        if (opts.range) {
          progress("Looking at the clip…");
          const item = mediaById(opts.range.mediaId);
          let keyframes = [];
          try { keyframes = await VevrisClips.rangeKeyframes(item, opts.range.start, opts.range.end, 6); } catch (e) {}
          range = { mediaId: opts.range.mediaId, start: opts.range.start, end: opts.range.end, keyframes: keyframes };
        }
        progress("Directing the edit…");
        g = await VevrisBrain.plan({
          prompt: prompt, media: media, seed: S.seed++, format: S.format === "auto" ? null : S.format,
          range: range, target: opts.target || null,
          /* A track the creator picked by hand is theirs: the Director is told
             it exists and plans around it rather than choosing another. */
          music: { available: navigator.onLine !== false, chosen: S.music && S.music.by !== "director" ? S.music.title : null }
        });
      }
    } catch (e) {
      g = null;
      directorFailure = e;
      if (window.VevrisDiag) window.VevrisDiag.last.brainError = (e && e.message) || String(e);
    }
    try {
      if (directorFailure) throw directorFailure;
      if (!g || !g.clips.length) throw new Error("The AI Director could not prepare an edit. Reload the app and retry; your timeline has not been changed.");
      applyGenerated(g);
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
    $("findFrom").value = S.find.from || "";
    $("findTo").value = S.find.to || "";
    refreshFindSrc();
    fitPromptPlaceholder();
  }

  function refreshFindSrc() {
    const el = $("findSrc");
    if (!el || !window.VevrisClips) return;
    const src = findSource();
    el.textContent = src ? "In " + src.name + (src.duration ? ", " + VevrisClips.fmt(src.duration) : "") : "Add a video to search";
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
    const from = VevrisClips.parseTime($("findFrom").value);
    const to = VevrisClips.parseTime($("findTo").value);
    if (Number.isNaN(from)) { $("findFrom").classList.add("bad"); toast("Start time should look like 12:30"); return; }
    if (Number.isNaN(to)) { $("findTo").classList.add("bad"); toast("End time should look like 45:00"); return; }
    if (from != null && to != null && to <= from) { $("findTo").classList.add("bad"); toast("The end has to come after the start"); return; }

    if (window.VevrisDiag) window.VevrisDiag.last = {};
    if (window.VevrisNotices) VevrisNotices.dismiss("doneCard");
    pause();
    const jb = VevrisClips.job();
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
      const res = await VevrisClips.find(item, {
        prompt: $("semiPrompt").value.trim(),
        length: S.find.len,
        from: from, to: to,
        job: jb, say: say,
        cache: { get: idbGet, put: idbPut }
      });
      S.found = res;
      renderClipsChip();
      saveSession();
      const n = res.clips.length;
      const D = (window.VevrisDiag && window.VevrisDiag.last) || {};
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
      if (e instanceof VevrisClips.Cancelled) {
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
    return VevrisClips.fmt(c.start) + " to " + VevrisClips.fmt(c.end) + " · " + len + "s" + (kind ? " · " + kind : "");
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
      const title = mk("span", "snd-name", "");
      title.textContent = (i + 1) + ". " + c.title;
      meta.appendChild(title);
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
      onDone: () => { c.made = true; }
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
    return window.VevrisRenderClock && VevrisRenderClock.running &&
      EXP.track && typeof EXP.track.requestFrame === "function";
  }

  function stopRenderClock() {
    if (window.VevrisRenderClock) VevrisRenderClock.stop();
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
    if (window.VevrisNotices) VevrisNotices.complete(title, body, kind);
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
      /* The footage's sound goes through one gain, the "speech" stage, so a
         swear word can be silenced and bleeped in both places at once. */
      const speech = ctx.createGain();
      src.connect(speech);
      speech.connect(ctx.destination); // to speakers (preview)
      speech.connect(dest);            // tapped for the export file
      audioCtx = ctx;
      audioDest = dest;
      speechGain = speech;
    } catch (e) {
      audioGraphFailed = true;
      throw e;
    }
    buildBleep();
  }

  /* ── the bleep ────────────────────────────────────────────────────────────
     A 1 kHz tone that runs silently the whole time and is opened, while the
     speech stage is closed, for exactly the span of each swear word. Driven
     by the playhead every frame, so it lands in the preview and the export
     alike. Built separately so a failure here can never take the footage's
     sound down with it. */
  let speechGain = null, beepGain = null, bleepOn = false;
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
      g.connect(audioCtx.destination);
      g.connect(audioDest);
      osc.start();
      beepGain = g;
    } catch (e) { beepGain = null; }
  }

  function bleepSpansNow() {
    const C = global_VevrisCaptions();
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
      musicGain.connect(audioCtx.destination);   // speakers
      musicGain.connect(audioDest);              // the exported file
      musicRouted = true;
      applyMusicGain();
    } catch (e) {
      musicRouteFailed = true;
      if (window.VevrisDiag) window.VevrisDiag.last.music = "not routed into the export: " + ((e && e.message) || e);
    }
  }

  /* Loudness is set in exactly one place, and which place depends on the
     routing. Once the element feeds the graph, its own .volume is left at 1
     and the gain node does the work, because browsers disagree about whether
     an element's volume still applies after it has been tapped. */
  function applyMusicGain() {
    if (!musicEl) return;
    const g = S.music ? clamp(typeof S.music.gain === "number" ? S.music.gain : 0.35, 0, 1) : 0;
    if (musicRouted && musicGain) {
      musicEl.muted = false;
      musicEl.volume = 1;
      musicGain.gain.value = S.userMuted ? 0 : g;
    } else {
      musicEl.volume = g;
      musicEl.muted = !!S.userMuted;
    }
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
  }

  /* Kept locked to the playhead the same way the video is: sampled every
     frame, corrected only when it has genuinely drifted, because seeking an
     audio element on every frame makes it stutter. The bed loops, so the
     position is the playhead modulo the track length. */
  function syncMusic() {
    if (!musicEl || !S.music || !musicEl.getAttribute("src")) return;
    const dur = musicEl.duration || S.music.duration || 0;
    if (!dur || !isFinite(dur)) return;
    const want = S.time % dur;
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

  $("exportBtn").addEventListener("click", () => {
    if (generating) { toast("Your edit is still finishing. Export when it's ready."); return; }
    if (EXP.active || EXP.starting) { toast("An export is already running"); return; }
    if (!S.clips.length) { toast("The timeline is empty. Add clips or generate an edit first"); return; }
    if (typeof MediaRecorder === "undefined") { toast("This browser can't record video. Try Chrome or Edge"); return; }
    const picked = pickMime();
    if (!picked) { toast("This browser can't record video. Try Chrome or Edge"); return; }
    startExport(picked);
  });

  /* The caption font has to be on the device before the first frame is
     drawn, or the opening captions export in the fallback font. Four
     seconds at most: a slow font must not hold the whole export hostage. */
  function captionFontReady() {
    const T = CapT(), C = global_VevrisCaptions(), st = capStyle();
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
    if (window.VevrisNotices) VevrisNotices.dismiss("doneCard");
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
    await soundsReady();
    await primeFirstFrame();
    if (run !== EXP.run) return;

    let stream;
    try {
      stream = EXP.canvas.captureStream(0);
      EXP.track = stream.getVideoTracks()[0];
      if (!EXP.track || typeof EXP.track.requestFrame !== "function") {
        stream.getTracks().forEach((track) => track.stop());
        stream = EXP.canvas.captureStream(30);
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
    if (window.VevrisDiag) window.VevrisDiag.last.exportAudio = audioOk ? "captured" : "no audio track";

    try {
      EXP.rec = new MediaRecorder(stream, {
        mimeType: picked.mime,
        videoBitsPerSecond: 8000000,
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

    if (window.VevrisRenderClock) {
      await VevrisRenderClock.start(exportTick, () => {
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

  function drawExportFrame() {
    const ctx = EXP.ctx, W = EXP.canvas.width, H = EXP.canvas.height;
    ctx.filter = "none";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);

    const info = clipAt(Math.min(S.time, Math.max(total() - 0.001, 0)));
    if (info) {
      const m = mediaById(info.clip.mediaId);
      const isVid = m && m.type === "video";
      const elm = isVid ? pv : pi;
      const vw = isVid ? pv.videoWidth : pi.naturalWidth;
      const vh = isVid ? pv.videoHeight : pi.naturalHeight;
      if (vw && vh) {
        // ALWAYS fill the frame. This used to letterbox for anything that
        // wasn't a Short, which is what produced a picture floating in black.
        // Now the frame already follows the footage (exportSize), so filling
        // crops nothing in the normal case and only trims a genuinely
        // mismatched cutaway — which beats black bars either way.
        const sc = Math.max(W / vw, H / vh);
        const dw = vw * sc, dh = vh * sc;
        let dx = (W - dw) / 2, dy = (H - dh) / 2;
        if (dw > W + 1) {
          // smart crop: keep the frame centered on where the motion lives
          const mcx = (m && m.analysis && m.analysis.vis && m.analysis.vis.avgMcx) || 0.5;
          dx = clamp(W / 2 - mcx * dw, W - dw, 0);
        }
        ctx.filter = FILTERS[info.clip.filter].css;
        const k = info.clip.kb;
        try {
          if (k) {
            const p = clamp(info.offset / Math.max(dispDur(info.clip), 0.01), 0, 1);
            const zs = k.s0 + (k.s1 - k.s0) * p;
            const tx = (k.x0 + (k.x1 - k.x0) * p) * dw;
            const ty = (k.y0 + (k.y1 - k.y0) * p) * dh;
            ctx.save();
            ctx.translate(W / 2 + tx, H / 2 + ty);
            ctx.scale(zs, zs);
            ctx.translate(-W / 2, -H / 2);
            ctx.drawImage(elm, dx, dy, dw, dh);
            ctx.restore();
          } else {
            ctx.drawImage(elm, dx, dy, dw, dh);
          }
        } catch (e) {}
        ctx.filter = "none";
      }
    }

    /* B-roll on top of the footage, under the text — the same layering the
       preview uses, driven by the same rects, so the two cannot disagree. */
    const bb = brollAt(S.time);
    if (bb) {
      const bm = mediaById(bb.mediaId);
      const bel = bm && bm.type === "video" ? pvB : piB;
      const bw = bm && bm.type === "video" ? pvB.videoWidth : piB.naturalWidth;
      const bh = bm && bm.type === "video" ? pvB.videoHeight : piB.naturalHeight;
      if (bm && bw && bh) {
        const r = brollRect(bb, { x: 0, y: 0, w: W, h: H });
        const sc = Math.max(r.w / bw, r.h / bh);      // cover the rect, crop the rest
        const dw = bw * sc, dh = bh * sc;
        /* Re-crop toward the subject, not the geometric centre. A wide GIF
           squeezed into a square loses a third of its width, and centre-cropping
           can slice the face out of a reaction — which is the whole point of the
           clip. avgMcx is where brain.js measured the motion to be, so the crop
           follows it, exactly as the main footage does. Recomputed from the rect
           each frame, so changing the export aspect re-frames automatically. */
        const mcx = (bm.analysis && bm.analysis.vis && bm.analysis.vis.avgMcx) || 0.5;
        const dx = dw > r.w + 1 ? clamp(r.w / 2 - mcx * dw, r.w - dw, 0) : (r.w - dw) / 2;
        try {
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w, r.h);
          ctx.clip();
          ctx.drawImage(bel, r.x + dx, r.y + (r.h - dh) / 2, dw, dh);
          ctx.restore();
        } catch (e) { /* frame not ready — skip, never break the export */ }
      }
    }

    const fa = fadeAlpha(info);
    if (fa > 0) {
      ctx.fillStyle = "rgba(0,0,0," + fa + ")";
      ctx.fillRect(0, 0, W, H);
    }

    const karaoke = S.captions && S.captions.length > 0;
    S.texts.forEach((t) => {
      if (karaoke && t.cap) return; // karaoke owns captions — no doubling on export
      if (S.time >= t.start && S.time <= t.start + t.dur) {
        // same headingLayout() the preview uses, so the two cannot disagree
        const L = headingLayout(t, W, H);
        ctx.font = "400 " + L.size + "px " + HEADING_FONT;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = t.color;
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = L.size * 0.22;   // scales with the text, was a fixed 16px
        // Wrap at the same width the DOM box uses and centre the whole block on
        // cy, so a two-line heading sits where the preview showed it. No
        // maxWidth argument here — that condenses glyphs rather than wrapping.
        const lines = wrapHeading(ctx, t.text, L.maxW);
        let ly = L.cy - ((lines.length - 1) * L.lineH) / 2;
        lines.forEach((line) => { ctx.fillText(line, L.cx, ly); ly += L.lineH; });
        ctx.shadowBlur = 0;
        ctx.textBaseline = "alphabetic";  // captions.js draws next — leave it as found
      }
    });

    // Word-timed captions last, so they sit above every other overlay.
    if (S.captions && S.captions.length && global_VevrisCaptions()) {
      global_VevrisCaptions().drawCaptions(ctx, S.captions, S.time, capDrawOpts(null));
    }

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
      if (VevrisPlatform.linksDownload() || !latestExport) return;
      e.preventDefault();
      // the click made by the app itself at the end of an export has no tap behind it
      if (!e.isTrusted) return;
      VevrisPlatform.save(latestExport.blob, latestExport.name).catch((err) => toast((err && err.message) || "Couldn't save the video. Try again"));
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
    if (!blob.size) { toast("Export produced no data. Try again"); return; }
    // Strip characters Windows/macOS reject in filenames — a project called
    // "Trip 3/4: Rome?" produced a download the OS silently refused to save.
    // A project name goes straight into a filename, so keep only characters an
    // OS will actually accept: "Trip 3/4: Rome?" produced a download Windows
    // silently refused. A whitelist (rather than banning \ / : * ? " < > |)
    // also drops control characters for free, while \p{L}\p{N} keeps accented
    // and non-Latin names intact instead of mangling them to hyphens.
    const safeName = ($("projectName").value.trim() || "vclyps-export")
      .replace(/[^\p{L}\p{N} ()._,'&+-]+/gu, "-")
      .replace(/\s+/g, " ")
      .replace(/^[.\s-]+|[.\s-]+$/g, "")
      .slice(0, 80) || "vclyps-export";
    const fileName = safeName + "." + EXP.ext;
    offerExport(blob, fileName);
    // Hidden-tab downloads may be blocked. Keep a real Save action and retain
    // the latest file locally so notification clicks can recover it after reload.
    idbPut("last-export", { blob, name: fileName }).catch(() => {});
    if (!document.hidden) $("doneDownload").click();
    notifyDone("Your video is ready", fileName + " is ready to save. You can also find it in Settings.", "export");
    // an export means the user approved this edit — gold-standard training data
    if (window.IntelligenceEngine) {
      IntelligenceEngine.record({
        kind: "export-approved", format: S.format, vertical: S.vertical,
        clips: S.clips, texts: S.texts,
        // what was kept, moved or added by hand is how the model learns sound
        sfx: S.sfx, music: S.music, audio: S.audio
      });
    }
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

  /* ═══════════ ADMIN ═══════════

     Typing /clypsadmin anywhere opens the panel. The passphrase is a SOFT gate
     and is described as one in the panel itself: everything it shows lives in
     this browser's own localStorage, so it already belongs to whoever is
     sitting there. It stops the panel being stumbled into by a curious user;
     it does not protect a secret, and a constant in a public script never
     could. Say so rather than implying otherwise.

     Change the passphrase here. */
  const ADMIN_PASS = "vevris";
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
    $("adminClear").addEventListener("click", () => {
      if (!window.IntelligenceEngine) return;
      IntelligenceEngine.clearDataset();
      renderAdmin();
      toast("Training data cleared");
    });
  })();

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

  function refreshSettings() {
    const V = window.VevrisVersion;
    // Version only. The build number still travels with every diagnostics dump
    // and prints to the console on load, so support can still identify an exact
    // build — it just doesn't clutter the panel.
    if (V) $("aboutVersion").textContent = "Version " + V.version;
    const n = window.IntelligenceEngine ? IntelligenceEngine.datasetCount() : 0;
    $("dsCount").textContent = n + (n === 1 ? " example" : " examples");
  }
  $("settingsBtn").addEventListener("click", () => {
    refreshSettings();
    go(() => showScreen("settings"));
  });
  $("dsExport").addEventListener("click", () => { if (window.IntelligenceEngine) IntelligenceEngine.exportDataset().catch((e) => toast(e.message)); });
  $("dsClear").addEventListener("click", () => {
    if (window.IntelligenceEngine) { IntelligenceEngine.clearDataset(); refreshSettings(); toast("Training data cleared"); }
  });

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
      if (new URLSearchParams(location.search).get("result") === "ready" && window.VevrisNotices) {
        VevrisNotices.show("doneCard", "Your saved video", saved.name + " is ready to save.", 12000);
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
      const C = global_VevrisCaptions();
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
        by: window.VevrisVersion ? window.VevrisVersion.stamp() : null,
        name: $("projectName").value,
        format: S.format, mode: S.mode, vertical: S.vertical, nextId: nextId,
        media: S.media.map((m) => ({ id: m.id, name: m.name, type: m.type, duration: m.duration, w: m.w, h: m.h,
          fromVideo: !!m.fromVideo, soundSaved: !!m.soundSaved,
          // the transcript, so captions can be restyled after a reload without listening again
          cap: m.capWords ? { words: m.capWords, lang: m.capLang, key: m.capKey, spk: !!m.capSpk } : null })),
        clips: S.clips, texts: S.texts, captions: S.captions, capOpts: S.capOpts, capLang: S.capLang,
        broll: S.broll, sfx: S.sfx, music: S.music,
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
    // audio clips do: one whose file did not come back is dropped, like a clip
    S.audio = (snap.audio || []).filter((a) => a && have[a.mediaId]);
    /* The bed is a remote URL, not uploaded footage, so nothing needs
       fetching back out of IndexedDB: it simply reloads from the CDN. */
    S.music = snap.music && snap.music.url ? snap.music : null;
    loadMusicElement();
    S.format = "auto";
    S.mode = snap.mode || "entertainment";
    S.vertical = !!snap.vertical;
    if (snap.find && typeof snap.find === "object") S.find = Object.assign({ on: false, len: "auto", from: "", to: "" }, snap.find);
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
})();
