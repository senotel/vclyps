/* ═══════════════════════════════════════════════════════════
   tts-worker.js — text to speech, off the main thread (ccl15, 0.48.0)

   Kokoro-82M (Apache-2.0), run by transformers.js on the device. Words
   become sounds here, from the CMU Pronouncing Dictionary (ISC package of
   CMU's free dictionary), with a few spelling rules for words it does not
   know. (The usual helper for this, eSpeak NG, is GPL and is not used.)
   British voices (bf_*, bm_*, T12) get British sounds: the same American
   dictionary, turned into RP the way misaki's British lexicon (Apache-2.0,
   the G2P Kokoro was trained with) writes it. Nothing of misaki is bundled;
   its conventions were read and the rules below written from them.

   Messages in:  {type: "load"} | {type: "speak", id, text, voice, speed}
   Messages out: {type: "progress", p, what} | {type: "ready"}
                 {type: "audio", id, samples (Float32Array, 24 kHz)} | {type: "error", id, message}
   ═══════════════════════════════════════════════════════════ */
const T_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0";
const DICT_URL = "https://cdn.jsdelivr.net/npm/cmu-pronouncing-dictionary@3.0.0/index.js";
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const VOICE_URL = (v) => "https://huggingface.co/" + MODEL + "/resolve/main/voices/" + v + ".bin";
const RATE = 24000, STYLE = 256;

let T = null, model = null, tok = null, dict = null, loading = null;
const voices = new Map();

function load() {
  if (!loading) {
    loading = (async () => {
      T = await import(T_URL);
      const seen = {};
      const progress = (e) => {
        if (e && e.status === "progress" && e.total) {
          seen[e.file] = [e.loaded, e.total];
          let a = 0, b = 0;
          Object.values(seen).forEach((x) => { a += x[0]; b += x[1]; });
          postMessage({ type: "progress", p: b ? a / b : 0, what: "voices" });
        }
      };
      model = await T.StyleTextToSpeech2Model.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback: progress });
      tok = await T.AutoTokenizer.from_pretrained(MODEL);
      postMessage({ type: "progress", p: 1, what: "dictionary" });
      dict = (await import(DICT_URL)).dictionary;
      postMessage({ type: "ready" });
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// a failed download is forgotten, so the next try fetches it again
async function voiceData(v) {
  if (!voices.has(v)) {
    voices.set(v, fetch(VOICE_URL(v)).then((r) => { if (!r.ok) throw new Error("voice " + v); return r.arrayBuffer(); }).then((b) => new Float32Array(b))
      .catch((e) => { voices.delete(v); throw e; }));
  }
  return voices.get(v);
}

/* ─── words to sounds (American English, the IPA Kokoro was trained on) ─── */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
// gb: British English says "and" after hundred and before a last part under
// a hundred: one hundred and five, two thousand and twenty six
function numberWords(n, gb) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? (gb ? " and " : " ") + numberWords(n % 100, gb) : "");
  for (const [v, w] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= v) return numberWords(Math.floor(n / v), gb) + " " + w + (n % v ? (gb && n % v < 100 ? " and " : " ") + numberWords(n % v, gb) : "");
  }
  return String(n);
}
// $3.50 is "three dollars and fifty cents", $1,500 "one thousand five hundred
// dollars": the whole amount is read here, before the year and comma rules
// below can take it apart
function money(m, whole, dec, gb) {
  const a = +whole.replace(/,/g, "");
  if (dec && dec.length !== 2) return numberWords(a, gb) + " point " + dec.split("").map((d) => ONES[+d]).join(" ") + " dollars";
  const c = dec ? +dec : 0;
  return numberWords(a, gb) + (a === 1 ? " dollar" : " dollars") + (c ? " and " + numberWords(c) + (c === 1 ? " cent" : " cents") : "");
}
// £3.50 is "three pounds fifty", £1 "one pound", £0.30 "thirty pence", the
// way it is said in Britain (before this, the £ sign was skipped)
function pounds(m, whole, dec, gb) {
  const a = +whole.replace(/,/g, "");
  if (dec && dec.length !== 2) return numberWords(a, gb) + " point " + dec.split("").map((d) => ONES[+d]).join(" ") + " pounds";
  const c = dec ? +dec : 0;
  if (!a && c) return numberWords(c) + (c === 1 ? " penny" : " pence");
  return numberWords(a, gb) + (a === 1 ? " pound" : " pounds") + (c ? " " + numberWords(c) : "");
}
function normalize(text, gb) {
  return String(text)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/&/g, " and ").replace(/%/g, " percent").replace(/@/g, " at ")
    .replace(/\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g, (m, a, b) => money(m, a, b, gb))
    .replace(/£(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g, (m, a, b) => pounds(m, a, b, gb))
    .replace(/\b(\d{4})s\b/g, (m, y) => y + "s")
    .replace(/\b(1[1-9]|20)(\d\d)\b/g, (m, a, b) => (b === "00" ? numberWords(+a) + " hundred" : numberWords(+a) + " " + (b[0] === "0" ? "oh " + numberWords(+b[1]) : numberWords(+b))))
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/\d+\.\d+/g, (m) => { const [a, b] = m.split("."); return numberWords(+a, gb) + " point " + b.split("").map((d) => ONES[+d]).join(" "); })
    .replace(/\d+/g, (m) => numberWords(+m, gb))
    .replace(/\s+/g, " ").trim();
}
const VOWEL = { AA: "ɑː", AE: "æ", AH: "ʌ", AO: "ɔː", AW: "aʊ", AY: "aɪ", EH: "ɛ", ER: "ɜː", EY: "eɪ", IH: "ɪ", IY: "iː", OW: "oʊ", OY: "ɔɪ", UH: "ʊ", UW: "uː" };
const CONS = { B: "b", CH: "tʃ", D: "d", DH: "ð", F: "f", G: "ɡ", HH: "h", JH: "dʒ", K: "k", L: "l", M: "m", N: "n", NG: "ŋ", P: "p", R: "ɹ", S: "s", SH: "ʃ", T: "t", TH: "θ", V: "v", W: "w", Y: "j", Z: "z", ZH: "ʒ" };
function arpaToIpa(arpa) {
  const ph = arpa.trim().split(/\s+/);
  let out = "";
  for (let i = 0; i < ph.length; i++) {
    const m = /^([A-Z]+)([012])?$/.exec(ph[i]);
    if (!m) continue;
    const base = m[1], st = m[2];
    if (VOWEL[base]) {
      let v = VOWEL[base];
      if (st === "0") v = base === "AH" ? "ə" : base === "ER" ? "ɚ" : base === "IY" ? "i" : base === "UW" ? "u" : base === "AA" ? "ɑ" : base === "AO" ? "ɔ" : v;
      out += (st === "1" ? "ˈ" : st === "2" ? "ˌ" : "") + v;
    } else if (base === "T" && i > 0 && i < ph.length - 1 && /[012]$/.test(ph[i - 1]) && /0$/.test(ph[i + 1])) {
      out += "ɾ";   // American flap: water, better
    } else out += CONS[base] || "";
  }
  return out;
}
// a word the dictionary does not have: spelling rules, enough for names and new words
const LTS = [
  ["tion", "ʃən"], ["sion", "ʒən"], ["ough", "ʌf"], ["igh", "aɪ"], ["tch", "tʃ"], ["dge", "dʒ"],
  ["sh", "ʃ"], ["ch", "tʃ"], ["th", "θ"], ["ph", "f"], ["ck", "k"], ["ng", "ŋ"], ["qu", "kw"], ["wh", "w"], ["kn", "n"],
  ["ee", "iː"], ["ea", "iː"], ["oo", "uː"], ["ou", "aʊ"], ["ow", "oʊ"], ["ai", "eɪ"], ["ay", "eɪ"], ["oi", "ɔɪ"], ["oy", "ɔɪ"], ["au", "ɔː"], ["aw", "ɔː"], ["ie", "aɪ"], ["ey", "eɪ"],
  ["a", "æ"], ["e", "ɛ"], ["i", "ɪ"], ["o", "ɑː"], ["u", "ʌ"], ["y", "i"],
  ["b", "b"], ["c", "k"], ["d", "d"], ["f", "f"], ["g", "ɡ"], ["h", "h"], ["j", "dʒ"], ["k", "k"], ["l", "l"], ["m", "m"], ["n", "n"], ["p", "p"], ["q", "k"], ["r", "ɹ"], ["s", "s"], ["t", "t"], ["v", "v"], ["w", "w"], ["x", "ks"], ["z", "z"]
];
function spell(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return "";
  // a silent e at the end makes the vowel before it long: make, time, home
  let magic = null;
  const mm = /([aeiou])([^aeiou])e$/.exec(w);
  if (mm && w.length > 3) { magic = { a: "eɪ", e: "iː", i: "aɪ", o: "oʊ", u: "uː" }[mm[1]]; w = w.slice(0, -1); }
  let out = "", i = 0, stressed = false;
  while (i < w.length) {
    const rule = LTS.find((r) => w.startsWith(r[0], i));
    if (!rule) { i++; continue; }
    let ph = rule[1];
    if (magic && i === w.length - 2 && /[aeiou]/.test(rule[0])) ph = magic;
    if (!stressed && /[æɛɪɑʌiueaoɔ]/.test(ph[0])) { ph = "ˈ" + ph; stressed = true; }
    out += ph;
    i += rule[0].length;
  }
  return out;
}
// letter names, for acronyms (the dictionary's "a" is the article)
const LETTERS = { a: "ˈeɪ", b: "bˈiː", c: "sˈiː", d: "dˈiː", e: "ˈiː", f: "ˈɛf", g: "dʒˈiː", h: "ˈeɪtʃ", i: "ˈaɪ", j: "dʒˈeɪ", k: "kˈeɪ", l: "ˈɛl", m: "ˈɛm",
  n: "ˈɛn", o: "ˈoʊ", p: "pˈiː", q: "kjˈuː", r: "ˈɑːɹ", s: "ˈɛs", t: "tˈiː", u: "jˈuː", v: "vˈiː", w: "dˈʌbəljuː", x: "ˈɛks", y: "wˈaɪ", z: "zˈiː" };
// our own names, said the way we say them
const CUSTOM = { vclyps: "vˈiːklɪps", senotel: "sˈɛnoʊtɛl", capcut: "kˈæpkʌt" };
// little words are said without stress in running speech, as eSpeak does
const WEAK = new Set(["a", "an", "the", "is", "are", "was", "were", "am", "be", "been", "to", "of", "and", "or", "in", "on", "at", "for", "with", "this", "that", "it", "its", "as", "by", "but", "from", "his", "her", "him", "them", "they", "we", "you", "your", "my", "me", "our", "has", "have", "had", "do", "does", "can", "will", "would", "could", "should", "just", "so", "if", "than", "then"]);
function wordIpa(raw) {
  const w = raw.toLowerCase();
  if (CUSTOM[w]) return CUSTOM[w];
  if (dict[w]) { const ipa = arpaToIpa(dict[w]); return WEAK.has(w) ? ipa.replace(/[ˈˌ]/g, "") : ipa; }
  // possessives and plurals the dictionary lacks
  const s = /^(.*?)('s|s')$/.exec(w);
  if (s && dict[s[1]]) { const b = arpaToIpa(dict[s[1]]); return b + (/[szʃʒ]$|tʃ$|dʒ$/.test(b) ? "ɪz" : /[ptkfθ]$/.test(b) ? "s" : "z"); }
  if (/^[A-Z]{2,5}$/.test(raw)) return raw.toLowerCase().split("").map((ch) => LETTERS[ch] || "").join(" ");   // an acronym: its letters
  return spell(w);
}

/* ─── British English (RP-leaning), for the bf_* and bm_* voices ───
   The American dictionary is the start; these rules turn its sounds into
   the ones misaki's British lexicon uses, which is what Kokoro's British
   voices learned from: TRAP is "a" not "æ", LOT "ɒ", GOAT "əʊ", no flapped t,
   and r is only said before a vowel (car kˈɑː, care kˈɛː, near nˈɪə). */
const isGB = (voice) => /^b[fm]_/.test(String(voice || ""));
// a word, or the same word with an everyday ending (passes, dancing, asked)
function hasStem(set, w) {
  if (set.has(w)) return true;
  for (const suf of ["s", "es", "ed", "d", "ing", "er", "ers", "est", "ly", "y"]) {
    if (w.length > suf.length + 2 && w.endsWith(suf)) {
      const st = w.slice(0, -suf.length);
      if (set.has(st) || set.has(st + "e")) return true;
    }
  }
  return false;
}
// BATH words: "a" in America, a long "ɑː" in the south of England
const BATH = new Set(("ask after afternoon afterwards answer aunt banana basket bath blast branch brass calf can't cast castle chance chant " +
  "class command commander craft aircraft dance demand disaster draft draught example sample fast fasten ghastly glance glass graph grant " +
  "grass grasp clasp gasp half behalf calves halves laugh laughter last mask master nasty pass past pastor path plant plaster rather raft " +
  "shaft shan't slant staff task vast advance advantage enhance france prance aghast contrast flask cask mast giraffe alas").split(" "));
// PALM words the dictionary writes with the LOT vowel
const PALM = new Set(("father calm palm psalm balm spa bra drama llama lager saga karate safari massage facade façade plaza promenade armada " +
  "sonata tiara gala almond nirvana pajamas pyjamas avocado bravado bravo lava panorama mama papa ma pa").split(" "));
// short o before r and a vowel: orange, borrow
const LOT_R = new Set(("orange horrible horror horrid origin original foreign forest florida moral coral quarrel warrant warren sorrow borrow " +
  "tomorrow morrow torrent porridge corridor historic minority majority priority authority sorry").split(" "));
// "a" before r and a vowel that the dictionary writes as "ɛ": carry is kˈaɹi
const TRAP_R = new Set(("paris parish charity clarity clarify comparison chariot arid baron barren marathon caramel parallel paradise " +
  "paragraph parachute clarinet parody character carol carrot narrative").split(" "));
// -ile said "aɪl": mobile, missile, fragile
const ILE = new Set(("mobile missile fertile hostile fragile futile sterile versatile agile juvenile reptile tactile volatile projectile " +
  "servile virile ductile senile infantile").split(" "));
// everyday words Britain says differently, whole (misaki's British lexicon, written in our IPA)
const GB_WORDS = {
  schedule: "ʃˈɛdjuːl", tomato: "təmˈɑːtəʊ", tomatoes: "təmˈɑːtəʊz", privacy: "pɹˈɪvəsi", vitamin: "vˈɪtəmɪn", vitamins: "vˈɪtəmɪnz",
  either: "ˈaɪðə", neither: "nˈaɪðə", leisure: "lˈɛʒə", advertisement: "ədvˈɜːtɪsmənt", advertisements: "ədvˈɜːtɪsmənts",
  aluminium: "ˌaljʊmˈɪniəm", aluminum: "əlˈuːmɪnəm", garage: "ɡˈaɹɑːʒ", laboratory: "ləbˈɒɹətəɹi", zebra: "zˈɛbɹə", route: "ɹˈuːt",
  herb: "hˈɜːb", herbs: "hˈɜːbz", yogurt: "jˈɒɡət", yoghurt: "jˈɒɡət", controversy: "kˈɒntɹəvɜːsi", clerk: "klˈɑːk",
  lieutenant: "lɛftˈɛnənt", vase: "vˈɑːz", ballet: "bˈaleɪ", data: "dˈeɪtə", been: "biːn", of: "ɒv", what: "wˈɒt", figure: "fˈɪɡə",
  basil: "bˈazəl", oregano: "ˌɒɹɪɡˈɑːnəʊ", process: "pɹˈəʊsɛs", progress: "pɹˈəʊɡɹɛs", dynasty: "dˈɪnəsti", patriot: "pˈatɹiət",
  semi: "sˈɛmi", anti: "ˈanti", niche: "nˈiːʃ", docile: "dˈəʊsaɪl", buoy: "bˈɔɪ", adult: "ˈadʌlt", suggest: "sədʒˈɛst",
  squirrel: "skwˈɪɹəl", hurricane: "hˈʌɹɪkən", pasta: "pˈastə", aeroplane: "ˈɛːɹəpleɪn", mum: "mˈʌm", ate: "ˈɛt"
};
// British spellings the American dictionary lacks: colour, centre, organise
function usSpellings(w) {
  const out = [];
  const add = (x) => { if (x !== w && out.indexOf(x) < 0) out.push(x); };
  add(w.replace(/our(s|ed|ing|ite|ites|able|er|ers)?$/, "or$1").replace(/our(?=[a-z]+)/, "or"));
  add(w.replace(/is(e|es|ed|ing|ation|ations|er|ers)$/, "iz$1"));
  add(w.replace(/ys(e|es|ed|ing)$/, "yz$1"));
  add(w.replace(/tre(s)?$/, "ter$1").replace(/bre(s)?$/, "ber$1"));
  add(w.replace(/ence(s)?$/, "ense$1"));
  add(w.replace(/ll(ed|ing|er|ers)$/, "l$1"));
  add(w.replace(/ogue(s)?$/, "og$1"));
  add(w.replace(/ae/g, "e").replace(/oe/g, "e"));
  add(w.replace(/^programme/, "program").replace(/^cheque/, "check").replace(/^tyre/, "tire").replace(/^pyjama/, "pajama"));
  return out;
}
// one word in British sounds; r says whether it ends in an r Britain leaves
// silent, which comes back as a linking r before a vowel (far away, there is)
function arpaToIpaGB(arpa, word) {
  const w = word || "";
  const ph = arpa.trim().split(/\s+/).map((x) => { const m = /^([A-Z]+)([012])?$/.exec(x); return m ? { b: m[1], s: m[2] } : null; }).filter(Boolean);
  const isV = (p) => !!(p && VOWEL[p.b]);
  const n = ph.length;
  // -ary, -ory, -ery lose their American second stress: secretary sˈɛkɹətəɹi
  let e = n - 1;
  if (ph[e] && ph[e].b === "Z") e--;
  if (e >= 2 && ph[e].b === "IY" && ph[e - 1].b === "R" && /^(EH|AO)$/.test(ph[e - 2].b) && ph[e - 2].s !== "1") { ph[e - 2] = { b: "AH", s: "0" }; ph[e] = { b: "IY", s: "0" }; }
  // -mony: ceremony sˈɛɹɪməni
  if (e >= 2 && ph[e].b === "IY" && ph[e - 1].b === "N" && ph[e - 2].b === "OW" && ph[e - 2].s === "2") ph[e - 2] = { b: "AH", s: "0" };
  // -ile: mobile mˈəʊbaɪl
  if (hasStem(ILE, w)) { for (let i = n - 1; i > 0; i--) if (ph[i].b === "L" && ph[i - 1].b === "AH") { ph[i - 1] = { b: "AY", s: "0" }; break; } }
  // -isation: organisation ˌɔːɡənaɪzˈeɪʃən
  if (/i[sz]ations?$/.test(w)) { for (let i = 0; i < n - 2; i++) if (/^(AH|IH)$/.test(ph[i].b) && ph[i].s === "0" && ph[i + 1].b === "Z" && ph[i + 2].b === "EY") ph[i] = { b: "AY", s: "0" }; }
  // a last "o" carries no second stress: tomorrow təmˈɒɹəʊ, borrow
  if (ph[n - 1] && ph[n - 1].b === "OW" && ph[n - 1].s === "2") ph[n - 1] = { b: "OW", s: "0" };
  const bath = hasStem(BATH, w), palm = hasStem(PALM, w), lotR = hasStem(LOT_R, w), trapR = hasStem(TRAP_R, w);
  const yod = /[tdn](u|ew|eu|ue)/.test(w);
  let out = "", firstAE = true, rEnd = false;
  for (let i = 0; i < n; i++) {
    const { b, s } = ph[i];
    const mark = s === "1" ? "ˈ" : s === "2" ? "ˌ" : "";
    const nextR = ph[i + 1] && ph[i + 1].b === "R";
    const rVowel = nextR && isV(ph[i + 2]);   // the r is said: very, sorry
    const nextV = isV(ph[i + 1]);
    if (VOWEL[b]) {
      let v;
      if (b === "AA") v = nextR ? (rVowel && (lotR || /or/.test(w)) ? "ɒ" : "ɑː") : palm ? "ɑː" : /au|aw|ough/.test(w) ? "ɔː" : "ɒ";
      else if (b === "AE") { v = bath && firstAE ? "ɑː" : "a"; firstAE = false; }
      else if (b === "AH") v = s === "0" ? "ə" : "ʌ";
      else if (b === "AO") v = nextR ? (rVowel && lotR ? "ɒ" : "ɔː") : (ph[i + 1] && /^(F|TH|S|NG|G)$/.test(ph[i + 1].b) && !/au|aw/.test(w)) ? "ɒ" : "ɔː";
      else if (b === "AW") v = nextR ? "aʊə" : "aʊ";
      else if (b === "AY") v = nextR ? "aɪə" : "aɪ";
      else if (b === "EY") v = nextR ? "ɛː" : "eɪ";
      else if (b === "EH") v = !nextR ? "ɛ" : !rVowel ? "ɛː" : (trapR || /arr|ar[aou]/.test(w)) ? "a" : /ar[eiy]|air|are|ear|eir/.test(w) ? "ɛː" : "ɛ";
      else if (b === "ER") {
        if (s === "0") v = nextV ? "əɹ" : "ə";
        else v = nextV ? (/urr|orr|our/.test(w) && !/^(furr|purr|blurr)/.test(w) ? "ʌɹ" : "ɜːɹ") : "ɜː";
        if (i === n - 1) rEnd = true;
      }
      else if (b === "IH") v = nextR ? (rVowel && /ir|yr/.test(w) ? "ɪ" : "ɪə") : "ɪ";
      else if (b === "IY") v = nextR ? "ɪə" : s === "0" ? "i" : "iː";
      else if (b === "OW") v = nextR ? "ɔː" : "əʊ";
      else if (b === "OY") v = "ɔɪ";
      else if (b === "UH") v = nextR ? "ʊə" : "ʊ";
      else v = nextR ? "ʊə" : s === "0" ? "u" : "uː";   // UW
      // the British "you" in new, tune, student, during
      if ((b === "UW" || b === "UH") && yod && i > 0 && /^(T|D|N)$/.test(ph[i - 1].b)) out += "j";
      out += mark + v;
    } else if (b === "R") {
      if (nextV) out += "ɹ";
      else if (i === n - 1) rEnd = true;
    } else out += CONS[b] || "";   // no American flap: water is wˈɔːtə
  }
  return { ipa: out, r: rEnd };
}
// sounds written for American English (spelling rules, our own names) made British
function gbString(ipa) {
  return ipa.replace(/æ/g, "a").replace(/oʊ/g, "əʊ").replace(/ɚ/g, "ə").replace(/ɾ/g, "t")
    .replace(/(aɪ|aʊ|eɪ|əʊ|iː|uː|ɑː|ɔː|ɜː|a|ɑ|ɒ|ɔ|ɜ|ɛ|ɪ|ʊ|ʌ|ə)ɹ(?![ˈˌ]?[aeiouɑɒɔəɛɜɪʊʌ])/g, (m, v) =>
      ({ "aɪ": "aɪə", "aʊ": "aʊə", "eɪ": "ɛː", "əʊ": "ɔː", "iː": "ɪə", "uː": "ʊə", "ɑː": "ɑː", "ɔː": "ɔː", "ɜː": "ɜː", a: "ɑː", "ɑ": "ɑː",
        "ɒ": "ɔː", "ɔ": "ɔː", "ɜ": "ɜː", "ɛ": "ɛː", "ɪ": "ɪə", "ʊ": "ʊə", "ʌ": "ɜː", "ə": "ə" })[v]);
}
const LETTERS_GB = Object.assign({}, LETTERS, { o: "ˈəʊ", r: "ˈɑː", z: "zˈɛd" });
function wordIpaGB(raw) {
  const w = raw.toLowerCase();
  if (CUSTOM[w]) return { ipa: gbString(CUSTOM[w]), r: false };
  if (GB_WORDS[w]) return { ipa: WEAK.has(w) ? GB_WORDS[w].replace(/[ˈˌ]/g, "") : GB_WORDS[w], r: false };
  const look = (x) => { const g = arpaToIpaGB(dict[x], x); if (WEAK.has(x)) g.ipa = g.ipa.replace(/[ˈˌ]/g, ""); return g; };
  if (dict[w]) return look(w);
  const s = /^(.*?)('s|s')$/.exec(w);
  if (s && dict[s[1]]) { const b = arpaToIpaGB(dict[s[1]], s[1]).ipa; return { ipa: b + (/[szʃʒ]$|tʃ$|dʒ$/.test(b) ? "ɪz" : /[ptkfθ]$/.test(b) ? "s" : "z"), r: false }; }
  if (/^[A-Z]{2,5}$/.test(raw)) return { ipa: w.split("").map((ch) => LETTERS_GB[ch] || "").join(" "), r: false };
  const us = usSpellings(w).find((x) => dict[x]);
  if (us) return arpaToIpaGB(dict[us], w);
  // spelling rules: their "o" is the American LOT, Britain's is "ɒ"
  return { ipa: gbString(spell(w).replace(/ɑː/g, "ɒ")), r: false };
}
function phonemize(text, gb) {
  const parts = normalize(text, gb).match(/[A-Za-z]+(?:'[A-Za-z]+)?|[.,!?;:—…"]/g) || [];
  let out = "", linkR = false;
  parts.forEach((p) => {
    if (/^[.,!?;:—…"]$/.test(p)) { out = out.replace(/ $/, "") + p + " "; linkR = false; }
    else if (gb) {
      const g = wordIpaGB(p);
      // the linking r of RP: "far away" is fˈɑːɹ əwˈeɪ
      if (linkR && /^[ˈˌ]?[aeiouɑɒɔəɛɜɪʊʌ]/.test(g.ipa)) out = out.replace(/ $/, "ɹ ");
      out += g.ipa + " ";
      linkR = g.r;
    }
    else out += wordIpa(p) + " ";
  });
  return out.trim();
}

// sentences, so each fits the model (and long scripts don't run out of breath)
function sentences(text) {
  // a point between digits ($3.50, 2.5) is not the end of a sentence
  return (String(text).match(/(?:[^.!?…]|\.(?=\d))+[.!?…]*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

async function speak(id, text, voice, speed) {
  await load();
  const vd = await voiceData(voice);
  const gb = isGB(voice);
  const parts = [];
  for (const s of sentences(text)) {
    const ph = phonemize(s, gb);
    if (!ph) continue;
    const { input_ids } = tok(ph, { truncation: true });
    const n = Math.min(Math.max(input_ids.dims.at(-1) - 2, 0), 509);
    const style = vd.slice(n * STYLE, n * STYLE + STYLE);
    const out = await model({ input_ids: input_ids, style: new T.Tensor("float32", style, [1, STYLE]), speed: new T.Tensor("float32", [speed || 1], [1]) });
    parts.push(out.waveform.data);
    parts.push(new Float32Array(Math.round(RATE * 0.12)));   // a short breath between sentences
  }
  let len = 0;
  parts.forEach((p) => { len += p.length; });
  const all = new Float32Array(len);
  let o = 0;
  parts.forEach((p) => { all.set(p, o); o += p.length; });
  postMessage({ type: "audio", id: id, samples: all, rate: RATE }, [all.buffer]);
}

onmessage = (e) => {
  const m = e.data || {};
  if (m.type === "load") load().catch((err) => postMessage({ type: "error", id: null, message: String((err && err.message) || err) }));
  else if (m.type === "speak") speak(m.id, m.text, m.voice, m.speed).catch((err) => postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) }));
  else if (m.type === "phonemize") load().then(() => postMessage({ type: "phonemes", id: m.id, text: phonemize(m.text, isGB(m.voice)) }));
};
