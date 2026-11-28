/* Ethlenos: device budget (0.102.9)
   How much this phone or computer can take right now, so background work (the captions model download)
   never makes the app lag. Two parts:
     - what the device is: processor cores, memory, the network (Wi-Fi or mobile data, data saver), battery;
     - what it is doing now: a finger on the screen or scrolling in the last 2 s, a slow frame in the last
       5 s, the page hidden.
   It never runs a loop of its own: it listens to events the browser sends anyway.
   window.ethBudget = { tier, unmetered(), busy(), rate(), whenCalm() } */
(function () {
  "use strict";
  var nav = navigator, conn = nav.connection || nav.mozConnection || nav.webkitConnection || null;
  var cores = nav.hardwareConcurrency || 4, memory = nav.deviceMemory || 4;
  var phone = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  // high: a recent flagship or a computer; low: 4 cores or 3 GB and under
  var tier = cores >= 8 && memory >= 6 ? "high" : cores > 4 && memory > 3 ? "mid" : "low";

  var lastInput = -1e9, slow = [], battery = null;
  ["pointerdown", "pointermove", "touchstart", "touchmove", "wheel", "keydown", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, function () { lastInput = performance.now(); }, { passive: true, capture: true });
  });
  try {
    new PerformanceObserver(function (l) { l.getEntries().forEach(function () { slow.push(performance.now()); }); })
      .observe({ type: "long-animation-frame", buffered: false });
  } catch (e) {
    try { new PerformanceObserver(function (l) { l.getEntries().forEach(function () { slow.push(performance.now()); }); }).observe({ type: "longtask" }); } catch (e2) {}
  }
  if (nav.getBattery) nav.getBattery().then(function (b) { battery = b; }).catch(function () {});

  // Wi-Fi or a cable, never mobile data or data saver. A phone that does not say is treated as mobile data.
  function unmetered() {
    if (conn && conn.saveData) return false;
    var t = conn && conn.type;
    if (t) return t === "wifi" || t === "ethernet" || t === "wimax";
    return !phone;
  }
  function lowBattery() { return !!(battery && !battery.charging && battery.level < 0.2); }
  function busy() {
    var now = performance.now();
    while (slow.length && now - slow[0] > 5000) slow.shift();
    return document.hidden || now - lastInput < 2000 || slow.length > 0 || lowBattery();
  }
  // bytes a second a background download may use: a share of the line, less on a smaller device
  function rate() {
    var base = tier === "high" ? 4e6 : tier === "mid" ? 2e6 : 0.8e6;
    // Chrome rounds the line speed it reports and caps it at 10 Mbit/s, so a reading near the cap means "fast"
    var dl = conn && conn.downlink;
    var down = dl && dl < 9.5 ? dl * 125000 * 0.6 : base;
    return Math.max(150e3, Math.min(base, down));
  }
  // resolves when nothing is happening (checked every 0.7 s by a timer, never a frame loop)
  function whenCalm() {
    return new Promise(function (res) {
      (function check() { if (!busy()) res(); else setTimeout(check, 700); })();
    });
  }
  window.ethBudget = { tier: tier, cores: cores, memory: memory, phone: phone, unmetered: unmetered, busy: busy, rate: rate, whenCalm: whenCalm };
})();
