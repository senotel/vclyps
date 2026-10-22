/* ═══════════════════════════════════════════════════════════
   vClyps: stickers
   Two kinds, both placed, sized, turned and animated like a text (they ARE
   texts in the project, with t.sticker set):
     emoji   drawn from Noto Color Emoji (free, SIL Open Font License),
             fetched only for the emoji actually used
     shapes  drawn here in code: arrows, highlight circles, underlines,
             bursts, bubbles, buttons. Sharp at any size, in any colour.
   No image files, nothing bundled, nothing to license per use.
   Exposes window.SenotelStickers.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  // [emoji, words to find it by]
  var EMOJI = [
    ["Faces", [
      ["😂", "laugh crying tears joy funny"], ["🤣", "rolling laugh lol"], ["😭", "crying sob sad"], ["😍", "heart eyes love"],
      ["🥹", "holding tears touched"], ["😎", "cool sunglasses"], ["🤯", "mind blown shocked"], ["😱", "scream shocked scared"],
      ["😳", "flushed embarrassed shocked"], ["🥺", "pleading puppy eyes"], ["😤", "triumph angry huff"], ["😡", "angry mad"],
      ["🤔", "thinking hmm"], ["🙄", "eye roll annoyed"], ["😴", "sleep tired"], ["🥱", "yawn bored tired"], ["🤩", "star struck wow"],
      ["😏", "smirk"], ["😬", "grimace awkward"], ["🫠", "melting"], ["🤫", "shush quiet secret"], ["🤐", "zipper mouth secret"],
      ["🤡", "clown"], ["💀", "skull dead dying lol"], ["👀", "eyes look watch"], ["🫣", "peek shy"], ["😇", "angel innocent"],
      ["🥳", "party celebrate"], ["🤑", "money mouth rich"], ["🤓", "nerd glasses"], ["😵‍💫", "dizzy"], ["🙃", "upside down"],
      ["😅", "sweat smile nervous"], ["😉", "wink"], ["🥰", "love hearts"], ["😘", "kiss"], ["🤤", "drool hungry"], ["🤢", "sick gross"]
    ]],
    ["Hands", [
      ["👍", "thumbs up yes like good"], ["👎", "thumbs down no bad"], ["👏", "clap applause"], ["🙌", "raised hands celebrate"],
      ["🙏", "pray please thanks"], ["👉", "point right"], ["👈", "point left"], ["👇", "point down"], ["☝️", "point up"],
      ["👆", "point up"], ["✌️", "peace victory"], ["🤞", "fingers crossed luck"], ["🤌", "pinched italian"], ["👌", "ok perfect"],
      ["🫡", "salute"], ["💪", "strong muscle flex"], ["🤝", "handshake deal"], ["✍️", "writing"], ["🫶", "heart hands love"],
      ["👋", "wave hello bye"], ["🤙", "call me shaka"], ["🖐️", "hand stop"], ["✊", "fist"], ["🤘", "rock on"]
    ]],
    ["Hearts", [
      ["❤️", "red heart love"], ["🧡", "orange heart"], ["💛", "yellow heart"], ["💚", "green heart"], ["💙", "blue heart"],
      ["💜", "purple heart"], ["🖤", "black heart"], ["🤍", "white heart"], ["💔", "broken heart"], ["❤️‍🔥", "heart on fire"],
      ["💕", "two hearts"], ["💖", "sparkling heart"], ["💯", "hundred perfect"], ["💥", "boom collision"], ["💫", "dizzy star"],
      ["💦", "sweat drops"], ["💨", "dash fast"], ["💬", "speech chat"], ["💭", "thought"], ["💤", "sleep zzz"]
    ]],
    ["Symbols", [
      ["🔥", "fire hot lit"], ["✨", "sparkles magic"], ["⭐", "star"], ["🌟", "glowing star"], ["⚡", "lightning bolt energy"],
      ["✅", "check yes done"], ["❌", "cross no wrong"], ["⚠️", "warning"], ["❗", "exclamation"], ["❓", "question"],
      ["‼️", "double exclamation"], ["⁉️", "what"], ["🚨", "siren alert"], ["📢", "announce loud"], ["🔔", "bell notification"],
      ["🆕", "new"], ["🆒", "cool"], ["🔝", "top"], ["🎯", "target bullseye"], ["🏆", "trophy win"], ["🥇", "gold first"],
      ["👑", "crown king queen"], ["💎", "diamond gem"], ["💰", "money bag"], ["💸", "money flying spend"], ["📈", "chart up growth"],
      ["📉", "chart down"], ["⏰", "alarm time"], ["⏳", "hourglass wait"], ["🔒", "lock"], ["🔑", "key"], ["🔗", "link"]
    ]],
    ["Things", [
      ["🎉", "party popper celebrate"], ["🎊", "confetti"], ["🎁", "gift present"], ["🎂", "cake birthday"], ["🎈", "balloon"],
      ["📸", "camera photo"], ["🎥", "video camera film"], ["🎬", "clapper action"], ["🎤", "microphone sing"], ["🎧", "headphones music"],
      ["🎵", "music note"], ["🎮", "game controller gaming"], ["📱", "phone mobile"], ["💻", "laptop computer"], ["📚", "books study"],
      ["✏️", "pencil write"], ["📌", "pin"], ["📍", "location pin place"], ["🧠", "brain smart"], ["💡", "idea bulb"],
      ["🚀", "rocket launch"], ["✈️", "plane travel"], ["🚗", "car"], ["🏠", "house home"], ["⚽", "football soccer"],
      ["🏀", "basketball"], ["☕", "coffee"], ["🍕", "pizza"], ["🍔", "burger"], ["🍿", "popcorn"], ["🍷", "wine"], ["🧋", "bubble tea"]
    ]],
    ["Nature", [
      ["☀️", "sun sunny"], ["🌙", "moon night"], ["🌈", "rainbow"], ["☁️", "cloud"], ["🌧️", "rain"], ["❄️", "snow cold"],
      ["🌊", "wave sea ocean"], ["🌸", "blossom flower"], ["🌹", "rose"], ["🌻", "sunflower"], ["🍀", "clover luck"], ["🌴", "palm beach"],
      ["🐶", "dog"], ["🐱", "cat"], ["🐸", "frog"], ["🦋", "butterfly"], ["🐐", "goat greatest"], ["🦄", "unicorn"], ["🐝", "bee"], ["🐍", "snake"]
    ]],
    ["Flags", [
      ["🇹🇭", "thailand thai"], ["🇺🇸", "usa america"], ["🇬🇧", "uk britain"], ["🇯🇵", "japan"], ["🇰🇷", "korea"], ["🇨🇳", "china"],
      ["🇫🇷", "france"], ["🇩🇪", "germany"], ["🇪🇸", "spain"], ["🇮🇹", "italy"], ["🇧🇷", "brazil"], ["🇮🇳", "india"],
      ["🇻🇳", "vietnam"], ["🇵🇭", "philippines"], ["🇮🇩", "indonesia"], ["🇲🇾", "malaysia"], ["🇸🇬", "singapore"], ["🏳️‍🌈", "pride rainbow flag"]
    ]]
  ];

  /* Shapes. Each draws itself centred on (0, 0), s high, and returns its
     width. color is the sticker's colour; most also use white or black. */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function arrow(c, s, color, dir) {
    c.save();
    c.rotate({ right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir]);
    c.beginPath();
    c.moveTo(-s * 0.7, -s * 0.16); c.lineTo(s * 0.1, -s * 0.16); c.lineTo(s * 0.1, -s * 0.42); c.lineTo(s * 0.72, 0);
    c.lineTo(s * 0.1, s * 0.42); c.lineTo(s * 0.1, s * 0.16); c.lineTo(-s * 0.7, s * 0.16); c.closePath();
    c.fillStyle = color; c.fill();
    c.restore();
    return dir === "up" || dir === "down" ? s * 0.9 : s * 1.45;
  }
  function burst(c, s, n, inner, color) {
    c.beginPath();
    for (var i = 0; i < n * 2; i++) { var r = i % 2 ? s * inner : s * 0.5, a = (i / (n * 2)) * Math.PI * 2 - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath(); c.fillStyle = color; c.fill();
  }
  function label(c, text, s, color, bg, wFactor) {
    var h = s * 0.62, w = s * wFactor;
    rr(c, -w / 2, -h / 2, w, h, h * 0.22);
    c.fillStyle = bg; c.fill();
    c.fillStyle = color;
    c.font = "800 " + (h * 0.48) + "px Inter, Montserrat, system-ui, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText(text, 0, h * 0.03);
    return w;
  }
  var SHAPES = {
    "arrow-right": function (c, s, col) { return arrow(c, s, col, "right"); },
    "arrow-left": function (c, s, col) { return arrow(c, s, col, "left"); },
    "arrow-up": function (c, s, col) { return arrow(c, s, col, "up"); },
    "arrow-down": function (c, s, col) { return arrow(c, s, col, "down"); },
    "arrow-curve": function (c, s, col) {
      c.strokeStyle = col; c.lineWidth = s * 0.08; c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath(); c.moveTo(-s * 0.6, s * 0.3); c.bezierCurveTo(-s * 0.4, -s * 0.45, s * 0.2, -s * 0.45, s * 0.45, -s * 0.05); c.stroke();
      c.beginPath(); c.moveTo(s * 0.18, -s * 0.12); c.lineTo(s * 0.48, -s * 0.02); c.lineTo(s * 0.44, -s * 0.34); c.stroke();
      return s * 1.25;
    },
    "circle-ring": function (c, s, col) {
      c.strokeStyle = col; c.lineWidth = s * 0.07; c.lineCap = "round";
      c.beginPath();
      for (var i = 0; i <= 64; i++) { var a = (i / 64) * Math.PI * 2.15 - 0.4, r = s * (0.46 + 0.03 * Math.sin(i * 0.7)); c.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r); }
      c.stroke();
      return s * 1.35;
    },
    underline: function (c, s, col) {
      c.strokeStyle = col; c.lineWidth = s * 0.1; c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath(); c.moveTo(-s * 0.9, 0); c.bezierCurveTo(-s * 0.3, -s * 0.12, s * 0.3, s * 0.12, s * 0.9, -s * 0.04); c.stroke();
      c.lineWidth = s * 0.06;
      c.beginPath(); c.moveTo(-s * 0.6, s * 0.18); c.bezierCurveTo(-s * 0.1, s * 0.08, s * 0.3, s * 0.22, s * 0.7, s * 0.12); c.stroke();
      return s * 1.9;
    },
    "star-burst": function (c, s, col) { burst(c, s, 12, 0.36, col); return s; },
    "new-tag": function (c, s, col) {
      burst(c, s, 14, 0.4, col);
      c.fillStyle = "#ffffff"; c.font = "900 " + (s * 0.24) + "px Inter, Montserrat, system-ui, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("NEW", 0, s * 0.02);
      return s;
    },
    sparkle: function (c, s, col) {
      c.beginPath();
      for (var i = 0; i < 8; i++) { var r = i % 2 ? s * 0.11 : s * 0.5, a = (i / 8) * Math.PI * 2 - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      c.closePath(); c.fillStyle = col; c.fill();
      return s;
    },
    heart: function (c, s, col) {
      c.beginPath(); c.moveTo(0, s * 0.42);
      c.bezierCurveTo(-s * 0.62, s * 0.02, -s * 0.5, -s * 0.5, 0, -s * 0.2);
      c.bezierCurveTo(s * 0.5, -s * 0.5, s * 0.62, s * 0.02, 0, s * 0.42);
      c.fillStyle = col; c.fill();
      return s * 1.1;
    },
    check: function (c, s, col) {
      c.strokeStyle = col; c.lineWidth = s * 0.14; c.lineCap = "round"; c.lineJoin = "round";
      c.beginPath(); c.moveTo(-s * 0.38, 0); c.lineTo(-s * 0.1, s * 0.3); c.lineTo(s * 0.42, -s * 0.32); c.stroke();
      return s;
    },
    cross: function (c, s, col) {
      c.strokeStyle = col; c.lineWidth = s * 0.14; c.lineCap = "round";
      c.beginPath(); c.moveTo(-s * 0.32, -s * 0.32); c.lineTo(s * 0.32, s * 0.32); c.moveTo(s * 0.32, -s * 0.32); c.lineTo(-s * 0.32, s * 0.32); c.stroke();
      return s;
    },
    bolt: function (c, s, col) {
      c.beginPath(); c.moveTo(s * 0.08, -s * 0.5); c.lineTo(-s * 0.28, s * 0.06); c.lineTo(-s * 0.02, s * 0.06); c.lineTo(-s * 0.1, s * 0.5); c.lineTo(s * 0.3, -s * 0.08); c.lineTo(s * 0.04, -s * 0.08); c.closePath();
      c.fillStyle = col; c.fill();
      return s * 0.7;
    },
    speech: function (c, s, col) {
      rr(c, -s * 0.7, -s * 0.42, s * 1.4, s * 0.68, s * 0.2); c.fillStyle = col; c.fill();
      c.beginPath(); c.moveTo(-s * 0.3, s * 0.22); c.lineTo(-s * 0.42, s * 0.5); c.lineTo(-s * 0.08, s * 0.24); c.closePath(); c.fill();
      return s * 1.45;
    },
    thought: function (c, s, col) {
      c.fillStyle = col;
      [[-0.32, -0.08, 0.3], [0.05, -0.2, 0.34], [0.38, -0.05, 0.28], [0.12, 0.12, 0.26], [-0.2, 0.14, 0.24]].forEach(function (b) { c.beginPath(); c.arc(b[0] * s, b[1] * s, b[2] * s, 0, Math.PI * 2); c.fill(); });
      c.beginPath(); c.arc(-s * 0.42, s * 0.38, s * 0.07, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(-s * 0.55, s * 0.5, s * 0.04, 0, Math.PI * 2); c.fill();
      return s * 1.45;
    },
    subscribe: function (c, s, col) { return label(c, "SUBSCRIBE", s, "#ffffff", col, 2.1); },
    follow: function (c, s, col) { return label(c, "FOLLOW", s, "#ffffff", col, 1.6); },
    like: function (c, s, col) { return label(c, "LIKE", s, "#ffffff", col, 1.15); },
    "link-bio": function (c, s, col) { return label(c, "LINK IN BIO", s, "#111111", col, 2.2); },
    rec: function (c, s, col) {
      c.fillStyle = col; c.beginPath(); c.arc(-s * 0.32, 0, s * 0.14, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ffffff"; c.font = "800 " + (s * 0.3) + "px Inter, system-ui, sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillText("REC", -s * 0.1, s * 0.02);
      return s * 1.1;
    },
    tape: function (c, s, col) {
      c.save(); c.rotate(-0.12); c.globalAlpha *= 0.85;
      c.beginPath(); var w = s * 1.6, h = s * 0.32;
      c.moveTo(-w / 2, -h / 2);
      for (var i = 0; i <= 8; i++) c.lineTo(-w / 2 + (w * i) / 8, -h / 2 + (i % 2 ? -h * 0.06 : 0));
      c.lineTo(w / 2, h / 2);
      for (var j = 8; j >= 0; j--) c.lineTo(-w / 2 + (w * j) / 8, h / 2 + (j % 2 ? h * 0.06 : 0));
      c.closePath(); c.fillStyle = col; c.fill(); c.restore();
      return s * 1.6;
    },
    corners: function (c, s, col) {
      var w = s * 1.4, h = s, k = s * 0.22;
      c.strokeStyle = col; c.lineWidth = s * 0.05; c.lineCap = "square";
      [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
        var x = p[0] * w / 2, y = p[1] * h / 2;
        c.beginPath(); c.moveTo(x - p[0] * k, y); c.lineTo(x, y); c.lineTo(x, y - p[1] * k); c.stroke();
      });
      return w;
    },
    pin: function (c, s, col) {
      c.beginPath(); c.arc(0, -s * 0.12, s * 0.28, Math.PI, 0); c.lineTo(0, s * 0.48); c.closePath();
      c.fillStyle = col; c.fill();
      c.fillStyle = "#ffffff"; c.beginPath(); c.arc(0, -s * 0.12, s * 0.1, 0, Math.PI * 2); c.fill();
      return s * 0.7;
    },
    exclaim: function (c, s, col) {
      burst(c, s, 10, 0.38, col);
      c.fillStyle = "#ffffff"; c.font = "900 " + (s * 0.5) + "px Inter, system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("!", 0, s * 0.03);
      return s;
    }
  };
  var SHAPE_LIST = [
    ["arrow-right", "Arrow right", "#ffffff"], ["arrow-left", "Arrow left", "#ffffff"], ["arrow-up", "Arrow up", "#ffffff"], ["arrow-down", "Arrow down", "#ffffff"],
    ["arrow-curve", "Hand-drawn arrow", "#ffe600"], ["circle-ring", "Circle it", "#ff3b30"], ["underline", "Underline", "#ffe600"],
    ["star-burst", "Burst", "#ffe600"], ["new-tag", "New", "#dc143c"], ["sparkle", "Sparkle", "#ffffff"], ["heart", "Heart", "#ff3b5c"],
    ["check", "Tick", "#2be36e"], ["cross", "Cross", "#ff3b30"], ["bolt", "Lightning", "#ffd60a"], ["speech", "Speech bubble", "#ffffff"],
    ["thought", "Thought bubble", "#ffffff"], ["subscribe", "Subscribe", "#ff0033"], ["follow", "Follow", "#dc143c"], ["like", "Like", "#2f80ed"],
    ["link-bio", "Link in bio", "#ffe600"], ["rec", "REC", "#ff3b30"], ["tape", "Tape", "#f5d76e"], ["corners", "Viewfinder", "#ffffff"],
    ["pin", "Place", "#dc143c"], ["exclaim", "Alert", "#ff9500"]
  ];

  // draw shape id, s high, centred on (0, 0); returns its width
  function drawShape(c, id, s, color) {
    var fn = SHAPES[id];
    if (!fn) return s;
    c.save();
    var w = fn(c, s, color || "#ffffff");
    c.restore();
    return w;
  }
  // how wide a shape is for its height, without drawing it
  function shapeWidth(id, s) {
    if (typeof document === "undefined") return s;
    var cv = document.createElement("canvas").getContext("2d");
    return drawShape(cv, id, s, "#000");
  }

  var emojiFontAdded = false;
  function loadEmojiFont() {
    if (emojiFontAdded || typeof document === "undefined") return;
    emojiFontAdded = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap";
    document.head.appendChild(link);
  }

  global.SenotelStickers = {
    EMOJI: EMOJI,
    SHAPES: SHAPE_LIST,
    drawShape: drawShape,
    shapeWidth: shapeWidth,
    loadEmojiFont: loadEmojiFont,
    EMOJI_FONT: "Noto Color Emoji"
  };
})(typeof window !== "undefined" ? window : globalThis);
