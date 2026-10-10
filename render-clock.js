(function () {
  "use strict";
  let worker = null, pending = null;
  const api = {
    running: false,
    stop() {
      api.running = false;
      if (worker) worker.terminate();
      worker = null;
      if (pending) { pending(false); pending = null; }
    },
    start(tick, failed) {
      api.stop();
      return new Promise((resolve) => {
        let settled = false;
        const done = (ok) => {
          if (settled) return;
          settled = true; clearTimeout(timeout); pending = null; resolve(ok);
        };
        const timeout = setTimeout(() => { api.stop(); done(false); }, 2500);
        pending = done;
        try {
          const current = worker = new Worker("render-clock-worker.js");
          current.onmessage = (event) => {
            if (worker !== current) return;
            if (event.data === "ready") { api.running = true; done(true); }
            else if (event.data === "tick") tick(performance.now());
            if (worker === current) current.postMessage("next");
          };
          current.onerror = () => { api.stop(); done(false); failed(); };
          current.postMessage("start");
        } catch (_) { api.stop(); done(false); }
      });
    }
  };
  window.VevrisRenderClock = api;
})();
