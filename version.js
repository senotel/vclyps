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
   complete; Business mode has its first version (0.34.0); Long videos does
   not exist yet. (The current
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

  var VERSION = "0.38.0";
  var RELEASED = "2026-10-24";
  var NOTES = "New: Mask, the CapCut way. Select a clip or an overlay, tap Mask and pick Line, Mirror, " +
              "Circle, Rectangle, Heart or Star; set its size, width, turn, soft edge and corners, " +
              "or Invert it to cut the shape out. On a clip, drag on the picture to move the mask " +
              "and use two fingers to make it bigger or smaller and turn it. 0.37.0: " +
              "New: pro colour tools in Adjust (tabs Basic, HSL, Curves, Wheels). Auto evens out a " +
              "clip's light and colour in one tap; HSL changes one of eight colours only; Curves " +
              "bends light and dark for all channels or one; Wheels tint the shadows, midtones and " +
              "highlights. The AI also evens out clips that are too dark or too bright. 0.36.0: " +
              "New: select several things at once. Select a text, sticker, overlay, sound or clip, " +
              "tap Select more, then tap others on the timeline (Shift or Ctrl-click on a computer). " +
              "Drag one to move them all, or Duplicate or Delete them together; Done ends it. " +
              "0.35.0: New, the CapCut way: 100 filters in 7 groups (Portrait, Film, Vintage, Black and " +
              "white, Food, Scenery, Mood) with a strength slider and tiles that show your own clip; " +
              "40 text templates (Text, then Templates); Copy style and Paste style on any text; beat " +
              "marks on the music and Cut to the beat (select the music, then Beats); the sound now " +
              "blends across transitions instead of jumping; and every export is levelled to the " +
              "loudness TikTok, Reels and YouTube play at (Export, then Sound). The AI uses all of " +
              "it: it picks from the 100 filters, gives titles designed templates, and puts its cuts " +
              "on the music's beat. 0.34.1: " +
              "Fixed on phones: after an edit the timeline was squeezed off the screen and could " +
              "not be scrolled, and it could not be moved while the video played. The timeline now " +
              "scrolls up and down through its tracks, the picture makes room for it, touching the " +
              "timeline pauses the video (as in CapCut), the edit's summary is one line (tap for " +
              "more) and the Business brief folds behind a Brief button. 0.34.0: " +
              "New: Business mode (first version). Pick Business on the New project screen, add " +
              "your product footage, fill in the product, what it does, how it should end and the " +
              "tone, and press Edit. vClyps plans a launch-style video: a hook, the reveal, two or " +
              "three highlights shown in your footage, animated titles and feature labels, music and " +
              "a few sounds, and an end card with your product name and call to action. Every claim " +
              "on screen comes from what you wrote or what is in the footage. 0.33.0: " +
              "The editor works like CapCut: one bar of tools at the bottom, where your thumb is; " +
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
