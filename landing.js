/* Ethlenos landing (0.67.0, links reworked in T21). The page is plain HTML
   and CSS; this only wires it up.
   · "Choose your footage" ([data-pick]) opens the file picker, and files
     dropped anywhere on the hero do the same: both go to app.js
     vcStartWith, which opens the editor with them on the timeline.
   · "Open the editor" ([data-start]) opens New project (vcBegin).
   · Section links scroll inside the landing (it is its own scroll box)
     without writing a #hash into the app's address. */
(function () {
  "use strict";
  var home = document.getElementById("screen-home");
  if (!home) return;

  function begin() {
    if (typeof window.vcBegin === "function") window.vcBegin();
    else if (typeof window.vcEnterEditor === "function") window.vcEnterEditor();
  }
  function startWith(files) {
    if (!files || !files.length) return;
    if (typeof window.vcStartWith === "function") window.vcStartWith(files);
    else begin();
  }

  home.querySelectorAll("[data-start]").forEach(function (b) { b.addEventListener("click", begin); });

  var input = document.getElementById("lpFiles");
  home.querySelectorAll("[data-pick]").forEach(function (b) {
    b.addEventListener("click", function () {
      // 0.93.0: every gallery, the camera, files and connected services, in one sheet
      if (window.EthAdd) return window.EthAdd.open({ title: "Add videos", onFiles: startWith });
      if (input) input.click(); else begin();
    });
  });
  if (input) input.addEventListener("change", function () {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    startWith(files);
  });

  // drop footage on the hero
  var hero = document.getElementById("lpHero");
  if (hero) {
    var depth = 0;
    var hasFiles = function (e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0; };
    hero.addEventListener("dragenter", function (e) { if (!hasFiles(e)) return; e.preventDefault(); depth++; hero.classList.add("is-dragging"); });
    hero.addEventListener("dragover", function (e) { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    hero.addEventListener("dragleave", function () { depth = Math.max(0, depth - 1); if (!depth) hero.classList.remove("is-dragging"); });
    hero.addEventListener("drop", function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; hero.classList.remove("is-dragging");
      startWith(Array.prototype.slice.call(e.dataTransfer.files || []));
    });
  }

  /* The show's autoplay steps aside until a jump has landed, so it never
     cuts the smooth scroll short (T21); the links to the show then play it
     forwards from its first frame (landing-show.js vcLandingShow). */
  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  home.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      e.preventDefault();
      if (window.vcLandingShow) window.vcLandingShow.navigate(id === "lpShow");
      if (!id) { home.scrollTo({ top: 0, behavior: still.matches ? "auto" : "smooth" }); return; }
      var to = document.getElementById(id);
      if (to) to.scrollIntoView({ behavior: still.matches ? "auto" : "smooth", block: "start" });
    });
  });
})();

/* 0.97.0 (audit 6): the effort levels as a control you can tap. One soft square slides to the level
   you pick (shape morph, spring) and one line says what that level does. */
(function () {
  "use strict";
  var list = document.querySelector(".lp-modes-list");
  if (!list) return;
  var SAY = { Low: "Quick and simple.", Light: "Cleaner cuts.", Standard: "Best for most videos.", Thorough: "Tries two versions and keeps the better one.", Deep: "Extra checks on every cut.", Max: "Everything it has." };
  var names = Array.prototype.map.call(list.children, function (li) { return (li.firstChild && li.firstChild.textContent || "").trim(); }).filter(Boolean);
  var wrap = document.createElement("div");
  wrap.className = "lp-levels"; wrap.setAttribute("role", "radiogroup"); wrap.setAttribute("aria-label", "How hard it works");
  var ind = document.createElement("span"); ind.className = "lp-level-ind"; ind.setAttribute("aria-hidden", "true"); wrap.appendChild(ind);
  names.forEach(function (n) {
    var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.dataset.level = n;
    b.innerHTML = n + (n === "Standard" ? '<span class="lp-level-rec">Recommended</span>' : "");
    wrap.appendChild(b);
  });
  var say = document.createElement("p"); say.className = "lp-level-say"; say.setAttribute("aria-live", "polite");
  list.classList.add("is-control");
  list.parentNode.insertBefore(say, list.nextSibling); list.parentNode.insertBefore(wrap, say);
  function pick(n, still) {
    var b = wrap.querySelector('[data-level="' + n + '"]'); if (!b) return;
    wrap.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    if (still) ind.style.transition = "none";
    ind.style.width = b.offsetWidth + "px"; ind.style.height = b.offsetHeight + "px";
    ind.style.transform = "translate(" + b.offsetLeft + "px," + (b.offsetTop - 4) + "px)";
    if (still) { void ind.offsetWidth; ind.style.transition = ""; }
    say.textContent = SAY[n] || "";
  }
  wrap.addEventListener("click", function (e) { var b = e.target.closest("button[data-level]"); if (b) pick(b.dataset.level); });
  wrap.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var i = names.indexOf((wrap.querySelector('[aria-checked="true"]') || {}).dataset.level);
    var n = names[(i + (e.key === "ArrowRight" ? 1 : names.length - 1)) % names.length];
    pick(n); wrap.querySelector('[data-level="' + n + '"]').focus(); e.preventDefault();
  });
  var start = function () { pick("Standard", true); };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(start); else start();
  start();
  window.addEventListener("resize", function () { var c = wrap.querySelector('[aria-checked="true"]'); if (c) pick(c.dataset.level, true); });
})();
