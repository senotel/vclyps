/* ═══════════════════════════════════════════════════════════════════════════
   vClyps — emoji intelligence
   The editing app by Vevris.

   Captions carry emojis the way a good editor uses them: rarely, and only when
   the emoji says something the words did not. That needs more than a
   word→emoji lookup, because the words that matter most are the ambiguous
   ones. "Watch" is a wrist clock and also an instruction to look. "Sick" is
   an illness and also a compliment. "Fire" is a hazard and also the highest
   praise in short-form. A lookup table gets these wrong roughly half the time,
   and a wrong emoji is worse than none — it tells the viewer the editor was
   not paying attention.

   So every entry carries four things:

     e    the emoji
     n    its name
     w    TRIGGERS — words that can summon it at all
     ctx  CONTEXT — words that, appearing anywhere nearby, argue FOR it
     no   VETOES  — words that argue against it, hard

   Scoring a phrase is then a small argument between entries that share a
   trigger. "watch" alone summons both ⌚ and 👀; "watch this" hands it to 👀
   on context, while "my watch says we're late" hands it to ⌚ and vetoes 👀.
   Nothing wins by default: an entry has to clear a threshold, and most
   phrases correctly receive no emoji at all.

   Context is drawn from the NEIGHBOURING cues, not just the current one —
   three words on screen is rarely enough to disambiguate, but the sentence
   around them usually is.

   Exposes window.VevrisEmoji. Pure data + scoring; no network, no build step.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  "use strict";

  /* ═══════════ TUNING ═══════════ */

  var CFG = {
    triggerScore: 10,      // a trigger word matched at all
    uniqueBonus: 5,        // trigger claimed by ONE emoji only — nothing to disambiguate
    phraseBonus: 6,        // multi-word trigger ("shut up", "no way") — far less ambiguous
    ctxBonus: 3.2,         // each supporting context word found nearby
    ctxCap: 4,             // stop counting context after this many
    vetoPenalty: 9,        // each opposing word found nearby
    minScore: 13,          // below this, emit nothing — silence is the default
    minLead: 2.5,          // winner must beat the runner-up by this, or it is too close to call
    spacing: 3,            // at least this many cues between emojis
    repeatGap: 10,         // do not reuse the same emoji within this many cues
    maxDensity: 0.22       // never emoji more than this share of the cues
  };

  /* ═══════════ CORPUS ═══════════
     [emoji, name, triggers, context, vetoes] — space separated, parsed once.
     Use _ inside a trigger for a multi-word phrase: no_way -> "no way".
     Triggers are matched on stems, so "laughing" hits "laugh".              */

  var RAW = [
    /* ── reactions & emotion: the workhorses of short-form ── */
    ["😂","joy","laugh lol lmao hilarious funny comedy joke humour humor giggle chuckle crackup dying wheeze","funny joke laugh comedy stop cant hilarious tears","serious sad grief tragedy funeral"],
    ["😭","sobbing","sob bawl weeping tears heartbroken devastated emotional ugly_cry","cry tears emotional heartbreak miss lost gone beautiful cant","laugh joke funny"],
    ["🥹","holding back tears","touched moved proud emotional bittersweet grateful","proud happy love family thank finally emotional","angry hate gross"],
    ["😍","heart eyes","gorgeous stunning beautiful adorable obsessed crush smitten lovely","love beautiful want need perfect gorgeous cute","hate ugly gross disgusting"],
    ["🥰","smiling with hearts","affection sweet wholesome cherish adore","love sweet cute family thank kind warm","hate angry gross"],
    ["😱","screaming","shocked terrified horror scream gasp","cant believe shocked scary happened suddenly wait what","calm boring relaxed"],
    ["😳","flushed","awkward embarrassed flustered caught blushing","embarrassed awkward front everyone caught oh no","angry proud"],
    ["🤯","mind blown","mindblown blown speechless staggering unbelievable crazy insane wild unreal nuts","cant believe realise realize whole time never knew wait","boring obvious expected"],
    ["😤","triumph","determined fired_up frustrated huffing","determined enough done finally push through","calm relaxed sleepy"],
    ["😅","nervous laugh","awkward relieved barely close_call phew easy simple","almost nearly barely close somehow lucky oops","confident easy certain"],
    ["🙃","upside down","ironic sarcastic whatever fine_i_guess","fine great sure whatever anyway of course typical","serious sincere"],
    ["😏","smirk","smug sly knowing cheeky teasing","knew exactly course wait see told","sad angry confused"],
    ["🤔","thinking","wondering pondering hmm curious question considering suspicious","why how what wonder maybe question think reason","certain obvious sure"],
    ["😬","grimace","cringe yikes awkward tense oof uncomfortable","awkward bad wrong oh no mistake worse","great perfect lovely"],
    ["😴","sleeping","asleep sleepy tired exhausted nap drowsy snooze bored","tired sleep bed night early late boring long","awake energy excited"],
    ["🤢","nauseated","gross disgusting nasty revolting vile ill sick queasy","gross disgusting smell taste threw bad rotten stomach flu doctor bed off","awesome amazing insane trick unreal goes hard best"],
    ["🥶","cold","cold freezing frozen chilly shivering icy cool","winter snow ice freezing degrees outside jacket heating shiver","hot warm summer awesome confident style calm"],
    ["🥵","hot face","sweltering boiling overheated sweating hot boiling","hot summer heat sun degrees sweat","cold winter ice"],
    ["😎","cool","cool confident smooth effortless slick badass swagger","confident easy smooth style boss calm unbothered like_a_boss","cold temperature freezing weather jacket snow winter"],
    ["🙄","eye roll","annoyed unimpressed obviously seriously ugh","again seriously course obviously whatever typical","excited grateful"],
    ["😠","angry","mad furious annoyed irritated rage livid hate hating annoyed","angry mad furious hate rage stop unfair","happy calm love"],
    ["🫠","melting","overwhelmed dissolving done_for cope","too much overwhelmed cant handle stress deadline","calm easy simple"],
    ["🤡","clown","fool foolish joke_on_me embarrassing_myself","stupid mistake fool myself thought again","serious wise smart"],
    ["💀","skull","dead dying deceased died fatal","dead dying cant literally stop killed me","alive healthy birth battery charge phone watch charger percent"],
    ["👻","ghost","haunted spooky spirit phantom ghosted","haunted spooky halloween scary night disappeared","warm friendly"],

    /* ── emphasis: what actually gets used on hooks ── */
    ["🔥","fire","fire flame burning lit blaze inferno amazing incredible awesome banger sick","hot burn flame amazing incredible best insane crazy good trick goes hard unreal","cold wet extinguish freezing water rain safety ill vomit doctor flu"],
    ["💯","hundred","perfect flawless absolutely totally facts truth agreed full_marks","agree true facts absolutely perfect exactly right","wrong false partly maybe doubt"],
    ["✨","sparkles","magic magical shine shimmer glow special aesthetic transformation","magic special beautiful transform new fresh glow clean","dull boring dirty"],
    ["⚡","lightning","fast instant rapid electric power surge bolt quick zap","fast quick instant speed power energy seconds","slow gradual patient"],
    ["🚨","siren","alert warning emergency urgent attention breaking","warning alert urgent emergency attention important stop","calm routine normal"],
    ["❗","exclamation","important urgent critical crucial vital emphasise emphasize","important critical must never remember warning","trivial minor optional"],
    ["👀","eyes","look watch see stare peek notice observe spot glance spotted watching","look see this closely notice spot behind there caught watching camera","time clock hour wrist minute oclock deadline schedule blind"],
    ["🎯","bullseye","target goal precise accurate exactly nailed spot_on aim","exactly right goal target accurate precise nailed","miss wrong random vague"],
    ["🏆","trophy","win won winner champion victory first_place title","win won champion best victory beat competition first","lose lost defeat last"],
    ["🥇","gold medal","first best number_one gold top_spot","first best won top beat ranked","second third last lose"],
    ["👑","crown","king queen royal royalty reign monarch","king queen royal best top rule crown throne","peasant common lowly"],
    ["💎","gem","diamond gem jewel precious luxury rare valuable","expensive rare valuable luxury precious quality worth","cheap common worthless plastic"],

    /* ── gestures & hands ── */
    ["👍","thumbs up","approve agree yes good nice like great nice fine solid decent better improved improvement","good agree yes approve nice fine works well","bad no disagree terrible"],
    ["👎","thumbs down","disapprove reject nope bad dislike terrible awful rubbish trash_bad poor worst worse","bad no reject disagree terrible awful worst","good yes agree great"],
    ["👏","clap","applause applaud bravo congratulations well_done praise","congratulations well done proud achievement finally deserve","boo fail terrible"],
    ["🙌","raised hands","celebrate hooray praise yes_finally relief","finally celebrate yes relief made_it together thank","fail sad lost"],
    ["🤝","handshake","deal agreement partnership together collaborate teamwork","deal agree partner together team collaborate business","alone solo fight argue"],
    ["👉","pointing","point there this_one direction indicate","this here look there that one below","away back behind"],
    ["💪","flex","strong strength muscle power tough fitness gym workout try trying effort push strength","strong gym workout train muscle lift power tough","weak tired frail give_up"],
    ["🙏","pray","please thanks thank grateful blessing hope beg pray sorry apologise apologize thanks thank","please thank grateful hope blessing bless sorry","demand refuse never"],
    ["🫵","pointing at viewer","you yourself your_turn","you your yourself listen watching this_is_for","them they others"],
    ["✋","stop hand","stop halt hold_on pause","stop wait hold pause dont before","go continue faster"],

    /* ── time: the classic ambiguity ── */
    /* "look" is deliberately NOT a veto here — "look at the time" is clock
       context, and vetoing on it lost the obvious case. The vetoes below are
       words that only ever mean the other sense of watch. */
    ["⌚","watch","watch wristwatch timepiece time late hour minute oclock","time hour minute second oclock late early deadline schedule wrist strap tick waiting minutes","observe stare netflix movie show episode guard careful footage"],
    ["⏰","alarm clock","alarm wakeup morning_alarm oversleep","morning wake early late alarm bed hour time snooze","night dream watch_this look"],
    ["⏳","hourglass","waiting patience running_out time_left countdown wait waiting","wait time left running out patience soon remaining until","instant immediate now already"],
    ["⏱","stopwatch","timer stopwatch seconds timed speedrun","seconds fast record time speed quick minutes challenge","slow forever leisurely"],
    ["📅","calendar","date schedule appointment booking day month year deadline today tomorrow yesterday week weekend","day week month year schedule plan book appointment monday friday","romantic dinner love crush partner"],
    ["🗓","spiral calendar","planner agenda diary","plan week schedule organise organize month ahead","spontaneous random"],

    /* ── weather & nature ── */
    ["☀️","sun","sunny sunshine daylight bright clear_sky summer sunny sunshine","sunny warm summer beach outside sky day hot","rain cloud night dark storm"],
    ["🌙","moon","night nighttime moonlight lunar evening","night late sleep dark evening stars sky","day morning sun bright"],
    ["⭐","star","star starry","night sky wish shine space constellation","celebrity famous rating review"],
    ["🌟","glowing star","standout shining_star outstanding remarkable","best standout amazing shine talent special outstanding","dim ordinary average"],
    ["🌈","rainbow","colourful colorful spectrum pride hopeful","colour color after rain hope bright pride beautiful","grey gray dull monochrome"],
    ["☁️","cloud","cloudy overcast grey_sky weather forecast","sky weather overcast dull grey gray cover","sunny clear bright"],
    ["🌧","rain","rain raining rainy downpour drizzle wet shower","wet umbrella weather outside grey cold soaked","dry sunny desert"],
    ["⛈","storm","storm thunder lightning_storm thunderstorm tempest","thunder storm loud weather dangerous shelter","calm clear peaceful"],
    ["❄️","snowflake","snow snowing winter frost blizzard","cold winter white freeze ski mountain december","hot summer beach"],
    ["🌊","wave","wave waves ocean sea surf tide swell","sea beach surf swim water boat coast salt crash","hello goodbye hand greeting bye hi waved_at"],
    ["👋","waving","wave waving hello goodbye greeting bye hi farewell","hello goodbye hi bye greet hand meet leave arrive introduce","ocean sea surf water beach tide swim crash"],
    ["🌸","blossom","flower bloom spring cherry_blossom petal","spring flower garden pink bloom pretty nature","winter snow dead"],
    ["🍀","clover","luck lucky fortune charm","lucky luck chance fortune win irish","unlucky doomed"],
    ["🌲","tree","forest woods pine wilderness nature","forest hike nature outdoors wood camp mountain","city concrete indoors"],
    ["🍂","fallen leaves","autumn fall foliage","autumn fall october leaves season orange cosy","spring summer bloom"],
    ["🌍","earth","world global planet earth international worldwide","world global planet everyone country international travel","local personal small"],

    /* ── animals ── */
    ["🐶","dog","dog puppy pup doggy hound canine","pet walk bark tail good_boy adopt vet fetch loyal","cat meow bird fish"],
    ["🐱","cat","cat kitten kitty feline","pet purr meow whiskers litter scratch nap","dog bark puppy"],
    ["🐭","mouse","mouse mice rodent","tiny small squeak hole cheese trap pet","click cursor computer laptop keyboard screen"],
    ["🖱","computer mouse","mouse cursor click clicking pointer","click computer laptop screen desk cursor drag scroll button","animal cheese squeak pet tail hole tiny trap"],
    ["🐰","rabbit","rabbit bunny hare","hop carrot ears pet easter fluffy","predator wolf"],
    ["🐸","frog","frog toad amphibian","pond green jump ribbit lily water","desert dry"],
    ["🐝","bee","bee bumblebee wasp hive","honey sting buzz flower pollen busy garden","fish ocean"],
    ["🦋","butterfly","butterfly moth","transform beautiful wings garden flower change delicate","heavy solid"],
    ["🐍","snake","snake serpent python cobra viper","slither venom bite reptile grass scale hiss","code programming script language developer"],
    ["🐢","turtle","turtle tortoise slow slowly sluggish","slow shell beach ocean patient steady","fast quick rapid"],
    ["🦖","dinosaur","dinosaur trex dino prehistoric extinct","extinct ancient prehistoric fossil million museum","modern present current"],
    ["🦈","shark","shark","ocean teeth danger fin swim deep attack","harmless gentle"],
    ["🐴","horse","horse pony stallion mare","ride farm gallop saddle race stable","car engine"],
    ["🦄","unicorn","unicorn mythical","magic rare fantasy impossible special dream","real ordinary common"],
    ["🐔","chicken","chicken hen rooster","farm egg cluck coop feather","wild ocean"],
    ["🐘","elephant","elephant tusk big huge massive enormous giant","huge memory africa trunk large gentle","tiny small"],
    ["🦅","eagle","eagle hawk falcon raptor","sky soar hunt talons freedom high","ground crawl"],
    ["⚾","baseball","bat baseball softball pitching innings homerun","swing swung hit ball pitch field stadium inning base team fence dugout","cave night fly wing vampire nocturnal halloween"],

    /* ── food & drink ── */
    ["🍕","pizza","pizza slice pepperoni margherita","cheese slice italian delivery dough oven friday takeaway","healthy salad diet"],
    ["🍔","burger","burger hamburger cheeseburger patty","fries beef bun grill fast_food meal","salad vegan light"],
    ["🍟","fries","fries chips french_fries","salt burger ketchup fast_food side crispy","healthy salad"],
    ["🌮","taco","taco burrito quesadilla","mexican salsa tuesday spicy filling wrap","sushi pasta"],
    ["🍣","sushi","sushi sashimi maki nigiri","japanese rice raw fish soy roll","burger pizza"],
    ["🍜","noodles","noodle ramen pho udon soup","broth hot bowl slurp japanese warm comfort","cold dry"],
    ["🍝","pasta","pasta spaghetti carbonara linguine","italian sauce tomato boil parmesan dinner","asian rice"],
    ["🥗","salad","salad greens lettuce","healthy fresh vegetable diet light lunch","burger fried greasy"],
    ["🍞","bread","bread loaf toast sourdough baking","bake oven flour yeast butter fresh crust","meat drink"],
    ["🧀","cheese","cheese cheddar brie parmesan","milk dairy melt board wine sandwich","vegan dairy_free"],
    ["🥚","egg","egg eggs yolk","breakfast fry boil scramble shell protein","dessert sweet"],
    ["🍳","cooking","cook cooking fry frying pan skillet breakfast","kitchen pan heat recipe chef breakfast oil","raw cold"],
    ["🍎","apple","apple","fruit red healthy orchard bite crunchy tree","phone iphone mac computer laptop brand company"],
    ["🍌","banana","banana","fruit yellow peel potassium smoothie tropical","electronic device"],
    ["🍓","strawberry","strawberry","fruit red sweet summer berry cream","savoury savory meat"],
    ["🍉","watermelon","watermelon melon","summer fruit juicy seed slice picnic","winter warm"],
    ["🍇","grapes","grape grapes vineyard","fruit wine vine bunch purple sweet","meat savoury"],
    ["🥑","avocado","avocado guacamole","toast healthy fat green brunch ripe","junk processed"],
    ["🌶","chilli","chilli chili pepper spicy hot_sauce jalapeno","spicy hot burn heat sauce tongue","mild bland sweet"],
    ["🍫","chocolate","chocolate cocoa choc","sweet dessert bar cocoa treat craving","savoury savory bitter_greens"],
    ["🍪","cookie","cookie biscuit","bake sweet dough chip treat oven","savoury main"],
    ["🎂","birthday cake","birthday cake candles bday","birthday celebrate candles wish year old party","funeral sad"],
    ["🍰","cake","cake slice dessert gateau","sweet dessert bake celebrate cream","savoury main"],
    ["🍦","ice cream","icecream gelato sundae cone","cold sweet summer scoop melt treat","hot soup"],
    ["☕","coffee","coffee espresso latte cappuccino brew caffeine","morning cup wake caffeine cafe break tired work","night sleep alcohol"],
    ["🍵","tea","tea matcha chai brew_tea","cup calm warm leaf morning break","coffee espresso alcohol"],
    ["🍺","beer","beer pint lager ale brew_beer","pub bar drink friday night cheers cold","coffee morning work"],
    ["🍷","wine","wine merlot cabernet vino","glass dinner red white bottle cheers celebrate","morning breakfast child"],
    ["🥤","soda","soda cola drink_cup soft_drink fizzy drink drinking thirsty sip","cup straw sugar cold fizz","alcohol hot"],
    ["💧","droplet","water drop hydrate thirsty liquid","water drink hydrate thirst wet drop clear","dry desert fire"],

    /* ── objects & tech ── */
    ["📱","phone","phone smartphone mobile iphone android app apps application","screen app scroll call text tap notification battery","landline telegram"],
    ["💻","laptop","laptop computer macbook pc","work screen type code office desk keyboard","phone mobile"],
    ["📷","camera","camera photo photography snapshot picture shoot lens","photo shoot picture lens capture film frame","audio sound music"],
    ["🎥","movie camera","filming film footage recording shooting videography video footage clip recording","film shoot footage record scene take camera clip","photo still audio"],
    ["🎬","clapper","action cut scene take director filmmaking movie","scene take director action cut film set shot","photo audio music"],
    ["🎤","microphone","mic microphone singing karaoke vocals podcast","sing song voice stage podcast record speak","silent mute"],
    ["🎧","headphones","headphones earphones earbuds listening","music listen sound audio playlist volume","silent visual"],
    ["🎵","music","music song tune melody audio track","song music listen sound tune sing playlist","silence quiet visual"],
    ["🎸","guitar","guitar riff strumming band rock_music bass_guitar","band song play strings rock chord stage","fish water classical_piano"],
    ["📺","tv","television tv show series binge","watch show series binge screen episode netflix channel","wrist time clock"],
    ["🔋","battery","battery charge power_level","charge power percent dying low plug energy","empty_unrelated"],
    ["💡","idea","idea lightbulb realise realize insight brainwave inspiration lamp light","idea think realise realize solution suddenly clever bright brain lamp bulb switch room dark","heavy weigh carry pounds kilos luggage feather backpack"],
    ["🪶","feather","feather weightless lightweight light","carry weigh heavy bag barely luggage pounds kilos backpack pack","idea think solution lamp bulb switch bright room dark realise realize"],
    ["🔑","key","key unlock keys","unlock door lock access secret open essential","piano musical_key"],
    ["🔒","lock","locked secure private encrypted","secure private safe protect password locked access","open public exposed"],
    ["🔍","magnifier","search searching find look_for investigate detail examine","find search detail investigate look closer discover evidence","hide ignore"],
    ["📦","package","package parcel box delivery shipping","delivery arrive order ship box mail unbox","digital download"],
    ["✉️","envelope","letter mail message inbox","send receive mail inbox reply write message","call voice"],
    ["📝","memo","note notes writing write list jotting","write note list plan draft record remember","erase delete"],
    ["📚","books","book books reading library novel","read study library page chapter learn author","video film"],
    ["✏️","pencil","pencil draw sketch drawing","draw sketch write paper art design line","paint digital"],
    ["💊","pill","pill medicine tablet medication drug","doctor medicine health prescription take pain treat","food candy"],
    ["🩹","bandage","bandage plaster injury bandaid wound","hurt injury heal cut blood pain fix","healthy fine"],
    ["🧼","soap","soap wash cleaning hygiene scrub","clean wash hand hygiene bath dirt","dirty mess"],
    ["🛏","bed","bed bedroom mattress sleeping_place room bedroom","sleep night rest bedroom tired lie nap","work office outdoors"],
    ["🚪","door","door doorway entrance exit","open close enter leave room knock behind","window wall"],
    ["🔧","wrench","fix repair tool fixing mechanic maintenance","fix repair tool broken adjust build mechanic","break destroy"],
    ["🔨","hammer","hammer nail smash build_hit","build nail smash break wood construct tool","gentle soft"],
    ["⚙️","gear","settings mechanism cog machinery engineering","machine system settings work engine mechanism process","organic natural"],

    /* ── money & work ── */
    ["💰","money bag","money cash wealth rich fortune earnings","money cash pay earn rich profit wealth income","free cheap broke"],
    ["💸","money flying","spending expense cost paying broke pricey pay paid price expensive cheap cost costly bill","spend cost expensive pay bill price lost budget","earn save free"],
    ["💳","card","card credit debit payment","pay card buy checkout online purchase bank","cash coin"],
    ["📈","chart up","growth increase rising up_trend gains improvement","grow increase rise up more better profit revenue","fall drop decline lose"],
    ["📉","chart down","decline decrease falling drop loss downturn","fall drop decline lose less worse crash down","grow rise increase"],
    ["📊","bar chart","data statistics analytics metrics numbers report","data number statistic report measure result percent","feeling opinion guess"],
    ["💼","briefcase","work business job corporate career professional office workplace","job business career office meeting client boss salary colleague commute","holiday play school fixed broken correct bug code running"],
    ["🛒","cart","shopping cart groceries buying store buy buying sell selling shop shopping order","buy shop store cart grocery checkout market","sell free"],
    ["🏦","bank","bank banking loan mortgage account","money account loan save deposit interest branch","river shore edge"],

    /* ── travel & places ── */
    ["✈️","plane","flight flying airplane aeroplane airport travel abroad trip holiday vacation abroad","travel trip fly airport holiday abroad ticket land","drive train walk"],
    ["🚗","car","car driving drive vehicle automobile","drive road traffic park engine wheel journey","fly train walk"],
    ["🚀","rocket","rocket launch space liftoff blastoff soaring skyrocket","launch space fast up growth start blast mission","slow ground crawl"],
    ["🚲","bike","bike bicycle cycling ride_bike","ride pedal cycle road wheel commute","car engine motor"],
    ["🚂","train","train railway locomotive rail","track station rail journey platform carriage travel","gym workout lift practise coach teach"],
    ["🏠","house","house home apartment flat property","home live house room family move rent buy","office work outdoor"],
    ["🏥","hospital","hospital clinic emergency_room health healthy healthcare","doctor nurse patient emergency health ward treat","school office shop"],
    ["🏫","school","school classroom college university education","student teacher class learn lesson exam homework","work office job"],
    ["🗺","map","map navigation route directions atlas","route direction find navigate journey plan explore","lost blind"],
    ["🏝","island","island beach tropical paradise resort","beach sea holiday palm sand tropical escape","city mountain"],
    ["🏔","mountain","mountain peak summit alpine climbing","climb high peak hike summit snow view","valley beach flat"],

    /* ── sport & activity ── */
    ["⚽","football","football soccer sport sports match_game","goal match team play pitch score kick league","fire light burn match_stick date romance"],
    ["🏀","basketball","basketball hoops dunk","court hoop dunk team score play nba","field pitch"],
    ["🥊","boxing","boxing punch fight boxer knockout","fight punch ring round knockout spar opponent","peace calm"],
    ["🏋️","weightlifting","lifting weights deadlift squat barbell","gym lift weight rep set muscle strength train","cardio run"],
    ["🏃","running","run running jog sprint marathon runner","run pace mile marathon jog fast finish training","execute program script code stand walk"],
    ["🧘","meditation","meditate yoga mindfulness calm_practice zen","calm breathe mind peace stress relax focus","chaos rush stress_high"],
    ["🎮","gaming","gaming gamer videogame console playstation xbox game games gaming play playing","game play console controller level win stream","work study"],
    ["🎲","dice","dice random chance gamble roll_dice","chance random luck roll gamble odds","certain planned"],

    /* ── symbols & meta ── */
    ["❤️","heart","love heart adore beloved","love heart care family forever together","hate break end"],
    ["💔","broken heart","heartbreak breakup dumped heartbroken","break end lost gone hurt goodbye over","together love forever"],
    ["✅","check","done complete finished correct approved tick success verified work works working","done complete finish correct yes right success passed fixed running","fail wrong incomplete broken office career salary boss commute"],
    /* bare "no" is deliberately NOT a trigger — it is far too common as plain
       grammar, and it turned "no way that's insane" into ❌ */
    ["❌","cross","wrong incorrect failed denied rejected nope broken","wrong fail incorrect never dont stop reject broke","right correct yes pass works"],
    ["⚠️","warning","warning caution careful danger risk beware hazard problem problems issue trouble risky","careful danger risk warning avoid caution safety","safe fine harmless"],
    ["🚫","prohibited","banned forbidden notallowed prohibited illegal","never dont cant forbidden banned rule illegal stop","allowed free permitted"],
    ["♻️","recycle","recycle sustainable reuse eco green_env","environment waste reuse sustainable planet green","waste dump pollute"],
    ["💤","zzz","sleep snoring dozing boring_sleep","sleep tired bed night snore nap bored","awake energetic"],
    ["💬","speech","conversation chat comment discussion answer answered reply replied comment text texting texted messaging","say talk speak comment chat conversation reply tell","silent quiet"],
    ["💭","thought","thinking imagine daydream idea_bubble wondering","imagine think dream wonder mind memory suppose","said spoke aloud"],
    ["🔔","bell","notification alert reminder ring subscribe follow subscribe notify","notification remind alert ring subscribe turn_on","mute silent off"],
    ["🎉","party","celebration party celebrate hooray congrats congratulations congratulations congrats celebrate celebrating","celebrate party congratulations birthday win finally news","sad funeral quiet"],
    ["🎁","gift","gift present surprise unwrapping birthday_gift","give surprise birthday christmas wrap open present","take steal"],
    ["🎈","balloon","balloon party_balloon float","party birthday celebrate float child colour color","serious formal"],
    ["🧠","brain","brain mind intelligence smart clever thinking_organ memory think thinking understand realise realize smart","think smart learn memory intelligence idea study clever","body muscle physical"],
    ["👶","baby","baby infant newborn toddler","born child parent nappy diaper cry small new","adult old elderly"],
    ["🎓","graduate","graduation degree diploma graduating alumni","university degree student finish study year ceremony","start begin"],
    ["🧩","puzzle","puzzle jigsaw piece_fits solving","piece fit solve missing together figure part","whole simple"],
    ["🧊","ice","ice cube frozen_block ice","cold drink freeze cube chill","hot warm melt"],
    ["🔊","loud","loud volume sound_up blasting","loud volume sound hear noise up speaker","quiet mute silent"],
    ["🔇","mute","mute silent muted silence quiet_sound","quiet mute silent off no_sound hush","loud volume blast"],

    /* ── batch 2 ──────────────────────────────────────────────────────────
       Names are triggers automatically now, so unambiguous entries can carry
       an empty trigger list and lean on context alone. Ambiguous ones still
       spell out their vetoes — that is where the work actually is. */

    /* faces & feeling */
    ["😀","grin","smile smiling cheerful glad","happy good mood day nice",""],
    ["😃","beaming","","happy excited good news smile",""],
    ["😄","big smile","","happy fun joy good laugh",""],
    ["😁","grinning teeth","","happy proud pleased smile",""],
    ["😆","squinting laugh","giggling","funny laugh joke silly",""],
    ["😊","smiling","pleased content happy glad pleased","happy nice kind thank sweet",""],
    ["😇","innocent","angelic halo","good pure sweet behave kind","evil devil bad"],
    ["🙂","slight smile","","fine okay polite calm",""],
    ["😌","relieved","content serene","calm relief finally peace better",""],
    ["😉","wink","winking cheeky","joke hint knowing tease playful",""],
    ["😘","blowing kiss","kiss","love kiss goodbye miss sweet",""],
    ["🤗","hug","hugging embrace","comfort welcome warm friend support",""],
    ["🤭","giggle","oops","laugh secret oops shy",""],
    ["🤫","shush","shh hush","quiet secret dont tell silence","loud shout"],
    ["🤥","lying","lie liar fib","lie false story pretend","honest true"],
    ["😐","neutral","blank expressionless","nothing awkward fine whatever silence",""],
    ["😒","unamused","meh","annoyed seriously whatever again sure",""],
    ["😞","disappointed","letdown lose lost losing failed defeat","sad hoped expected fail worse",""],
    ["😔","dejected","downcast","sad quiet miss regret sorry",""],
    ["😟","worried","concerned","worry concern afraid problem nervous",""],
    ["😕","confused","puzzled unsure","confused unsure what strange odd",""],
    ["😣","struggling","straining hard difficult tough struggle","hard difficult struggle try pain",""],
    ["😫","fed up","weary","tired exhausted enough long done",""],
    ["🥺","pleading","begging","please beg want sad sorry cute",""],
    ["😢","crying","tear tearful sad cry crying upset tears","sad cry hurt miss sorry","laugh funny"],
    ["😰","anxious","nervous sweating","nervous scared worry stress panic",""],
    ["😨","fearful","scared afraid","scared afraid fear panic danger",""],
    ["😮","surprised","gasp","surprise wow unexpected suddenly",""],
    ["😲","astonished","shocked","shock cant believe wow unexpected",""],
    ["🥱","yawn","yawning","tired bored sleep long dull",""],
    ["🤤","drooling","drool","food hungry delicious want tasty",""],
    ["🥳","partying","celebrating","party birthday celebrate congrats win",""],
    ["🤩","star struck","starstruck","amazing wow incredible excited star",""],
    ["😷","mask","face_mask","sick mask flu virus cough",""],
    ["🤒","fever","unwell","fever sick ill temperature bed doctor","awesome amazing"],
    ["🤕","injured","","hurt injury accident pain head","fine healthy"],
    ["🤧","sneezing","sneeze","sneeze cold tissue allergy flu",""],
    ["🥴","woozy","dizzy tipsy","dizzy drunk confused spinning",""],
    ["🤪","zany","goofy","silly crazy fun goofy wild",""],
    ["🤨","skeptical","suspicious","suspicious doubt really sure question",""],
    ["🧐","scrutinising","examining","examine detail closely inspect",""],
    ["🤓","nerd","geek","study smart glasses school book",""],
    ["😈","devil","mischievous","mischief naughty trouble plan","angel pure"],
    ["🤬","cursing","swearing","angry furious rage swear",""],
    ["😡","enraged","fuming","angry furious rage mad hate",""],
    ["🥲","smiling tear","bittersweet","happy sad proud emotional",""],
    ["🫡","salute","saluting","respect yes duty acknowledge",""],
    ["🫢","gasp","","shock oh no cant believe",""],
    ["🫣","peeking","","scared watch cant look nervous",""],

    /* hands & body */
    ["🤜","fist bump","","bump friend greet",""],
    ["✊","raised fist","solidarity","strength solidarity power fight together",""],
    ["👊","punch","","punch hit fight bump",""],
    ["🤞","fingers crossed","","hope luck wish please chance",""],
    ["🤘","rock on","horns","rock metal concert band",""],
    ["👌","ok hand","perfect_hand","ok perfect good fine agree",""],
    ["🤏","pinch","small tiny little","small little tiny bit barely",""],
    ["☝️","point up","one_moment","one wait point above first",""],
    ["👇","point down","","below down here look",""],
    ["💅","nails","manicure","nails beauty salon unbothered",""],
    ["👂","ear","hearing listen listening hear heard","hear listen sound",""],
    ["👃","nose","smell","smell scent sniff",""],
    ["👁️","eye","","see look vision","time clock hour"],
    ["👄","lips","","lips kiss mouth talk",""],

    /* people & roles */
    ["👨","man","guy","man he guy dad",""],
    ["👩","woman","lady","woman she lady mum mom",""],
    ["🧑","person","someone","person someone human they",""],
    ["👦","boy","","boy young kid son",""],
    ["👧","girl","","girl young kid daughter",""],
    ["👴","grandpa","grandfather old older elderly aged","old age elderly",""],
    ["👵","grandma","grandmother","old age elderly",""],
    ["👮","police","cop officer","police arrest law crime",""],
    ["🦸","superhero","hero","save power rescue super",""],
    ["🤰","pregnant","expecting","baby birth month expecting",""],
    ["👰","bride","wedding marriage married","wedding marry dress",""],
    ["🤵","groom","","wedding suit marry",""],
    ["🧑‍🍳","chef","cook","kitchen restaurant recipe food",""],
    ["🧑‍⚕️","doctor","nurse","hospital patient health",""],
    ["🧑‍🏫","teacher","","teach class school lesson student",""],
    ["🧑‍💻","developer","programmer coder","code program software bug computer",""],
    ["💃","dancing","dancer","dance party music move",""],

    /* animals */
    ["🐅","tiger","","stripes wild jungle",""],

    /* plants, weather, places */
    ["🌱","seedling","sprout","grow new start plant seed beginning",""],
    ["🌹","rose","","love romance flower valentine",""],
    ["🌴","palm tree","palm","beach tropical island holiday",""],
    ["🌅","sunrise","dawn morning sunrise early_morning","morning early sea horizon",""],
    ["💨","gust","wind","fast blow rush gone",""],
    ["☔","umbrella","","rain wet weather",""],
    ["🏙️","cityscape","skyline","city buildings urban",""],

    /* food & drink */
    ["🍿","popcorn","","movie cinema snack",""],
    ["🥪","sandwich","","lunch bread filling",""],
    ["🍚","rice","","bowl asian side",""],
    ["🍩","donut","doughnut","sweet glaze coffee",""],
    ["🍬","candy","sweets","sugar treat",""],
    ["🍊","orange","tangerine","citrus fruit juice",""],
    ["🍋","lemon","","sour citrus juice",""],
    ["🥛","milk","","drink glass dairy",""],
    ["🥂","cheers","toast","celebrate drink clink",""],

    /* objects & tools */
    ["📖","open book","reading learn learning read reading study studying","read page story study",""],
    ["📰","newspaper","news press","article headline read",""],
    ["📧","email","e_mail","inbox send message",""],
    ["🖊️","pen","biro","write note sign",""],
    ["📋","clipboard","","list checklist notes",""],
    ["📍","location","location_pin","place map here where",""],
    ["✂️","scissors","cut","trim paper cut",""],
    ["🔓","unlocked","unlock","open access free",""],
    ["🔗","link","url share sharing shared","connect chain url",""],

    /* symbols, arrows, controls */
    ["➕","plus","add","add more increase",""],
    ["➖","minus","subtract","less remove decrease",""],
    ["❓","question","question_mark","ask why what wonder",""],
    ["♾️","infinity","endless","forever infinite unlimited",""],
    ["🔝","top","","best highest up",""],
    ["🔜","soon","","coming next wait",""],
    ["⬆️","up","up_arrow","increase above rise",""],
    ["⬇️","down","down_arrow","decrease below fall",""],
    ["➡️","right","right_arrow","next forward direction",""],
    ["⬅️","left","left_arrow","back previous direction",""],
    ["🔄","refresh","reload","again repeat loop cycle",""],
    ["▶️","play","play_button start starting begin began started","start begin run",""],
    ["⏸️","pause","","stop wait break",""],
    ["🔁","repeat","loop","again forever loop",""],
    ["⛔","no entry","","stop forbidden blocked",""],
    ["🆕","new","","fresh latest just",""],
    ["🥈","silver","second_place","second runner up",""],
    ["🥉","bronze","third_place","third podium",""],
    ["🎫","ticket","","entry event show",""],
    ["🎭","theatre","theater drama","acting play stage masks",""],
    ["🎨","art","painting palette","paint colour color creative draw",""],

    /* travel & road */
    ["🚕","taxi","cab","ride city fare",""],
    ["🚌","bus","","stop ride route commute",""],
    ["🚑","ambulance","","emergency hospital siren",""],
    ["🚓","police car","","siren chase police",""],
    ["🛹","skateboard","skating","trick park board",""],
    ["🚦","traffic light","","stop go signal",""],
    ["🛑","stop sign","","halt red sign",""],
    ["⛽","fuel","petrol gas_station","fill car tank",""],
    ["🧳","luggage","suitcase baggage","pack trip airport travel",""],

    /* ── batch 3: everyday speech that had no emoji at all ──────────────────
       These came from measuring coverage against the words people actually say
       on camera, not from browsing an emoji picker. Each one was a hole. */
    ["🍽️","food","eat eating ate meal dinner lunch breakfast hungry hunger dish plate cooking_food","eat food hungry meal dinner lunch restaurant plate taste cook",""],
    ["👥","people","everyone crowd group team folks others audience friend friends mates","people team everyone group together crowd friends us them",""],
    ["👨‍👩‍👧","family","families relatives household kids children parents mum mom dad","family kids parents home together brother sister children",""],
    ["📞","call","calling called ring rang dial phonecall","call ring answer hello speak dial number",""],
    ["🗣️","talk","talking talked speak speaking spoke","talk speak say tell conversation voice told everyone",""],
    ["🤷","shrug","maybe dunno whatever unsure idk guess suppose","maybe unsure know whatever guess suppose either",""],
    ["🏁","finish","finished finishing end ended ending done complete final over","finish end done final last complete over race line",""],
    ["🌐","internet","online web website net browser google browsing","online internet web site browser search google connection",""],
    ["🆘","help","emergency rescue helping helped assist","help emergency need urgent save trouble stuck",""],
    ["🚶","walk","walking walked step steps stroll","walk step street outside distance slow legs",""],
    ["🗑️","delete","deleted deleting trash bin remove removed rubbish garbage throw_away","delete remove trash bin throw clear empty",""],
    ["🆓","free","","free cost nothing pay price zero charge",""],
    ["🧑‍🎓","student","graduate pupil","student study university class exam degree school",""],
    ["🐦","bird","birds","bird fly sky tree nest wing sing",""]
  ];

  /* ═══════════ PARSE + INDEX ═══════════ */

  var words = function (s) { return s ? s.split(/\s+/).filter(Boolean) : []; };

  var EMOJI = RAW.map(function (r) {
    var w = words(r[2]).map(function (t) { return t.replace(/_/g, " "); });
    /* An emoji's own NAME is always a trigger. Relying on it being repeated in
       the trigger list silently made emojis unreachable by the one word anybody
       would use for them — it cost 😎 "cool", 🥶 "cold", 🖱 "mouse", 🌊 "wave"
       and 💡 "light" before this was enforced here rather than by hand.
       Multi-word names ("computer mouse") join as phrase triggers, so this
       never leaks a bare fragment like "up" from "thumbs up". */
    var name = String(r[1] || "").trim().toLowerCase();
    if (name && w.indexOf(name) < 0) w.push(name);
    w = w.filter(function (t, i) { return w.indexOf(t) === i; });   // dedupe

    /* A word that is BOTH a trigger and a veto on the same entry cancels the
       emoji it belongs to — it scores the trigger then immediately subtracts
       more than it gained. It is never intentional, and it is invisible in the
       data (it cost 🛒 the word "sell" and 😅 the word "easy"). Strip it here
       so no future entry can reintroduce the bug by hand. */
    var no = words(r[4]).map(function (t) { return t.replace(/_/g, " "); })
      .filter(function (t) { return w.indexOf(t) < 0; });

    return {
      e: r[0],
      n: r[1],
      w: w,
      ctx: words(r[3]).map(function (t) { return t.replace(/_/g, " "); }),
      no: no
    };
  });

  /* trigger -> entries. Built once; lookup is O(1) per word at match time. */
  var INDEX = {};
  var PHRASES = [];
  EMOJI.forEach(function (entry) {
    entry.w.forEach(function (t) {
      if (t.indexOf(" ") > 0) { PHRASES.push({ p: t, entry: entry }); return; }
      (INDEX[t] || (INDEX[t] = [])).push(entry);
    });
  });

  /* ═══════════ NORMALISING ═══════════ */

  /* Cheap English stemming — enough to let "laughing", "laughed" and "laughs"
     all reach the trigger "laugh" without shipping a stemmer. Returns every
     plausible base form rather than guessing one, since a wrong single guess
     silently loses the match. */
  function stems(raw) {
    var w = String(raw).toLowerCase().replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "");
    if (!w) return [];
    var out = [w];
    var push = function (s) { if (s.length > 2 && out.indexOf(s) < 0) out.push(s); };
    if (/ies$/.test(w)) push(w.slice(0, -3) + "y");
    if (/(ses|xes|zes|ches|shes)$/.test(w)) push(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1));
    if (/ing$/.test(w)) { push(w.slice(0, -3)); push(w.slice(0, -3) + "e"); }
    if (/ed$/.test(w)) { push(w.slice(0, -2)); push(w.slice(0, -1)); }
    if (/(ing|ed)$/.test(w) && /([bdglmnprt])\1(ing|ed)$/.test(w)) {
      push(w.replace(/([bdglmnprt])\1(ing|ed)$/, "$1"));
    }
    if (/er$/.test(w)) push(w.slice(0, -2));
    if (/ly$/.test(w)) push(w.slice(0, -2));
    return out;
  }

  /* ═══════════ NEGATION ═══════════
     "not good" must never render 👍. Catching that needs the words BEFORE the
     trigger, and in short-form captions the negator very often sits in the
     PREVIOUS cue ("it's not" / "good enough"), so the window deliberately
     reaches back across the cue boundary.

     Where an entry has a clear opposite the emoji flips (👍→👎). Where it does
     not, the honest answer is no emoji: "not a dog" should not show 🐶. Note
     that "not bad" resolves itself — "bad" summons 👎, and negating 👎 gives
     👍, which is what the phrase actually means. */

  var NEGATORS = Object.create(null);
  ("not no never none nobody nothing cannot cant dont doesnt didnt wont wouldnt " +
   "shouldnt couldnt isnt arent wasnt werent aint hardly barely scarcely without " +
   "lack lacks lacking fail fails failed refuse refused deny denied stop stopped " +
   "quit avoid avoided unable neither nor"
  ).split(" ").forEach(function (w) { NEGATORS[w] = true; });

  /* Phrases that merely LOOK negative. "no way that's amazing" is an
     exclamation, not a denial, and treating it as one flipped the emoji on
     exactly the lines that deserved the strongest reaction. */
  var NEG_SKIP = Object.create(null);
  ["no way", "not only", "no doubt", "no wonder", "not to"].forEach(function (p) { NEG_SKIP[p] = true; });

  var NEG_WINDOW = 4;   // how many tokens back a negator still binds

  var ANTI = {
    "👍": "👎", "👎": "👍", "✅": "❌", "❌": "✅", "❤️": "💔", "💔": "❤️",
    "📈": "📉", "📉": "📈", "💰": "💸", "💸": "💰", "🔊": "🔇", "🔇": "🔊",
    "🥶": "🥵", "🥵": "🥶", "☀️": "🌧", "🌧": "☀️", "🔒": "🔓",
    "😍": "😒", "🥰": "😠", "😂": "😐", "😭": "😊", "🤢": "😋", "😱": "😐",
    "🔥": "🧊", "💯": "❌", "🏆": "😞", "🥇": "🥈", "👏": "👎", "🙌": "😞",
    "🎉": "😞", "😎": "😬", "💪": "🥱", "🤝": "🙅", "🙏": "🙅", "🎯": "❌",
    "⚡": "🐢", "🚀": "🐢", "🧠": "🤡", "💡": "🤷", "😴": "😳", "🤔": "💭"
  };

  function tokenList(text) {
    return String(text || "").toLowerCase().split(/[^a-z0-9']+/i)
      .filter(Boolean).map(function (w) { return w.replace(/'/g, ""); });
  }

  /* Which token actually summoned this entry — negation only counts if it sits
     in front of THAT word, not merely somewhere in the line. */
  function triggerIndex(tokens, entry) {
    for (var i = 0; i < tokens.length; i++) {
      var st = stems(tokens[i]);
      for (var s = 0; s < st.length; s++) {
        if (entry.w.indexOf(st[s]) >= 0) return i;
      }
    }
    return -1;
  }

  function negatedBefore(tokens, idx) {
    for (var i = Math.max(0, idx - NEG_WINDOW); i < idx; i++) {
      if (!NEGATORS[tokens[i]]) continue;
      if (NEG_SKIP[tokens[i] + " " + (tokens[i + 1] || "")]) continue;
      return true;
    }
    return false;
  }

  function tokenSet(text) {
    var set = Object.create(null);
    String(text || "").toLowerCase().split(/[^a-z0-9']+/i).forEach(function (raw) {
      stems(raw).forEach(function (s) { set[s] = true; });
    });
    return set;
  }

  /* ═══════════ SCORING ═══════════ */

  /* Multi-word context and veto terms have to be tested against the raw text —
     they are never keys in the token set, so checking only the set would let
     them silently never fire, and a veto that never fires is a bug you find
     months later in a wrong emoji. */
  function present(term, text, set) {
    return term.indexOf(" ") > 0 ? text.indexOf(term) >= 0 : !!set[term];
  }

  function scoreEntry(entry, phrase, phraseSet, ctxText, ctxSet) {
    var base = 0;
    for (var i = 0; i < entry.w.length; i++) {
      var t = entry.w[i];
      if (t.indexOf(" ") > 0) {
        if (phrase.indexOf(t) >= 0) base = Math.max(base, CFG.triggerScore + CFG.phraseBonus);
      } else if (phraseSet[t]) {
        /* A trigger only ONE emoji claims has nothing to be confused with, so
           it should not need context to earn its place — "coffee" means ☕ on
           its own. Without this a bare trigger scored 10 against a threshold of
           13, meaning no emoji could ever fire on its own word: only contested
           triggers like "watch" still have to be argued for. */
        var uniq = (INDEX[t] || []).length === 1;
        base = Math.max(base, CFG.triggerScore + (uniq ? CFG.uniqueBonus : 0));
      }
    }
    // null = this entry was never summoned at all. A NUMBER means a trigger
    // matched, even if context drags it negative — negation still needs to find
    // those, since a negated line's context argues for the opposite sense.
    if (!base) return null;

    var hits = 0;
    for (var c = 0; c < entry.ctx.length && hits < CFG.ctxCap; c++) {
      if (present(entry.ctx[c], ctxText, ctxSet)) hits++;
    }
    var vetoes = 0;
    for (var v = 0; v < entry.no.length; v++) {
      if (present(entry.no[v], ctxText, ctxSet)) vetoes++;
    }

    return base + hits * CFG.ctxBonus - vetoes * CFG.vetoPenalty;
  }

  /* Rank every entry the phrase could possibly summon. `context` is the wider
     text (neighbouring cues, the whole sentence) and is what resolves the
     ambiguous triggers — pass it whenever you have it. */
  function suggest(phrase, context) {
    var text = String(phrase || "").toLowerCase();
    var ctxText = text + " " + String(context || "").toLowerCase();
    var phraseSet = tokenSet(text);
    var ctxSet = tokenSet(ctxText);

    var seen = [], out = [];
    Object.keys(phraseSet).forEach(function (tok) {
      (INDEX[tok] || []).forEach(function (entry) {
        if (seen.indexOf(entry) < 0) seen.push(entry);
      });
    });
    PHRASES.forEach(function (p) {
      if (text.indexOf(p.p) >= 0 && seen.indexOf(p.entry) < 0) seen.push(p.entry);
    });

    seen.forEach(function (entry) {
      var s = scoreEntry(entry, text, phraseSet, ctxText, ctxSet);
      if (s !== null) out.push({ emoji: entry.e, name: entry.n, score: s, entry: entry });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  /* The single best emoji, or null. Returns null far more often than not —
     that is the point. A close call between two readings is treated as no
     answer rather than a coin flip, because a confidently wrong emoji reads
     worse than none at all. */
  function best(phrase, context, opts) {
    var ranked = suggest(phrase, context);
    if (!ranked.length) return null;

    // opts.pre is the text immediately before this phrase (the previous cue),
    // so a negator that landed at the end of it still binds forward.
    var pre = (opts && opts.pre) || "";
    var tokens = tokenList(pre).slice(-NEG_WINDOW).concat(tokenList(phrase));

    /* Negation is settled FIRST, on the plain words, before any score
       threshold. It has to be: a negated line's context argues for the OPPOSITE
       sense and vetoes the entry we need — "not cold … actually warm" drives 🥶
       under the threshold on the word "warm", so a score-first order would
       never see the negation at all. */
    for (var i = 0; i < ranked.length; i++) {
      var idx = triggerIndex(tokens, ranked[i].entry);
      if (idx >= 0 && negatedBefore(tokens, idx)) return ANTI[ranked[i].emoji] || null;
    }

    if (ranked[0].score < CFG.minScore) return null;
    if (ranked[1] && ranked[0].score - ranked[1].score < CFG.minLead) return null;
    return ranked[0].emoji;
  }

  /* ═══════════ CAPTION PASS ═══════════ */

  function cueText(cue) {
    return (cue.words || []).map(function (w) { return w.text; }).join(" ");
  }

  /* Walk built cues and attach emojis SPARINGLY. Context for each cue is the
     surrounding cues, because three words on screen rarely disambiguate on
     their own but the sentence around them usually does. */
  function attachToCues(cues, opts) {
    if (!cues || !cues.length) return cues;
    var cfg = Object.assign({}, CFG, opts || {});
    var budget = Math.max(1, Math.floor(cues.length * cfg.maxDensity));
    var lastAt = -cfg.spacing, used = {}, placed = 0;

    for (var i = 0; i < cues.length; i++) {
      if (placed >= budget) break;
      if (i - lastAt < cfg.spacing) continue;

      var here = cueText(cues[i]);
      if (!here) continue;
      var context = "";
      for (var k = Math.max(0, i - 2); k <= Math.min(cues.length - 1, i + 2); k++) {
        if (k !== i) context += " " + cueText(cues[k]);
      }

      // the previous cue is passed separately: a negator at the end of it
      // ("it's not" / "good enough") still governs this line's trigger
      var pick = best(here, context, { pre: i > 0 ? cueText(cues[i - 1]) : "" });
      if (!pick) continue;
      if (used[pick] !== undefined && i - used[pick] < cfg.repeatGap) continue;

      cues[i].emoji = pick;
      used[pick] = i;
      lastAt = i;
      placed++;
    }
    return cues;
  }

  /* ═══════════ EXPORTS ═══════════ */

  global.VevrisEmoji = {
    // CORPUS version — the shape of the emoji data, nothing to do with the app
    // version. That lives only in version.js. Bump this when entries change in
    // a way stored data would need to know about.
    VERSION: 1,
    CFG: CFG,
    EMOJI: EMOJI,
    count: EMOJI.length,
    suggest: suggest,
    best: best,
    attachToCues: attachToCues,
    stems: stems
  };
})(window);
