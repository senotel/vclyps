/* Ethlenos menu (0.95.0). The landing's Menu button: every place in the app, grouped like an
   iOS list. A popover under the button on a computer, a sheet from the bottom on a phone.
   It morphs out of the button (one shape, a spring, no fade-in of its own) and goes back into it.
   Rows only show what this page really has: the public site has no account rows. */
(function () {
  "use strict";
  var btn = document.querySelector("[data-menu]");
  if (!btn) return;
  var $ = function (id) { return document.getElementById(id); };
  var click = function (id) { return function () { var b = $(id); if (b) b.click(); }; };
  var PLUS = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
  var CHEV = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

  function home() { var h = $("screen-home"); if (window.vcFlow && document.body.dataset.screen !== "home") window.vcFlow.home(); if (window.vcLandingShow) window.vcLandingShow.navigate(false); if (h) h.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  function show() {
    var s = $("lpShow"); if (!s) return;
    if (window.vcLandingShow) window.vcLandingShow.navigate(true);
    // the landing scrolls inside #screen-home on most screens, the page itself on others: scroll whichever moves
    var h = $("screen-home"), box = h && h.scrollHeight > h.clientHeight + 4 ? h : null;
    var top = box ? box.scrollTop + s.getBoundingClientRect().top - box.getBoundingClientRect().top : window.scrollY + s.getBoundingClientRect().top;
    var go = function (how) { if (box) box.scrollTo({ top: top, behavior: how }); else window.scrollTo({ top: top, behavior: how }); };
    go(matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
    // some phones drop a smooth scroll that starts while the menu closes: land it for sure
    setTimeout(function () { var now = box ? box.scrollTop : window.scrollY; if (now < top - 40) go("auto"); }, 650);
  }
  function newProject() {
    if (typeof window.ethNew === "function") return window.ethNew();
    if (typeof window.vcFlowShow === "function") return window.vcFlowShow("start");
    if (typeof window.vcBegin === "function") return window.vcBegin();
  }
  function editor() { if (window.vcFlow) window.vcFlow.openEditor(); }
  function link(sel, fallback) { var a = document.querySelector(sel); return a ? a.getAttribute("href") : fallback; }

  function groups() {
    var acc = window.vcAccount, signed = false;
    try { signed = !!(acc && acc.state().signedIn); } catch (e) {}
    var g = [
      { rows: [["New project", newProject, "feat"]] },
      { rows: [["Home", home], $("lpShow") ? ["See it edit", show] : null] },
      { rows: [["Editor", editor], $("libraryBtn") ? ["Library", click("libraryBtn")] : null] },
      { rows: [acc ? [signed ? "Account" : "Sign in", function () { acc.openAccount(); }] : null,
               acc ? ["Plans", function () { acc.openPlans(); }] : null,
               $("settingsBtn") ? ["Settings", click("settingsBtn")] : null] },
      { rows: [["Privacy", link('.lp-foot a[href*="rivacy"]', "privacy.html")], ["Terms", link('.lp-foot a[href*="erms"]', "terms.html")]] }
    ];
    return g.map(function (x) { return x.rows.filter(Boolean); }).filter(function (r) { return r.length; });
  }

  var panel = document.createElement("div");
  panel.className = "eth-menu"; panel.id = "ethMenu"; panel.hidden = true;
  panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "Menu");
  var scrim = document.createElement("div"); scrim.className = "eth-menu-scrim"; scrim.hidden = true;
  document.body.appendChild(scrim); document.body.appendChild(panel);
  btn.setAttribute("aria-controls", "ethMenu");

  var reduce = matchMedia("(prefers-reduced-motion: reduce)");
  var phone = { matches: false };   // 0.95.1: one look everywhere, the floating card
  var SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";   // the iOS sheet curve: fast out, no bounce

  function render() {
    panel.innerHTML = (phone.matches ? '<div class="eth-menu-grab" aria-hidden="true"></div><div class="eth-menu-head"><b>Menu</b><button type="button" class="eth-menu-close" data-close>Done</button></div>' : "") +
      groups().map(function (rows) {
        return '<ul class="eth-menu-group">' + rows.map(function (r, i) {
          return typeof r[1] === "string"
            ? '<li><a class="eth-menu-row" href="' + r[1] + '">' + r[0] + CHEV + "</a></li>"
            : r[2] === "feat"
              ? '<li><button class="eth-menu-row eth-menu-feat" type="button" data-i="' + i + '"><span class="eth-feat-sq" aria-hidden="true">' + PLUS + '</span><span class="eth-feat-tx"><b>' + r[0] + '</b><span>Start editing now</span></span>' + CHEV + '</button></li>'
              : '<li><button class="eth-menu-row" type="button" data-i="' + i + '">' + r[0] + CHEV + "</button></li>";
        }).join("") + "</ul>";
      }).join("");
    var gs = groups();
    panel.querySelectorAll(".eth-menu-group").forEach(function (ul, gi) {
      ul.querySelectorAll("button[data-i]").forEach(function (b) {
        b.addEventListener("click", function () { var fn = gs[gi][+b.dataset.i][1]; var run = function () { close(true); setTimeout(fn, 0); }; if (window.ethPress) window.ethPress(b, run); else run(); });
      });
    });
    var c = panel.querySelector("[data-close]"); if (c) c.addEventListener("click", function () { close(); });
  }

  function place() {
    var r = btn.getBoundingClientRect();
    panel.style.top = Math.round(r.bottom + 8) + "px";
    panel.style.right = Math.max(12, Math.round(window.innerWidth - r.right)) + "px";
  }

  var open = false;
  function openMenu() {
    if (open) return; open = true;
    render(); place();
    panel.classList.toggle("is-sheet", phone.matches);
    panel.hidden = false; scrim.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (!reduce.matches) {
      if (phone.matches) panel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 420, easing: SPRING });
      else {
        // grows out of the button: same corner, its size first, then the list
        var b = btn.getBoundingClientRect(), p = panel.getBoundingClientRect();
        panel.animate([{ clipPath: "inset(0 0 " + (p.height - b.height) + "px " + (p.width - b.width) + "px round 6px)" }, { clipPath: "inset(0 0 0 0 round 14px)" }], { duration: 380, easing: SPRING });
      }
      scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
    }
    var first = panel.querySelector(".eth-menu-row"); if (first) first.focus({ preventScroll: true });
  }
  function close(silent) {
    if (!open) return; open = false;
    btn.setAttribute("aria-expanded", "false");
    var done = function () { panel.hidden = true; scrim.hidden = true; };
    if (reduce.matches || silent) done();
    else {
      var a = phone.matches ? panel.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 260, easing: SPRING })
        : panel.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.96)" }], { duration: 160, easing: SPRING });
      scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200 });
      a.onfinish = done;
    }
    if (!silent) btn.focus({ preventScroll: true });
  }
  window.ethMenuClose = close;

  btn.addEventListener("click", function () { open ? close() : openMenu(); });
  scrim.addEventListener("click", function () { close(); });
  document.addEventListener("keydown", function (e) { if (open && e.key === "Escape") close(); });
  // phones resize while the address bar slides; only a real width change closes it
  var lastW = window.innerWidth;
  window.addEventListener("resize", function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; if (open) close(true); } else if (open) place(); });
})();
