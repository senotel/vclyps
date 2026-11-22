/* addsheet.js: the one "Add videos" sheet (0.93.0), used by the home page, the AI app and the editor.
   Tiles like a phone's share sheet: the device first (Gallery, Camera, Files on a phone; one button on a
   computer), then every connected service with its real logo (brand/sources, CC0 from gilbarbara/logos).
   Gallery asks for photos and videos only, which is what opens the phone's own photo picker (iOS Photos with
   every album and iCloud; Android's picker with Google Photos and the other gallery apps). Files adds one other
   type, which sends Android to its file browser, where every other gallery and storage app is listed.
   window.EthAdd.open({ title, ways, onFiles, sources }) ; window.EthAdd.icon(name) for other sheets. */
(function () {
  "use strict";
  const svg = (body) => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">${body}</svg>`;
  // filled glyphs on a coloured tile (never thin outlines)
  const GLYPH = {
    gallery: svg('<rect x="6.5" y="3.5" width="13" height="11" rx="2.4" fill="#fff" opacity=".45"/><rect x="3.5" y="7" width="14.5" height="13" rx="2.6" fill="#fff"/><circle cx="8" cy="11.2" r="1.6" fill="#c8102e"/><path d="M4.6 18.6l4.1-4.2a1.2 1.2 0 0 1 1.7 0l1.6 1.6 2.6-2.9a1.2 1.2 0 0 1 1.8 0l1.2 1.4v3.9a1.6 1.6 0 0 1-1.6 1.6H6.1a1.6 1.6 0 0 1-1.5-1.4z" fill="#c8102e"/>'),
    camera: svg('<rect x="2.5" y="6" width="13.5" height="12" rx="3" fill="#f4f2ed"/><path d="M17.2 10.4l3.6-2.3a.8.8 0 0 1 1.2.7v6.4a.8.8 0 0 1-1.2.7l-3.6-2.3z" fill="#f4f2ed"/><circle cx="6.4" cy="9.6" r="1.2" fill="#dc143c"/>'),
    files: svg('<path d="M2.8 7.2A2.4 2.4 0 0 1 5.2 4.8h3.6c.6 0 1.2.3 1.6.7l1.3 1.4h7.1a2.4 2.4 0 0 1 2.4 2.4v.6H2.8z" fill="#f4f2ed" opacity=".55"/><rect x="2.8" y="8.7" width="18.4" height="10.5" rx="2.4" fill="#f4f2ed"/>'),
    computer: svg('<rect x="4" y="4.5" width="16" height="11" rx="2" fill="#fff"/><rect x="6" y="6.5" width="12" height="7" rx=".8" fill="#c8102e"/><path d="M2 17.2h20l-.7 1.4a1.6 1.6 0 0 1-1.4.9H4.1a1.6 1.6 0 0 1-1.4-.9z" fill="#fff"/>')
  };
  const SOURCES = [["gphotos", "Google Photos", "google-photos"], ["drive", "Google Drive", "google-drive"], ["dropbox", "Dropbox", "dropbox"], ["zoom", "Zoom", "zoom"], ["vimeo", "Vimeo", "vimeo"]];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const touch = () => matchMedia("(pointer: coarse)").matches;
  const base = () => (document.querySelector("base") || {}).href || location.href;
  function icon(name) {
    if (GLYPH[name]) return `<span class="ea-ic ea-ic-${name}">${GLYPH[name]}</span>`;
    const s = SOURCES.find((x) => x[0] === name);
    return s ? `<span class="ea-ic ea-ic-brand"><img src="${new URL("brand/sources/" + s[2] + ".svg", base()).href}" alt="" width="30" height="30"></span>` : "";
  }

  const CSS = `
  .ea-veil{position:fixed;inset:0;z-index:2000;display:none;align-items:flex-end;justify-content:center;background:rgba(12,11,10,.42);
    --ea-bg:#fff;--ea-ink:#111210;--ea-t1:#6f6c64;--ea-hair:#e7e4dd;--ea-tile:#f4f2ed;font-family:"Switzer",-apple-system,"Segoe UI",Roboto,sans-serif}
  body.dark .ea-veil{--ea-bg:#191816;--ea-ink:#f1eee7;--ea-t1:#9b978d;--ea-hair:#2c2a26;--ea-tile:#24221e}
  .ea-veil.open{display:flex}
  .ea-sheet{width:100%;max-width:520px;padding:6px 20px max(22px,env(safe-area-inset-bottom));border-radius:16px 16px 0 0;background:var(--ea-bg);color:var(--ea-ink);
    transform:translateY(28px);opacity:0;transition:transform .28s cubic-bezier(.2,.8,.2,1),opacity .2s ease}
  .ea-veil.in .ea-sheet{transform:none;opacity:1}
  @media (min-width:761px){.ea-veil{align-items:center}.ea-sheet{border-radius:16px;padding:6px 24px 24px;border:1px solid var(--ea-hair)}}
  .ea-grip{width:36px;height:4px;margin:6px auto 2px;border-radius:2px;background:var(--ea-hair)}
  @media (min-width:761px){.ea-grip{display:none}}
  .ea-head{display:flex;align-items:center;height:54px}
  .ea-head h2{flex:1;margin:0;font-size:21px;font-weight:600;letter-spacing:-.03em}
  .ea-x{display:grid;place-items:center;width:44px;height:44px;margin-right:-10px;border:0;border-radius:10px;background:none;color:var(--ea-t1);cursor:pointer}
  .ea-x:hover{color:var(--ea-ink)}
  .ea-label{margin:14px 0 10px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--ea-t1)}
  .ea-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px 8px}
  .ea-tile{display:flex;flex-direction:column;align-items:center;gap:8px;min-height:44px;padding:8px 2px 6px;border:0;border-radius:14px;background:none;color:var(--ea-ink);
    font:inherit;font-size:13px;font-weight:500;letter-spacing:-.01em;text-align:center;cursor:pointer;transition:background .12s ease}
  .ea-tile:hover{background:var(--ea-tile)}
  .ea-tile:active .ea-ic{transform:scale(.94)}
  .ea-tile:disabled{opacity:.45;cursor:default}
  .ea-ic{display:grid;place-items:center;width:58px;height:58px;border-radius:17px;transition:transform .12s ease}
  .ea-ic-gallery,.ea-ic-computer{background:linear-gradient(160deg,#ef3b58,#c8102e 62%,#a50d27)}
  .ea-ic-camera,.ea-ic-files{background:linear-gradient(160deg,#3b3833,#1b1a17)}
  body.dark .ea-ic-camera,body.dark .ea-ic-files{background:linear-gradient(160deg,#45423c,#2a2824)}
  .ea-ic-brand{background:var(--ea-tile);border:1px solid var(--ea-hair)}
  .ea-wide{grid-template-columns:1fr}
  .ea-wide .ea-tile{flex-direction:row;gap:14px;padding:10px 12px;font-size:15px;text-align:left;background:var(--ea-tile)}
  .ea-wide .ea-tile:hover{filter:brightness(.98)}
  .ea-foot{display:flex;align-items:center;gap:12px;min-height:22px;margin-top:14px}
  .ea-status{flex:1;margin:0;font-size:13px;color:var(--ea-t1)}
  .ea-cancel{border:0;background:none;color:var(--ea-ink);font:inherit;font-size:13px;font-weight:600;text-decoration:underline;cursor:pointer;min-height:44px}
  @media (prefers-reduced-motion:reduce){.ea-sheet{transition:none;transform:none;opacity:1}}`;

  let root, opts, ctl;
  function ensure() {
    if (root) return root;
    const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    root = document.createElement("div");
    root.className = "ea-veil";
    root.innerHTML = '<div class="ea-sheet" role="dialog" aria-modal="true" aria-labelledby="eaTitle"><div class="ea-grip"></div><div class="ea-head"><h2 id="eaTitle">Add videos</h2>' +
      '<button type="button" class="ea-x" data-eaclose aria-label="Close"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>' +
      '<div class="ea-body"></div><div class="ea-foot"><p class="ea-status" role="status"></p><button type="button" class="ea-cancel" hidden>Cancel</button></div></div>';
    root.addEventListener("click", (e) => { if (e.target === root || e.target.closest("[data-eaclose]")) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && root.classList.contains("open")) close(); });
    root.querySelector(".ea-cancel").addEventListener("click", () => { if (ctl) ctl.abort(); });
    document.body.appendChild(root);
    return root;
  }
  const status = (t) => { root.querySelector(".ea-status").textContent = t || ""; };

  function picker(accept, capture) {
    const i = document.createElement("input");
    i.type = "file"; i.multiple = !capture; i.accept = accept; i.hidden = true;
    if (capture) i.setAttribute("capture", "environment");
    i.addEventListener("change", () => { const f = Array.from(i.files || []); i.remove(); if (f.length) opts.onFiles(f); });
    document.body.appendChild(i);
    i.click();   // inside the tap, which browsers require
  }

  const DEFAULT_WAYS = { gallery: "image/*,video/*", files: "video/*,image/*,audio/*,.mov,.mkv,.heic", camera: "video/*" };
  function open(o) {
    opts = Object.assign({ title: "Add videos", ways: DEFAULT_WAYS, onFiles: () => {}, sources: ["gphotos", "drive", "dropbox"] }, o || {});
    const w = Object.assign({}, DEFAULT_WAYS, opts.ways || {});
    ensure();
    root.querySelector("#eaTitle").textContent = opts.title;
    const dev = touch()
      ? [["gallery", "Gallery"], w.camera ? ["camera", "Camera"] : null, ["files", "Files"]].filter(Boolean)
      : [["computer", "Choose from this computer"]];
    const tile = (k, l) => `<button type="button" class="ea-tile" data-ea="${k}">${icon(k)}<span>${esc(l)}</span></button>`;
    root.querySelector(".ea-body").innerHTML = `<div class="ea-grid${touch() ? "" : " ea-wide"}">${dev.map(([k, l]) => tile(k, l)).join("")}</div><div class="ea-more" hidden><p class="ea-label">Connected</p><div class="ea-grid ea-src"></div></div>`;
    status(""); root.querySelector(".ea-cancel").hidden = true;
    if (window.SenotelSources && opts.sources.length) {
      SenotelSources.warm && SenotelSources.warm();
      SenotelSources.available().then((av) => {
        const on = SOURCES.filter(([k]) => opts.sources.includes(k) && av[k]);
        if (!on.length) return;
        root.querySelector(".ea-src").innerHTML = on.map(([k, l]) => tile(k, l)).join("");
        root.querySelector(".ea-more").hidden = false;
      }).catch(() => {});
    }
    root.querySelector(".ea-body").onclick = (e) => {
      const b = e.target.closest("[data-ea]"); if (!b || ctl) return;
      const k = b.dataset.ea;
      if (k === "gallery") { close(); picker(w.gallery); }
      else if (k === "camera") { close(); picker(w.camera, true); }
      else if (k === "files" || k === "computer") { close(); picker(w.files); }
      else runSource(k, b.textContent.trim());
    };
    root.classList.add("open");
    requestAnimationFrame(() => root.classList.add("in"));
    const first = root.querySelector(".ea-tile"); if (first) first.focus({ preventScroll: true });
  }
  async function runSource(k, label) {
    const S = window.SenotelSources;
    ctl = new AbortController();
    root.querySelectorAll(".ea-tile").forEach((t) => { t.disabled = true; });
    root.querySelector(".ea-cancel").hidden = false;
    status("Opening " + label + "...");
    const o = { signal: ctl.signal, onProgress: (got, total) => status("Downloading " + (got / 1048576).toFixed(1) + (total ? " of " + (total / 1048576).toFixed(1) : "") + " MB") };
    try {
      const got = k === "drive" ? await S.fromDrive(o) : k === "dropbox" ? await S.fromDropbox(o)
        : k === "gphotos" ? await (S.photos.signedIn() ? S.fromGooglePhotos(o) : S.photos.signIn().then(() => S.fromGooglePhotos(o)))
        : await (S[k] && S[k].pick ? S[k].pick(o) : Promise.reject(new Error(label + " opens in the editor's Add media.")));
      const f = Array.isArray(got) ? got : got ? [got] : [];
      ctl = null; close();
      if (f.length) opts.onFiles(f);
    } catch (err) {
      ctl = null;
      root.querySelectorAll(".ea-tile").forEach((t) => { t.disabled = false; });
      root.querySelector(".ea-cancel").hidden = true;
      status(err && err.name === "AbortError" || (S.Cancelled && err instanceof S.Cancelled) ? "" : (err && err.message) || "That didn't open. Try again.");
    }
  }
  function close() { if (!root) return; if (ctl) ctl.abort(); root.classList.remove("in", "open"); }

  window.EthAdd = { open, close, icon };
})();
