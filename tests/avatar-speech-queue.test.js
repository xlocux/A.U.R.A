"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSpeechQueue } = require("../public/web/avatar-speech-queue.js");

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

// a queue whose estimate for any text is 600 ms and whose voice is down (a voiced line fails at once)
function silentRig({ budget = [0, 0, 3, 5, 8] } = {}) {
  const events = [];
  const t0 = Date.now();
  const q = createSpeechQueue({
    gapMs: [40, 40, 40, 40, 40], budget, level: () => 2, estimate: () => 600,
    emit: (e) => events.push({ ...e, t: Date.now() - t0 }), cut: () => {},
    play: async () => ({ failed: true })
  });
  const slot = () => events.find((e) => e.phase === "end").t - events.find((e) => e.phase === "start").t;
  return { q, events, slot };
}

test("a silent bubble with an explicit min lasts exactly min (a chant word of 100 ms is not stretched to the estimate)", async () => {
  const { q, events, slot } = silentRig();
  const h = q.enqueue("Ka...", { voice: false, min: 100 });
  await h.ended;
  assert.equal(h.voiced, false);
  assert.ok(slot() >= 95 && slot() <= 200, `slot was ${slot()} ms`);
  assert.ok(events.find((e) => e.phase === "start").ms >= 100);
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
