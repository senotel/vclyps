/* vClyps landing (0.67.0, links reworked in T21). The page is plain HTML
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
    b.addEventListener("click", function () { if (input) input.click(); else begin(); });
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
