/* ═══════════════════════════════════════════════════════════
   next/account.js: sign-in, plans, Tokens and top-ups (0.83.0)

   Research: NO UPLOAD/research/accounts-pricing-abuse-2026-11.md
   - Value first: manual editing never asks; sign-in comes at the first AI
     edit, when the person has already chosen a template and added footage.
   - One "Continue" sheet for sign-in and sign-up: Google, Apple, or a
     6-digit email code. No passwords. Inside Instagram / TikTok / Facebook
     in-app browsers Google refuses to sign in, so it is hidden there and
     an "Open in your browser" line is shown instead.
   - Prices in edits, not only Tokens; the estimate before every AI edit; a
     top-up calculator; a gate that offers a top-up or a lighter level BEFORE
     an edit starts, so running out mid-edit is rare.
   - Tokens never expire (store rules for purchased credits).

   Accounts are not live yet: the owner chooses the sign-in and payment
   providers (window.VCLYPS_ACCOUNTS). Until then this runs as a clearly
   labelled PREVIEW: a local balance with the welcome Tokens, so the whole
   flow can be tried. Nothing is charged and nothing leaves the device.
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // One place for names and prices (owner decides; see ai-first-plan.md section 5).
  const PLANS = [
    { id: "free", name: "Free", month: 0, tokens: 60, for: "Try the AI editor", lines: ["60 Tokens to start, once", "Manual editing, unlimited", "1080p export, no watermark"] },
    { id: "creator", name: "Creator", month: 9.99, tokens: 1000, for: "Posting every week", lines: ["1,000 Tokens a month", "About 18 Standard edits", "Every effort level"] },
    { id: "pro", name: "Pro", month: 24.99, tokens: 2800, rec: true, for: "Posting most days", lines: ["2,800 Tokens a month", "About 50 Standard edits", "Fast switch, priority queue"] },
    { id: "studio", name: "Studio", month: 59.99, tokens: 7500, for: "Teams and agencies", lines: ["7,500 Tokens a month", "About 130 Standard edits", "Brand kit, team seats"] }
  ];
  // the pay-per-edit plan (owner asked for one, named by us): no monthly Tokens,
  // a card on file, each edit billed at its Token price at the end of the month
  const FLEX = { id: "flex", name: "Flex", perToken: 0.012, lines: ["No monthly bundle", "Pay only for the edits you make", "Billed once a month, cancel any time"] };
  const TOKEN_PRICE = 0.01, MIN_TOPUP = 10;   // a $10 minimum: payment fees have a fixed part
  const STANDARD = 55, LOW = 5;               // Tokens for a typical edit, for "about N edits"

  const CFG = Object.assign({ auth: null, pay: null }, window.VCLYPS_ACCOUNTS || {});
  const LIVE = !!(CFG.auth && CFG.pay);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  const KEY = "vc-account-preview";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} };
  let acc = load();
  const subs = [];
  const changed = () => { save(acc); subs.forEach((f) => { try { f(); } catch (e) {} }); };

  // Instagram, TikTok, Facebook, Snapchat, LinkedIn webviews: Google sign-in is refused there
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Bytedance|Snapchat|LinkedInApp|Line\//i.test(navigator.userAgent || "");

  /* ── the sheet (one component for every account surface) ── */
  let sheet, resolveSheet = null;
  function open(html, onMount) {
    if (!sheet) {
      sheet = document.createElement("div");
      sheet.className = "acc-veil";
      sheet.innerHTML = '<div class="acc-sheet" role="dialog" aria-modal="true" aria-labelledby="accTitle"></div>';
      sheet.addEventListener("click", (e) => { if (e.target === sheet) close(false); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheet.classList.contains("open")) close(false); });
      document.body.appendChild(sheet);
    }
    const box = sheet.firstChild;
    box.innerHTML = `<button type="button" class="acc-x" aria-label="Close">&times;</button>` + html;
    box.querySelector(".acc-x").addEventListener("click", () => close(false));
    sheet.classList.add("open");
    if (onMount) onMount(box);
    const f = box.querySelector("[autofocus]") || box.querySelector("button:not(.acc-x), input");
    if (f) f.focus();
    return new Promise((r) => { resolveSheet = r; });
  }
  function close(v) { if (!sheet) return; sheet.classList.remove("open"); const r = resolveSheet; resolveSheet = null; if (r) r(v); }

  /* ── sign in / sign up: one sheet ── */
  // 0.84.0: the full sign-in screen (next/auth.js); the sheet below stays as a fallback
  function openSignIn(reason) {
    if (window.vcAuth) return vcAuth.open(reason);
    const why = reason === "edit" ? "Your footage is ready. Sign in to start the AI edit; your first 60 Tokens are on us." : "Keep your Tokens and projects on every device.";
    return open(`
      <h2 id="accTitle">Continue to vClyps</h2>
      <p class="acc-lead">${esc(why)}</p>
      ${inApp ? `<p class="acc-note">You're inside another app's browser, where Google and Apple sign-in don't work. Use your email below, or open vClyps in your phone's browser.</p>` : `
      <button type="button" class="acc-btn acc-google" data-provider="google"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>Continue with Google</button>
      <button type="button" class="acc-btn acc-apple" data-provider="apple"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.9a4.8 4.8 0 0 0-4 2.5c-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8s2.1-1.2 2.9-2.4c.9-1.3 1.3-2.6 1.3-2.7a4.2 4.2 0 0 1-2.3-3.7zM14 5.3a4.3 4.3 0 0 0 1-3.3 4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1 3.2A3.6 3.6 0 0 0 14 5.3z"/></svg>Continue with Apple</button>
      <div class="acc-or"><span>or</span></div>`}
      <form class="acc-email" novalidate>
        <label for="accEmail">Email</label>
        <input id="accEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required ${inApp ? "autofocus" : ""}>
        <p class="acc-err hidden" role="alert"></p>
        <button type="submit" class="acc-btn acc-primary">Email me a code</button>
      </form>
      <p class="acc-fine">No password needed. By continuing you agree to the <a href="terms.html" target="_blank" rel="noopener">terms</a> and <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a>.</p>
      ${LIVE ? "" : `<div class="acc-preview"><p><b>Accounts open soon.</b> Until then you can try everything with a preview balance on this device.</p><button type="button" class="acc-btn" data-preview>Try it now (preview)</button></div>`}`,
      (box) => {
        box.querySelectorAll("[data-provider]").forEach((b) => b.addEventListener("click", () => provider(b.dataset.provider, box)));
        box.querySelector(".acc-email").addEventListener("submit", (e) => { e.preventDefault(); emailStep(box); });
        const p = box.querySelector("[data-preview]");
        if (p) p.addEventListener("click", async () => { p.disabled = true; await startPreview(); close(true); });
      });
  }
  function provider(name, box) {
    if (!LIVE) return showErr(box, "Sign-in with " + (name === "google" ? "Google" : "Apple") + " opens when accounts go live. Use the preview for now.");
    CFG.auth.redirect(name);   // a full-page redirect, never a popup (webviews block popups)
  }
  function showErr(box, msg) { const e = box.querySelector(".acc-err"); e.textContent = msg; e.classList.remove("hidden"); }
  async function emailStep(box) {
    const input = box.querySelector("#accEmail"), v = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { input.setAttribute("aria-invalid", "true"); return showErr(box, "Enter an email address like name@example.com."); }
    input.removeAttribute("aria-invalid");
    if (!LIVE) return showErr(box, "Email codes start when accounts go live. Use the preview for now.");
    const r = await CFG.auth.sendCode(v, await (window.vcTrust ? vcTrust.signals() : {}));
    if (!r.ok) return showErr(box, r.message || "We couldn't send a code. Check the address and try again.");
    codeStep(box, v);
  }
  function codeStep(box, email) {
    box.querySelector(".acc-email").outerHTML = `<form class="acc-email" novalidate><label for="accCode">The 6-digit code we sent to ${esc(email)}</label>
      <input id="accCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required autofocus>
      <p class="acc-err hidden" role="alert"></p><button type="submit" class="acc-btn acc-primary">Continue</button></form>`;
    const f = box.querySelector(".acc-email");
    f.querySelector("input").focus();
    f.addEventListener("submit", async (e) => { e.preventDefault(); const r = await CFG.auth.verify(email, f.querySelector("input").value.trim()); if (!r.ok) return showErr(box, r.message || "That code didn't match. Check it and try again."); acc = r.account; changed(); close(true); });
  }

  /* The preview account. The welcome Tokens are given once per device and
     person: vcTrust (next/trust.js) gathers the signals; the server decides
     when accounts are live. In the preview the check is local only. */
  async function startPreview() {
    if (acc && acc.preview) { acc.signedIn = true; changed(); return; }   // back in: the same balance
    const t = window.vcTrust ? await vcTrust.check() : { grant: 60 };
    acc = { preview: true, signedIn: true, tokens: t.grant, plan: "free", ledger: [{ at: Date.now(), d: t.grant, why: t.grant ? "Welcome Tokens" : "Welcome Tokens already used on this device" }] };
    changed();
  }

  // signed in through next/auth.js: the preview keeps one balance per email and
  // gives the welcome Tokens once (vcTrust); live, the server does both
  async function adopt(email, opts) {
    if (acc && acc.preview && acc.email === email) { acc.signedIn = true; changed(); return; }
    const t = window.vcTrust ? await vcTrust.check() : { grant: 60 };
    acc = { preview: true, signedIn: true, email, tokens: t.grant, plan: "free", onboarding: opts && opts.onboarding, ledger: [{ at: Date.now(), d: t.grant, why: t.grant ? "Welcome Tokens" : "Welcome Tokens already used on this device" }] };
    changed();
  }

  /* ── plans ── */
  function openPlans() {
    let yearly = false;
    const card = (p) => {
      const price = yearly ? p.month * 10 : p.month;
      return `<div class="acc-plan${p.rec ? " rec" : ""}">${p.rec ? '<span class="acc-rec">Recommended</span>' : ""}
        <h3>${esc(p.name)}</h3><p class="acc-for">${esc(p.for)}</p>
        <p class="acc-price">${p.month ? money(price) : "$0"}<span>${p.month ? (yearly ? " a year" : " a month") : ""}</span></p>
        <ul>${p.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <button type="button" class="acc-btn ${p.rec ? "acc-primary" : ""}" data-plan="${p.id}">${p.month ? "Choose " + esc(p.name) : (acc && acc.signedIn ? "Your plan" : "Start free")}</button></div>`;
    };
    const paint = (box) => {
      box.querySelector(".acc-plans").innerHTML = PLANS.map(card).join("");
      box.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.plan, yearly, box)));
    };
    return open(`
      <h2 id="accTitle">Plans</h2>
      <p class="acc-lead">Manual editing is always free. Tokens pay for AI edits; a Standard edit is about ${STANDARD}. Tokens never expire.</p>
      <div class="acc-toggle" role="group" aria-label="Billing"><button type="button" class="active" data-bill="m">Monthly</button><button type="button" data-bill="y">Yearly, 2 months free</button></div>
      <div class="acc-plans"></div>
      <div class="acc-flex"><div><h3>${FLEX.name}: pay per edit</h3><p>${FLEX.lines.join(". ")}. ${money(FLEX.perToken * STANDARD)} for a Standard edit, about ${money(FLEX.perToken * LOW)} for a Low one.</p></div><button type="button" class="acc-btn" data-plan="flex">Choose ${FLEX.name}</button></div>
      <div class="acc-calc-wrap"><h3>Top up any amount</h3>${calcHtml()}</div>`,
      (box) => {
        paint(box);
        box.querySelectorAll("[data-bill]").forEach((b) => b.addEventListener("click", () => { yearly = b.dataset.bill === "y"; box.querySelectorAll("[data-bill]").forEach((x) => x.classList.toggle("active", x === b)); paint(box); }));
        box.querySelector('[data-plan="flex"]').addEventListener("click", () => choose("flex", false, box));
        calcWire(box, 1000);
      });
  }
  function choose(id, yearly, box) {
    if (id === "free") { if (!acc || !acc.signedIn) { close(false); openSignIn("plans"); } return; }
    if (!LIVE) return toastIn(box, "Payments open when accounts go live. Nothing has been charged.");
    CFG.pay.checkout({ plan: id, yearly });
  }

  /* ── the top-up calculator (any amount) ── */
  function calcHtml(min) {
    return `<div class="acc-calc"><label for="accTok">Tokens</label>
      <div class="acc-calc-row"><input id="accTok" type="range" min="${min || 1000}" max="20000" step="100"><input id="accTokN" type="number" inputmode="numeric" min="${min || 1000}" max="100000" step="100" aria-label="Tokens"></div>
      <p class="acc-calc-out"><b id="accPrice"></b> <span id="accEdits"></span></p>
      <button type="button" class="acc-btn acc-primary" id="accBuy">Top up</button><p class="acc-err hidden" role="alert"></p></div>`;
  }
  function calcWire(box, start, onDone) {
    const r = box.querySelector("#accTok"), n = box.querySelector("#accTokN");
    const set = (v) => { v = Math.max(+r.min, Math.round(+v / 100) * 100 || +r.min); r.value = Math.min(v, +r.max); n.value = v;
      box.querySelector("#accPrice").textContent = money(Math.max(MIN_TOPUP, v * TOKEN_PRICE));
      box.querySelector("#accEdits").textContent = `about ${Math.floor(v / STANDARD)} Standard edits or ${Math.floor(v / LOW)} Low edits`; };
    r.addEventListener("input", () => set(r.value));
    n.addEventListener("change", () => set(n.value));
    set(start);
    box.querySelector("#accBuy").addEventListener("click", () => {
      const v = +n.value;
      if (!LIVE) {
        if (acc && acc.preview) { acc.tokens += v; acc.ledger.push({ at: Date.now(), d: v, why: "Preview top-up (nothing charged)" }); changed(); toastIn(box, `Added ${v.toLocaleString()} preview Tokens. Nothing was charged.`); if (onDone) setTimeout(() => onDone(true), 600); return; }
        return toastIn(box, "Payments open when accounts go live.");
      }
      CFG.pay.checkout({ topup: v });
    });
  }
  function toastIn(box, msg) { const e = box.querySelectorAll(".acc-err"); const el = e[e.length - 1]; if (el) { el.textContent = msg; el.classList.remove("hidden"); } }

  /* ── the gate before an AI edit: enough Tokens for the UPPER estimate ── */
  async function ready({ reason, need, low, lighter }) {
    if (!acc || !acc.signedIn) { const ok = await openSignIn(reason); if (!ok) return false; }
    if (acc.tokens >= need) return true;
    if (typeof lighter === "function") lighter = lighter(acc.tokens);
    return open(`
      <h2 id="accTitle">Top up before this edit</h2>
      <p class="acc-lead">This edit needs about ${low}-${need} Tokens. You have ${acc.tokens.toLocaleString()}. Topping up now means it won't stop halfway.</p>
      ${calcHtml(Math.max(100, Math.ceil((need - acc.tokens) / 100) * 100))}
      ${lighter ? `<button type="button" class="acc-btn" data-lighter>Use ${esc(lighter.name)} instead (about ${lighter.low}-${lighter.need} Tokens)</button>` : `<p class="acc-fine">Or choose a lighter effort level: Low edits use about ${LOW} Tokens.</p>`}`,
      (box) => {
        calcWire(box, Math.max(1000, Math.ceil((need - acc.tokens) / 100) * 100), () => close(acc.tokens >= need));
        const l = box.querySelector("[data-lighter]");
        if (l) l.addEventListener("click", () => { lighter.apply(); close(true); });
      });
  }
  // if a long edit still runs out (backend era), this sheet lets it continue
  function continueSheet(more) {
    return open(`<h2 id="accTitle">Keep going?</h2><p class="acc-lead">The edit needs about ${more} more Tokens to finish. Top up and it carries on from where it stopped; nothing done so far is lost.</p>${calcHtml(Math.max(100, Math.ceil(more / 100) * 100))}`,
      (box) => calcWire(box, Math.max(1000, Math.ceil(more / 100) * 100), () => close(true)));
  }
  function charge(n, meta) {
    if (!acc) return null;
    n = Math.min(n, acc.tokens);
    acc.tokens -= n; acc.ledger.push({ at: Date.now(), d: -n, why: (meta && meta.level ? meta.level + (meta.fast ? " + Fast" : "") + " edit" : "Edit") });
    changed();
    return n;
  }

  /* ── account ── */
  function openAccount() {
    if (!acc || !acc.signedIn) return openSignIn("account");
    return open(`<h2 id="accTitle">Account${acc.preview ? " (preview)" : ""}</h2>
      <p class="acc-balance"><b>${acc.tokens.toLocaleString()}</b> Tokens</p>
      <div class="acc-row"><button type="button" class="acc-btn acc-primary" data-plans>Plans and top-ups</button><button type="button" class="acc-btn" data-out>Sign out</button></div>
      <h3>History</h3><ul class="acc-ledger">${acc.ledger.slice(-20).reverse().map((l) => `<li><span>${esc(l.why)}</span><b>${l.d > 0 ? "+" : ""}${l.d}</b></li>`).join("")}</ul>`,
      (box) => {
        box.querySelector("[data-plans]").addEventListener("click", () => { close(false); openPlans(); });
        box.querySelector("[data-out]").addEventListener("click", () => { acc = Object.assign({}, acc, { signedIn: false }); changed(); close(false); });
      });
  }

  window.vcAccount = {
    state: () => ({ signedIn: !!(acc && acc.signedIn), tokens: acc ? acc.tokens : 0, plan: acc && acc.plan, preview: !LIVE }),
    onChange: (f) => subs.push(f),
    ready, charge, continueSheet, openPlans, openAccount, openSignIn, adopt, PLANS, FLEX
  };
})();
