/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — atmosphere
   The editing app by Vevris.

   Two small touches that nothing else owns: film grain over the whole page,
   and a "+" that leans toward the pointer. Everything else this file used to
   do has been handed over.

   ── WHAT WAS REMOVED, AND WHY IT MATTERS ───────────────────────────────────
   This file once also drew a 2D sprocket lattice, split headings into words,
   and ran the screen transition. landing.js + landing-world.js now do all
   three, better:

     the background   a real WebGL film ribbon with perspective, thickness and
                      lighting, that unspools into a timeline as you scroll —
                      against which a flat canvas lattice was no contest
     the typography   per-word reveals driven by SCROLL POSITION, with rotation,
                      rather than a fixed stagger of transition delays
     the transition   a five-blade shutter carrying the mark, with a wall-clock
                      escape hatch and keyboard focus handling

   Keeping both sets running was not a stylistic duplication, it was a bug:
   this file loads LAST, so its word splitter re-split headings that landing.js
   had already typeset and destroyed the choreography, and a single click would
   have played two different transitions back to back. Deleting the overlap was
   the fix.

   If a future version wants the lattice back, it is in the project history —
   but it should replace the ribbon rather than sit behind it.
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var home = document.getElementById("screen-home");
  if (!home) return;
  var root = home.querySelector(".lp-root");
  if (!root) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia("(hover: hover) and (pointer: fine)");

  /* ═══════════════ GRAIN ═══════════════

     One noise tile, generated once and repeated by CSS, nudged in steps.
     Per-frame pixel noise across a full viewport is one of the most expensive
     things a page can do, and at 3.5% opacity nobody alive can tell it from a
     64px tile being moved around. Stepped rather than eased, because grain
     jumps frame to frame — it does not slide. */
  (function grain() {
    var n = 64;
    var g = document.createElement("canvas");
    g.width = g.height = n;
    var gx = g.getContext("2d");
    if (!gx) return;
    var img = gx.createImageData(n, n);
    var s = 0x9e3779b9;
    for (var i = 0; i < img.data.length; i += 4) {
      s = (s * 1664525 + 1013904223) >>> 0;
      var v = 128 + ((s >>> 24) - 128) * 0.55;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    gx.putImageData(img, 0, 0);
    var el = document.createElement("div");
    el.className = "lp-grain";
    el.setAttribute("aria-hidden", "true");
    try { el.style.backgroundImage = "url(" + g.toDataURL("image/png") + ")"; } catch (e) { return; }
    root.insertBefore(el, root.firstChild);
  })();

  /* ═══════════════ MAGNETISM ═══════════════

     The "+" leans toward the pointer as it comes near and springs back when it
     leaves. It is the only control on the page, so it is the one thing allowed
     to reach out — and the ring tightening first announces the pull before it
     is felt, which is what stops it feeling like a glitch.

     Coarse pointers get nothing: there is no cursor to lean toward. */
  (function magnetic() {
    var magnet = document.getElementById("lpMagnet");
    var plus = document.getElementById("lpPlus");
    if (!magnet || !plus || !fine.matches || reduced) return;

    var mx = 0, my = 0, tx = 0, ty = 0, raf = 0;
    var PULL = 118;

    function loop() {
      raf = 0;
      mx += (tx - mx) * 0.14;
      my += (ty - my) * 0.14;
      plus.style.transform = "translate3d(" + mx.toFixed(2) + "px," + my.toFixed(2) + "px,0)";
      /* Stop as soon as it has arrived — an animation frame loop that never
         ends is a battery bug wearing a nice coat. */
      if (Math.abs(tx - mx) > 0.1 || Math.abs(ty - my) > 0.1) raf = requestAnimationFrame(loop);
    }

    window.addEventListener("pointermove", function (e) {
      var r = magnet.getBoundingClientRect();
      var dx = e.clientX - (r.left + r.width / 2);
      var dy = e.clientY - (r.top + r.height / 2);
      if (Math.sqrt(dx * dx + dy * dy) < PULL) {
        tx = dx * 0.32;
        ty = dy * 0.32;
        magnet.classList.add("is-near");
      } else {
        tx = ty = 0;
        magnet.classList.remove("is-near");
      }
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
  })();

  /* ═══════════════ THE ODOMETER ═══════════════

     Every letter of the triad is a reel that starts at the top of the alphabet
     and spins down to the character it is meant to be — an age picker coming
     to rest. The line resolves left to right, so "One upload." assembles like
     a counter settling rather than a block of text fading up.

     ── HOW THE LAYOUT HOLDS STILL ─────────────────────────────────────────
     The hard part is not the spin, it is making the line occupy exactly the
     space it will occupy when it stops, before it has stopped. Otherwise the
     row reflows for a second and everything beside it twitches.

     So each reel contains TWO things: an invisible copy of the final character
     that sits in normal flow and gives the reel its width and its baseline,
     and the spinning strip, absolutely positioned on top of it. The strip's
     last item is that same character, and because the item boxes share the
     reel's line-height, landing on the last item puts the glyph exactly where
     the invisible copy already is. Nothing moves when the reel stops.

     Wide letters passing through are centred and clipped by the reel — at the
     speed they travel that reads as motion, and the only glyph that has to be
     perfect is the one it lands on. */
  (function odometer() {
    var triad = document.querySelectorAll(".lp-triad > span");
    if (!triad.length) return;

    var UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    var LOWER = "abcdefghijklmnopqrstuvwxyz";

    Array.prototype.forEach.call(triad, function (line) {
      var text = line.textContent;
      /* The reels are decoration; the sentence stays readable to assistive
         tech as one label rather than as a column of stray letters. */
      line.setAttribute("aria-label", text.trim());
      line.textContent = "";

      var cell = 0;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        var set = UPPER.indexOf(ch) >= 0 ? UPPER : (LOWER.indexOf(ch) >= 0 ? LOWER : null);

        if (!set) {
          /* Spaces and full stops have nowhere to travel from. They are simply
             there — punctuation that spun would look like a mistake. */
          var plain = document.createElement("span");
          plain.className = "lp-fixed";
          plain.setAttribute("aria-hidden", "true");
          plain.textContent = ch;
          line.appendChild(plain);
          continue;
        }

        var stop = set.indexOf(ch);
        var reel = document.createElement("span");
        reel.className = "lp-reel";
        reel.setAttribute("aria-hidden", "true");
        reel.style.setProperty("--n", String(stop));
        /* Later letters start later and take slightly longer, so the line
           settles as a sweep instead of all at once. */
        reel.style.setProperty("--d", (cell * 52) + "ms");
        reel.style.setProperty("--t", (760 + cell * 26) + "ms");

        var size = document.createElement("span");
        size.className = "lp-reel-size";
        size.textContent = ch;

        var strip = document.createElement("span");
        strip.className = "lp-reel-strip";
        for (var k = 0; k <= stop; k++) {
          var g = document.createElement("i");
          g.textContent = set[k];
          strip.appendChild(g);
        }

        reel.appendChild(size);
        reel.appendChild(strip);
        line.appendChild(reel);
        cell++;
      }
    });

    /* Spun once, when the row arrives. Re-spinning on every pass would turn a
       flourish into a fidget.

       Driven by the scroll position rather than an IntersectionObserver, and
       that is deliberate: IO delivers its callbacks during the browser's
       render step, so anywhere frames are not being produced it simply never
       fires and the letters sit on "a" forever. A scroll listener is the same
       few lines, is exercised by the same event that brings the row into view,
       and can be verified. It unhooks itself the moment all three have spun,
       so it costs nothing afterwards. */
    var pending = Array.prototype.slice.call(triad);

    function spinVisible() {
      var fold = home.clientHeight * 0.86;
      for (var i = pending.length - 1; i >= 0; i--) {
        var box = pending[i].getBoundingClientRect();
        if (box.top < fold && box.bottom > 0) {
          pending[i].classList.add("is-spun");
          pending.splice(i, 1);
        }
      }
      if (!pending.length) {
        home.removeEventListener("scroll", spinVisible);
        window.removeEventListener("resize", spinVisible);
      }
    }

    if (reduced) {
      Array.prototype.forEach.call(triad, function (l) { l.classList.add("is-spun"); });
      return;
    }
    home.addEventListener("scroll", spinVisible, { passive: true });
    window.addEventListener("resize", spinVisible, { passive: true });
    spinVisible();
  })();
})();
