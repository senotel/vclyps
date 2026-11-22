/* ═══════════════════════════════════════════════════════════
   next/account.js: plans, Tokens, top-ups, checkout, account (0.85.0)

   Research: NO UPLOAD/research/accounts-pricing-abuse-2026-11.md
   - Prices in edits, not only Tokens; the estimate before every AI edit; a
     top-up calculator; a gate that offers a top-up or a lighter level BEFORE
     an edit starts, so running out mid-edit is rare. Tokens never expire.
   - Sign-in itself is next/auth.js (vcAuth).
   - Pages, not pop-ups: plans, checkout, account and "What works" are full
     screens in the home page's style; only the quick top-up before an edit
     is a sheet.

   Accounts and payments are NOT live: the owner picks the providers
   (window.OUTCLIP_ACCOUNTS {auth, pay}). Until then every surface runs as a
   labelled PREVIEW so it can be seen and tried: a balance on this device, a
   checkout that walks through the real steps and charges nothing.
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // One place for names and prices (owner decides; see ai-first-plan.md section 5).
  const PLANS = [
    { id: "free", name: "Free", month: 0, tokens: 60, for: "Try the AI editor", lines: ["60 Tokens once", "Free manual editing"] },
    { id: "creator", name: "Creator", month: 9.99, tokens: 1000, for: "Posting every week", lines: ["1,000 Tokens a month", "About 18 edits"] },
    { id: "pro", name: "Pro", month: 24.99, tokens: 2800, rec: true, for: "Posting most days", lines: ["2,800 Tokens a month", "About 50 edits"] },
    { id: "studio", name: "Studio", month: 59.99, tokens: 7500, for: "Teams and agencies", lines: ["7,500 Tokens a month", "About 130 edits"] }
  ];
  // pay per edit: no bundle, a card on file, each edit billed at its Token price monthly
  const FLEX = { id: "flex", name: "Flex", perToken: 0.012, lines: ["No monthly bundle", "Pay only for the edits you make", "Billed once a month, cancel any time"] };
  const TOKEN_PRICE = 0.01, MIN_TOPUP = 10;   // a $10 minimum: payment fees have a fixed part
  const STANDARD = 55, LOW = 5;               // Tokens for a typical edit, for "about N edits"

  const CFG = Object.assign({ auth: null, pay: null }, window.OUTCLIP_ACCOUNTS || window.VCLYPS_ACCOUNTS || {});
  const LIVE = !!(CFG.auth && CFG.pay);          // payments switched on
  const DATA = CFG.data || null;                // real accounts (next/supabase.js)
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0);
  const KEY = "vc-account-preview";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const save = (a) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} };
  let acc = load();
  const subs = [];
  const changed = () => { save(acc); subs.forEach((f) => { try { f(); } catch (e) {} }); };
  const X = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /* ── one surface: a full page (plans, checkout, account, status) or a sheet (quick top-up) ── */
  let veil, resolveIt = null;
  function open(html, onMount, page) {
    if (!veil) {
      veil = document.createElement("div");
      veil.className = "acc-veil";
      veil.innerHTML = '<div class="acc-sheet" role="dialog" aria-modal="true" aria-labelledby="accTitle"></div>';
      veil.addEventListener("click", (e) => { if (e.target === veil) close(false); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && veil.classList.contains("open")) close(false); });
      document.body.appendChild(veil);
    }
    veil.classList.toggle("acc-page", !!page);
    const box = veil.firstChild;
    box.innerHTML = (page ? `<header class="acc-head"><button type="button" class="flow-brand" data-brandclose aria-label="Close"><svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="2" width="18" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-in" x="3" y="9.8" width="5" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-cut" x="9.5" y="9.8" width="7.5" height="4.4" rx="1.4" fill="#dc143c"/><rect x="3" y="17.6" width="18" height="4.4" rx="1.4" fill="currentColor"/></svg><span class="brand-word">ethlenos</span></button><span class="flow-head-gap"></span>${LIVE ? "" : '<span class="acc-tag">Preview</span>'}<button type="button" class="acc-x" aria-label="Close">${X}</button></header><div class="acc-page-body">` : `<button type="button" class="acc-x" aria-label="Close">${X}</button>`) + html + (page ? "</div>" : "");
    box.querySelector(".acc-x").addEventListener("click", () => close(false));
    const bc = box.querySelector("[data-brandclose]"); if (bc) bc.addEventListener("click", () => close(false));
    veil.classList.add("open");
    box.scrollTop = 0;
    if (onMount) onMount(box);
    const f = box.querySelector("[autofocus]") || box.querySelector(".acc-btn, input");
    if (f) f.focus({ preventScroll: true });
    return new Promise((r) => { resolveIt = r; });
  }
  function close(v) { if (!veil) return; veil.classList.remove("open"); const r = resolveIt; resolveIt = null; if (r) r(v); }

  /* ── sign in: next/auth.js; without it, a plain preview account ── */
  function openSignIn(reason) {
    if (window.vcAuth) return vcAuth.open(reason);
    return adopt("preview@device", { isNew: true }).then(() => true);
  }
  // the preview keeps one balance per email and gives the welcome Tokens once (vcTrust)
  async function adopt(email, opts) {
    if (DATA) {   // real account: the server decides the welcome Tokens and keeps the balance
      if (opts && opts.isNew) { const sig = window.vcTrust ? await vcTrust.signals() : {}; await DATA.claimWelcome(sig); }
      const me = await DATA.me();
      acc = Object.assign({ signedIn: !!me, preview: false, ledger: [] }, me || {});
      changed();
      return;
    }
    if (acc && acc.preview && acc.email === email) { acc.signedIn = true; changed(); return; }
    const t = window.vcTrust ? await vcTrust.check() : { grant: 60 };
    acc = { preview: !LIVE, signedIn: true, email, tokens: t.grant, plan: "free", ledger: [{ at: Date.now(), d: t.grant, why: t.grant ? "Welcome Tokens" : "Welcome Tokens already used on this device" }] };
    changed();
  }

  /* ── plans: a page, columns on hairlines like the home page's spec grid ── */
  function openPlans() {
    let yearly = false;
    const col = (p) => {
      const price = yearly ? p.month * 10 : p.month, current = acc && acc.signedIn && acc.plan === p.id;
      return `<div class="acc-plan${p.rec ? " rec" : ""}">
        <p class="acc-eyebrow">${p.rec ? "Recommended" : esc(p.for)}</p>
        <h3>${esc(p.name)}</h3>
        <p class="acc-price">${p.month ? money(price) : "$0"}<span>${p.month ? (yearly ? " a year" : " a month") : ""}</span></p>
        <ul>${p.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
        <button type="button" class="acc-btn ${p.rec ? "" : "acc-ghost"}" data-plan="${p.id}" ${current ? "disabled" : ""}>${current ? "Your plan" : p.month ? "Choose " + esc(p.name) : "Start free"}</button></div>`;
    };
    const paint = (box) => {
      box.querySelector(".acc-plans").innerHTML = PLANS.map(col).join("");
      box.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.plan, yearly)));
    };
    return open(`
      <p class="acc-eyebrow">Plans</p>
      <h2 id="accTitle" class="acc-h1">Pay for what you make.</h2>
      <div class="acc-toggle" role="group" aria-label="Billing"><button type="button" class="active" data-bill="m" aria-pressed="true">Monthly</button><button type="button" data-bill="y" aria-pressed="false">Yearly, 2 months free</button></div>
      <div class="acc-plans"></div>
      <div class="acc-row-line"><div><p class="acc-eyebrow">Pay per edit</p><h3>${FLEX.name}</h3><p>About ${money(FLEX.perToken * STANDARD)} an edit</p></div><button type="button" class="acc-btn acc-ghost" data-plan="flex">Choose ${FLEX.name}</button></div>
      <div class="acc-row-line acc-calc-block"><div><p class="acc-eyebrow">Top up</p><h3>Any amount</h3>${calcHtml()}</div></div>`,
      (box) => {
        paint(box);
        box.querySelectorAll("[data-bill]").forEach((b) => b.addEventListener("click", () => { yearly = b.dataset.bill === "y"; box.querySelectorAll("[data-bill]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); }); paint(box); }));
        box.querySelector('[data-plan="flex"]').addEventListener("click", () => choose("flex", false));
        calcWire(box, 1000);
      }, true);
  }
  async function choose(id, yearly) {
    if (id === "free") { close(false); if (!acc || !acc.signedIn) openSignIn("plans"); return; }
    if (!acc || !acc.signedIn) { close(false); const ok = await openSignIn("plans"); if (!ok) return; }
    if (LIVE) return CFG.pay.checkout({ plan: id, yearly });
    const p = id === "flex" ? { id, name: FLEX.name, month: 0 } : PLANS.find((x) => x.id === id);
    checkout({ kind: "plan", plan: p, yearly });
  }

  /* ── checkout PREVIEW: the real steps, nothing charged ──
     Live, the payment provider's own secure checkout opens here (card, Apple
     Pay, Google Pay, local tax); Ethlenos never sees card details, so this
     preview shows the order and hands over, exactly as the live one will. */
  function checkout(o) {
    const isPlan = o.kind === "plan", flex = isPlan && o.plan.id === "flex";
    const amount = isPlan ? (flex ? 0 : (o.yearly ? o.plan.month * 10 : o.plan.month)) : Math.max(MIN_TOPUP, o.tokens * TOKEN_PRICE);
    const what = isPlan ? (flex ? "Flex, pay per edit" : `${o.plan.name}, ${o.yearly ? "yearly" : "monthly"}`) : `${o.tokens.toLocaleString()} Tokens`;
    const gets = isPlan ? (flex ? "Edits billed at $0.012 a Token, once a month" : `${(o.plan.tokens || 0).toLocaleString()} Tokens ${o.yearly ? "every month for a year" : "every month"}`) : `About ${Math.floor(o.tokens / STANDARD)} Standard edits; never expire`;
    return open(`
      <p class="acc-eyebrow">Checkout</p>
      <h2 id="accTitle" class="acc-h1">Review and pay</h2>
      <dl class="acc-order"><div><dt>Item</dt><dd>${esc(what)}</dd></div><div><dt>You get</dt><dd>${esc(gets)}</dd></div>
        <div><dt>${flex ? "Today" : "Total"}</dt><dd><b>${money(amount)}</b>${isPlan && !flex ? (o.yearly ? " a year" : " a month") : ""}</dd></div></dl>
      <button type="button" class="acc-btn acc-wide" data-pay>Continue to secure checkout</button>
      ${LIVE ? "" : DATA ? `<p class="acc-preview-note">Payments open soon. Nothing is charged.</p>` : `<p class="acc-preview-note">Preview: the live site opens the provider's checkout here. This one charges nothing and adds ${isPlan ? "the plan" : "the Tokens"} to your preview balance.</p>`}`,
      (box) => box.querySelector("[data-pay]").addEventListener("click", () => {
        if (LIVE) return CFG.pay.checkout(o);
        // real accounts, payments not connected yet: no pretend Tokens on a real balance
        if (DATA) { const b = box.querySelector("[data-pay]"); b.disabled = true; b.textContent = "Payments open soon"; return; }
        if (isPlan) { acc.plan = o.plan.id; if (!flex) { acc.tokens += o.plan.tokens; acc.ledger.push({ at: Date.now(), d: o.plan.tokens, why: o.plan.name + " plan (preview, nothing charged)" }); } }
        else { acc.tokens += o.tokens; acc.ledger.push({ at: Date.now(), d: o.tokens, why: "Top-up (preview, nothing charged)" }); }
        changed();
        paid(o, what);
      }), true);
  }
  function paid(o, what) {
    const r = resolveIt; resolveIt = null;
    open(`<div class="acc-done" aria-hidden="true"><svg viewBox="0 0 52 52" width="64" height="64"><circle cx="26" cy="26" r="24" fill="none"/><path d="M15 27l7 7 15-16" fill="none"/></svg></div>
      <h2 id="accTitle" class="acc-h1">${o.kind === "plan" ? "You're on " + esc(o.plan.name) : "Tokens added"}</h2>
      <p class="acc-lead">${esc(what)}. Your balance is ${acc.tokens.toLocaleString()} Tokens.${LIVE ? "" : " Preview: nothing was charged."}</p>
      <button type="button" class="acc-btn acc-wide" data-back>Back to editing</button>`,
      (box) => box.querySelector("[data-back]").addEventListener("click", () => close(true)), true).then((v) => { if (r) r(v); });
  }

  /* ── the top-up calculator (any amount) ── */
  function calcHtml(min) {
    return `<div class="acc-calc"><label for="accTokN">Tokens</label>
      <div class="acc-calc-row"><input id="accTok" type="range" min="${min || 1000}" max="20000" step="100" aria-label="Tokens"><input id="accTokN" type="number" inputmode="numeric" min="${min || 1000}" max="100000" step="100"></div>
      <p class="acc-calc-out"><b id="accPrice"></b> <span id="accEdits"></span></p>
      <button type="button" class="acc-btn" id="accBuy">Top up</button></div>`;
  }
  function calcWire(box, start, onDone) {
    const r = box.querySelector("#accTok"), n = box.querySelector("#accTokN");
    const set = (v) => { v = Math.max(+r.min, Math.round(+v / 100) * 100 || +r.min); r.value = Math.min(v, +r.max); n.value = v;
      box.querySelector("#accPrice").textContent = money(Math.max(MIN_TOPUP, v * TOKEN_PRICE));
      box.querySelector("#accEdits").textContent = `about ${Math.floor(v / STANDARD)} edits`; };
    r.addEventListener("input", () => set(r.value));
    n.addEventListener("change", () => set(n.value));
    set(start);
    box.querySelector("#accBuy").addEventListener("click", async () => {
      if (!acc || !acc.signedIn) { close(false); if (!(await openSignIn("plans"))) return; }
      const after = onDone;
      checkout({ kind: "topup", tokens: +n.value }).then((v) => { if (after) after(v); });
    });
  }

  /* ── the gate before an AI edit: enough Tokens for the UPPER estimate ── */
  async function ready({ reason, need, low, lighter }) {
    if (!acc || !acc.signedIn) { const ok = await openSignIn(reason); if (!ok) return false; }
    if (acc.tokens >= need) return true;
    if (typeof lighter === "function") lighter = lighter(acc.tokens);
    const start = Math.max(1000, Math.ceil((need - acc.tokens) / 100) * 100);
    // its own promise: a checkout opened from here replaces the sheet, and its result decides
    return new Promise((res) => {
      let settled = false;
      const fin = (v) => { if (!settled) { settled = true; res(v); } };
      open(`
      <h2 id="accTitle" class="acc-h2">Top up first</h2>
      <p class="acc-lead">Needs ${low}-${need} Tokens. You have ${acc.tokens.toLocaleString()}.</p>
      ${calcHtml(Math.max(100, Math.ceil((need - acc.tokens) / 100) * 100))}
      ${lighter ? `<button type="button" class="acc-btn acc-ghost acc-wide" data-lighter>Use ${esc(lighter.name)} instead (${lighter.low}-${lighter.need})</button>` : `<p class="acc-fine">Or choose a lighter effort level: Low edits use about ${LOW} Tokens.</p>`}`,
        (box) => {
          calcWire(box, start, (v) => fin(!!v && acc.tokens >= need));
          const l = box.querySelector("[data-lighter]");
          if (l) l.addEventListener("click", () => { lighter.apply(); close(true); fin(true); });
        }).then((v) => { if (!v) fin(false); });
    });
  }
  // if a long edit still runs out (backend era), this lets it carry on
  function continueSheet(more) {
    return open(`<p class="acc-eyebrow">Almost done</p><h2 id="accTitle" class="acc-h2">Keep going?</h2><p class="acc-lead">The edit needs about ${more} more Tokens to finish. Top up and it carries on from where it stopped; nothing done so far is lost.</p>${calcHtml(Math.max(100, Math.ceil(more / 100) * 100))}`,
      (box) => calcWire(box, Math.max(1000, Math.ceil(more / 100) * 100), () => {}));
  }
  function charge(n, meta) {
    if (!acc) return null;
    n = Math.min(n, acc.tokens);
    const why = meta && meta.level ? meta.level[0].toUpperCase() + meta.level.slice(1) + (meta.fast ? " + Fast" : "") + " edit" : "Edit";
    // instant on screen; the server confirms the real balance a moment later
    acc.tokens -= n; (acc.ledger = acc.ledger || []).push({ at: Date.now(), d: -n, why });
    changed();
    if (DATA) DATA.spend(n, why).then((left) => { if (left != null && acc) { acc.tokens = left; changed(); } });
    return n;
  }

  /* ── account ── */
  function openAccount() {
    if (!acc || !acc.signedIn) return openSignIn("account");
    const plan = acc.plan === "flex" ? "Flex" : (PLANS.find((p) => p.id === acc.plan) || PLANS[0]).name;
    return open(`<p class="acc-eyebrow">Account</p><h2 id="accTitle" class="acc-h1">${esc(acc.email || "Your account")}</h2>
      <dl class="acc-order"><div><dt>Plan</dt><dd>${esc(plan)}</dd></div><div><dt>Tokens</dt><dd><b>${acc.tokens.toLocaleString()}</b></dd></div></dl>
      <div class="acc-actions"><button type="button" class="acc-btn" data-plans>Plans and top-ups</button><button type="button" class="acc-btn acc-ghost" data-out>Sign out</button></div>
      <p class="acc-eyebrow acc-mt">History</p><ul class="acc-ledger">${acc.ledger.slice(-20).reverse().map((l) => `<li><span>${esc(l.why)}</span><b>${l.d > 0 ? "+" : ""}${l.d}</b></li>`).join("")}</ul>`,
      (box) => {
        box.querySelector("[data-plans]").addEventListener("click", () => { close(false); openPlans(); });
        box.querySelector("[data-out]").addEventListener("click", () => { acc = Object.assign({}, acc, { signedIn: false }); changed(); close(false); if (CFG.auth && CFG.auth.signOut) CFG.auth.signOut(); });
      }, true);
  }

  /* ── what works right now (the owner asked to see it plainly) ── */
  const STATUS = [
    ["Works", "Templates, Auto clip and the workspace", "Pick, drop footage, edit, steer, Fine-tune. Runs on the live site."],
    ["Works", "The AI edit", "Today's AI editor, on the live site (not on a local copy). The new editor with real effort levels comes when the Claude key is on (December)."],
    ["Works", "Manual editor and export", "The full timeline and 1080p export, free."],
    ["Estimate", "Effort levels and Token estimates", "The menu, estimates and the top-up check work; the numbers become exact once real edits are measured."],
    DATA ? ["Works", "Sign up, sign in, reset password", "Real accounts on Ethlenos's server. Codes arrive by email."] : ["Preview", "Sign up, sign in, reset password", "Every screen works on this device. The code shows as an in-app notice instead of an email."],
    ["Preview", "Plans, top-ups and checkout", "Every step works and adds to a preview balance; nothing is charged until payments are connected."],
    DATA ? ["Works", "Tokens balance", "Kept on the server with your account."] : ["Preview", "Tokens balance", "Kept on this device only."],
    ["Partial", "Free-plan protection", "The device check runs now; the server rules (email, network, bot check) are written and wait to be deployed."],
    ["Not yet", "Apple and Google sign-in", "Needs the sign-in service and Apple and Google developer accounts (owner)."]
  ];
  function openStatus() {
    return open(`<p class="acc-eyebrow">Preview build</p><h2 id="accTitle" class="acc-h1">What works right now</h2>
      <p class="acc-lead">Everything below can be tried. Nothing is charged and nothing about you leaves this device until accounts and payments are connected.</p>
      <ul class="acc-status">${STATUS.map(([s, t, d]) => `<li><span class="acc-state" data-s="${s.replace(" ", "").toLowerCase()}">${s}</span><div><b>${esc(t)}</b><p>${esc(d)}</p></div></li>`).join("")}</ul>`, null, true);
  }

  if (DATA) {
    const refresh = () => DATA.me().then((me) => { if (me) { acc = Object.assign({ signedIn: true, preview: false }, me); changed(); } });
    refresh();
    DATA.onSignedIn(refresh);
  }

  window.vcAccount = {
    state: () => ({ signedIn: !!(acc && acc.signedIn), tokens: acc ? acc.tokens : 0, plan: acc && acc.plan, preview: !DATA }),
    onChange: (f) => subs.push(f),
    ready, charge, continueSheet, openPlans, openAccount, openSignIn, openStatus, adopt, PLANS, FLEX
  };
})();
