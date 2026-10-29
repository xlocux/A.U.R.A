"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractLines, cryLine } = require("../public/web/avatar-director.js");

test("extractLines finds the literal lines a script will say", () => {
  async function gag(s) {
    s.say("Hold on, I know a shortcut.", { min: 2600 });
    await s.say('She said "hi" and left.');
    await s.line("Reconstructing... done.", 1500);
    s.say(`built ${1 + 1} at run time`);
    s.say("ok");
    await s.cry("KAMEHAMEHA");
    s.say(s.quote("Wormhole engaged.", "gag:wormhole"));
    s.say(s.pick(["Too slow!", "Missed me!"]));
    g.say("That's it. I'm leaving.", 1700);
    s.say("Hold on, I know a shortcut.");
  }
  const found = extractLines(gag);
  assert.deepEqual(found.say, ["Hold on, I know a shortcut.", 'She said "hi" and left.', "Reconstructing... done.", "That's it. I'm leaving.", "Too slow!", "Missed me!"]);
  assert.deepEqual(found.cries, ["KAMEHAMEHA"]);
  assert.deepEqual(found.quotes, [["Wormhole engaged.", "gag:wormhole"]]);
});

test("cryLine shouts known moves in Japanese and the others in English", () => {
  assert.deepEqual(cryLine("KAMEHAMEHA"), ["kameeehameeehaaaa!!", "shout", "ja"]);
  assert.deepEqual(cryLine("HANA HANA NO... MIL FLEUR!"), ["haaana haaana no... miru furuuuuru!!", "shout", "ja"]);
  assert.deepEqual(cryLine("FOUND IT!"), ["FOUND IIIIT!!", "shout", ""]);
});
