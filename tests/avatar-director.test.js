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

test("perform: extra lines are prepared with the script's own (the rage says a list, not literals)", async () => {
  let prepared = null;
  globalThis.AuraSpeech = {
    hold: () => {},
    release: () => {},
    quiet: async () => true,
    prepare: async (lines) => { prepared = lines; return { ready: lines.length, missing: 0 }; },
    emotionFor: () => "neutral",
    speak: () => ({ id: 1, started: Promise.resolve(10), ended: Promise.resolve() })
  };
  globalThis.AuraAvatar = { canStage: () => true };
  const extra = { text: "EXTRA LINE", emotion: "rage", loud: true };
  const scene = async (s) => { await s.say("Own line."); };
  assert.equal(await globalThis.AuraDirector.perform("x", scene, { stage: false, lines: [extra] }), true);
  assert.deepEqual(prepared.find((l) => l.text === "EXTRA LINE"), extra);
  assert.ok(prepared.some((l) => l.text === "Own line."));
  delete globalThis.AuraSpeech;
  delete globalThis.AuraAvatar;
});

test("rollsFor: the quotes rolled ahead (start-up) are the ones perform prepares and says, until the gag is performed", async () => {
  let rolled = 0, prepared = null, said = null;
  globalThis.AuraQuotes = { get: () => "QUOTE" + (rolled += 1) };
  globalThis.AuraSpeech = {
    hold: () => {},
    release: () => {},
    quiet: async () => true,
    prepare: async (lines) => { prepared = lines; return { ready: lines.length, missing: 0 }; },
    emotionFor: () => "neutral",
    speak: (text) => { said = text; return { id: 1, started: Promise.resolve(10), ended: Promise.resolve() }; }
  };
  globalThis.AuraAvatar = { canStage: () => true };
  const D = globalThis.AuraDirector;
  const gag = async (s) => { await s.say(s.quote("Hello there.", "gag:x")); };
  const ahead = D.linesFor(gag, D.rollsFor("rolled-ahead"));
  assert.deepEqual(ahead.map((l) => l.text), ["Hello there.\nQUOTE1"]);
  assert.equal(D.rollsFor("rolled-ahead"), D.rollsFor("rolled-ahead")); // the same roll until it is performed
  assert.equal(await D.perform("rolled-ahead", gag, { stage: false }), true);
  assert.ok(prepared.some((l) => l.text === "Hello there.\nQUOTE1")); // prepared and said: the quote rolled ahead
  assert.equal(said, "Hello there.\nQUOTE1");
  assert.equal(rolled, 1);
  assert.equal(D.rollsFor("rolled-ahead").size, 0); // performed: new quotes next time (no prefetch in this stub, so none are rolled ahead)
  delete globalThis.AuraQuotes;
  delete globalThis.AuraSpeech;
  delete globalThis.AuraAvatar;
});

test("perform: a refused gag keeps its roll; a performed one rolls the next quotes and prepares them in the background", async () => {
  let rolled = 0, missing = 1, prefetched = null, said = null;
  globalThis.AuraQuotes = { get: () => "QUOTE" + (rolled += 1) };
  globalThis.AuraSpeech = {
    hold: () => {},
    release: () => {},
    quiet: async () => true,
    prepare: async () => ({ ready: 0, missing }),
    emotionFor: () => "neutral",
    prefetch: (list) => { prefetched = list; },
    speak: (text) => { said = text; return { id: 1, started: Promise.resolve(10), ended: Promise.resolve() }; }
  };
  globalThis.AuraAvatar = { canStage: () => true };
  const D = globalThis.AuraDirector;
  const gag = async (s) => { await s.say(s.quote("Hello there.", "gag:y")); };
  const before = D.rollsFor("kept");
  assert.equal(await D.perform("kept", gag, { stage: false }), false); // its lines are not ready: refused
  assert.equal(D.rollsFor("kept"), before); // the roll is kept for the next try
  assert.equal(before.get("Hello there.|gag:y"), "QUOTE1");
  assert.equal(rolled, 1);
  assert.equal(prefetched, null);
  missing = 0;
  assert.equal(await D.perform("kept", gag, { stage: false }), true);
  assert.equal(said, "Hello there.\nQUOTE1"); // the kept roll is the one she says
  assert.notEqual(D.rollsFor("kept"), before); // performed: a new roll for the next performance...
  assert.equal(D.rollsFor("kept").get("Hello there.|gag:y"), "QUOTE2");
  assert.deepEqual(prefetched, [["Hello there.\nQUOTE2", "neutral", ""]]); // ...prepared in the background
  delete globalThis.AuraQuotes;
  delete globalThis.AuraSpeech;
  delete globalThis.AuraAvatar;
});
