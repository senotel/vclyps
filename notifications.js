/* Shared in-app notices and opt-in device notifications. No tracking or push server. */
(function () {
  "use strict";
  const controllers = new Map();
  const KEY = "vclyps-notify";
  const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return false; } };
  const write = (on) => { try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (_) {} };
  const permitted = () => "Notification" in window && Notification.permission === "granted";
  let registrationPromise;

  function registration() {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null);
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register("notification-sw.js", { scope: "./", updateViaCache: "none" })
        .then((reg) => {
          if (reg.active) return reg;
          return new Promise((resolve) => {
            const worker = reg.installing || reg.waiting;
            if (!worker) { resolve(null); return; }
            const timer = setTimeout(() => { worker.removeEventListener("statechange", changed); resolve(null); }, 8000);
            function changed() {
              if (worker.state === "activated" || worker.state === "redundant") {
                clearTimeout(timer);
                worker.removeEventListener("statechange", changed);
                resolve(worker.state === "activated" ? reg : null);
              }
            }
            worker.addEventListener("statechange", changed);
            changed();
          });
        })
        .catch(() => null)
        .then((reg) => { if (!reg) registrationPromise = null; return reg; });
    }
    return registrationPromise;
  }

  function controller(id) {
    if (controllers.has(id)) return controllers.get(id);
    const el = document.getElementById(id);
    if (!el) return null;
    let timer, remaining = 0, started = 0, drag = null, returnFocus = null;
    const pause = () => {
      clearTimeout(timer);
      if (started) remaining = Math.max(0, remaining - (performance.now() - started));
      started = 0;
    };
    const resume = () => {
      if (!el.classList.contains("on") || document.hidden || el.matches(":hover") || el.contains(document.activeElement) || drag) return;
      if (started) return;
      if (remaining <= 0) { dismiss(); return; }
      if (remaining > 0) { started = performance.now(); timer = setTimeout(dismiss, remaining); }
    };
    function resetDrag() {
      drag = null;
      el.classList.remove("dragging");
      el.style.removeProperty("--swipe-x");
      el.style.removeProperty("--swipe-y");
      el.style.removeProperty("--swipe-opacity");
    }
    function dismiss() {
      pause();
      const focused = el.contains(document.activeElement);
      el.classList.remove("on");
      el.inert = true;
      el.setAttribute("aria-hidden", "true");
      resetDrag();
      if (focused && returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    }
    el.querySelector(".notice-close").addEventListener("click", dismiss);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); dismiss(); }
    });
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", () => setTimeout(resume, 0));
    el.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || e.button !== 0 || e.target.closest("button, a")) return;
      pause();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      drag.dx = e.clientX - drag.x;
      drag.dy = Math.min(0, e.clientY - drag.y);
      el.style.setProperty("--swipe-x", drag.dx + "px");
      el.style.setProperty("--swipe-y", drag.dy + "px");
      el.style.setProperty("--swipe-opacity", String(Math.max(0.2, 1 - Math.max(Math.abs(drag.dx), -drag.dy) / 240)));
    });
    el.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const away = Math.abs(drag.dx) > Math.min(90, el.clientWidth * 0.25) || drag.dy < -55;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (away) dismiss(); else { resetDrag(); resume(); }
    });
    el.addEventListener("pointercancel", () => { resetDrag(); resume(); });
    el.addEventListener("lostpointercapture", () => { resetDrag(); resume(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); else resume(); });
    const api = {
      show(title, detail, duration) {
        pause(); resetDrag();
        if (!el.contains(document.activeElement)) returnFocus = document.activeElement;
        el.querySelector(".notice-title").textContent = title;
        el.querySelector(".notice-detail").textContent = detail || "";
        el.inert = false;
        el.setAttribute("aria-hidden", "false");
        el.classList.add("on");
        remaining = duration;
        resume();
      },
      dismiss
    };
    controllers.set(id, api);
    return api;
  }

  function show(id, title, detail, duration) {
    const notice = controller(id);
    if (notice) notice.show(title, detail, duration);
  }

  async function system(title, body, tag) {
    if (!read() || !permitted()) return false;
    const options = {
      body, icon: new URL("favicon.png", document.baseURI).href,
      tag, data: { url: new URL("index.html", document.baseURI).href },
      requireInteraction: true
    };
    const reg = await registration();
    // The preference may have changed while the worker was starting.
    if (!read() || !permitted()) return false;
    if (reg) {
      try {
        const sent = await new Promise((resolve) => {
          const channel = new MessageChannel();
          const timeout = setTimeout(() => { channel.port1.close(); resolve(false); }, 5000);
          channel.port1.onmessage = (e) => { clearTimeout(timeout); channel.port1.close(); resolve(e.data === true); };
          reg.active.postMessage({ type: "vclyps:notify", title, options }, [channel.port2]);
        });
        if (sent) return true;
      } catch (_) {}
    }
    try {
      const notice = new Notification(title, options);
      notice.onclick = () => { window.focus(); notice.close(); window.dispatchEvent(new Event("vclyps:open-result")); };
      return true;
    } catch (_) { return false; }
  }

  let latest = null;
  function complete(title, detail, kind) {
    latest = { title, detail, kind: kind || "edit" };
    show("doneCard", title, detail, 12000);
    // Explicit opt-in means a device notification even when the site has focus.
    void system(title, detail, "vclyps-" + latest.kind).then((sent) => {
      if (!sent && read()) status("Device notification could not be delivered. Your result is ready here.");
    });
  }
  function status(text) {
    const el = document.getElementById("notifyStatus");
    if (el) el.textContent = text;
  }
  function paint() {
    const on = read() && permitted();
    document.querySelectorAll("#notifySeg button").forEach((b) => {
      const selected = (b.dataset.n === "1") === on;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-pressed", String(selected));
    });
    if (!window.isSecureContext) status("Device notifications need HTTPS or localhost.");
    else if (!("Notification" in window)) status(window.VevrisPlatform && VevrisPlatform.where() === "app"
      ? "Device notifications aren't available in this view."
      : "Device notifications are unavailable here. On iPhone or iPad, add vClyps to your Home Screen and open it there.");
    else if (Notification.permission === "denied") status("Notifications are blocked. Allow them in your browser's site settings, then turn this on.");
    else status(on ? "Device notifications are on for edits and exports." : "Turn on to receive completion alerts outside vClyps.");
  }
  document.getElementById("notifySeg").addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.n === "0") { write(false); paint(); return; }
    if (!window.isSecureContext || !("Notification" in window)) { paint(); return; }
    let permission = Notification.permission;
    // Call directly from the click: awaiting registration first loses the user gesture on Safari.
    if (permission === "default") {
      try { permission = await Notification.requestPermission(); } catch (_) { permission = "denied"; }
    }
    write(permission === "granted");
    paint();
    if (permission === "granted") void registration();
  });
  document.getElementById("testNotification").addEventListener("click", async () => {
    const sent = await system("vClyps notifications are on", "Your device will let you know when your edit or export is ready.", "vclyps-test");
    status(sent ? "Test sent. Check your device notifications; Focus or Do Not Disturb can silence banners." : "Turn notifications on first. If already on, check your browser and device notification settings.");
  });
  if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "vclyps:open-result") window.dispatchEvent(new Event("vclyps:open-result"));
  });
  window.addEventListener("vclyps:open-result", () => {
    if (latest) show("doneCard", latest.title, latest.detail, 12000);
  });
  window.addEventListener("focus", paint);
  window.addEventListener("storage", (e) => { if (e.key === KEY) paint(); });
  controller("fsNotice"); controller("doneCard");
  paint();
  if (read() && permitted()) void registration();
  window.VevrisNotices = { show, complete, dismiss(id) { const notice = controller(id); if (notice) notice.dismiss(); } };
})();
