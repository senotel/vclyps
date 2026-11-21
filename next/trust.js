/* ═══════════════════════════════════════════════════════════
   next/trust.js: has this person had their free Tokens before? (0.83.0)

   Research: NO UPLOAD/research/accounts-pricing-abuse-2026-11.md section 3.
   No single signal is enough, so several are combined and the SERVER
   decides (trust-worker.mjs): a verified email, a device id kept in three
   stores (clearing one does not reset it), a device fingerprint (hashed,
   no raw values leave the device), the network, and a bot check
   (Cloudflare Turnstile). A match lowers or withholds the welcome Tokens;
   nobody is banned, and a shared family device gets a softer check.
   The privacy policy names all of this (see the research file's wording).
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const ID = "vc_did", MARK = "vc_welcome";

  // ── a device id in localStorage, IndexedDB and a first-party cookie ──
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const ck = { get: (k) => (document.cookie.match(new RegExp("(?:^|; )" + k + "=([^;]*)")) || [])[1] || null,
    set: (k, v) => { document.cookie = `${k}=${v}; max-age=${60 * 60 * 24 * 400}; path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; } };
  const idb = {
    db: () => new Promise((ok) => { try { const r = indexedDB.open("vc-trust", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => ok(r.result); r.onerror = () => ok(null); } catch (e) { ok(null); } }),
    async get(k) { const d = await idb.db(); if (!d) return null; return new Promise((ok) => { try { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); } catch (e) { ok(null); } }); },
    async set(k, v) { const d = await idb.db(); if (!d) return; try { d.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) {} }
  };
  async function everywhere(key, make) {
    let v = ls.get(key) || ck.get(key) || (await idb.get(key));
    if (!v && make) v = make();
    if (v) { ls.set(key, v); ck.set(key, v); await idb.set(key, v); }
    return v;
  }
  const rand = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

  // ── a fingerprint: stable traits of this browser and machine, hashed ──
  async function fingerprint() {
    const parts = [navigator.userAgent, navigator.language, (navigator.languages || []).join(","), navigator.platform, navigator.hardwareConcurrency, navigator.deviceMemory,
      screen.width + "x" + screen.height + "x" + screen.colorDepth, devicePixelRatio, Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.maxTouchPoints];
    try {
      const c = document.createElement("canvas"); c.width = 240; c.height = 60; const x = c.getContext("2d");
      x.textBaseline = "top"; x.font = "16px 'Arial'"; x.fillStyle = "#dc143c"; x.fillRect(4, 4, 80, 20); x.fillStyle = "#111"; x.fillText("OutClip 0.83 é中", 6, 30);
      parts.push(c.toDataURL());
    } catch (e) {}
    try {
      const g = document.createElement("canvas").getContext("webgl"); const d = g && g.getExtension("WEBGL_debug_renderer_info");
      if (d) parts.push(g.getParameter(d.UNMASKED_VENDOR_WEBGL), g.getParameter(d.UNMASKED_RENDERER_WEBGL));
    } catch (e) {}
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function signals() {
    return { device: await everywhere(ID, rand), fp: await fingerprint(), seen: !!(await everywhere(MARK)) };
  }

  /* The preview's local check: this device already had its welcome Tokens.
     With accounts live, the server (trust-worker.mjs) decides instead, using
     these signals plus the verified email, the network and Turnstile. */
  async function check() {
    const s = await signals();
    if (s.seen) return { grant: 0, why: "device" };
    await everywhere(MARK, () => String(Date.now()));
    return { grant: 60, why: null };
  }

  window.vcTrust = { signals, check };
})();
