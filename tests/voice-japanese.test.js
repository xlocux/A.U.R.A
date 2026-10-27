"use strict";

// AURI's battle cries are said with Japanese sounds: romaji -> IPA, and Japanese words found inside English lines.

const assert = require("node:assert/strict");
const test = require("node:test");
const { romajiToIpa, wordToIpa, segments } = require("../src/web/services/voice-japanese");

test("romaji becomes Japanese phonemes", () => {
  assert.equal(wordToIpa("kamehameha"), "kamehameha");
  assert.equal(wordToIpa("shinjuu"), "ɕinʥɯː"); // shi, moraic n, ju, long u
  assert.equal(wordToIpa("kyoukotsu"), "kjoːkoʦɯ"); // palatal k, "ou" is a long o, tsu
  assert.equal(wordToIpa("yatta"), "jaʔta"); // small tsu
  assert.equal(wordToIpa("bankai"), "baŋkai"); // n before k
  assert.equal(wordToIpa("rinnegan"), "ɾinneɡaɴ"); // tapped r, final moraic n
  assert.equal(wordToIpa("fifusu"), "ɸiɸɯsɯ");
  assert.equal(wordToIpa("chidori"), "ʨidoɾi");
});

test("stretched cries keep their long vowels (Luffy: gooomu gooomu no bazuuuuka)", () => {
  assert.equal(romajiToIpa("goooomu goooomu no... bazuuuuka!!", "kokoro"), "ˈɡoːːmɯ ˈɡoːːmɯ no... ˈbazɯːːka!!");
  assert.equal(romajiToIpa("goooomu goooomu no... erefanto gaaaan!!", "piper"), "ˈɡoːːmɯ ˈɡoːːmɯ no... ˈeɾeɸanto ˈɡaːːɴ!!");
  assert.equal(wordToIpa("reddo"), "ɾeʔdo");
});

test("cries keep their punctuation, get stress marks and fit each engine", () => {
  assert.equal(romajiToIpa("kamehamehaaaa!!"), "ˈkamehamehaːː!!"); // a stretched vowel gets at most two marks
  assert.equal(romajiToIpa("kage bunshin no jutsu", "kokoro"), "ˈkaɡe ˈbɯnɕiɴ no ˈʥɯʦɯ"); // particles unstressed
  assert.equal(romajiToIpa("kage bunshin no jutsu", "piper"), "ˈkaɡe ˈbɯnɕiɴ no ˈdʑɯʦɯ"); // Piper has no ligatures
});

test("only the Japanese words of an English line change language", () => {
  assert.deepEqual(segments("YATTAAA Found one"), [{ ja: true, text: "YATTAAA" }, { ja: false, text: "Found one" }]);
  assert.deepEqual(segments("Kage Bunshin no Jutsu is my move"), [{ ja: true, text: "Kage Bunshin no Jutsu" }, { ja: false, text: "is my move" }]);
  assert.deepEqual(segments("no way, I said no"), [{ ja: false, text: "no way, I said no" }]);
  assert.deepEqual(segments("pisutoru now", true), [{ ja: true, text: "pisutoru now" }]);
});
