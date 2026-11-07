/* ═══════════════════════════════════════════════════════════
   vClyps: stickers
   Two kinds, both placed, sized, turned and animated like a text (they ARE
   texts in the project, with t.sticker set):
     emoji   drawn from Noto Color Emoji (free, SIL Open Font License),
             fetched only for the emoji actually used
     shapes  65 drawn here in code: arrows, highlight circles, underlines,
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
  /* A word sticker's word can be the user's own (round 2): drawShape passes
     it in and the button grows to fit it, never shrinks below its design. */
  var word = null, usedLabel = false;
  function label(c, text, s, color, bg, wFactor) {
    usedLabel = true;
    if (word) text = word;
    var h = s * 0.62;
    c.font = "800 " + (h * 0.48) + "px Inter, Montserrat, system-ui, sans-serif";
    var w = Math.max(s * wFactor, (word ? c.measureText(text).width : 0) + h * 0.9);
    rr(c, -w / 2, -h / 2, w, h, h * 0.22);
    c.fillStyle = bg; c.fill();
    c.fillStyle = color;
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

  // Static shapes use the existing text animation controls. No frame history.
  function addShape(id, name, draw) {
    SHAPES[id] = draw; SHAPE_LIST.push([id, name, "#edeae2"]);
  }
  function strokeShape(id, name, pts, width) {
    addShape(id, name, function (c, s, col) {
      c.strokeStyle = col; c.lineWidth = s * 0.055; c.lineCap = "round"; c.lineJoin = "round";
      var start = true;
      c.beginPath(); pts.forEach(function (p) {
        if (!p) { start = true; return; }
        c[start ? "moveTo" : "lineTo"](p[0] * s, p[1] * s); start = false;
      }); c.stroke(); return s * width;
    });
  }
  strokeShape("arrow-double", "Double arrow", [[-.7,0],[.7,0],[.4,-.25],[.7,0],[.4,.25],[.7,0],[-.7,0],[-.4,-.25],[-.7,0],[-.4,.25]], 1.5);
  strokeShape("arrow-elbow", "Elbow arrow", [[-.6,.35],[-.6,-.25],[.6,-.25],[.35,-.48],[.6,-.25],[.35,0]], 1.4);
  strokeShape("arrow-sketch", "Sketch arrow", [[-.65,.3],[-.3,.12],[0,-.08],[.6,-.25],[.3,-.4],[.6,-.25],[.4,.05]], 1.4);
  strokeShape("pointer", "Pointer", [[-.5,.4],[.5,-.4],[.1,-.35],[.5,-.4],[.45,0]], 1.2);
  strokeShape("arrow-u", "Turn arrow", [[-.55,.35],[-.55,-.3],[.45,-.3],[.45,.3],[.2,.05],[.45,.3],[.7,.05]], 1.5);
  strokeShape("underline-wave", "Wave underline", [[-.8,0],[-.6,-.1],[-.4,.1],[-.2,-.1],[0,.1],[.2,-.1],[.4,.1],[.6,-.1],[.8,0]], 1.7);
  strokeShape("strike", "Strike through", [[-.8,.08],[.8,-.08]], 1.7);
  strokeShape("underline-double", "Double underline", [[-.8,-.08],[.8,-.08],null,[.8,.08],[-.8,.08]], 1.7);
  strokeShape("zigzag", "Zigzag", [[-.7,.3],[-.35,-.3],[0,.3],[.35,-.3],[.7,.3]], 1.5);
  strokeShape("accent-lines", "Accent lines", [[-.55,-.4],[-.25,-.15],null,[0,-.45],[0,-.1],null,[.55,-.4],[.25,-.15]], 1.2);
  ["marker-swipe", "highlight-box", "rounded-border", "focus-box"].forEach(function (id, i) {
    addShape(id, ["Marker swipe", "Highlight box", "Rounded border", "Focus box"][i], function (c, s, col) {
      c.strokeStyle = c.fillStyle = col; c.lineWidth = s * .045;
      rr(c, -s * .8, -s * (i ? .43 : .16), s * 1.6, s * (i ? .86 : .32), s * (i === 2 ? .16 : .02));
      if (!i) { c.globalAlpha *= .55; c.fill(); } else c.stroke();
      if (i === 3) { c.beginPath(); c.moveTo(-s*.12,0); c.lineTo(s*.12,0); c.moveTo(0,-s*.12); c.lineTo(0,s*.12); c.stroke(); }
      return s * 1.7;
    });
  });
  addShape("circle-scribble", "Circle scribble", function (c,s,col) {
    c.strokeStyle=col; c.lineWidth=s*.035;
    c.beginPath(); c.ellipse(0,0,s*.65,s*.4,-.08,0,Math.PI*2); c.stroke();
    c.beginPath(); c.ellipse(s*.02,0,s*.68,s*.36,.08,0,Math.PI*1.9); c.stroke(); return s*1.45;
  });
  ["speech-sharp", "speech-round", "shout", "callout-left", "callout-right"].forEach(function(id,i) {
    addShape(id,["Sharp bubble","Round bubble","Shout bubble","Callout left","Callout right"][i],function(c,s,col) {
      c.fillStyle=col;
      if(i===2) { c.save(); c.scale(1.5,.8); burst(c,s,12,.37,col); c.restore(); }
      else { rr(c,-s*.7,-s*.4,s*1.4,s*.65,i===1?s*.24:s*.04); c.fill(); }
      var x=i===4?s*.4:-s*.4;
      c.beginPath(); c.moveTo(x-s*.12,s*.2); c.lineTo(x,s*.48); c.lineTo(x+s*.18,s*.2); c.closePath(); c.fill(); return s*1.5;
    });
  });
  [["sale-tag","Sale","SALE"],["live-tag","Live","LIVE"],["share","Share","SHARE"],["save-button","Save","SAVE"],["comment-button","Comment","COMMENT"],["watch-button","Watch","WATCH"]].forEach(function(e) {
    addShape(e[0],e[1],function(c,s,col){return label(c,e[2],s,"#111210",col,e[2].length*.22+.5);});
  });
  addShape("price-tag","Price tag",function(c,s,col) {
    c.fillStyle=col; c.beginPath(); c.moveTo(-s*.75,0); c.lineTo(-s*.4,-s*.35); c.lineTo(s*.7,-s*.35); c.lineTo(s*.7,s*.35); c.lineTo(-s*.4,s*.35); c.closePath(); c.fill();
    c.fillStyle="#111210"; c.beginPath(); c.arc(-s*.4,0,s*.065,0,Math.PI*2); c.fill(); return s*1.55;
  });
  for(var rating=1;rating<=5;rating++) (function(n) {
    addShape("rating-"+n,n+" star rating",function(c,s,col) {
      for(var j=0;j<5;j++) { c.save(); c.translate((j-2)*s*.36,0); c.globalAlpha*=j<n?1:.2; burst(c,s*.33,5,.2,col); c.restore(); } return s*1.85;
    });
  })(rating);
  addShape("dots","Dots",function(c,s,col){ c.fillStyle=col; for(var i=-1;i<=1;i++){c.beginPath();c.arc(i*s*.38,0,s*.09,0,Math.PI*2);c.fill();}return s;});
  addShape("confetti","Confetti pieces",function(c,s,col){c.fillStyle=col;for(var i=0;i<9;i++){c.save();c.translate(((i*7)%9-4)*s*.14,(Math.floor(i/3)-1)*s*.3);c.rotate(i*.7);c.fillRect(-s*.035,-s*.08,s*.07,s*.16);c.restore();}return s*1.4;});
  strokeShape("bracket-left","Left bracket",[[.3,-.45],[-.3,-.45],[-.3,.45],[.3,.45]],.8);
  strokeShape("bracket-right","Right bracket",[[-.3,-.45],[.3,-.45],[.3,.45],[-.3,.45]],.8);
  addShape("oval-border","Oval border",function(c,s,col){c.strokeStyle=col;c.lineWidth=s*.04;c.beginPath();c.ellipse(0,0,s*.72,s*.43,0,0,Math.PI*2);c.stroke();return s*1.55;});
  addShape("diamond-border","Diamond border",function(c,s,col){c.strokeStyle=col;c.lineWidth=s*.04;c.beginPath();c.moveTo(0,-s*.45);c.lineTo(s*.7,0);c.lineTo(0,s*.45);c.lineTo(-s*.7,0);c.closePath();c.stroke();return s*1.5;});
  addShape("check-badge","Tick badge",function(c,s,col){burst(c,s,12,.43,col);SHAPES.check(c,s*.65,"#111210");return s;});
  addShape("cross-badge","Cross badge",function(c,s,col){c.fillStyle=col;c.beginPath();c.arc(0,0,s*.48,0,Math.PI*2);c.fill();SHAPES.cross(c,s*.65,"#111210");return s;});

  // draw shape id, s high, centred on (0, 0); returns its width
  function drawShape(c, id, s, color, custom) {
    var fn = SHAPES[id];
    if (!fn) return s;
    c.save();
    word = custom ? String(custom).toUpperCase() : null;
    var w;
    try { w = fn(c, s, color || "#ffffff"); } finally { word = null; }
    c.restore();
    return w;
  }
  // how wide a shape is for its height, without drawing it on screen: drawn
  // on one small measuring canvas kept for good (this runs every frame)
  var measure = null;
  function shapeWidth(id, s, custom) {
    if (typeof document === "undefined") return s;
    if (!measure) { var cv = document.createElement("canvas"); cv.width = cv.height = 1; measure = cv.getContext("2d"); }
    return drawShape(measure, id, s, "#000", custom);
  }
  // does this shape carry a word the user can change (Subscribe, Sale...)?
  var wordy = {};
  function hasWord(id) {
    if (wordy[id] == null) {
      usedLabel = false;
      if (typeof document !== "undefined") shapeWidth(id, 10);
      wordy[id] = usedLabel;
    }
    return wordy[id];
  }

  var emojiFontAdded = false;
  function loadEmojiFont() {
    if (emojiFontAdded || typeof document === "undefined") return;
    emojiFontAdded = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.bunny.net/css2?family=Noto+Color+Emoji&display=swap";
    document.head.appendChild(link);
  }

  global.SenotelStickers = {
    EMOJI: EMOJI,
    SHAPES: SHAPE_LIST,
    drawShape: drawShape,
    shapeWidth: shapeWidth,
    hasWord: hasWord,
    loadEmojiFont: loadEmojiFont,
    EMOJI_FONT: "Noto Color Emoji"
  };
})(typeof window !== "undefined" ? window : globalThis);
