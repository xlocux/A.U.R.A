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
