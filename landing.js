/* vClyps landing (0.66.0). The page is plain HTML and CSS; this only wires
   it up. Every Start button opens the mode picker through app.js, and the
   section links scroll inside the landing (it is its own scroll box) without
   writing a #hash into the app's address. */
(function () {
  "use strict";
  var home = document.getElementById("screen-home");
  if (!home) return;

  home.querySelectorAll("[data-start]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (typeof window.vcBegin === "function") window.vcBegin();
      else if (typeof window.vcEnterEditor === "function") window.vcEnterEditor();
    });
  });

  var still = window.matchMedia("(prefers-reduced-motion: reduce)");
  home.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener("click", function (e) {
      var id = a.getAttribute("href").slice(1);
      e.preventDefault();
      if (!id) { home.scrollTo({ top: 0, behavior: still.matches ? "auto" : "smooth" }); return; }
      var to = document.getElementById(id);
      if (to) to.scrollIntoView({ behavior: still.matches ? "auto" : "smooth", block: "start" });
    });
  });
})();
