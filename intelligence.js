/* ================================================================
   vClyps Intelligence Layer — AI Director v2 (story-driven)
   VevrisBrain (orchestrator/editor) -> IntelligenceEngine -> provider

   Providers, in routing priority order:
     1. VisionProvider - our future proprietary model (stub today)
     2. GeminiProvider      - temporary director. Uses the app's shared
                              default key unless the user saves their own
                              in Settings (their key always wins).
     3. Backup Directors   - Groq/Mistral can provide a cloud edit.
     No provider available: reject clearly, never silently apply heuristics.

   The Director follows a strict 10-stage story pipeline (understand ->
   story -> structure -> psychology -> hooks -> strategy -> timeline ->
   captions -> effects -> confidence) and answers ONLY in structured
   JSON. Every response is stored as training data for Vision-1.0.

   It also scores the edit: pass 1 decides the music (whether, what mood
   and genre, how loud), pass 2 places sound effects from the sfx.js
   library on named moments. Both are taught in musicBrief()/soundBrief()
   and enforced in brain.js (placeSounds, musicPlan, pickTrack).
   ================================================================ */

(function () {
  "use strict";

  const DS_KEY = "vclyps-dataset";
  const KEY_KEY = "vclyps-gemini-key";
  /* EXPLICIT model ids, and that is a reversal worth explaining.

     "gemini-flash-latest" was used because an alias cannot be retired out from
     under us. On 2026-09-05 every model in the chain answered 404 anyway — the
     alias is no longer in Google's published model list, and Google's own 404
     text now names a replacement ("use models/gemini-3.5-flash-lite"). An alias
     that silently stops resolving is worse than a version that retires loudly,
     because there is nothing to grep for when it breaks.

     So: three CURRENT stable ids, newest first, cheapest last. When these
     retire the 404 will name their replacements, the same way this one did. */
  const MODEL = "gemini-3.8-flash";

  // Shared diagnostics — every stage reports here so failures are VISIBLE.
  const DIAG = (window.VevrisDiag = window.VevrisDiag || { last: {} });
  // Secure key proxy (Cloudflare Worker — see worker.js for the one-time,
  // free deploy). The owner's API key lives ONLY on the proxy server and
  // can never be read from this app.
  //
  // Live on the Vevris Cloudflare account, verified end-to-end 2026-08-10.
  // (The retired Vantra address, vclyps-director.official-vantra.workers.dev,
  // is NOT ours any more and must never be restored here: this app POSTs
  // users' transcripts and keyframe images to whatever is named below, so a
  // namespace we do not control would hand that footage to a stranger.
  // Leaving this empty is always safer than pointing it somewhere stale —
  // the app then says "not configured" and plans every edit on-device.)
  const PROXY_URL = "https://vclyps-directory.vevrishq.workers.dev";
  // The proxy admits only the origins listed in its ALLOWED_ORIGIN variable,
  // and gates on the request itself as well: it relays only bodies whose
  // first text part names vClyps. Both briefs below open with "You are the
  // vClyps AI DIRECTOR" — keep the product name in them, or the worker will
  // refuse the call with "not a vClyps Director request".

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // A user's personal key (their own choice, stored on their device only).
  const getKey = () => {
    try { return (localStorage.getItem(KEY_KEY) || "").trim(); }
    catch (_) { return ""; } // Private/restricted storage must not disable shared access.
  };

  function directorError(message) {
    const error = new Error(message);
    error.code = "DIRECTOR_UNAVAILABLE";
    return error;
  }

  function accessMessage(message, personal) {
    if (/ALLOWED_ORIGIN/i.test(message)) return "This website address is not allowed by the AI server. Open https://vclyps.com, or ask the owner to allow this exact site address in Cloudflare. " + message;
    if (/HTTP 40[13]|API key not valid|API_KEY_INVALID|permission.denied/i.test(message)) {
      return (personal ? "The Gemini key saved on this device was refused. Remove or replace it in Settings to use the shared Director. "
        : "The shared Gemini server was refused access. The owner needs to check its API key and Google access restrictions. ") + message;
    }
    return message;
  }

  async function checkAccess() {
    if (navigator.onLine === false) throw directorError("You are offline. Reconnect to use the AI Director; your timeline has not been changed.");
    if (getKey() || !PROXY_URL) return;
    // GET never invokes a model or uploads footage. The existing proxy returns
    // 405 for allowed origins, 403 for denied ones. Check before expensive ASR.
    let res;
    try { res = await fetch(PROXY_URL, { method: "GET", cache: "no-store" }); }
    catch (_) { throw directorError("Cannot reach the AI server. Check your connection and website address (https://vclyps.com), then retry."); }
    if (res.status === 405 || res.ok) return;
    let message = "HTTP " + res.status;
    try { const data = await res.json(); if (data.error && data.error.message) message += " — " + data.error.message; } catch (_) {}
    throw directorError(accessMessage(message, false));
  }

  /* ───────── Providers ───────── */

  /* Senotel Vision-1.0 (vision.js): the on-device editor, taught the
     retention research as a curriculum and trained on this Director's
     decisions. Off unless switched on for testing (localStorage
     "vclyps-vision" = "on"), because it does not yet match the cloud
     Director; research/vision/RESULTS.md has the comparison. When it is on
     it plans first, and a plan it cannot make (nothing said in the footage)
     falls through to the Director as before. */
  const VisionProvider = {
    id: "vision-1",
    label: "Vision-1.0",
    available: () => !!(window.VevrisVision && window.VevrisRetention && window.VevrisVision.enabled()),
    plan: async (req) => window.VevrisVision.plan(req)
  };

  const GeminiProvider = {
    id: "gemini",
    label: "Gemini Director",
    available: () => (!!PROXY_URL || !!getKey()) && navigator.onLine,
    plan: geminiPlan
  };

  /* ───────── Fallback Directors (Groq, Mistral) ─────────
     Not to match Gemini — to beat the on-device planner. When Google is
     congested the choice is not "Gemini or something slightly worse", it is
     "something slightly worse or a heuristic cut with no b-roll and a generic
     hook". Any competent model clears that bar, so redundancy across VENDORS
     matters more here than the last few points of quality.

     Both speak the OpenAI chat format, so one caller serves both. They receive
     a LEAN payload — no keyframes, shorter transcript — because Groq's free
     tier allows 6,000 tokens/minute and a full pass 1 is ~11,000. The cost is
     that these two design the story from the words alone, without seeing the
     footage. That is a real downgrade, and an acceptable one for a path that
     should almost never run. */

  function openAiCompatProvider(id, label, path, model) {
    return {
      id: id,
      label: label,
      available: () => !!PROXY_URL && navigator.onLine,
      plan: (req) => chatPlan(req, path, model)
    };
  }

  async function callChat(prompt, maxTokens, path, model) {
    const res = await fetch(PROXY_URL.replace(/\/+$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model,
        max_tokens: maxTokens || 4096,
        temperature: 0.35,
        messages: [{ role: "user", content: prompt }]
      })
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    if (!res.ok) {
      const m = (data && ((data.error && (data.error.message || data.error)) || data.message)) || ("HTTP " + res.status);
      throw new Error(typeof m === "string" ? m.slice(0, 140) : "HTTP " + res.status);
    }
    let out = "";
    try { out = data.choices[0].message.content; } catch (e) { throw new Error("empty response from the director"); }
    out = String(out).replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    try { return JSON.parse(out); }
    catch (e) {
      const salvaged = salvageJSON(out);
      if (!salvaged) throw new Error("director returned invalid JSON");
      return salvaged;
    }
  }

  /* Both fallbacks failed on 2026-09-05 for the same underlying reason: one
     hardcoded model id each, and a model id is not a stable thing. Mistral
     answered "not available in your subscription tier" (mistral-large-latest
     is paid, and the -latest aliases are gone from their docs); Groq answered
     "does not exist or you do not have access". A provider whose whole job is
     to be the backup must not carry a single point of failure of its own, so
     each now walks a chain and only gives up once every model is refused. */
  async function chatPlanOn(req, path, model) {
    // lean = transcripts only, trimmed, and the shorter sound brief — see the note above
    const story = await callChat(storyBrief(req, true) + "\n" + footageText(req, 3500), 1500, path, model);
    const edit = await callChat(editBrief(req, story, true) + "\n" + footageText(req, 3500), 4096, path, model);
    if (story && story.hook && !edit.hook) edit.hook = story.hook;
    if (story && story.look && !edit.look) edit.look = story.look;
    if (story && story.music && !edit.music) edit.music = story.music;
    const out = normalize(edit, req);
    if (!out) throw new Error("director plan had no usable cuts");
    if (!out.story && story) out.story = story.story || null;
    out.retention = retentionOf(story, edit, out);
    out.raw = { story: story, edit: edit };
    return out;
  }

  /* What the Director decided about retention (0.26.0), validated: the genre,
     the length band, the hook's type and the question it opens, and where it
     is paid off. For the diagnostics, the training data and the editor's
     check; nothing here changes the cut. */
  function retentionOf(story, edit, out) {
    const s = story || {}, e = edit || {};
    const X = R();
    const pick = (v, list) => { v = String(v || "").toLowerCase().trim(); return list.indexOf(v) >= 0 ? v : null; };
    const genres = X ? Object.keys(X.GENRES) : [];
    const types = X ? Object.keys(X.HOOK_TYPES) : [];
    const r = {
      genre: pick(s.genre || e.genre, genres),
      band: pick(s.band || e.band, ["micro", "short", "standard", "long", "mid"]),
      hookType: pick(s.hookType || e.hookType, types),
      gap: s.gap ? String(s.gap).replace(/\s+/g, " ").trim().slice(0, 120) : null,
      payoffAt: isFinite(parseFloat(s.payoffAt)) ? +parseFloat(s.payoffAt).toFixed(2) : null
    };
    const p = e.payoff;
    if (p && typeof p === "object" && out && out.clipFor) {
      const c = out.clipFor[Math.floor(+p.clip)];
      const t = parseFloat(p.at);
      if (c && isFinite(t) && t >= c.in - 0.5 && t <= c.out + 0.5) r.payoffAt = +t.toFixed(2);
    }
    return r;
  }

  /* Only a MODEL problem advances to the next id. A bad key, a rate limit or
     a network failure would hit every model in the chain identically, so
     walking the whole list would multiply the wait before reporting the same
     thing back. */
  const MODEL_GONE = /does not exist|no longer available|not available in your subscription|decommissioned|unknown model|invalid model|model_not_found|HTTP 404/i;

  async function chatPlan(req, path, models) {
    const list = Array.isArray(models) ? models : [models];
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      try {
        return await chatPlanOn(req, path, list[i]);
      } catch (e) {
        lastErr = e;
        const msg = (e && e.message) || String(e);
        if (!MODEL_GONE.test(msg)) throw e;
        DIAG.last[path.replace("/", "") + "Retry"] = list[i] + " refused — " + msg.slice(0, 90);
      }
    }
    throw lastErr;
  }

  /* Flatten the footage to plain text for the chat providers — same facts the
     Gemini path sends as structured parts, minus the images. */
  function footageText(req, charBudget) {
    let budget = charBudget || 3500;
    const lines = [];
    req.media.forEach((m) => {
      let t = "SOURCE id " + m.id + " · " + m.type + " · \"" + m.name + "\" · " + (m.duration || 0).toFixed(1) + "s";
      if (m.stats) t += " · motion " + m.stats.avgMot + " · loudness " + m.stats.loud;
      if (m.transcript && m.transcript.length) {
        t += "\nTRANSCRIPT:";
        for (const c of m.transcript) {
          const row = "\n[" + c.s.toFixed(1) + "-" + c.e.toFixed(1) + "] " + c.text;
          if (budget - row.length < 0) break;
          budget -= row.length;
          t += row;
        }
      } else {
        t += "\n(no speech detected)";
      }
      lines.push(t);
    });
    return lines.join("\n");
  }

  /* Mistral moved to DATED model ids and dropped the -latest aliases, which is
     why "mistral-large-latest" resolved to something the free tier cannot
     touch. Small first, then the Ministrals: the cheap end of the range, which
     is the end a free tier actually serves. The ids are written as Mistral's
     docs list them ("mistral-small-2603" is Small 4); the spelled-out form
     used before ("mistral-small-4-0-26-03") was never a real id, so this
     fallback had been dead since 2026-09-05 (found 2026-10-07). */
  const MISTRAL_MODELS = ["mistral-small-2603", "ministral-14b-2512", "ministral-8b-2512"];
  const MistralProvider = openAiCompatProvider("mistral", "Mistral Director", "/mistral", MISTRAL_MODELS);
  /* Groq shut both Llamas down on 2026-08-16 and names gpt-oss as their
     replacement. gpt-oss reasons, but on Groq the reasoning comes back apart
     from the answer, so json_object holds: a 4,500-token pass-1 prompt came
     back as clean JSON on both sizes (2026-10-07). Not qwen: its reasoning
     breaks Groq's JSON validation on the long pass 1. */
  const GROQ_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
  const GroqProvider = openAiCompatProvider("groq", "Groq Director", "/groq", GROQ_MODELS);

  /* Order = quality first, then vendor diversity. Mistral before Groq because
     its free tier is token-generous (1B/month) where Groq's is token-tight;
     Groq is last because it is the fastest, which is what you want when two
     providers have already burned time failing. */
  const ORDER = [VisionProvider, GeminiProvider, MistralProvider, GroqProvider];

  /* ───────── Two-pass Director ─────────
     Pass 1 designs the STORY (no timestamps). Pass 2 EXECUTES that locked
     story into precise cuts. Splitting the job stops the model from losing
     the plot halfway through — it commits to a narrative before cutting. */

  const HARD_RULES = "HARD RULES: never cut mid-sentence (cut at sentence boundaries from the transcript timestamps) · over continuous talking, whole sentences are ATOMIC — keep or drop an entire sentence, never slice inside one, and NEVER impose fixed-interval cuts (no 'cut every 3 seconds') · the video must NEVER end mid-sentence · keep the LOCKED STORY's beat order exactly as given — if beat 1 comes from late in the recording that is a deliberate cold open, do NOT re-sort it back into chronological order · after the opener, stay chronological · never remove setup the payoff depends on · never keep a clip only for movement · retention comes from storytelling, not fast cuts.";

  /* ───────── What keeps people watching (0.26.0) ─────────
     The research is research/retention/findings.md; the rules, templates and
     bands live in retention.js so the Director, the editor and Vision-1.0
     quote one source. These are its words for the briefs. IDs (E43, P06…)
     are the evidence ledger's; they are for us, not for the model. */
  const R = () => window.VevrisRetention || null;

  // RQ1. A specific, credible promise that opens one gap the video closes.
  const HOOK_RULES = [
    "WHAT A HOOK IS: the shortest statement of a specific, credible promise that opens ONE question the video answers. Viewers decide to stay or swipe in the first 1-3 seconds, so:",
    "· The first spoken word comes within half a second; the first moment is a face or the action, never a greeting, a logo, a title or setup.",
    "· Pick the most specific, surprising or high-stakes line the speaker actually says (12 words or fewer is ideal): it names something concrete (a number, an object, a person, an outcome).",
    "· It opens one question (what happens / how / why) and never answers it; the answer must be in the footage, or choose another hook. A promise the footage never pays off is worse than no hook.",
    "· Specific beats vague: a claim with a concrete detail outperforms a vague question ('Did you know...?', 'You won't believe...') because a vague line reads as having no information.",
    "· Choose the hook TYPE from what the footage has: result (show the outcome first, keep how/why for later), stakes (the problem or risk first, keep what happens), contrarian (a surprising claim), number (a specific number or a numbered promise), confession, visual (the action or reaction itself), relevance (a problem the viewer has, said to them), question (only a specific one)."
  ].join("\n");

  // The same, short enough for the backup Directors' free tiers.
  const HOOK_RULES_LEAN = "HOOK: first word within half a second, never a greeting or setup; the most specific, surprising or high-stakes line the speaker says (a number, an object, a person, an outcome), opening one question the footage answers later; a concrete claim beats a vague question. Types: result, stakes, contrarian, number, question, confession, visual, relevance.";

  // RQ4 and RQ10, for pass 2.
  const RETENTION_RULES = "RETENTION RULES (what keeps people to the end): open on speech, not a breath or a greeting · something new arrives every few seconds (new information, a reveal, a laugh, a visible change); cut repetition, preamble, tangents, false starts, 'hi guys', 'in this video' and dead air, but keep a short breath before a key word · keep the main question open until the last 20-30%, closing smaller questions on the way · escalate: weaker beats early, the strongest payoff last · cuts inside a thought go on sentence boundaries; a re-engaging cut changes the content, not just the angle · never several new things in the same second (text + cutaway + sound + zoom) · END ON THE PAYOFF: the last kept sentence is the payoff, the punchline or a callback to the hook; nothing after it (no thanks, no subscribe, no recap) · never cut between a setup and its punchline, and never add silence before a punchline.";

  const RETENTION_RULES_LEAN = "RETENTION: open on speech, no greeting · something new every few seconds; cut repetition, preamble, tangents and dead air · keep the main question open until near the end · strongest payoff last · END ON THE PAYOFF: nothing after it · never cut between a setup and its punchline.";

  function structureText(lean) {
    const X = R();
    if (!X) return "";
    if (lean) return "GENRES: " + Object.keys(X.GENRES).join(", ") + ". Lay the beats out in the genre's usual order (story: stakes → context → complications → turn → resolution; tutorial: result → why → numbered steps → mistake → result; explainer: surprising fact → intuition → example → twist → takeaway; opinion: claim → reasons rising → objection → strongest reason → verdict + question; comedy: premise → setup → punchlines rising → button).";
    return "STRUCTURE BY GENRE (beats in order; shares are rough):\n" + X.templatesText() + "\nSTRUCTURE BY LENGTH:\n" + X.bandsText();
  }

  /* The id shown in the JSON EXAMPLE must be a real one. It was hardcoded to 1,
     but media ids climb with every upload, generate and b-roll insert — so on
     any session past the first the example said "1" while the footage was
     "id 7". Models copy the example, normalize() then matched nothing, and the
     whole plan was discarded as "no usable cuts". Mistral hit this; Gemini
     mostly guessed right, which is why it stayed hidden. */
  function exampleId(req) {
    return (req.media && req.media[0] && req.media[0].id) || 1;
  }

  /* No target: the SHORTEST band that still holds the hook, the context the
     payoff needs and the payoff (findings RQ6). Completion falls with length
     and watch-time rankers correct for it, so padding buys nothing (E17, E59). */
  function lengthLine(req) {
    return "TARGET LENGTH: " + (req.target
      ? "aim close to " + req.target + " seconds, but finishing the story beats hitting a number."
      : "as long as the story needs and not a second more: the shortest length that keeps the hook, the context the payoff needs, and the payoff, with every extra beat adding something new. Most single-story shorts land at 30-90s; go to 180s only when each added minute brings new payoffs.") +
      " Format: " + (req.format || "auto") + ". USER DIRECTION (satisfy first): " +
      (req.prompt ? '"' + req.prompt + '"' : "(none — you decide; make it the most watchable story possible).") +
      rangeLine(req);
  }

  /* A clip found inside a long recording is edited like any other video, but
     only from its own stretch of the source. The transcript sent is already
     cut to that stretch; this says so, so the Director doesn't read the
     missing hour as silence it may borrow from. normalize() enforces it. */
  function rangeLine(req) {
    const r = req.range;
    if (!r) return "";
    return " SOURCE RANGE: this is ONE clip chosen from a longer recording. Use only source id " + r.mediaId +
      " between " + r.start.toFixed(1) + "s and " + r.end.toFixed(1) + "s; nothing outside that range exists for this edit.";
  }

  /* ───────── Sound: music and sound effects ─────────
     Taught here, placed by brain.js. The Director decides WHAT and WHERE in an
     editor's terms (this cut, this word, this text arriving, this mood).
     brain.js lines each sound's impact up with its moment, keeps sounds apart,
     sets them lower under speech, and turns the music brief into a real
     track. The same split as for cuts: the model proposes, the editor
     enforces, because a model told the rules still breaks them.

     `lean` is the shorter wording for Groq and Mistral, whose free tiers
     cannot take the full brief on top of the footage. */

  function wantsMusic(req) {
    return !!(req.music && req.music.available && !req.music.chosen);
  }

  /* PASS 1 decides the music. It is a choice about the whole story's tone, the
     same kind of decision as the look, and pass 1 is the pass that SEES the
     footage. The query examples are ones the royalty-free library was checked
     to answer (2026-09-21): a mood and a genre work, three specific words
     often return nothing, and a bare word like "rock" finds rocks. */
  function musicBrief(req, lean) {
    if (!req.music || !req.music.available) return null;
    if (req.music.chosen) {
      return "MUSIC: the creator has already chosen the music bed (\"" + String(req.music.chosen).slice(0, 60) + "\"). Keep it; do not choose another.";
    }
    if (lean) {
      return "MUSIC: one instrumental bed from a royalty-free library, looping under the whole edit. use false if the footage already has music (a bpm is listed), the natural sound is the point, or the story is grief or intimate. Otherwise query = a mood then a genre or instrument (\"chill lofi\", \"sad piano\", \"upbeat funk\", \"dark cinematic\"), chosen for the story's emotion and pace, never its topic, never vocals. level \"under\" if anyone talks, else \"forward\". The creator's direction wins.";
    }
    return [
      "MUSIC: the edit can carry ONE instrumental music bed from a royalty-free library, looping under the whole video. Choose it like a music supervisor:",
      "· FIRST decide whether it needs music at all. It does not when the footage already has its own music (a bpm is listed), when the natural sound IS the content (ASMR, cooking, nature, a performance, a crowd), or when the story is grief, an apology or anything intimate. Then answer use false.",
      "· Otherwise choose for the story's EMOTION and PACE, never its literal topic (a cooking video does not want \"kitchen music\"): hype and fast cuts want upbeat and driving, a tutorial wants something light that stays out of the way, a story with a payoff wants warmth or tension, a calm vlog wants lofi or acoustic.",
      "· query: a MOOD then a GENRE or INSTRUMENT, 2-3 plain words a music library tags with: \"chill lofi\", \"sad piano\", \"upbeat funk\", \"dark cinematic\", \"happy ukulele\", \"epic orchestral\", \"inspiring piano\", \"hip hop beat\". Never a song title or an artist, never anything with vocals.",
      "· level: \"under\" whenever anyone talks, so it sits beneath the voice; \"forward\" only when nobody talks and the music carries the video.",
      "· The creator's direction wins: \"no music\" means use false, a named style means that style."
    ].join("\n");
  }

  /* The library, as the Director sees it. Only a sound that BUILDS (the riser)
     needs its timing spelled out: it has to start seconds before its moment,
     so the moment has to leave room for it. Every other sound simply lands on
     the moment it is given. */
  function sfxLibrary(req) {
    return (req.sfx || []).map((s) => {
      const atEnd = s.hit > 0.5 && s.hit >= s.duration - 0.05;
      const builds = s.hit > 0.5;
      return "· " + s.name + (atEnd ? " (builds for " + s.duration.toFixed(1) + "s and lands at its END, so it needs that long before its moment)"
        : builds ? " (builds for " + s.hit.toFixed(1) + "s before it lands, so it needs that long before its moment)" : "") + ": " + s.use;
    }).join("\n");
  }

  function sfxName(req, want) {
    const names = (req.sfx || []).map((s) => s.name);
    return names.indexOf(want) >= 0 ? want : names[0];
  }

  /* PASS 2 places the sound effects: they need exact moments, and pass 2 is
     the pass that cuts. Moments are named against things pass 2 is writing
     anyway (its clips, its texts, its b-roll), never as timeline seconds,
     which do not exist yet: brain.js snaps and merges clips afterwards. */
  function soundBrief(req, lean) {
    if (!req.sfx || !req.sfx.length) return null;
    const anchors = "{\"sound\":name,\"clip\":i,\"at\":\"cut\"} = on the cut INTO kept clip i · {\"sound\":name,\"clip\":i,\"at\":seconds} = at that SOURCE timestamp, inside kept clip i · {\"sound\":name,\"text\":i} = as on-screen text i appears · {\"sound\":name,\"broll\":i} = as b-roll item i appears (skipped if none is found)";
    if (lean) {
      return "SOUND EFFECTS (exact names): " + req.sfx.map((s) => s.name + (s.hit > 0.5 ? " (builds, needs " + s.hit.toFixed(1) + "s before its moment)" : "")).join(", ") +
        ". Each marks a MOMENT the viewer should feel; name the moment and the editor aligns the sound. Anchors: " + anchors +
        ". 3-7 sounds, never two within half a second except a riser with the boom or subdrop on its moment, never over a word that matters, nothing comic in a serious video, [] if the creator's direction says no sound effects.";
    }
    return [
      "SOUND EFFECTS: use them the way a top short-form editor does, with restraint. Each one marks a MOMENT the viewer should feel: a cut to somewhere new, a reveal, a punchline, a number, a mistake, something appearing on screen. Sound on everything is noise, and noise reads as cheap.",
      "THE LIBRARY (exact names):\n" + sfxLibrary(req),
      "PLACING ONE: name the MOMENT, never where the sound starts; the editor lines every sound up so its impact lands exactly there. " + anchors + ". Take moments from the transcript timestamps: the stressed word of the punchline, the number being said, the breath after the reveal.",
      "RULES: roughly one sound per 5 seconds at most, usually 3-7 in a 30-60s edit · never two within half a second, except a riser or drum roll and the boom or sub drop landing on its moment · never bury a word that matters: land impacts on the stressed word or in the breath after it, whooshes on cuts between sentences, and crowd sounds (applause, laugh, gasp, crickets) only in a pause · tie sounds to what the eye sees change (text arriving, a cutaway, a new place) · match the tone: nothing comic (airhorn, buzz, scratch, rimshot, sadtrombone, crickets, laugh) in a serious, sad or sincere video, and zero sounds is right for tender or intimate footage · each comedy sting once per video at most · when the music leads (level forward), let it carry the video and use fewer · if the creator's direction says no sound effects, answer [] · 'why' names the moment in 8 words or fewer."
    ].join("\n");
  }

  // PASS 1 — understand the footage and design the story (no exact cuts yet)
  function storyBrief(req, lean) {
    const L = [];
    L.push("You are the vClyps AI DIRECTOR: an Oscar-winning editor + viral short-form strategist. This is STEP 1 of 2 — design the STORY. Do NOT choose final timestamps yet.");
    L.push(BRANDING_RULE);
    L.push("You receive transcripts with timestamps, audio/motion stats, and keyframe images so you can SEE the footage. Study it all first: what happens, who/what is involved, the emotional payoff, and what the viewer is waiting for.");
    /* 0.26.0: the order of thinking follows the research (findings.md): what
       kind of video this is, how long it should be, what the hook promises
       and where the footage pays it off, then the beats that get from one to
       the other. A viewer keeps watching while the next seconds are worth
       more than the next video: an open question, something new arriving,
       visible progress, nothing confusing, nothing stale. */
    L.push("THINK IN THIS ORDER. (1) GENRE: which kind of video this footage makes (" + (R() ? Object.keys(R().GENRES).join(", ") : "story, tutorial, explainer, opinion, comedy, listicle, interview, review, reaction, vlog, talk") + "). (2) LENGTH BAND: micro (≤15s), short (15-45s), standard (45-90s) or long (90-180s), the shortest that holds the hook, the context the payoff needs, and the payoff. (3) HOOK and its PAYOFF: what the opener promises and the moment in the footage that delivers it. (4) BEATS: the genre's structure, with the main question held open until near the end.");
    L.push(lean ? HOOK_RULES_LEAN : HOOK_RULES);
    /* The speaker usually ALREADY says their own hook — the boldest claim, the
       number, the reversal — and inventing a new line on top of it produces
       something generic that contradicts the footage. Find theirs first. */
    L.push("FINDING THE HOOK — this decides whether the video works. Read the transcript for the line the speaker ALREADY says that is most arresting: the boldest claim, the surprising number, the reversal, the thing that sounds like a mistake until it isn't, the moment they get excited. Use THAT moment as the hook beat, and base the hook line on THEIR words — tighten or shorten it, but do not invent a new claim and do not summarise. Only write an original line if nothing in the transcript can carry it. A hook that promises something the footage never delivers is worse than no hook.");
    L.push(structureText(lean));
    L.push("Every beat must earn its place by adding something new: a fact, a turn, a laugh, a feeling. A context beat is ONE line. End the video on the payoff beat (or a callback to the hook), never on a sign-off.");
    /* Was "keep chronological order except a cold-open hook" — permission, not
       instruction, so the model took the safe chronological path every single
       time. Creators very commonly record the hook LAST (they work out what the
       video is about by making it), so the strongest opener is frequently in the
       final seconds. This now requires an active decision. */
    L.push("SEARCH THE WHOLE CLIP FOR THE OPENER, INCLUDING THE END. Creators very often record their hook LAST, after they know what the video became — so the most arresting moment is frequently in the final seconds, not the first. Judge every region on how well it stops a scroll, not on where it sits in the recording. If the best opener is NOT the earliest moment, make it beat 1 anyway (a cold open) and then continue chronologically from the start of the story. Do not default to chronological order simply because it is safer; opening on throat-clearing, setup or a greeting wastes the only three seconds that matter.");
    L.push(lengthLine(req));
    const music = musicBrief(req, lean);
    if (music) L.push(music);
    L.push("Respond with ONLY this compact JSON — list beats IN FINAL PLAYBACK ORDER. from/to are the rough source-time regions that serve each beat (refined in step 2). Chronological except a cold-open hook. 'gap' is the question the hook opens (10 words or fewer); 'payoffAt' the SOURCE second where the footage answers it:");
    const shape = {
      story: "one-sentence summary of the whole video",
      genre: R() ? Object.keys(R().GENRES).join("|") : "story|tutorial|explainer|opinion|comedy",
      band: "micro|short|standard|long",
      hook: "the on-screen hook line for 0s: a statement in the speaker's words, 8 words or fewer, specific",
      hookType: "result|stakes|contrarian|number|question|confession|visual|relevance",
      gap: "the question the hook opens",
      payoffAt: 0.0,
      // real id, not a hardcoded 1 — see the note in editBrief
      beats: [{ beat: "hook|context|the genre's beat names|payoff", says: "what this beat delivers", mediaId: exampleId(req), from: 0.0, to: 5.0 }],
      look: "none|cinematic|vivid|warm|cool|noir|vintage|dreamy"
    };
    /* Placeholders, not a real query: models copy example values, and a
       literal "chill lofi" here would put the same track under every video. */
    if (wantsMusic(req)) shape.music = { use: true, query: "mood + genre, 2-3 words", level: "under|forward", why: "10 words or fewer" };
    shape.confidence = 0.9;
    L.push(JSON.stringify(shape));
    return L.join("\n");
  }

  // PASS 2 — execute the locked story into precise cuts + captions
  function editBrief(req, story, lean) {
    const L = [];
    L.push("You are the vClyps AI DIRECTOR. This is STEP 2 of 2 — EXECUTE the locked story below into a precise edit using the transcript timestamps.");
    L.push(BRANDING_RULE);
    L.push("LOCKED STORY (do not change the narrative or beat order): " + JSON.stringify(story));
    L.push(HARD_RULES);
    L.push(lean ? RETENTION_RULES_LEAN : RETENTION_RULES);
    L.push(lengthLine(req));
    L.push("Turn each beat into precise kept clips. Captions are SHORT phrases (≤5 words) shown one at a time, centered, synced to speech — at most 40. Every 'reason' names the beat it serves, ≤12 words.");
    /* A statement, in their words (0.26.0 test round): asked to "restate the
       gap", the Director put the gap itself on screen as a question ("What
       brought him to the brink at 17?") and once added a word the speaker
       never said. Questions read as less informative (E43). */
    L.push("TEXTS: the hook line is REQUIRED — text at 0.1s, 8 words or fewer: a STATEMENT made from the speaker's own words that sets up the locked story's gap without answering it. Shorten their words; never add a claim or a word they did not say. Never a question, never a summary, never a greeting, no emoji.");
    L.push("EFFECTS: a punch-in marks the stressed line of a reveal or a payoff, at most one every ~8 seconds; slow-mo or speed-up only where the motion itself is the point.");
    /* Phrased as an EXPECTATION, not an option. The earlier wording ended with
       "skip b-roll entirely rather than forcing it", and the model took that
       invitation every single time — b-roll came back as [] on every generate,
       so the feature looked broken when it was simply being declined. */
    /* Anchored to WORDS, not to a clip (0.25.0). The old 'after: clip index'
       put every cutaway a third of a second into its clip, whatever was being
       said there, so a GIF about the rent arrived while the speaker was still
       saying hello. It now appears on the words it illustrates. */
    L.push("BROLL — include 2-3 items. Short-form without cutaways feels flat, so find the moments that earn one: a reaction to punctuate, a thing or place being described, a joke to land. Each item illustrates ONE spoken moment and appears exactly when those words are said: 'clip' is the kept clip index, 'at' the SOURCE timestamp where those words start (from the transcript), and 'say' the 2-6 words being illustrated, copied exactly from the transcript. Choose words that NAME or CAUSE the picture: 'my rent doubled', not the sentence before it. 'query' is 2-4 plain searchable words, never a sentence. For a gif, write it the way people search for a reaction GIF: the reaction or feeling, plus one well-known subject if it helps ('mind blown', 'facepalm', 'slow clap', 'money rain', 'confused math'), never the speaker's private names or details, which no GIF library has. For a photo or video, the concrete thing that is named ('Tokyo street', 'old laptop', 'rent contract'). CHOOSING kind — vary it, do not reach for a GIF every time. gif = a reaction, a joke, an emotion, something absurd. photo = a SPECIFIC named thing, person, product, place or object the speaker mentions ('my old laptop', 'Tokyo', 'the receipt') — a real photograph reads as evidence where a GIF reads as a punchline, and most talking-head videos name more concrete things than they make jokes. video = movement or atmosphere (a city at night, waves, a crowd). Aim for a MIX across the items rather than three of the same kind. The speaker KEEPS TALKING underneath all of them — b-roll never interrupts the audio. mode: leave it out for the default (a square panel above the captions, speaker still visible); use 'cover' only when the b-roll should briefly take the whole frame. Use fewer than 2 only if the footage genuinely offers no moment worth punctuating. A cutaway that does not show what is being said costs attention instead of adding it, and never cover a punchline, a reaction or a reveal the viewer should see on the speaker's face.");
    const sound = soundBrief(req, lean);
    if (sound) L.push(sound);
    L.push("Respond with ONLY this compact JSON, short enough to finish completely:");
    const shape = {
      editPlan: [{ mediaId: exampleId(req), in: 0.0, out: 4.2, beat: "hook|context|the locked story's beat|payoff", reason: "brief" }],
      captions: [{ text: "short phrase", start: 0.0, dur: 2.0 }],
      texts: [{ text: "on-screen hook line", start: 0.1, dur: 2.2, pos: "top", size: 38 }],
      broll: [{ clip: 1, at: 8.2, say: "my rent doubled", query: "shocked reaction", kind: "gif", dur: 1.5 }],
      effects: [{ clip: 0, type: "punch-in|slow-mo|speed-up" }]
    };
    // One of each anchor, so the shape of all three is visible at a glance.
    if (sound) {
      shape.sfx = [
        { sound: sfxName(req, "pop"), text: 0, why: "hook appears" },
        { sound: sfxName(req, "whoosh"), clip: 1, at: "cut", why: "cut to a new place" },
        { sound: sfxName(req, "boom"), clip: 2, at: 12.4, why: "the reveal lands" }
      ];
    }
    // where the hook's question is answered, as a kept clip and its SOURCE second
    shape.payoff = { clip: 2, at: 12.4 };
    shape.reasoning = ["≤3 brief decisions"];
    shape.confidence = 0.95;
    L.push(JSON.stringify(shape));
    return L.join("\n");
  }

  /* ───────── Finding clips in a long recording ─────────
     One call over the WHOLE transcript plus what the device measured (laughs,
     applause, lively delivery, faces, action). It picks moments; it does not
     edit them. Each clip the creator chooses to make is then edited by the
     normal two passes above, scoped to its own stretch, so a finished clip
     costs exactly what a finished video costs today and a moment nobody
     wants costs nothing beyond this one call. clips.js builds the request
     and settles the answer onto sentence boundaries. */
  const CLIP_TYPES = ["story", "insight", "tip", "funny", "emotional", "reaction", "hot take", "action"];

  function clipBrief(req) {
    const L = [];
    const w = req.window, len = req.length;
    L.push("You are the vClyps AI DIRECTOR, finding the best short clips inside one long recording. Each clip you choose is turned into a finished short afterwards (hook, captions, b-roll, music), so choose MOMENTS worth finishing, not edits.");
    L.push(BRANDING_RULE);
    L.push("WHAT MAKES A CLIP: it stands alone (someone scrolling with no context understands it within three seconds) · it opens on something arresting: a bold claim, a question, a number, a confession, the setup of a joke, a reaction · it pays that opening off before it ends · it ends on a finished thought, never mid-sentence. Look for complete stories, strong opinions, surprising facts, practical tips, funny exchanges, emotional peaks and big reactions. Never choose intros, greetings, sponsor reads, housekeeping, or anything that only makes sense with earlier context.");
    L.push("MOMENTS were measured on the creator's device: laughter, applause, cheering, shouting, gasps, crying, music, lively delivery (the speaker louder, higher or faster than their own norm), big smiles, surprised faces, scene changes and bursts of action. They mark where something HAPPENED. Use them to find peaks, then build the clip around what was said: a funny clip should END just after the laugh, not before it.");
    if (req.keyframes && req.keyframes.length) {
      L.push("There is little speech in this recording, so stills from its strongest moments are attached. Judge what happens on screen: action, a reveal, a reaction, something visually striking.");
    }
    L.push("WINDOW: only use " + fmtTime(w.start) + " to " + fmtTime(w.end) + " (" + w.start.toFixed(1) + "s to " + w.end.toFixed(1) + "s).");
    L.push("LENGTH: every clip between " + len.min + " and " + len.max + " seconds.");
    L.push("COUNT: up to " + req.count + " clips, BEST FIRST, no two overlapping. Fewer great clips beat padding with weak ones.");
    L.push("USER DIRECTION (satisfy first): " + (req.prompt
      ? '"' + req.prompt + '". If it names a TOPIC, return only clips about that topic, even if that means very few or none. If it names a KIND of moment (funny, emotional, tips, reactions), choose those.'
      : "(none: choose the moments most likely to be watched to the end and shared)."));
    L.push("TIMESTAMPS come from the transcript, where each line starts with the second its sentence begins: start = the time of the clip's first sentence; end = the time of the sentence AFTER its last one (or the end of the window).");
    L.push("title: what it is about, 8 words or fewer. hook: an on-screen opener of 10 words or fewer, built from the speaker's own words. why: 15 words or fewer on why it works. type: one of " + CLIP_TYPES.join(", ") + ".");
    L.push("Respond with ONLY this JSON:");
    L.push(JSON.stringify({ clips: [{ start: 0.0, end: 0.0, title: "what it is about", hook: "opener from their words", why: "why it works", type: "story" }] }));
    return L.join("\n");
  }

  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
  }

  // The recording as text: sentence starts, then the measured moments.
  function findText(req) {
    const m = req.media;
    const head = "SOURCE id " + m.id + " · \"" + m.name + "\" · " + fmtTime(m.duration) + " long";
    const lines = req.lines && req.lines.length ? req.lines.join("\n") : "(no speech detected)";
    const moments = req.moments && req.moments.length ? req.moments.join("\n") : "(none measured)";
    return head + "\nTRANSCRIPT (second it starts, then the sentence):\n" + lines + "\nMOMENTS:\n" + moments;
  }

  function findParts(req) {
    const parts = [{ text: clipBrief(req) }, { text: findText(req) }];
    (req.keyframes || []).slice(0, 12).forEach((kf) => {
      const b64 = (kf.data || "").split(",")[1];
      if (!b64) return;
      parts.push({ text: "still at " + kf.t + "s:" });
      parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
    });
    return parts;
  }

  /* The answer, validated against the window it was given. Snapping onto
     sentence edges and enforcing the length happens in clips.js, which holds
     the transcript; this only throws out what can't be a clip at all. */
  function normalizeFound(plan, req) {
    const list = plan && Array.isArray(plan.clips) ? plan.clips : null;
    if (!list) return null;
    const brandSafe = brandingGuard({ media: [], prompt: req.prompt || "" });
    const w = req.window;
    const out = [];
    list.slice(0, 40).forEach((c) => {
      if (!c || typeof c !== "object") return;
      let a = +c.start, b = +c.end;
      if (!isFinite(a) || !isFinite(b)) return;
      if (b < a) { const t = a; a = b; b = t; }
      a = clamp(a, w.start, w.end);
      b = clamp(b, w.start, w.end);
      if (b - a < 3) return;
      const str = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
      const title = str(c.title, 80), hook = str(c.hook, 90), why = str(c.why, 140);
      if (!brandSafe(title) || !brandSafe(hook)) return;
      const type = String(c.type || "").toLowerCase().trim();
      out.push({ start: a, end: b, title: title || "Untitled moment", hook: hook, why: why, type: CLIP_TYPES.indexOf(type) >= 0 ? type : "story" });
    });
    return out;
  }

  /* Gemini first, then the backups, the same order and the same honesty as an
     edit. Groq's free tier allows 6,000 tokens a minute, which an hour of
     transcript is well past, so it is only asked when the request fits. */
  async function findClips(req) {
    if (navigator.onLine === false) throw directorError("You are offline. Reconnect to find clips.");
    const tried = [];
    if (GeminiProvider.available()) {
      try {
        const plan = await callWithRetry(findParts(req), 8192);
        const out = normalizeFound(plan, req);
        if (out) { DIAG.last.provider = "gemini"; DIAG.last.gemini = "ok"; return out; }
        DIAG.last.gemini = "returned no usable clips";
      } catch (e) { DIAG.last.gemini = (e && e.message) || String(e); }
      tried.push("Gemini: " + DIAG.last.gemini);
    }
    const prompt = clipBrief(req) + "\n" + findText(req);
    const backups = [["mistral", "/mistral", MISTRAL_MODELS], ["groq", "/groq", GROQ_MODELS]];
    for (const [id, path, models] of backups) {
      if (!PROXY_URL || navigator.onLine === false) break;
      if (id === "groq" && prompt.length > 18000) { DIAG.last.groq = "recording too long for its free tier"; continue; }
      for (const model of models) {
        try {
          const out = normalizeFound(await callChat(prompt, 4096, path, model), req);
          if (out) { DIAG.last.provider = id; DIAG.last[id] = "ok"; return out; }
          DIAG.last[id] = "returned no usable clips";
          break;
        } catch (e) {
          DIAG.last[id] = (e && e.message) || String(e);
          if (!MODEL_GONE.test(DIAG.last[id])) break;
        }
      }
      tried.push(id + ": " + DIAG.last[id]);
    }
    DIAG.last.provider = "unavailable";
    throw directorError("Couldn't reach the AI Director to find clips. " + (tried.join(" · ") || "Not configured") + ". Nothing was changed.");
  }

  /* Caption translation, for browsers without Chrome's on-device translator.
     Lines in, the same number of lines out, in order: the captions keep
     their timing and only their words change. Gemini first, then the two
     backups, exactly like an edit. A line the model drops comes back as the
     original rather than shifting every caption after it. */
  async function translateLines(lines, target) {
    if (navigator.onLine === false) throw directorError("You are offline. Reconnect to translate the captions.");
    const n = lines.length;
    const prompt = "vclyps caption translation. Translate each spoken caption line into " + target + ". " +
      "Natural, spoken " + target + " that a native speaker would say, short enough to read on a phone. " +
      "Keep names, brands, numbers and emoji as they are. Do not merge, split, add or drop lines. " +
      "Return ONLY JSON: {\"lines\": [" + n + " strings, same order]}.\nLINES:\n" + JSON.stringify(lines);
    const pick = (obj) => {
      const arr = obj && Array.isArray(obj.lines) ? obj.lines : null;
      if (!arr || !arr.length) return null;
      return lines.map((l, i) => (typeof arr[i] === "string" && arr[i].trim() ? arr[i].trim() : l));
    };
    const tried = [];
    if (GeminiProvider.available()) {
      try {
        const out = pick(await callWithRetry([{ text: prompt }], 8192));
        if (out) return out;
        tried.push("Gemini: no lines");
      } catch (e) { tried.push("Gemini: " + ((e && e.message) || e)); }
    }
    for (const [path, models] of [["/mistral", MISTRAL_MODELS], ["/groq", GROQ_MODELS]]) {
      if (!PROXY_URL) break;
      for (const model of models) {
        try {
          const out = pick(await callChat(prompt, 4096, path, model));
          if (out) return out;
          tried.push(path.slice(1) + ": no lines");
          break;
        } catch (e) {
          const msg = (e && e.message) || String(e);
          tried.push(path.slice(1) + ": " + msg);
          if (!MODEL_GONE.test(msg)) break;
        }
      }
    }
    throw directorError("Couldn't translate the captions. " + tried.join(" · "));
  }

  function footageParts(req, includeFrames) {
    const parts = [];
    let charBudget = 9000, frameBudget = includeFrames ? 12 : 0;
    req.media.forEach((m) => {
      let txt = "SOURCE id " + m.id + " · " + m.type + " · \"" + m.name + "\" · " + (m.duration || 0).toFixed(1) + "s";
      if (m.stats) {
        txt += " · motion " + m.stats.avgMot + " · loudness " + m.stats.loud + (m.stats.bpm ? " · ~" + m.stats.bpm + " bpm" : "");
      }
      if (m.transcript && m.transcript.length) {
        txt += "\nTRANSCRIPT:";
        for (const c of m.transcript) {
          const row = "\n[" + c.s.toFixed(1) + "-" + c.e.toFixed(1) + "] " + c.text;
          if (charBudget - row.length < 0) break;
          charBudget -= row.length;
          txt += row;
        }
      } else {
        txt += "\n(no speech detected)";
      }
      parts.push({ text: txt });
      (m.keyframes || []).forEach((kf) => {
        if (frameBudget <= 0) return;
        const b64 = (kf.data || "").split(",")[1];
        if (!b64) return;
        frameBudget--;
        parts.push({ text: "keyframe of source " + m.id + " at " + kf.t + "s:" });
        parts.push({ inlineData: { mimeType: "image/jpeg", data: b64 } });
      });
    });
    return parts;
  }

  // one Gemini round-trip → parsed (salvaged) object
  async function callGemini(parts, maxTokens, model) {
    const key = getKey();
    const m = model || MODEL;
    const body = {
      contents: [{ parts: parts }],
      generationConfig: { temperature: 0.35, responseMimeType: "application/json", maxOutputTokens: maxTokens || 8192 }
    };
    const url = key
      ? "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + encodeURIComponent(key)
      : PROXY_URL + (PROXY_URL.indexOf("?") >= 0 ? "&" : "?") + "model=" + encodeURIComponent(m);
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (!res.ok) {
      let msg = "HTTP " + res.status;
      try {
        const ej = JSON.parse(await res.text());
        if (ej.error && ej.error.message) msg += " — " + String(ej.error.message).slice(0, 140);
      } catch (e2) {}
      throw new Error(accessMessage(msg, !!key));
    }
    const data = await res.json();
    const cand = (data.candidates && data.candidates[0]) || null;
    let text = "";
    try { text = cand.content.parts[0].text; } catch (e) { throw new Error("empty response from the director"); }
    text = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
    const truncated = cand && cand.finishReason === "MAX_TOKENS";
    let obj = null;
    try { obj = JSON.parse(text); }
    catch (e) {
      obj = salvageJSON(text);
      if (!obj) throw new Error(truncated ? "director response was cut off (too long)" : "director returned invalid JSON");
    }
    return obj;
  }

  /* One retry, then give up. A single hiccup on either pass used to drop the
     whole edit to the on-device planner — which produces a visibly simpler cut
     and no b-roll at all, so an intermittent network blip looked like the app
     had got dumber. Only transient classes are retried; a bad key or a refused
     origin fails immediately rather than being asked twice. */
  const TRANSIENT = /HTTP 5\d\d|HTTP 429|empty response|cut off|invalid JSON|fetch|network/i;

  /* Three attempts, backing off, and MOVING MODEL as it goes.

     Google returns 503 "this model is experiencing high demand" on the popular
     default often enough to matter — measured four calls in a row at one point
     and got 503, 503, 200, 503. So the failure is intermittent rather than
     total, which is exactly the shape retrying fixes: the earlier single retry
     at 900ms was simply too soon and too few.

     Each attempt also asks for a DIFFERENT model, because separate models sit
     in separate capacity pools — a spike on the newest flash says nothing about
     the previous one. The chain runs newest → most established, so quality
     degrades gracefully rather than failing.

     The jitter is not decoration: without it every client caught by the same
     spike retries in lockstep and collides again. */
  /* Retired here on 2026-09-05, all three at once: gemini-flash-latest (alias
     dropped from the model list), gemini-3-flash-preview (previews are shut
     down once the stable lands) and gemini-2.5-flash-lite ("no longer available
     to new users").
     gemini-2.5-flash was here before that and is also RETIRED — it answers 404 "no longer
     available to new users". A dead model in the chain is worse than a missing
     one, because 404 is not transient, so it aborted the retry loop before the
     third model was ever tried. */
  const MODEL_CHAIN = [MODEL, "gemini-3.7-flash", "gemini-3.5-flash-lite"];

  /* A model that is gone or unknown should advance to the NEXT model, not kill
     the run. Distinct from TRANSIENT (worth retrying the same thing) and from
     a bad key (worth stopping immediately). */
  const MODEL_DEAD = /HTTP 404|no longer available|not found|not supported|unknown model/i;
  const BACKOFF_MS = [0, 1200, 3500];

  /* Remember what worked. A spike lasts longer than one generate, so starting
     pass 2 on the model pass 1 just proved is busy wastes a retry and several
     seconds. Resets each page load, so a recovered service is picked back up. */
  let lastGoodModel = null;

  function chain() {
    if (!lastGoodModel || lastGoodModel === MODEL_CHAIN[0]) return MODEL_CHAIN;
    return [lastGoodModel].concat(MODEL_CHAIN.filter((m) => m !== lastGoodModel));
  }

  async function callWithRetry(parts, maxTokens) {
    const MODELS = chain();
    let lastErr = null;
    for (let i = 0; i < MODELS.length; i++) {
      if (BACKOFF_MS[i]) {
        await new Promise((r) => setTimeout(r, BACKOFF_MS[i] + Math.random() * 500));
      }
      try {
        const out = await callGemini(parts, maxTokens, MODELS[i]);
        lastGoodModel = MODELS[i];
        if (i > 0) DIAG.last.geminiRetry = "recovered on " + MODELS[i] + " (attempt " + (i + 1) + ")";
        return out;
      } catch (e) {
        lastErr = e;
        const msg = (e && e.message) || String(e);
        // a bad key or refused origin will fail identically three times — don't
        // make the user wait five seconds to be told the same thing. A retired
        // model is different: move on to the next one immediately.
        if (!TRANSIENT.test(msg) && !MODEL_DEAD.test(msg)) throw e;
        DIAG.last.geminiRetry = "attempt " + (i + 1) + " on " + MODELS[i] + " — " + msg;
      }
    }
    throw lastErr;
  }

  async function geminiPlan(req) {
    const key = getKey();
    if (!PROXY_URL && !key) return null;

    /* 4096, not 2048: gemini-flash-latest now resolves to a THINKING model, and
       reasoning tokens are drawn from this same budget. Pass 1 was measured
       spending 489 on thinking for 200 of actual answer — a longer transcript
       can consume the whole allowance and return a candidate with no content,
       which reads as "the Director failed" for no visible reason. */
    const story = await callWithRetry([{ text: storyBrief(req) }].concat(footageParts(req, true)), 4096);

    // Pass 2 — EXECUTE the story into precise cuts (transcripts only; already "seen")
    const edit = await callWithRetry([{ text: editBrief(req, story) }].concat(footageParts(req, false)), 8192);
    if (story && story.hook && !edit.hook) edit.hook = story.hook;
    if (story && story.look && !edit.look) edit.look = story.look;
    // music is decided in pass 1, where the footage was seen; see musicBrief()
    if (story && story.music && !edit.music) edit.music = story.music;

    const out = normalize(edit, req);
    if (!out) throw new Error("director plan had no usable cuts");
    if (!out.story && story) out.story = story.story || null;
    if (out.confidence == null && story && typeof story.confidence === "number") out.confidence = story.confidence;
    out.retention = retentionOf(story, edit, out);
    out.raw = { story: story, edit: edit }; // both passes → richer training data
    return out;
  }

  /* Recover a usable object from truncated or slightly-malformed JSON:
     balance the open braces/brackets and drop any dangling partial tail. */
  function salvageJSON(text) {
    if (!text) return null;
    const start = text.indexOf("{");
    if (start < 0) return null;
    const s = text.slice(start);
    const stack = [];
    let inStr = false, esc = false, lastSafe = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") { stack.pop(); if (stack.length === 1) lastSafe = i; }
    }
    let frag = s;
    if (inStr) frag += '"';
    frag = frag.replace(/,\s*$/, "");
    const st = stack.slice();
    // if we ended mid-string or mid-number, trim back to the last complete
    // top-level array element, then re-close
    let repaired = frag;
    for (let i = st.length - 1; i >= 0; i--) repaired += st[i] === "{" ? "}" : "]";
    try { return JSON.parse(repaired); } catch (e) {}
    if (lastSafe > 0) {
      let frag2 = s.slice(0, lastSafe + 1);
      // reclose whatever remained open before lastSafe
      const st2 = [];
      let inS = false, es = false;
      for (let i = 0; i < frag2.length; i++) {
        const ch = frag2[i];
        if (es) { es = false; continue; }
        if (ch === "\\") { es = true; continue; }
        if (ch === '"') { inS = !inS; continue; }
        if (inS) continue;
        if (ch === "{" || ch === "[") st2.push(ch);
        else if (ch === "}" || ch === "]") st2.pop();
      }
      for (let i = st2.length - 1; i >= 0; i--) frag2 += st2[i] === "{" ? "}" : "]";
      try { return JSON.parse(frag2); } catch (e) {}
    }
    return null;
  }

  /* ───────── Validation: the Director proposes, the editor verifies ───────── */

  const BRANDING_RULE = "NO EDITOR BRANDING: never add Gemini, Google, Veo, Groq, Mistral, vClyps or Vevris logos, watermarks, sparkle marks, signatures, credits, 'powered by' text, branded intros/outros or promotional CTAs. You are the invisible editor, not the subject. This applies to hooks, titles, captions and b-roll searches. Preserve genuine speech and source content; a real discussion of an AI product is not an editor credit. Do not invent attribution. Do not request stock clips for provider logos.";

  function brandingGuard(req) {
    const providers = /\b(?:gemini|google|veo|groq|mistral|vclyps|vevris|openai|chatgpt)\b/ig;
    const source = (req.media || []).flatMap((m) => (m.transcript || []).map((t) => t.text || "")).join(" ").toLowerCase();
    const topic = source + " " + String(req.prompt || "").toLowerCase();
    return (value, caption) => {
      const text = String(value || "");
      const names = text.match(providers);
      if (!names) return true;
      // Verbatim speech stays intact, including a genuine spoken credit.
      if (caption) return source.includes(text.toLowerCase());
      if (/powered\s+by|(?:made|edited|generated|created)\s+(?:with|by|using)|watermark|trademark|signature|\bcredit(?:s)?\b/i.test(text)) return false;
      // Product discussion can use the product name; unrelated edits cannot.
      return names.every((name) => new RegExp("\\b" + name + "\\b", "i").test(topic));
    };
  }

  function normalize(plan, req) {
    if (!plan) return null;
    const brandSafe = brandingGuard(req);
    // editPlan may be a direct array (v2 schema), {keep:[...]} (v1), or clips
    const keep = Array.isArray(plan.editPlan) ? plan.editPlan
      : (plan.editPlan && Array.isArray(plan.editPlan.keep)) ? plan.editPlan.keep
      : Array.isArray(plan.clips) ? plan.clips
      : null;
    if (!keep || !keep.length) return null;

    const byId = {};
    req.media.forEach((m) => { byId[String(m.id)] = m; });
    const clips = [];
    /* The Director's own editPlan index → the clip it became. Entries can be
       dropped just below, and then the Director's indices (which its sound
       effects refer to) stop matching positions in `clips`. */
    const clipFor = [];
    keep.forEach((sg, k) => {
      /* Forgiving on purpose. With a single source there is only one thing the
         plan can possibly mean, so a wrong id is a typo rather than an
         ambiguity — discarding the entire edit over it (and falling back to the
         on-device planner) is the worst possible reading of the mistake. */
      const m = byId[String(sg.mediaId)] || (req.media.length === 1 ? req.media[0] : null);
      if (!m) return;
      // a clip from a long recording may only use its own stretch: see rangeLine()
      const r = req.range && String(req.range.mediaId) === String(m.id) ? req.range : null;
      const lo = r ? r.start : 0;
      const hi = r ? r.end : (m.duration || 3);
      if (r && ((+sg.out || 0) <= lo || (+sg.in || 0) >= hi)) return;   // wholly outside: not a typo to fix
      const a = clamp(+sg.in || lo, lo, Math.max(lo, hi - 0.3));
      const b = clamp(+sg.out || a + 2, a + 0.3, hi);
      const clip = { mediaId: m.id, in: a, out: b, reason: sg.reason ? String(sg.reason).slice(0, 200) : "" };
      clips.push(clip);
      clipFor[k] = clip;
    });
    if (!clips.length) return null;

    const normText = (t, defPos, defSize) => ({
      text: String(t.text).slice(0, 90),
      start: Math.max(0, +t.start || 0),
      dur: clamp(+t.dur || 2, 0.4, 15),
      pos: ["top", "center", "bottom"].includes(t.pos) ? t.pos : defPos,
      size: clamp(+t.size || defSize, 14, 88),
      color: "#ffffff"
    });
    const norm = (arr, defPos, defSize) => (Array.isArray(arr) ? arr : [])
      .filter((t) => t && t.text)
      .slice(0, 80)
      .map((t) => normText(t, defPos, defSize));

    const effects = (Array.isArray(plan.effects) ? plan.effects : [])
      .filter((e) => e && ["punch-in", "slow-mo", "speed-up"].includes(e.type))
      .slice(0, 12)
      .map((e) => ({ clip: Math.max(0, Math.floor(+e.clip || 0)), type: e.type }));

    // texts must include the chosen hook line even if the model only put it in `hook`
    const textFor = [];   // the Director's text index → the text it became, as for clips
    let texts = [];
    (Array.isArray(plan.texts) ? plan.texts : []).slice(0, 80).forEach((t, k) => {
      if (!t || !t.text) return;
      const n = normText(t, "top", 38);
      if (!brandSafe(n.text)) return;
      texts.push(n);
      textFor[k] = n;
    });
    if (!texts.length && plan.hook && brandSafe(plan.hook)) {
      texts = [{ text: String(plan.hook).slice(0, 90), start: 0.1, dur: 2.2, pos: "top", size: 40, color: "#ffffff" }];
      textFor[0] = texts[0];   // "text 0" can only have meant the hook
    }
    const storySummary = typeof plan.story === "string" ? plan.story
      : (plan.story && plan.story.summary) ? plan.story.summary : null;

    /* Capped at 3. Each item costs a search AND a file download, and Klipy's
       free test key allows 100 searches an hour — an unbounded list would burn
       that on a single generate, and more than a few cutaways stops reading as
       editing anyway. */
    /* WHERE a cutaway goes is the words it illustrates (0.25.0): `ci` is the
       clip it names (an index into `clips`, which brain.js follows through its
       merges), `t` the source second those words start, `say` the words.
       brain.js turns that into a timeline moment once the clip list is final,
       snapping to the spoken word, and drops an item it cannot place: a GIF on
       the wrong moment reads as the editor not understanding the video.
       A time outside the clip it names is not trusted (most likely a timeline
       second given by mistake); the words are then looked up instead.
       `after` is the old field and is read as the clip, for older plans. */
    const rawBroll = [];   // {b, k}: k is the Director's own index, which sounds refer to
    (Array.isArray(plan.broll) ? plan.broll : []).forEach((b, k) => {
      if (rawBroll.length < 3 && b && b.query && brandSafe(b.query)) rawBroll.push({ b: b, k: k });
    });
    const brollFor = [];
    const broll = rawBroll.map((r) => {
      const b = r.b;
      const named = b.clip != null ? b.clip : b.after;
      const c = named != null && isFinite(+named) ? clipFor[Math.floor(+named)] : null;
      const item = {
        query: String(b.query).slice(0, 60),
        kind: ["gif", "photo", "video"].indexOf(b.kind) >= 0 ? b.kind : "gif",
        mode: b.mode === "cover" ? "cover" : "square",
        dur: clamp(+b.dur || 1.6, 0.6, 4),
        say: b.say ? String(b.say).replace(/\s+/g, " ").trim().slice(0, 80) : ""
      };
      if (c) {
        item.ci = clips.indexOf(c);
        item.mediaId = c.mediaId;
        const t = parseFloat(b.at);
        if (isFinite(t) && t >= c.in - 0.5 && t <= c.out + 0.5) item.t = clamp(t, c.in, c.out);
      }
      brollFor[r.k] = item;
      return item;
    });

    /* Sound effects. Each one is ATTACHED to what it belongs to (a clip, a
       text, a cutaway) instead of being kept as a list of indices. The lists
       above are filtered, and brain.js merges clips when it snaps them to
       sentences, so an index would quietly point at the wrong thing; an
       attachment travels with its owner, or disappears with it. brain.js turns
       them into timeline moments once the clip list is final. Only sounds in
       the library this request offered are accepted. */
    const lib = {};
    (Array.isArray(req.sfx) ? req.sfx : []).forEach((s) => { if (s && s.name) lib[s.name] = true; });
    (Array.isArray(plan.sfx) ? plan.sfx : []).slice(0, 30).forEach((x) => {
      if (!x || typeof x !== "object") return;
      const name = String(x.sound || x.name || "").trim().toLowerCase();
      if (!lib[name]) return;
      const why = x.why ? String(x.why).slice(0, 80) : "";
      if (x.broll != null) {
        const b = brollFor[Math.floor(+x.broll)];
        if (b && !b.sfx) b.sfx = name;
        return;
      }
      if (x.text != null) {
        const t = textFor[Math.floor(+x.text)];
        if (t && !t.sfx) t.sfx = name;
        return;
      }
      const c = clipFor[Math.floor(+x.clip)];
      if (!c) return;
      const list = c.sfx || (c.sfx = []);
      if (x.at == null || String(x.at).trim().toLowerCase() === "cut") {
        list.push({ name: name, cut: true, why: why });
        return;
      }
      /* A moment has to lie inside the clip it names. A time well outside it
         is most likely a TIMELINE second given by mistake, and would land on
         something unrelated, so it is dropped rather than guessed at. */
      const t = parseFloat(x.at);
      if (!isFinite(t) || t < c.in - 0.5 || t > c.out + 0.5) return;
      list.push({ name: name, t: clamp(t, c.in, c.out), why: why });
    });

    const result = {
      clips: clips,
      broll: broll,
      look: plan.look,
      captions: norm(plan.captions, "center", 30).filter((t) => brandSafe(t.text, true)),
      texts: texts,
      effects: effects,
      music: normMusic(plan.music, req, brandSafe),
      story: storySummary,
      confidence: typeof plan.confidence === "number" ? clamp(plan.confidence, 0, 1) : null,
      reasons: Array.isArray(plan.reasoning) ? plan.reasoning.slice(0, 6).map(String) : [],
      raw: plan // full director output — becomes training data
    };
    // the Director's clip index → clip, for retentionOf(); not data, so not enumerable
    Object.defineProperty(result, "clipFor", { value: clipFor, enumerable: false });
    return result;
  }

  /* The music brief, validated. null means no decision was asked for, or none
     was usable; {use:false} is a real decision to leave the video without
     music. app.js treats the two differently in what it reports. */
  function normMusic(m, req, brandSafe) {
    if (!wantsMusic(req) || !m || typeof m !== "object") return null;
    const why = m.why ? String(m.why).slice(0, 120) : "";
    if (m.use === false || /^(false|no|none)$/i.test(String(m.use))) return { use: false, why: why };
    const query = String(m.query || "")
      .replace(/[^\p{L}\p{N}\s&'-]+/gu, " ")
      .replace(/\s+/g, " ").trim()
      .split(" ").slice(0, 4).join(" ")
      .slice(0, 48)
      .toLowerCase();
    if (!query || !brandSafe(query)) return null;
    return { use: true, query: query, level: m.level === "forward" ? "forward" : "under", why: why };
  }

  /* ───────── Routing ───────── */

  async function plan(req) {
    for (const p of ORDER) {
      let ok = false;
      try { ok = p.available(); } catch (e) { ok = false; }
      /* Every provider reports, not just Gemini. With a chain, a silent
         fallback is worse than no fallback: you cannot tell a working
         redundancy from a broken one, and "why is this edit worse today"
         becomes unanswerable. */
      if (!ok) {
        DIAG.last[p.id] = !navigator.onLine ? "offline" : "not configured";
        continue;
      }
      try {
        const r = await p.plan(req);
        if (r && r.clips && r.clips.length) {
          r.provider = p.id;
          r.providerLabel = p.label;
          DIAG.last.provider = p.id;
          DIAG.last[p.id] = "ok";
          return r;
        }
        DIAG.last[p.id] = "returned no usable plan";
      } catch (e) {
        DIAG.last[p.id] = (e && e.message) || String(e);
      }
    }
    DIAG.last.provider = "unavailable";
    throw directorError("No AI Director is available. Your timeline has not been changed. Gemini: " + (DIAG.last.gemini || "unavailable") + ". Check the connection/settings and retry.");
  }

  /* ───────── Training dataset (local, exportable) ───────── */

  function record(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(DS_KEY) || "[]");
      // stamped from version.js — training data has to say which build produced
      // it, or a later model cannot tell good examples from ones made by a bug
      const stamp = window.VevrisVersion
        ? window.VevrisVersion.stamp()
        : { app: "vClyps", version: "unknown", build: 0 };
      arr.push(Object.assign({ t: new Date().toISOString() }, stamp, entry));
      while (arr.length > 300) arr.shift();
      localStorage.setItem(DS_KEY, JSON.stringify(arr));
    } catch (e) { /* storage full or blocked — training data is best-effort */ }
  }

  function datasetCount() {
    try { return JSON.parse(localStorage.getItem(DS_KEY) || "[]").length; } catch (e) { return 0; }
  }

  function exportDataset() {
    const blob = new Blob([localStorage.getItem(DS_KEY) || "[]"], { type: "application/json" });
    // a download in a browser, the share sheet inside an app (platform.js)
    return window.VevrisPlatform.save(blob, "vclyps-training-data.json");
  }

  function clearDataset() {
    localStorage.removeItem(DS_KEY);
  }

  window.IntelligenceEngine = {
    checkAccess: checkAccess,
    plan: plan,
    findClips: findClips,
    translateLines: translateLines,
    record: record,
    datasetCount: datasetCount,
    exportDataset: exportDataset,
    clearDataset: clearDataset,
    hasGemini: () => !!PROXY_URL || !!getKey(),
    // media.js needs the same worker for b-roll search; one source of truth
    proxy: () => PROXY_URL
  };

  // Fold the distilled editing-knowledge corpus into the training dataset
  // (once per corpus version). Collection only — behavior unchanged.
  try {
    if (window.VEVRIS_KNOWLEDGE && !localStorage.getItem("vclyps-knowledge-v" + window.VEVRIS_KNOWLEDGE.version)) {
      record({ kind: "knowledge", corpus: window.VEVRIS_KNOWLEDGE });
      localStorage.setItem("vclyps-knowledge-v" + window.VEVRIS_KNOWLEDGE.version, "1");
    }
  } catch (e) {}
})();
