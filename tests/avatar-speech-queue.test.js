"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSpeechQueue } = require("../public/web/avatar-speech-queue.js");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const VOICE_SRC = fs.readFileSync(path.join(__dirname, "../public/web/avatar-voice.js"), "utf8");
// avatar-voice.js in a vm with a fake page: the voice is on with the Kokoro pack installed. Every text sent to
// /api/voice/speak is listed in `asked`; `answer(text, audio)` gives the server's response (audio() = a short line).
// Timers are unref'd: a failed test must not hang the run.
function loadVoice({ level = 2, answer = (text, audio) => audio() } = {}) {
  const asked = [];
  const timers = new Set();
  const track = (t) => { timers.add(t); t.unref(); return t; };
  const audio = () => ({ ok: true, status: 200, headers: { get: (k) => (k === "X-Sample-Rate" ? "24000" : null), has: () => false }, arrayBuffer: async () => new ArrayBuffer(4 * 240) });
  class FakeAudioContext {
    constructor() { this.state = "running"; this.destination = {}; this.outputLatency = 0; this.baseLatency = 0; }
    resume() { return Promise.resolve(); }
    createBuffer() { return { copyToChannel() {} }; }
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    createBufferSource() { const src = { playbackRate: { value: 1 }, connect() {}, start: () => track(setTimeout(() => src.onended && src.onended(), 10)), stop() {} }; return src; }
  }
  const page = {
    console, AbortSignal, navigator: {}, AudioContext: FakeAudioContext,
    AuraSpeechQueue: require("../public/web/avatar-speech-queue.js"),
    document: { hidden: false, documentElement: { dataset: { avatarVoice: String(level) } }, addEventListener() {} },
    localStorage: { getItem: (k) => (k === "aura.speech" ? JSON.stringify({ on: true, engine: "kokoro", voice: "auto" }) : "1"), setItem() {} },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: () => true,
    setTimeout: (fn, ms) => track(setTimeout(fn, ms)), clearTimeout,
    setInterval: (fn, ms) => track(setInterval(fn, ms)), clearInterval,
    fetch: async (url, init = {}) => {
      if (url === "/api/voice/status") return { ok: true, json: async () => ({ packs: [{ id: "kokoro", engine: "kokoro", installed: true }], kokoroVoices: ["jf_tebukuro"], job: null }) };
      const { text } = JSON.parse(init.body);
      asked.push(text);
      return answer(text, audio);
    }
  };
  page.window = page;
  vm.runInNewContext(VOICE_SRC, page);
  const S = page.AuraSpeech;
  return {
    S, asked,
    ready: () => until(() => S.info().pack === "kokoro"), // the first /api/voice/status has answered
    dispose: () => { S.stop(); timers.forEach((t) => clearTimeout(t)); }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, ms = 3000) {
  const t0 = Date.now();
  while (!check()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(5); }
}

// A queue with a fake player: a voiced line "plays" for playMs and can be cut. Every event is recorded with its time.
function rig({ lvl = 2, playMs = 30, gapMs = [40, 40, 40, 40, 40], budget = [0, 0, 3, 5, 8] } = {}) {
  const events = [];
  const t0 = Date.now();
  let cutNow = null;
  const q = createSpeechQueue({
    gapMs, budget, level: () => lvl, estimate: () => 20,
    emit: (e) => events.push({ ...e, t: Date.now() - t0 }),
    cut: () => { if (cutNow) cutNow(); },
    play: (item, onStart) => new Promise((resolve) => {
      onStart(playMs);
      const timer = setTimeout(() => { cutNow = null; resolve({}); }, playMs);
      cutNow = () => { clearTimeout(timer); cutNow = null; resolve({ cut: true }); };
    })
  });
  const starts = () => events.filter((e) => e.phase === "start").map((e) => e.text);
  return { q, events, starts };
}

test("chatter lines play one at a time, in order, with a breathing gap", async () => {
  const { q, events, starts } = rig();
  const a = q.enqueue("first line");
  const b = q.enqueue("second line");
  await Promise.all([a.ended, b.ended]);
  assert.deepEqual(starts(), ["first line", "second line"]);
  const endA = events.find((e) => e.phase === "end" && e.text === "first line").t;
  const startB = events.find((e) => e.phase === "start" && e.text === "second line").t;
  assert.ok(startB - endA >= 38, `gap was ${startB - endA} ms`);
});

test("over budget a chatter line becomes a silent bubble, never lost; forced lines always speak", async () => {
  const { q, events } = rig({ budget: [0, 0, 2, 2, 2] });
  const hs = ["one", "two", "three", "four"].map((t) => q.enqueue(t));
  const forced = q.enqueue("forced news", { forced: true });
  await Promise.all([...hs, forced].map((h) => h.ended));
  assert.equal(events.filter((e) => e.phase === "start").length, 5);
  assert.deepEqual([...hs, forced].map((h) => h.voiced), [true, true, false, false, true]);
});

test("while a performance holds the stage only its lines play; chatter waits for the release", async () => {
  const { q, starts } = rig();
  q.hold(7);
  const chatter = q.enqueue("chatter");
  q.enqueue("show one", { lane: "show", show: 7 });
  const two = q.enqueue("show two", { lane: "show", show: 7 });
  await two.ended;
  assert.deepEqual(starts(), ["show one", "show two"]);
  q.release(7);
  await chatter.ended;
  assert.deepEqual(starts(), ["show one", "show two", "chatter"]);
});

test("release drops the show lines that never started", async () => {
  const { q, starts } = rig({ playMs: 60 });
  q.hold(3);
  q.enqueue("said", { lane: "show", show: 3 });
  const left = q.enqueue("left behind", { lane: "show", show: 3 });
  q.release(3);
  assert.equal(await left.started, 0);
  await left.ended;
  await sleep(120);
  assert.deepEqual(starts(), ["said"]);
});

test("a newer line of the same kind replaces the waiting one", async () => {
  const { q, starts } = rig();
  const busy = q.enqueue("busy talking");
  const a = q.enqueue("Scanning 10%", { kind: "status" });
  const b = q.enqueue("Scanning 50%", { kind: "status" });
  await Promise.all([busy.ended, a.ended, b.ended]);
  assert.deepEqual(starts(), ["busy talking", "Scanning 50%"]);
});

test("a line cut by a poke is said again once; cut a second time, the rest is shown silently", async () => {
  const { q, starts } = rig({ playMs: 80 });
  const long = q.enqueue("a long chatter line");
  await sleep(20);
  q.enqueue("Ow!", { forced: true, cutIn: true });
  await until(() => starts().filter((t) => t === "a long chatter line").length === 2);
  q.enqueue("Ouch!", { forced: true, cutIn: true });
  await long.ended;
  assert.deepEqual(starts(), ["a long chatter line", "Ow!", "a long chatter line", "Ouch!", "a long chatter line"]);
  assert.equal(long.voiced, false);
});

test("three rapid pokes: each answer is cut by the next and just ends; only the newest is said in full, nothing twice", async () => {
  const { q, starts } = rig({ playMs: 80 });
  const poke = (text) => q.enqueue(text, { forced: true, cutIn: true, kind: "poke" });
  const p1 = poke("Ow!");
  await sleep(20);
  const p2 = poke("Ouch!");
  await sleep(20);
  const p3 = poke("Hey!");
  const later = q.enqueue("a later remark");
  await Promise.all([p1, p2, p3, later].map((h) => h.ended));
  assert.deepEqual(starts(), ["Ow!", "Ouch!", "Hey!", "a later remark"]);
});

test("a poke while a performance holds the stage waits; pokes waiting together are said once, the newest", async () => {
  const { q, starts } = rig({ playMs: 60 });
  q.hold(5);
  const show = q.enqueue("show line", { lane: "show", show: 5 });
  await show.started;
  const p1 = q.enqueue("Ow!", { forced: true, cutIn: true, kind: "poke" });
  const p2 = q.enqueue("Ouch!", { forced: true, cutIn: true, kind: "poke" });
  await show.ended;
  assert.deepEqual(starts(), ["show line"]); // the show line was not cut
  q.release(5);
  await Promise.all([p1.ended, p2.ended]);
  assert.deepEqual(starts(), ["show line", "Ouch!"]);
});

test("dropKind() forgets the waiting lines of that kind (the pokes that made the rage are not answered after it)", async () => {
  const { q, starts } = rig({ playMs: 40 });
  q.hold(7);
  const poke = q.enqueue("Ow!", { forced: true, cutIn: true, kind: "poke" });
  const remark = q.enqueue("a remark");
  q.dropKind("poke");
  await poke.ended; // settled, never said
  q.release(7);
  await remark.ended;
  assert.deepEqual(starts(), ["a remark"]);
});

test("stop() settles every line", async () => {
  const { q } = rig({ playMs: 200 });
  const a = q.enqueue("one");
  const b = q.enqueue("two");
  q.stop();
  await Promise.all([a.ended, b.ended]);
  assert.equal(await b.started, 0);
  assert.equal(q.idle(), true);
});

test("min keeps the line's slot at least that long", async () => {
  const { q, events } = rig({ playMs: 30 });
  const h = q.enqueue("short", { min: 120 });
  await h.ended;
  const start = events.find((e) => e.phase === "start").t;
  const end = events.find((e) => e.phase === "end").t;
  assert.ok(end - start >= 115, `slot was ${end - start} ms`);
});

// a queue whose estimate for any text is 600 ms and whose voice is down (a voiced line fails at once); `plays` counts
// the lines handed to the player
function silentRig({ budget = [0, 0, 3, 5, 8] } = {}) {
  const events = [];
  const t0 = Date.now();
  const plays = [];
  const q = createSpeechQueue({
    gapMs: [40, 40, 40, 40, 40], budget, level: () => 2, estimate: () => 600,
    emit: (e) => events.push({ ...e, t: Date.now() - t0 }), cut: () => {},
    play: async (item) => { plays.push(item.text); return { failed: true }; }
  });
  const slot = () => events.find((e) => e.phase === "end").t - events.find((e) => e.phase === "start").t;
  return { q, events, slot, plays };
}

test("a silent bubble with an explicit min lasts exactly min (a chant word of 100 ms is not stretched to the estimate)", async () => {
  const { q, events, slot } = silentRig();
  const h = q.enqueue("Ka...", { voice: false, min: 100 });
  await h.ended;
  assert.equal(h.voiced, false);
  assert.ok(slot() >= 95 && slot() <= 300, `slot was ${slot()} ms`);
  assert.ok(events.find((e) => e.phase === "start").ms >= 100);
});

test("a line muted by the setup (muted: true) is never played and keeps its reading time, whatever min says", async () => {
  const { q, slot, plays } = silentRig();
  const h = q.enqueue("a fairly long line of ten words to read here ok", { muted: true, min: 100 });
  await h.ended;
  assert.equal(h.voiced, false);
  assert.deepEqual(plays, []); // not handed to the player: the setup muted it
  assert.ok(slot() >= 590, `slot was ${slot()} ms`); // max(min, estimate), not the 100 ms of a chosen caption
});

test("a silent bubble without min, or silent for another reason, keeps max(min, estimate)", async () => {
  const plain = silentRig();
  await plain.q.enqueue("Just a caption.", { voice: false }).ended;
  assert.ok(plain.slot() >= 590, `no min: slot was ${plain.slot()} ms`);
  const failed = silentRig(); // the voice failed: not a bubble by choice, so min does not shorten it
  await failed.q.enqueue("The voice is down.", { min: 100 }).ended;
  assert.ok(failed.slot() >= 590, `voice failed: slot was ${failed.slot()} ms`);
  const over = silentRig({ budget: [0, 0, 0, 0, 0] }); // over budget: the same
  await over.q.enqueue("Over budget.", { min: 100 }).ended;
  assert.ok(over.slot() >= 590, `over budget: slot was ${over.slot()} ms`);
});

test("a poke right after a line answers at once, without the breathing gap", async () => {
  const { q, events } = rig({ gapMs: [300, 300, 300, 300, 300] });
  const first = q.enqueue("a remark");
  await first.ended;
  const poke = q.enqueue("Ow!", { forced: true, cutIn: true });
  await poke.ended;
  const end = events.find((e) => e.phase === "end" && e.text === "a remark").t;
  const start = events.find((e) => e.phase === "start" && e.text === "Ow!").t;
  assert.ok(start - end < 100, `poke waited ${start - end} ms`);
});

test("a poke ends a silent bubble at once, also when the voice failed", async () => {
  const events = [];
  const t0 = Date.now();
  const q = createSpeechQueue({
    gapMs: [40, 40, 40, 40, 40], budget: [0, 0, 3, 5, 8], level: () => 2, estimate: () => 600,
    emit: (e) => events.push({ ...e, t: Date.now() - t0 }), cut: () => {},
    play: async () => ({ failed: true })
  });
  q.enqueue("the voice is down");
  await sleep(100);
  const poke = q.enqueue("Ow!", { forced: true, cutIn: true });
  await poke.started;
  const start = events.find((e) => e.phase === "start" && e.text === "Ow!").t;
  assert.ok(start < 250, `poke started at ${start} ms`);
  q.stop();
});

test("a show line whose performance is not on stage is settled at once", async () => {
  const { q } = rig();
  const stray = q.enqueue("late line", { lane: "show", show: 9 });
  assert.equal(await stray.started, 0);
  await stray.ended;
  assert.equal(q.idle(), true);
});

test("a listener that throws does not stop the queue", async () => {
  const q = createSpeechQueue({
    gapMs: [10, 10, 10, 10, 10], budget: [0, 0, 3, 5, 8], level: () => 2, estimate: () => 20,
    emit: () => { throw new Error("bubble broke"); }, cut: () => {},
    play: async (item, onStart) => { onStart(10); await sleep(10); return {}; }
  });
  const a = q.enqueue("one");
  const b = q.enqueue("two");
  await Promise.all([a.ended, b.ended]);
  assert.equal(q.idle(), true);
});

test("prepare: a piece the engine failed to make is not missing (it will be a silent bubble); one still being made is", async () => {
  const down = { ok: false, status: 500, json: async () => ({ error: "engine down" }) };
  const v = loadVoice({ answer: (text, audio) => (/fails/.test(text) ? down : /hangs/.test(text) ? new Promise(() => {}) : audio()) });
  await v.ready();
  const failed = await v.S.prepare([{ text: "This line fails.", emotion: "neutral" }], { timeoutMs: 300 });
  assert.deepEqual({ ...failed }, { ready: 0, missing: 0 }); // (spread: the vm's objects have another Object prototype)
  const mixed = await v.S.prepare([{ text: "This line hangs.", emotion: "neutral" }, { text: "This line works.", emotion: "neutral" }], { timeoutMs: 100 });
  assert.deepEqual({ ...mixed }, { ready: 1, missing: 1 });
  v.dispose();
});

test("wouldVoice: a waiting chatter line over budget would be a silent bubble; forced lines always speak", async () => {
  const { q } = rig({ budget: [0, 0, 1, 1, 1], playMs: 60 });
  const one = q.enqueue("one"); // spoken: uses the budget
  q.enqueue("two");
  q.enqueue("news", { forced: true });
  const [news, two] = q.upcoming(2); // forced lines first
  assert.equal(q.wouldVoice(two), false);
  assert.equal(q.wouldVoice(news), true);
  await one.ended;
  q.stop();
});

test("a piece being made is asked from the server once, however many times it is prepared meanwhile", async () => {
  const pending = [];
  const v = loadVoice({ answer: (text, audio) => new Promise((resolve) => pending.push(() => resolve(audio()))) });
  await v.ready();
  const lines = [{ text: "Hold on, I know a shortcut.", emotion: "neutral" }];
  await v.S.prepare(lines, { timeoutMs: 30 }); // not ready in time: the gag is postponed, the piece goes on being made
  const retry = v.S.prepare(lines, { timeoutMs: 1000 }); // the retry while it is still being made
  await sleep(20);
  pending.forEach((answer) => answer());
  assert.equal((await retry).missing, 0);
  assert.equal(v.asked.filter((t) => t === "Hold on, I know a shortcut.").length, 1);
  v.dispose();
});

test("chatter the budget will show silently gets no audio made ahead", async () => {
  const v = loadVoice({ level: 1 }); // level 1: no budget, only forced lines are spoken
  await v.ready();
  v.S.speak("Important news for you.", { forced: true });
  v.S.speak("Just a remark about the scan.");
  v.S.speak("Another remark about the scan.");
  await sleep(50);
  assert.ok(v.asked.includes("Important news for you.")); // the harness does make audio for a spoken line
  assert.ok(!v.asked.includes("Just a remark about the scan."));
  assert.ok(!v.asked.includes("Another remark about the scan."));
  v.dispose();
});
