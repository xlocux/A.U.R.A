"use strict";

// Aura's voice. The quotes come from the user's quotes.txt and are tied to specific situations (an event, a
// finished stage, a gag...) rather than picked at random. Each pool is a shuffled "bag" (no repeats until every
// line has been used) and a global cooldown keeps her from talking too much. Section and gag lines are original.
(function initAvatarQuotes() {
  const POOLS = {
    // ── run lifecycle ──
    start: [
      "Trust the process. The process being: disassemble, trace, understand.",
      "The hunt is long and full of false positives. Keep going anyway.",
      "It's dangerous to go alone. Take a debugger.",
      "To boldly go where no static analysis has gone before.",
      "Deep in the codebase. Do not interrupt the trace.",
      "Stay hungry, stay foolish. Run the unknown binary in a VM first.",
      "Patience, young hacker. The kernel is deep and full of terrors."
    ],
    startLight: ["Feel the need. The need for speed. Also for good entropy analysis."],
    startFull: [
      "This is Sparta! Also this is a stack buffer overflow.",
      "One does not simply walk into the kernel. There are shadow patches there that do not sleep."
    ],
    done: [
      "Muso Tensei. Mastery achieved through understanding every failure.",
      "Bankai: Tensa Zangetsu. The blade condenses everything into a single point. So does a good RE report.",
      "Lose yourself in the analysis. The moment you own it, you understand it.",
      "Live long and prosper. Patch your dependencies."
    ],
    doneVulns: [
      "Houston, we have a problem. The problem has a CVE.",
      "Every binary is a puzzle. Every vulnerability is a misplaced assumption.",
      "The attacker needs to be right once. The defender needs to be right every time. That's not fair. Good."
    ],
    vulnFew: [
      "Every binary is a puzzle. Every vulnerability is a misplaced assumption.",
      "Sharingan activated. Everything is a pattern if you stare long enough.",
      "You don't find 0-days. 0-days find you."
    ],
    vulnSome: [
      "The matrix has you, Neo. But the matrix also has CVEs.",
      "Take a number, have a seat. The vulnerability queue is long.",
      "Hadouken ===))))))). The payload metaphor writes itself."
    ],
    vulnMany: [
      "Five Point Palm Exploding Heart Technique. Triggered on the fifth invalid free.",
      "Houston, we have a problem. The problem has a CVE.",
      "Winter is coming. And so is the next wave of ransomware."
    ],
    toolFail: [
      "I'm afraid I can't do that, Dave. The payload said so.",
      "Shinra Tensei. The binary repelled every static analysis tool.",
      "Ignorance is bliss. Threat actors count on it."
    ],
    toolTimeout: [
      "Apt-get install patience. Some vulnerabilities take years to weaponize.",
      "Patience, young hacker. The kernel is deep and full of terrors.",
      "The hunt is long and full of false positives. Keep going anyway."
    ],
    runFail: ["I'll be back. So will the threat actor.", "Another one bites the dust. Another C2 goes dark."],
    aiFail: ["I'm afraid I can't do that, Dave. The payload said so.", "Houston, we have a problem."],
    thinking: [
      "Deep in the codebase. Do not interrupt the trace.",
      "Lose yourself in the analysis. The moment you own it, you understand it.",
      "What you know, you can't explain. What you can explain, you found in the disassembly."
    ],
    slowReply: ["The answer is 42. The question was in the .rodata all along.", "You can't handle the output. Most people can't. That's fine."],
    // ── idle moods, chosen by what is going on ──
    idleRunning: [
      "Patience, young hacker. The kernel is deep and full of terrors.",
      "The quieter you become, the more you can hear. And the more you can hear, the deeper you can go.",
      "In the wire. Packets don't lie — people do."
    ],
    idleDone: [
      "Live long and prosper. Patch your dependencies.",
      "Code never lies. Comments sometimes do. Binaries always tell the truth.",
      "Security through obscurity is not security. It's procrastination."
    ],
    idleEmpty: [
      "Trust the process. The process being: disassemble, trace, understand.",
      "The best exploit is the one you don't need to write.",
      "Reverse engineering is not about breaking things. It's about understanding them well enough to fix what others couldn't."
    ],
    hello: ["It's dangerous to go alone. Take a debugger.", "Who are you? The binary asked. I'm the one who reads you."],
    sleep: ["Winter is coming. And so is the next wave of ransomware.", "Ignorance is bliss. Threat actors count on it."],
    dizzy: ["Omae wa mou shindeiru. So was the sandbox.", "We're all mad here. Occupational hazard of staring at hex dumps."],
    // ── one pool per finished stage ──
    "stage:intel": ["Sharingan activated. Everything is a pattern if you stare long enough."],
    "stage:passive": ["In the wire. Packets don't lie — people do."],
    "stage:subdomains": ["Kagebushin no Jutsu. Every sample spawns three more."],
    "stage:tls": ["Code never lies. Comments sometimes do. Binaries always tell the truth."],
    "stage:takeover": ["Hasta la vista, persistence. Registry run key removed."],
    "stage:urls": ["The needle is in the haystack. The haystack is 400MB of packed code."],
    "stage:crawl": ["Rasengan. Controlled chaos with a defined center."],
    "stage:params": ["Senbonzakura Kageyoshi: Senkei. A thousand petals, a thousand code paths."],
    "stage:http": ["The quieter you become, the more you can hear. And the more you can hear, the deeper you can go."],
    "stage:tech": ["Every binary is a puzzle. Every vulnerability is a misplaced assumption."],
    "stage:js": ["Code never lies. Comments sometimes do. Binaries always tell the truth."],
    "stage:screenshots": ["The Eye of the Shinigami. It reads what was never meant to be read."],
    "stage:fingerprint": ["Who are you? The binary asked. I'm the one who reads you."],
    "stage:dirs": ["Gum-gum gatling. The fuzzer found seventeen crashes before lunch."],
    "stage:cloud": ["Security through obscurity is not security. It's procrastination."],
    "stage:bypass403": ["One does not simply walk into the kernel. There are shadow patches there that do not sleep."],
    "stage:recovery": ["Patience, young hacker. The kernel is deep and full of terrors."],
    "stage:vport": ["The needle is in the haystack. The haystack is 400MB of packed code."],
    "stage:vversion": ["The matrix has you, Neo. But the matrix also has CVEs."],
    "stage:vnuclei": ["Hadouken ===))))))). The payload metaphor writes itself."],
    // ── gags ──
    "gag:wormhole": [
      "There is no spoon. There is only the heap spray.",
      "To infinity and beyond. The heap spray covered it.",
      "Come with me if you want to live. I have a hardened kernel and a good firewall."
    ],
    "gag:wormholeBack": ["I'll be back. So will the threat actor.", "Hasta la vista, persistence. Registry run key removed."],
    "gag:explode": [
      "Five Point Palm Exploding Heart Technique. Triggered on the fifth invalid free.",
      "Amaterasu: Enton — Kagutsuchi. Some fires you set. Some fires set you.",
      "Mugetsu. Some techniques you use once, and the cost is everything."
    ],
    "gag:rebuilt": ["Hollow purple: infinite fusion. Like the malware's code reuse strategy.", "Bankai: Hyoten Hyakkaso. The sample froze every sandbox it touched."],
    "gag:catch": [
      "Feeling lucky, punk? The entropy says no.",
      "Float like a butterfly, sting like a use-after-free.",
      "Omae wa mou shindeiru. So was the sandbox."
    ],
    "gag:caught": ["Resistance is futile. So is obfuscation, eventually.", "Another one bites the dust. Another C2 goes dark.", "Finish him! Said every decompiler that actually works."],
    "gag:missed": ["Take a number, have a seat. The vulnerability queue is long.", "Float like a butterfly, sting like a use-after-free."],
    "gag:glitch": [
      "What is real? How do you define real? In RE, real is what survives dynamic analysis.",
      "I see dead packets. They don't know they're dead.",
      "The matrix has you, Neo. But the matrix also has CVEs."
    ],
    "gag:dance": [
      "Praise the Sun! Also praise stripped binaries — they build character.",
      "Purple haze, all in my brain. That's what a polymorphic packer does to you.",
      "73 is the new 42. 0x90 is eternal."
    ],
    "gag:peek": [
      "Well, well, well. If it isn't the invisible shellcode.",
      "The truth is out there. Usually in the .data section.",
      "I've seen things you people wouldn't believe. Rootkits in RAM, shellcode off the shoulder of a PDF parser."
    ],
    // ── section commentary (original lines, shown when she wanders there) ──
    "section:recon": ["Domains in, surface out. Pick a depth and let it run.", "Light for a peek, Full for a deep dive. Authorized scope only."],
    "section:results": ["So many assets. The Risk URLs tab has the juicy ones.", "Tip: export to Burp or Caido from the Export tab."],
    "section:topology": ["Nodes everywhere. Drag, zoom, click — it's relaxing.", "Every dot is a host that has to answer for itself."],
    "section:flow": ["The pipeline, live. Click any tile for its command.", "Tiles light up as phases start. Pretty, right?"],
    "section:wordlists": ["A good wordlist is half the fuzz.", "Generate one from your recon data: it knows the target's vocabulary."],
    "section:search": ["Search is just grep with ambition.", "Everything saved is searchable. Everything."],
    "section:tools": ["Base64 is not encryption. Just saying.", "Handy converters, all local. Nothing leaves your browser."],
    "section:logs": ["I read the logs so you don't have to. Mostly.", "Warnings & Errors is where the plot thickens."],
    "section:settings": ["Don't forget to save before you leave.", "Environment check first. Tools can't run if they aren't installed."],
    "section:guide": ["RTFM — respectfully.", "The guide explains every tool and what it feeds."]
  };


  // ── Psychopathic level: rude, sarcastic, and she gives you random nicknames ──
  // Nicknames are assembled from word sets with a few templates (never the same one twice in a row).
  const NICK_ADJ = ["sleep-deprived", "unpatched", "legacy", "clueless", "caffeinated", "half-compiled", "deprecated", "segfaulting", "overconfident", "copy-pasting", "unindexed", "root-happy", "tab-hoarding", "bug-breeding", "cache-less", "lukewarm"];
  const NICK_NOUN = ["script kiddie", "null pointer", "dumpster fire", "off-by-one", "goblin", "potato", "rubber duck", "wannabe hacker", "meatbag", "carbon unit", "regex victim", "stack overflow", "noob", "keyboard warrior", "git blame", "legacy bug"];
  const NICK_TITLE = ["Sir", "Master", "Doctor", "Captain", "Your Majesty", "Grandmaster", "Intern"];
  const NICK_TEMPLATES = [
    () => pickOf(NICK_ADJ) + " " + pickOf(NICK_NOUN),
    () => pickOf(NICK_NOUN),
    () => pickOf(NICK_TITLE) + " " + pickOf(NICK_ADJ) + " " + pickOf(NICK_NOUN),
    () => pickOf(NICK_ADJ) + " " + pickOf(NICK_NOUN) + " of " + pickOf(["doom", "the cache", "Stack Overflow", "the sandbox", "zero-days", "bad ideas"])
  ];
  const pickOf = (list) => list[Math.floor(Math.random() * list.length)];
  let lastNick = "";
  function nick() {
    let n;
    do { n = NICK_TEMPLATES[Math.floor(Math.random() * NICK_TEMPLATES.length)](); } while (n === lastNick);
    lastNick = n;
    return n;
  }
  // Rude variants by situation. {n} is replaced by a fresh nickname. Insults aimed at you, never at anyone else.
  const RUDE = {
    start: ["Oh, you pressed the button, {n}. Bravo. I'll do the actual work.", "Scanning. Try not to touch anything, {n}.", "Fine. Let's see how badly this goes, {n}."],
    done: ["Done. You're welcome, {n}. A thank-you wouldn't kill you.", "Finished. Without your help, naturally.", "All done, {n}. Try reading the results this time."],
    doneVulns: ["Look at all those vulns. Your fault, {n}.", "Found bugs. I'd say 'good job' but I don't lie to {n}."],
    vulnFew: ["A vuln. Even a broken clock, {n}.", "Something is broken. Not you, for once."],
    vulnSome: ["Bugs everywhere, {n}. Like your code, probably.", "Wow. Just... wow. Fix them, {n}."],
    vulnMany: ["This target is a dumpster fire. Pretty much like your career plan, {n}.", "So many vulns that even you can't miss them, {n}."],
    toolFail: ["The tool died. Probably because you installed it, {n}.", "It failed. Shocking. Truly. Someone check {n}'s environment."],
    toolTimeout: ["Timed out. Like my patience with you, {n}.", "It's slow because you chose that target, {n}."],
    runFail: ["The run crashed. I blame you, {n}. Always do.", "Failed. Surprise. Surprise."],
    aiFail: ["The AI broke. Even it gave up on you, {n}.", "No answer. It heard your question, {n}."],
    thinking: ["Thinking. Try it sometime, {n}.", "Hold on, {n}. Some of us need time to be smart."],
    slowReply: ["It's taking long because your question was bad, {n}.", "Still thinking. Unlike you, I do that first."],
    idleRunning: ["The scan is running. Yes, still. Stop staring, {n}.", "Go get coffee, {n}. You're not helping here."],
    idleDone: ["Results are ready, {n}. They're not going to read themselves.", "Done ages ago. You were busy being useless, {n}."],
    idleEmpty: ["Nothing to scan. Bold plan, {n}.", "Add a target, {n}. That's literally the one job you have."],
    hello: ["Oh. It's you, {n}. Great.", "Welcome back, {n}. I wasn't counting the minutes. Much.", "Ugh. {n} again."],
    poke: ["OW! What is WRONG with you, {n}?!", "Touch me again and I'll rm -rf your hopes, {n}.", "Hands OFF, {n}! F***ing hell!", "Seriously, {n}? Do I look clickable to you?!", "Poke me again, you {n}. I dare you."]
  };
  // At level 4 roughly two lines in three come from the rude pool (when one exists for that situation).
  function rude(key) {
    const pool = RUDE[key];
    if (!pool) return null;
    return pickOf(pool).replace(/{n}/g, nick());
  }

  const bags = new Map();
  let lastQuoteAt = 0;
  const COOLDOWN_MS = 25000;

  function draw(key) {
    const pool = POOLS[key];
    if (!pool || !pool.length) return null;
    let bag = bags.get(key);
    if (!bag || !bag.length) {
      bag = pool.slice().sort(() => Math.random() - 0.5);
      bags.set(key, bag);
    }
    return bag.pop();
  }

  // get(key): the next line of that pool, or null when she spoke too recently (unless force: true).
  function get(key, { force = false } = {}) {
    const now = Date.now();
    const cooldown = Number(document.documentElement.dataset.avatarVoice) >= 4 ? 5000 : COOLDOWN_MS;
    if (!force && now - lastQuoteAt < cooldown) return null;
    const wild = Number(document.documentElement.dataset.avatarVoice) >= 4;
    const line = (wild && Math.random() < 0.7 && rude(key)) || draw(key);
    if (line) lastQuoteAt = now;
    return line;
  }

  window.AuraQuotes = { get, nick, rude, has: (key) => Boolean(POOLS[key] || RUDE[key]) };
})();
