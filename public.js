/* Ethlenos public site (pre-launch). The + button and the New project chooser:
   Manual edit (open now, free), Auto clip and Templates (coming soon, not pressable).
   The + square grows into the Manual edit card: one shape, a spring, no crossfade. */
(function () {
  "use strict";
  var SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";
  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var I = {
    back: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>',
    manual: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="4" rx="1"/><rect x="3" y="11" width="11" height="4" rx="1"/><rect x="3" y="17" width="15" height="2.5" rx="1"/></svg>',
    auto: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
    tpl: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7.5" height="10" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="6" rx="1.5"/><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="1.5"/></svg>'
  };
  var MARK = document.querySelector(".lp-brand .brand-mark");
  var PUB = !!window.ETH_PUBLIC;   // 0.100.0: this file serves both sites; the developer site has every mode live

  var el = document.createElement("section");
  el.className = "pub-new"; el.id = "pubNew"; el.hidden = true;
  el.setAttribute("aria-labelledby", "pubNewTitle");
  el.innerHTML =
    '<header class="pub-new-head"><button class="pub-icon" type="button" data-back aria-label="Back">' + I.back + "</button>" +
      '<span class="pub-new-brand">' + (MARK ? MARK.outerHTML : "") + '<span>Ethlenos</span></span></header>' +
    '<div class="pub-new-body">' +
      '<h1 class="pub-new-title" id="pubNewTitle">New project</h1>' +
      // admin 2026-11-25: the automatic editor leads, plainly not open yet; manual editing waits at the bottom, open now
      (PUB
        ? '<div class="pub-opt pub-opt-auto is-soon" aria-disabled="true"><span class="pub-tag pub-tag-soon">Coming soon</span><span class="pub-opt-ic">' + I.auto + '</span><span class="pub-opt-tx"><b>Auto clip</b><span>Drop in your footage. Ethlenos edits it for you.</span></span></div>' +
          '<div class="pub-opt pub-opt-tpl is-soon" aria-disabled="true"><span class="pub-opt-ic">' + I.tpl + '</span><span class="pub-opt-tx"><b>Templates</b><span>Pick a style, add your footage</span></span><span class="pub-tag pub-tag-soon">Coming soon</span></div>' +
          '<p class="pub-now">Open now</p>'
        // the developer site: every mode is live (Auto clip and Templates open the AI chat and the template library)
        : '<button class="pub-opt pub-opt-auto pub-live" type="button" data-live="auto"><span class="pub-opt-ic">' + I.auto + '</span><span class="pub-opt-tx"><b>Auto clip</b><span>Drop in your footage. Ethlenos edits it for you.</span></span>' + I.chev + '</button>' +
          '<button class="pub-opt pub-opt-tpl pub-live" type="button" data-live="templates"><span class="pub-opt-ic">' + I.tpl + '</span><span class="pub-opt-tx"><b>Templates</b><span>Pick a style, add your footage</span></span>' + I.chev + '</button>') +
      '<button class="pub-opt pub-opt-main" type="button" data-manual>' +
        '<span class="pub-opt-ic">' + I.manual + '</span><span class="pub-opt-tx"><b>Manual edit</b><span>Edit by hand on a timeline</span></span>' +
        '<span class="pub-tag pub-tag-free">Free</span>' + I.chev + "</button>" +
      // 0.99.1 (admin + design-skills01): More reveals more tool cards right here (progressive disclosure), no other page
      '<div class="pub-extra" id="pubExtra" hidden></div>' +
      '<button class="pub-more" type="button" data-more-new aria-expanded="false" aria-controls="pubExtra"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/></svg><span class="pub-more-tx">More</span></button>' +
    "</div>";
  document.body.appendChild(el);

  var from = null;
  function openNew(srcBtn, withExtra) {
    setExtra(!!withExtra, true);
    if (window.ethMenuClose) window.ethMenuClose(true);
    from = srcBtn || null;
    el.hidden = false;
    document.documentElement.classList.add("pub-new-on");
    if (!history.state || !history.state.pubNew) history.pushState({ pubNew: 1 }, "");
    var manual = el.querySelector(".pub-opt-main"), card = PUB ? manual : (el.querySelector('[data-live="auto"]') || manual);   // the + grows into what works today, never into a mode that is not open yet (admin)
    var sq = srcBtn && srcBtn.querySelector(".pub-plus-sq");
    if (!reduce.matches) {
      el.querySelectorAll(".pub-new-title, .pub-opt-auto, .pub-opt-tpl, .pub-now").forEach(function (n, i) {
        n.animate([{ transform: "translateY(14px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 420, delay: 80 + i * 50, easing: SPRING, fill: "backwards" });
      });
      if (sq) {
        // the red square leaves the + button and becomes the Manual edit card (its colour turning into the card's)
        var a = sq.getBoundingClientRect(), b = card.getBoundingClientRect();
        var ghost = document.createElement("div");
        ghost.className = "pub-morph";
        document.body.appendChild(ghost);
        card.style.visibility = "hidden";
        var anim = ghost.animate([
          { left: a.left + "px", top: a.top + "px", width: a.width + "px", height: a.height + "px", borderRadius: "24px", backgroundColor: "#dc143c" },
          { left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px", borderRadius: "20px", backgroundColor: getComputedStyle(card).backgroundColor }
        ], { duration: 560, easing: SPRING });
        anim.onfinish = function () { ghost.remove(); card.style.visibility = ""; };
      }
    }
    if (withExtra) { var x = extra.querySelector(".pub-opt"); if (x) { x.focus({ preventScroll: true, focusVisible: false }); setTimeout(function () { extra.scrollIntoView({ block: "nearest", behavior: reduce.matches ? "auto" : "smooth" }); }, 120); } }
    else manual.focus({ preventScroll: true, focusVisible: false });
  }
  function closeNew(fromPop) {
    if (el.hidden) return;
    el.hidden = true;
    document.documentElement.classList.remove("pub-new-on");
    if (!fromPop && history.state && history.state.pubNew) history.back();
    if (from) from.focus({ preventScroll: true });
  }
  window.ethNew = function () { openNew(null); };
  // the Add videos sheet first; the editor opens only with clips in it (the card grows into the editor once they are picked)
  function pickThen(b, open, title) {
    var go = function (files) {
      if (!files || !files.length) return;
      var run = function () { open(files); };
      if (window.ethMorph) window.ethMorph(b, window.ethScreenColor("app"), run); else run();
    };
    var ask = function () { if (window.EthAdd) window.EthAdd.open({ title: title || "Add videos", onFiles: go }); else go([]); };
    if (window.ethPress) window.ethPress(b, ask); else ask();
  }
  // the editor takes the place of New project / More in the history, so one Back goes home
  function intoEditor() { try { history.replaceState({ ethEditor: 1 }, ""); } catch (e) {} }
  window.addEventListener("popstate", function () {
    if (document.body.dataset.screen === "editor" && !(history.state && history.state.ethEditor) && window.vcFlow) window.vcFlow.home();
  });
  // the developer site: Auto clip asks for footage, then opens the AI chat with it; Templates opens the library
  function startAuto(b) {
    pickThen(b, function (files) { closeNew(true); intoEditor(); if (window.vcFlowAuto) window.vcFlowAuto(); if (window.vcFlowAdd) window.vcFlowAdd(files); }, "Add videos");
  }
  function startTemplates() { closeNew(true); intoEditor(); if (window.vcFlowShow) window.vcFlowShow("library"); }
  el.querySelectorAll("[data-live]").forEach(function (b) {
    b.addEventListener("click", function () { if (b.dataset.live === "auto") startAuto(b); else { var go = function () { startTemplates(); }; if (window.ethPress) window.ethPress(b, go); else go(); } });
  });
  document.querySelectorAll("[data-auto]").forEach(function (b) { b.addEventListener("click", function () { startAuto(b); }); });
  document.querySelectorAll("[data-nav-account]").forEach(function (b) {
    b.addEventListener("click", function () { if (window.vcAccount) window.vcAccount.openAccount(); });
    var paint = function () { var st = window.vcAccount && window.vcAccount.state ? window.vcAccount.state() : null; b.textContent = st && st.signedIn ? "Account" : "Sign in"; };
    var wait = setInterval(function () { if (window.vcAccount) { clearInterval(wait); paint(); if (window.vcAccount.onChange) window.vcAccount.onChange(paint); } }, 200);
    setTimeout(function () { clearInterval(wait); }, 10000);
  });
  window.addEventListener("popstate", function () {
    if (document.body.dataset.flow && !(history.state && history.state.ethEditor)) { if (window.vcFlowLeave) window.vcFlowLeave(); if (window.vcFlow) window.vcFlow.home(); }
  });
  // ethlenos.com/#new opens New project straight away (links in posts and bios)
  if (location.hash === "#new") setTimeout(function () { openNew(null); }, 0);

  // audit 2: on a phone the main action waits at the bottom once the page's own + has scrolled away
  var dock = document.createElement("div");
  dock.className = "pub-dock"; dock.hidden = true;
  dock.innerHTML = '<button class="pub-plus" type="button" data-new><span class="pub-plus-sq" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span><span class="pub-plus-tx"><b>Start a project</b><span>' + (PUB ? "Manual editing is open now" : "Auto clip, a template or by hand") + '</span></span></button>';
  var home = document.getElementById("screen-home");
  if (home) home.appendChild(dock);
  var seen = new Set();
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); }); dock.hidden = seen.size > 0 || document.body.dataset.screen !== "home"; }, { threshold: 0.2 });
    document.querySelectorAll(".pub-hero .pub-plus, .pub-end .pub-plus").forEach(function (b) { io.observe(b); });
  }
  document.querySelectorAll("[data-new]").forEach(function (b) { b.addEventListener("click", function () { var go = function () { openNew(b); }; if (window.ethPress) window.ethPress(b, go); else go(); }); });
  el.querySelector("[data-back]").addEventListener("click", function () { closeNew(); });
  // More: the extra tools slide in under Manual edit; the button becomes Less
  var CAP = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 13h4M13 13h4M7 16h7"/></svg>';
  var extra = el.querySelector("#pubExtra"), moreBtn = el.querySelector("[data-more-new]");
  function renderExtra() {
    var n = window.vcFlow && vcFlow.templateCount ? vcFlow.templateCount() : 0;
    extra.innerHTML =
      '<button class="pub-opt pub-opt-main" type="button" data-focus="captions"><span class="pub-opt-ic">' + CAP + '</span><span class="pub-opt-tx"><b>Captions</b><span>Add captions to a video</span></span><span class="pub-tag pub-tag-free">Free</span>' + I.chev + '</button>' +
      // the Template designer is still in development: the developer site only (admin 2026-11-26)
      (window.ETH_PUBLIC ? '' : '<button class="pub-opt pub-opt-main" type="button" data-focus="template"><span class="pub-opt-ic">' + I.tpl + '</span><span class="pub-opt-tx"><b>Template designer</b><span>Make a template people fill with their own footage</span></span>' + I.chev + '</button>') +
      (n ? '<button class="pub-opt pub-opt-main" type="button" data-mine><span class="pub-opt-ic">' + I.tpl + '</span><span class="pub-opt-tx"><b>Your templates</b><span>' + n + (n === 1 ? " template" : " templates") + '</span></span>' + I.chev + '</button>' : "");
    extra.querySelectorAll("[data-focus]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.dataset.focus, open = function (files) { closeNew(true); intoEditor(); if (window.vcFlow && vcFlow.openFocus) vcFlow.openFocus(k, files); window.ethBackTo = function () { openNew(null, true); }; };
        pickThen(b, open, k === "captions" ? "Add a video" : "Add clips");
      });
    });
    var mine = extra.querySelector("[data-mine]");
    if (mine) mine.addEventListener("click", function () { closeNew(); if (window.vcFlow && vcFlow.openTemplates) vcFlow.openTemplates(); });
  }
  function setExtra(open, still) {
    if (open) renderExtra();
    extra.hidden = !open;
    moreBtn.setAttribute("aria-expanded", String(open));
    moreBtn.querySelector(".pub-more-tx").textContent = open ? "Less" : "More";
    if (open && !still && !reduce.matches) extra.querySelectorAll(".pub-opt").forEach(function (c, i) {
      // each card grows out of the More button's row, a spring, one after another
      c.animate([{ transform: "translateY(-10px) scale(0.97)", opacity: 0.001 }, { transform: "none", opacity: 1 }], { duration: 380, delay: i * 50, easing: SPRING, fill: "backwards" });
    });
  }
  moreBtn.addEventListener("click", function () { var go = function () { setExtra(extra.hidden); }; if (window.ethPress) window.ethPress(moreBtn, go); else go(); });
  el.querySelector("[data-manual]").addEventListener("click", function () {
    // 0.99.0 (admin): clips first, then the editor, so it never opens on an empty gap
    var b = this, open = function (files) { closeNew(true); intoEditor(); if (window.vcStartWith) window.vcStartWith(files); else if (window.vcFlow) window.vcFlow.openEditor(); window.ethBackTo = function () { openNew(null); }; };
    return pickThen(b, open);
  });
  window.addEventListener("popstate", function () { closeNew(true); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !el.hidden) closeNew(); });

  // the + squares pop in once, on a spring with a small overshoot
  if (!reduce.matches) document.querySelectorAll(".pub-hero .pub-plus-sq").forEach(function (s) {
    // starts at 70%, never at nothing: a paused background tab must still show the button
    s.animate([{ transform: "scale(0.7)" }, { transform: "scale(1.06)", offset: 0.7 }, { transform: "scale(1)" }], { duration: 620, easing: "cubic-bezier(0.2, 0, 0, 1)" });
  });

  /* 0.99.1 (admin, decided with design-skills01 + Nielsen's heuristics): the home page More opens New project
     with the extra tools already shown. One place to start anything (consistency, recognition over recall,
     Apple's single hierarchy with progressive disclosure), no second page that lists the same things. */
  window.ethMore = function () { openNew(null, true); };
  document.querySelectorAll("[data-more]").forEach(function (b) { b.addEventListener("click", function () { var go = function () { openNew(b, true); }; if (window.ethPress) window.ethPress(b, go); else go(); }); });
  if (location.hash === "#more") setTimeout(function () { openNew(null, true); }, 0);
})();
