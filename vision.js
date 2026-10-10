/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — vision.js · Senotel Vision-1.0
   The editing app by Vevris.

   An editor that runs on the device: no server, no key, no cost per edit, and
   nothing leaves the phone. It takes the same request the AI Director gets
   and answers in the same shape, so the rest of vClyps cannot tell them
   apart (intelligence.js, VisionProvider).

   HOW IT WAS TAUGHT. Not by imitation alone. It was built as a curriculum,
   from what a video is up to how a whole edit is planned, one lesson per
   skill, each lesson grounded in the retention research
   (research/retention/findings.md) and each with its own exam
   (tests/vision.test.cjs and research/vision/curriculum.md):
      1  units        what a thought is in a transcript
      2  reading      what a line carries: news, stakes, feeling, filler
      3  genre/length what kind of video this is and how long it should run
      4  hook         which line stops the scroll (RQ1)
      5  payoff       which line answers the hook (RQ1, RQ10)
      6  context      the one line the viewer needs to follow (RQ5)
      7  body         what earns its seconds, what is repetition (RQ4)
      8  order        cold open, chronology, payoff last (RQ4, RQ10)
      9  clips        cutting on thoughts, never inside them
     10  hook text    the gap in 8 words or fewer (H5)
     11  cutaways     only what is being said, on the words (RQ7)
     12  sound        moments, tone, restraint (RQ8)
     13  music        emotion and pace, or none (RQ8)
     14  masterclass  plan several edits, simulate the viewer, keep the best
   Then it was TRAINED: the weights that rank hooks and decide what to keep
   were fitted to the AI Director's own decisions on real footage, starting
   from the research's priors (research/vision/train.cjs). Those numbers are
   the WEIGHTS block below, written by that script.

   WHAT IT IS NOT (yet): it does not see the picture and it does not
   understand meaning the way a large model does; it reads words, timing and
   loudness. It is not the default editor. The comparison with the Director
   is in research/vision/RESULTS.md; until it matches, it runs only when
   switched on for testing (localStorage "vclyps-vision" = "on").

   Exposes window.VevrisVision, and module.exports for Node.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  const VERSION = "1.0.1";
  const R = () => global.VevrisRetention;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r2 = (x) => Math.round(x * 100) / 100;

  /*@weights*/
  /* Training result (research/vision/train.cjs, 2026-10-10; teacher: the
     0.26 AI Director, 13 clips with speech, leave-one-video-out):
       hook   research priors: Director's opener in the top 3 on 6/13 clips;
              fitted weights: 3/13. The data (13 choices) cannot beat the
              research, so the priors ship (hook: null).
       keep   AUC 0.52 (priors) → 0.58 (fitted), with no gain in whole-edit
              agreement; the priors ship (keep: null).
       length the one thing the teacher clearly taught: on the 7 development
              clips its median edit was 1.29× Vision's, so every genre's
              length prior is scaled by 1.29 (LENGTH_PRIOR × 1.29, rounded).
     See research/vision/RESULTS.md. */
  const WEIGHTS = {
    trained: "lengths",
    hook: null,   // null = the research priors in retention.js (HOOK_WEIGHTS) plus HOOK_EXTRA below
    keep: null,   // null = KEEP_PRIOR below
    lengths: { story: 77, comedy: 77, tutorial: 77, explainer: 58, interview: 58, talk: 58, review: 52, vlog: 58, opinion: 65, listicle: 65, reaction: 45 }
  };
  /*@end*/

  // Extra hook features Vision reads beyond retention.js, with prior weights.
  const HOOK_EXTRA = { dependent: -0.9, meta: -1.6, intro: -0.8, posEarly: 0.1, short: 0.3, long: -0.5, laughAfter: 0.5, answerFollows: 0.4,
    central: 1.2, offTopic: -0.6, quote: 0.3, claim: 0.5, sensory: 0.3 };
  // What makes a thought worth its seconds (lesson 7), prior weights.
  const KEEP_PRIOR = {
    bias: -0.2, value: 2.2, novelty: 1.2, dependent: -0.2, meta: -2.2, greeting: -2.5, signoff: -2.5, filler: -2.2,
    laughAfter: 1.0, prosody: 0.6, pos: -0.3, long: -0.4, intro: -0.6, question: 0.2, central: 1.5, offTopic: -0.8, quote: 0.3
  };

  const STOP = new Set(("a an the and or but so to of in on at for with by from as is are was were be been being it its it's this that these those " +
    "i i'm i've i'd me my we we're our you you're your he she they them his her their there here what which who whom when where why how " +
    "do does did done have has had not no yes just really very like know think um uh oh okay ok well right yeah gonna wanna kind sort " +
    "then than too also can could would should will shall may might must if because about into over out up down all any some more most " +
    "one get got go going went come came say said thing things way much many lot you'll i'll we'll they'll it'll you've we've they've we're they're").split(" "));

  function toks(text) {
    return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}'\s-]/gu, " ").split(/\s+/).filter(Boolean);
  }
  function content(text) { return toks(text).filter((w) => w.length > 2 && !STOP.has(w)); }
  function jaccard(a, b) {
    if (!a.length || !b.length) return 0;
    const A = new Set(a), B = new Set(b);
    let n = 0;
    A.forEach((x) => { if (B.has(x)) n++; });
    return n / (A.size + B.size - n);
  }

  /* ═══════════ LESSON 1: UNITS ═══════════
     A unit is one thought: a sentence, or Whisper's pieces of one sentence put
     back together. Markers like [Music] are not speech; a laugh or applause
     marker after a line is remembered on that line (it was a punchline).
     Whisper's overlapping repeats (its 30s windows overlap) are dropped. */
  const MARKER = /\[[^\]]*\]?|\((audience|laughter|laughing|applause|applauds|music|upbeat)[^)]*\)?|♪/gi;
  const LAUGHISH = /laugh|applau|cheer/i;

  function units(m) {
    const lines = (m.transcript || []).map((c, i) => ({ s: +c.s, e: +c.e, raw: String(c.text || ""), prosody: m.prosody ? (m.prosody[i] || 0) : 0 }));
    // pauses the room filled (laughter, applause): brain.js measures them, see buildRequest
    const loudPauses = (m.pauses || []).filter((p) => p[2]).map((p) => p[0]);
    const out = [];
    let prev = null;
    lines.forEach((ln) => {
      const markers = ln.raw.match(MARKER) || [];
      const text = ln.raw.replace(MARKER, " ").replace(/^[\s>\-–—,.]+/, "").replace(/\s+/g, " ").trim();
      if (markers.some((x) => LAUGHISH.test(x)) && prev) prev.laughAfter = true;
      if (!text || content(text).length === 0 && text.split(" ").length < 2) return;
      // an overlapping repeat of what was just said
      if (prev && ln.s < prev.e - 0.3 && jaccard(content(text), content(prev.text)) > 0.5) return;
      const ends = /[.!?…]["')\]]?\s*$/.test(text);
      if (prev && !prev.closed && ln.s - prev.e < 0.6 && (ln.e - prev.s) <= 14) {
        prev.text += " " + text;
        prev.parts.push(text);
        prev.e = Math.max(prev.e, ln.e);
        prev.prosody = Math.max(prev.prosody, ln.prosody);
        prev.closed = ends;
      } else {
        // parts: the Whisper lines it was made from, so the hook text never runs across two of them (1.0.1)
        prev = { s: ln.s, e: ln.e, text: text, parts: [text], prosody: ln.prosody, closed: ends, laughAfter: false };
        out.push(prev);
      }
    });
    out.forEach((u, i) => {
      u.i = i; u.dur = Math.max(0.3, u.e - u.s); u.words = toks(u.text).length; u.content = content(u.text); delete u.closed;
      if (loudPauses.some((t) => t >= u.e - 0.4 && t <= u.e + 1.2)) u.laughAfter = true;
    });
    return out;
  }

  /* ═══════════ LESSON 2: READING A UNIT ═══════════ */
  const RX = {
    /* Leans on what came before: a pronoun with nothing to point at, after
       any discourse marker ("So it was...", "And that's..."). A marker on
       its own is not dependence; editors drop "So," from a hook all the time. */
    dependent: /^(?:(?:and|but|so|well|okay|ok|now|then|or|also|plus)[,\s]+)?(?:it|it'?s|it'?ll|it'?d|this|that|that'?s|that'?ll|they|they'?re|they'?ll|he|she|there|those|these|which|because)\b/i,
    claim: /\b(is|are|isn'?t|aren'?t|was|it'?s|that'?s)\b.{0,40}\b(perfect|essential|unique|important|misleading|actually|really|best|worst|real|only|not|never|always|key|secret|crazy|amazing|incredible|beautiful|matter of)\b/i,
    sensory: /\b(red|orange|black|white|blue|green|smell|smells|smelly|taste|tastes|loud|bright|dark|cold|hot|metallic|beautiful|delicious|gross|shiny|wet|soft)\b/i,
    meta: /\b(in this video|link below|check out|subscribe|my channel|episode|playlist|hashtag|for more|website|follow (me|us)|dot com|\.com|retailing|purchase this)\b/i,
    intro: /\b(i'?m [A-Z][a-z]+|my name is|this is ask|i'?m the author|i'?m an? [a-z]+ (with|at|from))\b/,
    tender: /\b(died|dying|death|hospice|cancer|suicide|kill(ed)? myself|grief|funeral|bullying|bullied|abuse|depressed|depression)\b/i
  };

  /* What the whole video is about: the content words said most often
     (twice or more), up to 20. A line that names several of them is a line
     that states the subject, which is what an opener usually has to do
     (the hook "names something concrete", findings RQ1), and a line about
     none of them is usually a tangent (RQ4). */
  function keywords(us) {
    const n = {};
    us.forEach((u) => u.content.forEach((w) => { n[w] = (n[w] || 0) + 1; }));
    return Object.keys(n).filter((w) => n[w] >= 2).sort((a, b) => n[b] - n[a]).slice(0, 20);
  }

  function read(us, duration) {
    const X = R();
    const seen = [];
    const top = new Set(keywords(us));
    us.forEach((u, i) => {
      const f = X.lineFeatures(u.text, { first: i === 0 });
      f.dependent = RX.dependent.test(u.text) ? 1 : 0;
      f.meta = RX.meta.test(u.text) ? 1 : 0;
      f.intro = RX.intro.test(u.text) ? 1 : 0;
      f.laughAfter = u.laughAfter ? 1 : 0;
      f.pos = duration > 0 ? clamp(u.s / duration, 0, 1) : 0;
      f.posEarly = f.pos < 0.15 ? 1 : 0;
      f.short = u.words >= 4 && u.words <= 16 ? 1 : 0;
      f.long = u.words > 30 ? 1 : 0;
      f.prosody = u.prosody || 0;
      f.answerFollows = 0;
      const hits = new Set(u.content.filter((w) => top.has(w))).size;
      f.central = top.size ? clamp(hits / Math.min(5, top.size), 0, 1) : 0;
      f.offTopic = u.content.length >= 3 && hits === 0 ? 1 : 0;
      f.quote = /\b(said|says|goes|told|asked)\b|["“”]/i.test(u.text) ? 1 : 0;
      f.claim = RX.claim.test(u.text) ? 1 : 0;
      f.sensory = RX.sensory.test(u.text) ? 1 : 0;
      let nov = 1;
      for (let k = Math.max(0, seen.length - 12); k < seen.length; k++) nov = Math.min(nov, 1 - jaccard(u.content, seen[k]));
      f.novelty = u.content.length ? nov : 0;
      seen.push(u.content);
      f.value = X.lineValue(u.text, u.prosody);
      u.f = f;
    });
    us.forEach((u, i) => { if (u.f.question && us[i + 1] && !us[i + 1].f.question) u.f.answerFollows = 1; });
    return us;
  }

  /* ═══════════ LESSON 3: GENRE AND LENGTH ═══════════
     The genre from the words (retention.detectGenre); the length from the
     research's rule (the shortest band that holds hook, context and payoff)
     made concrete per genre, and learned from the Director's own lengths
     once trained. A target from the creator always wins. */
  const LENGTH_PRIOR = { story: 60, comedy: 60, tutorial: 60, explainer: 45, interview: 45, talk: 45, review: 40, vlog: 45, opinion: 50, listicle: 50, reaction: 35 };

  function targetLength(genre, speech, req) {
    if (req && req.target) return clamp(+req.target, 8, 600);
    const L = (WEIGHTS.lengths && WEIGHTS.lengths[genre]) || LENGTH_PRIOR[genre] || 50;
    return clamp(Math.min(L, speech * 0.75), 12, 120);
  }

  /* ═══════════ LESSON 4: THE HOOK ═══════════ */
  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }
  function hookZ(u, W) {
    const X = R();
    const base = W || X.HOOK_WEIGHTS;
    let z = base.bias || 0;
    for (const k in base) if (k !== "bias" && u.f[k] != null) z += base[k] * u.f[k];
    const extra = (WEIGHTS.hook && WEIGHTS.hook.extra) || HOOK_EXTRA;
    for (const k in extra) if (u.f[k] != null) z += extra[k] * u.f[k];
    return z;
  }
  function hookCandidates(us) {
    const W = WEIGHTS.hook && WEIGHTS.hook.base;
    return us
      .filter((u) => !u.f.meta && !u.f.greeting && !u.f.signoff && !u.f.filler && u.dur <= 12 && u.words >= 3)
      .map((u) => ({ u: u, p: sigmoid(hookZ(u, W)) }))
      .sort((a, b) => b.p - a.p);
  }

  /* ═══════════ LESSON 5: THE PAYOFF ═══════════
     The line that answers the hook, late in the story: shares the hook's
     subject, carries payoff wording or an emotional peak, and comes after
     most of what it needs. Never the hook itself, never a sign-off. */
  function payoffFor(us, hook) {
    let best = null, top = -Infinity;
    const hc = hook.u.content;
    us.forEach((u) => {
      if (u === hook.u || u.f.meta || u.f.signoff || u.f.greeting || u.f.filler) return;
      const overlap = jaccard(hc, u.content);
      const late = Math.pow(u.f.pos, 1.3);
      const strong = 0.25 * u.f.payoff + 0.15 * u.f.absolute + 0.15 * u.f.arousal + 0.2 * u.f.laughAfter + 0.1 * u.f.stakes + 0.1 * u.f.prosody;
      const score = 0.9 * overlap + strong + 0.6 * late + 0.3 * u.f.value - 0.3 * u.f.dependent * (u.f.payoff ? 0 : 1);
      if (score > top) { top = score; best = u; }
    });
    return best;
  }

  /* ═══════════ LESSON 6: CONTEXT ═══════════
     One line, right after the hook, that tells the viewer who or what this
     is. Prefer a self-introduction or the first plain statement of the
     subject; short. None when the hook already IS the start. */
  function contextFor(us, hook, payoff) {
    // a context line has to be a whole, readable statement about the subject
    const before = us.filter((u) => u.s < payoff.s && u !== hook.u && !u.f.meta && !u.f.greeting && !u.f.filler && u.dur <= 9 &&
      u.words >= 5 && !u.f.dependent && !/\.\.\.|…/.test(u.text) && (u.f.central > 0 || u.f.intro));
    if (!before.length) return null;
    const intro = before.find((u) => u.f.intro && u.f.pos < 0.3);
    if (intro) return intro;
    if (hook.u.i === 0) return null;
    const first = before[0];
    return first.f.pos < 0.35 ? first : null;
  }

  /* ═══════════ LESSON 7: THE BODY ═══════════
     What earns its seconds: a keep score per thought (value, novelty,
     laughs, delivery; filler, meta and repetition against), then the best
     value per second until the length budget is spent. Two coherence rules
     on top: a line that leans on the one before ("And then...") brings it,
     and a punchline brings its setup. */
  function keepP(u) {
    const W = (WEIGHTS.keep && WEIGHTS.keep.w) || KEEP_PRIOR;
    let z = W.bias || 0;
    for (const k in W) if (k !== "bias" && u.f[k] != null) z += W[k] * u.f[k];
    return sigmoid(z);
  }

  /* PASSAGES, NOT SENTENCES. Picking the best sentences one by one gave
     edits of fifteen fragments; viewers absorb a story through a plot they
     can follow (E25) and a coherent order (E55), and every jump is a cut
     the viewer has to re-orient across (E10). So the body is chosen as
     passages: a dynamic programme over the thoughts in order that maximises
         Σ value of kept thoughts − μ·seconds − κ·(number of jumps)
     where a jump is any break in the run of kept thoughts (the context and
     the payoff are fixed points the passages can join). μ, the price of a
     second, is found by bisection so the edit fits its length budget; κ is
     the coherence cost of a jump. Repetition of something already kept is
     priced out, a punchline still brings its setup. */
  const KAPPA = 0.6;
  function body(us, hook, context, payoff, budget) {
    const fixed = new Set([hook.u, payoff, context].filter(Boolean));
    const lo = context ? context.s : (hook.u.s < payoff.s ? hook.u.e : -1);
    const span = us.filter((u) => u.s > lo - 0.01 && u.e <= payoff.e + 0.05 && u !== hook.u);
    if (!span.length) return [];
    span.forEach((u) => { u.k = keepP(u); });
    const ok = (u) => !u.f.meta && !u.f.signoff && !u.f.greeting && !u.f.filler;
    const gain = (u) => (u.k - 0.4) * Math.sqrt(Math.min(u.dur, 10));
    const run = (mu) => {
      // dp over span in order; state: previous thought kept or not
      let keep = -Infinity, skip = 0;
      const from = [];
      span.forEach((u, i) => {
        const forced = fixed.has(u), allowed = forced || ok(u);
        const adj = i > 0 && u.s - span[i - 1].e < 2;
        const g = forced ? 1e6 : gain(u) - mu * u.dur;
        const k1 = adj ? keep + g : -Infinity, k2 = skip + g - (i > 0 ? KAPPA : 0);
        const nk = allowed ? Math.max(k1, k2) : -Infinity;
        const ns = forced ? -Infinity : Math.max(keep, skip);
        from.push({ k: k1 >= k2 ? "k" : "s", s: keep >= skip ? "k" : "s" });
        keep = nk; skip = ns;
      });
      // trace back
      const out = [];
      let state = keep >= skip ? "k" : "s";
      for (let i = span.length - 1; i >= 0; i--) {
        if (state === "k") { out.push(span[i]); state = from[i].k; } else state = from[i].s;
      }
      return out.reverse();
    };
    let lo2 = 0, hi2 = 2, best = run(hi2);
    for (let it = 0; it < 18; it++) {
      const mid = (lo2 + hi2) / 2, pick = run(mid);
      const dur = pick.filter((u) => !fixed.has(u)).reduce((s, u) => s + u.dur, 0);
      if (dur > budget * 1.1) lo2 = mid; else { hi2 = mid; best = pick; }
    }
    const chosen = new Set(best.filter((u) => !fixed.has(u)));
    // repetition: a thought saying what a kept one already said goes
    const kept = [];
    [...chosen].sort((a, b) => a.s - b.s).forEach((u) => { if (kept.some((c) => jaccard(c.content, u.content) > 0.55)) chosen.delete(u); else kept.push(u); });
    // a punchline brings its setup; a payoff that leans on the line before brings it
    [...chosen].concat([payoff]).forEach((u) => {
      const prev = us[u.i - 1];
      if (prev && !fixed.has(prev) && prev.s > lo && (u.f.laughAfter || (u === payoff && u.f.dependent)) && prev.dur <= 9 && ok(prev)) chosen.add(prev);
    });
    return [...chosen].sort((a, b) => a.s - b.s);
  }

  /* ═══════════ LESSON 8 + 9: ORDER AND CLIPS ═══════════
     Hook first (a cold open if it comes from later), then the context, the
     body in the order it happened, and the payoff last. Thoughts that sit
     next to each other in the source become one clip. */
  function clipsFor(m, hook, context, bodyUnits, payoff) {
    const seq = [{ u: hook.u, beat: "hook" }];
    if (context && context !== hook.u) seq.push({ u: context, beat: "context" });
    bodyUnits.forEach((u) => { if (u !== hook.u && u !== context && u !== payoff) seq.push({ u: u, beat: "body" }); });
    if (payoff !== hook.u) seq.push({ u: payoff, beat: "payoff" });
    // the hook is never repeated; everything after it is chronological
    const rest = seq.slice(1).sort((a, b) => a.u.s - b.u.s);
    const order = [seq[0]].concat(rest);
    const clips = [];
    order.forEach((x) => {
      const a = Math.max(0, x.u.s - 0.05), b = Math.min(m.duration || x.u.e + 1, x.u.e + 0.1);
      const last = clips[clips.length - 1];
      if (last && last.mediaId === m.id && a - last.out < 0.5 && a >= last.out - 0.2 && x.beat !== "hook" && last.beat !== "hook") {
        last.out = Math.max(last.out, b);
        if (x.beat === "payoff") last.beat = "payoff";
      } else {
        clips.push({ mediaId: m.id, in: r2(a), out: r2(b), beat: x.beat, reason: x.beat });
      }
    });
    clips.forEach((c) => { c.reason = c.beat; delete c.beat; });
    return clips;
  }

  /* ═══════════ LESSON 10: THE HOOK TEXT ═══════════
     The gap from the speaker's own words, short enough to read at a glance
     (H5: 10 words or fewer), and a STATEMENT: a whole clause, not a window
     cut out of the middle of one. 1.0.0 took the densest 8 words of the
     clause and printed fragments ("Usually steam on high for around six",
     "Feel that beat To celebrate your birthday"); 1.0.1 prefers a clause
     that fits whole, then the clause without its filler and article, and
     only then the clause up to a phrase boundary. Never across two of
     Whisper's lines, never from a clause that starts mid-sentence if a
     whole one exists. */
  const HOOK_WORDS = 10;
  const LEAD = /^(?:(?:and|but|so|well|okay|ok|now|then|because|basically|actually|um|uh|like|you know|i mean)[,\s]+)+/i;
  const DET = /^(?:this|the|a|an|these|those)\s+/i;
  // where a phrase can stop: before a relative, a preposition starting a new phrase, or a conjunction
  const BOUNDARY = /^(?:who|which|that|for|because|when|where|while|with|if|and|but|or|to|from|by|until|after|before|like|through|into|across|over|under|during|around|in|on|at|of|about)$/i;
  // words a hook can lose without changing what it says
  const SOFT = /^(?:actually|really|just|basically|literally|totally|honestly|very)$/i;
  function bare(x) { return x.toLowerCase().replace(/[^\p{L}\p{N}']/gu, ""); }
  function shorten(c) {
    let w = c.replace(LEAD, "").replace(/[.,;:—–]+$/, "").split(/\s+/).filter(Boolean);
    if (w.length > HOOK_WORDS && DET.test(w.join(" "))) w = w.slice(1);
    if (w.length > HOOK_WORDS) w = w.filter((x, i) => i === 0 || !SOFT.test(bare(x)));
    if (w.length <= HOOK_WORDS) return { w: w, whole: true };
    // up to the last phrase boundary that fits; a number never loses its range ("six to eight")
    let cut = 0;
    for (let i = 3; i <= HOOK_WORDS; i++) {
      if (!BOUNDARY.test(bare(w[i] || ""))) continue;
      if (/^(to|or)$/i.test(bare(w[i])) && /\d|^(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|hundred)$/i.test(bare(w[i - 1]))) continue;
      cut = i;
    }
    if (!cut) return null;
    w = w.slice(0, cut);
    while (w.length > 3 && STOP.has(bare(w[w.length - 1]))) w = w.slice(0, -1);
    return { w: w, whole: false };
  }
  function hookText(u) {
    const X = R();
    const cands = [];
    (u.parts || [u.text]).forEach((part, pi) => {
      part.split(/(?<=[,;:.!?—–])\s+|\s+(?=but\b|because\b|so\b|which\b)/i).forEach((c, ci) => {
        c = c.trim();
        const sh = shorten(c);
        if (!sh || sh.w.length < 3) return;
        const t = sh.w.join(" ");
        // a lowercase start on a line that continues the one before is the middle of a sentence
        const mid = /^[a-z]/.test(c) && !/^i\b/.test(c) && (pi > 0 || ci > 0) && !/^(but|so|because|and)\b/i.test(c);
        cands.push({ t: t, z: X.hookScore(t) - (RX.dependent.test(t) ? 0.25 : 0) + (sh.whole ? 0.5 : -0.6) - (mid ? 0.3 : 0) - (pi + ci) * 0.02 });
      });
    });
    if (!cands.length) {
      let w = u.text.replace(LEAD, "").split(/\s+/).slice(0, HOOK_WORDS);
      while (w.length > 3 && STOP.has(bare(w[w.length - 1]))) w = w.slice(0, -1);
      cands.push({ t: w.join(" "), z: 0 });
    }
    let t = cands.sort((a, b) => b.z - a.z)[0].t;
    t = t.replace(/[,;:]$/, "").replace(/^["“'‘]+|["”'’]+$/g, "").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ═══════════ LESSON 11: CUTAWAYS ═══════════
     Only something being said, on the words that name it (E39: an
     irrelevant picture is a cost). Places and objects become photos or
     video; a strong reaction becomes a GIF searched the way people search
     reactions. Never on the hook's first seconds or over the payoff. */
  const SCENES = /\b(space|moon|earth|sun|stars?|galaxy|galaxies|universe|planet|ocean|sea|beach|city|street|traffic|crowd|forest|sky|rain|snow|mountains?|river|rocket|launch|station|eclipse|sunset|sunrise|kitchen|market|stage|party|concert|school|classroom|hospital|airport|train|railways?|platform)\b/i;
  const THINGS = /\b(fish|guitar|phone|car|wall|pipes?|wires?|book|books|piccolo|panda|teddy|toilet|vacuum|fan|shampoo|food|pizza|pies?|heart|lungs|cigarettes?|cart|cereal|telescope|map|maps|laptop|money|cake|gorilla|costume|camera|helmet|suit|oxygen|black holes?|supernova|chopsticks?|sauce|steamer|knife|wok|amp|amplifier|application form|planetarium|museum|teachers?)\b/i;
  const REACT = [
    [/\b(amazing|incredible|unbelievable|awesome|wow)\b/i, "mind blown"], [/\b(shock\w*|surpris\w*)\b/i, "shocked reaction"],
    [/\b(crazy|insane|wild|ridiculous)\b/i, "what reaction"], [/\b(scared|afraid|terrified)\b/i, "scared reaction"],
    [/\b(love|beautiful|lovely)\b/i, "heart eyes"], [/\b(funny|laugh\w*|hilarious)\b/i, "laughing"],
    [/\b(gross|disgusting|smelly)\b/i, "disgusted face"], [/\b(cool)\b/i, "cool sunglasses"]
  ];

  function cutaways(m, clips, chosen, payoff, genre, tender) {
    const out = [];
    if (tender) return out;
    const inClip = (t) => clips.findIndex((c) => t >= c.in && t <= c.out);
    const words = (m.words || []).filter((w) => w && w.start != null);
    const timeOf = (u, re) => {
      const ws = words.filter((w) => w.start >= u.s - 0.05 && w.start <= u.e);
      for (let k = 0; k < ws.length; k++) {
        const two = (ws[k].text + " " + (ws[k + 1] ? ws[k + 1].text : "")).replace(/[^\p{L}\p{N}\s']/gu, "");
        if (re.test(ws[k].text.replace(/[^\p{L}\p{N}']/gu, "")) || re.test(two)) return { t: ws[k].start, say: ws.slice(Math.max(0, k - 1), k + 2).map((w) => w.text).join(" ").replace(/[.,!?;:]+$/, "") };
      }
      return null;
    };
    for (const u of chosen) {
      if (out.length >= 3) break;
      if (u === payoff) continue;
      const c0 = clips[0];
      let kind = null, query = null, re = null, m1 = null;
      if ((m1 = u.text.match(SCENES))) { kind = "video"; query = m1[1].toLowerCase(); re = new RegExp("^" + m1[1] + "$", "i"); }
      else if ((m1 = u.text.match(THINGS))) { kind = "photo"; query = m1[1].toLowerCase(); re = new RegExp("^" + m1[1].split(" ")[0] + "$", "i"); }
      else if (genre !== "tutorial") {
        for (const [rx, q] of REACT) if ((m1 = u.text.match(rx))) { kind = "gif"; query = q; re = new RegExp("^" + m1[1] + "$", "i"); break; }
      }
      if (!kind) continue;
      const hit = timeOf(u, re) || { t: u.s + 0.2, say: "" };
      const ci = inClip(hit.t);
      if (ci < 0) continue;
      if (ci === 0 && c0 && hit.t - c0.in < 2) continue;   // not over the hook
      if (out.some((b) => Math.abs(b.t - hit.t) < 6)) continue;
      out.push({ query: query, kind: kind, mode: "square", dur: kind === "gif" ? 1.5 : 1.8, say: hit.say, ci: ci, mediaId: m.id, t: r2(hit.t) });
    }
    return out;
  }

  /* ═══════════ LESSON 12: SOUND ═══════════
     A sound marks a moment the eye also sees (E10; findings RQ8): the hook
     text arriving, the cut back to the start after a cold open, the payoff,
     a tutorial step. Tender footage gets none; comedy gets no stings (the
     room's laughs are the sound). */
  function sounds(req, clips, texts, broll, plan, genre, tender) {
    const lib = {};
    (req.sfx || []).forEach((s) => { lib[s.name] = true; });
    const ok = (n) => !!lib[n];
    if (tender || genre === "comedy") return;
    if (texts[0] && ok("pop")) texts[0].sfx = "pop";
    if (plan.coldOpen && clips[1] && ok("whoosh")) (clips[1].sfx = clips[1].sfx || []).push({ name: "whoosh", cut: true, why: "back to the start" });
    const pc = clips[clips.length - 1];
    if (pc && plan.payoffAt != null && ["explainer", "review", "vlog", "interview", "talk", "listicle", "opinion"].indexOf(genre) >= 0 && ok("ding")) {
      (pc.sfx = pc.sfx || []).push({ name: "ding", t: r2(plan.payoffAt), why: "the payoff lands" });
    }
    if (genre === "tutorial" && ok("ding")) {
      let n = 0;
      plan.units.forEach((u) => {
        if (n >= 2 || !u.f.signpost || u === plan.hook) return;
        const ci = clips.findIndex((c) => u.s >= c.in - 0.1 && u.s <= c.out);
        if (ci > 0) { (clips[ci].sfx = clips[ci].sfx || []).push({ name: "ding", t: r2(u.s + 0.1), why: "a step" }); n++; }
      });
    }
    if (broll[0] && ok("whoosh")) broll[0].sfx = "whoosh";
  }

  /* ═══════════ LESSON 13: MUSIC ═══════════ */
  const MUSIC = { explainer: "inspiring piano", interview: "inspiring piano", talk: "inspiring piano", story: "inspiring piano",
    tutorial: "chill lofi", review: "chill lofi", vlog: "upbeat funk", listicle: "upbeat funk", opinion: "dark cinematic", reaction: "upbeat funk" };
  function music(req, m, genre, tender) {
    if (!req.music || !req.music.available || req.music.chosen) return null;
    const bpm = m.stats && m.stats.bpm;
    if (bpm) return { use: false, why: "the footage has its own music" };
    if (genre === "comedy") return { use: false, why: "the room's laughs are the sound" };
    if (tender) return { use: false, why: "an intimate story" };
    return { use: true, query: MUSIC[genre] || "chill lofi", level: "under", why: genre + " pace" };
  }

  /* ═══════════ LESSON 14: MASTERCLASS ═══════════
     Plan several complete edits (the three strongest hooks, each at the
     target length and a tighter one), play each through the viewer model in
     retention.js, and keep the one viewers are most likely to stay with,
     as long as it still tells the whole thing (hook, context, payoff, at
     least 60% of the target). This is the simulation step a human editor
     does by watching their cut back. */
  function buildOne(req, m, us, genre, hook, T) {
    const payoff = payoffFor(us, hook);
    if (!payoff) return null;
    // a payoff before the hook's own moment is fine (the hook is a cold open), but it must leave room
    const context = contextFor(us, hook, payoff);
    const fixedDur = hook.u.dur + payoff.dur + (context ? context.dur : 0);
    const chosen = body(us, hook, context, payoff, Math.max(0, T - fixedDur));
    const clips = clipsFor(m, hook, context, chosen, payoff);
    const coldOpen = hook.u.s > (clips[1] ? clips[1].in : hook.u.s);
    return { hook: hook.u, hookP: hook.p, payoff: payoff, context: context, chosen: chosen, clips: clips, coldOpen: coldOpen, payoffAt: payoff.s + Math.min(1, payoff.dur / 3), units: us, T: T };
  }

  function plan(req) {
    const X = R();
    if (!X) throw new Error("Vision-1.0 needs retention.js");
    const m = (req.media || []).filter((x) => x.type === "video" && x.transcript && x.transcript.length)
      .sort((a, b) => (b.transcript.length - a.transcript.length))[0];
    if (!m) return null;   // nothing said: the picture-only case is the Director's
    const range = req.range && String(req.range.mediaId) === String(m.id) ? req.range : null;
    const src = Object.assign({}, m, {
      transcript: range ? m.transcript.filter((c) => c.s >= range.start - 0.3 && c.e <= range.end + 0.3) : m.transcript,
      words: (m.words || []).map((w) => Array.isArray(w) ? { text: w[0], start: w[1], end: w[2] } : w)
    });
    const us = read(units(src), src.duration || 0);
    if (us.length < 2) return null;
    const speech = us.reduce((s, u) => s + u.dur, 0);
    const laughs = us.filter((u) => u.laughAfter).length;
    // a room that laughs every minute or so is a comedy set, whatever the words say
    const g = laughs >= Math.max(3, speech / 60) ? "comedy" : X.detectGenre(us.map((u) => u.text)).genre;
    // one word is not a mood ("an 80's rock death patch"): two mentions, or one that is unmistakable
    const all = us.map((u) => u.text).join(" ");
    const tenderHits = (all.match(new RegExp(RX.tender.source, "gi")) || []).length;
    const tender = tenderHits >= 2 || /\b(hospice|suicide|kill(ed)? myself|funeral)\b/i.test(all);
    const T0 = targetLength(g, speech, req);
    const hooks = hookCandidates(us).slice(0, 3);
    if (!hooks.length) return null;
    let best = null;
    const tried = [];
    for (const h of hooks) {
      for (const T of [T0, Math.round(T0 * 0.7)]) {
        const p = buildOne(req, src, us, g, h, T);
        if (!p || !p.clips.length) continue;
        const len = p.clips.reduce((s, c) => s + c.out - c.in, 0);
        const text = hookText(h.u);
        const est = X.estimate({ clips: p.clips, texts: [{ text: text, start: 0.1 }] }, [src]);
        const whole = len >= Math.min(0.6 * T0, speech * 0.5) ? 1 : 0;
        const score = (est ? est.score : 0) + 25 * h.p + (whole ? 0 : -40);
        tried.push({ hook: h.u.i, T: T, len: r2(len), score: r2(score) });
        if (!best || score > best.score) best = { p: p, score: score, text: text, est: est };
      }
    }
    if (!best) return null;
    const p = best.p;
    const clips = p.clips;
    const texts = [{ text: best.text, start: 0.1, dur: 2.2, pos: "top", size: 38, color: "#ffffff" }];
    const effects = [];
    if (clips.length > 1 && clips[clips.length - 1].out - clips[clips.length - 1].in >= 2) effects.push({ clip: clips.length - 1, type: "punch-in" });
    const broll = cutaways(src, clips, [p.context].concat(p.chosen).filter(Boolean), p.payoff, g, tender);
    sounds(req, clips, texts, broll, p, g, tender);
    const hookType = X.hookType(p.hook.text);
    return {
      clips: clips,
      texts: texts,
      captions: [],
      effects: effects,
      broll: broll,
      music: music(req, m, g, tender),
      look: "none",
      story: p.hook.text.slice(0, 70) + " → " + p.payoff.text.slice(0, 60),
      confidence: r2(clamp(best.p.hookP, 0.3, 0.9)),
      reasons: ["hook: " + hookType + " (" + Math.round(p.hookP * 100) + ")", "genre: " + g, "payoff at " + r2(p.payoffAt) + "s"],
      retention: { genre: g, band: X.bandFor(clips.reduce((s, c) => s + c.out - c.in, 0)).id, hookType: hookType, gap: best.text, payoffAt: r2(p.payoffAt) },
      raw: { vision: VERSION, trained: !!WEIGHTS.trained, genre: g, tender: tender, target: T0, hookUnit: p.hook.i, payoffUnit: p.payoff.i, contextUnit: p.context ? p.context.i : null, tried: tried }
    };
  }

  function enabled() {
    try { return (global.localStorage && global.localStorage.getItem("vclyps-vision")) === "on"; } catch (e) { return false; }
  }

  const api = { version: VERSION, plan: plan, enabled: enabled, WEIGHTS: WEIGHTS, KEEP_PRIOR: KEEP_PRIOR, HOOK_EXTRA: HOOK_EXTRA, LENGTH_PRIOR: LENGTH_PRIOR,
    _units: units, _read: read, _hookCandidates: hookCandidates, _payoffFor: payoffFor, _contextFor: contextFor, _body: body,
    _clipsFor: clipsFor, _hookText: hookText, _cutaways: cutaways, _keepP: keepP, _content: content, _jaccard: jaccard };
  global.VevrisVision = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
