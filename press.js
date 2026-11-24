/* Ethlenos press feedback (0.95.2, admin): on a phone every button, link and tile visibly presses
   (darkens and dips) the moment a finger lands, and stays pressed long enough to be seen even on a
   quick tap. Buttons that change the screen wait for it through window.ethPress(el, fn).
   A scroll that starts on a button cancels the press at once. */
(function () {
  "use strict";
  var SEL = 'button, a[href], [role="button"], [role="tab"], label[for], summary, .tool, .fchip';
  var MIN = 140, cur = null, t0 = 0;
  function on(e) {
    if (e.pointerType === "mouse") return;
    var el = e.target.closest && e.target.closest(SEL);
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    cur = el; t0 = performance.now();
    el.classList.add("is-pressed");
  }
  function up() {
    if (!cur) return;
    var el = cur; cur = null;
    setTimeout(function () { el.classList.remove("is-pressed"); }, Math.max(0, MIN - (performance.now() - t0)));
  }
  function cancel() { if (cur) { cur.classList.remove("is-pressed"); cur = null; } }
  document.addEventListener("pointerdown", on, { passive: true });
  document.addEventListener("pointerup", up, { passive: true });
  document.addEventListener("pointercancel", cancel, { passive: true });
  document.addEventListener("touchstart", function () {}, { passive: true });   // iOS Safari: lets :active show
  // run fn once the press has been seen (about a seventh of a second after the finger landed)
  window.ethPress = function (el, fn) {
    var wait = el && el.classList.contains("is-pressed") ? Math.max(0, 120 - (performance.now() - t0)) : 0;
    if (el && !wait && matchMedia("(pointer: coarse)").matches) { el.classList.add("is-pressed"); wait = 120; setTimeout(function () { el.classList.remove("is-pressed"); }, 160); }
    setTimeout(fn, wait);
  };
})();
