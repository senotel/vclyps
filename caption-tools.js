/* ═══════════════════════════════════════════════════════════
   vClyps — caption tools
   Everything captions need besides drawing, all on the device:

     · LANGUAGES   the 100 languages Whisper writes, for "Spoken in" and
                   "Translate to"
     · words()     clean word list from Whisper, with languages written
                   without spaces (Thai, Chinese, Japanese...) cut into
                   real words by the browser's own segmenter
     · censor      swear words in 13 languages plus your own, hidden as
                   f*** in the captions and, if asked, bleeped
     · vocabulary  your names and terms, spelled your way: "VCLYPS" and
                   "Changmai" become "vClyps" and "Chiang Mai"
     · keywords    the word worth colouring in each caption
     · translate   Chrome's built-in translator on the device where it
                   exists, otherwise the AI Director
     · fonts       30 caption fonts (free Google Fonts), and fonts you
                   upload, kept on this device
   Exposes window.VevrisCaptionTools.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* ═══════════ LANGUAGES ═══════════
     Whisper large-v3's own list, in its order of training data. */
  var LANGUAGES = [
    ["en", "English"], ["zh", "Chinese"], ["de", "German"], ["es", "Spanish"], ["ru", "Russian"],
    ["ko", "Korean"], ["fr", "French"], ["ja", "Japanese"], ["pt", "Portuguese"], ["tr", "Turkish"],
    ["pl", "Polish"], ["ca", "Catalan"], ["nl", "Dutch"], ["ar", "Arabic"], ["sv", "Swedish"],
    ["it", "Italian"], ["id", "Indonesian"], ["hi", "Hindi"], ["fi", "Finnish"], ["vi", "Vietnamese"],
    ["he", "Hebrew"], ["uk", "Ukrainian"], ["el", "Greek"], ["ms", "Malay"], ["cs", "Czech"],
    ["ro", "Romanian"], ["da", "Danish"], ["hu", "Hungarian"], ["ta", "Tamil"], ["no", "Norwegian"],
    ["th", "Thai"], ["ur", "Urdu"], ["hr", "Croatian"], ["bg", "Bulgarian"], ["lt", "Lithuanian"],
    ["la", "Latin"], ["mi", "Maori"], ["ml", "Malayalam"], ["cy", "Welsh"], ["sk", "Slovak"],
    ["te", "Telugu"], ["fa", "Persian"], ["lv", "Latvian"], ["bn", "Bengali"], ["sr", "Serbian"],
    ["az", "Azerbaijani"], ["sl", "Slovenian"], ["kn", "Kannada"], ["et", "Estonian"], ["mk", "Macedonian"],
    ["br", "Breton"], ["eu", "Basque"], ["is", "Icelandic"], ["hy", "Armenian"], ["ne", "Nepali"],
    ["mn", "Mongolian"], ["bs", "Bosnian"], ["kk", "Kazakh"], ["sq", "Albanian"], ["sw", "Swahili"],
    ["gl", "Galician"], ["mr", "Marathi"], ["pa", "Punjabi"], ["si", "Sinhala"], ["km", "Khmer"],
    ["sn", "Shona"], ["yo", "Yoruba"], ["so", "Somali"], ["af", "Afrikaans"], ["oc", "Occitan"],
    ["ka", "Georgian"], ["be", "Belarusian"], ["tg", "Tajik"], ["sd", "Sindhi"], ["gu", "Gujarati"],
    ["am", "Amharic"], ["yi", "Yiddish"], ["lo", "Lao"], ["uz", "Uzbek"], ["fo", "Faroese"],
    ["ht", "Haitian Creole"], ["ps", "Pashto"], ["tk", "Turkmen"], ["nn", "Nynorsk"], ["mt", "Maltese"],
    ["sa", "Sanskrit"], ["lb", "Luxembourgish"], ["my", "Burmese"], ["bo", "Tibetan"], ["tl", "Tagalog"],
    ["mg", "Malagasy"], ["as", "Assamese"], ["tt", "Tatar"], ["haw", "Hawaiian"], ["ln", "Lingala"],
    ["ha", "Hausa"], ["ba", "Bashkir"], ["jw", "Javanese"], ["su", "Sundanese"], ["yue", "Cantonese"]
  ];
  var LANG_NAME = {};
  LANGUAGES.forEach(function (l) { LANG_NAME[l[0]] = l[1]; });

  // Written without spaces between words: the browser cuts them into words.
  var NO_SPACE = { zh: 1, ja: 1, th: 1, lo: 1, km: 1, my: 1, bo: 1, yue: 1 };
  // Of those, the ones that never put a space even between phrases.
  var NEVER_SPACE = { zh: 1, ja: 1, yue: 1 };
  var RTL_RE = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

  /* Codes the browser's segmenter and translator know. Whisper's "jw" is
     ISO's "jv"; Cantonese segments as Chinese. */
  function isoCode(code) {
    return code === "jw" ? "jv" : code === "yue" ? "zh-Hant" : code === "nn" ? "nn" : code;
  }

  /* ═══════════ WORDS ═══════════
     Whisper's words become {text, start, end, sp}: sp says whether a space
     goes before it on screen. In languages written without spaces Whisper
     hands back pieces of words, so the text is stitched together, cut into
     real words by Intl.Segmenter, and each word is timed by the pieces it
     came from. */
  function words(raw, lang) {
    raw = (raw || []).filter(function (w) { return w && String(w.text || "").trim() && w.end > w.start; });
    if (!raw.length) return [];
    var cjkish = NO_SPACE[lang] || (!lang && /[฀-໿぀-ヿ一-鿿]/.test(raw.map(function (w) { return w.text; }).join("")));
    if (!cjkish || typeof Intl === "undefined" || !Intl.Segmenter) {
      return raw.map(function (w, i) {
        return { text: String(w.text).trim(), raw: String(w.text).trim(), start: +w.start, end: +w.end, sp: i > 0, spk: w.spk };
      });
    }
    // one string, with the time and speaker of every character
    var text = "", tStart = [], tEnd = [], spk = [];
    raw.forEach(function (w) {
      var s = String(w.text), n = s.length, d = (w.end - w.start) / Math.max(1, n);
      for (var i = 0; i < n; i++) {
        text += s[i];
        tStart.push(w.start + d * i);
        tEnd.push(w.start + d * (i + 1));
        spk.push(w.spk);
      }
    });
    var out = [], pendingSpace = false, at = 0;
    var seg = new Intl.Segmenter(isoCode(lang || "th"), { granularity: "word" });
    var it = seg.segment(text)[Symbol.iterator](), step;
    while (!(step = it.next()).done) {
      var s = step.value, piece = s.segment, i0 = s.index, i1 = s.index + piece.length - 1;
      at = i1;
      if (!piece.trim()) { pendingSpace = true; continue; }
      // punctuation rides on the word before it
      if (!s.isWordLike && out.length && !pendingSpace) { out[out.length - 1].text += piece; out[out.length - 1].end = tEnd[i1]; continue; }
      out.push({
        text: piece.trim(), raw: piece.trim(), start: tStart[i0], end: tEnd[i1],
        sp: out.length > 0 && pendingSpace && !NEVER_SPACE[lang], spk: spk[i0]
      });
      pendingSpace = false;
    }
    return out;
  }

  /* Who said each word: the speaker whose turn covers most of it. The
     segmenter numbers silence 0 and overlaps 4-6; overlaps go to the first
     voice in them. Speakers are renumbered 0, 1, 2 in order of appearance so
     the first voice always gets the first colour. */
  var OVERLAP = { 4: 1, 5: 1, 6: 2 };
  function assignSpeakers(ws, turns) {
    if (!turns || !turns.length) return ws;
    var clean = turns.map(function (t) { return { id: OVERLAP[t.id] || t.id, start: t.start, end: t.end }; })
      .filter(function (t) { return t.id > 0; });
    var order = {}, next = 0;
    ws.forEach(function (w) {
      var best = null, most = 0;
      for (var i = 0; i < clean.length; i++) {
        var t = clean[i];
        var o = Math.min(w.end, t.end) - Math.max(w.start, t.start);
        if (o > most) { most = o; best = t.id; }
      }
      if (best == null) {
        // inside a pause: the nearest turn
        var gap = Infinity;
        clean.forEach(function (t) {
          var g = Math.min(Math.abs(t.start - w.end), Math.abs(w.start - t.end));
          if (g < gap) { gap = g; best = t.id; }
        });
      }
      if (best == null) return;
      if (order[best] == null) order[best] = next++;
      w.spk = order[best];
    });
    return ws;
  }

  /* ═══════════ SWEAR WORDS ═══════════
     "*" at the end matches any ending (fuck*, fucking, fucked); "*" at both
     ends matches anywhere inside a word. Kept to the unambiguous ones: a
     filter that hides "hell" in "hello" is worse than none. */
  var SWEARS = {
    en: "fuck*,*fuck*,motherfuck*,shit*,*shit,bullshit*,bitch*,bastard*,cunt*,dick,dicks,dickhead*,cock,cocks,cocksucker*,pussy,pussies,asshole*,arsehole*,ass,arse,dumbass*,jackass*,piss,pissed,pissing,wank*,twat*,prick*,slut*,whore*,bollock*,bugger*,goddamn*,damn,damned,crap,crappy,nigga*,nigger*,faggot*,fag,fags,retard,retarded,douche*,jerkoff*,tits,titty,titties,boner*,dildo*",
    es: "mierda*,puta*,puto*,joder,jodido*,coño*,cabrón*,cabron*,pendejo*,gilipollas,hostia*,chinga*,verga*,culero*,maricón*,maricon*,zorra*,carajo*",
    pt: "porra*,caralho*,merda*,puta*,foda*,fodase,foder*,cacete*,buceta*,viado*,arrombado*,cu,filho da puta",
    fr: "merde*,putain*,connard*,connasse*,salope*,bordel*,enculé*,encule*,niquer*,nique,pute*,bite,couilles*,fdp,ta gueule",
    de: "scheiße*,scheisse*,arschloch*,fick*,hure*,wichser*,fotze*,schlampe*,verdammt*,mist,kacke*,miststück*,missgeburt*",
    it: "cazzo*,merda*,stronzo*,stronza*,vaffanculo*,puttana*,coglione*,minchia*,figa,porca*,bastardo*",
    nl: "kut*,klootzak*,godverdomme*,kanker*,lul,lullen,tering*,hoer*,eikel*,shit*",
    ru: "*бля*,сука*,*хуй*,*хуе*,пизд*,*еба*,*ёба*,ебан*,ебат*,мудак*,мудил*,говно*,дерьмо*,шлюх*,пидор*,залуп*",
    id: "bangsat*,kontol*,memek*,ngentot*,jancok*,jancuk*,bajingan*,tai,brengsek*,goblok*,keparat*",
    tl: "putang*,putangina*,tangina*,gago*,gaga,tarantado*,ulol*,leche,punyeta*,pakyu*",
    hi: "bhenchod*,behenchod*,madarchod*,chutiya*,chutiye*,gandu*,bhosdike*,harami*,randi*,lund*,lavda*,lauda*,*चोद*,चूतिया*,गांडू*,हरामी*",
    th: "*เหี้ย*,*สัส*,*ควย*,*เย็ด*,*แม่ง*,*ชิบหาย*,*ส้นตีน*,*ระยำ*,*สันดาน*,*อีดอก*,*อีห่า*,*ไอ้ห่า*,*หี*",
    ja: "*くそ*,*クソ*,*ちくしょう*,*畜生*,*死ね*,*まんこ*,*ちんこ*"
  };

  function norm(s) {
    return String(s || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\p{M}' ]+/gu, "").replace(/^'+|'+$/g, "").trim();
  }

  function compileList(entries) {
    var exact = {}, prefix = [], inside = [];
    entries.forEach(function (e) {
      e = String(e || "").trim().toLowerCase();
      if (!e) return;
      var a = e.charAt(0) === "*", z = e.charAt(e.length - 1) === "*";
      var core = norm(e.replace(/^\*|\*$/g, ""));
      if (!core) return;
      if (a && z) inside.push(core);
      else if (z) prefix.push(core);
      else exact[core] = 1;
    });
    return { exact: exact, prefix: prefix, inside: inside };
  }

  var builtCache = { key: "", m: null };
  /* One matcher for the caption's language (and English, which turns up
     mid-sentence everywhere), plus the person's own words. */
  function censorMatcher(lang, extra, allowed) {
    var key = (lang || "") + "|" + (extra || []).join(",") + "|" + (allowed || []).join(",");
    if (builtCache.key === key) return builtCache.m;
    var list = (SWEARS.en || "").split(",");
    if (lang && SWEARS[lang] && lang !== "en") list = list.concat(SWEARS[lang].split(","));
    if (!lang) Object.keys(SWEARS).forEach(function (k) { if (k !== "en") list = list.concat(SWEARS[k].split(",")); });
    list = list.concat(extra || []);
    var c = compileList(list);
    var ok = {};
    (allowed || []).forEach(function (a) { ok[norm(a)] = 1; });
    var m = function (text) {
      var w = norm(text);
      if (!w || ok[w]) return false;
      if (c.exact[w]) return true;
      for (var i = 0; i < c.prefix.length; i++) if (w.indexOf(c.prefix[i]) === 0) return true;
      for (var j = 0; j < c.inside.length; j++) if (w.indexOf(c.inside[j]) >= 0) return true;
      return false;
    };
    builtCache = { key: key, m: m };
    return m;
  }

  // f***, keeping the punctuation around it
  function mask(text) {
    var s = String(text);
    var m = s.match(/^([^\p{L}\p{N}]*)([\p{L}\p{N}\p{M}']+)([^\p{L}\p{N}]*)$/u);
    if (!m) return s.replace(/[\p{L}\p{N}]/gu, "*");
    var chars = Array.from(m[2]);
    return m[1] + chars[0] + chars.slice(1).map(function () { return "*"; }).join("") + m[3];
  }

  /* ═══════════ VOCABULARY ═══════════
     The person's names and terms. A run of caption words that is spelled
     almost the same, or sounds the same, becomes the term as written.
     Short terms (under 4 letters) only fix their capitals, because "Al"
     sounding like "all" would wreck every sentence. */
  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (var k = 1; k <= n; k++) {
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // How a word sounds, roughly: consonant skeleton with common spellings folded.
  function sound(s) {
    s = norm(s).replace(/\s+/g, "");
    if (!/^[a-z0-9]+$/.test(s)) return s;
    s = s.replace(/ph/g, "f").replace(/ck/g, "k").replace(/c(?=[eiy])/g, "s").replace(/[cq]/g, "k")
      .replace(/x/g, "ks").replace(/z/g, "s").replace(/([^aeiou])h/g, "$1").replace(/w(?=[^aeiou]|$)/g, "");
    var head = s.charAt(0);
    var rest = s.slice(1).replace(/[aeiouy]/g, "");
    return (head + rest).replace(/(.)\1+/g, "$1");
  }

  function compileVocab(list) {
    return (list || []).map(function (t) { return String(t || "").trim(); }).filter(Boolean).map(function (t) {
      var flat = norm(t).replace(/\s+/g, "");
      return { term: t, flat: flat, sound: sound(t), parts: t.split(/\s+/).length };
    }).filter(function (v) { return v.flat; });
  }

  /* Rewrites the words in place: each word keeps its raw text, and its
     shown text is the term where one matched. Called again whenever the
     list changes, from the raw text, so taking a term out undoes it. */
  function applyVocab(ws, list) {
    ws.forEach(function (w) { w.text = w.raw != null ? w.raw : w.text; w.merged = 0; w.hide = false; });
    var vocab = compileVocab(list);
    if (!vocab.length || !ws.length) return ws;
    var taken = new Array(ws.length).fill(false);
    var hits = [];
    vocab.forEach(function (v) {
      for (var n = Math.max(1, v.parts - 1); n <= v.parts + 1; n++) {
        for (var i = 0; i + n <= ws.length; i++) {
          var span = ws.slice(i, i + n);
          var joined = span.map(function (w) { return norm(w.text); }).join("");
          if (!joined) continue;
          var exact = joined === v.flat;
          var score = 0;
          if (exact) score = 1;
          else if (v.flat.length >= 4 && Math.abs(joined.length - v.flat.length) <= Math.max(2, v.flat.length * 0.4)) {
            var sim = 1 - lev(joined, v.flat) / Math.max(joined.length, v.flat.length);
            var soundsSame = sound(joined) === v.sound && v.sound.length >= 2;
            if (sim >= 0.8 || (soundsSame && sim >= 0.55)) score = sim + (soundsSame ? 0.1 : 0);
          }
          if (score > 0) hits.push({ i: i, n: n, v: v, score: score });
        }
      }
    });
    hits.sort(function (a, b) { return b.score - a.score || b.n - a.n; });
    hits.forEach(function (h) {
      for (var k = h.i; k < h.i + h.n; k++) if (taken[k]) return;
      for (var q = h.i; q < h.i + h.n; q++) taken[q] = true;
      var last = ws[h.i + h.n - 1];
      var tail = (String(last.text).match(/[^\p{L}\p{N}]+$/u) || [""])[0];
      var lead = (String(ws[h.i].text).match(/^[^\p{L}\p{N}]+/u) || [""])[0];
      var first = ws[h.i];
      first.text = lead + h.v.term + tail;
      first.end = last.end;
      first.merged = h.n - 1;
      for (var r = h.i + 1; r < h.i + h.n; r++) ws[r].hide = true;
    });
    return ws;
  }

  /* ═══════════ KEYWORDS ═══════════
     The one word in a caption that carries it: a number, a name, a strong
     word, else a long content word. Nothing is coloured when nothing stands
     out; colouring a random word every line trains the eye to ignore it. */
  var STOP = {
    en: "a,an,the,and,or,but,so,if,then,than,that,this,these,those,there,here,is,are,was,were,be,been,being,am,do,does,did,have,has,had,i,me,my,mine,you,your,yours,he,him,his,she,her,hers,it,its,we,us,our,they,them,their,what,which,who,whom,whose,when,where,why,how,to,of,in,on,at,by,for,with,about,from,into,over,up,down,out,off,just,very,really,also,too,not,no,yes,okay,ok,like,um,uh,oh,yeah,well,can,could,will,would,should,shall,may,might,must,get,got,go,going,gonna,wanna,know,think,mean,thing,things,some,any,all,more,most,much,many,one,ones,because,cause,said,say,says",
    es: "el,la,los,las,un,una,y,o,pero,que,de,del,en,a,por,para,con,es,son,fue,era,yo,tu,él,ella,lo,le,se,mi,su,nos,muy,más,ya,no,sí,como,este,esta,eso",
    pt: "o,a,os,as,um,uma,e,ou,mas,que,de,do,da,em,no,na,por,para,com,é,são,foi,eu,você,ele,ela,se,meu,seu,muito,mais,já,não,sim,como,isso,este",
    fr: "le,la,les,un,une,et,ou,mais,que,de,du,des,en,à,au,par,pour,avec,est,sont,je,tu,il,elle,on,nous,vous,se,ce,ça,mon,son,très,plus,pas,ne,oui,comme",
    de: "der,die,das,ein,eine,und,oder,aber,dass,von,zu,in,im,an,auf,mit,für,ist,sind,war,ich,du,er,sie,es,wir,ihr,sich,mein,sein,sehr,mehr,nicht,ja,wie,so"
  };
  var STRONG = "never,always,best,worst,secret,secrets,free,money,crazy,insane,huge,massive,biggest,only,every,everyone,nobody,love,hate,stop,now,today,million,millions,billion,thousand,thousands,double,triple,half,first,last,fast,easy,hard,wrong,truth,mistake,mistakes,problem,win,lose,lost,fail,failed,perfect,amazing,incredible,dangerous,shocking,finally,instantly,forever,guaranteed,proven,illegal,banned,rich,broke,dead,death,war,fear,boom,wow,why,how,what";
  var stopSets = {}, strongSet = {};
  Object.keys(STOP).forEach(function (k) { stopSets[k] = {}; STOP[k].split(",").forEach(function (w) { stopSets[k][w] = 1; }); });
  STRONG.split(",").forEach(function (w) { strongSet[w] = 1; });

  function keywordScore(w, i, cueWords, lang) {
    var t = norm(w.text);
    if (!t) return -9;
    var stop = stopSets[lang] || stopSets.en;
    if (stop[t]) return -5;
    var s = 0;
    if (/\d/.test(w.text) || /[$€£¥฿%]/.test(w.text)) s += 5;
    if (strongSet[t]) s += 3.5;
    var prev = i > 0 ? cueWords[i - 1] : null;
    var startsSentence = !prev || /[.!?…]$/.test(prev.text);
    if (/^\p{Lu}/u.test(w.text) && !startsSentence && t !== "i" && !/^\p{Lu}+$/u.test(w.text)) s += 3;
    var len = Array.from(t).length;
    if (len >= 6) s += 1 + (len - 6) * 0.25;
    if (/[!]$/.test(w.text)) s += 1;
    return s;
  }

  // Marks w.key on the strongest word of each cue, when one is strong enough.
  function markKeywords(cues, lang) {
    cues.forEach(function (c) {
      var best = -1, score = 2.9;
      c.words.forEach(function (w, i) {
        w.key = false;
        if (w.hide) return;
        var s = keywordScore(w, i, c.words, lang);
        if (s > score) { score = s; best = i; }
      });
      if (best >= 0) c.words[best].key = true;
    });
    return cues;
  }

  /* ═══════════ TRANSLATION ═══════════
     On the device first: Chrome's Translator downloads a language pair once
     and translates offline after that. Elsewhere, or for a pair it lacks,
     the AI Director translates the lines (a fraction of a cent, or free on
     a free tier). Each caption keeps its timing; its words are spread over
     it when drawn. */
  // A promise that gives up: some browsers expose the translator and then never answer.
  function within(ms, p) {
    return Promise.race([p, new Promise(function (_, reject) { setTimeout(function () { reject(new Error("timeout")); }, ms); })]);
  }

  async function translate(lines, target, source, say) {
    say = say || function () {};
    var out = null;
    if (global.Translator && source && source !== target) {
      var tr = null;
      try {
        var pair = { sourceLanguage: isoCode(source), targetLanguage: isoCode(target) };
        var avail = await within(5000, global.Translator.availability(pair));
        if (avail && avail !== "unavailable") {
          say("Translating on this device…");
          tr = await within(180000, global.Translator.create(Object.assign({}, pair, {
            monitor: function (m) {
              m.addEventListener("downloadprogress", function (e) { say("Getting the " + LANG_NAME[target] + " translator… " + Math.round((e.loaded || 0) * 100) + "%"); });
            }
          })));
          out = [];
          for (var i = 0; i < lines.length; i++) out.push(lines[i] ? await within(20000, tr.translate(lines[i])) : "");
        }
      } catch (e) { out = null; }
      if (tr) { try { tr.destroy(); } catch (e) {} }
    }
    if (!out) {
      var E = global.IntelligenceEngine;
      if (!E || !E.translateLines) throw new Error("Translation needs the AI Director, which isn't loaded.");
      say("Translating with the AI Director…");
      out = [];
      var BATCH = 50;
      for (var b = 0; b < lines.length; b += BATCH) {
        var part = await E.translateLines(lines.slice(b, b + BATCH), LANG_NAME[target] || target);
        out = out.concat(part);
        say("Translating with the AI Director… " + Math.min(lines.length, b + BATCH) + " of " + lines.length);
      }
    }
    return out;
  }

  /* ═══════════ FONTS ═══════════
     Thirty free Google Fonts chosen for captions: heavy, readable, and
     between them covering Latin, Cyrillic, Greek, Thai and Vietnamese.
     Loaded only when captions are opened; a font file downloads only once
     a caption uses it. */
  var FONTS = [
    ["Montserrat", "700;800;900"], ["Poppins", "700;800;900"], ["Inter", "600;700;800;900"],
    ["Anton", "400"], ["Bebas Neue", "400"], ["Oswald", "600;700"], ["Archivo Black", "400"],
    ["Rubik", "700;800;900"], ["Lilita One", "400"], ["Bangers", "400"], ["Luckiest Guy", "400"],
    ["Bungee", "400"], ["Fredoka", "600;700"], ["Permanent Marker", "400"], ["Caveat", "700"],
    ["Pacifico", "400"], ["Playfair Display", "700;800;900"], ["DM Serif Display", "400"],
    ["Cinzel", "700;800"], ["Space Mono", "700"], ["Courier Prime", "700"], ["Press Start 2P", "400"],
    ["Russo One", "400"], ["Teko", "600;700"], ["Barlow Condensed", "700;800;900"],
    ["Kanit", "600;700;800"], ["Prompt", "600;700;800"], ["Noto Sans", "700;800;900"],
    ["Black Ops One", "400"], ["Righteous", "400"]
  ];
  var fontCssAdded = false;
  function loadFontCss() {
    if (fontCssAdded || typeof document === "undefined") return;
    fontCssAdded = true;
    var fam = FONTS.map(function (f) {
      var w = f[1] === "400" ? "" : ":wght@" + f[1];
      return "family=" + f[0].replace(/ /g, "+") + w;
    }).join("&");
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?" + fam + "&display=swap";
    document.head.appendChild(link);
  }

  var fontState = {};
  /* Resolves once the font can be drawn. Until then captions draw in the
     fallback and redraw when it lands (onFont). */
  function ensureFont(family, weight) {
    if (!family || typeof document === "undefined" || !document.fonts) return Promise.resolve(true);
    var key = (weight || 400) + " " + family;
    if (fontState[key] === "ok") return Promise.resolve(true);
    if (fontState[key] && fontState[key].then) return fontState[key];
    loadFontCss();
    var p = document.fonts.load(key.replace(" ", " 48px \"") + "\"", "Ag").then(function (list) {
      fontState[key] = "ok";
      if (api.onFont) try { api.onFont(); } catch (e) {}
      return !!(list && list.length);
    }).catch(function () { fontState[key] = "ok"; return false; });
    fontState[key] = p;
    return p;
  }
  function fontReady(family, weight) { return fontState[(weight || 400) + " " + family] === "ok"; }

  /* Your own fonts. The file stays on this device (IndexedDB) and is loaded
     again each visit, so a caption made with it exports with it. */
  var DB = "vclyps-fonts", STORE = "fonts";
  function db() {
    return new Promise(function (resolve, reject) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }
  function dbDo(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction(STORE, mode), out = fn(tx.objectStore(STORE));
        tx.oncomplete = function () { resolve(out && out.result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  var custom = [];   // names, in the order added
  function fontNameFrom(file) {
    return String(file.name || "My font").replace(/\.(ttf|otf|woff2?|ttc)$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "My font";
  }
  async function addCustomFont(file) {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name || "") && !/font/.test(file.type || "")) {
      throw new Error("That isn't a font file. Use a .ttf, .otf, .woff or .woff2 file.");
    }
    if (file.size > 30 * 1024 * 1024) throw new Error("That font file is over 30 MB. Use a single style of the font.");
    var data = await file.arrayBuffer();
    var name = fontNameFrom(file);
    var face = new FontFace(name, data);
    try { await face.load(); } catch (e) { throw new Error("That font file couldn't be read. Try another copy of it."); }
    document.fonts.add(face);
    fontState["400 " + name] = "ok";
    await dbDo("readwrite", function (s) { return s.put({ name: name, data: data }, name); });
    if (custom.indexOf(name) < 0) custom.push(name);
    return name;
  }
  async function removeCustomFont(name) {
    custom = custom.filter(function (n) { return n !== name; });
    try { await dbDo("readwrite", function (s) { return s.delete(name); }); } catch (e) {}
  }
  async function restoreCustomFonts() {
    try {
      var all = await dbDo("readonly", function (s) { return s.getAll(); });
      for (var i = 0; i < (all || []).length; i++) {
        var f = all[i];
        try {
          var face = new FontFace(f.name, f.data);
          await face.load();
          document.fonts.add(face);
          fontState["400 " + f.name] = "ok";
          if (custom.indexOf(f.name) < 0) custom.push(f.name);
        } catch (e) {}
      }
    } catch (e) {}
    return custom.slice();
  }

  var api = {
    LANGUAGES: LANGUAGES,
    LANG_NAME: LANG_NAME,
    NO_SPACE: NO_SPACE,
    RTL_RE: RTL_RE,
    isoCode: isoCode,
    words: words,
    assignSpeakers: assignSpeakers,
    censorMatcher: censorMatcher,
    mask: mask,
    applyVocab: applyVocab,
    markKeywords: markKeywords,
    translate: translate,
    FONTS: FONTS,
    loadFontCss: loadFontCss,
    ensureFont: ensureFont,
    fontReady: fontReady,
    addCustomFont: addCustomFont,
    removeCustomFont: removeCustomFont,
    restoreCustomFonts: restoreCustomFonts,
    customFonts: function () { return custom.slice(); },
    onFont: null,
    // exported for the tests
    _sound: sound,
    _lev: lev,
    _keywordScore: keywordScore
  };
  global.VevrisCaptionTools = api;
})(typeof window !== "undefined" ? window : globalThis);
