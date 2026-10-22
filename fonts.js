/* ═══════════════════════════════════════════════════════════
   vClyps: fonts
   Two separate libraries, as in CapCut: 132 fonts for captions and 166
   for text. No family is in both, so a text never looks like the captions
   under it, and no two fonts in a library are the same design in a
   different weight: each row says what makes that one look different.

   All of them are free Google Fonts (SIL Open Font License), so nothing is
   bundled into the app and nothing costs money. A font file is fetched only
   when something on screen uses it, one weight at a time; the picker shows
   each name in its own font from a tiny file holding just those letters.

   A row: [family, group, weights it has, has italic (1/0), what it looks like]
   Exposes window.SenotelFonts.
   ═══════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  var CAPTION = [
    ["Montserrat","Bold","400;500;600;700;800;900",1,"Wide geometric capitals, the short-form standard"],
    ["Poppins","Bold","400;500;600;700;800;900",1,"Perfect circles, friendly and very even"],
    ["Archivo Black","Bold","400",0,"Grotesk at full weight, tight and newsy"],
    ["Rubik","Bold","400;500;600;700;800;900",1,"Slightly rounded corners on a heavy body"],
    ["Titan One","Bold","400",0,"Chunky and soft, like a toy logo"],
    ["Passion One","Bold","400;700;900",0,"Heavy with tight counters, packs a punch"],
    ["Paytone One","Bold","400",0,"Heavy and warm with a rounded finish"],
    ["Chango","Bold","400",0,"Extra fat letters that nearly touch"],
    ["Sigmar One","Bold","400",0,"Bulging retro display weight"],
    ["Rubik Mono One","Bold","400",0,"Every letter the same wide width"],
    ["Unbounded","Bold","400;500;600;700;800;900",0,"Stretched wide and rounded, very current"],
    ["Krona One","Bold","400",0,"Low and extended, spacious capitals"],
    ["Days One","Bold","400",0,"Squarish heavy sans with flat curves"],
    ["Changa One","Bold","400",1,"Condensed heavy with a slight lean"],
    ["Bowlby One SC","Bold","400",0,"Small caps at poster weight"],
    ["Alfa Slab One","Bold","400",0,"Heavy slab serif, loud and solid"],
    ["Inter","Clean","400;500;600;700;800;900",1,"Neutral screen sans, made to be read small"],
    ["Noto Sans","Clean","400;500;600;700;800;900",1,"Plain and calm, covers almost every language"],
    ["Lexend","Clean","400;500;600;700;800;900",0,"Widened spacing for easy reading"],
    ["Space Grotesk","Clean","400;500;600;700",0,"Grotesk with quirky a, g and t"],
    ["Sora","Clean","400;500;600;700;800",0,"Geometric with open, airy shapes"],
    ["Work Sans","Clean","400;500;600;700;800;900",1,"Grotesk with tall x-height, steady"],
    ["Roboto","Clean","400;500;600;700;800;900",1,"Mechanical skeleton with open curves"],
    ["Ubuntu","Clean","400;500;700",1,"Curved stroke ends, distinctive and warm"],
    ["Josefin Sans","Clean","400;500;600;700",1,"Vintage geometric, low middle bars"],
    ["Raleway","Clean","400;500;600;700;800;900",1,"Elegant thin-to-heavy sans, fancy w"],
    ["Be Vietnam Pro","Clean","400;500;600;700;800;900",1,"Neo-grotesk with crisp diacritics"],
    ["Syne","Clean","400;500;600;700;800",0,"Gets wider as it gets bolder, art-school feel"],
    ["DM Sans","Clean","400;500;600;700;800;900;1000",1,"Low contrast geometric, compact"],
    ["Red Hat Display","Clean","400;500;600;700;800;900",1,"Friendly brand sans with a big personality"],
    ["Fira Sans","Clean","400;500;600;700;800;900",1,"Humanist with a handwritten rhythm"],
    ["Anton","Condensed","400",0,"Tall and narrow, impact-style headlines"],
    ["Bebas Neue","Condensed","400",0,"All caps, clean and narrow"],
    ["Oswald","Condensed","400;500;600;700",0,"Classic gothic, condensed and sturdy"],
    ["Teko","Condensed","400;500;600;700",0,"Squared condensed, sporty"],
    ["Barlow Condensed","Condensed","400;500;600;700;800;900",1,"Rounded-rectangle condensed, Californian road signs"],
    ["Big Shoulders","Condensed","400;500;600;700;800;900",0,"Chicago-style ultra narrow capitals"],
    ["Staatliches","Condensed","400",0,"Hard-edged caps with a stencil feel"],
    ["Squada One","Condensed","400",0,"Square corners, techy and narrow"],
    ["League Gothic","Condensed","400",0,"Old wood type gothic, very narrow"],
    ["Saira Condensed","Condensed","400;500;600;700;800;900",0,"Squarish technical condensed"],
    ["Pathway Gothic One","Condensed","400",0,"Thin narrow gothic, editorial"],
    ["Six Caps","Condensed","400",0,"Extremely tall and thin capitals"],
    ["Fredoka","Rounded","400;500;600;700",0,"Big round terminals, bubbly"],
    ["Nunito","Rounded","400;500;600;700;800;900;1000",1,"Rounded sans that stays readable"],
    ["Baloo 2","Rounded","400;500;600;700;800",0,"Plump, heavy and cheerful"],
    ["Comfortaa","Rounded","400;500;600;700",0,"Thin rounded geometry, soft and light"],
    ["Quicksand","Rounded","400;500;600;700",0,"Rounded geometric, gentle"],
    ["M PLUS Rounded 1c","Rounded","400;500;700;800;900",0,"Rounded with Japanese support"],
    ["Mochiy Pop One","Rounded","400",0,"Pop Japanese style, chubby"],
    ["Zen Maru Gothic","Rounded","400;500;700;900",0,"Calm rounded Japanese gothic"],
    ["Dosis","Rounded","400;500;600;700;800",0,"Narrow rounded, slightly technical"],
    ["Varela Round","Rounded","400",0,"Simple rounded, minimal"],
    ["Bangers","Comic","400",0,"Comic-book shouting caps"],
    ["Luckiest Guy","Comic","400",0,"Fat cartoon letters"],
    ["Lilita One","Comic","400",0,"Heavy and friendly, game-title style"],
    ["Chewy","Comic","400",0,"Bouncy, like stretched gum"],
    ["Bubblegum Sans","Comic","400",0,"Playful and uneven"],
    ["Boogaloo","Comic","400",0,"Retro cartoon, wobbly"],
    ["Spicy Rice","Comic","400",0,"Fat with pointy ends"],
    ["Sniglet","Comic","400;800",0,"Round and chunky for kids"],
    ["Londrina Solid","Comic","400;900",0,"Hand-cut, slightly rough capitals"],
    ["Bungee","Comic","400",0,"Vertical-sign style, built for signage"],
    ["Rammetto One","Comic","400",0,"Ultra fat and round"],
    ["Coiny","Comic","400",0,"Round letters like coins"],
    ["Bungee Shade","Comic","400",0,"Bungee with a built-in 3D shade"],
    ["Permanent Marker","Handwritten","400",0,"Fat felt-tip marker"],
    ["Caveat","Handwritten","400;500;600;700",0,"Quick casual handwriting"],
    ["Pacifico","Handwritten","400",0,"Surf-style brush script"],
    ["Kalam","Handwritten","400;700",0,"Neat pen handwriting"],
    ["Patrick Hand","Handwritten","400",0,"Tidy print handwriting"],
    ["Shadows Into Light","Handwritten","400",0,"Light, airy handwriting"],
    ["Amatic SC","Handwritten","400;700",0,"Narrow hand-drawn capitals"],
    ["Rock Salt","Handwritten","400",0,"Rough, scratchy marker"],
    ["Gloria Hallelujah","Handwritten","400",0,"Comic handwriting, loose"],
    ["Indie Flower","Handwritten","400",0,"Bubbly round handwriting"],
    ["Kaushan Script","Handwritten","400",0,"Bold brush script with energy"],
    ["Gochi Hand","Handwritten","400",0,"Chunky schoolbook marker"],
    ["Covered By Your Grace","Handwritten","400",0,"Tall loose handwriting"],
    ["Architects Daughter","Handwritten","400",0,"Blueprint lettering by hand"],
    ["Sedgwick Ave Display","Handwritten","400",0,"Graffiti tag lettering"],
    ["Itim","Handwritten","400",0,"Casual hand, also writes Thai"],
    ["Playfair Display","Serif","400;500;600;700;800;900",1,"High-contrast editorial serif"],
    ["DM Serif Display","Serif","400",1,"Chunky display serif, magazine cover"],
    ["Cinzel","Serif","400;500;600;700;800;900",0,"Roman inscription capitals"],
    ["Abril Fatface","Serif","400",0,"Very heavy Didone, fashion headlines"],
    ["Merriweather","Serif","400;500;600;700;800;900",1,"Sturdy screen serif"],
    ["Lora","Serif","400;500;600;700",1,"Calligraphic serif, gentle"],
    ["Roboto Slab","Serif","400;500;600;700;800;900",0,"Mechanical slab serif"],
    ["Zilla Slab","Serif","400;500;600;700",1,"Slab with a contemporary edge"],
    ["Arvo","Serif","400;700",1,"Geometric slab, typewriter cousin"],
    ["Bitter","Serif","400;500;600;700;800;900",1,"Compact slab, very readable"],
    ["Libre Baskerville","Serif","400;500;600;700",1,"Classic book serif"],
    ["Fraunces","Serif","400;500;600;700;800;900",1,"Soft, wonky old-style display serif"],
    ["Ultra","Serif","400",0,"Fat-face slab, Western poster"],
    ["Bevan","Serif","400",1,"Heavy slab with ball ends"],
    ["Space Mono","Retro and tech","400;700",1,"Geometric monospace"],
    ["Courier Prime","Retro and tech","400;700",1,"Typewriter, screenplay feel"],
    ["Press Start 2P","Retro and tech","400",0,"8-bit arcade pixels"],
    ["Russo One","Retro and tech","400",0,"Bold squared tech"],
    ["Black Ops One","Retro and tech","400",0,"Military stencil"],
    ["Righteous","Retro and tech","400",0,"Art deco, futurist 70s"],
    ["Orbitron","Retro and tech","400;500;600;700;800;900",0,"Sci-fi geometric"],
    ["Audiowide","Retro and tech","400",0,"Wide racing tech"],
    ["VT323","Retro and tech","400",0,"Old terminal screen"],
    ["Silkscreen","Retro and tech","400;700",0,"Tiny crisp pixel font"],
    ["Share Tech Mono","Retro and tech","400",0,"Technical monospace, HUD style"],
    ["Chakra Petch","Retro and tech","400;500;600;700",1,"Cut corners, tech, also writes Thai"],
    ["Oxanium","Retro and tech","400;500;600;700;800",0,"Angular futuristic sans"],
    ["Exo 2","Retro and tech","400;500;600;700;800;900",1,"Futuristic with soft geometry"],
    ["Michroma","Retro and tech","400",0,"Wide square, space-age"],
    ["Racing Sans One","Retro and tech","400",0,"Italic speed lettering"],
    ["Graduate","Retro and tech","400",0,"College varsity block"],
    ["Saira Stencil","Retro and tech","400;500;600;700;800;900",1,"Technical stencil"],
    ["Kanit","World","400;500;600;700;800;900",1,"Thai and Latin, loopless and modern"],
    ["Prompt","World","400;500;600;700;800;900",1,"Thai and Latin, geometric"],
    ["Mitr","World","400;500;600;700",0,"Thai and Latin, rounded and bold"],
    ["Sarabun","World","400;500;600;700;800",1,"Thai and Latin, plain and formal"],
    ["Mali","World","400;500;600;700",1,"Thai and Latin, handwritten feel"],
    ["Noto Sans Thai","World","400;500;600;700;800;900",0,"Thai with traditional loops"],
    ["Noto Sans JP","World","400;500;600;700;800;900",0,"Japanese gothic"],
    ["Dela Gothic One","World","400",0,"Japanese ultra-heavy display"],
    ["Noto Sans KR","World","400;500;600;700;800;900",0,"Korean gothic"],
    ["Black Han Sans","World","400",0,"Korean heavy headline"],
    ["Do Hyeon","World","400",0,"Korean geometric, quirky"],
    ["Noto Sans SC","World","400;500;600;700;800;900",0,"Simplified Chinese"],
    ["Cairo","World","400;500;600;700;800;900;1000",0,"Arabic and Latin, modern"],
    ["Tajawal","World","400;500;700;800;900",0,"Arabic and Latin, clean"],
    ["Alexandria","World","400;500;600;700;800;900",0,"Arabic and Latin, geometric heavy"],
    ["Hind","World","400;500;600;700",0,"Devanagari and Latin, clean"],
    ["Mukta","World","400;500;600;700;800",0,"Devanagari and Latin, open"],
    ["Noto Sans Hebrew","World","400;500;600;700;800;900",0,"Hebrew sans"]
  ];

  var TEXT = [
    ["Shrikhand","Display","400",0,"Fat italic with a retro swing"],
    ["Monoton","Display","400",0,"Neon-tube lines, art deco"],
    ["Fascinate","Display","400",0,"Deco fat face with sharp cuts"],
    ["Frijole","Display","400",0,"Rough, hand-cut chunky"],
    ["Bowlby One","Display","400",0,"Heavy poster with a grin"],
    ["Holtwood One SC","Display","400",0,"Wide wood-type slab capitals"],
    ["Faster One","Display","400",0,"Speed lines through every letter"],
    ["Rubik Glitch","Display","400",0,"Sliced and shifted, digital glitch"],
    ["Rubik Spray Paint","Display","400",0,"Sprayed with a can"],
    ["Rubik Wet Paint","Display","400",0,"Fresh paint dripping"],
    ["Rubik Puddles","Display","400",0,"Melting into puddles"],
    ["Rubik Moonrocks","Display","400",0,"Cratered like the moon"],
    ["Rubik Microbe","Display","400",0,"Wobbly microscope cells"],
    ["Bungee Spice","Display","400",0,"Built-in fire gradient"],
    ["Nabla","Display","400",0,"Colour isometric 3D blocks"],
    ["Honk","Display","400",0,"Colour 3D inflated letters"],
    ["Chicle","Display","400",0,"Narrow rounded retro"],
    ["Lemon","Display","400",0,"Fat, juicy, slightly uneven"],
    ["Bungee Outline","Outline and 3D","400",0,"Signage capitals, outline only"],
    ["Bungee Inline","Outline and 3D","400",0,"Signage capitals with a line through"],
    ["Bungee Hairline","Outline and 3D","400",0,"Signage capitals drawn in a hairline"],
    ["Rampart One","Outline and 3D","400",0,"Puffy 3D outline"],
    ["Train One","Outline and 3D","400",0,"Double-line outline"],
    ["Londrina Outline","Outline and 3D","400",0,"Hand-cut outline"],
    ["Londrina Sketch","Outline and 3D","400",0,"Hatched sketch fill"],
    ["Kumar One Outline","Outline and 3D","400",0,"Wide outline poster"],
    ["Tilt Prism","Outline and 3D","400",0,"Prism lines, tilted 3D"],
    ["Tilt Neon","Outline and 3D","400",0,"Soft neon tube, tilted"],
    ["Tilt Warp","Outline and 3D","400",0,"Warped 3D perspective"],
    ["Codystar","Outline and 3D","400",0,"Made of light-bulb dots"],
    ["Fascinate Inline","Outline and 3D","400",0,"Deco with an inline"],
    ["Bodoni Moda","Elegant serif","400;500;600;700;800;900",1,"Razor-thin hairlines, high fashion"],
    ["Cormorant Garamond","Elegant serif","400;500;600;700",1,"Delicate Garamond for display"],
    ["Prata","Elegant serif","400",0,"Didone with tear-drop ends"],
    ["Yeseva One","Elegant serif","400",0,"Feminine heavy serif"],
    ["Rozha One","Elegant serif","400",0,"Extreme contrast, Devanagari too"],
    ["Gloock","Elegant serif","400",0,"Sharp, bold contrast serif"],
    ["Young Serif","Elegant serif","400",0,"Heavy old-style, warm"],
    ["Instrument Serif","Elegant serif","400",1,"Condensed editorial serif"],
    ["Italiana","Elegant serif","400",0,"Thin Italian elegance"],
    ["Marcellus","Elegant serif","400",0,"Flared Roman capitals"],
    ["Cinzel Decorative","Elegant serif","400;700;900",0,"Roman capitals with flourishes"],
    ["EB Garamond","Elegant serif","400;500;600;700;800",1,"Classic Renaissance book type"],
    ["Old Standard TT","Elegant serif","400;700",1,"Late 1800s scientific type"],
    ["Gilda Display","Elegant serif","400",0,"Light, graceful display serif"],
    ["Spectral","Elegant serif","400;500;600;700;800",1,"Sharp, screen-first literary serif"],
    ["Great Vibes","Script","400",0,"Flowing formal calligraphy"],
    ["Dancing Script","Script","400;500;600;700",0,"Lively bouncing script"],
    ["Satisfy","Script","400",0,"Retro brush, sign-painter"],
    ["Yellowtail","Script","400",0,"1930s brush script"],
    ["Lobster","Script","400",0,"Bold connected script"],
    ["Courgette","Script","400",0,"Calm, medium-weight script"],
    ["Sacramento","Script","400",0,"Thin monoline script"],
    ["Alex Brush","Script","400",0,"Elegant brush calligraphy"],
    ["Allura","Script","400",0,"Soft formal script"],
    ["Parisienne","Script","400",0,"French casual script"],
    ["Pinyon Script","Script","400",0,"Copperplate engraving"],
    ["Tangerine","Script","400;700",0,"Narrow calligraphic italic"],
    ["Mr Dafoe","Script","400",0,"Fast signature brush"],
    ["Monsieur La Doulaise","Script","400",0,"Ornate swashes"],
    ["Cookie","Script","400",0,"Sweet rounded script"],
    ["Damion","Script","400",0,"Bold casual script"],
    ["Marck Script","Script","400",0,"Calligraphic pen, also Cyrillic"],
    ["Leckerli One","Script","400",0,"Heavy, friendly script"],
    ["Playball","Script","400",0,"Baseball jersey script"],
    ["Oleo Script","Script","400;700",0,"Thick rounded retro script"],
    ["Homemade Apple","Handwriting","400",0,"Real cursive handwriting"],
    ["Reenie Beanie","Handwriting","400",0,"Quick ballpoint scrawl"],
    ["Nothing You Could Do","Handwriting","400",0,"Slanted personal hand"],
    ["Just Another Hand","Handwriting","400",0,"Tall narrow marker"],
    ["Coming Soon","Handwriting","400",0,"Kid-like handwriting"],
    ["Schoolbell","Handwriting","400",0,"Chalkboard lettering"],
    ["Short Stack","Handwriting","400",0,"Short and friendly print"],
    ["Neucha","Handwriting","400",0,"Felt pen with Cyrillic"],
    ["Annie Use Your Telescope","Handwriting","400",0,"Loose, open handwriting"],
    ["Waiting for the Sunrise","Handwriting","400",0,"Thin, light handwriting"],
    ["Mansalva","Handwriting","400",0,"Dry brush marker"],
    ["Nanum Pen Script","Handwriting","400",0,"Korean pen handwriting"],
    ["Zeyada","Handwriting","400",0,"Fast, rough cursive"],
    ["Cedarville Cursive","Handwriting","400",0,"School cursive"],
    ["Delius","Handwriting","400",0,"Comic-style print"],
    ["Fontdiner Swanky","Fun","400",0,"50s diner sign"],
    ["Emilys Candy","Fun","400",0,"Candy-cane decorations"],
    ["Henny Penny","Fun","400",0,"Storybook, whimsical"],
    ["Margarine","Fun","400",0,"Soft, melting retro"],
    ["Sonsie One","Fun","400",0,"Swashy, flamboyant fat face"],
    ["Atomic Age","Fun","400",0,"Space-age 50s"],
    ["Cherry Bomb One","Fun","400",0,"Rounded Japanese pop"],
    ["Grandstander","Fun","400;500;600;700;800;900",1,"Bouncy kid's book"],
    ["Original Surfer","Fun","400",0,"Surf shop sign"],
    ["Ranchers","Fun","400",0,"Cartoon western"],
    ["Purple Purse","Fun","400",0,"Cute serif with curls"],
    ["Freckle Face","Fun","400",0,"Messy kid lettering"],
    ["Gorditas","Fun","400;700",0,"Chubby with inner lines"],
    ["Creepster","Horror and grunge","400",0,"Horror-movie drips"],
    ["Nosifer","Horror and grunge","400",0,"Blood dripping"],
    ["Eater","Horror and grunge","400",0,"Spiky and torn"],
    ["Metal Mania","Horror and grunge","400",0,"Heavy metal band logo"],
    ["Butcherman","Horror and grunge","400",0,"Hacked horror capitals"],
    ["New Rocker","Horror and grunge","400",0,"Rock blackletter"],
    ["Jolly Lodger","Horror and grunge","400",0,"Halloween, crooked"],
    ["Special Elite","Horror and grunge","400",0,"Worn typewriter ink"],
    ["Pirata One","Horror and grunge","400",0,"Pirate blackletter"],
    ["UnifrakturMaguntia","Horror and grunge","400",0,"True blackletter"],
    ["Grenze Gotisch","Horror and grunge","400;500;600;700;800;900",0,"Gothic hybrid, sharp"],
    ["Rubik Dirt","Horror and grunge","400",0,"Dirty, distressed"],
    ["Limelight","Vintage","400",0,"1920s Hollywood deco"],
    ["Poiret One","Vintage","400",0,"Thin art deco geometry"],
    ["Federo","Vintage","400",0,"Deco lettering with odd joins"],
    ["Rye","Vintage","400",0,"Wild West wanted poster"],
    ["Sancreek","Vintage","400",0,"Circus western"],
    ["Ewert","Vintage","400",0,"Ornamental western"],
    ["Smokum","Vintage","400",0,"Old West narrow slab"],
    ["Diplomata SC","Vintage","400",0,"Ultra-wide formal capitals"],
    ["Vast Shadow","Vintage","400",0,"Slab with a cast shadow"],
    ["Stint Ultra Expanded","Vintage","400",0,"Very wide old serif"],
    ["Bigshot One","Vintage","400",0,"Victorian poster"],
    ["Josefin Slab","Vintage","400;500;600;700",1,"Typewriter-era slab"],
    ["Kelly Slab","Vintage","400",0,"Squared Soviet-era slab"],
    ["Arbutus","Vintage","400",0,"Woodcut heavy slab"],
    ["Major Mono Display","Futuristic","400",0,"Mixed-case monospace oddity"],
    ["Tektur","Futuristic","400;500;600;700;800;900",0,"Sharp-cut tech"],
    ["Iceland","Futuristic","400",0,"Thin square, digital"],
    ["Turret Road","Futuristic","400;500;700;800",0,"Rounded sci-fi"],
    ["Jura","Futuristic","400;500;600;700",0,"Light technical, rounded corners"],
    ["Aldrich","Futuristic","400",0,"Squared, bright tech"],
    ["Quantico","Futuristic","400;700",1,"Military squared"],
    ["Wallpoet","Futuristic","400",0,"Stencil graffiti tech"],
    ["Syncopate","Futuristic","400;700",0,"Wide all-caps, airy"],
    ["Zen Dots","Futuristic","400",0,"Rounded dot-matrix feel"],
    ["Bruno Ace SC","Futuristic","400",0,"Wide sports-car capitals"],
    ["Nova Square","Futuristic","400",0,"Square sci-fi"],
    ["Sixtyfour","Futuristic","400",0,"Home computer scanlines"],
    ["Outfit","Modern","400;500;600;700;800;900",0,"Geometric brand sans"],
    ["Manrope","Modern","400;500;600;700;800",0,"Semi-condensed modern grotesk"],
    ["Plus Jakarta Sans","Modern","400;500;600;700;800",1,"Crisp, editorial modern"],
    ["Bricolage Grotesque","Modern","400;500;600;700;800",0,"Quirky optical grotesk"],
    ["Darker Grotesque","Modern","400;500;600;700;800;900",0,"Tight, dark display grotesk"],
    ["Epilogue","Modern","400;500;600;700;800;900",1,"Strong, slightly wide grotesk"],
    ["Familjen Grotesk","Modern","400;500;600;700",1,"Scandinavian quirky grotesk"],
    ["Gabarito","Modern","400;500;600;700;800;900",0,"Rounded geometric, fun weight"],
    ["Archivo","Modern","400;500;600;700;800;900",1,"Width-flexible grotesk"],
    ["Lalezar","World","400",0,"Arabic display, bold"],
    ["Reem Kufi","World","400;500;600;700",0,"Geometric Kufic Arabic"],
    ["Amiri","World","400;700",1,"Classical Arabic naskh"],
    ["Aref Ruqaa","World","400;700",0,"Arabic ruqaa calligraphy"],
    ["Rakkas","World","400",0,"Arabic heavy display"],
    ["Noto Serif JP","World","400;500;600;700;800;900",0,"Japanese mincho serif"],
    ["Reggae One","World","400",0,"Japanese playful heavy"],
    ["RocknRoll One","World","400",0,"Japanese rock rounded"],
    ["Yusei Magic","World","400",0,"Japanese marker"],
    ["Gugi","World","400",0,"Korean geometric display"],
    ["Jua","World","400",0,"Korean round friendly"],
    ["Nanum Brush Script","World","400",0,"Korean brush"],
    ["Charm","World","400;700",0,"Thai calligraphic script"],
    ["Chonburi","World","400",0,"Thai display serif"],
    ["Srisakdi","World","400;700",0,"Thai decorative"],
    ["Pridi","World","400;500;600;700",0,"Thai and Latin slab serif"],
    ["Athiti","World","400;500;600;700",0,"Thai and Latin soft sans"],
    ["Bai Jamjuree","World","400;500;600;700",1,"Thai and Latin squarish"],
    ["Noto Serif Thai","World","400;500;600;700;800;900",0,"Thai serif"],
    ["Yatra One","World","400",0,"Devanagari display"],
    ["Ma Shan Zheng","World","400",0,"Chinese brush calligraphy"],
    ["ZCOOL KuaiLe","World","400",0,"Chinese playful"],
    ["Zhi Mang Xing","World","400",0,"Chinese running hand"],
    ["Long Cang","World","400",0,"Chinese casual handwriting"]
  ];

  var BY = {};
  function index(list, kind) {
    list.forEach(function (r) {
      BY[r[0]] = { family: r[0], cat: r[1], weights: r[2].split(";").map(Number), italic: !!r[3], note: r[4], kind: kind };
    });
  }
  index(CAPTION, "caption");
  index(TEXT, "text");

  function groups(list) {
    var out = [];
    list.forEach(function (r) { if (out.indexOf(r[1]) < 0) out.push(r[1]); });
    return out;
  }

  // The heaviest weight the family has, at most `want`; its lightest if none is that light.
  function pick(family, want) {
    var f = BY[family];
    if (!f) return want || 400;
    var best = f.weights[0];
    f.weights.forEach(function (w) { if (w <= (want || 400) && w > best) best = w; });
    return best;
  }

  /* ─── Loading ───
     One stylesheet per family, weight and slant, added the first time
     something draws with it. load() resolves once a canvas can draw with it;
     until then the canvas falls back, and whenever one arrives every
     listener redraws. */
  var state = {}, listeners = [];
  function onLoad(fn) { listeners.push(fn); }
  function landed() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  function cssUrl(family, weight, italic) {
    var f = BY[family];
    var fam = "family=" + family.replace(/ /g, "+");
    if (!f) return "https://fonts.googleapis.com/css2?" + fam + "&display=swap";
    var w = pick(family, weight);
    var axis = italic && f.italic ? ":ital,wght@1," + w : ":wght@" + w;
    return "https://fonts.googleapis.com/css2?" + fam + axis + "&display=swap";
  }

  function ready(family, weight, italic) {
    return state[key(family, weight, italic)] === "ok";
  }
  function key(family, weight, italic) {
    return (italic && BY[family] && BY[family].italic ? "i" : "") + pick(family, weight) + " " + family;
  }

  function load(family, weight, italic) {
    if (!family || typeof document === "undefined" || !document.fonts) return Promise.resolve(true);
    if (!BY[family]) return Promise.resolve(true);   // a font of the person's own, or a system one
    var k = key(family, weight, italic);
    if (state[k] === "ok") return Promise.resolve(true);
    if (state[k] && state[k].then) return state[k];
    var w = pick(family, weight), it = italic && BY[family].italic;
    var p = new Promise(function (resolve) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = cssUrl(family, w, it);
      link.onload = function () { resolve(true); };
      link.onerror = function () { resolve(false); };
      document.head.appendChild(link);
    }).then(function (ok) {
      if (!ok) return false;
      return document.fonts.load((it ? "italic " : "") + w + ' 48px "' + family + '"', "Ag").then(function (list) {
        return !!(list && list.length);
      });
    }).catch(function () { return false; }).then(function (ok) {
      state[k] = "ok";      // drawn either way: in the font, or in the fallback
      landed();
      return ok;
    });
    state[k] = p;
    return p;
  }

  /* ─── Previews ───
     The picker writes each name in its own font. Fetching every whole font
     for that would be megabytes, so it asks Google for files holding only
     the letters of the names, and renames those faces ("vcpv Family") so
     they can never stand in for the real font on a caption or in an export. */
  var previewed = {};
  function previewFamily(family) { return "vcpv " + family; }
  function preview(families) {
    if (typeof document === "undefined" || typeof fetch === "undefined") return Promise.resolve();
    var todo = families.filter(function (f) { return BY[f] && !previewed[f]; });
    var jobs = [];
    for (var i = 0; i < todo.length; i += 24) {
      (function (chunk) {
        chunk.forEach(function (f) { previewed[f] = true; });
        var chars = {};
        chunk.forEach(function (f) { f.split("").forEach(function (c) { chars[c] = 1; }); });
        var fams = chunk.map(function (f) {
          var info = BY[f];
          return "family=" + f.replace(/ /g, "+") + ":wght@" + pick(f, info.kind === "caption" ? 700 : 400);
        }).join("&");
        var url = "https://fonts.googleapis.com/css2?" + fams + "&text=" + encodeURIComponent(Object.keys(chars).join("")) + "&display=swap";
        jobs.push(fetch(url).then(function (r) { return r.ok ? r.text() : ""; }).then(function (css) {
          if (!css) { chunk.forEach(function (f) { previewed[f] = false; }); return; }
          var st = document.createElement("style");
          st.textContent = css.replace(/font-family:\s*'([^']+)'/g, function (m, name) { return "font-family: '" + previewFamily(name) + "'"; });
          document.head.appendChild(st);
        }).catch(function () { chunk.forEach(function (f) { previewed[f] = false; }); }));
      })(todo.slice(i, i + 24));
    }
    return Promise.all(jobs);
  }

  /* ─── The picker ───
     One sheet for both libraries. kind: "caption" | "text". extra: rows to
     put first, as {value, label} (the style's own font, your own fonts). */
  function openPicker(opts) {
    if (typeof document === "undefined") return;
    var list = opts.kind === "caption" ? CAPTION : TEXT;
    var old = document.getElementById("fontPicker");
    if (old) old.remove();

    var wrap = document.createElement("div");
    wrap.id = "fontPicker";
    wrap.className = "fp-wrap";
    wrap.innerHTML =
      '<div class="fp-sheet" role="dialog" aria-modal="true" aria-label="Fonts">' +
        '<div class="fp-head"><h3></h3><span class="fp-count"></span><button class="fp-close" type="button" aria-label="Close">✕</button></div>' +
        '<input class="fp-search" type="search" placeholder="Search fonts" aria-label="Search fonts" />' +
        '<div class="fp-cats" role="tablist"></div>' +
        '<div class="fp-grid"></div>' +
      "</div>";
    wrap.querySelector("h3").textContent = opts.kind === "caption" ? "Caption fonts" : "Text fonts";
    var grid = wrap.querySelector(".fp-grid"), cats = wrap.querySelector(".fp-cats"), search = wrap.querySelector(".fp-search");
    var cat = "All";

    function close() {
      wrap.remove();
      document.removeEventListener("keydown", onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    wrap.querySelector(".fp-close").addEventListener("click", close);

    function tile(value, label, family, note, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "fp-tile" + (cls ? " " + cls : "") + (value === (opts.value || "") ? " selected" : "");
      var name = document.createElement("span");
      name.className = "fp-name";
      name.textContent = label;
      if (family) name.style.fontFamily = "'" + family + "', system-ui, sans-serif";
      b.appendChild(name);
      if (note) {
        var n = document.createElement("small");
        n.textContent = note;
        b.appendChild(n);
      }
      b.title = note || label;
      b.addEventListener("click", function () {
        opts.onPick(value);
        close();
      });
      return b;
    }

    function render() {
      grid.innerHTML = "";
      var q = search.value.trim().toLowerCase();
      if (!q && cat === "All") (opts.extra || []).forEach(function (x) {
        grid.appendChild(tile(x.value, x.label, x.family || null, x.note || "", "fp-extra"));
      });
      var shown = list.filter(function (r) {
        if (cat !== "All" && r[1] !== cat) return false;
        return !q || r[0].toLowerCase().indexOf(q) >= 0 || r[1].toLowerCase().indexOf(q) >= 0 || r[4].toLowerCase().indexOf(q) >= 0;
      });
      shown.forEach(function (r) { grid.appendChild(tile(r[0], r[0], previewFamily(r[0]) + "', '" + r[0], r[4])); });
      if (!shown.length) {
        var none = document.createElement("p");
        none.className = "fp-none";
        none.textContent = "No font matches that.";
        grid.appendChild(none);
      }
      wrap.querySelector(".fp-count").textContent = shown.length + (shown.length === 1 ? " font" : " fonts");
      cats.querySelectorAll("button").forEach(function (b) { b.classList.toggle("selected", b.dataset.cat === cat); });
      preview(shown.map(function (r) { return r[0]; }));
    }

    ["All"].concat(groups(list)).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip fp-cat";
      b.dataset.cat = c;
      b.textContent = c;
      b.addEventListener("click", function () { cat = c; render(); });
      cats.appendChild(b);
    });
    search.addEventListener("input", render);
    document.body.appendChild(wrap);
    render();
    var sel = grid.querySelector(".selected");
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "center" });
  }

  global.SenotelFonts = {
    CAPTION: CAPTION,
    TEXT: TEXT,
    // [family, "w;w;w"] for every family in both libraries (caption-tools.js FONTS)
    ALL: CAPTION.concat(TEXT).map(function (r) { return [r[0], r[2]]; }),
    info: function (family) { return BY[family] || null; },
    groups: groups,
    pick: pick,
    load: load,
    ready: ready,
    onLoad: onLoad,
    preview: preview,
    previewFamily: previewFamily,
    openPicker: openPicker
  };
})(typeof window !== "undefined" ? window : globalThis);
