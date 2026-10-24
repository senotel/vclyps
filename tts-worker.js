/* ═══════════════════════════════════════════════════════════
   tts-worker.js — text to speech, off the main thread (ccl15, 0.48.0)

   Kokoro-82M (Apache-2.0), run by transformers.js on the device. Words
   become sounds here, from the CMU Pronouncing Dictionary (ISC package of
   CMU's free dictionary), with a few spelling rules for words it does not
   know. (The usual helper for this, eSpeak NG, is GPL and is not used.)

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

async function voiceData(v) {
  if (!voices.has(v)) voices.set(v, fetch(VOICE_URL(v)).then((r) => { if (!r.ok) throw new Error("voice " + v); return r.arrayBuffer(); }).then((b) => new Float32Array(b)));
  return voices.get(v);
}

/* ─── words to sounds (American English, the IPA Kokoro was trained on) ─── */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  if (n < 1000) return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + numberWords(n % 100) : "");
  for (const [v, w] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= v) return numberWords(Math.floor(n / v)) + " " + w + (n % v ? " " + numberWords(n % v) : "");
  }
  return String(n);
}
function normalize(text) {
  return String(text)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/&/g, " and ").replace(/%/g, " percent").replace(/@/g, " at ")
    .replace(/\$(\d+(?:\.\d+)?)/g, "$1 dollars")
    .replace(/\b(\d{4})s\b/g, (m, y) => y + "s")
    .replace(/\b(1[1-9]|20)(\d\d)\b/g, (m, a, b) => (b === "00" ? numberWords(+a) + " hundred" : numberWords(+a) + " " + (b[0] === "0" ? "oh " + numberWords(+b[1]) : numberWords(+b))))
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/\d+\.\d+/g, (m) => { const [a, b] = m.split("."); return numberWords(+a) + " point " + b.split("").map((d) => ONES[+d]).join(" "); })
    .replace(/\d+/g, (m) => numberWords(+m))
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
function phonemize(text) {
  const parts = normalize(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?|[.,!?;:—…"]/g) || [];
  let out = "";
  parts.forEach((p) => {
    if (/^[.,!?;:—…"]$/.test(p)) out = out.replace(/ $/, "") + p + " ";
    else out += wordIpa(p) + " ";
  });
  return out.trim();
}

// sentences, so each fits the model (and long scripts don't run out of breath)
function sentences(text) {
  return (String(text).match(/[^.!?…]+[.!?…]*/g) || [text]).map((s) => s.trim()).filter(Boolean);
}

async function speak(id, text, voice, speed) {
  await load();
  const vd = await voiceData(voice);
  const parts = [];
  for (const s of sentences(text)) {
    const ph = phonemize(s);
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
  else if (m.type === "phonemize") load().then(() => postMessage({ type: "phonemes", id: m.id, text: phonemize(m.text) }));
};
