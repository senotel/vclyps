/* ═══════════════════════════════════════════════════════════
   vClyps — import sources
   Everything that brings a file into the project from somewhere other
   than the device's own file picker. Each source ends the same way: a
   real File in this browser, handed to app.js, which treats it exactly
   like a file picked from the device. Nothing is kept anywhere else.

     · Google Photos Google's Photos Picker; the person chooses inside
                     Google Photos, vClyps sees only what they chose
     · Google Drive  Google's own Picker, signed in with Google, asking
                     only for the files the person chooses (drive.file)
     · Dropbox       Dropbox's own Chooser; no vClyps sign-in at all
     · Zoom          the person's cloud recordings
     · Vimeo         the person's uploaded videos

   Drive and Dropbox download straight from Google and Dropbox. Google
   Photos, Zoom and Vimeo pass through the vClyps worker on the way (see
   worker.js): Google Photos refuses browsers, and Zoom and Vimeo sign-in
   needs a secret that can only live on a server. Never stored there.
   There is no pasted-link source any more (removed 0.23.1): the links
   people have are from platforms that don't allow downloading.

   SETUP: the four values below are filled in once by the owner (see
   HANDOFF.md, "Import sources"). They are PUBLIC identifiers, made for
   browser code, not secrets: Google's key is locked to vClyps' own sites
   and Dropbox's to its domains. A source whose value is empty is simply
   not offered. Zoom and Vimeo are set up on the worker instead.
   Exposes window.VevrisSources.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  const GOOGLE_CLIENT_ID = "";   // OAuth client ID, type "Web application"
  const GOOGLE_API_KEY = "";     // API key restricted to the Picker API + this site
  const GOOGLE_APP_ID = "";      // the Cloud project NUMBER (digits only)
  const DROPBOX_APP_KEY = "";    // Dropbox app key, with vClyps' domains listed
  // true once the Photos Picker API is turned on in the same Google project
  // (HANDOFF.md, "Google Photos"); it uses GOOGLE_CLIENT_ID above
  const GOOGLE_PHOTOS = false;

  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const PHOTOS_SCOPE = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

  class Cancelled extends Error {}

  function proxy() {
    const E = global.IntelligenceEngine;
    return ((E && E.proxy && E.proxy()) || "").replace(/\/+$/, "");
  }

  /* ═══════════ loading the providers' own scripts, only when asked ═══════════ */

  const scripts = new Map();
  function loadScript(src, attrs) {
    if (scripts.has(src)) return scripts.get(src);
    const p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      Object.keys(attrs || {}).forEach((k) => s.setAttribute(k, attrs[k]));
      s.onload = () => resolve();
      s.onerror = () => { scripts.delete(src); reject(new Error("Couldn't load " + new URL(src).hostname + ". Check your connection.")); };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
    return p;
  }

  /* ═══════════ downloading, with progress, without filling memory ═══════════ */

  const TYPES = {
    mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
    mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg",
    flac: "audio/flac", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif"
  };
  function typeFor(name, given) {
    const t = String(given || "").split(";")[0].trim().toLowerCase();
    if (/^(video|audio|image)\//.test(t)) return t;
    const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1];
    return (ext && TYPES[ext.toLowerCase()]) || t || "";
  }

  function nameFromUrl(u) {
    try {
      const last = new URL(u).pathname.split("/").filter(Boolean).pop() || "";
      return decodeURIComponent(last) || "linked-file";
    } catch (e) { return "linked-file"; }
  }

  /* The body is read as it arrives and gathered into blobs of 32 MB. A blob
     is handed to the browser's own storage, which moves large ones to disk,
     so an hour of video does not have to sit in this tab's memory twice. */
  async function download(url, opts) {
    opts = opts || {};
    let res;
    try { res = await fetch(url, { headers: opts.headers || {}, signal: opts.signal }); }
    catch (e) {
      if (opts.signal && opts.signal.aborted) throw new Cancelled("Stopped");
      const err = new Error("network");
      err.network = true;
      throw err;
    }
    if (!res.ok) {
      let msg = "";
      try { const j = await res.json(); msg = (j && j.error && (j.error.message || j.error)) || ""; } catch (e) {}
      const err = new Error(typeof msg === "string" && msg ? msg : "The download failed (" + res.status + ").");
      err.status = res.status;
      throw err;
    }
    const total = +res.headers.get("X-File-Size") || +res.headers.get("Content-Length") || opts.size || 0;
    let name = opts.name || "";
    const named = res.headers.get("X-File-Name");
    if (!name && named) { try { name = decodeURIComponent(named); } catch (e) { name = named; } }
    if (!name) name = nameFromUrl(url);
    const type = typeFor(name, opts.type || res.headers.get("Content-Type"));
    const parts = [];
    let batch = [], batchBytes = 0, got = 0;
    if (!res.body || !res.body.getReader) {
      const b = await res.blob();
      parts.push(b);
      got = b.size;
    } else {
      const reader = res.body.getReader();
      for (;;) {
        let step;
        try { step = await reader.read(); }
        catch (e) {
          if (opts.signal && opts.signal.aborted) throw new Cancelled("Stopped");
          throw new Error("The download was interrupted. Try again.");
        }
        if (step.done) break;
        batch.push(step.value);
        batchBytes += step.value.length;
        got += step.value.length;
        if (batchBytes >= 32 * 1024 * 1024) { parts.push(new Blob(batch)); batch = []; batchBytes = 0; }
        if (opts.onProgress) opts.onProgress(got, total, name);
      }
      if (batch.length) parts.push(new Blob(batch));
    }
    return new File(parts, name, { type: type });
  }

  /* ═══════════ Google Drive ═══════════ */

  const driveReady = () => !!(GOOGLE_CLIENT_ID && GOOGLE_API_KEY && GOOGLE_APP_ID);
  let driveToken = null, driveTokenAt = 0, tokenClient = null;

  /* Loaded the moment the Add sheet opens, so that pressing Google Drive can
     open Google's sign-in window straight away. Browsers only allow a pop-up
     during the click itself; waiting for a script first gets it blocked. */
  function warmDrive() {
    if (!driveReady()) return Promise.resolve(false);
    return Promise.all([
      loadScript("https://apis.google.com/js/api.js"),
      loadScript("https://accounts.google.com/gsi/client")
    ]).then(() => new Promise((resolve) => global.gapi.load("picker", resolve)))
      .then(() => {
        if (!tokenClient) {
          tokenClient = global.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: DRIVE_SCOPE, callback: () => {} });
        }
        return true;
      });
  }

  // Must be called from the click. Resolves with the files picked, as Files.
  function fromDrive(opts) {
    opts = opts || {};
    if (!driveReady()) return Promise.reject(new Error("Google Drive isn't set up yet."));
    if (!tokenClient || !global.google || !global.google.picker) {
      warmDrive();
      return Promise.reject(new Error("Google Drive is still loading. Try again in a moment."));
    }
    const G = global.google;
    const signIn = new Promise((resolve, reject) => {
      // a token is good for an hour; ask again a little before that
      if (driveToken && Date.now() - driveTokenAt < 50 * 60 * 1000) { resolve(driveToken); return; }
      tokenClient.callback = (r) => {
        if (r && r.access_token) { driveToken = r.access_token; driveTokenAt = Date.now(); resolve(driveToken); }
        else reject(new Cancelled("Stopped"));
      };
      tokenClient.error_callback = () => reject(new Cancelled("Stopped"));
      tokenClient.requestAccessToken({ prompt: driveToken ? "" : "consent" });
    });
    return signIn.then((token) => new Promise((resolve, reject) => {
      const view = new G.picker.DocsView(G.picker.ViewId.DOCS)
        .setMimeTypes([
          "video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-m4v",
          "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/ogg", "audio/flac",
          "image/jpeg", "image/png", "image/webp", "image/gif"
        ].join(","))
        .setIncludeFolders(true);
      const picker = new G.picker.PickerBuilder()
        .addView(view)
        .enableFeature(G.picker.Feature.MULTISELECT_ENABLED)
        .setOAuthToken(token)
        .setDeveloperKey(GOOGLE_API_KEY)
        .setAppId(GOOGLE_APP_ID)
        .setTitle("Add from Google Drive")
        .setCallback((data) => {
          const action = data[G.picker.Response.ACTION];
          if (action === G.picker.Action.CANCEL) { reject(new Cancelled("Stopped")); return; }
          if (action !== G.picker.Action.PICKED) return;
          resolve((data[G.picker.Response.DOCUMENTS] || []).map((d) => ({
            id: d[G.picker.Document.ID],
            name: d[G.picker.Document.NAME],
            type: d[G.picker.Document.MIME_TYPE],
            size: +d.sizeBytes || 0
          })));
        })
        .build();
      picker.setVisible(true);
    }).then(async (docs) => {
      const files = [];
      for (const d of docs) {
        files.push(await download("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(d.id) + "?alt=media", {
          headers: { Authorization: "Bearer " + token }, name: d.name, type: d.type, size: d.size,
          onProgress: opts.onProgress, signal: opts.signal
        }));
      }
      return files;
    }));
  }

  /* ═══════════ Google Photos ═══════════
     Google's Photos Picker: the person chooses in Google Photos itself (on a
     phone it opens the Google Photos app), and vClyps only ever sees what
     they chose. Two steps, because a browser allows one pop-up per tap:
     the first tap signs in with Google, the next opens Google Photos. Google
     does not let a browser download the chosen files itself, so they come
     through the worker, which finds each one by its id in the person's own
     picking session and never stores it. */

  const photosReady = () => !!(GOOGLE_PHOTOS && GOOGLE_CLIENT_ID);
  let photosToken = null, photosTokenAt = 0, photosClient = null;
  const photosLive = () => !!photosToken && Date.now() - photosTokenAt < 50 * 60 * 1000;

  function warmPhotos() {
    if (!photosReady()) return Promise.resolve(false);
    return loadScript("https://accounts.google.com/gsi/client").then(() => {
      if (!photosClient) {
        photosClient = global.google.accounts.oauth2.initTokenClient({ client_id: GOOGLE_CLIENT_ID, scope: PHOTOS_SCOPE, callback: () => {} });
      }
      return true;
    });
  }

  // Step one, from the tap: Google's sign-in window.
  function photosSignIn() {
    if (!photosReady()) return Promise.reject(new Error("Google Photos isn't set up yet."));
    if (photosLive()) return Promise.resolve(photosToken);
    if (!photosClient) {
      warmPhotos();
      return Promise.reject(new Error("Google Photos is still loading. Try again in a moment."));
    }
    return new Promise((resolve, reject) => {
      photosClient.callback = (r) => {
        if (r && r.access_token) { photosToken = r.access_token; photosTokenAt = Date.now(); resolve(photosToken); }
        else reject(new Cancelled("Stopped"));
      };
      photosClient.error_callback = () => reject(new Cancelled("Stopped"));
      photosClient.requestAccessToken({ prompt: photosToken ? "" : "consent" });
    });
  }

  async function photosCall(pathAndQuery, method) {
    let res;
    try {
      res = await fetch(proxy() + pathAndQuery, { method: method || "GET", headers: { Authorization: "Bearer " + photosToken }, cache: "no-store" });
    } catch (e) { throw new Error("Couldn't reach the vClyps server. Check your connection."); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) photosToken = null;
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "Google Photos didn't answer (" + res.status + ").");
    return data;
  }

  const wait = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); reject(new Cancelled("Stopped")); }, { once: true });
  });

  /* Step two, from the next tap: Google Photos opens, the person chooses,
     and the chosen videos and photos come back as Files. The window is
     opened empty inside the tap and pointed at Google Photos once the
     session exists, because a window opened later would be blocked. */
  async function fromGooglePhotos(opts) {
    opts = opts || {};
    if (!photosReady()) throw new Error("Google Photos isn't set up yet.");
    if (!photosLive()) throw new Error("Sign in to Google Photos first.");
    if (!proxy()) throw new Error("The vClyps server isn't configured.");
    const win = global.open("", "vclyps-gphotos");
    if (!win) throw new Error("Your browser blocked the Google Photos window. Allow pop-ups for vClyps and try again.");
    let session;
    try { session = await photosCall("/gphotos/session", "POST"); }
    catch (e) { try { win.close(); } catch (x) {} throw e; }
    if (!/^https:\/\/photos\.google\.com\//.test(session.pickerUri || "")) {
      try { win.close(); } catch (x) {}
      throw new Error("Google Photos didn't open. Try again.");
    }
    win.location.href = session.pickerUri.replace(/\/+$/, "") + "/autoclose";

    // wait for the person to finish choosing, at the pace Google asks for
    let every = Math.max(2, session.pollInterval || 5), until = Date.now() + Math.max(60, session.timeoutIn || 1800) * 1000;
    for (;;) {
      await wait(every * 1000, opts.signal);
      const s = await photosCall("/gphotos/session?id=" + encodeURIComponent(session.id));
      if (s.done) break;
      if (s.pollInterval) every = Math.max(2, s.pollInterval);
      if (Date.now() > until) throw new Error("Google Photos waited too long for a choice. Try again.");
    }
    const listed = await photosCall("/gphotos/items?session=" + encodeURIComponent(session.id));
    const files = [];
    for (const it of listed.items || []) {
      files.push(await download(proxy() + "/gphotos/file?" + new URLSearchParams({ session: session.id, item: it.id }).toString(), {
        headers: { Authorization: "Bearer " + photosToken }, name: it.name, type: it.mime,
        onProgress: opts.onProgress, signal: opts.signal
      }));
    }
    return files;
  }

  /* ═══════════ Dropbox ═══════════ */

  const dropboxReady = () => !!DROPBOX_APP_KEY;

  function warmDropbox() {
    if (!dropboxReady()) return Promise.resolve(false);
    return loadScript("https://www.dropbox.com/static/api/2/dropins.js", { id: "dropboxjs", "data-app-key": DROPBOX_APP_KEY }).then(() => true);
  }

  // Must be called from the click: the Chooser is a pop-up window.
  function fromDropbox(opts) {
    opts = opts || {};
    if (!dropboxReady()) return Promise.reject(new Error("Dropbox isn't set up yet."));
    if (!global.Dropbox || !global.Dropbox.choose) {
      warmDropbox();
      return Promise.reject(new Error("Dropbox is still loading. Try again in a moment."));
    }
    return new Promise((resolve, reject) => {
      global.Dropbox.choose({
        linkType: "direct",           // a link to the file itself, good for four hours
        multiselect: true,
        extensions: ["video", "audio", "images"],
        success: resolve,
        cancel: () => reject(new Cancelled("Stopped"))
      });
    }).then(async (picked) => {
      const files = [];
      for (const f of picked || []) {
        const dl = { name: f.name, size: f.bytes, onProgress: opts.onProgress, signal: opts.signal };
        /* Dropbox documents these links as readable from a browser, but some
           of them redirect on the way and lose that permission. The worker
           then fetches the same link. */
        try { files.push(await download(f.link, dl)); }
        catch (e) {
          if (!e.network || !proxy()) throw e;
          files.push(await download(proxy() + "/link?url=" + encodeURIComponent(f.link), dl));
        }
      }
      return files;
    });
  }

  /* ═══════════ Zoom and Vimeo: sign-in through the worker ═══════════ */

  let serverSources = null;          // {zoom, vimeo} as the worker reports them
  function checkServer() {
    if (serverSources) return Promise.resolve(serverSources);
    if (!proxy()) return Promise.resolve({ zoom: false, vimeo: false });
    return fetch(proxy() + "/oauth/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((d) => {
        serverSources = { zoom: !!(d && d.zoom), vimeo: !!(d && d.vimeo) };
        return serverSources;
      });
  }

  const signedIn = {};               // provider → {token, until}; this tab only, never saved

  function randomId() {
    const a = new Uint8Array(16);
    global.crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* Opens the provider's sign-in in a window and waits for the worker's
     answer. Must be called from the click. The answer comes back one of two
     ways (see resultPage in worker.js): a message from the window itself, or,
     when the sign-in page cut that link, from oauth.html over a
     BroadcastChannel. The nonce ties the answer to this request.

     The window being "closed" is NOT read as a cancel. A sign-in page that
     cuts the link back to us also makes the window look closed from here
     while the person is still typing their password, so guessing from that
     would cancel real sign-ins. The person cancels with the sheet's Cancel
     (opts.signal), and an abandoned one gives up after ten minutes. */
  function connect(provider, opts) {
    opts = opts || {};
    const live = signedIn[provider];
    if (live && Date.now() < live.until) return Promise.resolve(live.token);
    if (!proxy()) return Promise.reject(new Error("The vClyps server isn't configured."));
    const nonce = randomId();
    const back = new URL(".", global.location.href).href + "index.html";
    const win = global.open(proxy() + "/oauth/start?" + new URLSearchParams({
      provider: provider, origin: global.location.origin, back: back, nonce: nonce
    }).toString(), "vclyps-" + provider, "width=520,height=720");
    if (!win) return Promise.reject(new Error("Your browser blocked the sign-in window. Allow pop-ups for vClyps and try again."));
    const workerOrigin = new URL(proxy()).origin;
    return new Promise((resolve, reject) => {
      let done = false, channel = null, giveUp = null;
      const stop = () => {
        done = true;
        global.removeEventListener("message", onMessage);
        if (channel) channel.close();
        clearTimeout(giveUp);
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
      };
      const finish = (d) => {
        if (done || !d || d.type !== "vclyps-oauth" || d.nonce !== nonce) return;
        stop();
        if (d.error) { reject(new Error(d.error)); return; }
        signedIn[provider] = { token: d.token, until: Date.now() + Math.max(300, (d.expiresIn || 3600) - 120) * 1000 };
        resolve(d.token);
      };
      const onMessage = (e) => { if (e.origin === workerOrigin) finish(e.data); };
      const onAbort = () => { if (done) return; stop(); try { win.close(); } catch (e) {} reject(new Cancelled("Stopped")); };
      global.addEventListener("message", onMessage);
      try {
        channel = new BroadcastChannel("vclyps-oauth");
        channel.onmessage = (e) => finish(e.data);
      } catch (e) {}
      if (opts.signal) opts.signal.addEventListener("abort", onAbort);
      giveUp = setTimeout(() => { if (done) return; stop(); reject(new Error("The sign-in took too long. Try again.")); }, 10 * 60 * 1000);
    });
  }

  async function serverJson(path, provider) {
    const live = signedIn[provider];
    if (!live) throw new Error("Sign in first.");
    let res;
    try { res = await fetch(proxy() + path, { headers: { Authorization: "Bearer " + live.token }, cache: "no-store" }); }
    catch (e) { throw new Error("Couldn't reach the vClyps server. Check your connection."); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) delete signedIn[provider];
    if (!res.ok) throw new Error((data && data.error && data.error.message) || "That didn't work (" + res.status + ").");
    return data;
  }

  // A day as YYYY-MM-DD, n days from today (UTC, as Zoom counts them).
  function day(n) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /* The recording to import from a Zoom meeting: the view with the speaker
     in it first, then any video, then the audio alone. */
  const ZOOM_ORDER = ["shared_screen_with_speaker_view", "speaker_view", "active_speaker",
    "shared_screen_with_gallery_view", "gallery_view", "shared_screen"];
  function zoomPick(files) {
    const video = (files || []).filter((f) => f.type === "MP4")
      .sort((a, b) => {
        const ia = ZOOM_ORDER.indexOf(a.kind), ib = ZOOM_ORDER.indexOf(b.kind);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    return video[0] || (files || []).find((f) => f.type === "M4A") || null;
  }

  const zoom = {
    // monthsBack 0 = the last 30 days, 1 = the 30 before that, and so on
    list: (monthsBack) => {
      const n = Math.max(0, monthsBack || 0);
      return serverJson("/zoom/recordings?from=" + day(-30 * (n + 1)) + "&to=" + day(-30 * n), "zoom");
    },
    pick: zoomPick,
    file: (meeting, file, opts) => download(proxy() + "/zoom/file?" + new URLSearchParams({
      meeting: meeting.uuid, file: file.id, day: String(meeting.start || "").slice(0, 10)
    }).toString(), {
      headers: { Authorization: "Bearer " + ((signedIn.zoom || {}).token || "") },
      size: file.size, onProgress: opts && opts.onProgress, signal: opts && opts.signal
    })
  };

  const vimeo = {
    list: (page) => serverJson("/vimeo/videos?page=" + Math.max(1, page || 1), "vimeo"),
    file: (video, opts) => download(proxy() + "/vimeo/file?video=" + encodeURIComponent(video.id), {
      headers: { Authorization: "Bearer " + ((signedIn.vimeo || {}).token || "") },
      size: video.file && video.file.size, onProgress: opts && opts.onProgress, signal: opts && opts.signal
    })
  };

  /* What to offer right now, for the Add sheet. Every source here finishes
     in a sign-in or chooser window, which an app's view of the page can't
     do (Google refuses sign-in there outright), so inside one they are not
     offered at all rather than offered and broken. See platform.js. */
  function available() {
    const P = global.VevrisPlatform;
    if (P && !P.signInsWork()) return Promise.resolve({ drive: false, dropbox: false, gphotos: false, zoom: false, vimeo: false });
    return checkServer().then((srv) => ({
      drive: driveReady(), dropbox: dropboxReady(),
      gphotos: photosReady() && !!proxy(),
      zoom: !!srv.zoom, vimeo: !!srv.vimeo
    }));
  }

  // Called as the Add sheet opens, so the pop-up sources are ready for the click.
  function warm() {
    if (global.VevrisPlatform && !global.VevrisPlatform.signInsWork()) return;
    warmPhotos().catch(() => {});
    warmDrive().catch(() => {});
    warmDropbox().catch(() => {});
    checkServer();
  }

  global.VevrisSources = {
    available: available,
    warm: warm,
    fromDrive: fromDrive,
    fromDropbox: fromDropbox,
    photos: { signedIn: photosLive, signIn: photosSignIn },
    fromGooglePhotos: fromGooglePhotos,
    connect: connect,
    zoom: zoom,
    vimeo: vimeo,
    isSignedIn: (p) => !!(signedIn[p] && Date.now() < signedIn[p].until),
    Cancelled: Cancelled,
    // exported for the tests
    _download: download,
    _typeFor: typeFor,
    _zoomPick: zoomPick
  };
})(window);
