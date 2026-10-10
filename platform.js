/* ═══════════════════════════════════════════════════════════
   vClyps — where the app is running
   vClyps runs as a website, as an installed web app (Home Screen, or the
   Play Store's Trusted Web Activity, which is Chrome itself), and inside
   other apps' views: a native app shell built around these same files,
   or the in-app browsers of TikTok, Instagram and Facebook when someone
   taps a link there. A few things a browser does for free don't happen in
   those views. Everything that depends on them goes through here, so it
   is decided in one place and never assumed anywhere else.

     · saving a file      a download in a browser; the share sheet where
                          downloads go nowhere; the app shell's own save
                          when it provides one (see NATIVE below)
     · sign-in windows    Google refuses sign-in inside app views, and
                          pop-ups there can't report back, so sources that
                          need one are only offered where they can finish

   NATIVE: an app shell built around these files may define
   window.VevrisNative before they load. Each member is optional:
     save(blob, name)  → Promise; saves or shares the file natively
     signIns           → true when the shell opens sign-in windows itself
   Without it, everything below falls back to what the web view can do.
   Exposes window.VevrisPlatform.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  function native() { return global.VevrisNative || null; }

  /* An app's own view of a web page, as opposed to a browser. Android marks
     its WebView with "wv"; an iPhone app view leaves "Safari" out of the
     name it gives (a Home Screen web app is the one exception, and says
     so with navigator.standalone); the social apps name themselves. */
  const SOCIAL = /FBAN|FBAV|FB_IAB|Instagram|musical_ly|BytedanceWebview|TikTok|Snapchat|Line\/|Twitter|LinkedInApp|Pinterest/i;
  function embedded(nav) {
    nav = nav || global.navigator || {};
    const ua = String(nav.userAgent || "");
    if (global.Capacitor && typeof global.Capacitor.isNativePlatform === "function" && global.Capacitor.isNativePlatform()) return true;
    if (SOCIAL.test(ua)) return true;
    if (/Android/.test(ua) && /; wv\)/.test(ua)) return true;
    if (/iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua) && nav.standalone !== true) return true;
    return false;
  }

  // installed from the Home Screen or the Play Store: still the real browser
  function installed() {
    try {
      if (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (e) {}
    if (global.navigator && global.navigator.standalone === true) return true;
    return /^android-app:\/\//.test(String((global.document && global.document.referrer) || ""));
  }

  function where() {
    if (native() || embedded()) return "app";
    return installed() ? "installed" : "browser";
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = global.document.createElement("a");
    a.href = url;
    a.download = name;
    global.document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function shareable(file) {
    const nav = global.navigator || {};
    try { return typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] }); }
    catch (e) { return false; }
  }

  /* Saves a file wherever vClyps is. Resolves "saved", "shared" or
     "cancelled"; rejects only when this view can do none of them, with a
     message that says what to do instead. Call it from the tap: the share
     sheet needs one. */
  async function save(blob, name) {
    const n = native();
    if (n && typeof n.save === "function") { await n.save(blob, name); return "saved"; }
    if (!embedded()) { download(blob, name); return "saved"; }
    const File_ = global.File;
    const file = File_ ? new File_([blob], name, { type: blob.type || "" }) : null;
    if (file && shareable(file)) {
      try { await global.navigator.share({ files: [file], title: name }); return "shared"; }
      catch (e) {
        if (e && e.name === "AbortError") return "cancelled";
        // a share sheet that needs a fresh tap says so; anything else falls through
        if (e && e.name === "NotAllowedError") throw new Error("Tap Save again to choose where it goes.");
      }
    }
    throw new Error("This app's view can't save files. Open vClyps in Chrome or Safari to save it.");
  }

  // a direct link still works where downloads do; elsewhere the tap must call save()
  const linksDownload = () => !native() && !embedded();
  const signInsWork = () => { const n = native(); return n ? n.signIns === true : !embedded(); };

  global.VevrisPlatform = {
    where: where,
    embedded: () => embedded(),
    installed: installed,
    save: save,
    linksDownload: linksDownload,
    signInsWork: signInsWork,
    // exported for the tests
    _embedded: embedded
  };
})(typeof window !== "undefined" ? window : globalThis);
