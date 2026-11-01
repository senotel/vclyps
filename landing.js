/* vClyps landing (T18). The page is plain HTML and CSS; this only wires it
   up. The show is landing-show.js.
   · "Choose your footage" ([data-pick]) opens the file picker, and files
     dropped on the hero do the same: both go to app.js vcStartWith, which
     opens the editor with them on the timeline. Cancelling the picker
     leaves the page as it was, with focus back on the button pressed.
   · "Open the editor" ([data-start]) opens New project (vcBegin).
   · Section links scroll inside the landing (it is its own scroll box)
     without writing a #hash into the app's address. "Skip the show"
     ([data-instant]) jumps at once and puts focus on the heading it skips
     to, so a keyboard user carries on from there. */
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

  var input = document.getElementById("lpFiles"), opener = null;
  home.querySelectorAll("[data-pick]").forEach(function (b) {
    b.addEventListener("click", function () {
      opener = b;
      if (input) input.click(); else begin();
    });
  });
  if (input) {
    input.addEventListener("change", function () {
      var files = Array.prototype.slice.call(input.files || []);
      input.value = "";
      if (!files.length && opener) opener.focus();
      startWith(files);
    });
    input.addEventListener("cancel", function () { if (opener) opener.focus(); });
  }

  // drop footage on the hero; the outline shows only during a real file drag
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

  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  home.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      var instant = a.hasAttribute("data-instant") || still.matches;
      e.preventDefault();
      if (!id) { home.scrollTo({ top: 0, behavior: instant ? "auto" : "smooth" }); return; }
      var to = document.getElementById(id);
      if (!to) return;
      to.scrollIntoView({ behavior: instant ? "auto" : "smooth", block: "start" });
      if (a.hasAttribute("data-instant")) {
        var h = to.querySelector("h2[tabindex]");
        if (h) h.focus({ preventScroll: true });
      }
    });
  });
})();
