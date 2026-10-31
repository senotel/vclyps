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

  var VERSION = "0.51.3";
  var RELEASED = "2026-10-31";
  var NOTES = "Fixes: voice effects on a voiceover or text to speech play in both ears; voice effects no longer leave work running after you change them; a caption no longer hangs over the next clip; a text with a wipe in and a wipe out shows both; text to speech reads money and decimals properly ($1,500, $3.50) and retries a failed voice download; removing a vocabulary word restores the timing; retouch keeps two faces apart; cutout and retouch retry after a failed download; remove background stays steady on sped-up clips; late sound effects are never dropped from a fast export. Look: each voice effect has its own drawing and each text-to-speech voice its own monogram; the empty editor says what to add. 0.51.2: Fixes: a new project no longer reuses the last project's cleaned sound, cutouts or face points; a split or trimmed overlay plays the right part of its video; keyframes and tracking follow a trim, split or speed change; an overlay that moves can be grabbed where you see it; Reduce noise cleans once when you let go of Strength (and frees the old one); an audio clip that starts later plays its cleaned sound; Chroma key picks the overlay's own colour; blurred text exports the same on a phone and a computer; the export waits for emoji, retouch and cutout before it starts; Text to speech recovers from a failed download with Try again. 0.51.1: Polish: on/off settings are real switches at the edge of their row, and Settings reads as a calm list; the export progress bar and its percentage are plainer; a finished export is marked in green (done), not the brand red; the last decorative gradients are gone. 0.51.0: New look, first pass: every size, colour and corner now comes from one design scale; calmer type with no shouting capitals; one red button per screen, and red elsewhere only means selected; chosen options show a white outline as in CapCut; each slider is one row (name, track, value); sheets have CapCut's scrolling word tabs; New project is a clean list; Settings is shorter; messages are one-line receipts above the tools; timeline tracks share one set of colours. On a computer the editor now has its tools in a column on the left and a much bigger picture. 0.50.1: Fixes: a fast export that could not read a clip's sound now switches to the standard export instead of saving a silent video; Undo after removing a file from your library brings the file back too; a transition between two parts of one recording with an overlay of it no longer loses a frame; Split, Freeze and Reverse keep a speed curve's timing exactly; copies made by Split and Duplicate no longer share one mask; Freeze keeps the clip's filter strength, crop and look; the frame shape (1:1, 16:9) survives a reload; a paused preview shows the exact frame when you scrub; Undo is kept after a crash. 0.50.0: New: templates (first stage). Save as template, at the end of the editor's tool bar, " +
              "keeps your edit's cuts, looks, transitions, texts, stickers, effects, sounds and library " +
              "music (never your footage) on this device and as a file to share. On New project, From a " +
              "template lists them (or opens a shared file): choose your own videos and photos and the " +
              "same edit is built with them. 0.49.0: New: Retouch and Body effects, as in CapCut. A clip's Retouch has Face (Smooth, " +
              "Whiten, Eyes, Slim face) and Body (Slim, Longer legs); it finds faces and bodies by " +
              "itself and changes only them. Effects has a new Body tab: Outline, Neon edge, Clones, " +
              "Shadow and Glow around the person. All on your device (models download the first time). " +
              "The AI never turns retouch on by itself. 0.48.0: New: Text to speech, in a text's tools after Animation as in CapCut: 14 natural " +
              "English voices (tap one to hear it), a speed, and Add voice, which reads the text aloud " +
              "onto the audio track where the text starts; the music steps back under it. Made on your " +
              "device (the first time downloads the voices, about 90 MB, once). 0.47.0: New: Remove background, as CapCut's Cutout, on a clip or an overlay: Auto finds the " +
              "person and removes everything behind them, no green screen needed, with an Edge " +
              "slider. Put the person on an overlay to stand them in front of another video. Runs on " +
              "your device (the first time it downloads its 16 MB model). 0.46.0: New: Tracking for texts, stickers and overlays, as in CapCut. Select one, tap " +
              "Tracking, move the box over the thing it should follow (drag its corner to fit) and tap " +
              "Start tracking: from the playhead on, it moves with that thing. Runs on your device, " +
              "free. Stop tracking leaves it where it is. 0.45.0: New: Stabilize, near the end of a video clip's tools as in CapCut: Minimal, " +
              "Recommended or Most stable smooths shaky handheld footage (worked out on your device, a " +
              "few seconds per clip; the picture zooms in a little to hide the edges). After an AI edit, " +
              "clips with clear shake are steadied by themselves. 0.44.0: New: Reduce noise, next to Volume on a video or audio clip, as in CapCut. One tap takes " +
              "wind, traffic, fans and hum out from under the voice, with a Strength slider. It runs on " +
              "your device (the first time it downloads its 5 MB sound model), the preview plays the " +
              "cleaned sound and the export has exactly the same. The AI turns it on by itself for " +
              "noisy footage. 0.43.0: New: speed curves. A video clip's Speed now has CapCut's two tabs: Normal, and Curve " +
              "with Montage, Hero, Bullet, Jump cut, Flash in and Flash out (each keeps the clip's " +
              "length) or Custom, a curve you shape with your finger (up is faster). The voice keeps " +
              "its pitch, and the export matches the preview frame for frame. The AI may put Hero on " +
              "the one big action moment of an edit. 0.42.0: New: Chroma key (green screen), in an overlay's tools after Blend as in CapCut. Tap " +
              "Auto to remove a green or blue screen, or Pick colour and tap any colour on the " +
              "picture; Strength, Edge and Spill fine-tune it (Spill takes the green glow off hair " +
              "and skin). 0.41.0: New: Reverse, at the end of a video clip's tool bar as in CapCut. The clip plays " +
              "backwards, sound included (up to 60 seconds; it shows its progress and a second tap " +
              "stops it). Tap Forwards to put the original back. 0.40.0: New: Voice effects, as in CapCut. Select a video clip or an audio clip, tap Voice " +
              "effects and pick one of 16 (Chipmunk, Elf, Deep, Monster, Robot, Alien, Echo, Hall, Cave, " +
              "Underwater, Phone, Megaphone, Radio, Lo-fi, Vibrato, Tremolo); a tap plays a few seconds " +
              "through it, and Amount sets how far it goes. The export sounds exactly like the preview. " +
              "In comedy edits the AI may give a reaction line a comic voice (two at most). 0.39.0: " +
              "New: keyframes, the CapCut diamond next to undo. Select a clip's mask, an overlay or a " +
              "text, tap the diamond, move the playhead and change it: it changes smoothly between the " +
              "two moments (the curve button sets the ease). Mask is now the full package: 15 shapes " +
              "plus Custom (draw your own shape with a finger on the darkened picture), CapCut's " +
              "handles on the picture for width, height, corners, soft edge and turn, and Track: put the " +
              "mask on something in a video, tap Track, and it follows it (worked out on your device, " +
              "free). 0.38.1: Fixed: a tool's panel can now be pulled down by its title bar, so the timeline and " +
              "play row are usable while the tool stays open (the mask keeps its outline on the " +
              "picture). Tap the title bar to bring the panel back. 0.38.0: New: Mask, the CapCut way. Select a clip or an overlay, tap Mask and pick Line, Mirror, " +
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
