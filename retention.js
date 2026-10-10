/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — retention.js
   The editing app by Vevris.

   What keeps people watching, turned into code that the Director's briefs,
   the editor (brain.js) and Senotel Vision-1.0 (vision.js) all share, so the
   three can never disagree about the rules. The research behind every rule is
   in research/retention/findings.md, its sources in evidence.md; the IDs in
   the comments here (E06, P06…) point into that ledger.

   Four parts:
     1. GENRES and BANDS: the structure templates by genre and by length
        (findings RQ5, RQ6)
     2. lineFeatures / hookScore / hookType: reading a spoken line the way
        the hook rules do (RQ1)
     3. tighten / zoomCuts: what the editor enforces whatever the Director
        said: start on speech, no greeting first, no sign-off last, no dead
        air, a deliberate change of framing on jump cuts (RQ4, RQ7, RQ10)
     4. estimate: the value-of-continuing model (RQ3) as a retention PROXY.
        It is not a prediction of real viewers: its weights follow the
        direction of the evidence and have not been fitted to any platform's
        retention data. It is used to find weak spots and to compare edits
        made from the same footage, never shown to users as a percentage.

   Plain functions over plain data: runs in the page, in a worker and in
   Node (module.exports), and needs nothing a browser does not have.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ═══════════ 1. STRUCTURE: GENRES AND LENGTH BANDS ═══════════ */

  /* beats: [name, share of the video, what it must do]. The shares are
     defaults, not measured optima (findings RQ5); the ORDER is the evidence. */
  const GENRES = {
    story: {
      label: "Story / personal experience",
      hooks: ["stakes", "result", "confession"],
      beats: [["hook", 0.08, "the stakes or the result, in the speaker's words"], ["context", 0.1, "who and where, one line"],
        ["rising", 0.4, "complications, each raising the stakes"], ["turn", 0.2, "the climax or the reveal"],
        ["resolution", 0.15, "what changed, or the lesson"], ["end", 0.07, "end on the payoff or a callback to the hook"]],
      why: "suspense/curiosity order (E22); identifiable person + imaginable plot (E25); tension rises late (E53); endings weigh most (E27)"
    },
    tutorial: {
      label: "Tutorial / how-to",
      hooks: ["result", "number", "relevance"],
      beats: [["hook", 0.08, "show or state the finished result and the promise (\"3 steps\")"], ["why", 0.07, "why it matters, one line"],
        ["steps", 0.6, "the steps in order, each one signposted"], ["mistake", 0.1, "the common mistake or the trick (a surprise)"],
        ["reveal", 0.15, "the final result, then stop"]],
      why: "tutorial viewers drop out and jump to what they need (E15); signal each step (E38); visible progress (E40); key message first (P11)"
    },
    explainer: {
      label: "Explainer / educational / Q&A",
      hooks: ["contrarian", "question", "number"],
      beats: [["hook", 0.08, "a counterintuitive fact or a specific question with stakes"], ["intuition", 0.25, "the idea in plain words or an analogy"],
        ["example", 0.3, "one concrete example or evidence"], ["twist", 0.2, "the misconception or the surprising part"],
        ["takeaway", 0.17, "one line the viewer keeps"]],
      why: "curiosity (E01-E03); processing ease (E19); signal the key idea (E38); no seductive details (E39)"
    },
    opinion: {
      label: "Opinion / commentary / hot take",
      hooks: ["contrarian", "relevance"],
      beats: [["hook", 0.08, "the claim, bold but short of outrage"], ["reasons", 0.45, "reasons in rising strength"],
        ["counter", 0.15, "the best objection, acknowledged"], ["strongest", 0.2, "the strongest reason"],
        ["verdict", 0.12, "the verdict, and a real question to the viewer"]],
      why: "talk rises with controversy only to a moderate level (E54); arousal holds and spreads (E19, E26); sends and comments rank (P03)"
    },
    comedy: {
      label: "Comedy / stand-up / sketch",
      hooks: ["visual", "contrarian", "confession"],
      beats: [["hook", 0.1, "the premise, or the funniest line teased"], ["setup", 0.25, "the setup"],
        ["punchlines", 0.5, "punchlines, escalating; never cut between a setup and its punchline"], ["button", 0.15, "a callback or the biggest laugh, then stop"]],
      why: "humour raises attention (E47); laughs are moment-to-moment value (E12); performers' timing has no dead air before punchlines (E57)"
    },
    listicle: {
      label: "List / tips",
      hooks: ["number", "relevance"],
      beats: [["hook", 0.08, "the number and the specific benefit"], ["items", 0.82, "the items, rising in strength, the best last"],
        ["recap", 0.1, "a one-line recap"]],
      why: "progress pull (E40); peak and end (E27); signposting (E38)"
    },
    interview: {
      label: "Interview / podcast clip",
      hooks: ["contrarian", "result", "stakes"],
      beats: [["hook", 0.1, "the guest's strongest line"], ["who", 0.07, "who they are, one line"],
        ["answer", 0.65, "the answer or the story"], ["payoff", 0.18, "the payoff line, then stop"]],
      why: "it must stand alone: a gap needs a reference point (E01)"
    },
    review: {
      label: "Review / product demo",
      hooks: ["result", "contrarian"],
      beats: [["hook", 0.08, "the verdict or a surprising result"], ["demo", 0.4, "the product working, on screen"],
        ["specifics", 0.25, "two or three specifics"], ["downside", 0.12, "one honest downside"], ["verdict", 0.15, "the verdict"]],
      why: "demonstrate before entertaining (E14); credibility (E05)"
    },
    reaction: {
      label: "Reaction",
      hooks: ["visual"],
      beats: [["hook", 0.1, "the peak reaction, a face"], ["trigger", 0.25, "what is being reacted to"],
        ["reactions", 0.5, "the reactions, escalating"], ["final", 0.15, "the final reaction"]],
      why: "faces engage (E45); rising joy retains (E06)"
    },
    vlog: {
      label: "Vlog / day in the life",
      hooks: ["visual", "result", "stakes"],
      beats: [["hook", 0.08, "the most interesting moment of the day"], ["journey", 0.75, "in order, time compressed, one new thing per segment"],
        ["end", 0.17, "the peak or a reflection"]],
      why: "one new thing per segment (E12); end on the peak (E27)"
    },
    talk: {
      label: "Talk / motivational / speech",
      hooks: ["contrarian", "confession", "relevance"],
      beats: [["hook", 0.1, "the most quotable line"], ["story", 0.4, "a story or an example"],
        ["principle", 0.3, "the principle"], ["call", 0.2, "the call to act, rising"]],
      why: "rising emotion retains and spreads (E06, E26)"
    }
  };

  /* Length bands (findings RQ6). firstPayoff: latest second the first real
     payoff should land; lull: longest stretch allowed without anything new. */
  const BANDS = [
    { id: "micro", max: 15, label: "up to 15s", firstPayoff: 6, lull: 3, rehook: false,
      shape: "one idea, one payoff; the hook IS the premise; payoff by about 70%; end on the payoff so the loop restarts cleanly" },
    { id: "short", max: 45, label: "15-45s", firstPayoff: 10, lull: 5, rehook: false,
      shape: "hook within 3s, context within 5s, one or two developments, payoff at 70-90%, end within 2s of it" },
    { id: "standard", max: 90, label: "45-90s", firstPayoff: 15, lull: 7, rehook: false,
      shape: "hook, context, 2-3 beats with a small payoff every 10-15s, the main payoff in the last 20%, a short close" },
    { id: "long", max: 180, label: "90-180s", firstPayoff: 15, lull: 8, rehook: true,
      shape: "as standard, plus a new question at 40-60% to re-hook, signposts between sections, a small payoff every 15-20s" },
    { id: "mid", max: Infinity, label: "over 3 minutes", firstPayoff: 30, lull: 10, rehook: true,
      shape: "the first 30s confirm the promise; chapters with signposts; a re-engagement point every 1-2 minutes; a payoff kept for the end" }
  ];
  function bandFor(seconds) {
    for (const b of BANDS) if (seconds <= b.max) return b;
    return BANDS[BANDS.length - 1];
  }

  const HOOK_TYPES = {
    result: "show the outcome first, withhold how or why (curiosity)",
    stakes: "show the problem or the risk, withhold what happens (suspense)",
    contrarian: "a surprising or counterintuitive claim (surprise)",
    number: "a specific number or a numbered promise (progress)",
    question: "a SPECIFIC question the video answers; never a vague one",
    confession: "something the speaker admits or reveals",
    visual: "the action or the reaction itself, before any words",
    relevance: "a problem the viewer has, said to them directly"
  };

  /* ═══════════ 2. READING A LINE ═══════════
     Lexicons, not understanding. They catch the surface of what the hook and
     retention rules look for; the Director reads meaning, Vision-1.0 learns
     weights over these. Word boundaries everywhere (see HOOK_WORDS in
     brain.js for what happens without them). */
  const RX = {
    number: /\b\d[\d,.]*\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|fifty|hundred|thousand|million|billion|half|double|triple)\b|[$£€%]/i,
    you: /\b(you|your|you're|you've|you'll)\b/i,
    contrast: /\b(but|actually|turns out|instead|except|however|yet|although|surprisingly|in fact|the truth is|the problem is|the thing is)\b/i,
    absolute: /\b(never|nobody|no one|always|everyone|every|nothing|only|first|last|biggest|best|worst|most|least|fastest|craziest|hardest|easiest)\b/i,
    stakes: /\b(died|dead|die|death|killed|lost|lose|losing|quit|fired|broke|money|debt|cancer|sick|hospital|danger|dangerous|scared|afraid|risk|almost|nearly|emergency|crash|fail|failed|failure|mistake|wrong|problem|trouble|secret|never told)\b/i,
    arousal: /\b(wow|insane|crazy|amazing|incredible|unbelievable|shocking|shocked|terrified|love|hate|angry|furious|excited|exciting|awesome|ridiculous|huge|massive|wild|weird|strange|holy|omg|oh my god|what the|unreal)\b/i,
    question: /\?\s*$|^(how|why|what|when|where|who|which|did|do|does|is|are|can|could|would|should|have|has)\b/i,
    vagueOpen: /^(did you know|have you ever|guess what|you won'?t believe|here'?s why|this is why|check this out|so,? (um|uh)|okay so|so basically)\b/i,
    payoff: /\b(so that'?s (why|how)|that'?s (why|how)|the answer is|the reason is|turns out|it turned out|in the end|finally|and that'?s|which means|the result|here'?s the thing|the secret is|the trick is|that'?s the)\b/i,
    signpost: /\b(first|second|third|fourth|fifth|next|then|step \d|step one|step two|number (one|two|three|\d)|finally|last(ly)?|tip)\b/i,
    greeting: /^\s*(hi|hey|hello|yo|what'?s up|welcome( back)?|good (morning|afternoon|evening))\b|\b(my name is|in today'?s video|in this video|today i'?m going to|today we'?re going to|today i want to)\b/i,
    signoff: /\b(thanks? (you )?(so much )?for watching|thank you all|(like and )?subscribe|see you (next time|soon|in the next|tomorrow)|that'?s (it|all) for (today|now|this)|follow (me|us) for|don'?t forget to|leave a comment|smash (that|the) like|bye( bye)?|peace out|until next time)\b/i,
    filler: /^\s*(um+|uh+|er+|ah+|hmm+|like|so|okay|ok|you know|i mean|right|yeah|well)[\s,.!?]*$/i,
    laugh: /\(?\[?(laughter|laughing|laughs|applause|cheering|audience laughs?)\]?\)?/i,
    concrete: /\b[A-Z][a-z]{2,}\b/
  };

  function words(text) { return String(text || "").trim().split(/\s+/).filter(Boolean); }

  /* Features of one spoken line, as 0/1 flags plus a few sizes. `first`
     marks the very first line of the source (where greetings live). */
  function lineFeatures(text, opts) {
    const t = String(text || "").trim();
    const w = words(t);
    const inner = t.replace(/^\S+\s*/, "");   // ignore the capital that starts every sentence
    return {
      words: w.length,
      number: RX.number.test(t) ? 1 : 0,
      you: RX.you.test(t) ? 1 : 0,
      contrast: RX.contrast.test(t) ? 1 : 0,
      absolute: RX.absolute.test(t) ? 1 : 0,
      stakes: RX.stakes.test(t) ? 1 : 0,
      arousal: RX.arousal.test(t) || /!/.test(t) ? 1 : 0,
      question: RX.question.test(t) ? 1 : 0,
      vague: RX.vagueOpen.test(t) ? 1 : 0,
      payoff: RX.payoff.test(t) ? 1 : 0,
      signpost: RX.signpost.test(t) ? 1 : 0,
      greeting: RX.greeting.test(t) ? 1 : 0,
      signoff: RX.signoff.test(t) ? 1 : 0,
      filler: (RX.filler.test(t) || w.length < 3) ? 1 : 0,
      laugh: RX.laugh.test(t) ? 1 : 0,
      concrete: RX.concrete.test(inner) || RX.number.test(t) ? 1 : 0,
      tooLong: w.length > 24 ? 1 : 0,
      opener: opts && opts.first ? 1 : 0
    };
  }

  /* Hook weights: the direction of each comes from findings RQ1 (specific and
     concrete up, E43; surprise and arousal up, E06/E56; stakes up, E22; vague
     teasers and greetings down, E43/E13; long lines down, H2). Vision-1.0
     replaces these numbers with weights it learned (vision.js), the signs
     stay where the evidence put them. */
  const HOOK_WEIGHTS = {
    // question: slightly against, as the randomized evidence is (E43 outweighs E42)
    bias: -1.2, number: 0.7, you: 0.35, contrast: 0.6, absolute: 0.45, stakes: 0.8, arousal: 0.55,
    question: -0.2, vague: -0.9, payoff: 0.25, signpost: -0.1, greeting: -2.2, signoff: -2.5,
    filler: -2.5, laugh: 0.4, concrete: 0.45, tooLong: -0.8, opener: -0.2, prosody: 0.9
  };

  // prosody: how much louder / higher than the speaker's own norm (0..1), see prosodyOf()
  function hookScore(text, opts, weights) {
    const W = weights || HOOK_WEIGHTS;
    const f = lineFeatures(text, opts);
    let z = W.bias || 0;
    for (const k in f) if (k !== "words" && W[k]) z += W[k] * f[k];
    if (opts && typeof opts.prosody === "number") z += (W.prosody || 0) * opts.prosody;
    return 1 / (1 + Math.exp(-z));
  }

  function hookType(text) {
    const f = lineFeatures(text);
    if (f.stakes && !f.question) return "stakes";
    if (f.contrast || f.absolute) return "contrarian";
    if (f.payoff) return "result";
    if (f.number) return "number";
    if (/\b(i'?ve never|i never told|confess|admit|truth is|honestly)\b/i.test(text)) return "confession";
    if (f.question && !f.vague) return "question";
    if (f.you) return "relevance";
    return "result";
  }

  /* Loudness and pitch of a stretch against the speaker's own average, from
     brain.js's audio analysis (energy, zero-crossing rate per hop). 0 = their
     norm or quieter, 1 = clearly lifted: the excitement a hook often carries. */
  function prosodyOf(aud, s, e) {
    if (!aud || !aud.energy || !aud.energy.length) return 0;
    const hop = aud.hop || 0.05;
    const i0 = clamp(Math.floor(s / hop), 0, aud.energy.length - 1), i1 = clamp(Math.ceil(e / hop), i0 + 1, aud.energy.length);
    let es = 0, zs = 0, n = 0;
    for (let i = i0; i < i1; i++) { es += aud.energy[i]; zs += (aud.zcr && aud.zcr[i]) || 0; n++; }
    if (!n) return 0;
    const mean = aud._mean || (aud._mean = aud.energy.reduce((a, b) => a + b, 0) / aud.energy.length || 0.0001);
    const zmean = aud._zmean || (aud._zmean = (aud.zcr && aud.zcr.length ? aud.zcr.reduce((a, b) => a + b, 0) / aud.zcr.length : 0.0001) || 0.0001);
    const lift = (es / n) / mean, zl = (zs / n) / zmean;
    return clamp(((lift - 1) * 0.8 + (zl - 1) * 0.5), 0, 1);
  }

  /* ═══════════ GENRE FROM WORDS ═══════════
     The Director names the genre itself; this is for Vision-1.0 and for
     checking. Cue lexicons per genre, counted per 100 words. */
  const GENRE_CUES = {
    tutorial: /\b(step|steps|add|mix|stir|cut|place|put|pour|recipe|ingredients?|tablespoons?|teaspoons?|grams?|minutes?|make sure|you need|you'?ll need|let me show|how to|first you|then you|next you|press|click|hold|technique|practice|exercise)\b/gi,
    story: /\b(i was|i had|i went|i got|i felt|i thought|i realized|when i|one day|years ago|back then|my (mom|dad|mother|father|wife|husband|friend|family|life|son|daughter)|i remember|that'?s when)\b/gi,
    explainer: /\b(is called|means|because|the reason|scientists?|actually|basically|in other words|for example|that'?s why|how does|why does|what is|works by|energy|light|gravity|space|earth|planet|sun|moon|universe)\b/gi,
    opinion: /\b(i think|i believe|in my opinion|honestly|should|shouldn'?t|overrated|underrated|the problem with|unpopular|i disagree|we need to|stop)\b/gi,
    comedy: /\b(laughter|laughing|applause|i'?m like|she'?s like|he'?s like|was like|you know what|joke|funny|my mom|my dad|immigrant|ladies and gentlemen)\b/gi,
    review: /\b(price|worth it|features?|battery|quality|recommend|pros|cons|this device|the app|screen|scanner|product|model|version|compared to|cheaper|expensive)\b/gi,
    vlog: /\b(today we|today i|we'?re going|let'?s go|here we are|right now|this morning|tonight|on my way|we just|day in the life|come with me)\b/gi,
    talk: /\b(teachers?|students?|inspire|inspired|dream|dreams|future|thank you|grateful|believe in|change the world|you can do|never give up|my message)\b/gi,
    interview: /\b(question|great question|tell us|could you|what made you|how did you|so you'?re saying|in your view|we'?re talking with)\b/gi,
    listicle: /\b(number (one|two|three|four|five)|tip (one|two|three|number)|reasons?|ways to|things (you|that)|the first one|the last one)\b/gi
  };

  function detectGenre(lines) {
    const text = (lines || []).map((l) => (typeof l === "string" ? l : l.text || "")).join(" ");
    const n = Math.max(1, words(text).length);
    const scores = {};
    let best = "explainer", top = -1;
    for (const g in GENRE_CUES) {
      const m = text.match(GENRE_CUES[g]);
      const s = ((m ? m.length : 0) * 100) / n;
      scores[g] = Math.round(s * 100) / 100;
      if (s > top) { top = s; best = g; }
    }
    return { genre: top > 0.3 ? best : "talk", scores: scores };
  }

  /* ═══════════ 3. WHAT THE EDITOR ENFORCES ═══════════ */

  // A clip's spoken words, in source seconds.
  function wordsIn(m, a, b) {
    const ws = m && m.words && m.words.length ? m.words
      : (m && m.transcript || []).map((c) => ({ text: c.text, start: c.s, end: c.e }));
    return ws.filter((w) => w.end > a + 0.02 && w.start < b - 0.02);
  }
  // Sentences (transcript lines) overlapping [a, b].
  function linesIn(m, a, b) {
    return (m && m.transcript || []).filter((c) => c.e > a + 0.05 && c.s < b - 0.05);
  }
  function audible(aud, s, e) {
    if (!aud || !aud.energy || !aud.energy.length) return false;
    const hop = aud.hop || 0.05;
    let sum = 0, n = 0;
    for (let i = Math.floor(s / hop); i < Math.min(aud.energy.length, Math.ceil(e / hop)); i++) { sum += aud.energy[i]; n++; }
    return n > 0 && sum / n > 0.2;   // laughter, applause, music: keep it, it is part of the moment
  }

  /* Tighten a finished clip list in place (it runs after brain.js's sentence
     snapping, so every edge is already on a sentence boundary). In order:
       · a first clip that opens on a greeting starts after it (H1, E13)
       · a last clip that ends on a sign-off ends before it (RQ10, P06)
       · the first word comes within half a second (H1, E46)
       · the end comes within 0.7s of the last word (RQ10)
       · a silence of more than 1.1s inside a clip is closed to a breath of
         about 0.45s by splitting the clip (R4; E48 says keep the breath).
         Only a SILENT gap is closed: a laugh or applause is part of the moment.
     Nothing is cut that would leave a clip under 1s, and a clip that is
     nothing but a greeting or a sign-off is dropped only if others remain.
     Returns what it did, for the summary and for the tests. */
  function tighten(clips, media, opts) {
    opts = opts || {};
    const done = { greeting: 0, signoff: 0, lead: 0, tail: 0, gaps: 0, gapSeconds: 0 };
    if (!clips || !clips.length) return done;
    const byId = {};
    (media || []).forEach((m) => { byId[String(m.id)] = m; });
    const M = (c) => byId[String(c.mediaId)];
    const minLen = 1;

    // greeting at the very start
    const c0 = clips[0], m0 = M(c0);
    if (m0 && m0.transcript && m0.transcript.length) {
      const ls = linesIn(m0, c0.in, c0.out);
      if (ls.length && RX.greeting.test(ls[0].text) && !lineFeatures(ls[0].text).stakes) {
        const after = ls[1];
        if (after && c0.out - after.s >= minLen) { c0.in = Math.max(c0.in, after.s - 0.1); done.greeting++; }
        else if (!after && clips.length > 1) { clips.shift(); done.greeting++; }
      }
    }
    // sign-off at the very end
    const cz = clips[clips.length - 1], mz = M(cz);
    if (mz && mz.transcript && mz.transcript.length) {
      const ls = linesIn(mz, cz.in, cz.out);
      const last = ls[ls.length - 1];
      if (last && RX.signoff.test(last.text) && !RX.payoff.test(last.text)) {
        const before = ls[ls.length - 2];
        if (before && before.e - cz.in >= minLen) { cz.out = Math.min(cz.out, before.e + 0.25); done.signoff++; }
        else if (!before && clips.length > 1) { clips.pop(); done.signoff++; }
      }
    }
    // first word within half a second
    const f = clips[0], fm = M(f);
    if (fm) {
      const ws = wordsIn(fm, f.in, f.out);
      if (ws.length && ws[0].start - f.in > 0.5 && f.out - (ws[0].start - 0.15) >= minLen) {
        f.in = Math.max(f.in, ws[0].start - 0.15);
        done.lead++;
      }
    }
    // end within 0.7s of the last word
    const l = clips[clips.length - 1], lm = M(l);
    if (lm && !opts.keepTail) {
      const ws = wordsIn(lm, l.in, l.out);
      const lastEnd = ws.length ? ws[ws.length - 1].end : null;
      if (lastEnd != null && l.out - lastEnd > 0.7 && !audible(lm.analysis && lm.analysis.aud, lastEnd, l.out)) {
        l.out = Math.max(l.in + minLen, lastEnd + 0.5);
        done.tail++;
      }
    }
    // dead air inside clips
    for (let i = 0; i < clips.length; i++) {
      const c = clips[i], m = M(c);
      if (!m || (c.speed && c.speed !== 1)) continue;
      const ws = wordsIn(m, c.in, c.out);
      for (let k = 1; k < ws.length; k++) {
        const gs = ws[k - 1].end, ge = ws[k].start;
        if (ge - gs <= 1.1) continue;
        if (audible(m.analysis && m.analysis.aud, gs + 0.1, ge - 0.1)) continue;
        const a = Object.assign({}, c, { out: gs + 0.3 });
        const b = Object.assign({}, c, { in: ge - 0.15, fadeIn: 0 });
        if (a.out - a.in < minLen || b.out - b.in < minLen) continue;
        a.fadeOut = 0;
        if (b.kb) delete a.kb;   // one zoom per original clip, on its second half
        clips.splice(i, 1, a, b);
        done.gaps++;
        done.gapSeconds += Math.round((ge - gs - 0.45) * 100) / 100;
        break;   // the new second half is visited next and may hold another gap
      }
    }
    return done;
  }

  /* A jump cut (the next clip continues the same shot a little later) reads
     as a glitch when the framing is identical; changing the framing makes it
     read as intended, and the change is itself a small orienting cue (E32,
     E34). Alternate a 12% punch-in on every second clip of a run of jump
     cuts, held still, never on a clip that already moves or changes speed. */
  function zoomCuts(clips) {
    let n = 0, run = 0;
    for (let i = 1; i < clips.length; i++) {
      const a = clips[i - 1], b = clips[i];
      const jump = a.mediaId === b.mediaId && b.in >= a.out - 0.05 && b.in - a.out < 8;
      run = jump ? run + 1 : 0;
      if (!jump || run % 2 === 0) continue;
      if (b.kb || (b.speed && b.speed !== 1) || b.out - b.in < 1.2) continue;
      b.kb = { s0: 1.12, s1: 1.12, x0: 0, x1: 0, y0: -0.02, y1: -0.02 };
      n++;
    }
    return n;
  }

  /* ═══════════ 4. THE VALUE-OF-CONTINUING PROXY ═══════════
     findings RQ3: a viewer stays while the expected value of the next
     seconds beats the next video in the feed. Per quarter second:
       Q  open question     set by the hook, kept up by new gaps, closes at
                            the payoff (E01-E03, E51)
       E  recent value      new content lines, laughs, cuts, cutaways, text
                            (E06, E10, E12, E15, E47)
       P  progress pull     visible structure toward an end (E40)
       C  processing cost   too many new things at once, speech too fast
                            (E09-E11, E19)
       B  habituation       seconds since anything new; silence (E10, E15)
     hazard = base(t) · exp(−(1.4·Q + 1.0·E + 0.6·P) + 0.6·C + 0.3·max(0, B − 3))
     base: 0.20/s in the first second, 0.10/s to 3s (the stay/swipe window,
     E46, P04), 0.035/s after. Survival = exp(−∫hazard).
     These constants express directions and rough sizes, chosen once and kept
     fixed for every comparison; they are not fitted to real audiences. */
  function timelineOf(clips, media) {
    const byId = {};
    (media || []).forEach((m) => { byId[String(m.id)] = m; });
    const ws = [], lines = [], cuts = [];
    let acc = 0;
    clips.forEach((c, ci) => {
      const m = byId[String(c.mediaId)];
      const sp = c.speed || 1;
      if (ci > 0) cuts.push(acc);
      if (m) {
        wordsIn(m, c.in, c.out).forEach((w) => ws.push({ text: w.text, t: acc + (Math.max(w.start, c.in) - c.in) / sp, e: acc + (Math.min(w.end, c.out) - c.in) / sp }));
        linesIn(m, c.in, c.out).forEach((ln) => {
          if (ln.s < c.in - 0.3) return;   // a line already under way was counted in the clip before
          lines.push({ text: ln.text, t: acc + (Math.max(ln.s, c.in) - c.in) / sp, e: acc + (Math.min(ln.e, c.out) - c.in) / sp,
            prosody: prosodyOf(m.analysis && m.analysis.aud, ln.s, ln.e) });
        });
      }
      acc += (c.out - c.in) / sp;
    });
    return { length: acc, words: ws, lines: lines, cuts: cuts };
  }

  function lineValue(text, prosody) {
    const f = lineFeatures(text);
    if (f.greeting || f.signoff) return 0.05;
    if (f.filler) return 0.1;
    let v = 0.35 + 0.12 * f.number + 0.12 * f.contrast + 0.1 * f.absolute + 0.14 * f.stakes + 0.14 * f.arousal +
            0.1 * f.payoff + 0.08 * f.concrete + 0.25 * f.laugh + 0.15 * (prosody || 0);
    return clamp(v, 0, 1);
  }

  function estimate(plan, media, opts) {
    opts = opts || {};
    const clips = (plan && plan.clips) || [];
    const tl = timelineOf(clips, media);
    const T = tl.length;
    if (T <= 0) return null;
    const dt = 0.25, n = Math.ceil(T / dt);
    const ev = new Float32Array(n), stack = new Float32Array(n), talk = new Uint8Array(n), wps = new Float32Array(n);
    const at = (t) => clamp(Math.floor(t / dt), 0, n - 1);
    const mark = (t, v) => { const i = at(t); ev[i] += v; stack[i] += 1; };
    tl.words.forEach((w) => { for (let i = at(w.t); i <= at(Math.max(w.t, w.e - 0.01)); i++) talk[i] = 1; wps[at(w.t)] += 1; });
    /* Every sentence with content is new information (0.35 and up); fillers,
       greetings and sign-offs barely register. The first payoff is the first
       sentence after the opening that carries more than plain information. */
    let firstPayoff = null;
    tl.lines.forEach((ln) => {
      const v = lineValue(ln.text, ln.prosody);
      mark(ln.t, v);
      if (firstPayoff == null && ln.t > 2 && v >= 0.55) firstPayoff = ln.t;
    });
    tl.cuts.forEach((t) => mark(t, 0.25));
    (plan.texts || []).forEach((x) => { if (!x.cap) mark(+x.start || 0, 0.15); });
    (plan.broll || []).forEach((b) => mark(+b.at || 0, 0.3));
    (plan.sfx || []).forEach((s) => mark(+(s.at != null ? s.at : s.start) || 0, 0.1));

    // the open question: strength of the hook, refreshed by new gaps, closed near the end
    const first = tl.lines.find((ln) => !lineFeatures(ln.text).filler);
    const hookText = (plan.texts || []).find((x) => !x.cap && (+x.start || 0) < 1.5);
    let q = first ? hookScore(first.text, { prosody: first.prosody }) : 0.1;
    if (hookText) q = Math.max(q, 0.35 + 0.5 * hookScore(hookText.text));
    const firstSpeech = tl.words.length ? tl.words[0].t : T;
    const numbered = tl.lines.filter((ln) => lineFeatures(ln.text).signpost).length >= 2;
    const tau = Math.max(20, 0.6 * T);
    const gapAt = {};
    tl.lines.forEach((ln) => { const f = lineFeatures(ln.text); if (f.question || f.contrast || f.stakes) gapAt[at(ln.t)] = 0.3; });

    let S = 1, area = 0, Q = q, Erec = 0, sinceEvent = 0, longestLull = 0;
    const hz = [], state = [];
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      if (gapAt[i]) Q = Math.min(1, Q + gapAt[i]);
      Q *= Math.exp(-dt / tau);
      if (t > 0.85 * T) Q = Math.min(Q, 0.25);
      Erec = Erec * Math.exp(-dt / 2.5) + ev[i];
      if (ev[i] >= 0.3) { sinceEvent = 0; } else { sinceEvent += dt; }
      if (!talk[i] && ev[i] < 0.2) sinceEvent += dt * 0.5;   // silence wears out faster
      longestLull = Math.max(longestLull, sinceEvent);
      let rate = 0;
      for (let k = Math.max(0, i - 7); k <= i; k++) rate += wps[k];
      rate /= Math.min(2, (i + 1) * dt);
      const C = Math.max(0, stack[i] - 2) * 0.5 + Math.max(0, rate - 4) * 0.4;
      const P = numbered ? 0.6 * t / T : 0.15 * t / T;
      let base = t < 1 ? 0.2 : t < 3 ? 0.1 : 0.035;
      if (t < 1 && firstSpeech > 0.6) base *= 1.5;
      const h = base * Math.exp(-(1.4 * Q + 1.0 * Math.min(1.2, Erec) + 0.6 * P) + 0.6 * C + 0.3 * Math.max(0, sinceEvent - 3));
      hz.push(h);
      state.push({ since: sinceEvent, C: C, Q: Q });
      area += S * dt;
      S *= Math.exp(-h * dt);
    }
    /* Weak spots: where the hazard climbs past twice this edit's own median
       after the opening, named by what dominates there. Relative on purpose:
       the absolute level depends on constants nobody has calibrated. */
    const later = hz.filter((_, i) => i * dt > 3).slice().sort((a, b) => a - b);
    const med = later.length ? later[Math.floor(later.length / 2)] : 0;
    const dips = [];
    for (let i = 1; i < n; i++) {
      if (i * dt <= 3 || !(hz[i] > 2 * med) || hz[i - 1] > 2 * med) continue;
      const s = state[i];
      dips.push({ t: Math.round(i * dt * 10) / 10, why: s.since > 4 ? "nothing new for " + Math.round(s.since) + "s" : s.C > 0.5 ? "too much at once" : s.Q < 0.2 ? "no open question" : "low value" });
    }
    const band = bandFor(T);
    const completion = S, avgViewed = area / T;
    return {
      length: Math.round(T * 10) / 10,
      band: band.id,
      firstSpeech: Math.round(firstSpeech * 100) / 100,
      hook: Math.round(q * 100) / 100,
      firstPayoff: firstPayoff == null ? null : Math.round(firstPayoff * 10) / 10,
      longestLull: Math.round(longestLull * 10) / 10,
      dips: dips.slice(0, 12),
      completion: Math.round(completion * 1000) / 1000,
      avgViewed: Math.round(avgViewed * 1000) / 1000,
      score: Math.round(100 * (0.5 * completion + 0.5 * avgViewed))
    };
  }

  /* The rule checks behind the numbers, each with the finding it comes from. */
  function check(plan, media) {
    const est = estimate(plan, media);
    if (!est) return { est: null, rules: [] };
    const band = bandFor(est.length);
    const tl = timelineOf(plan.clips || [], media);
    const lastWord = tl.words.length ? tl.words[tl.words.length - 1].e : 0;
    const hook = (plan.texts || []).find((x) => !x.cap && (+x.start || 0) < 1.5);
    const firstLine = tl.lines[0];
    const lastLine = tl.lines[tl.lines.length - 1];
    const rules = [
      { id: "H1", ok: est.firstSpeech <= 0.6, detail: "first word at " + est.firstSpeech + "s" },
      { id: "H1b", ok: !(firstLine && RX.greeting.test(firstLine.text)), detail: firstLine ? "opens on: " + firstLine.text.slice(0, 50) : "no speech" },
      { id: "H5", ok: !!hook && words(hook.text).length <= 10 && !RX.vagueOpen.test(hook.text), detail: hook ? "hook text: " + hook.text : "no hook text in the first 1.5s" },
      { id: "RQ2", ok: est.firstPayoff != null && est.firstPayoff <= band.firstPayoff, detail: "first payoff " + (est.firstPayoff == null ? "not found" : "at " + est.firstPayoff + "s") + " (band " + band.id + " wants ≤" + band.firstPayoff + "s)" },
      { id: "R1", ok: est.longestLull <= band.lull + 1, detail: "longest stretch without anything new " + est.longestLull + "s" },
      { id: "R10", ok: est.length - lastWord <= 1.2 && !(lastLine && RX.signoff.test(lastLine.text)), detail: "ends " + Math.round((est.length - lastWord) * 10) / 10 + "s after the last word" + (lastLine ? ": " + lastLine.text.slice(-40) : "") }
    ];
    return { est: est, rules: rules, passed: rules.filter((r) => r.ok).length, total: rules.length };
  }

  /* The briefs' wording of all this, kept here so the Director, the fallback
     Directors and the knowledge corpus quote one source. */
  function templatesText() {
    return Object.keys(GENRES).map((g) => g + " = " + GENRES[g].beats.map((b) => b[0] + " (" + b[2] + ")").join(" → ")).join("\n");
  }
  function bandsText() {
    return BANDS.map((b) => b.id + " (" + b.label + "): " + b.shape).join("\n");
  }

  const api = {
    GENRES: GENRES, BANDS: BANDS, HOOK_TYPES: HOOK_TYPES, HOOK_WEIGHTS: HOOK_WEIGHTS, RX: RX,
    bandFor: bandFor, lineFeatures: lineFeatures, hookScore: hookScore, hookType: hookType, prosodyOf: prosodyOf,
    detectGenre: detectGenre, tighten: tighten, zoomCuts: zoomCuts, timelineOf: timelineOf, lineValue: lineValue,
    estimate: estimate, check: check, templatesText: templatesText, bandsText: bandsText
  };
  global.VevrisRetention = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
