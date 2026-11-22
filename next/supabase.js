/* ═══════════════════════════════════════════════════════════
   next/supabase.js: real accounts through Supabase (0.88.0)

   Off until next/config.js has the project's URL and key; then it sets
   window.OUTCLIP_ACCOUNTS.auth (used by next/auth.js) and .data (used by
   next/account.js) before those load, and next/auth.js leaves its preview.

   Flows (all six-digit codes, so nobody has to leave the app):
   - sign up:  signInWithOtp (creates the user) -> verifyOtp -> updateUser(password)
   - sign in:  signInWithPassword, or a code instead (signInWithOtp, no new user)
   - reset:    resetPasswordForEmail -> verifyOtp(recovery) -> updateUser(password)
   - Apple / Google: signInWithOAuth, a full-page redirect (webviews block pop-ups)
   The code email is OutClip's own (supabase/emails/*.html, sent through our
   SMTP), with the code in the subject so the phone's notification shows it.
   The SDK loads on first use, so the page stays light.
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const C = window.OUTCLIP_CONFIG || {};
  if (!C.supabaseUrl || !C.supabaseKey) return;   // preview stays on

  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  let client = null;
  function sb() {
    if (client) return Promise.resolve(client);
    return new Promise((ok, no) => {
      const s = document.createElement("script");
      s.src = SDK; s.async = true;
      s.onload = () => { client = window.supabase.createClient(C.supabaseUrl, C.supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce" } }); ok(client); };
      s.onerror = () => no(new Error("Couldn't reach the sign-in service. Check your connection."));
      document.head.appendChild(s);
    });
  }
  const plain = (e, fallback) => {
    const m = String((e && e.message) || "");
    if (/rate limit|too many/i.test(m)) return "Too many tries. Wait a minute and try again.";
    if (/invalid login|invalid credentials/i.test(m)) return "That password doesn't match this email.";
    if (/expired|invalid.*otp|token/i.test(m)) return "That code doesn't match or has expired. Use the newest email.";
    return fallback;
  };

  const auth = {
    preview: false,
    async lookup(email) {
      const c = await sb();
      const { data, error } = await c.rpc("outclip_email_exists", { e: email });
      return { exists: !error && !!data };
    },
    async signIn(email, password) {
      const c = await sb();
      const { error } = await c.auth.signInWithPassword({ email, password });
      return error ? { ok: false, message: plain(error, "That password doesn't match this email.") } : { ok: true };
    },
    async sendCode(email, purpose) {
      const c = await sb();
      const r = purpose === "reset"
        ? await c.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
        : await c.auth.signInWithOtp({ email, options: { shouldCreateUser: purpose === "signup", emailRedirectTo: location.origin + location.pathname } });   // until the code template is on, the email carries a link back to this page
      return r.error ? { ok: false, message: plain(r.error, "We couldn't send a code. Check the address and try again.") } : { ok: true };
    },
    async verify(email, token, purpose) {
      const c = await sb();
      const { error } = await c.auth.verifyOtp({ email, token, type: purpose === "reset" ? "recovery" : "email" });
      return error ? { ok: false, message: plain(error, "That code doesn't match. Check the newest email and try again.") } : { ok: true };
    },
    async setPassword(email, password) {
      const c = await sb();
      const { error } = await c.auth.updateUser({ password });
      return error ? { ok: false, message: plain(error, "Couldn't save the password. Try another one.") } : { ok: true };
    },
    async redirect(provider) {
      const c = await sb();
      const { error } = await c.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname + "?flow=start" } });
      return error ? { ok: false, message: plain(error, "That sign-in isn't available yet. Use your email.") } : { ok: true };
    },
    async signOut() { const c = await sb(); await c.auth.signOut(); }
  };

  /* The account's numbers live in Postgres (supabase/schema.sql). The browser
     can read its own row and ask for the welcome Tokens or spend Tokens through
     functions that check everything on the server; it can never add Tokens. */
  const data = {
    async me() {
      const c = await sb();
      const { data: s } = await c.auth.getSession();
      if (!s || !s.session) return null;
      const { data: row } = await c.from("accounts").select("tokens, plan").single();
      const { data: led } = await c.from("ledger").select("delta, reason, at").order("at", { ascending: false }).limit(20);
      return { email: s.session.user.email, tokens: row ? row.tokens : 0, plan: row ? row.plan : "free", ledger: (led || []).map((l) => ({ at: Date.parse(l.at), d: l.delta, why: l.reason })) };
    },
    async claimWelcome(signals) {
      const c = await sb();
      const { data: g } = await c.rpc("outclip_claim_welcome", { device: signals.device || "", fp: signals.fp || "" });
      return { grant: g || 0 };
    },
    async spend(n, reason) {
      const c = await sb();
      const { data: left, error } = await c.rpc("outclip_spend", { n, reason });
      return error ? null : left;
    },
    async checkout(body) {
      const c = await sb();
      const { data: r, error } = await c.functions.invoke("polar-checkout", { body });
      if (error || !r || !r.url) throw new Error("Checkout isn't available right now.");
      location.href = r.url;   // Polar's own secure page; it comes back here when done
    },
    async onSignedIn(fn) { const c = await sb(); c.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_IN") fn(); }); }
  };

  window.OUTCLIP_ACCOUNTS = Object.assign(window.OUTCLIP_ACCOUNTS || {}, { auth, data, pay: C.payments ? { checkout: (o) => data.checkout(o) } : null });
})();
