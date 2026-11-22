/* ═══════════════════════════════════════════════════════════
   next/flow.js: the AI-first flow (0.83.0, owner 2026-11-18)

   Start  ->  New edit (+)  ->  Templates (or Auto clip)  ->  the agent
   workspace: a Claude-style thread that only edits video. A drop box for
   footage, the effort menu (Low ... Max, Standard recommended, a Fast
   switch), a Token estimate before Edit, live steps while it works, the
   result as a playable card, follow-up instructions. "Fine-tune" opens the
   CapCut timeline on the same project; "Manual edit" on the start screen is
   the free way in without an account.

   It drives the existing app through window.vcFlow (app.js), so the
   Director, the editor and the export are the same ones the live site uses.
   Accounts, plans and Tokens: next/account.js (window.vcAccount).
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* The six levels, as the owner set them (2026-11-18). Token ranges are
     the estimates of NO UPLOAD/ai-first-plan.md section 4 for about a
     minute of footage; longer footage scales them. */
  const LEVELS = [
    { id: "low", name: "Low", about: "Quick and simple", tokens: [3, 6] },
    { id: "light", name: "Light", about: "Cleaner cuts", tokens: [6, 12] },
    { id: "standard", name: "Standard", about: "Best for most videos", tokens: [40, 70], rec: true },
    { id: "thorough", name: "Thorough", about: "Tries two versions", tokens: [100, 180] },
    { id: "deep", name: "Deep", about: "Extra checks", tokens: [250, 450] },
    { id: "max", name: "Max", about: "Everything it has", tokens: [600, 1200] }
  ];
  const FAST_X = 1.6;
  const WALL = ["bike", "cook", "cupcake", "dance", "fest", "guitar", "hike", "hoop", "latte", "laugh", "paint", "picnic", "puppy", "skate", "surf"];
  const CATS = [
    { id: "all", name: "All" },
    { id: "entertainment", name: "Social" },
    { id: "business", name: "Business" },
    { id: "trailer", name: "Trailer" },
    { id: "education", name: "Explainers" },
    { id: "gaming", name: "Gaming" },
    { id: "sports", name: "Sports" },
    { id: "podcast", name: "Podcast" },
    { id: "vlog", name: "Vlog" }
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = { get(k, d) { try { const v = localStorage.getItem("vc-flow-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("vc-flow-" + k, JSON.stringify(v)); } catch (e) {} } };
  const I = {
    plus: '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    timeline: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="4" rx="1"/><rect x="3" y="11" width="11" height="4" rx="1"/><rect x="3" y="17" width="15" height="2.5" rx="1"/></svg>',
    auto: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/><path d="M3 9h3M3 15h3M18 9h3M18 15h3"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg>',
    film: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M13 3L5 14h6l-1 7 8-11h-6z"/></svg>'
  };
  const SPIN = '<span class="ldr-line-spinner" aria-hidden="true">' + "<i></i>".repeat(12) + "</span>";

  /* ── templates: the 191 structures, shown as picture cards ── */
  function templates() {
    const X = window.SenotelStructures;
    const list = X && X.list ? X.list() : [];
    return list.map((s, i) => {
      const modes = s.modes || [], kinds = s.kinds || [];
      // the most specific first: a genre (podcast, gaming...), then the mode (trailer, business), else Social
      const cat = CATS.find((c) => c.id !== "all" && kinds.includes(c.id)) || CATS.find((c) => c.id !== "all" && c.id !== "entertainment" && modes.includes(c.id)) || CATS[1];
      const pic = WALL[hash(s.id) % WALL.length];
      const len = Array.isArray(s.len) ? s.len.join("-") + " s" : (s.len ? s.len + " s" : "");
      return { id: s.id, name: s.name, when: String(s.when || "").replace(/[.s]+$/, ""), cat: cat.id, catName: cat.name, beats: (s.beats || []).map((b) => b.role), len, pic, mode: modes[0] || "entertainment" };
    });
  }
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

  /* ── state ── */
  // the onboarding answers (next/auth.js) set the starting level and template category
  const OB = (() => { try { return (JSON.parse(localStorage.getItem("vc-onboard")) || {}).setup || {}; } catch (e) { return {}; } })();
  const F = { screen: null, template: null, level: store.get("level", OB.level || "standard"), fast: store.get("fast", false), busy: false, cat: OB.cat || "all", q: "" };

  /* ── screens ── */
  function build() {
    const root = document.createElement("div");
    root.id = "flowRoot";
    root.innerHTML = `
      <section class="flow-screen" id="flowStart" aria-labelledby="flowStartTitle">
        <header class="flow-head"><button class="flow-brand" type="button" data-home aria-label="Ethlenos home"><svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="2" width="18" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-in" x="3" y="9.8" width="5" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-cut" x="9.5" y="9.8" width="7.5" height="4.4" rx="1.4" fill="#dc143c"/><rect x="3" y="17.6" width="18" height="4.4" rx="1.4" fill="currentColor"/></svg><span class="brand-word">ethlenos</span></button><span class="flow-head-gap"></span>
          <button class="flow-nav" type="button" data-history>History</button>
          <button class="flow-preview" type="button" data-status>Preview</button>
          <button class="flow-icon" type="button" data-theme-flow aria-label="Switch theme" title="Theme"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg></button>
          <button class="flow-nav" type="button" data-plans></button>
          <button class="flow-nav" type="button" data-account></button></header>
        <div class="flow-start">
          <div class="flow-start-copy">
            <p class="flow-eyebrow">New project</p>
            <h1 class="flow-title" id="flowStartTitle">What are we making?</h1>
            <div class="flow-actions">
              <button class="flow-btn" type="button" id="flowNew">New edit</button>
              <button class="flow-btn flow-btn-ghost" type="button" id="flowManual">Manual edit</button>
            </div>
            <p class="flow-small-print"><button class="flow-textlink hidden" type="button" id="flowResume">Continue your last project</button></p>
            <div class="flow-recent" id="flowRecent"></div>
          </div>
          <button class="flow-start-wall" type="button" data-to="library" aria-label="Browse templates">
            <img src="site/wall/cook.webp" alt="" loading="lazy"><img src="site/wall/skate.webp" alt="" loading="lazy"><img src="site/wall/laugh.webp" alt="" loading="lazy">
          </button>
        </div>
      </section>

      <section class="flow-screen" id="flowLibrary" aria-labelledby="flowLibTitle">
        <header class="flow-head"><button class="flow-icon" type="button" data-to="start" aria-label="Back">${I.back}</button><button class="flow-brand" type="button" data-home aria-label="Ethlenos home"><svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="2" width="18" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-in" x="3" y="9.8" width="5" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-cut" x="9.5" y="9.8" width="7.5" height="4.4" rx="1.4" fill="#dc143c"/><rect x="3" y="17.6" width="18" height="4.4" rx="1.4" fill="currentColor"/></svg><span class="brand-word">ethlenos</span></button><span class="flow-head-gap"></span>
          <button class="flow-nav" type="button" data-history>History</button>
          <button class="flow-preview" type="button" data-status>Preview</button>
          <button class="flow-icon" type="button" data-theme-flow aria-label="Switch theme" title="Theme"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg></button>
          <button class="flow-nav" type="button" data-plans></button>
          <button class="flow-nav" type="button" data-account></button></header>
        <div class="flow-lib">
          <p class="flow-eyebrow">Templates</p>
          <h1 class="flow-h1" id="flowLibTitle">Pick a template</h1>
          <div class="flow-auto">
            <div><p class="flow-auto-text">Auto clip</p></div>
            <button class="flow-btn" type="button" id="flowAuto">Start</button>
          </div>
          <label class="flow-search">${I.search}<input id="flowSearch" type="search" placeholder="Search templates" autocomplete="off" aria-label="Search templates"></label>
          <div class="flow-cats" id="flowCats" role="tablist" aria-label="Template categories"></div>
          <div class="flow-grid" id="flowGrid"></div>
        </div>
      </section>

      <section class="flow-screen" id="flowAgent" aria-labelledby="flowAgentTitle">
        <header class="flow-head">
          <button class="flow-icon" type="button" data-to="library" aria-label="Back to templates">${I.back}</button>
          <h1 class="flow-head-title" id="flowAgentTitle">Auto clip</h1>
          <span class="flow-head-gap"></span>
          <button class="flow-nav" type="button" data-history>History</button>
          <button class="flow-preview" type="button" data-status>Preview</button>
          <button class="flow-nav" type="button" data-plans></button>
          <button class="flow-btn flow-btn-ghost flow-btn-sm" type="button" id="flowFine" title="Open the timeline and edit by hand">Fine-tune</button>
        </header>
        <div class="flow-thread" id="flowThread" aria-live="polite"></div>
        <form class="flow-composer" id="flowComposer" autocomplete="off">
          <div class="flow-clips" id="flowClips"></div>
          <textarea id="flowPrompt" rows="1" aria-label="What should it make?" placeholder="Describe your video"></textarea>
          <div class="flow-bar">
            <button class="flow-add" type="button" id="flowAdd" aria-label="Add videos">${I.plus}<span>Videos</span></button>
            <span class="flow-head-gap"></span>
            <span class="flow-est" id="flowEst"></span>
            <div class="flow-effort-wrap">
              <button class="flow-effort" type="button" id="flowEffort" aria-haspopup="listbox" aria-expanded="false"></button>
              <div class="flow-menu hidden" id="flowMenu" role="listbox" aria-label="Effort"></div>
            </div>
            <button class="flow-send" type="submit" id="flowSend" aria-label="Edit">${I.send}</button>
          </div>
          <input type="file" id="flowFiles" accept="video/*,image/*,audio/*" multiple hidden>
        </form>
      </section>`;
    const hist = document.createElement("aside");
    hist.className = "flow-hist";
    hist.id = "flowHist";
    hist.hidden = true;
    hist.setAttribute("aria-label", "History");
    hist.innerHTML = `<div class="flow-hist-head"><b>History</b><span class="flow-head-gap"></span><button type="button" class="flow-btn flow-btn-sm" data-newchat>New chat</button><button type="button" class="flow-icon" data-histclose aria-label="Close history">${I.x}</button></div><ul class="flow-hist-list" id="flowHistList"></ul>`;
    root.appendChild(hist);
    document.body.appendChild(root);
    wire();
  }

  function wire() {
    $("flowNew").addEventListener("click", () => show("library"));
    document.querySelectorAll("#flowRoot [data-home]").forEach((b) => b.addEventListener("click", () => { closeHistory(); leave(); window.vcFlow.home(); }));
    document.querySelectorAll("#flowRoot [data-history]").forEach((b) => b.addEventListener("click", openHistory));
    $("flowHist").querySelector("[data-histclose]").addEventListener("click", closeHistory);
    $("flowHist").querySelector("[data-newchat]").addEventListener("click", () => { closeHistory(); show("library"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("flowHist").hidden) closeHistory(); });
    $("flowManual").addEventListener("click", () => { leave(); window.vcFlow.openEditor(); });
    $("flowResume").addEventListener("click", () => { leave(); window.vcFlow.openEditor(); });
    $("flowAuto").addEventListener("click", () => openAgent(null));
    document.querySelectorAll("#flowRoot [data-to]").forEach((b) => b.addEventListener("click", () => show(b.dataset.to)));
    document.querySelectorAll("#flowRoot [data-plans]").forEach((b) => b.addEventListener("click", () => window.vcAccount && vcAccount.openPlans()));
    document.querySelectorAll("#flowRoot [data-account]").forEach((b) => b.addEventListener("click", () => window.vcAccount && vcAccount.openAccount()));
    // the same switch as the site and editor (app.js applyTheme), from the hidden top bar
    document.querySelectorAll("#flowRoot [data-status]").forEach((b) => b.addEventListener("click", () => window.vcAccount && vcAccount.openStatus()));
    document.querySelectorAll("#flowRoot [data-theme-flow]").forEach((b) => b.addEventListener("click", () => { const t = document.querySelector("[data-theme-toggle]"); if (t) t.click(); }));
    $("flowFine").addEventListener("click", () => { leave(); window.vcFlow.openEditor(); });
    $("flowSearch").addEventListener("input", (e) => { F.q = e.target.value.trim().toLowerCase(); renderGrid(); });
    $("flowAdd").addEventListener("click", openAdd);
    $("flowFiles").addEventListener("change", (e) => { const files = Array.from(e.target.files || []); e.target.value = ""; addFootage(files); });
    $("flowEffort").addEventListener("click", toggleMenu);
    document.addEventListener("click", (e) => { if (!e.target.closest(".flow-effort-wrap")) closeMenu(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
    const ta = $("flowPrompt");
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(160, ta.scrollHeight) + "px"; });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("flowComposer").requestSubmit(); } });
    $("flowComposer").addEventListener("submit", (e) => { e.preventDefault(); if (F.busy) stop(); else edit(); });
    // footage dropped anywhere on the workspace
    const ag = $("flowAgent");
    ag.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); ag.classList.add("is-drop"); } });
    ag.addEventListener("dragleave", (e) => { if (e.target === ag) ag.classList.remove("is-drop"); });
    ag.addEventListener("drop", (e) => { if (!hasFiles(e)) return; e.preventDefault(); ag.classList.remove("is-drop"); addFootage(Array.from(e.dataTransfer.files || [])); });
    if (window.vcAccount) vcAccount.onChange(paintTokens);
    paintTokens();
    renderCats(); renderGrid(); renderEffort();
  }
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");

  function show(name) {
    F.screen = name;
    document.body.dataset.flow = name;
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    ["start", "library", "agent"].forEach((n) => $("flow" + n[0].toUpperCase() + n.slice(1)).classList.toggle("active", n === name));
    if (name === "start") { $("flowResume").classList.toggle("hidden", !window.vcHasSession); renderRecent(); }
    if (name === "agent") { renderClips(); estimate(); }
    window.scrollTo(0, 0);
  }
  function leave() {
    if (window.vcFlow && window.vcFlow.returnPreview) window.vcFlow.returnPreview(); F.screen = null; delete document.body.dataset.flow; document.querySelectorAll(".flow-screen").forEach((s) => s.classList.remove("active")); }
  window.vcFlowShow = show;
  window.vcFlowAdd = (files) => addFootage(files);   // tests and the landing drop

  /* ── library ── */
  function renderCats() {
    $("flowCats").innerHTML = CATS.map((c) => `<button type="button" role="tab" class="flow-cat${F.cat === c.id ? " active" : ""}" aria-selected="${F.cat === c.id}" data-cat="${c.id}">${esc(c.name)}</button>`).join("");
    $("flowCats").querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => { F.cat = b.dataset.cat; renderCats(); renderGrid(); }));
  }
  function renderGrid() {
    const all = templates();
    const list = all.filter((t) => (F.cat === "all" || t.cat === F.cat) && (!F.q || (t.name + " " + t.when + " " + t.catName + " " + t.beats.join(" ")).toLowerCase().includes(F.q)));
    const grid = $("flowGrid");
    grid.innerHTML = list.length ? list.slice(0, 120).map((t) => `
      <button type="button" class="flow-card" data-id="${esc(t.id)}">
        <span class="flow-card-pic"><img src="site/wall/${t.pic}.webp" alt="" loading="lazy" decoding="async"></span>
        <span class="flow-card-name">${esc(t.name)}</span>
      </button>`).join("") : `<p class="flow-empty">No template matches "${esc(F.q)}". Try Auto clip: it picks one from your footage.</p>`;
    grid.querySelectorAll(".flow-card").forEach((b) => {
      const t = list.find((x) => x.id === b.dataset.id);
      b.addEventListener("click", () => openAgent(t));
      // the picture plays its loop while the pointer is on it (CapCut's template wall)
      b.addEventListener("pointerenter", () => { const pic = b.querySelector(".flow-card-pic"); if (pic.querySelector("video") || matchMedia("(prefers-reduced-motion: reduce)").matches) return; const v = document.createElement("video"); v.src = "site/wall/" + t.pic + ".mp4"; v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = true; v.setAttribute("aria-hidden", "true"); pic.appendChild(v); });
      b.addEventListener("pointerleave", () => { const v = b.querySelector("video"); if (v) v.remove(); });
    });
  }

  /* ── the agent workspace ── */
  function openAgent(t) {
    F.template = t;
    F.chat = { id: Date.now(), title: t ? t.name : "Auto clip", tpl: t ? t.id : null, at: Date.now(), items: [] };
    $("flowAgentTitle").textContent = t ? t.name : "Auto clip";
    if (t) window.vcFlow.setMode(t.mode);
    const th = $("flowThread");
    window.vcFlow.returnPreview();
    th.innerHTML = "";
    say(t ? `<p><b>${esc(t.name)}</b></p>`
      : `<p><b>Auto clip</b></p>`, "intro");
    show("agent");
    if (!window.vcFlow.media().length) dropBox();
  }
  /* ── Add videos (owner, 2026-11-22): every place a video can come from, in Ethlenos's own sheet.
     Gallery opens the phone's photo picker (iOS Photos, Android's photo picker); Files opens the
     file chooser, which also lists the other gallery apps (Google Photos, Samsung Gallery...);
     Camera records straight in; Google Photos, Drive and Dropbox appear once they are set up
     (sources.js). On a computer: one choose button, and drag and drop anywhere. ── */
  const ADD_ICONS = {
    gallery: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 15.5l-4.6-4.6a1.4 1.4 0 0 0-2 0L5 20"/></svg>',
    camera: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6" width="13" height="12" rx="2.5"/><path d="M15.5 10.5l6-3v9l-6-3"/></svg>',
    files: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5a4.5 4.5 0 0 1-.5-8.97A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 10z"/></svg>',
    computer: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>'
  };
  const touch = () => matchMedia("(pointer: coarse)").matches;
  const VIDEO_EXT = ".mp4,.mov,.m4v,.webm,.mkv,.avi,.3gp,.jpg,.jpeg,.png,.heic,.heif,.webp,.gif,.mp3,.wav,.m4a,.aac";
  function picker(accept, capture) {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = !capture; i.accept = accept; i.hidden = true;
    if (capture) i.setAttribute("capture", "environment");
    i.addEventListener("change", () => { const f = Array.from(i.files || []); i.remove(); if (f.length) addFootage(f); });
    document.body.appendChild(i);
    i.click();   // inside the tap, which the browser requires
  }
  function openAdd() {
    let sh = $("flowAddSheet");
    if (!sh) {
      sh = document.createElement("div");
      sh.id = "flowAddSheet"; sh.className = "flow-addveil";
      sh.innerHTML = '<div class="flow-addsheet" role="dialog" aria-modal="true" aria-labelledby="flowAddTitle"><div class="flow-addhead"><h2 id="flowAddTitle">Add videos</h2><button type="button" class="flow-icon" data-addclose aria-label="Close">' + I.x + '</button></div><div class="flow-addgrid"></div><p class="flow-addstatus" role="status"></p></div>';
      sh.addEventListener("click", (e) => { if (e.target === sh || e.target.closest("[data-addclose]")) closeAdd(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sh.classList.contains("open")) closeAdd(); });
      $("flowRoot").appendChild(sh);
    }
    const tiles = touch()
      ? [["gallery", "Gallery"], ["camera", "Camera"], ["files", "Files"]]
      : [["computer", "Choose from computer"]];
    const grid = sh.querySelector(".flow-addgrid");
    grid.innerHTML = tiles.map(([k, l]) => '<button type="button" class="flow-addtile" data-add="' + k + '">' + ADD_ICONS[k] + "<span>" + esc(l) + "</span></button>").join("");
    sh.querySelector(".flow-addstatus").textContent = "";
    // the connected sources, only once each is set up
    if (window.SenotelSources) {
      SenotelSources.warm && SenotelSources.warm();
      SenotelSources.available().then((av) => {
        [["gphotos", "Google Photos"], ["drive", "Google Drive"], ["dropbox", "Dropbox"]].forEach(([k, l]) => {
          if (!av[k] || grid.querySelector('[data-add="' + k + '"]')) return;
          grid.insertAdjacentHTML("beforeend", '<button type="button" class="flow-addtile" data-add="' + k + '">' + ADD_ICONS.cloud + "<span>" + esc(l) + "</span></button>");
        });
      }).catch(() => {});
    }
    grid.onclick = (e) => {
      const b = e.target.closest("[data-add]"); if (!b) return;
      const k = b.dataset.add, st = sh.querySelector(".flow-addstatus");
      if (k === "gallery") { closeAdd(); picker("image/*,video/*"); }
      else if (k === "camera") { closeAdd(); picker("video/*", true); }
      else if (k === "files" || k === "computer") { closeAdd(); picker(VIDEO_EXT + ",video/*,image/*,audio/*"); }
      else {
        const run = k === "drive" ? (o) => SenotelSources.fromDrive(o) : k === "dropbox" ? (o) => SenotelSources.fromDropbox(o)
          : (o) => (SenotelSources.photos.signedIn() ? SenotelSources.fromGooglePhotos(o) : SenotelSources.photos.signIn().then(() => SenotelSources.fromGooglePhotos(o)));
        st.textContent = "Opening " + b.textContent + "...";
        Promise.resolve(run({})).then((got) => { const f = Array.isArray(got) ? got : got ? [got] : []; closeAdd(); if (f.length) addFootage(f); })
          .catch((err) => { st.textContent = (err && err.message) || "That didn't open. Try again."; });
      }
    };
    sh.classList.add("open");
    requestAnimationFrame(() => sh.classList.add("in"));
    const first = grid.querySelector("button"); if (first) first.focus({ preventScroll: true });
  }
  function closeAdd() { const sh = $("flowAddSheet"); if (!sh) return; sh.classList.remove("in", "open"); }

  /* ── chat history (owner, 2026-11-22): every chat is kept on this device and can be reopened ── */
  const chats = () => store.get("chats", []);
  function record(k, t) {
    if (!F.chat || !t) return;
    F.chat.items.push({ k, t: String(t).slice(0, 500) });
    if (k === "you" && F.chat.title === (F.template ? F.template.name : "Auto clip")) F.chat.title = String(t).slice(0, 60);
    F.chat.at = Date.now();
    const list = chats().filter((c) => c.id !== F.chat.id);
    list.unshift(F.chat);
    store.set("chats", list.slice(0, 30));
  }
  const when = (t) => { const d = new Date(t), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" }); };
  function openHistory() {
    const list = chats();
    $("flowHistList").innerHTML = list.length ? list.map((c) => `<li><button type="button" class="flow-hist-item" data-chat="${c.id}"><span>${esc(c.title)}</span><span class="flow-hist-when">${when(c.at)}</span></button></li>`).join("") : `<li class="flow-hist-empty">No chats yet</li>`;
    $("flowHistList").querySelectorAll("[data-chat]").forEach((b) => b.addEventListener("click", () => { const c = chats().find((x) => String(x.id) === b.dataset.chat); if (c) openChat(c); }));
    $("flowHist").hidden = false;
    const first = $("flowHist").querySelector(".flow-hist-item, [data-newchat]"); if (first) first.focus();
  }
  function closeHistory() { const h = $("flowHist"); if (h) h.hidden = true; }
  // a past chat reopens as its transcript; new messages continue it
  function openChat(c) {
    closeHistory();
    F.chat = c;
    F.template = c.tpl ? templates().find((t) => t.id === c.tpl) || null : null;
    $("flowAgentTitle").textContent = F.template ? F.template.name : "Auto clip";
    window.vcFlow.returnPreview();
    $("flowThread").innerHTML = "";
    say(`<p><b>${esc(F.template ? F.template.name : "Auto clip")}</b></p>`, "intro");
    c.items.forEach((it) => { const m = say(it.k === "steps" ? `<p class="flow-meta">${esc(it.t)}</p>` : `<p>${esc(it.t)}</p>`, it.k === "you" ? "you" : "agent"); if (it.k === "you") resendable(m, it.t); });
    show("agent");
    if (!window.vcFlow.media().length) dropBox();
  }
  // tap your own message to put it back in the box, change it, and send again
  function resendable(m, text) {
    m.setAttribute("role", "button"); m.tabIndex = 0; m.title = "Edit and send again";
    const go = () => { const ta = $("flowPrompt"); ta.value = text; ta.dispatchEvent(new Event("input")); ta.focus(); };
    m.addEventListener("click", go); m.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  function renderRecent() {
    const list = chats().slice(0, 3), el = $("flowRecent");
    if (!el) return;
    el.innerHTML = list.length ? `<p class="flow-eyebrow">Recent</p>` + list.map((c) => `<button type="button" class="flow-recent-item" data-chat="${c.id}"><span>${esc(c.title)}</span><span class="flow-hist-when">${when(c.at)}</span></button>`).join("") : "";
    el.querySelectorAll("[data-chat]").forEach((b) => b.addEventListener("click", () => { const c = chats().find((x) => String(x.id) === b.dataset.chat); if (c) openChat(c); }));
  }
  function say(html, kind) {
    const m = document.createElement("div");
    m.className = "flow-msg flow-msg-" + (kind || "agent");
    m.innerHTML = html;
    $("flowThread").appendChild(m);
    m.scrollIntoView({ block: "end", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    return m;
  }
  function dropBox() {
    const m = say(`<button type="button" class="flow-drop">${I.plus}<span><b>Add videos</b></span></button>`, "drop");
    m.querySelector(".flow-drop").addEventListener("click", openAdd);
  }
  function addFootage(files) {
    files = files.filter((f) => /^(video|image|audio)\//.test(f.type));
    if (!files.length) return;
    window.vcFlow.addFiles(files);
    const d = document.querySelector(".flow-msg-drop"); if (d) d.remove();
    // thumbnails arrive as the app reads each file
    renderClips(); setTimeout(renderClips, 800); setTimeout(renderClips, 2500); setTimeout(() => { renderClips(); estimate(); }, 5000);
    estimate();
  }
  function renderClips() {
    const m = window.vcFlow.media();
    $("flowClips").innerHTML = m.map((x) => `<span class="flow-clip" title="${esc(x.name)}">${x.thumb ? `<img src="${x.thumb}" alt="">` : I.film}<span>${x.duration ? fmt(x.duration) : esc(x.type)}</span><button type="button" class="flow-clip-x" data-rm="${x.id}" aria-label="Remove ${esc(x.name)}" ${F.busy ? "disabled" : ""}>${I.x}</button></span>`).join("");
    $("flowClips").querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { if (F.busy) return; window.vcFlow.removeMedia(+b.dataset.rm); renderClips(); estimate(); if (!window.vcFlow.media().length && !document.querySelector(".flow-msg-drop")) dropBox(); }));
    $("flowClips").classList.toggle("hidden", !m.length);
  }
  const fmt = (s) => (s >= 60 ? Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0") : Math.round(s) + " s");

  /* ── effort menu (shaped like Claude's model menu) ── */
  function renderEffort() {
    const lv = LEVELS.find((l) => l.id === F.level) || LEVELS[2];
    $("flowEffort").innerHTML = `${F.fast ? I.bolt : ""}<span>${esc(lv.name)}</span>${I.chev}`;
    $("flowMenu").innerHTML = LEVELS.map((l) => `
      <button type="button" role="option" class="flow-opt${l.id === F.level ? " active" : ""}" aria-selected="${l.id === F.level}" data-level="${l.id}">
        <span class="flow-opt-top"><b>${esc(l.name)}</b>${l.rec ? '<span class="flow-rec">Recommended</span>' : ""}<span class="flow-opt-tok">${l.tokens[0]}-${l.tokens[1]} Tokens</span>${l.id === F.level ? `<span class="flow-opt-check">${I.check}</span>` : ""}</span>
      </button>`).join("") + `
      <label class="flow-fast"><span><b>Fast</b></span>
        <input type="checkbox" id="flowFast" ${F.fast ? "checked" : ""}><span class="flow-switch" aria-hidden="true"></span></label>`;
    $("flowMenu").querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => { F.level = b.dataset.level; store.set("level", F.level); renderEffort(); estimate(); closeMenu(); $("flowEffort").focus(); }));
    $("flowFast").addEventListener("change", (e) => { F.fast = e.target.checked; store.set("fast", F.fast); renderEffort(); estimate(); });
  }
  function toggleMenu() { const open = $("flowMenu").classList.toggle("hidden") === false; $("flowEffort").setAttribute("aria-expanded", String(open)); if (open) { const a = $("flowMenu").querySelector(".active"); if (a) a.focus(); } }
  function closeMenu() { if (!$("flowMenu")) return; $("flowMenu").classList.add("hidden"); $("flowEffort").setAttribute("aria-expanded", "false"); }

  /* ── the Token estimate, before Edit (owner: know before you press) ── */
  function need(levelId) {
    const lv = LEVELS.find((l) => l.id === (levelId || F.level)) || LEVELS[2];
    const secs = window.vcFlow.media().reduce((t, m) => t + (m.duration || 0), 0) || 60;
    const k = Math.max(1, Math.min(6, 0.6 + secs / 150)) * (F.fast ? FAST_X : 1);
    return [Math.ceil(lv.tokens[0] * k), Math.ceil(lv.tokens[1] * k)];
  }
  function estimate() {
    const [lo, hi] = need();
    const acc = window.vcAccount && vcAccount.state();
    const bal = acc && acc.signedIn ? acc.tokens : null;
    const el = $("flowEst");
    el.textContent = `${lo}-${hi} Tokens`;
    el.title = bal != null ? `You have ${bal}` : "";
    el.classList.toggle("short", bal != null && bal < hi);
  }
  function paintTokens() {
    const acc = window.vcAccount && vcAccount.state();
    // low balance (research: warn before it runs out): under one Standard edit the label turns red; at 0 it says Top up
    document.querySelectorAll("#flowRoot [data-plans]").forEach((b) => { const on = acc && acc.signedIn; b.textContent = on ? (acc.tokens > 0 ? acc.tokens.toLocaleString() + " Tokens" : "Top up") : "Plans"; b.classList.toggle("low", !!on && acc.tokens < 55); });
    document.querySelectorAll("#flowRoot [data-account]").forEach((b) => { b.textContent = acc && acc.signedIn ? "Account" : "Sign in"; });
    if (F.screen === "agent") estimate();
  }

  /* ── Edit ── */
  // Stop at any moment (owner: interruptible, like a chat): the edit ends at its next step,
  // a cut already on the timeline is rolled back, and nothing is charged
  function stop() {
    if (!F.ctrl || F.ctrl.signal.aborted) return;
    F.ctrl.abort();
    F.runId++;   // the stopped run no longer owns the screen
    const now = document.querySelector(".flow-step.now");
    if (now) { now.classList.remove("now"); const sp = now.querySelector(".ldr-line-spinner"); if (sp) sp.outerHTML = "<span class=\"flow-done\"></span>"; }
    setBusy(false);
    record("agent", "Stopped. Nothing was changed or charged.");
    say(`<p>Stopped. Nothing was changed or charged.</p>`, "agent");
    $("flowPrompt").focus();
  }
  function setBusy(on) {
    F.busy = on;
    const b = $("flowSend");
    b.classList.toggle("is-stop", on);
    b.innerHTML = on ? I.stop : I.send;
    b.setAttribute("aria-label", on ? "Stop" : "Edit");
    b.title = on ? "Stop" : "Edit";
    renderClips();
  }
  async function edit(again) {
    if (F.busy) return;
    const media = window.vcFlow.media();
    if (!media.length) { dropBox(); return; }
    const prompt = again != null ? again : $("flowPrompt").value.trim();
    let [lo, hi] = need();
    // value first: everything up to here needed no account; the first AI edit does
    if (window.vcAccount) {
      // the strongest lighter level the balance already covers, offered beside the top-up
      const lighter = (bal) => { const fit = LEVELS.slice(0, LEVELS.findIndex((l) => l.id === F.level)).reverse().find((l) => need(l.id)[1] <= bal); return fit && { name: fit.name, low: need(fit.id)[0], need: need(fit.id)[1], apply: () => { F.level = fit.id; store.set("level", F.level); renderEffort(); estimate(); } }; };
      const ok = await vcAccount.ready({ reason: "edit", need: hi, low: lo, lighter });
      if (!ok) return;
    }
    const lv = LEVELS.find((l) => l.id === F.level);
    [lo, hi] = need();   // the level may have changed at the gate
    F.ctrl = new AbortController();
    const signal = F.ctrl.signal;
    const run = (F.runId = (F.runId || 0) + 1);
    const mine = () => run === F.runId;
    setBusy(true);
    F.lastPrompt = prompt;
    $("flowPrompt").value = ""; $("flowPrompt").style.height = "";
    const said = prompt || (F.template ? "Make it with this template." : "Make the best video this footage allows.");
    record("you", said);
    resendable(say(`<p>${esc(said)}</p><p class="flow-meta">${media.length} file${media.length > 1 ? "s" : ""} · ${esc(lv.name)}${F.fast ? " · Fast" : ""}</p>`, "you"), said);
    const work = say(`<div class="flow-steps"><div class="flow-step now">${SPIN}<span>Getting started</span></div></div>`, "work");
    const steps = work.querySelector(".flow-steps");
    let last = "Getting started";
    const step = (s) => {
      if (!s || s === last || signal.aborted) return;
      last = s;
      const now = steps.querySelector(".now");
      if (now) { now.classList.remove("now"); now.querySelector(".ldr-line-spinner").outerHTML = `<span class="flow-done">${I.check}</span>`; }
      const d = document.createElement("div");
      d.className = "flow-step now";
      d.innerHTML = SPIN + "<span>" + esc(s) + "</span>";
      steps.appendChild(d);
      // a step that drags (Google's AI can take minutes when busy) says so instead of looking frozen
      setTimeout(() => { if (d.classList.contains("now")) d.lastElementChild.textContent = s + ". Taking longer than usual"; }, 40000);
      work.scrollIntoView({ block: "end" });
    };
    const brief = [F.template ? `Use the template structure "${F.template.name}" (${F.template.beats.join(" > ")}).` : "", prompt].filter(Boolean).join(" ");
    let failed = null;
    // Google's free Gemini often answers "high demand" (HTTP 503/429) for a
    // minute: wait and try again twice, saying so, before giving up
    if (F.running) await F.running;   // a stopped edit still winding down
    for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
      failed = null;
      F.running = window.vcFlow.runEdit({ prompt: brief, onProgress: step, onFail: (m) => { failed = m; }, level: F.level, fast: F.fast, signal });
      await F.running; F.running = null;
      if (signal.aborted || !failed || !/\b(503|429)\b|high demand|overloaded|rate limit|quota/i.test(failed) || attempt === 2) break;
      const wait = attempt ? 30 : 12;
      step(`Google's AI is busy right now. Trying again in ${wait} s`);
      const row = steps.querySelector(".now span:last-child");
      for (let s = wait - 1; s > 0 && !signal.aborted; s--) { await new Promise((r) => setTimeout(r, 1000)); if (row && !signal.aborted) row.textContent = `Google's AI is busy right now. Trying again in ${s} s`; }
      if (signal.aborted) break;
      await new Promise((r) => setTimeout(r, 1000));
      step("Trying again");
    }
    if (signal.aborted || !mine()) return;
    const now = steps.querySelector(".now");
    if (now) { now.classList.remove("now"); now.querySelector(".ldr-line-spinner").outerHTML = `<span class="flow-done">${failed ? "" : I.check}</span>`; }
    setBusy(false);
    const st = window.vcFlow.state();
    record("steps", [...steps.querySelectorAll(".flow-step")].map((x) => x.textContent.trim()).join(" · "));
    if (failed || !st.clips) {
      // a plain sentence; the technical reason folds away for support
      record("agent", "No edit this time. Nothing was charged.");
      say(`<p>No edit this time. Nothing was charged.</p>${failed ? `<details class="flow-why"><summary>What happened</summary><p>${esc(failed)}</p></details>` : ""}`, "agent");
      return;
    }
    const spent = window.vcAccount ? vcAccount.charge(Math.round((lo + hi) / 2), { level: F.level, fast: F.fast }) : null;
    result(st, spent);
  }
  function result(st, spent) {
    record("agent", `Edit ready: ${fmt(st.seconds)}, ${st.clips} clip${st.clips === 1 ? "" : "s"}${spent ? ", " + spent + " Tokens" : ""}`);
    const r = say(`<div class="flow-result"><div class="flow-player" id="flowPlayer${Date.now()}"></div>
      <div class="flow-result-bar"><span>${fmt(st.seconds)} · ${st.clips} clips${spent ? ` · ${spent} Tokens` : ""}</span></div><div class="flow-next"><button type="button" class="flow-btn" data-export>Download</button><button type="button" class="flow-btn flow-btn-ghost" data-fine>Edit by hand</button><button type="button" class="flow-btn flow-btn-ghost" data-again>New version</button></div></div>`, "agent");
    const player = r.querySelector(".flow-player");
    try { window.vcFlow.mountPreview(player); } catch (e) {}
    r.querySelector("[data-fine]").addEventListener("click", () => { leave(); window.vcFlow.openEditor(); });
    r.querySelector("[data-export]").addEventListener("click", () => { leave(); window.vcFlow.exportNow(); });
    r.querySelector("[data-again]").addEventListener("click", () => edit(F.lastPrompt || ""));
  }

  /* ── entry: the landing's Start buttons open the flow ── */
  function start() {
    if (!window.vcFlow) return setTimeout(start, 50);
    build();
    window.vcBegin = () => show("start");
    window.vcStartWith = (files) => { show("library"); openAgent(null); addFootage(files); };
    // the app's own back button leads home through the flow
    const back = $("backBtn");
    if (back) back.addEventListener("click", (e) => { if (document.body.dataset.screen === "editor" || document.body.dataset.screen === "modes") { e.stopImmediatePropagation(); show("start"); } }, true);
    if (/[?&]flow=(start|library|agent)/.test(location.search)) show(location.search.match(/flow=(\w+)/)[1] === "agent" ? (openAgent(null), "agent") : location.search.match(/flow=(\w+)/)[1]);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
