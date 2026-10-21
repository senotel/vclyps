/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — version
   The editing app by Vevris.

   THE SINGLE SOURCE OF TRUTH. Nothing anywhere else in the app may hardcode a
   version; everything reads it from here. Diagnostics, the
   training dataset, saved sessions and the Settings → About panel all pull
   from this file, so one edit updates every one of them.

   ── FORMAT: vClyps X.Y.Z ───────────────────────────────────────────────────

   X · MAJOR — a new GENERATION of vClyps.
       Raise only when the product fundamentally changes: a complete UI/UX
       redesign, an editor architecture rewrite, a fundamental AI overhaul, a
       major change to how people create or edit videos, or a business/pricing
       model change.
       Test: would a user reasonably call this a different generation?

   Y · MINOR — a meaningful new CAPABILITY within this generation.
       New editing modes, new AI abilities, new video categories, new
       workflows, major settings, significant export functionality, new
       integrations, significant user-facing improvements.
       Test: do users gain something they could not do before?

   Z · PATCH — FIX or POLISH of something that already exists.
       Bug and crash fixes, performance, security, small UI adjustments, minor
       AI prompt or model tuning, caption corrections, export fixes,
       accessibility, backend optimisation.
       Test: does this mainly improve or repair existing behaviour?

   ── AI MODEL CHANGES ───────────────────────────────────────────────────────
   Never bump automatically just because the underlying model changed. Classify
   by the effect on the PRODUCT, not the technology:
       small model improvement          → PATCH   (e.g. 1.4.1)
       significant new AI capability    → MINOR   (e.g. 1.5.0)
       AI architecture rebuilt          → MAJOR   (e.g. 2.0.0)
   The number tells the user how significant the change is to them. It is not a
   changelog of which vendor model is wired up this week.

   ── PRE-RELEASE ────────────────────────────────────────────────────────────
   0.x.x means vClyps has not had its first official production release yet.
   1.0.0 is that release. Entertainment mode (Short videos) is close to
   complete; the other modes and Long videos do not exist yet. (The current
   number is VERSION below and nowhere else, this comment included.)

   ── NO BUILD NUMBER ────────────────────────────────────────────────────────
   Deliberate, at the owner's instruction: the version alone identifies a
   release. That means the PATCH must be bumped on every change put in front of
   anyone — it is the only way to tell "the fix didn't work" from "the fix isn't
   running yet". Do not reintroduce a build number.

   ── HOW TO RELEASE ─────────────────────────────────────────────────────────
   1. decide X / Y / Z using the tests above
   2. edit VERSION and RELEASED below
   3. note it in NOTES so About and the changelog agree
   That is the whole process — no build step, nothing generated.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var VERSION = "0.27.0";
  var RELEASED = "2026-10-21";
  var NOTES = "Tidy: remove pauses, filler words and bad takes, or cut words straight " +
              "from the transcript. Post: a title, description and hashtags written " +
              "from what is said, plus captions as .srt and the edit for Premiere or " +
              "DaVinci. Lower thirds, title cards (also as their own intro or outro " +
              "clip) and four transitions. Split screen and screen-and-face layouts. " +
              "Your brand: a logo on every video and your colours. Music now dips " +
              "under speech, fades in and out and is matched in loudness, and one " +
              "ceiling stops the mix from clipping. Find clips by kind of recording. " +
              "A better speech model for the AI Director. A new riser. The play bar " +
              "sits on the picture on phones. Privacy policy and terms. Earlier: " +
              "edits built on retention research (0.26.0).";

  var parts = VERSION.split(".");
  var major = parseInt(parts[0], 10) || 0;

  global.VevrisVersion = {
    version: VERSION,
    released: RELEASED,
    notes: NOTES,

    major: major,
    minor: parseInt(parts[1], 10) || 0,
    patch: parseInt(parts[2], 10) || 0,

    // 0.x.x has not shipped officially yet — see PRE-RELEASE above
    prerelease: major === 0,
    channel: major === 0 ? "dev" : "production",

    full: "vClyps " + VERSION,              // "vClyps 0.9.0"
    label: "vClyps " + VERSION,

    /* One object for logs, analytics, crash reports and support tickets, so
       every channel reports the release in the same shape. */
    stamp: function () {
      return { app: "vClyps", version: VERSION, channel: major === 0 ? "dev" : "production" };
    }
  };

  // So debugging never starts with "which version is this?"
  try { console.log("%c" + global.VevrisVersion.label, "font-weight:700"); } catch (e) {}
})(window);
