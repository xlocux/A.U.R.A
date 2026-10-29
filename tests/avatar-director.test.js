"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { extractLines, cryLine } = require("../public/web/avatar-director.js");
const { createSpeechQueue } = require("../public/web/avatar-speech-queue.js");

const AVATAR_SRC = fs.readFileSync(path.join(__dirname, "../public/web/ai-avatar.js"), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 3000) {
  const t0 = Date.now();
  while (!check()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(5); }
}

// A speech queue with a fake player: a voiced line "plays" for playMs and can be cut.
function fakeVoice({ playMs = 30 } = {}) {
  const events = [];
  let cutNow = null;
  const q = createSpeechQueue({
    gapMs: [20, 20, 20, 20, 20], budget: [0, 0, 8, 8, 8], level: () => 2, estimate: () => 20,
    emit: (e) => events.push(e),
    cut: () => { if (cutNow) cutNow(); },
    play: (item, onStart) => new Promise((resolve) => {
      onStart(playMs);
      const timer = setTimeout(() => { cutNow = null; resolve({}); }, playMs);
      cutNow = () => { clearTimeout(timer); cutNow = null; resolve({ cut: true }); };
    })
  });
  return { q, starts: () => events.filter((e) => e.phase === "start").map((e) => e.text) };
}

// ai-avatar.js in a vm with a fake page: one visible home avatar; `speak` stands in for AuraSpeech.speak. Her timers
// are tracked, so dispose() ends her idle life (blinks, quips, dozing off) when the test is over; unref'd, so a failed
// test that never reaches dispose() does not hang the run.
function loadAvatar({ speak }) {
  const timers = new Set();
  const track = (t) => { timers.add(t); t.unref(); return t; };
  const fakeEl = (attrs = {}) => {
    const classes = new Set(), on = {};
    return {
      attrs, on, dataset: {}, style: { setProperty() {} }, innerHTML: "", className: "",
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), toggle: (c, v = !classes.has(c)) => (v ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) },
      setAttribute(k, v) { attrs[k] = v; },
      addEventListener(type, fn) { on[type] = fn; },
      getClientRects: () => [{}],
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 146, bottom: 152, width: 46, height: 52 }),
      animate: () => ({ finished: Promise.resolve(), cancel() {} }),
      getAnimations: () => []
    };
  };
  const home = fakeEl({ "data-ai-avatar": "" });
  const nodes = [home], clicks = [];
  const document = {
    readyState: "complete", hidden: false,
    documentElement: { dataset: { avatarVoice: "2" } },
    body: { appendChild: (n) => nodes.push(n), append: (...n) => nodes.push(...n) },
    createElement: () => fakeEl(),
    querySelectorAll: (sel) => (sel === "[data-ai-avatar]" ? nodes.filter((n) => "data-ai-avatar" in n.attrs) : []),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: (type, fn) => { if (type === "click") clicks.push(fn); }
  };
  const page = {
    document, console, innerWidth: 1280, innerHeight: 800,
    sessionStorage: { getItem: () => "1", setItem() {} }, // her hello was said already this session
    matchMedia: () => ({ matches: false }), MutationObserver: class { observe() {} }, Element: class {},
    addEventListener() {}, requestAnimationFrame: (fn) => track(setTimeout(fn, 0)),
    setTimeout: (fn, ms) => track(setTimeout(fn, ms)), clearTimeout,
    setInterval: (fn, ms) => track(setInterval(fn, ms)), clearInterval,
    AuraSpeech: { speak }
  };
  page.window = page;
  vm.runInNewContext(AVATAR_SRC, page);
  return {
    window: page, AuraAvatar: page.AuraAvatar, home,
    roamer: () => nodes.find((n) => n.className === "ai-avatar-roamer"),
    click: (el) => clicks.forEach((fn) => fn({ target: { closest: (sel) => (sel === "[data-ai-avatar]" ? el : null) } })),
    dispose: () => timers.forEach((t) => clearTimeout(t))
  };
}
// a speak() that records every line and its options
function recorder() {
  const said = [];
  const speak = (text, opts) => { said.push({ text, ...opts }); return { id: said.length, started: Promise.resolve(10), ended: Promise.resolve(), voiced: true }; };
  return { said, speak };
}

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

test("extractLines skips bubble-only captions (voice: false): no audio is prepared for them", () => {
  async function gag(s, g) {
    s.say("Kage Bunshin no Jutsu!", { voice: false, min: 1800 });
    await s.say('Kai!', { min: 1, voice : false });
    await s.line("Silent caption here.", { voice: false });
    g.say("Ghost caption.", { voice: false });
    s.say("Spoken line here.", { min: 1800 });
    s.say("Another spoken one.", { voice: true });
    s.say("Flag line here.", { voice: falseFlag }); // not the literal false: spoken
  }
  const found = extractLines(gag);
  assert.deepEqual(found.say, ["Spoken line here.", "Another spoken one.", "Flag line here."]);
  assert.deepEqual(found.loud, []);
});

test("cryLine shouts known moves in Japanese and the others in English", () => {
  assert.deepEqual(cryLine("KAMEHAMEHA"), ["kameeehameeehaaaa!!", "shout", "ja"]);
  assert.deepEqual(cryLine("HANA HANA NO... MIL FLEUR!"), ["haaana haaana no... miru furuuuuru!!", "shout", "ja"]);
  assert.deepEqual(cryLine("FOUND IT!"), ["FOUND IIIIT!!", "shout", ""]);
});

test("a forced line that is not a poke waits its turn: the line in progress is not cut", async () => {
  const { q, starts } = fakeVoice({ playMs: 80 });
  const page = loadAvatar({ speak: (text, opts) => q.enqueue(text, opts) });
  page.AuraAvatar.say("A remark about the run.", 50);
  await sleep(20);
  page.AuraAvatar.say("Vulnerabilities detected!", 50, true); // important news: forced, but not a poke
  await until(() => starts().length >= 2);
  await sleep(150);
  assert.deepEqual(starts(), ["A remark about the run.", "Vulnerabilities detected!"]); // the remark was not cut and said again
  page.dispose();
});

test("a poke on her walk cuts in with a pain bubble; the walk's line does not", async () => {
  const { said, speak } = recorder();
  const page = loadAvatar({ speak });
  page.AuraAvatar.roamTo({ x: 300, y: 200 }, { text: "Exploring the pipeline.", stay: 200 });
  await sleep(10);
  page.roamer().on.click();
  const walk = said.find((l) => l.text === "Exploring the pipeline.");
  const poke = said.find((l) => l.bubble && l.bubble.pain);
  assert.ok(!walk.cutIn);
  assert.equal(poke.cutIn, true);
  assert.equal(poke.forced, true);
  assert.equal(poke.kind, "poke"); // waiting pokes replace each other: she answers the newest
  page.dispose();
});

test("a click on her home avatar is a forced line, not a cut-in", () => {
  const { said, speak } = recorder();
  const page = loadAvatar({ speak });
  page.click(page.home);
  assert.equal(said.length, 1);
  assert.equal(said[0].forced, true);
  assert.ok(!said[0].cutIn);
  page.dispose();
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
