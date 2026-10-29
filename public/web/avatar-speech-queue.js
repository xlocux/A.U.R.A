"use strict";

// AURI's speech queue: one line at a time, in order, nothing thrown away, at a human pace. Pure logic: the voice
// gives it the player, the clock and the personality level, so the same rules run in the browser and in Node tests.
//  - lanes: "show" (the lines of the performance on stage) and "chatter" (everything else). While a performance holds
//    the stage only its own lines play; chatter waits in order and plays after the release.
//  - pace: a breathing gap after every chatter line and a budget of spoken chatter per minute. Over budget a line is
//    shown as a silent bubble in its turn, never dropped. Forced lines (pokes, clicks, important news) always speak.
//  - a line cut by a poke is said again from the cut piece once; cut again, the rest is shown silently.
(function initSpeechQueue(root) {
  const GAP_MS = [1500, 1500, 1200, 1000, 800]; // breathing gap after a chatter line, by personality level 0-4
  const BUDGET = [0, 0, 3, 5, 8]; // spoken chatter lines per rolling minute, by level (forced lines do not count)
  const MINUTE = 60000;

  function createSpeechQueue({ play, cut, estimate, level, emit = () => {}, now = () => Date.now(), gapMs = GAP_MS, budget = BUDGET }) {
    const waiting = [];
    const spokenAt = [];
    const gapSleepers = new Set(); // pauses a new line or the stage can end early
    const holdSleepers = new Set(); // silent bubbles and min slots: a poke (whatever the cause) or stop() ends them early
    let current = null, held = 0, nextId = 1, endedAt = -Infinity, pumping = false;
    const lvl = () => Math.max(0, Math.min(4, Math.round(Number(level()) || 0)));
    const safeEmit = (e) => { try { emit(e); } catch { /* a listener's error must not stop her */ } };
    const handleOf = (item) => ({ id: item.id, started: item.started, ended: item.ended, get voiced() { return item.voiced; } });

    function pause(ms, set) {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
        const timer = setTimeout(done, ms);
        set.add(done);
      });
    }
    const wakeAll = (set) => { for (const done of [...set]) done(); };
    function putAfterPokes(item) { let at = 0; while (at < waiting.length && waiting[at].opts.cutIn) at += 1; waiting.splice(at, 0, item); }

    // in the order they will play: the held performance's lines; else pokes and resumed lines, forced, then chatter
    function order() {
      if (held) return waiting.filter((q) => q.lane === "show" && q.show === held);
      const first = waiting.filter((q) => q.lane === "chatter" && (q.opts.cutIn || q.resumed));
      const forced = waiting.filter((q) => q.lane === "chatter" && q.forced && !q.opts.cutIn && !q.resumed);
      const rest = waiting.filter((q) => q.lane === "chatter" && !q.forced && !q.opts.cutIn && !q.resumed);
      return [...first, ...forced, ...rest];
    }

    function decideVoice(item) {
      if (item.opts.voice === false || item.opts.muted) return false; // chosen caption, or the setup mutes it (voice off, hidden page...)
      if (item.lane === "show" || item.forced) return true;
      while (spokenAt.length && now() - spokenAt[0] > MINUTE) spokenAt.shift();
      if (spokenAt.length >= budget[lvl()]) return false;
      spokenAt.push(now());
      return true;
    }

    function enqueue(text, opts = {}, extra = {}) {
      const item = Object.assign({ id: nextId++, text: String(text), opts, lane: opts.lane === "show" ? "show" : "chatter", show: opts.show || 0, forced: Boolean(opts.forced), resumes: 0, voiced: null, startedAt: null }, extra);
      let start, end;
      item.started = new Promise((resolve) => { start = resolve; });
      item.ended = new Promise((resolve) => { end = resolve; });
      item.markStart = (ms) => { if (item.startedAt == null) { item.startedAt = now(); start(ms); } };
      item.finish = () => { start(0); end(); }; // start(0) is a no-op when it has already started
      if (item.lane === "show" && (!held || item.show !== held)) { item.stopped = true; item.finish(); return handleOf(item); } // its performance is over (or never held the stage)
      if (item.lane === "chatter" && opts.kind) {
        for (let i = waiting.length - 1; i >= 0; i -= 1) {
          if (waiting[i].lane === "chatter" && waiting[i].opts.kind === opts.kind) waiting.splice(i, 1)[0].finish(); // a newer line of that kind says it better
        }
      }
      if (opts.cutIn && item.lane === "chatter") {
        putAfterPokes(item);
        if (current && current.lane === "chatter" && !held) {
          current.cutRequested = true;
          cut();
          wakeAll(holdSleepers); // a silent bubble or a min slot gives way at once
        }
      } else waiting.push(item);
      wakeAll(gapSleepers);
      pump().catch(() => {});
      return handleOf(item);
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        for (;;) {
          const item = order()[0];
          if (!item) return;
          if (item.lane === "chatter" && !item.opts.cutIn) { // a poke answers the hand at once
            const rest = gapMs[lvl()] - (now() - endedAt);
            if (rest > 0) { await pause(rest, gapSleepers); continue; } // look again: the stage may have been taken meanwhile
          }
          waiting.splice(waiting.indexOf(item), 1);
          await say(item);
        }
      } finally { pumping = false; }
    }

    async function say(item) {
      current = item;
      if (item.voiced === null) item.voiced = decideVoice(item);
      const onStart = (ms) => {
        safeEmit({ phase: "start", id: item.id, text: item.text, ms: Math.max(ms, item.opts.min || 0), bubble: item.opts.bubble ?? true });
        item.markStart(ms);
      };
      let result = {};
      if (item.voiced) {
        try { result = (await play(item, onStart)) || {}; } catch { result = { failed: true }; }
      }
      if (!result.cut && (!item.voiced || result.failed)) {
        // a silent bubble (over budget, muted by the setup, no sound came out): same turn, estimated length, at least
        // min. Only a caption the gag chose to be silent (voice: false, not muted) with an explicit min lasts exactly min.
        const chosen = item.opts.voice === false && !item.opts.muted && item.opts.min;
        const ms = chosen ? item.opts.min : Math.max(item.opts.min || 0, estimate(item.restText || item.text));
        onStart(ms);
        await pause(ms, holdSleepers);
        if (item.cutRequested && !item.stopped) { item.cutRequested = false; result = { cut: true }; }
      }
      if (!result.cut && !item.stopped && item.opts.min && item.startedAt != null) {
        const left = item.opts.min - (now() - item.startedAt);
        if (left > 0) await pause(left, holdSleepers);
      }
      current = null;
      if (result.cut && !item.stopped) {
        item.cutRequested = false; // the cut is handled here: a stale flag would cut the silent bubble later
        item.resumes += 1;
        item.resumed = true;
        if (item.resumes > 1) item.voiced = false; // cut twice: the rest is shown, not said again
        putAfterPokes(item);
        return;
      }
      endedAt = now();
      safeEmit({ phase: "end", id: item.id, text: item.text });
      item.finish();
    }

    function hold(id) { held = id; wakeAll(gapSleepers); }
    function release(id) {
      if (held !== id) return;
      held = 0;
      for (let i = waiting.length - 1; i >= 0; i -= 1) {
        if (waiting[i].lane === "show") { const q = waiting.splice(i, 1)[0]; q.stopped = true; q.finish(); }
      }
      wakeAll(gapSleepers);
      pump().catch(() => {});
    }
    function stop() {
      for (const q of waiting.splice(0)) { q.stopped = true; q.finish(); }
      if (current) { current.stopped = true; current.cutRequested = true; cut(); }
      wakeAll(holdSleepers);
      wakeAll(gapSleepers);
      held = 0;
    }

    return {
      enqueue, hold, release, stop,
      idle: () => !current && waiting.length === 0,
      current: () => current,
      upcoming: (n) => order().slice(0, n),
      holding: () => held
    };
  }

  const api = { createSpeechQueue, GAP_MS, BUDGET };
  root.AuraSpeechQueue = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
