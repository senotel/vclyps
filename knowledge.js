/* ================================================================
   vClyps knowledge corpus — what keeps people watching, with its evidence
   Distilled principles of short-form editing, each tied to the evidence
   behind it (research/retention/evidence.md; IDs like E43 point there)
   and graded: A measured real viewing of video, B an adjacent medium or
   mechanism, C platform data, D practitioner. Stored into the Vision-1.0
   training dataset once per corpus version, so a model trained on vClyps'
   data learns the craft and how sure we are of each part of it.

   Version 4 (0.26.0) rewrote this from the retention research. Removed
   because no source supports it: "~70-90% completion comes from getting the
   order right", "85 percent of short-form is watched with sound". Kept
   claims that the research qualifies carry the qualification.
   The rules the app ENFORCES live in retention.js; the Director's briefs
   quote that file, not this one.
   ================================================================ */

window.VEVRIS_KNOWLEDGE = {
  // CORPUS version, not the app version (that is version.js alone). Bumping
  // this re-folds the corpus into the training dataset under a new key.
  version: 4,
  domain: "short-form video editing (Reels / Shorts / TikTok) and story-driven editing",
  source: "research/retention/findings.md (Senotel, 2026-10-09)",
  principles: {

    hooks: [
      ["A hook is the shortest statement of a specific, credible promise that opens one question the video answers", "A/B", "E01 E02 E03 E43"],
      ["The first spoken word comes within half a second; the first frame is a face or the action, never a greeting, logo or title card", "A/C", "E13 E45 E46 P09"],
      ["Specific beats vague: question-framed titles reduced engagement across 22,743 A/B tests because they read as less informative", "A", "E43"],
      ["Surprise captures attention; the rate at which joy rises keeps viewers watching", "A", "E06 E56"],
      ["Show the result first only if 'how' or 'why' is still worth waiting for: revealing the outcome trades suspense for curiosity", "B (mixed)", "E22 E30"],
      ["The hook must be paid off in the video; an unpaid promise costs credibility", "B/C/D", "E05 P06 D01"],
      ["Hook types follow the footage: result, stakes, contrarian, number, confession, visual, relevance, a specific question", "B", "E22 E40 E42"]
    ],

    decision_window: [
      ["Viewers start abandoning within about two seconds of a slow start, short-video viewers fastest", "A", "E46"],
      ["Two decisions: stay or swipe in the first seconds, then commit after the first real payoff (YouTube measures the intro at 30s)", "C", "P04 P06"],
      ["There is no measured '8-second attention span'; the goldfish statistic has no source", "myth", "X01"],
      ["Length alone explains over half of how much of a video is watched; total watch time still rises with length", "A", "E17 E58"]
    ],

    why_people_stay: [
      ["Entertainment moment to moment keeps viewers; information without entertainment makes them leave", "A", "E12"],
      ["An open question recruits anticipated reward and makes people pay time to close it", "B", "E02 E03"],
      ["Unfinished sequences pull people to resume them; they are not remembered better (the Zeigarnik memory claim failed meta-analysis)", "A", "E51 X04"],
      ["Absorption needs an identifiable person, an imaginable plot and believability", "A", "E24 E25"],
      ["Anxious, exciting and hopeful language holds attention; sad language loses it; simple language holds longer", "B", "E19 E26"],
      ["Clear, coherent moments synchronise viewers' brains, and that synchrony predicts what large audiences prefer", "A", "E18 E55"]
    ],

    retention: [
      ["Something new arrives every few seconds: information, a reveal, a laugh, a visual change", "A/B", "E10 E12 E15"],
      ["Keep the main question open until the last 20-30%; close smaller ones along the way", "B", "E01 E06 E51"],
      ["Escalate: stronger beats later, the strongest payoff last; stories move slowly while establishing and faster toward the end", "B", "E21 E27 E53"],
      ["Cut repetition, preamble, tangents, greetings and dead air; keep a short breath before a key word (pauses aid memory; fillers did not hurt recall)", "B", "E12 E48 E49"],
      ["Never stack several new elements in one second; fast cutting only over simple content", "A", "E09 E10"]
    ],

    pacing: [
      ["Within a scene, faster editing raised arousal and memory without overload", "A", "E08"],
      ["Pacing combined with arousing or complex content lowers verbal encoding", "A", "E09"],
      ["Cuts inside a thought go on sentence boundaries; viewers miss a quarter to a third of continuity cuts", "A", "E32"],
      ["Viewers re-segment events when the action changes, not the camera", "A", "E33"],
      ["Successful films vary shot length in waves (1/f), not a metronome", "A", "E31"],
      ["A punch-in is a looming cue that captures attention; constant zooming stops being a signal", "B", "E34 E10"],
      ["No universal cut rate is proven; vClyps' default of a visual change every 4-6s on talking heads is a hypothesis", "hypothesis", "RQ7"]
    ],

    story: [
      ["Suspense (outcome withheld), curiosity (cause withheld), surprise (fact withheld then revealed) are three different orders of the same events", "B", "E22 E23"],
      ["Stories move through staging, plot progression and cognitive tension peaking in the middle-to-late part", "B", "E53"],
      ["Setup earns the payoff: never cut what the payoff depends on", "B", "E22"],
      ["One video, one main question", "B", "E01"]
    ],

    genres: {
      story: "hook (stakes or result) → context (one line) → rising complications → turn → resolution → end on the payoff",
      tutorial: "result first + promise → why (one line) → numbered steps, signposted → the mistake or trick → final result, then stop (E15 E38 E40 P11)",
      explainer: "counterintuitive fact or specific question → intuition → example → twist → one-line takeaway (E01-E03 E19 E38 E39)",
      opinion: "the claim, short of outrage → reasons rising → the best objection → the strongest reason → verdict + a question to the viewer (E54 E26 P03)",
      comedy: "premise or funniest line teased → setup → punchlines escalating → button; never cut a setup from its punchline, never add silence before one (E47 E57)",
      listicle: "number + benefit → items rising, best last → one-line recap (E40 E27)",
      interview: "the guest's strongest line → who they are → the answer → the payoff line (E01)",
      review: "verdict or surprising result → the product working → specifics → one honest downside → verdict (E14 E05)",
      reaction: "peak reaction → trigger → reactions escalating → final reaction (E45 E06)",
      vlog: "the day's best moment → in order, compressed, one new thing per segment → the peak or a reflection",
      talk: "most quotable line → story → principle → call to act (E06 E26)"
    },

    length: [
      ["Choose the shortest length that holds the hook, the context the payoff needs, and the payoff", "A/B", "E17 E27 E28"],
      ["Platforms correct watch time for duration, so padding buys nothing; finishing a longer video is a strong signal on TikTok", "A/C", "E59 E60 P01"],
      ["Remembered evaluations neglect duration and weigh peaks and endings", "A", "E27 E28 E29"]
    ],

    captions: [
      ["Caption all speech: captions improve comprehension, attention and memory for most viewers", "A (review)", "E37"],
      ["Many people watch without sound in public (69% in one survey); Facebook's internal tests found +12% view time with captions", "C", "P12 P13"],
      ["Short phrases synced to speech, one key word emphasised (signalling)", "A (learning)", "E38"],
      ["No decorative text that is not the message", "A (learning)", "E39"]
    ],

    sound_effects: [
      ["A sound marks a moment the eye also sees (a cut, text arriving, a reveal), sparingly; sound on everything is noise", "B", "E10"],
      ["Rising sound intensity is perceived as a larger change and raises alertness: a riser into a reveal is grounded in physiology", "B", "E35 E36"],
      ["Never bury a word that matters; tender footage often wants none; no comedy stings in sincere videos", "B", "E10 RQ8"]
    ],

    music: [
      ["Tempo sets arousal, mode sets mood: choose music by the story's emotion and pace, never its topic", "B", "E50"],
      ["None when the footage has its own music, when the natural sound is the content, or for grief and anything intimate", "practice", "RQ8"],
      ["Under speech, music is a bed: instrumental, quiet enough that every word is clear", "practice", "RQ8"],
      ["TikTok users call sound essential (survey)", "C", "P10"]
    ],

    endings: [
      ["End on the payoff or right after it; outros and sign-offs are where end dips happen", "A/C", "E27 P06"],
      ["The last line is the strongest available, or a callback to the hook", "A", "E27 E29"],
      ["A loop-friendly ending (the last line leads into the first) is a hypothesis: rewatches count, platforms do not publish how", "hypothesis", "RQ10"],
      ["In opinion videos a real question to the viewer replaces 'follow for more' (sends and comments rank)", "C", "P03"]
    ],

    what_platforms_measure: [
      ["YouTube optimises valued watch time, using survey ratings predicted by a model", "C", "P02"],
      ["Instagram's head named watch time, likes per reach and sends per reach as the strongest signals", "C", "P03"],
      ["TikTok weights whether a viewer finishes a longer video", "C", "P01"]
    ]
  }
};
