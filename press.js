/* Ethlenos press feedback (0.95.3, admin): every button, link and tile answers a finger or a click
   the Apple way. Held: it darkens and stays shrunk. Let go: it springs a little past its own size
   and settles, all in about a third of a second. A quick tap still shows the whole thing.
   Uses the CSS `scale` property, so it never fights a button's own transform.
   Buttons that change the screen wait for the press through window.ethPress(el, fn).
   A scroll that starts on a button lets it go back without the spring. */
(function () {
  "use strict";
  var SEL = 'button, a[href], [role="button"], [role="tab"], label[for], summary, .tool, .fchip';
  var SKIP = ".pub-plus";          // the big + has its own press, admin's favourite: left as it is
  var MIN = 110, cur = null, t0 = 0, downAnim = null;
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var IN = "cubic-bezier(0.32, 0.72, 0, 1)";
  function depth(el) { var r = el.getBoundingClientRect(); return r.width > 320 || r.height > 160 ? [0.975, 1.012] : [0.93, 1.04]; }

  function on(e) {
    if (e.button > 0) return;
    var el = e.target.closest && e.target.closest(SEL);
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return;
    cur = el; t0 = performance.now();
    if (e.pointerType !== "mouse") el.classList.add("is-pressed");
    if (reduce.matches || el.matches(SKIP) || !el.animate) return;
    var d = depth(el);
    el._ethDepth = d;
    downAnim = el.animate([{ scale: "1" }, { scale: String(d[0]) }], { duration: 120, easing: IN, fill: "forwards" });
  }
  function release(el, spring) {
    var a = downAnim; downAnim = null;
    var d = el._ethDepth;
    if (!d) { el.classList.remove("is-pressed"); return; }
    var from = d[0];
    el.animate(spring
      ? [{ scale: String(from) }, { scale: String(d[1]), offset: 0.45 }, { scale: "1" }]
      : [{ scale: String(from) }, { scale: "1" }], { duration: spring ? 380 : 160, easing: spring ? "cubic-bezier(0.2, 0, 0, 1)" : IN });
    if (a) a.cancel();
    el.classList.remove("is-pressed");
  }
  function up() {
    if (!cur) return;
    var el = cur; cur = null;
    // a quick tap still shows the dip before the spring
    setTimeout(function () { release(el, true); }, Math.max(0, MIN - (performance.now() - t0)));
  }
  function cancel() { if (cur) { var el = cur; cur = null; release(el, false); } }
  document.addEventListener("pointerdown", on, { passive: true });
  document.addEventListener("pointerup", up, { passive: true });
  document.addEventListener("pointercancel", cancel, { passive: true });
  document.addEventListener("dragstart", cancel, { passive: true });
  document.addEventListener("touchstart", function () {}, { passive: true });   // iOS Safari: lets :active show

  // run fn once the press has been seen: the dip, then most of the spring back
  window.ethPress = function (el, fn) {
    var since = performance.now() - t0;
    var wait = el && since < 1000 ? Math.max(0, 260 - since) : 0;
    if (el && since >= 1000 && !reduce.matches && el.animate) {   // keyboard: play the whole press once
      el.animate([{ scale: "1" }, { scale: "0.93", offset: 0.3 }, { scale: "1.04", offset: 0.65 }, { scale: "1" }], { duration: 380, easing: "cubic-bezier(0.2, 0, 0, 1)" });
      wait = 240;
    }
    if (reduce.matches) wait = 0;
    setTimeout(fn, wait);
  };
})();
