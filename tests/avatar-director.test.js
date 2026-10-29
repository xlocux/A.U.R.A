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
  assert.deepEqual(found.say, ["Hold on, I know a shortcut.", 'She said "hi" and left.', "Reconstructing... done.", "Too slow!", "Missed me!"]);
  assert.deepEqual(found.loud, ["That's it. I'm leaving."]); // a tantrum ghost's lines are yelled: prepared loud
  assert.deepEqual(found.cries, ["KAMEHAMEHA"]);
  assert.deepEqual(found.quotes, [["Wormhole engaged.", "gag:wormhole"]]);
});

test("cryLine shouts known moves in Japanese and the others in English", () => {
  assert.deepEqual(cryLine("KAMEHAMEHA"), ["kameeehameeehaaaa!!", "shout", "ja"]);
  assert.deepEqual(cryLine("HANA HANA NO... MIL FLEUR!"), ["haaana haaana no... miru furuuuuru!!", "shout", "ja"]);
  assert.deepEqual(cryLine("FOUND IT!"), ["FOUND IIIIT!!", "shout", ""]);
});

test("perform: on stage only once running; a carry preempts a gag still waiting for the floor", async () => {
  const calls = [];
  let floorFree;
  globalThis.AuraSpeech = {
    hold: (id) => calls.push(["hold", id]),
    release: (id) => calls.push(["release", id]),
    quiet: () => new Promise((resolve) => { floorFree = () => resolve(true); }),
    prepare: async () => ({ ready: 0, missing: 0 }),
    emotionFor: () => "neutral",
    speak: () => ({ id: 1, started: Promise.resolve(10), ended: Promise.resolve() })
  };
  globalThis.AuraAvatar = { canStage: () => true, stage: async (run) => { await run({}); return true; } };
  const D = globalThis.AuraDirector;
  const gag = D.perform("gag", async () => {});
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(D.isPerforming(), false);
  let onStage = false;
  assert.equal(await D.perform("carry", async () => { onStage = D.isPerforming(); }, { interactive: true, immediate: true }), true);
  assert.equal(onStage, true);
  floorFree();
  assert.equal(await gag, false);
  assert.equal(D.isPerforming(), false);
  assert.equal(calls.filter((c) => c[0] === "hold").length, 2);
  delete globalThis.AuraSpeech;
  delete globalThis.AuraAvatar;
});
