/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — version
   The editing app by Senotel.

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

  var VERSION = "0.33.0";
  var RELEASED = "2026-10-22";
  var NOTES = "The editor works like CapCut: one bar of tools at the bottom, where your thumb is; " +
              "tap something and the bar shows its tools; tap a tool and only its options slide up, " +
              "with a check mark. Play, undo and redo sit in a row under the picture. A button on " +
              "every cut opens transitions. Drag a text, sticker or overlay to the bin under the " +
              "picture to delete it (it asks first, unless you tell it not to; both can be switched " +
              "off in Settings). 0.32.0: 57 transitions that really mix two clips (slides, pushes, wipes, zooms, spins, " +
              "glitches, 3D flips), each with its own length and a moving preview. Clip animations " +
              "in, out and on a loop. Video effects on their own lane: shake, VHS, old film, glitch, " +
              "light leaks, snow and 33 in all. Stickers: emoji and drawn shapes. Record a voiceover. " +
              "Crop a clip, or show it whole on a blurred or coloured background. Overlays move, " +
              "pinch, turn, fade and blend. Real waveforms on sounds and music. Text animations have " +
              "their own In and Out lengths and a loop speed. The preview now shows exactly the " +
              "exported frame. Trim handles sit outside a clip, so short clips are easy to hold. " +
              "0.31.1: texts move on the timeline on phones again: hold one, then drag. " +
              "0.31.0: 99 text animations: 40 ways in, 34 ways out and 25 loops, many of them " +
              "letter by letter or word by word, each shown moving in its own preview. " +
              "Lines show when a text lines up with the middle, the edges or another text. " +
              "The music moves and trims like any clip, and texts stretch from their edges " +
              "on the timeline. The snap tick now works on more phones, iPhones included. " +
              "0.30.0: fonts: 132 for captions and 166 for text, every one different, with a " +
              "picker that shows each in its own letters. Text can be styled like CapCut: " +
              "outline, background, shadow, glow, spacing, curve, rotation, 16 one-tap looks, " +
              "and animations in, out and on a loop; drag it on the picture, pinch it bigger " +
              "and turn it with two fingers. Captions can be changed piece by piece. Clips: " +
              "Adjust (brightness, contrast, saturation, warmth, vignette), mirror, flip and " +
              "rotate, freeze frame and replace. A line and a buzz when things snap together. " +
              "Export settings: 720p to 2K, 24 to 60 frames a second, and quality. The " +
              "timeline looks like CapCut's: frames along each clip, spaced times, more room " +
              "on phones. No more glowing buttons. " +
              "0.29.1: double-tap the timeline to put its zoom back to normal. " +
              "0.29.0: the timeline handles like CapCut: on a phone it only moves sideways " +
              "under your finger and glides when flicked, two fingers pinch it in and " +
              "out, and a clip dragged to the edge carries the timeline with it. On a " +
              "computer the wheel moves along it, Ctrl or Cmd with the wheel zooms, " +
              "Ctrl+B splits and the arrows step a frame. Clips can be renamed. " +
              "0.28.0: faster export: videos now export at 1080p, faster than real time, " +
              "through the device's own video encoder, and keep going in a background " +
              "tab. The old export is still there for devices that can't. Earlier: " +
              "clearing training data asks you to type delete and can be undone; " +
              "vClyps is now by Senotel; 0.27.0: Tidy: remove pauses, filler words and bad takes, or cut words straight " +
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

  global.SenotelVersion = {
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
  try { console.log("%c" + global.SenotelVersion.label, "font-weight:700"); } catch (e) {}
})(window);
