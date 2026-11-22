/* ═══════════════════════════════════════════════════════════
   next/auth.js: sign in, sign up, reset password, verify, onboarding (0.84.0)

   A full screen, one step at a time, one thing that stands out per step
   (the filled button), the brand at the top of every step.
   - Value first (Duolingo): nobody meets this screen before they have
     chosen a template and added footage; it opens when the first AI edit
     needs an account, then goes straight back to that edit.
   - Email first; Apple and Google beside it (Apple at least as prominent,
     Apple HIG). Both hidden inside Instagram/TikTok webviews, where they fail.
   - Verify without leaving the app: copy the code from the notification and
     paste. Six boxes drawn over ONE real input (input-otp's pattern; web.dev
     and Twilio: split inputs break paste and autofill), so a paste fills
     every box, phone autofill works, and it continues by itself.
   - Reset password in three steps: email, code, new password; then signed in.
   - Onboarding like Duolingo: one question a screen, big choices, a progress
     bar that starts with credit already earned (the account counts as the
     first step: the endowed-progress effect), then a short "ready" moment and
     back to work. Every answer is optional (Skip).
   Accounts not live: window.VCLYPS_ACCOUNTS.auth is empty, so a labelled
   PREVIEW backend on this device stands in; the code arrives as an in-app
   notice marked Preview. With accounts live the same screens call the real one.
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const CFG = Object.assign({ auth: null }, window.OUTCLIP_ACCOUNTS || window.VCLYPS_ACCOUNTS || {});
  const inApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Bytedance|Snapchat|LinkedInApp|Line\//i.test(navigator.userAgent || "");
  const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

  /* ── the preview backend (this device only, clearly labelled) ── */
  const P = (function () {
    const K = "vc-auth-preview-users";
    const users = () => { try { return JSON.parse(localStorage.getItem(K)) || {}; } catch (e) { return {}; } };
    const keep = (u) => { try { localStorage.setItem(K, JSON.stringify(u)); } catch (e) {} };
    const codes = {};
    async function hash(pw, salt) {
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 }, key, 256);
      return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return {
      preview: true,
      async lookup(email) { return { exists: !!users()[email.toLowerCase()] }; },
      async signIn(email, pw) { const u = users()[email.toLowerCase()]; if (!u || (await hash(pw, u.salt)) !== u.hash) return { ok: false, message: "That password doesn't match this email." }; return { ok: true }; },
      async sendCode(email) { const c = String(Math.floor(100000 + Math.random() * 900000)); codes[email.toLowerCase()] = c; notice(c, email); return { ok: true }; },
      async verify(email, code) { return codes[email.toLowerCase()] === code ? { ok: true } : { ok: false, message: "That code doesn't match. Check the newest email and try again." }; },
      async setPassword(email, pw) { const u = users(), salt = Math.random().toString(36).slice(2); u[email.toLowerCase()] = { salt, hash: await hash(pw, salt) }; keep(u); return { ok: true }; },
      redirect() { return { ok: false, message: "Apple and Google sign-in open when accounts go live. Use your email for now." }; }
    };
  })();
  const A = CFG.auth || P;

  // the preview's stand-in for the email: a notice that slides in like a phone notification
  function notice(code, email) {
    let n = document.querySelector(".auth-notice");
    if (!n) { n = document.createElement("div"); n.className = "auth-notice"; n.setAttribute("role", "status"); document.body.appendChild(n); }
    n.innerHTML = `<span class="auth-notice-tag">Preview</span><span class="auth-notice-text"><b>Ethlenos code: ${code}</b></span><button type="button" class="auth-notice-copy">Copy</button>`;
    n.querySelector(".auth-notice-copy").addEventListener("click", async () => { try { await navigator.clipboard.writeText(code); n.querySelector(".auth-notice-copy").textContent = "Copied"; } catch (e) {} setTimeout(() => n.classList.remove("show"), 900); });
    requestAnimationFrame(() => n.classList.add("show"));
    clearTimeout(n._t); n._t = setTimeout(() => n.classList.remove("show"), 12000);
  }

  /* ── the screen ── */
  let root, body, bar, resolve = null, S = {};
  const I = {
    x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    google: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z"/></svg>',
    apple: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.9a4.8 4.8 0 0 0-4 2.5c-1.7 3-.4 7.3 1.2 9.7.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8s2.1-1.2 2.9-2.4c.9-1.3 1.3-2.6 1.3-2.7a4.2 4.2 0 0 1-2.3-3.7zM14 5.3a4.3 4.3 0 0 0 1-3.3 4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1 3.2A3.6 3.6 0 0 0 14 5.3z"/></svg>'
  };
  function mount() {
    root = document.createElement("div");
    root.className = "auth";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "authTitle");
    root.innerHTML = `<header class="auth-head"><button type="button" class="auth-icon" data-back aria-label="Back">${I.back}</button>
      <button type="button" class="auth-brand" data-brandclose aria-label="Close"><svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="2" width="18" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-in" x="3" y="9.8" width="5" height="4.4" rx="1.4" fill="currentColor"/><rect class="bm-cut" x="9.5" y="9.8" width="7.5" height="4.4" rx="1.4" fill="#dc143c"/><rect x="3" y="17.6" width="18" height="4.4" rx="1.4" fill="currentColor"/></svg><span class="brand-word">Ethlenos</span><span>by Senotel</span></button><button type="button" class="auth-icon" data-close aria-label="Close">${I.x}</button></header>
      <div class="auth-bar" aria-hidden="true"><span></span></div><main class="auth-body"></main>`;
    document.body.appendChild(root);
    body = root.querySelector(".auth-body");
    bar = root.querySelector(".auth-bar span");
    root.querySelector("[data-close]").addEventListener("click", () => finish(false));
    root.querySelector("[data-brandclose]").addEventListener("click", () => finish(false));
    root.querySelector("[data-back]").addEventListener("click", () => (S.back ? S.back() : finish(false)));
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") finish(false); });
  }
  function finish(v) { root.classList.remove("open"); document.body.classList.remove("auth-open"); const r = resolve; resolve = null; if (r) r(v); }

  // one step: title, line, its content; the old step slides out, the new in
  function step(html, { progress = null, back = null, wire } = {}) {
    S.back = back;
    root.querySelector("[data-back]").style.visibility = back ? "visible" : "hidden";
    root.querySelector(".auth-bar").classList.toggle("on", progress != null);
    if (progress != null) bar.style.transform = `scaleX(${progress})`;
    const el = document.createElement("section");
    el.className = "auth-step";
    el.innerHTML = html;
    const old = body.querySelector(".auth-step");
    if (old && !still()) { old.classList.add("out"); setTimeout(() => old.remove(), 220); } else if (old) old.remove();
    body.appendChild(el);
    if (wire) wire(el);
    const f = el.querySelector("[autofocus]") || el.querySelector("input, button.auth-primary");
    if (f) setTimeout(() => f.focus({ preventScroll: true }), still() ? 0 : 120);
    return el;
  }
  const err = (el, msg) => { const e = el.querySelector(".auth-err"); if (!e) return; e.textContent = msg || ""; e.hidden = !msg; };
  const busy = (btn, on, label) => { btn.disabled = on; if (label) btn.textContent = on ? label : btn.dataset.label; };

  /* ── 1. email first ── */
  function emailStep() {
    step(`<p class="auth-eyebrow">Account</p><h1 id="authTitle">${S.reason === "edit" ? "One step before your edit" : "Welcome to Ethlenos"}</h1>
      <form class="auth-form" novalidate><label for="authEmail">Email</label>
        <input id="authEmail" type="email" inputmode="email" autocomplete="username email" autocapitalize="off" spellcheck="false" placeholder="you@example.com" value="${esc(S.email || "")}" required autofocus>
        <p class="auth-err" role="alert" hidden></p>
        <button type="submit" class="auth-primary" data-label="Continue">Continue</button></form>
      ${inApp ? `<p class="auth-note">Apple and Google sign-in don't work inside this app's browser. Use your email, or open Ethlenos in Safari or Chrome.</p>` : `<div class="auth-or"><span>or</span></div>
      <button type="button" class="auth-alt" data-provider="apple">${I.apple}Continue with Apple</button>
      <button type="button" class="auth-alt" data-provider="google">${I.google}Continue with Google</button>`}
      <p class="auth-fine">By continuing you agree to the <a href="terms.html" target="_blank" rel="noopener">terms</a> and the <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a>.</p>`,
      { progress: S.flow === "new" ? 0.2 : null, wire(el) {
        const f = el.querySelector("form"), btn = f.querySelector("button");
        f.addEventListener("submit", async (e) => {
          e.preventDefault();
          const v = el.querySelector("#authEmail").value.trim();
          if (!emailOk(v)) { el.querySelector("#authEmail").setAttribute("aria-invalid", "true"); return err(el, "Enter an email address like name@example.com."); }
          S.email = v; busy(btn, true, "Checking");
          const r = await A.lookup(v);
          busy(btn, false, "Continue");
          if (r.exists) { S.flow = "back"; passwordStep(); } else { S.flow = "new"; createStep(); }
        });
        el.querySelectorAll("[data-provider]").forEach((b) => b.addEventListener("click", async () => { const r = await A.redirect(b.dataset.provider); if (r && !r.ok) err(el, r.message); }));
      } });
  }

  /* ── 2a. returning: password, or a code instead ── */
  function passwordStep() {
    step(`<p class="auth-eyebrow">Sign in</p><h1 id="authTitle">Welcome back</h1><p class="auth-lead"><span class="auth-chip">${esc(S.email)}</span> <button type="button" class="auth-link" data-change>Change</button></p>
      <form class="auth-form" novalidate><label for="authPw">Password</label>
        <div class="auth-pw"><input id="authPw" type="password" autocomplete="current-password" required autofocus><button type="button" class="auth-eye" aria-label="Show password" aria-pressed="false">${I.eye}</button></div>
        <p class="auth-err" role="alert" hidden></p>
        <button type="submit" class="auth-primary" data-label="Sign in">Sign in</button></form>
      <div class="auth-links"><button type="button" class="auth-link" data-forgot>Forgot password?</button><button type="button" class="auth-link" data-code>Email me a code instead</button></div>`,
      { back: emailStep, wire(el) {
        eye(el);
        el.querySelector("[data-change]").addEventListener("click", emailStep);
        el.querySelector("[data-forgot]").addEventListener("click", () => { S.flow = "reset"; codeStep("reset"); });
        el.querySelector("[data-code]").addEventListener("click", () => codeStep("signin"));
        const f = el.querySelector("form"), btn = f.querySelector("button");
        f.addEventListener("submit", async (e) => { e.preventDefault(); busy(btn, true, "Signing in"); const r = await A.signIn(S.email, el.querySelector("#authPw").value); busy(btn, false, "Sign in"); if (!r.ok) return err(el, r.message); done(false); });
      } });
  }

  /* ── 2b. new: create a password (checked as you type) ── */
  function createStep(forReset) {
    step(`<p class="auth-eyebrow">${forReset ? "Reset password" : "New account"}</p><h1 id="authTitle">${forReset ? "Choose a new password" : "Create a password"}</h1><p class="auth-lead">${forReset ? "Then you're back in." : esc(S.email)}</p>
      <form class="auth-form" novalidate><label for="authNew">Password</label>
        <div class="auth-pw"><input id="authNew" type="password" autocomplete="new-password" minlength="10" required autofocus aria-describedby="authRules"><button type="button" class="auth-eye" aria-label="Show password" aria-pressed="false">${I.eye}</button></div>
        <div class="auth-meter" aria-hidden="true"><span></span></div>
        <ul class="auth-rules" id="authRules"><li data-r="len">10+ characters</li><li data-r="mix">A number or symbol</li><li data-r="own">Not easy to guess</li></ul>
        <p class="auth-err" role="alert" hidden></p>
        <button type="submit" class="auth-primary" data-label="Continue" disabled>Continue</button></form>`,
      { progress: forReset ? null : 0.32, back: forReset ? null : emailStep, wire(el) {
        eye(el);
        const inp = el.querySelector("#authNew"), btn = el.querySelector("button[type=submit]");
        const COMMON = /^(password|123456|qwerty|letmein|welcome|iloveyou|admin|abc123|111111|ethlenos|outclip|vclyps)/i;
        const check = () => {
          const v = inp.value, user = (S.email || "").split("@")[0].toLowerCase();
          const r = { len: v.length >= 10, mix: /[a-z]/i.test(v) && /[\d\W_]/.test(v), own: v.length > 0 && !COMMON.test(v) && !(user.length > 2 && v.toLowerCase().includes(user)) };
          Object.entries(r).forEach(([k, ok]) => el.querySelector(`[data-r="${k}"]`).classList.toggle("ok", ok));
          const score = Object.values(r).filter(Boolean).length + (v.length >= 14 ? 1 : 0);
          el.querySelector(".auth-meter span").style.transform = `scaleX(${score / 4})`;
          btn.disabled = !(r.len && r.mix && r.own);
        };
        inp.addEventListener("input", check);
        el.querySelector("form").addEventListener("submit", async (e) => {
          e.preventDefault(); if (btn.disabled) return;
          S.pw = inp.value;
          if (forReset) { busy(btn, true, "Saving"); await A.setPassword(S.email, S.pw); busy(btn, false, "Continue"); return done(false); }
          codeStep("signup");
        });
      } });
  }
  function eye(el) {
    el.querySelectorAll(".auth-eye").forEach((b) => b.addEventListener("click", () => { const i = b.previousElementSibling, show = i.type === "password"; i.type = show ? "text" : "password"; b.setAttribute("aria-pressed", String(show)); b.setAttribute("aria-label", show ? "Hide password" : "Show password"); i.focus(); }));
  }

  /* ── 3. the code: copy it from the notification, paste, done ── */
  function codeStep(purpose) {
    const forReset = purpose === "reset";
    const el = step(`<p class="auth-eyebrow">${forReset ? "Reset password" : "Verify your email"}</p><h1 id="authTitle">${forReset ? "Reset your password" : "Check your email"}</h1>
      <p class="auth-lead">Sent to <b>${esc(S.email)}</b></p>
      <form class="auth-form" novalidate>
        <div class="otp"><input id="authCode" class="otp-input" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="12" aria-label="6-digit code" required autofocus>
          <div class="otp-boxes" aria-hidden="true">${"<span></span>".repeat(6)}</div></div>
        <p class="auth-err" role="alert" hidden></p>
        <button type="button" class="auth-paste">Paste code</button>
        <button type="submit" class="auth-primary" data-label="Continue" disabled>Continue</button></form>
      <div class="auth-links"><button type="button" class="auth-link" data-resend disabled>Send a new code in 30 s</button><button type="button" class="auth-link" data-change>Use a different email</button></div>`,
      { progress: S.flow === "new" ? 0.44 : null, back: forReset ? passwordStep : (S.flow === "new" ? () => createStep() : passwordStep), wire(el) {
        const inp = el.querySelector("#authCode"), boxes = [...el.querySelectorAll(".otp-boxes span")], btn = el.querySelector("button[type=submit]");
        const paint = () => {
          const d = inp.value.replace(/\D/g, "").slice(0, 6);
          if (inp.value !== d) inp.value = d;
          boxes.forEach((b, i) => { b.textContent = d[i] || ""; b.classList.toggle("on", document.activeElement === inp && i === Math.min(d.length, 5)); b.classList.toggle("full", !!d[i]); });
          btn.disabled = d.length !== 6;
          if (d.length === 6 && !inp._sent) { inp._sent = true; setTimeout(() => el.querySelector("form").requestSubmit(), 120); }
          if (d.length < 6) inp._sent = false;
        };
        inp.addEventListener("input", () => { err(el, ""); el.querySelector(".otp").classList.remove("bad"); paint(); });
        // a paste of the whole line ("Your Ethlenos code is 482 913") still lands as the six digits
        inp.addEventListener("paste", (e) => {
          const t = (e.clipboardData || window.clipboardData).getData("text") || "";
          const m = t.match(/\b(\d{3})[\s-]?(\d{3})\b/) || t.match(/\d{6}/);
          if (!m) return;
          e.preventDefault();
          inp.value = m[1] && m[2] ? m[1] + m[2] : m[0];
          err(el, ""); el.querySelector(".otp").classList.remove("bad"); paint();
        });
        ["focus", "blur", "keyup", "click"].forEach((ev) => inp.addEventListener(ev, paint));
        el.querySelector(".auth-paste").addEventListener("click", async () => {
          try { const t = await navigator.clipboard.readText(); const d = (t.match(/\d{6}/) || [t.replace(/\D/g, "")])[0].slice(0, 6); if (!d) return err(el, "There's no code on your clipboard yet. Copy it from the email notification."); inp.value = d; inp.focus(); paint(); }
          catch (e) { inp.focus(); err(el, "Press and hold in the boxes and choose Paste."); }
        });
        el.querySelector("[data-change]").addEventListener("click", emailStep);
        el.querySelector("form").addEventListener("submit", async (e) => {
          e.preventDefault(); if (btn.disabled) return;
          busy(btn, true, "Checking");
          const r = await A.verify(S.email, inp.value, purpose);
          busy(btn, false, "Continue");
          if (!r.ok) { el.querySelector(".otp").classList.add("bad"); inp._sent = false; inp.select(); return err(el, r.message); }
          const nt = document.querySelector(".auth-notice"); if (nt) nt.classList.remove("show");
          if (forReset) return createStep(true);
          if (purpose === "signup") { await A.setPassword(S.email, S.pw); S.pw = null; await adoptNow(true); return onboard(0); }
          done(false);
        });
        // resend: a countdown, then a fresh code
        const rs = el.querySelector("[data-resend]");
        let left = 30;
        const tick = () => { if (!rs.isConnected) return; if (--left <= 0) { rs.disabled = false; rs.textContent = "Send a new code"; return; } rs.textContent = `Send a new code in ${left} s`; setTimeout(tick, 1000); };
        setTimeout(tick, 1000);
        rs.addEventListener("click", async () => { rs.disabled = true; await A.sendCode(S.email, purpose); left = 30; rs.textContent = "Sent. A new one in 30 s"; setTimeout(tick, 1000); });
        paint();
      } });
    A.sendCode(S.email, purpose);
    return el;
  }

  /* ── 4. onboarding: one question a screen (Duolingo) ── */
  const Q = [
    { id: "make", title: "What do you make?", lead: "", pick: "one", options: [["talk", "Talking videos"], ["vlog", "Vlogs and day-in-my-life"], ["business", "Products and business"], ["gaming", "Gaming"], ["sports", "Sports and fitness"], ["podcast", "Podcasts and interviews"], ["trailer", "Films and trailers"], ["other", "Something else"]] },
    { id: "post", title: "Where do you post?", lead: "", pick: "many", options: [["tiktok", "TikTok"], ["reels", "Instagram Reels"], ["shorts", "YouTube Shorts"], ["youtube", "YouTube"], ["linkedin", "LinkedIn"], ["other", "Somewhere else"]] },
    { id: "work", title: "How do you like to work?", lead: "", pick: "one", options: [["ai", "Let the AI edit it for me"], ["both", "AI first, then I fine-tune"], ["hand", "I mostly edit by hand"]] },
    { id: "often", title: "How often do you post?", lead: "", pick: "one", options: [["daily", "Every day"], ["week3", "A few times a week"], ["weekly", "About once a week"], ["now", "Now and then"]] }
  ];
  function onboard(i) {
    if (i >= Q.length) return ready();
    const q = Q[i], ans = S.answers || (S.answers = {});
    step(`<p class="auth-eyebrow">Question ${i + 1} of ${Q.length}</p><h1 id="authTitle">${esc(q.title)}</h1>${q.lead ? `<p class="auth-lead">${esc(q.lead)}</p>` : "<div class=\"auth-gap\"></div>"}
      <div class="auth-choices" role="${q.pick === "one" ? "radiogroup" : "group"}" aria-labelledby="authTitle">${q.options.map(([v, l]) => `<button type="button" class="auth-choice" role="${q.pick === "one" ? "radio" : "checkbox"}" aria-checked="false" data-v="${v}">${esc(l)}</button>`).join("")}</div>
      <button type="button" class="auth-primary" data-label="Continue" disabled>Continue</button>
      <button type="button" class="auth-link auth-skip">Skip</button>`,
      { progress: 0.52 + (i * 0.4) / Q.length, back: i ? () => onboard(i - 1) : null, wire(el) {
        const btn = el.querySelector(".auth-primary"), sel = new Set(ans[q.id] ? [].concat(ans[q.id]) : []);
        const paint = () => { el.querySelectorAll(".auth-choice").forEach((c) => c.setAttribute("aria-checked", String(sel.has(c.dataset.v)))); btn.disabled = !sel.size; };
        el.querySelectorAll(".auth-choice").forEach((c) => c.addEventListener("click", () => {
          if (q.pick === "one") { sel.clear(); sel.add(c.dataset.v); paint(); ans[q.id] = c.dataset.v; setTimeout(() => onboard(i + 1), still() ? 0 : 260); return; }
          sel.has(c.dataset.v) ? sel.delete(c.dataset.v) : sel.add(c.dataset.v); paint();
        }));
        btn.addEventListener("click", () => { ans[q.id] = q.pick === "one" ? [...sel][0] : [...sel]; onboard(i + 1); });
        el.querySelector(".auth-skip").addEventListener("click", () => onboard(i + 1));
        paint();
      } });
  }
  // what the answers set: the first template category, the default way in, the effort level
  function setup(a) {
    const cat = { talk: "entertainment", vlog: "vlog", business: "business", gaming: "gaming", sports: "sports", podcast: "podcast", trailer: "trailer" }[a.make] || "all";
    const way = { ai: "auto", both: "auto", hand: "manual" }[a.work] || "auto";
    const level = a.often === "daily" ? "light" : "standard";
    return { cat, way, level };
  }
  function ready() {
    const a = S.answers || {}, s = setup(a);
    try { localStorage.setItem("vc-onboard", JSON.stringify({ answers: a, setup: s, at: Date.now() })); } catch (e) {}
    const tok = window.vcAccount ? vcAccount.state().tokens : 60;
    const goal = { daily: "a video a day", week3: "three videos a week", weekly: "one video a week", now: "your next video" }[a.often] || "your next video";
    step(`<div class="auth-done" aria-hidden="true"><svg viewBox="0 0 52 52" width="72" height="72"><circle cx="26" cy="26" r="24" fill="none"/><path d="M15 27l7 7 15-16" fill="none"/></svg></div>
      <h1 id="authTitle">You're set</h1><p class="auth-lead">${tok ? tok + " free Tokens are in your account." : "This device already had its free Tokens, so this account starts at 0; plans and top-ups are one tap away."} Your goal: ${esc(goal)}. ${s.way === "manual" ? "The timeline is one tap away; the AI is there when you want it." : "Start with " + (s.level === "light" ? "Light" : "Standard") + " effort; change it any time."}</p>
      <button type="button" class="auth-primary" data-label="${S.reason === "edit" ? "Start my edit" : "Start editing"}">${S.reason === "edit" ? "Start my edit" : "Start editing"}</button>`,
      { progress: 1, wire(el) { el.querySelector(".auth-primary").addEventListener("click", () => done(true)); } });
  }

  // signed in: hand the account to vcAccount (the welcome Tokens are decided there), then back to whatever was waiting
  async function adoptNow(isNew) { if (window.vcAccount && vcAccount.adopt) await vcAccount.adopt(S.email, { isNew: !!isNew }); }
  async function done(isNew) {
    await adoptNow(S.flow === "new" || isNew);
    finish(true);
  }

  window.vcAuth = {
    open(reason) {
      if (!root) mount();
      S = { reason: reason || "account", flow: null, email: S.email || "" };
      root.classList.add("open"); document.body.classList.add("auth-open");
      emailStep();
      return new Promise((r) => { resolve = r; });
    },
    preview: !CFG.auth
  };
})();
