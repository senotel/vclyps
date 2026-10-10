/* vClyps — THE CUT. Native scroll choreographs the film world and typography.
   The renderer is isolated in landing-world.js. Navigation is visually wrapped
   at the event boundary; the original app handlers still execute exactly once.
   No media, editing state, AI, playback or export logic is touched here. */
(function () {
  "use strict";
  var home = document.getElementById("screen-home");
  if (!home) return;
  var root = home.querySelector(".lp-root");
  var hero = home.querySelector(".lp-hero");
  // Everything below assumes these two. Bail rather than throw on every
  // scroll: a landing that is merely static still reads, one whose script
  // died half way does not.
  if (!root || !hero) return;
  var contact = document.getElementById("lpContact");
  var workspace = document.getElementById("lpWorkspace");
  var progress = document.getElementById("lpProgress");
  var skip = document.getElementById("lpSkip");
  var plus = document.getElementById("lpPlus");
  var marker = document.getElementById("lpMarker");
  var steps = Array.from(home.querySelectorAll(".lp-step"));
  var scenes = Array.from(home.querySelectorAll(".lp-scene"));
  var reveals = Array.from(home.querySelectorAll(".lp-reveal"));
  var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");
  var small = window.matchMedia("(max-width: 700px)");
  var reduced = motion.matches;
  var raf = 0, introTimer = 0, intro = false, phase = -1;
  var pointerX = 0, pointerY = 0;
  var metrics = null, needsMeasure = true;
  var world = null, wordBlocks = [], curtain = null;

  function startWorld() {
    if (world || reduced || !window.VevrisLandingWorld) return;
    world = window.VevrisLandingWorld.create(document.getElementById("lpWorld"), function (ready) {
      root.classList.toggle("lp-webgl-ready", ready);
    });
  }

  // Split text nodes, not innerHTML. Every character and space survives,
  // including the existing emphasis, and screen readers read the original order.
  function prepareWords() {
    // The triad is handed to the odometer in experience.js instead — a per-letter
    // reel needs to own its own characters, and word masks would fight it.
    home.querySelectorAll(".lp-h2, .lp-body, .lp-step-name").forEach(function (block) {
      var walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      var nodes = [], node;
      while ((node = walker.nextNode())) nodes.push(node);
      var words = [];
      nodes.forEach(function (text) {
        var fragment = document.createDocumentFragment();
        text.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { fragment.appendChild(document.createTextNode(part)); return; }
          var mask = document.createElement("span"), ink = document.createElement("span");
          mask.className = "lp-word"; ink.className = "lp-word-ink";
          ink.textContent = part; mask.appendChild(ink); fragment.appendChild(mask); words.push(mask);
        });
        text.replaceWith(fragment);
      });
      words.forEach(function (word, i) { word.style.setProperty("--word", String(i / Math.max(1, words.length - 1))); });
      block.classList.add("lp-typeset"); wordBlocks.push(block);
    });
    root.classList.add("lp-choreography");
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function active() {
    return document.body.dataset.screen === "home" && !document.hidden;
  }

  function finishIntro() {
    intro = false;
    clearTimeout(introTimer);
    root.classList.remove("lp-intro");
    if (skip) {
      // A keyboard user must not lose focus when the short intro finishes.
      var hadFocus = document.activeElement === skip;
      skip.hidden = true;
      if (hadFocus && plus) plus.focus({ preventScroll: true });
    }
  }

  function measure() {
    var walkEl = document.getElementById("lpWalk");
    var y = home.scrollTop;
    var top = home.getBoundingClientRect().top;
    var stage = workspace ? workspace.querySelector(".lp-workspace-tracks") : null;
    metrics = {
      height: home.clientHeight || window.innerHeight,
      hero: hero.offsetHeight,
      max: Math.max(1, home.scrollHeight - home.clientHeight),
      track: stage ? Math.max(0, stage.clientWidth - 25) : 0,
      // Guarded on lpWalk itself, not on workspace — they are different
      // elements, and measure() runs on every scroll and resize, so a throw
      // here freezes the whole page.
      walk: walkEl ? walkEl.offsetTop : 0,
      steps: steps.map(function (step) {
        return {
          top: step.getBoundingClientRect().top - top + y,
          height: step.offsetHeight,
          local: step.offsetTop
        };
      }),
      words: wordBlocks.map(function (block) {
        return { el: block, top: block.getBoundingClientRect().top - top + y, height: block.offsetHeight };
      })
    };
    needsMeasure = false;
  }

  function setPhase(i) {
    if (i === phase) return;
    phase = i;
    steps.forEach(function (step, n) { step.classList.toggle("is-active", n === i); });
    scenes.forEach(function (scene, n) {
      scene.classList.toggle("is-active", n === i);
      scene.setAttribute("aria-hidden", n === i ? "false" : "true");
    });
    if (workspace) workspace.dataset.phase = String(i);
  }

  function render() {
    raf = 0;
    if (!active()) return;
    if (needsMeasure || !metrics) measure();
    var y = home.scrollTop;
    var assembly = clamp(y / (metrics.hero * .64), 0, 1);
    root.style.setProperty("--hero-leave", reduced ? "0" : clamp(y / metrics.hero, 0, 1).toFixed(4));
    if (world) world.update({
      scroll: clamp(y / (metrics.hero * .8), 0, 1.7), reduced: reduced,
      visible: active() && (y < metrics.hero + 80 || y + metrics.height > metrics.walk)
    });
    if (intro && y > 8) finishIntro();
    if (progress) progress.style.transform = "scaleX(" + clamp(y / metrics.max, 0, 1).toFixed(4) + ")";
    if (contact) {
      contact.style.setProperty("--assembly", reduced ? "1" : assembly.toFixed(4));
      contact.style.setProperty("--parallax-x", reduced ? "0px" : pointerX.toFixed(2) + "px");
      contact.style.setProperty("--parallax-y", reduced ? "0px" : pointerY.toFixed(2) + "px");
    }
    metrics.words.forEach(function (block) {
      // Reading moves through each line like a playhead. Headings are masked;
      // body text starts readable and gains contrast as the playhead reaches it.
      var mobileStep = small.matches && block.el.classList.contains("lp-step-name");
      var reach = metrics.height * (mobileStep ? .85 : .9);
      var travel = metrics.height * (mobileStep ? .23 : .43);
      var p = reduced ? 1 : clamp((y + reach - block.top) / travel, 0, 1);
      block.el.style.setProperty("--reveal", p.toFixed(4));
    });
    root.style.setProperty("--story-open", clamp((y + metrics.height - metrics.hero) / (metrics.height * .7), 0, 1).toFixed(4));

    if (!steps.length) return;
    // On mobile the demonstration occupies the upper viewport. Judge the active
    // text in the reading area BELOW it, not behind the sticky demonstration.
    var focus = y + metrics.height * (small.matches ? .72 : .5);
    var nearest = 0, distance = Infinity;
    metrics.steps.forEach(function (step, i) {
      var d = Math.abs(step.top + step.height / 2 - focus);
      if (d < distance) { distance = d; nearest = i; }
    });
    setPhase(nearest);
    var selected = metrics.steps[nearest];
    if (marker && selected) {
      marker.style.height = selected.height + "px";
      marker.style.transform = "translateY(" + selected.local + "px)";
    }
    if (workspace) {
      var start = metrics.steps[0].top;
      var last = metrics.steps[metrics.steps.length - 1];
      var end = last.top + last.height;
      var p = clamp((focus - start) / Math.max(1, end - start), 0, 1);
      workspace.style.setProperty("--demo-time", ((reduced ? nearest / 3 : p) * metrics.track).toFixed(1) + "px");
      workspace.style.setProperty("--walk-in", reduced ? "1" : clamp((y + metrics.height - metrics.walk) / (metrics.height * .65), 0, 1).toFixed(3));
      workspace.style.setProperty("--scan", reduced ? "1" : clamp((focus - selected.top) / Math.max(1, selected.height), .08, 1).toFixed(3));
    }
  }

  function schedule() {
    if (!raf && active()) raf = requestAnimationFrame(render);
  }
  function resized() { needsMeasure = true; if (world) world.resize(); schedule(); }
  home.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", resized, { passive: true });

  // Pointer depth is a small direct response, never an autonomous animation.
  hero.addEventListener("pointermove", function (event) {
    if (reduced || !fine.matches || small.matches || !active()) return;
    var box = hero.getBoundingClientRect();
    pointerX = clamp((event.clientX - box.left) / box.width - .5, -.5, .5) * 9;
    pointerY = clamp((event.clientY - box.top) / box.height - .5, -.5, .5) * 7;
    schedule();
  }, { passive: true });
  hero.addEventListener("pointerleave", function () { pointerX = pointerY = 0; schedule(); });
  home.addEventListener("pointermove", function (event) {
    if (reduced || !fine.matches || !active() || !world) return;
    world.pointer(event.clientX / innerWidth, event.clientY / innerHeight, 1);
  }, { passive: true });
  home.addEventListener("pointerleave", function () { if (world) world.pointer(.5, .5, 0); });
  home.addEventListener("pointerdown", function (event) {
    if (world && !reduced && !event.target.closest("button, a, input, textarea")) world.pulse();
  }, { passive: true });

  // Content is visible without JS or IntersectionObserver. Enhancement only
  // applies once an observer exists, and each text is revealed just once.
  if ("IntersectionObserver" in window && !reduced) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("lp-in");
          revealObserver.unobserve(entry.target);
        }
      });
    }, { root: home, threshold: .08, rootMargin: "0px 0px -4% 0px" });
    root.classList.add("lp-enhanced");
    reveals.forEach(function (el) { revealObserver.observe(el); });
  }

  function motionChanged() {
    reduced = motion.matches;
    if (reduced) {
      finishIntro();
      reveals.forEach(function (el) { el.classList.add("lp-in"); });
      pointerX = pointerY = 0;
      if (curtain) curtain.finish();
    } else {
      startWorld();
    }
    resized();
  }
  if (motion.addEventListener) motion.addEventListener("change", motionChanged);
  if (small.addEventListener) small.addEventListener("change", resized);
  if ("ResizeObserver" in window) {
    var sizeObserver = new ResizeObserver(resized);
    sizeObserver.observe(home);
    // observe(null) throws, and this runs at load — it would take the rest
    // of the setup with it.
    var storyEl = document.getElementById("lpStory");
    if (storyEl) sizeObserver.observe(storyEl);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resized);

  function screenChanged() {
    if (!active()) {
      finishIntro();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      pointerX = pointerY = 0;
      if (world) world.update({visible:false});
      if (document.hidden && curtain) curtain.finish();
    } else {
      resized();
    }
  }
  // Returning from Modes, or from the editor via its existing logo, must
  // resume the composition. No RAF runs while the editor is on screen.
  new MutationObserver(screenChanged).observe(document.body, {
    attributes: true, attributeFilter: ["data-screen"]
  });
  document.addEventListener("visibilitychange", screenChanged);
  window.addEventListener("pageshow", resized);

  if (skip) skip.addEventListener("click", finishIntro);
  if (plus) {
    plus.title = plus.getAttribute("aria-label");
    plus.addEventListener("pointermove", function (event) {
      if (reduced || !fine.matches) return;
      var box = plus.parentElement.getBoundingClientRect();
      var x = (event.clientX - box.left - box.width / 2) * .09;
      var y = (event.clientY - box.top - box.height / 2) * .12;
      plus.style.transform = "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px,0)";
    }, {passive:true});
    plus.addEventListener("pointerleave", function () { plus.style.transform = ""; });
    plus.addEventListener("click", function () {
      finishIntro();
      if (typeof window.vcBegin === "function") window.vcBegin();
      else if (typeof window.vcEnterEditor === "function") window.vcEnterEditor();
    });
  }

  // Navigation-only shutter. app.js remains the owner of page changes.
  // Capture a navigation click, cover the screen, forward that exact control's
  // click once, then uncover. Rapid clicks, rejected animations, reduced motion
  // and backgrounding all resolve through the same idempotent cleanup path.
  function installTransitions() {
    var overlay = document.createElement("div");
    overlay.className = "vc-transition"; overlay.setAttribute("aria-hidden", "true");
    var blades = [];
    for (var i = 0; i < 5; i++) {
      var blade = document.createElement("i"); blade.className = "vc-transition-blade";
      blade.style.left = i * 20 + "%"; overlay.appendChild(blade); blades.push(blade);
    }
    var mark = document.createElement("img"); mark.src = "logo.png"; mark.alt = "";
    mark.className = "vc-transition-mark"; overlay.appendChild(mark); document.body.appendChild(overlay);
    var busy = false, forwarding = false, switched = false, action = null, animations = [], fallback = 0, run = 0;
    function commit() {
      if (switched || !action) return;
      switched = true; forwarding = true;
      try { action(); } finally { forwarding = false; }
    }
    function clean() {
      run++;
      clearTimeout(fallback);
      animations.forEach(function (a) { a.cancel(); }); animations = [];
      overlay.classList.remove("is-active"); busy = false; action = null;
    }
    function finish() { if (!busy) return; try { commit(); } finally { clean(); } }
    function animate(el, frames, options) {
      var a = el.animate(frames, options); animations.push(a);
      return a.finished.catch(function () {});
    }
    document.addEventListener("click", function (event) {
      if (forwarding || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var control = event.target.closest && event.target.closest("#lpPlus, .mode-card, #backBtn, #logoHome");
      if (!control) return;
      if (busy) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (reduced || !overlay.animate || document.hidden) return;
      event.preventDefault(); event.stopImmediatePropagation();
      finishIntro(); busy = true; switched = false;
      var token = ++run;
      var keyboard = event.detail === 0;
      action = function () {
        control.click();
        if (keyboard) {
          var screen = document.body.dataset.screen;
          var focus = screen === "home" ? plus : screen === "modes" ? document.querySelector(".mode-card") : document.getElementById("backBtn");
          if (focus) focus.focus({preventScroll:true});
        }
      };
      overlay.classList.add("is-active");
      // A wall-clock escape hatch is independent of Animation.finished.
      fallback = setTimeout(finish, 1600);
      try {
        animate(mark, [{opacity:0,transform:"translate(-50%,-50%) scale(.7)"},{opacity:1,transform:"translate(-50%,-50%) scale(1)"}], {duration:330,delay:160,fill:"both",easing:"cubic-bezier(.22,1,.36,1)"});
        Promise.all(blades.map(function (blade, n) {
          return animate(blade, [{transform:"translateY(" + (n % 2 ? "-101%" : "101%") + ")"},{transform:"translateY(0)"}], {duration:380,delay:n*24,fill:"both",easing:"cubic-bezier(.76,0,.24,1)"});
        })).then(function () {
          if (!busy || token !== run) return;
          commit();
          animate(mark, [{opacity:1},{opacity:0}], {duration:180,fill:"forwards"});
          return Promise.all(blades.map(function (blade, n) {
            return animate(blade, [{transform:"translateY(0)"},{transform:"translateY(" + (n % 2 ? "101%" : "-101%") + ")"}], {duration:380,delay:(4-n)*24,fill:"forwards",easing:"cubic-bezier(.76,0,.24,1)"});
          }));
        }).then(function () { if (busy && token === run) clean(); }).catch(function () { if (token === run) finish(); });
      } catch (_) { finish(); }
    }, true);
    return {finish:finish};
  }

  prepareWords();
  startWorld();
  curtain = installTransitions();

  setPhase(0);
  if (!reduced && !window.vcHasSession && active() && home.scrollTop < 8) {
    intro = true;
    root.classList.add("lp-intro");
    introTimer = setTimeout(finishIntro, 1350);
  } else {
    finishIntro();
  }
  schedule();
})();
