"use strict";

// Japanese for AURI's voice: anime battle cries and the odd "Yatta!" are said with Japanese sounds instead of
// English ones. Romaji (Hepburn) becomes the IPA the Kokoro / Piper models read: pure vowels, the tapped r,
// moraic n, long vowels, shi / chi / tsu / fu, small tsu.
//   romajiToIpa("kamehamehaaa!!", "piper") -> "ˈkamehamehaːː!!"
// English lines may contain Japanese words (yatta, sugoi, nani...): segments() finds them so only those words
// change language.

const VOWELS = { a: "a", i: "i", u: "ɯ", e: "e", o: "o" };
const CONSONANTS = { k: "k", g: "ɡ", s: "s", z: "z", t: "t", d: "d", n: "n", h: "h", b: "b", p: "p", m: "m", r: "ɾ", l: "ɾ", w: "w", v: "b", c: "k" };
// Piper's symbol table has no affricate ligatures: spell them out.
const PIPER_FIX = { "ʨ": "tɕ", "ʥ": "dʑ" };

function wordToIpa(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, "");
  let out = "", i = 0, lastVowel = "";
  while (i < w.length) {
    const ch = w[i], next = w[i + 1] || "";
    if (VOWELS[ch]) {
      // the same vowel again (or "ou") is a long vowel; a stretched cry gets at most two length marks
      if (lastVowel && (ch === lastVowel || (lastVowel === "o" && ch === "u"))) { if (!out.endsWith("ːː")) out += "ː"; i += 1; continue; }
      out += VOWELS[ch];
      lastVowel = ch;
      i += 1;
      continue;
    }
    lastVowel = "";
    // moraic n: before a consonant or at the end of the word
    if (ch === "n" && (next === "" || !"aiueoy".includes(next))) { out += next === "" ? "ɴ" : "bpm".includes(next) ? "m" : "kg".includes(next) ? "ŋ" : "n"; i += 1; continue; }
    // small tsu (a doubled consonant, or "tch"): a short stop
    if ((ch === next && ch !== "n") || (ch === "t" && next === "c")) { out += "ʔ"; i += 1; continue; }
    if (ch === "s" && next === "h") { out += "ɕ"; i += 2; continue; }
    if (ch === "c" && next === "h") { out += "ʨ"; i += 2; continue; }
    if (ch === "t" && next === "s") { out += "ʦ"; i += 2; continue; }
    if (ch === "j" || (ch === "z" && next === "i")) { out += "ʥ"; i += ch === "j" && next === "y" ? 2 : 1; continue; }
    if (ch === "s" && next === "i") { out += "ɕ"; i += 1; continue; }
    if (ch === "f" || (ch === "h" && next === "u")) { out += "ɸ"; i += 1; continue; }
    if (ch === "y") { out += "j"; i += 1; continue; }
    if (CONSONANTS[ch]) { out += CONSONANTS[ch] + (next === "y" ? "j" : ""); i += next === "y" ? 2 : 1; continue; }
    i += 1; // anything else is not Japanese: skip it
  }
  return out;
}

const PARTICLES = new Set(["no", "wa", "ga", "wo", "ni", "de", "mo", "to"]);

// Romaji words -> IPA (each word but the particles gets a stress mark, as the models expect); punctuation and spaces
// are kept.
function romajiToIpa(text, engine = "kokoro") {
  let ipa = String(text).replace(/[A-Za-z]+/g, (word) => (PARTICLES.has(word.toLowerCase()) ? "" : "ˈ") + wordToIpa(word));
  if (engine === "piper") ipa = ipa.replace(/[ʨʥ]/g, (c) => PIPER_FIX[c]);
  return ipa;
}

// Japanese words AURI uses inside English lines. No English homographs here ("no", "san" and the like are left
// out); particles are taken only between two Japanese words ("Kage Bunshin no Jutsu").
const LEXICON = new Set([
  "yatta", "sugoi", "sugee", "nani", "baka", "banzai", "kawaii", "kakkoii", "senpai", "sensei", "nakama", "dattebayo",
  "kamehameha", "hadouken", "shoryuken", "rasengan", "chidori", "kyuubi", "sharingan", "mangekyou", "mangekyo", "byakugan",
  "rinnegan", "tsukuyomi", "amaterasu", "susanoo", "kage", "bunshin", "jutsu", "gomu", "haki", "haoshoku", "bankai", "shikai",
  "katen", "kyoukotsu", "kyokotsu", "karamatsu", "shinjuu", "shinju", "arigatou", "arigato", "gomen", "gomennasai",
  "itadakimasu", "konnichiwa", "sayonara", "ohayou", "yamete", "kudasai", "ganbatte", "yosh", "yoshi", "omae", "shindeiru", "kimochi", "desu"
]);
// "YATTAAA" -> "yatta": a stretched last vowel still finds the word
const baseOf = (word) => word.toLowerCase().replace(/([aeiou])\1+$/, "$1");

// Splits a chunk of words into runs: [{ ja: true, text: "Kage Bunshin no Jutsu" }, { ja: false, text: "is my move" }].
function segments(text, allJapanese = false) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (allJapanese) return words.length ? [{ ja: true, text: words.join(" ") }] : [];
  const isJa = words.map((w) => LEXICON.has(baseOf(w.replace(/[^A-Za-z]/g, ""))));
  for (let i = 1; i < words.length - 1; i += 1) {
    if (!isJa[i] && PARTICLES.has(words[i].toLowerCase()) && isJa[i - 1] && isJa[i + 1]) isJa[i] = true;
  }
  const runs = [];
  words.forEach((word, i) => {
    const last = runs[runs.length - 1];
    if (last && last.ja === isJa[i]) last.text += " " + word;
    else runs.push({ ja: isJa[i], text: word });
  });
  return runs;
}

module.exports = { romajiToIpa, wordToIpa, segments, LEXICON };
