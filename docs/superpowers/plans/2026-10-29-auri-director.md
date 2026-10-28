# AURI Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One conductor for AURI's voice, bubbles and gags: gags start when their lines are ready and every move follows her real voice; one bubble per line; chatter paced and never mixed into a performance.

**Architecture:** A pure speech queue (`avatar-speech-queue.js`: lanes, hold/release, breathing gap, budget, resume-once) drives the voice player (`avatar-voice.js`), which emits one `aura:line` event per line start/end. A new director (`avatar-director.js`) owns every performance (hold the stage, prepare the lines, run the script with an awaitable `s.say`, release). The avatar (`ai-avatar.js`) keeps the drawing side of the stage and renders one bubble from `aura:line`. All gags are converted to the `await` style.

**Tech Stack:** Static browser JS in `public/web` (no build, classic `<script>` tags, `"use strict"` IIFEs), Node ≥ 24 `node:test` for unit tests (`npm test` = `node --test --test-concurrency=4 tests/*.test.js`), headless Chromium sync harness in the session scratchpad.

Spec: `docs/superpowers/specs/2026-10-29-auri-director-design.md`.

## Global Constraints

- Edit files only with the Edit/Write tools. No inline `python`/`sed`/heredoc scripts through `bash -c` (a corporate security monitor flagged one and isolated the PC).
- Never touch `data/`. Never change storage or schema. No new npm dependencies.
- Never kill node processes you did not start (the user runs REVO `server.js`, `npm run dev`, vite).
- Headless voice tests run with `--mute-audio`; stop every test process when done.
- Free voices only; AURI is female; one voice (Kokoro `jf_tebukuro` by default); emotions change only how she speaks.
- Comments in the style of the surrounding code: one line, the *why*; code style: `"use strict"`, IIFE, double quotes, 2-space indent, semicolons.
- Breathing gap by level 0-4: `[1500, 1500, 1200, 1000, 800]` ms. Spoken chatter budget per rolling minute by level 0-4: `[0, 0, 3, 5, 8]`.
- Preparation timeout 6000 ms; wait for the line in progress at most 10000 ms; hard cap per performance 60000 ms; wait for a performance's last lines at most 15000 ms.
- During a gag she is not clickable; walks to a tile (`roamTo`) stay clickable.
- Local commits are fine; **never push without asking the user**. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Git identity in this repo is already `Locu <xlocux@users.noreply.github.com>`.

## Files

| File | Responsibility |
| --- | --- |
| `public/web/avatar-speech-queue.js` (new) | Pure queue: lanes, hold/release, gap, budget, coalescing, resume-once, handles. Node-requirable. |
| `public/web/avatar-voice.js` | Generation, player of one item (pieces), `speak()` handle, `prepare()`, `quiet()`, `emotionFor()`, `aura:line` events. |
| `public/web/avatar-director.js` (new) | `perform()`, line extraction, stage voice API (`say`, `cry`, `title`, `quote`, `pick`, `line`), `shout()`, `JAPANESE` cries, move titles. Node-requirable for `extractLines`/`cryLine`. |
| `public/web/ai-avatar.js` | Drawing-only `stage()`, `canStage()`, chatter `say()`, one bubble from `aura:line`, rage as a performance. |
| `public/web/avatar-antics.js` | Scheduler + 17 antics, run through the director; `anticScripts()` replaces `anticLines()`. |
| `public/web/avatar-tantrums.js` | 3 scenes as performances (`stage: false`). |
| `public/web/avatar-drag.js` | Carrying the home avatar as an immediate interactive performance. |
| `public/web/avatar-gags.js` | Start-up prefetch through the director's extractor. |
| `public/web/avatar-mood.js` | "FOUND IT!" through `AuraDirector.shout`. |
| `public/web/gags/*.js`, `gags/README.md` | Packs converted to the new stage API. |
| `public/web/index.html` | Script order. |
| `tests/avatar-speech-queue.test.js`, `tests/avatar-director.test.js` (new) | Unit tests. |

---

### Task 1: The speech queue (pure module)

**Files:**
- Create: `public/web/avatar-speech-queue.js`
- Test: `tests/avatar-speech-queue.test.js`

**Interfaces:**
- Produces: `createSpeechQueue({ play, cut, estimate, level, emit, now, gapMs, budget })` returning `{ enqueue(text, opts, extra) -> handle, hold(id), release(id), stop(), idle() -> boolean, current() -> item|null, upcoming(n) -> item[], holding() -> id }`.
  - `play(item, onStart) -> Promise<{ cut?: true, failed?: true }>`: plays one item; calls `onStart(ms)` when she starts; returns `{ cut: true }` when cut (the item keeps what is left), `{ failed: true }` when no sound came out.
  - `cut()`: stops the sound now (the voice's `silence()`).
  - `handle = { id, started: Promise<ms>, ended: Promise<void>, voiced }` (`voiced` is a getter: `null` until the line plays, then boolean).
  - `opts`: `lane` (`"show"`|`"chatter"`), `show` (id), `forced`, `cutIn`, `kind`, `voice` (false = silent), `bubble` (false | true | `{ pain: true }`), `min` (ms slot).
  - Events: `emit({ phase: "start", id, text, ms, bubble })` and `emit({ phase: "end", id, text })`.
  - `window.AuraSpeechQueue = { createSpeechQueue, GAP_MS, BUDGET }`; same object as `module.exports` in Node.

- [ ] **Step 1: Write the failing test**

Create `tests/avatar-speech-queue.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/avatar-speech-queue.test.js`
Expected: FAIL with `Cannot find module '../public/web/avatar-speech-queue.js'`.

- [ ] **Step 3: Write the implementation**

Create `public/web/avatar-speech-queue.js`:

```js
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
    const holdSleepers = new Set(); // silent bubbles and min slots: only a poke or stop() end them early
    let current = null, held = 0, nextId = 1, endedAt = -Infinity, pumping = false;
    const lvl = () => Math.max(0, Math.min(4, Math.round(Number(level()) || 0)));

    function pause(ms, set) {
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
        const timer = setTimeout(done, ms);
        set.add(done);
      });
    }
    const wakeAll = (set) => { for (const done of [...set]) done(); };

    // in the order they will play: the held performance's lines; else pokes and resumed lines, forced, then chatter
    function order() {
      if (held) return waiting.filter((q) => q.lane === "show" && q.show === held);
      const first = waiting.filter((q) => q.lane === "chatter" && (q.opts.cutIn || q.resumed));
      const forced = waiting.filter((q) => q.lane === "chatter" && q.forced && !q.opts.cutIn && !q.resumed);
      const rest = waiting.filter((q) => q.lane === "chatter" && !q.forced && !q.opts.cutIn && !q.resumed);
      return [...first, ...forced, ...rest];
    }

    function decideVoice(item) {
      if (item.opts.voice === false) return false;
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
      if (item.lane === "chatter" && opts.kind) {
        for (let i = waiting.length - 1; i >= 0; i -= 1) {
          if (waiting[i].lane === "chatter" && waiting[i].opts.kind === opts.kind) waiting.splice(i, 1)[0].finish(); // a newer line of that kind says it better
        }
      }
      if (opts.cutIn && item.lane === "chatter") {
        let at = 0;
        while (at < waiting.length && waiting[at].opts.cutIn) at += 1;
        waiting.splice(at, 0, item);
        if (current && current.lane === "chatter" && !held) {
          current.cutRequested = true;
          cut();
          if (current.voiced === false) wakeAll(holdSleepers); // a silent bubble gives way at once
        }
      } else waiting.push(item);
      wakeAll(gapSleepers);
      pump();
      return { id: item.id, started: item.started, ended: item.ended, get voiced() { return item.voiced; } };
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      try {
        for (;;) {
          const item = order()[0];
          if (!item) return;
          if (item.lane === "chatter") {
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
        emit({ phase: "start", id: item.id, text: item.text, ms: Math.max(ms, item.opts.min || 0), bubble: item.opts.bubble ?? true });
        item.markStart(ms);
      };
      let result = {};
      if (item.voiced) {
        try { result = (await play(item, onStart)) || {}; } catch { result = { failed: true }; }
      }
      if (!result.cut && (!item.voiced || result.failed)) {
        // a silent bubble (over budget, voice off, nothing to say aloud, or no sound came out): same turn, estimated length
        const ms = Math.max(item.opts.min || 0, estimate(item.restText || item.text));
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
        item.resumes += 1;
        item.resumed = true;
        if (item.resumes > 1) item.voiced = false; // cut twice: the rest is shown, not said again
        let at = 0;
        while (at < waiting.length && waiting[at].opts.cutIn) at += 1;
        waiting.splice(at, 0, item);
        return;
      }
      endedAt = now();
      emit({ phase: "end", id: item.id, text: item.text });
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
      pump();
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/avatar-speech-queue.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all pass (202 existing + 8 new).

- [ ] **Step 6: Commit**

```bash
git add public/web/avatar-speech-queue.js tests/avatar-speech-queue.test.js
git commit -m "AURI: pure speech queue (lanes, hold, breathing gap, budget, resume once)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Voice on the new queue, one bubble path

**Files:**
- Modify: `public/web/avatar-voice.js` (queue section lines ~311-457, `speakBrowser` ~282-309, `showcase` ~474-495, prefetch ~497-525, exports ~545-549, header ~11-13, `estimate` ~397)
- Modify: `public/web/ai-avatar.js` (`say` ~131-152, `showBubble` ~153-174, `stage` api `say`/`line` ~419-454 and the end wait ~459-461, `roamTo` `say` ~378 and `flushDeferred` calls ~401/474, `pendingBubbles`/`deferred` ~118-127, `aura:speech` listener ~595-606, quiet listener ~610)
- Modify: `public/web/index.html:596` (add the queue script before `avatar-voice.js`)

**Interfaces:**
- Consumes: Task 1 `createSpeechQueue`.
- Produces on `window.AuraSpeech`: `speak(text, opts) -> handle` (opts as Task 1 plus `emotion`, `lang`, `loud`, legacy `force` = forced and `interrupt` = cutIn); `prepare(lines, { timeoutMs }) -> Promise<{ ready, missing }>` with `lines = [{ text, emotion, lang?, loud? }]`; `quiet(ms) -> Promise<boolean>`; `hold(id)`, `release(id)`; `emotionFor(text, opts) -> string`; `isBusy()`, `idle()`, `stop()`, `showcase`, `hint`, `estimate`, `prefetch`, `set`, `download`, `remove`, `refresh`, `info`, `onChange`, `state`, `isOn`, `inDemo`, `emotions`, `defaultKokoroVoice`; transitional `cue(text, opts) -> Promise<ms>` (removed in Task 7).
- Produces event: `window` `aura:line` with `detail = { id, text, ms, phase, bubble }`. `aura:speech` no longer exists.

- [ ] **Step 1: Load the queue before the voice**

In `public/web/index.html` replace

```html
  <script src="/avatar-voice.js"></script>
```

with

```html
  <script src="/avatar-speech-queue.js"></script>
  <script src="/avatar-voice.js"></script>
```

- [ ] **Step 2: Read the queue section once before editing** (`public/web/avatar-voice.js` from `// ── queue: ONE line at a time` to the end of `function stop()`): Step 4 replaces all of it, including the old `estimate`, which no longer depends on the voice being on (a silent bubble needs a length too).

- [ ] **Step 3: `speakBrowser` tells whether she started**

In `speakBrowser` replace `const finish = () => { if (!done) { done = true; resolve(); } };` with
`const finish = () => { if (!done) { done = true; resolve(started); } };`, the first line
`if (!synth || !synth.getVoices().length) return resolve(); // no speech engine at all` with
`if (!synth || !synth.getVoices().length) return resolve(false); // no speech engine at all`, the line
`if (!line) return resolve();` with `if (!line) return resolve(false);`, and `if (item.cancelled) { finish(); return; }` with
`if (item.stopped) { finish(); return; }`. Move `let started = false;` above `const finish` so `finish` can read it.

- [ ] **Step 4: Replace the whole queue section**

Delete everything from the comment `// ── queue: ONE line at a time, in order, nothing is ever thrown away ──` down to the end of `function stop() { ... }` (the old `PREPARE_AHEAD`, `queue`, `rank`, `settle`, `cancelItem`, `prepare`, `pump`, `hinted`/`hint`, `estimate`, `latency`, `deadlineFor`, `tooSlow`, `speak`, `cue`, `stop`), and put this in its place:

```js
  let hinted = null;
  const hint = (emotion) => { hinted = { emotion, t: Date.now() }; };
  const estimate = (text) => Math.round(String(text).split(/\s+/).length * 380 + 700);
  // "Too slow" lasts 45 s at most, then the neural voice is tried again (the machine may have been busy).
  const tooSlow = () => rtf != null && rtf > 1.3 && Date.now() - slowAt < 45000;
  // the emotion a line gets now (the director prepares a performance's lines with it, so the cache key matches)
  const emotionFor = (text, opts = {}) => inferEmotion(text, opts);

  // ── the queue (avatar-speech-queue.js): one line at a time, in order, at her pace; nothing is ever thrown away ──
  // A line is spoken, or shown as a silent bubble in its turn. Every line emits "aura:line" start and end: the bubble
  // listens to that and nothing else, so text and voice cannot drift apart.
  // (estimate and level must be declared above: the queue is created right here, at load.)
  const PREPARE_AHEAD = 3;
  let played = 0;
  const lineEvent = (detail) => window.dispatchEvent(new CustomEvent("aura:line", { detail }));
  const queue = window.AuraSpeechQueue.createSpeechQueue({
    play: playItem,
    cut: silence,
    estimate,
    level,
    emit: (detail) => { if (detail.phase === "start") { played += 1; prepareAhead(); } lineEvent(detail); }
  });
  // the line she says and the next ones are generated while she speaks (all their pieces, in order)
  function prepareAhead() {
    for (const q of [queue.current(), ...queue.upcoming(PREPARE_AHEAD)]) {
      if (q && q.neural && q.opts.voice !== false && !q.ready) q.ready = q.parts.map((part) => generateLine(part, q.emoName, false, q.opts.lang, q.priority));
    }
  }
  // Plays one queued line, piece after piece. onStart(ms) as she starts (her bubble appears then, for the whole line).
  // A line cut by a poke returns { cut: true } and keeps its pieces from the cut one; { failed: true } = no sound came out.
  async function playItem(item, onStart) {
    if (!item.neural) {
      const started = await speakBrowser(item, onStart);
      if (item.cutRequested) { item.cutRequested = false; item.restText = item.text; return { cut: true }; }
      return started ? {} : { failed: true };
    }
    if (!item.ready) item.ready = item.parts.map((part) => generateLine(part, item.emoName, false, item.opts.lang, item.priority));
    const volume = cfg.volume * (item.opts.loud ? 1.2 : 1);
    let first = true;
    while (item.parts.length) {
      const audio = (await item.ready[0]) || (await generateLine(item.parts[0], item.emoName, false, item.opts.lang, item.priority)); // one retry
      if (!audio) return first ? { failed: true } : {}; // a later piece that cannot be made: the bubble already shows the whole line
      const rest = item.parts.slice(1).join(" ");
      const ok = await play(audio, audio.emo, volume, first ? (ms) => onStart(ms + (rest ? estimate(rest) : 0)) : () => {});
      if (!ok) return first ? { failed: true } : {};
      if (item.cutRequested) { item.cutRequested = false; item.restText = item.parts.join(" "); return { cut: true }; } // said again from this piece
      item.parts.shift();
      item.ready.shift();
      first = false;
    }
    return {};
  }

  // Queues a line and returns its handle { id, started, ended, voiced }. Nothing she can say aloud (voice off, the mood
  // demo, a hidden page, "...", another alphabet, a neural voice not ready yet) still takes its turn, as a silent bubble.
  function speak(text, opts = {}) {
    if (hinted && Date.now() - hinted.t < 1500 && !opts.emotion) opts = { ...opts, emotion: hinted.emotion };
    hinted = null;
    const emoName = emotionFor(text, opts);
    const neural = Boolean(activePack());
    const mute = !cfg.on || document.hidden || Boolean(demo) || !/[A-Za-z]{2}/.test(clean(text)) || (!neural && cfg.engine !== "browser");
    const forced = Boolean(opts.forced || opts.force || opts.loud);
    const extra = {
      emoName,
      neural: neural && !mute,
      priority: forced || opts.lane === "show" || emoName === "rage" || emoName === "shout",
      parts: neural && !mute ? partsOf(text, emoName, opts) : []
    };
    const handle = queue.enqueue(text, { ...opts, forced, cutIn: Boolean(opts.cutIn || opts.interrupt || opts.loud), voice: mute ? false : opts.voice }, extra);
    prepareAhead();
    return handle;
  }
  // Generates a performance's lines ahead, with the exact key she will use (same emotion, same pieces), before the
  // chatter. Resolves when all are ready or at the timeout; what is still missing keeps generating in the background.
  async function prepare(lines, { timeoutMs = 6000 } = {}) {
    if (!cfg.on || !activePack()) return { ready: lines.length, missing: 0 };
    const jobs = lines.flatMap(({ text, emotion, lang = "", loud = false }) => partsOf(text, emotion, { lang, loud }).map((part) => generateLine(part, emotion, false, lang, true)));
    let ok = 0;
    const all = Promise.all(jobs.map((job) => job.then((audio) => { if (audio) ok += 1; })));
    await Promise.race([all, new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    return { ready: ok, missing: jobs.length - ok };
  }
  // resolves true when the line she is saying is over (never cut), false after ms
  function quiet(ms) {
    const c = queue.current();
    if (!c) return Promise.resolve(true);
    return Promise.race([c.ended.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), ms))]);
  }
  // shortcut: the old cue() for the scenes not converted yet; removed in Task 7 of the director plan.
  const cue = (text, opts = {}) => speak(text, { ...opts, forced: true }).started;
  function stop() {
    demo = null;
    queue.stop();
    silence();
    emit();
  }
```

Then delete the old duplicate `const estimate = ...`, `const tooSlow = ...`, `let hinted`/`const hint` declarations if any remain elsewhere (there must be exactly one of each: `grep -n "const estimate\|const tooSlow\|let hinted" public/web/avatar-voice.js` prints three lines).

- [ ] **Step 5: The mood demo emits its own lines** (it plays outside the queue)

In `showcase`, replace the line

```js
        const onStart = (ms) => { played += 1; if (window.AuraAvatar) window.AuraAvatar.say(text, ms + 400, true); };
```

with

```js
        const id = -(i + 1); // demo lines are not in the queue: their bubbles get their own ids
        const onStart = (ms) => { played += 1; lineEvent({ phase: "start", id, text, ms, bubble: true }); };
```

and right after the `else { onStart(estimate(text)); ... }` line add `lineEvent({ phase: "end", id, text });`.

- [ ] **Step 6: Prefetch and the exports**

In `prefetch`'s `tick` replace `if (!cfg.on || !activePack() || currentItem || queue.length || generating || demo || document.hidden)` with
`if (!cfg.on || !activePack() || !queue.idle() || generating || demo || document.hidden)`.
Replace the `prefetchLines`, `isBusy` and `busyWith` lines with:

```js
  // she is saying something, or is about to
  const isBusy = () => !queue.idle() || Boolean(demo);
```

Replace the `window.AuraSpeech = { ... }` block with:

```js
  window.AuraSpeech = {
    speak, prepare, quiet, hold: (id) => queue.hold(id), release: (id) => queue.release(id), idle: () => queue.idle(),
    emotionFor, cue, stop, showcase, hint, estimate, prefetch, isBusy, set, download, remove, refresh, info,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    state: info, isOn: () => cfg.on, inDemo: () => Boolean(demo), emotions: Object.keys(EMOTIONS), defaultKokoroVoice: DEFAULT_KOKORO_VOICE
  };
```

Update the header lines 11-13 to:

```js
// Sync with the bubbles: every line waits its turn in one queue (avatar-speech-queue.js), is spoken or shown as a silent
// bubble, and emits "aura:line" start and end; the bubble shows exactly from one to the other.
```

- [ ] **Step 7: Syntax check**

Run: `node --check public/web/avatar-voice.js && node --check public/web/avatar-speech-queue.js`
Expected: no output. Then `grep -n "currentItem\|rank(\|settle(\|cancelItem\|deadlineFor\|busyWith\|aura:speech\|prefetchLines" public/web/avatar-voice.js` prints nothing.

- [ ] **Step 8: The avatar: one bubble from `aura:line`, chatter `say()` on the queue**

In `public/web/ai-avatar.js`:

1. Replace the `pendingBubbles`/`deferred`/`flushDeferred` block (from `// Bubbles waiting for her voice, by text` to the end of `function flushDeferred() {...}`) with:

```js
  // the line whose bubble is up (avatar-voice.js "aura:line" ids): only its end hides the bubble
  let bubbleLine = 0;
```

2. Replace the whole `function say(...) {...}` with:

```js
  // opts.pain: the red "ouch" bubble. opts.silent: a bubble only. opts.kind: lines of the same kind replace each other
  // while they wait (a newer status says it better). Forced lines (pokes, clicks, important news) always speak; the
  // others follow her pace and budget (avatar-speech-queue.js). The bubble appears when the line's turn comes.
  function say(text, ms = 4200, force = false, opts = {}) {
    const level = voice();
    if ((raging || isAway()) && !force) return false;
    if (!force && window.AuraSpeech?.inDemo?.()) return false; // the voice mood demo owns the bubble
    if (!force && inVoiceSettings()) return false;
    if (!force && (level === 0 || (level === 1 && Date.now() > importantUntil))) return false;
    if (!visibleMount() || !window.AuraSpeech) return false;
    window.AuraSpeech.speak(text, {
      min: ms, forced: force || Date.now() < importantUntil, cutIn: force,
      bubble: opts.pain ? { pain: true } : true, voice: opts.silent ? false : undefined, kind: opts.kind
    });
    return true;
  }
```

3. Replace `function showBubble(text, ms, pain = false) {` with `function showBubble(text, pain = false) {`, and delete its last two lines `clearTimeout(bubbleTimer);` / `bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);`, putting `clearTimeout(bubbleTimer);` back as its last line (a hide pending for the previous line must not hide this one).

4. In `roamTo` replace `if (text) say(text, stay + 800, false, { fromGag: true });` with `if (text) say(text, stay + 800);` and delete `flushDeferred();` from its `finally`.

5. In `stage`, replace the `let pace` / `whenStarted` declarations and the api `say` and `line` entries with the transitional versions below (Task 3 rewrites `stage` for good), delete the `// she finishes what the gag made her say` wait loop, and delete `flushDeferred();` from its `finally`:

```js
    let pace = Promise.resolve();
```

```js
      say: (text, ms, force = false, opts = {}) => { const h = window.AuraSpeech?.speak(text, { min: ms, forced: true, voice: opts.silent ? false : undefined }); if (h) pace = h.started; return h; },
```

```js
      async line(text, ms = 2000) {
        if (!(voice() >= 1) || !window.AuraSpeech) { await sleep(ms); return; }
        await window.AuraSpeech.speak(text, { min: ms, forced: true }).ended;
      },
```

6. Replace the `window.addEventListener("aura:speech", ...)` block in `boot` with:

```js
    // Her lines (avatar-voice.js): a bubble appears as she starts one and goes 300 ms after she has finished it.
    window.addEventListener("aura:line", (event) => {
      const d = event.detail || {};
      if (d.phase === "start" && d.bubble !== false) { bubbleLine = d.id; showBubble(String(d.text), Boolean(d.bubble && d.bubble.pain)); return; }
      if (d.phase !== "end" || d.id !== bubbleLine) return;
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => { if (bubbleLine === d.id && bubble) { bubble.classList.remove("show"); bubbleLine = 0; } }, 300);
    });
```

7. In the quiet listener replace `pendingBubbles.clear(); deferred = []; if (bubble) bubble.classList.remove("show");` with `if (bubble) bubble.classList.remove("show");`.

Run: `node --check public/web/ai-avatar.js` (no output) and `grep -n "pendingBubbles\|deferred\|flushDeferred\|aura:speech\|whenStarted\|fromGag" public/web/ai-avatar.js` (prints nothing).

- [ ] **Step 9: Smoke check in the headless browser**

Run the existing smoke harness from the scratchpad (`C:\Users\LUCA~1.CON\AppData\Local\Temp\claude\c--tools-A-U-R-A\abe9000d-3add-491d-94f4-8993b7af6879\scratchpad\ui`): `node make-smoke.js && timeout 150 node flow-shoot-smoke.js`.
Expected: `"consoleErrors": []`, `"failedRequests": []`, tables populated as before. Then `tasklist | grep -ci headless_shell` prints `0`.

- [ ] **Step 10: Run the suite and commit**

Run: `npm test` → all pass.

```bash
git add public/web/avatar-voice.js public/web/ai-avatar.js public/web/index.html
git commit -m "AURI: voice on the paced queue, one aura:line event per line, one bubble path" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The director

**Files:**
- Create: `public/web/avatar-director.js`
- Test: `tests/avatar-director.test.js`
- Modify: `public/web/ai-avatar.js` (`showId`/`currentShow` ~85-87, `stage` ~405-477, `onRoamerPoke` ~294-295, exports ~629)
- Modify: `public/web/avatar-antics.js` (`run` ~626-632, `anticLines` ~675-687, exports ~689)
- Modify: `public/web/avatar-gags.js:42-50`
- Modify: `public/web/avatar-drag.js:113` (`dragHome`)
- Modify: `public/web/index.html` (director script after `avatar-voice-ui.js`)

**Interfaces:**
- Consumes: Task 2 `AuraSpeech.speak/prepare/quiet/hold/release/emotionFor`.
- Produces: `window.AuraDirector = { perform(name, script, { interactive, stage, immediate }) -> Promise<boolean>, isPerforming() -> boolean, shout(move, ms) -> void, extractLines(source) -> { say: string[], cries: string[], quotes: [first, key][] }, linesFor(script, rolls?, { quotes }?) -> [{ text, emotion, lang?, loud? }], cryLine(move) -> [text, emotion, lang], JAPANESE }`. In Node, `module.exports = { extractLines, cryLine }`.
- Stage API given to scripts: everything from `AuraAvatar.stage` (`el, size, at, sleep, act, home, place, move, anim, randomPoint`) plus `say(text, opts|ms) -> thenable handle`, `line(text, ms)`, `cry(move, { ms, silentTitle }) -> Promise<ms>`, `title(text, ms)`, `quote(first, key) -> string`, `pick(list)`.
- `AuraAvatar.stage(script, { interactive }) -> Promise<boolean>` (drawing only) and `AuraAvatar.canStage() -> boolean`.
- `AuraAvatar.anticScripts() -> { name: fn }` replaces `anticLines()`.
- A script may set `script.source` to the function whose text holds its lines (tantrum scenes wrap their scene).

- [ ] **Step 1: Write the failing test**

Create `tests/avatar-director.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/avatar-director.test.js`
Expected: FAIL with `Cannot find module '../public/web/avatar-director.js'`.

- [ ] **Step 3: Write the director**

Create `public/web/avatar-director.js`:

```js
"use strict";

// AURI's director: every performance goes through here (a gag, the rage, a tantrum scene, being carried around).
//  1. it holds her voice (chatter waits, in order) and lets the line she is saying finish;
//  2. it prepares every line it will say, with the emotion she will use, and starts only when they are ready
//     (6 s at most; otherwise it is postponed and the preparation goes on in the background);
//  3. it runs the script: `await s.say(x)` ends when she has said x, so every move follows her real voice;
//  4. it waits for her last line, cleans up, and gives the voice back to the chatter.
// She is not clickable while she performs (a script that is a game, like catch-me, opens its own clicks).
(function initAvatarDirector(root) {
  // How each move is shouted: in Japanese, the way the anime says it, in romaji with the stretched vowels of a battle
  // cry; the voice engine turns it into Japanese sounds. Moves missing here are shouted in English (see cry()).
  const JAPANESE = {
    "KAGE BUNSHIN": "kaaage bunshin no jutsuuu!!", "KYUUBI MODE": "kyuuubi moooodo!!", "KAMEHAMEHA": "kameeehameeehaaaa!!", "NANI?!": "naaani?!",
    "SHARINGAN": "sharingaaaan!!", "MANGEKYO": "mangekyooou sharingaaaan!!", "BYAKUGAN": "byakugaaaan!!", "RINNEGAN": "rinnegaaaan!!",
    "HANA HANA NO... MIL FLEUR!": "haaana haaana no... miru furuuuuru!!",
    "GOMU GOMU NO... PISTOL!": "goooomu goooomu no... pisutooooru!!", "GOMU GOMU NO... GATLING!": "goooomu goooomu no... gatoriiinguuuu!!",
    "GOMU GOMU NO... BAZOOKA!": "goooomu goooomu no... bazuuuuka!!", "GOMU GOMU NO... ELEPHANT GUN!": "goooomu goooomu no... erefanto gaaaan!!",
    "GOMU GOMU NO... RED HAWK!": "goooomu goooomu no... reddo hooooku!!", "GOMU GOMU NO... JET PISTOL!": "goooomu goooomu no... jetto pisutooooru!!",
    "GEAR 5 - NIKA": "giaaa fifusu... nikaaaa!!", "CONQUEROR'S HAKI": "haoshoku no haaaki!!",
    "BANKAI": "bankaiiii!!", "KATEN KYOKOTSU: KARAMATSU SHINJU": "katen kyoukotsu... karamatsu shinjuuuu!!"
  };
  // "KAMEHAMEHA" -> "KAMEHAMEHAAAA!!": the last vowel is stretched like an anime battle cry
  const stretch = (text) => String(text).replace(/[.?!\s-]+$/, "").replace(/([AEIOUaeiou])([^AEIOUaeiou]*)$/, (m, v, rest) => v.repeat(4) + rest) + "!!";
  // [line, emotion, lang] as the voice engine wants it
  const cryLine = (move) => (JAPANESE[move] ? [JAPANESE[move], "shout", "ja"] : [stretch(move), "shout", ""]);

  // ── what a script will say, read from its source: literal first arguments of s.say / s.line / g.say (tantrum
  // ghosts), s.cry, s.quote, and every option of s.pick([...]). Lines built at run time are not found: they are
  // generated when said, and the script waits for them at that beat.
  const STR = String.raw`(["'])((?:\\.|(?!\1)[^\\])*)\1`;
  const STR2 = STR.replace(/\\1/g, "\\3");
  const unquote = (s) => s.replace(/\\(.)/g, "$1");
  const sayable = (t) => t.replace(/[^A-Za-z]/g, "").length >= 3;
  function extractLines(source) {
    const src = String(source);
    const say = [], cries = [], quotes = [];
    for (const m of src.matchAll(new RegExp(String.raw`\b[sg]\.(?:say|line)\(\s*` + STR, "g"))) say.push(unquote(m[2]));
    for (const m of src.matchAll(/\bs\.pick\(\s*\[([^\]]*)\]/g)) for (const n of m[1].matchAll(new RegExp(STR, "g"))) say.push(unquote(n[2]));
    for (const m of src.matchAll(new RegExp(String.raw`\bs\.cry\(\s*` + STR, "g"))) cries.push(unquote(m[2]));
    for (const m of src.matchAll(new RegExp(String.raw`\bs\.quote\(\s*` + STR + String.raw`\s*,\s*` + STR2, "g"))) quotes.push([unquote(m[2]), unquote(m[4])]);
    const seen = new Set();
    const once = (list, key) => list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
    return { say: once(say.filter(sayable), (t) => "s:" + t), cries: once(cries, (t) => "c:" + t), quotes: once(quotes, (q) => "q:" + q.join("|")) };
  }

  // A quote line is rolled once per performance and kept while the performance is postponed, so the line prepared in
  // the background is the one she says next time.
  function quoteText(first, key, rolls) {
    const id = first + "|" + key;
    if (!rolls.has(id)) { const q = root.AuraQuotes ? root.AuraQuotes.get(key, { force: true }) : null; rolls.set(id, q || ""); }
    const q = rolls.get(id);
    return q ? first + "\n" + q : first;
  }
  function linesFor(script, rolls = new Map(), { quotes = true } = {}) {
    const S = root.AuraSpeech;
    const emotion = (text) => (S && S.emotionFor ? S.emotionFor(text, {}) : "neutral");
    const found = extractLines(script.source || script);
    const lines = found.say.map((text) => ({ text, emotion: emotion(text) }));
    for (const move of found.cries) { const [text, emo, lang] = cryLine(move); lines.push({ text, emotion: emo, lang }); }
    if (quotes) for (const [first, key] of found.quotes) { const text = quoteText(first, key, rolls); lines.push({ text, emotion: emotion(text) }); }
    return lines;
  }

  // ── the move title: manga speed lines and a big italic name, up for ms ──
  function fx(className) {
    const el = document.createElement("div");
    el.className = className;
    document.body.append(el);
    return el;
  }
  async function showTitle(text, ms) {
    const lines = fx("av-an-lines");
    const t = fx("av-an-title");
    t.textContent = text;
    t.style.left = "50%"; t.style.top = "46%";
    t.style.fontSize = `min(92px, ${Math.round(88 / Math.max(6, text.length) * 100) / 10}vw)`;
    lines.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" });
    t.animate([{ transform: "translate(-50%, -50%) scale(2.6) skewX(-10deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1) skewX(-10deg)", opacity: 1, offset: 0.18 }, { transform: "translate(-50%, -50%) scale(1.06) skewX(-10deg)", opacity: 1, offset: 0.85 }, { transform: "translate(-50%, -50%) scale(1.3) skewX(-10deg)", opacity: 0 }], { duration: ms, fill: "forwards" });
    await new Promise((resolve) => setTimeout(resolve, ms));
    lines.remove(); t.remove();
  }

  // ── performances ──
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX_SHOW_MS = 60000;
  const rollsBy = new Map(); // gag name -> the quotes rolled for its next performance
  let seq = 0, current = null;

  function voiceApi(base, show) {
    const S = root.AuraSpeech;
    const guard = () => { if (show.closed) throw new Error("the performance is over"); };
    const track = (h) => { show.handles.push(h); return h; };
    // await s.say(x) ends when she has said x (and not before opts.min ms); s.say(x).started when she starts it
    function say(text, opts = {}) {
      guard();
      if (typeof opts === "number") opts = { min: opts }; // the old form s.say(text, ms)
      const h = track(S.speak(String(text), { ...opts, lane: "show", show: show.id, forced: true }));
      h.then = (ok, ko) => h.ended.then(ok, ko);
      return h;
    }
    // the battle cry: the move name appears as she starts shouting it; resolves then, with the cry's length
    async function cry(move, opts = {}) {
      guard();
      const [text, emotion, lang] = cryLine(move);
      const h = track(S.speak(text, { lane: "show", show: show.id, emotion, lang, bubble: false, forced: true }));
      const ms = await h.started;
      if (!opts.silentTitle) showTitle(move, Math.max(opts.ms || 1500, ms + 200));
      return ms;
    }
    return {
      ...base, say, cry,
      line: (text, ms = 2000) => say(text, { min: ms }),
      title: (text, ms = 1500) => showTitle(text, ms),
      quote: (first, key) => quoteText(first, key, show.rolls),
      pick: (list) => list[Math.floor(Math.random() * list.length)]
    };
  }

  // false = not performed now (she is busy, the lines are not ready yet...): the caller tries again later.
  // stage: false for scenes that draw their own figure (rage, tantrums); immediate: no waiting, no preparation (being
  // carried must answer the hand at once); interactive: the script handles clicks on her.
  async function perform(name, script, { interactive = false, stage = true, immediate = false } = {}) {
    const A = root.AuraAvatar, S = root.AuraSpeech;
    if (current || !A || !S || (stage && !A.canStage())) return false;
    const show = { id: ++seq, name, handles: [], closed: false, rolls: new Map() };
    current = show;
    S.hold(show.id);
    try {
      if (!immediate) {
        if (!(await S.quiet(10000))) return false;
        const rolls = rollsBy.get(name) || new Map();
        rollsBy.set(name, rolls);
        show.rolls = rolls;
        const { missing } = await S.prepare(linesFor(script, rolls), { timeoutMs: 6000 });
        if (missing) return false;
      }
      const run = async (base) => {
        const playing = Promise.resolve().then(() => script(voiceApi(base || {}, show)));
        playing.catch(() => {}); // a script stopped by the cap ends on its next call: nothing to report
        await Promise.race([playing, wait(MAX_SHOW_MS)]);
        await Promise.race([Promise.all(show.handles.map((h) => h.ended)), wait(15000)]);
      };
      if (stage) { if (!(await A.stage(run, { interactive }))) return false; }
      else await run(null);
      rollsBy.delete(name); // performed: new quotes next time
      return true;
    } catch {
      return false;
    } finally {
      show.closed = true;
      S.release(show.id);
      if (current === show) current = null;
    }
  }

  // A battle cry outside a performance (a big find): shouted in her turn, the title as she starts it.
  function shout(move, ms = 1100) {
    const S = root.AuraSpeech;
    if (!S) return;
    const [text, emotion, lang] = cryLine(move);
    S.speak(text, { emotion, lang, bubble: false, forced: true }).started.then((d) => showTitle(move, Math.max(ms, d + 200)));
  }

  root.AuraDirector = { perform, isPerforming: () => Boolean(current), shout, extractLines, linesFor, cryLine, JAPANESE };
  if (typeof module === "object" && module.exports) module.exports = { extractLines, cryLine };
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/avatar-director.test.js`
Expected: PASS, 2 tests.

- [ ] **Step 5: Load the director**

In `public/web/index.html` add after `<script src="/avatar-voice-ui.js"></script>`:

```html
  <script src="/avatar-director.js"></script>
```

- [ ] **Step 6: The avatar's stage becomes drawing only**

In `public/web/ai-avatar.js`:

1. Delete `let showId = 0;`, its comment, and `const currentShow = ...`; delete `showId += 1;` in `roamTo` and in `stage`.
2. Replace the whole `async function stage(script) {...}` (and its comment) with:

```js
  // The drawing side of a performance (avatar-director.js owns its time and voice): the roaming copy comes out, the
  // home avatar is hidden, the script gets the drawing helpers, and everything is put back afterwards. Returns false
  // when she can't perform right now. interactive: the script handles clicks on her (being carried); otherwise she
  // is not clickable while she performs.
  const canStage = () => !(isAway() || roaming || reducedMotion() || document.hidden || inVoiceSettings() || !mounts().some((el) => el !== roamer && isVisible(el)));
  async function stage(script, { interactive = false } = {}) {
    const origin = mounts().find((el) => el !== roamer && isVisible(el));
    if (!canStage() || !origin) return false;
    roaming = true;
    lastRoam = Date.now();
    const r = ensureRoamer();
    r.style.pointerEvents = interactive ? "" : "none";
    delete r.dataset.catching;
    const size = { w: 46, h: 52 };
    const centerOf = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2 - size.w / 2, y: b.top + b.height / 2 - size.h / 2 }; };
    const at = (p, s = 1, rot = 0) => "translate(" + p.x + "px, " + p.y + "px) scale(" + s + ") rotate(" + rot + "deg)";
    const api = {
      el: r, size, at, sleep, act,
      home: () => centerOf(origin),
      place(p, o = {}) { r.getAnimations().forEach((a) => a.cancel()); r.style.transform = at(p, o.scale ?? 1, o.rot ?? 0); r.style.opacity = String(o.opacity ?? 1); },
      move(from, to, o = {}) {
        const mid = o.arc === false ? null : { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - (o.lift ?? 60) };
        r.classList.toggle("face-left", to.x < from.x);
        r.classList.add("walking");
        const frames = mid ? [{ transform: at(from) }, { transform: at(mid), offset: 0.5 }, { transform: at(to) }] : [{ transform: at(from) }, { transform: at(to) }];
        return r.animate(frames, { duration: o.ms ?? 1500, easing: o.easing ?? "ease-in-out", fill: "forwards" }).finished.then(() => r.classList.remove("walking"));
      },
      anim(frames, opts) { return r.animate(frames, { fill: "forwards", ...opts }).finished; },
      randomPoint(margin = 100) { return { x: margin + Math.random() * Math.max(1, innerWidth - 2 * margin - size.w), y: 90 + Math.random() * Math.max(1, innerHeight - 190 - size.h) }; }
    };
    try {
      origin.classList.add("av-away");
      r.style.display = "block";
      await script(api);
    } catch {
      // gag interrupted: fall through to cleanup
    } finally {
      r.getAnimations().forEach((a) => a.cancel());
      r.style.display = "none";
      r.style.pointerEvents = "none";
      r.style.cursor = "";
      r.style.opacity = "";
      r.style.transform = "";
      r.classList.remove("walking", "face-left", "av-overload", "av-glitching");
      origin.classList.remove("av-away");
      roaming = false;
    }
    return true;
  }
```

3. In `onRoamerPoke` replace `if (!roamer || roamer.dataset.catching) return; // the catch-me game has its own click` with
`if (!roamer || roamer.dataset.catching || window.AuraDirector?.isPerforming?.()) return; // a game has its own click; no pokes while she performs`.
4. In the `window.AuraAvatar = {...}` exports remove `showId: currentShow` and add `canStage`.

- [ ] **Step 7: Antics run through the director**

In `public/web/avatar-antics.js`:

1. In `run(name)` replace `const performed = await api.stage(ANTICS[name]);` with `const performed = await window.AuraDirector.perform(name, ANTICS[name]);`, and its guard `if (!api || !ANTICS[name]) return false;` with `if (!api || !ANTICS[name] || !window.AuraDirector) return false;`.
2. Delete the `anticLines()` function and its comment.
3. In the final `Object.assign(...)` replace `anticLines` with `anticScripts: () => ({ ...ANTICS })`.

- [ ] **Step 8: Start-up prefetch through the extractor**

In `public/web/avatar-gags.js` replace the block from `// Every fixed line of the gags, and the rant,` to the closing `}` of its `if` with:

```js
    // Every fixed line of the gags, and the rant, is prepared ahead by the voice, so a gag usually starts at once.
    // The server keeps them, so this happens once. (Quote lines are rolled per performance: prepared when it starts.)
    const speech = window.AuraSpeech, director = window.AuraDirector;
    if (speech && speech.prefetch && director && api.anticScripts) {
      setTimeout(() => {
        const lines = Object.values(api.anticScripts()).flatMap((fn) => director.linesFor(fn, new Map(), { quotes: false }));
        speech.prefetch(lines.map((l) => [l.text, l.emotion, l.lang || ""]));
        if (api.rageLines) speech.prefetch(api.rageLines.map((line) => [line, "rage", ""]));
      }, 6000);
    }
```

- [ ] **Step 9: Being carried is an immediate, interactive performance**

In `public/web/avatar-drag.js` `dragHome`, replace `A().stage(async (s) => {` with
`window.AuraDirector.perform("carry", async (s) => {` and the closing `});` of that call with
`}, { interactive: true, immediate: true });`. Inside it, replace `s.say(line(key), 2200)` with `s.say(line(key))` and
`chomp(event, (t) => { spoke = Date.now(); s.say(t, 2200); })` with `chomp(event, (t) => { spoke = Date.now(); s.say(t); })`
(reactions to the hand: no minimum slot, so they never pile up behind each other).

- [ ] **Step 10: Checks**

Run: `node --check public/web/avatar-director.js && node --check public/web/ai-avatar.js && node --check public/web/avatar-antics.js && node --check public/web/avatar-gags.js && node --check public/web/avatar-drag.js` (no output), `npm test` (all pass), the smoke harness (Task 2 Step 9: no console errors), then in the sync harness run one antic and one pack gag: from the scratchpad `ui` folder, `GAGS=wormhole,kamehameha VROOT="$(cd ../vroot8 && pwd -W)" VOICE=jf_tebukuro timeout 300 node flow-shoot42.js` after `node make42.js` — expected: both report `performed` (the old harness still listens to `aura:speech`, so ignore its sync verdict until Task 8).

- [ ] **Step 11: Commit**

```bash
git add public/web/avatar-director.js tests/avatar-director.test.js public/web/ai-avatar.js public/web/avatar-antics.js public/web/avatar-gags.js public/web/avatar-drag.js public/web/index.html
git commit -m "AURI: the director (hold, prepare, perform) and a drawing-only stage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Rage and tantrum scenes as performances

**Files:**
- Modify: `public/web/ai-avatar.js` (`rage` ~230-263)
- Modify: `public/web/avatar-tantrums.js` (`ghost` ~24-58, the three scenes, `run` ~265-270)

**Interfaces:**
- Consumes: Task 3 `AuraDirector.perform(name, script, { stage: false })`, stage API `s.say(text, opts) -> thenable handle` with `handle.started`/`handle.ended`.
- Produces: `AuraAvatar.rage()` unchanged signature (returns a Promise); `AuraTantrums.run(name)` unchanged.

- [ ] **Step 1: Rage**

In `public/web/ai-avatar.js` replace `async function rage() {...}` with:

```js
  // Everything goes black; a giant, red, burning Aura swears in full-screen letters, then calms down. A performance:
  // her rant is prepared ahead and said in a row, each line on screen as she yells it; nothing else can slip in.
  async function rage() {
    if (raging || !roamer || !window.AuraDirector) return;
    await window.AuraDirector.perform("rage", rageScene, { stage: false });
    say("...sorry. I lost my temper.", 2800, true);
  }
  async function rageScene(s) {
    raging = true;
    if (bubble) { bubble.classList.remove("show"); bubble.style.display = "none"; }
    const veil = document.createElement("div");
    veil.className = "av-rage-veil";
    const big = document.createElement("div");
    big.className = "av-rage-avatar";
    big.innerHTML = roamer.innerHTML;
    const text = document.createElement("div");
    text.className = "av-rage-text";
    document.body.append(veil, big, text);
    roamer.style.visibility = "hidden";
    try {
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, fill: "forwards" });
      big.animate([{ transform: "translate(-50%, -50%) scale(1)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(7.5)", opacity: 1 }], { duration: 750, easing: "cubic-bezier(.2,1.3,.4,1)", fill: "forwards" });
      await sleep(750);
      for (const line of RAGE_LINES) {
        const h = s.say(line, { loud: true, bubble: false, min: line.startsWith("...") ? 1500 : 1050 });
        h.started.then(() => { text.textContent = line; });
        await h;
      }
      text.remove();
      await big.animate([{ transform: "translate(-50%, -50%) scale(7.5)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 0 }], { duration: 650, easing: "ease-in", fill: "forwards" }).finished;
      await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: "forwards" }).finished;
    } finally {
      text.remove(); big.remove(); veil.remove();
      if (roamer) roamer.style.visibility = "";
      if (bubble) bubble.style.display = "";
      raging = false;
      pokes = [];
    }
  }
```

The rage lines are literal elements of `RAGE_LINES`, not `s.say("...")` calls, so the director's extractor does not see them; they are prefetched at start-up with emotion `rage` (Task 3 Step 8) and `speak` with `loud: true` infers `rage` too, so the keys match and the lines come from the cache.

- [ ] **Step 2: Tantrum ghosts talk through the director**

In `public/web/avatar-tantrums.js`, change `function ghost(start) {` to `function ghost(start, s) {` and replace the `let sayId = 0;` / `g.say = async ...` block with:

```js
    // The scene keeps its own pace; the ghost's bubble shows the line as she starts it and hides when she ends it.
    // `await g.say(x)` ends when she has said it.
    g.say = (text, ms = 1600) => {
      const h = s.say(text, { loud: true, bubble: false, min: ms });
      h.started.then(() => { if (!bubble.isConnected) return; bubble.textContent = text; bubble.classList.add("show"); });
      h.ended.then(() => { if (bubble.textContent === text) bubble.classList.remove("show"); });
      return h;
    };
```

Change each scene's signature from `async function leave(start) {` / `tokens(start)` / `hammer(start)` to `(start, s)` and their `const g = ghost(start);` to `const g = ghost(start, s);`. In `hammer`, replace the indexed line `g.say(["TAKE THAT!", "AND THAT!", "CRUMBLE, YOU STUPID LETTERS!"][n], 900);` with

```js
      if (n === 0) g.say("TAKE THAT!", 900); else if (n === 1) g.say("AND THAT!", 900); else g.say("CRUMBLE, YOU STUPID LETTERS!", 900);
```

so the extractor finds all three. Apply the conversion rules of Task 5 (table) to every `g.say(...)` followed by `await sleep(n)` in the three scenes: `g.say(x, ms); await sleep(n);` becomes `await g.say(x, Math.max(ms, n));` when the next beat depends on the line, and stays fire-and-forget when the scene goes on while she talks.

Replace `function run(name) {...}` with:

```js
  const RUN = { leave, tokens, hammer };
  function run(name) {
    const fn = RUN[name];
    const start = fn && A() && A().tantrumStart();
    if (!start || !window.AuraDirector) return;
    const scene = Object.assign((s) => fn(start, s), { source: fn }); // the director reads the scene's lines from fn
    window.AuraDirector.perform("tantrum:" + name, scene, { stage: false })
      .then((performed) => { if (!performed) A().tantrumEnd(); })
      .finally(() => document.querySelectorAll(".av-tt-ghost,.av-tt-say,.av-tt-token,.av-tt-ring,.av-tt-crack,.av-tt-hammer").forEach((e) => e.remove()));
  }
```

(each scene still calls `A().tantrumEnd()` itself at its end; the `.then` restores her when the scene could not start.)

- [ ] **Step 3: Checks**

Run: `node --check public/web/ai-avatar.js && node --check public/web/avatar-tantrums.js` (no output); `grep -n "\.cue(" public/web/ai-avatar.js public/web/avatar-tantrums.js` prints nothing; `npm test` passes; smoke harness: no console errors.

- [ ] **Step 4: Commit**

```bash
git add public/web/ai-avatar.js public/web/avatar-tantrums.js
git commit -m "AURI: rage and tantrum scenes are performances (prepared rant, nothing slips in)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Convert the 17 antics

**Files:**
- Modify: `public/web/avatar-antics.js` (gags `wormhole explode catchMe peek glitch dance section underpass shatter suck deLorean storm alice swarm zoomies bounce shroom`)

**Interfaces:**
- Consumes: Task 3 stage API (`say`, `line`, `quote`, `pick`, `move`, `anim`, `sleep`, ...).
- Produces: the same `ANTICS` names, behaviour unchanged except timing now follows her voice.

Conversion rules (apply to every gag; these are the only changes):

| Today | After |
| --- | --- |
| `s.say(x, ms); await s.sleep(n);` | `await s.say(x, { min: n });` |
| `s.say(x, ms);` then `await s.move(...)` / `await s.anim(...)` (talk while moving) | `await s.say(x).started;` then the move, unchanged |
| `s.say(x, ms);` with nothing awaited after (a remark during an effect) | `s.say(x);` |
| `line("First.", "gag:key")` (the local helper) | `s.quote("First.", "gag:key")` |
| `pick([...])` as the argument of `s.say` | `s.pick([...])` |
| `s.say(x, ms, false, { silent: true })` | `s.say(x, { voice: false, min: ms })` |
| `await s.sleep(n)` between pure visual effects | unchanged |

After the conversion the local `line` helper and `quote` helper at the top of the file are unused for gag lines: delete `line` if nothing else uses it (`grep -n "\bline(" public/web/avatar-antics.js`), keep `quote` only if a non-gag caller uses it.

- [ ] **Step 1: Convert `wormhole` (worked example)**

Replace the body of `async wormhole(s)` with:

```js
    async wormhole(s) {
      const home = s.home();
      const spot = s.randomPoint();
      s.place(home);
      await s.say("Hold on, I know a shortcut.").started;
      await s.move(home, spot, { ms: 1500 });
      const gate = portal(spot.x + 23, spot.y + 30);
      await s.sleep(450);
      await s.say(s.quote("Wormhole engaged.", "gag:wormhole")).started;
      await s.anim([{ transform: s.at(spot, 1, 0), opacity: 1 }, { transform: s.at(spot, 0.04, 720), opacity: 0 }], { duration: 950, easing: "ease-in" });
      await gate.close();
      await s.sleep(1400 + Math.random() * 1600);
      const exit = s.randomPoint();
      const gate2 = portal(exit.x + 23, exit.y + 30);
      await s.sleep(450);
      await s.say(s.quote("Miss me?", "gag:wormholeBack")).started;
      await s.anim([{ transform: s.at(exit, 0.04, -720), opacity: 0 }, { transform: s.at(exit, 1, 0), opacity: 1 }], { duration: 950, easing: "ease-out" });
      await gate2.close();
      s.act("sparkle", 1400);
      await s.sleep(900);
      await s.move(exit, s.home(), { ms: 1500 });
    },
```

- [ ] **Step 2: Convert `explode` (worked example)**

```js
    async explode(s) {
      const home = s.home();
      const spot = s.randomPoint(160);
      s.place(home);
      await s.say("Warning: power level critical!").started;
      await s.move(home, spot, { ms: 1300 });
      s.el.classList.add("av-overload");
      await s.anim([
        { transform: s.at(spot, 1) }, { transform: s.at(spot, 1.25) }, { transform: s.at(spot, 1.1) },
        { transform: s.at(spot, 1.5) }, { transform: s.at(spot, 1.25) }, { transform: s.at(spot, 1.85) }
      ], { duration: 1500, easing: "ease-in" });
      const cx = spot.x + 23;
      const cy = spot.y + 26;
      burst(cx, cy, 34);
      s.el.classList.remove("av-overload");
      s.place(spot, { opacity: 0, scale: 0.2 });
      await s.say(s.quote("BOOM.", "gag:explode"), { min: 2300 });
      implode(cx, cy);
      await s.sleep(850);
      burst(cx, cy, 10);
      await s.anim([{ transform: s.at(spot, 0.2), opacity: 0 }, { transform: s.at(spot, 1), opacity: 1 }], { duration: 450, easing: "ease-out" });
      s.act("wink", 1300);
      await s.say(s.quote("Reconstructing... done. I'm fine!", "gag:rebuilt"), { min: 1500 });
      await s.move(spot, s.home(), { ms: 1500 });
    },
```

- [ ] **Step 3: Convert the other 15 antics with the table**

Go gag by gag (`catchMe peek glitch dance section underpass shatter suck deLorean storm alice swarm zoomies bounce shroom`). In `catchMe`, the dodges' `s.say("Too slow!", 1800)` stays fire-and-forget (`s.say("Too slow!")`) because the game must not wait for her; the script keeps setting `r.style.pointerEvents = "auto"` for its own game. In `shroom` the trip lines `for (const text of lines) { s.say(text, 2300); await s.sleep(1750); }` become `for (const text of lines) await s.say(text, { min: 1750 });`.

- [ ] **Step 4: Checks**

Run: `node --check public/web/avatar-antics.js` (no output); `grep -nE "s\.say\([^)]*\)\s*;\s*$" public/web/avatar-antics.js` lists only the intentional fire-and-forget remarks (review each); `grep -n "\bline(\"" public/web/avatar-antics.js` prints nothing; `npm test` passes.

- [ ] **Step 5: Commit**

```bash
git add public/web/avatar-antics.js
git commit -m "AURI: antics follow her voice (await s.say, prepared quotes)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Convert the gag packs and the README

**Files:**
- Modify: `public/web/gags/anime.js` (`ninja samurai demon kamehameha nani`; remove `JAPANESE`, `cry`, `cryLine`, `shout`, `title`; keep `fx smoke shake wait rand pick done centre`)
- Modify: `public/web/gags/eyes-luffy.js` (`eyes gomu gear5 haki robin`), `public/web/gags/bleach.js` (`bankai`), `public/web/gags/party.js` (`sing play dontclick`), `public/web/gags/charset.js` (`charset`)
- Modify: `public/web/avatar-mood.js:43`
- Modify: `public/web/gags/README.md`

**Interfaces:**
- Consumes: Task 3 stage API (`say`, `cry`, `title`, `pick`, ...) and `AuraDirector.shout`.
- Produces: `window.AuraAnimeFx = { fx, smoke, shake, wait, rand, pick, done, centre }` (no `title`, `shout`, `cry`, `cryLine`).

Rules: the Task 5 table, plus:

| Today | After |
| --- | --- |
| `const cry = await title("MOVE", ms)` / `await F().title("MOVE", ms)` | `const cry = await s.cry("MOVE", { ms })` |
| `title("MOVE", ms, { silent: true })` | `s.title("MOVE", ms)` |
| `AuraSpeech.cue(line, {...})` inside a gag | `await s.say(line, {...}).started` (when the next beat waits for its start) or `await s.say(line)` |
| `s.say("Kage Bunshin no Jutsu!", 1800, false, { silent: true })` | `s.say("Kage Bunshin no Jutsu!", { voice: false, min: 1800 })` |

- [ ] **Step 1: Convert `ninja` (worked example)**

```js
    async ninja(s) {
      const home = s.home();
      const spot = s.randomPoint(180);
      s.place(home);
      await s.say("Shh. Ninja mode.").started;
      await s.move(home, spot, { ms: 1300 });
      smoke(centre(spot, s).x, centre(spot, s).y, 20);
      s.el.style.opacity = "0";
      await wait(900);
      for (let i = 0; i < 5; i += 1) {
        const sx = rand(60, innerWidth - 60), sy = rand(90, innerHeight - 120);
        const star = fx("av-an-shuriken", centre(spot, s).x, centre(spot, s).y, '<svg viewBox="-12 -12 24 24"><path d="M0 -11L3 -3L11 0L3 3L0 11L-3 3L-11 0L-3 -3Z"/><circle r="2"/></svg>');
        await star.animate([{ transform: "translate(-50%,-50%) rotate(0deg)", opacity: 1 }, { transform: `translate(${sx - centre(spot, s).x - 12}px, ${sy - centre(spot, s).y - 12}px) rotate(900deg)`, opacity: 1 }], { duration: 380, easing: "ease-in", fill: "forwards" }).finished;
        star.animate([{ rotate: "0deg" }, { rotate: "-10deg" }, { rotate: "0deg" }], { duration: 220 });
        shake(2, 140);
        setTimeout(() => done(star.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: "forwards" }), star), 1400);
        await wait(rand(120, 260));
      }
      // the clones pop up while she shouts, and stay until the cry is over
      const cry = await s.cry("KAGE BUNSHIN", { ms: 1300 });
      s.say("Kage Bunshin no Jutsu!", { voice: false, min: 1800 });
      const clones = [];
      for (let i = 0; i < 6; i += 1) {
        const p = { x: rand(80, innerWidth - 120), y: rand(100, innerHeight - 140) };
        const c = fx("av-an-clone", p.x, p.y, s.el.innerHTML);
        smoke(p.x + 23, p.y + 26, 8);
        c.animate([{ scale: 0, opacity: 0 }, { scale: 1.2, opacity: 1 }], { duration: 300, fill: "forwards" });
        clones.push(c);
        await wait(130);
      }
      await wait(Math.max(1300, cry - 780 + 150));
      for (const c of clones) { smoke(parseFloat(c.style.left) + 23, parseFloat(c.style.top) + 26, 6); c.remove(); }
      s.el.style.opacity = "1";
      s.act("sparkle", 800);
      await s.say("Which one was the real me? ...All of them. Obviously.", { min: 2200 });
      await s.move(spot, s.home(), { ms: 1300 });
    },
```

Note: the silent "Kage Bunshin no Jutsu!" bubble queues behind the cry in the show lane, so it appears as the cry ends; that is the intended order (cry, then its caption).

- [ ] **Step 2: Convert the rest of `anime.js`**, then remove `JAPANESE`, `cry`, `cryLine`, `shout`, `title`, `show` (moved to the director) and their comments, and change the export to `window.AuraAnimeFx = { fx, smoke, shake, wait, rand, pick, done, centre };`. Update the header comment: cries and titles come from the stage (`s.cry`, `s.title`).

- [ ] **Step 3: Convert `eyes-luffy.js`, `bleach.js`, `party.js`, `charset.js`** with both tables (`F().title(...)` -> `s.cry(...)`, `F().shake` stays). In `eyes-luffy.js` `robin`, the Mil Fleur cry is `const cry = await s.cry("HANA HANA NO... MIL FLEUR!", { ms: ... })` with the same `ms` it had.

- [ ] **Step 4: A big find shouts outside a performance**

In `public/web/avatar-mood.js` replace
`if ((n >= 3 || level() >= 3) && window.AuraAnimeFx) window.AuraAnimeFx.title(n >= 5 ? "JACKPOT!" : "FOUND IT!", 1100);` with
`if ((n >= 3 || level() >= 3) && window.AuraDirector) window.AuraDirector.shout(n >= 5 ? "JACKPOT!" : "FOUND IT!", 1100);`.

- [ ] **Step 5: Rewrite `gags/README.md` for the new API**

Replace the section that documents the stage helpers with:

```markdown
## Writing a gag

A gag is `async function name(s) { ... }` registered with `window.AuraAvatar.registerAntic(name, fn, isRare)`. It runs
as a performance (`window.AuraDirector.perform`): it starts only when its lines are ready, she is not clickable while
it runs, and no other line is said until it ends.

Her voice sets the time:

- `await s.say("Line.")`: ends when she has said it. `await s.say("Line.", { min: 1500 })`: and at least 1.5 s.
- `await s.say("Line.").started`: she has just started; walk or animate while she talks.
- `s.say("Line.")` without `await`: a remark during an effect; it still waits its turn after the previous line.
- `const ms = await s.cry("KAMEHAMEHA", { ms: 1500 })`: the battle cry (Japanese when the move is in the director's
  table); the big title appears as she starts it; `ms` is the cry's length, to time the strike.
- `s.title("MOVE", 1500)`: the title only, silent.
- `s.say(s.pick(["A.", "B."]))`, `s.say(s.quote("First.", "gag:key"))`: random lines that are still prepared ahead.
- `s.say("Text", { voice: false, min: 1800 })`: a bubble only.

Write the lines as string literals in those calls: the director reads them from the source to prepare them. A line
built at run time (a number, a host name) works too; the gag waits for it at that beat.

Drawing helpers: `s.el`, `s.size`, `s.at(p, scale, rot)`, `s.place(p, o)`, `s.move(from, to, o)`, `s.anim(frames, o)`,
`s.act(name, ms)`, `s.sleep(ms)`, `s.home()`, `s.randomPoint(margin)`. Shared effects: `window.AuraAnimeFx`.
```

- [ ] **Step 6: Checks**

Run: `node --check` on the five pack files and `avatar-mood.js` (no output); `grep -rn "AuraAnimeFx\.\(title\|shout\|cryLine\)\|F()\.title\|F()\.shout\|\.cue(\|showId" public/web/gags public/web/avatar-mood.js` prints nothing; `npm test` passes.

- [ ] **Step 7: Commit**

```bash
git add public/web/gags public/web/avatar-mood.js
git commit -m "AURI: gag packs follow her voice (s.cry, s.title, await s.say)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Remove the transitional pieces

**Files:**
- Modify: `public/web/avatar-voice.js` (the `cue` shortcut and its export)
- Modify: any file the greps below find

- [ ] **Step 1: Remove `cue`**

Delete the `// shortcut: the old cue() ...` comment and `const cue = ...` line from `public/web/avatar-voice.js`, and remove `cue, ` from the `window.AuraSpeech` exports.

- [ ] **Step 2: Nothing old is left**

Run: `grep -rn "\.cue(\|aura:speech\|deadlineFor\|busyWith\|prefetchLines\|anticLines\|fromGag\|pendingBubbles\|flushDeferred\|currentShow\|showId()" public/web`
Expected: no output. Fix every hit (it is a leftover caller of a removed API).

- [ ] **Step 3: Checks and commit**

Run: `for f in public/web/avatar-*.js public/web/ai-avatar.js public/web/gags/*.js; do node --check "$f" || echo "FAIL $f"; done` (no FAIL), `npm test` (all pass), smoke harness (no console errors).

```bash
git add public/web
git commit -m "AURI: drop the old cue/aura:speech contract" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Acceptance: the sync harness on every gag

**Files (session scratchpad, not the repo):** `...\scratchpad\ui\make43.js`, `...\scratchpad\ui\sync-report3.js` (full path: `C:\Users\LUCA~1.CON\AppData\Local\Temp\claude\c--tools-A-U-R-A\abe9000d-3add-491d-94f4-8993b7af6879\scratchpad\ui\`).

- [ ] **Step 1: The harness builder `make43.js`**

```js
// flow-shoot43: FULL SYNC CHECK for the director. Chatter (budget), then every gag with chatter thrown in while they
// run, and the rage. Logs: line starts (voiced or silent, with the line id), line ends, bubble shown/hidden, move
// titles, speak calls (lane, id, bubble), gag start/end. LEVEL = personality level (2 or 4).
const fs = require("fs");
const dir = __dirname;
let src = fs.readFileSync(dir + "/flow-shoot18.js", "utf8");
const a = src.indexOf("    const ev = (expr) =>");
const b = src.indexOf("    ws.close();");
const level = Number(process.env.LEVEL || 2);
const voice = process.env.VOICE || "jf_tebukuro";
const gags = (process.env.GAGS || "wormhole,explode,peek,glitch,dance,ninja,samurai,demon,kamehameha,nani,eyes,gomu,gear5,haki,robin,bankai,sing,charset,rage").split(",");
const chatter = ["Discovery completed. Twenty five domains so far.", "Look at that, an admin panel.", "Three more services answered on port 443.", "I checked the certificates. Nothing expired.", "Code never lies. Comments sometimes do.", "The scope looks tidy today.", "Another host, another login page.", "Tip: the Explorer groups hosts by root."];
const body = `    const ev = (expr) => evalInPage(client, expr);
    await ev("localStorage.setItem('aura.speech', JSON.stringify({on:true,engine:'kokoro',voice:'${voice}',volume:0.8})); localStorage.setItem('aura.activeTab','results'); 0");
    await navigate(client, base); await sleep(3000);
    await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 700, y: 500, button: "left", clickCount: 1 }); await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 700, y: 500, button: "left", clickCount: 1 });
    await ev("document.documentElement.dataset.avatarVoice = '${level}'; 0");
    await sleep(Number(process.env.WARM || 8000));
    await ev(\`(() => {
      const T0 = performance.now(); window.__ev = []; const log = (...x) => window.__ev.push([Math.round(performance.now() - T0), ...x]);
      const st = AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start = function (...x) { window.__lastAudio = performance.now(); return st.apply(this, x); };
      window.addEventListener('aura:line', (e) => { const d = e.detail; if (d.phase === 'start') log(performance.now() - (window.__lastAudio || -1e9) < 700 ? 'voice' : 'nosound', d.text, Math.round(d.ms), d.id); else log('end', d.text, 0, d.id); });
      let shown = '';
      const watch = () => { const b = document.querySelector('.ai-avatar-bubble'); const t = b && b.classList.contains('show') && getComputedStyle(b).display !== 'none' ? b.textContent.trim() : ''; if (t !== shown) log(t ? 'bubble' : 'bubble-off', t); shown = t; };
      new MutationObserver(watch).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
      new MutationObserver((recs) => { for (const r of recs) for (const n of r.addedNodes) if (n.classList && n.classList.contains('av-an-title')) log('title', n.textContent); }).observe(document.body, { childList: true });
      const sp = window.AuraSpeech.speak; window.AuraSpeech.speak = (t, o = {}) => { const h = sp(t, o); log('speak', t, o.lane || 'chatter', h && h.id, o.bubble === false ? 'nobubble' : ''); return h; };
      window.__gag = async (name) => {
        for (let i = 0; i < 300 && (window.AuraDirector.isPerforming() || window.AuraAvatar.isRoaming()); i += 1) await new Promise((r) => setTimeout(r, 100));
        log('gag-start', name);
        const ok = name === 'rage' ? (await window.AuraAvatar.rage(), true) : await window.AuraAvatar.antic(name);
        log('gag-end', name, ok ? 'performed' : 'REFUSED');
      };
      return 0;
    })()\`);
    await ev("window.__ev.push([0, 'phase', 'budget'])");
    for (const l of ${JSON.stringify(chatter)}) { await ev("window.AuraAvatar.say(" + JSON.stringify(l) + ", 2500); 0"); await sleep(1000); }
    await sleep(40000);
    await ev("window.__ev.push([0, 'phase', 'gags'])");
    let k = 0;
    for (const g of ${JSON.stringify(gags)}) {
      const run = ev("window.__gag('" + g + "')");
      await sleep(2500);
      await ev("window.AuraAvatar.say(" + JSON.stringify("Remark number " + (k += 1) + " during a gag.") + ", 2500); 0");
      await run;
      await sleep(2500);
    }
    await sleep(15000);
    result.level = ${level};
    result.cries = (await ev("JSON.stringify(Object.fromEntries(Object.keys(window.AuraDirector.JAPANESE).map((t) => [t, window.AuraDirector.cryLine(t)[0]])))")).value;
    result.ev = (await ev("JSON.stringify(window.__ev)")).value;
    result.info = (await ev("JSON.stringify((({ rtf, slow, played, serverError }) => ({ rtf, slow, played, serverError }))(window.AuraSpeech.info()))")).value;
`;
src = src.slice(0, a) + body + src.slice(b);
src = src.replace(`process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");`, `process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");
fs.mkdirSync(path.join(workDir, "data"), { recursive: true });
fs.symlinkSync(process.env.VROOT, path.join(workDir, "data", "voice"), "junction");`);
src = src.replace("const cdpPort = 9411;", "const cdpPort = 9443;");
src = src.replace(`"--window-size=1536,816"`, `"--window-size=1536,816", "--autoplay-policy=no-user-gesture-required"`);
src = src.replace(`path.join(OUT, "report.json")`, `path.join(OUT, "report-" + ${level} + ".json")`);
fs.writeFileSync(dir + "/flow-shoot43.js", src);
console.log("written");
```

- [ ] **Step 2: The verdict `sync-report3.js`**

```js
// Verdict for flow-shoot43 against the spec's acceptance criteria. Usage: node sync-report3.js report-2.json
const r = require("./" + (process.argv[2] || "report-2.json"));
const ev = JSON.parse(r.ev || "[]");
const GAP = [1500, 1500, 1200, 1000, 800][r.level];
const BUDGET = [0, 0, 3, 5, 8][r.level];
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
const problems = [];
const starts = ev.filter((e) => e[1] === "voice" || e[1] === "nosound").map((e) => ({ t: e[0], voiced: e[1] === "voice", text: e[2], id: e[4] }));
const endOf = new Map(ev.filter((e) => e[1] === "end").map((e) => [e[4], e[0]]));
const speaks = ev.filter((e) => e[1] === "speak").map((e) => ({ t: e[0], text: e[2], lane: e[3], id: e[4], bubble: e[5] !== "nobubble" }));
const byId = new Map(speaks.map((s) => [s.id, s]));
const gags = [];
let open = null;
for (const e of ev) {
  if (e[1] === "gag-start") open = { name: e[2], t0: e[0] };
  if (e[1] === "gag-end" && open) { gags.push({ ...open, t1: e[0], result: e[3] }); open = null; }
}
const gagAt = (t) => gags.find((g) => t >= g.t0 && t <= g.t1);
for (const g of gags) if (g.result !== "performed") problems.push(`${g.name}: ${g.result}`);
// 1. a show line starts within 250 ms of being asked
for (const s of speaks.filter((x) => x.lane === "show")) {
  const st = starts.find((x) => x.id === s.id);
  if (!st) problems.push(`${gagAt(s.t)?.name || "-"}: never started "${s.text.slice(0, 40)}"`);
  else if (st.t - s.t > 250) problems.push(`${gagAt(s.t)?.name || "-"}: "${s.text.slice(0, 40)}" started ${st.t - s.t} ms after it was asked`);
}
// 2. no chatter inside a gag
for (const st of starts) {
  const g = gagAt(st.t), s = byId.get(st.id);
  if (g && s && s.lane !== "show") problems.push(`${g.name}: chatter "${st.text.slice(0, 40)}" inside the gag`);
}
// 3. every line with a bubble shows it within 50 ms of its start and hides it within 400 ms of its end
const bubbles = ev.filter((e) => e[1] === "bubble" || e[1] === "bubble-off").map((e) => ({ t: e[0], on: e[1] === "bubble", text: e[2] }));
for (const st of starts) {
  const s = byId.get(st.id);
  if (s && !s.bubble) continue;
  const head = norm(st.text.split("\n")[0]).slice(0, 25);
  const shown = bubbles.find((b) => b.on && norm(b.text).startsWith(head) && Math.abs(b.t - st.t) <= 50);
  if (!shown) { problems.push(`no bubble within 50 ms for "${st.text.slice(0, 40)}"`); continue; }
  const end = endOf.get(st.id);
  if (end == null) continue;
  const gone = bubbles.find((b) => b.t >= shown.t + 1 && (!b.on || !norm(b.text).startsWith(head)));
  if (!gone || gone.t - end > 400) problems.push(`bubble of "${st.text.slice(0, 40)}" still up ${gone ? gone.t - end : "?"} ms after its end`);
}
// 4. no line heard twice (a resume after a cut keeps the same id)
const heard = new Map();
for (const st of starts.filter((x) => x.voiced)) {
  if (heard.has(st.text) && heard.get(st.text) !== st.id) problems.push(`heard twice: "${st.text.slice(0, 40)}"`);
  heard.set(st.text, st.id);
}
// 5. breathing gap between chatter lines
let prevEnd = null;
for (const st of [...starts].sort((x, y) => x.t - y.t)) {
  const s = byId.get(st.id);
  if (s && s.lane !== "show" && prevEnd != null && st.t - prevEnd < GAP - 30) problems.push(`gap ${st.t - prevEnd} ms before "${st.text.slice(0, 40)}" (min ${GAP})`);
  prevEnd = endOf.get(st.id) ?? prevEnd;
}
// 6. budget: spoken chatter per rolling minute; and none lost
const spokenChatter = starts.filter((x) => x.voiced && byId.get(x.id) && byId.get(x.id).lane !== "show").map((x) => x.t);
for (const t of spokenChatter) { const n = spokenChatter.filter((u) => u > t - 60000 && u <= t).length; if (n > BUDGET + 2) problems.push(`budget: ${n} spoken chatter lines in the minute before ${t} ms (budget ${BUDGET}; forced lines excepted)`); }
for (const s of speaks) if (!starts.some((x) => x.id === s.id)) problems.push(`lost: "${s.text.slice(0, 40)}"`);
// 7. console errors
if ((r.consoleErrors || []).length) problems.push("console errors: " + JSON.stringify(r.consoleErrors));
console.log(`level ${r.level}: ${gags.length} gags, ${starts.length} line starts (${starts.filter((x) => x.voiced).length} voiced), ${speaks.length} asked; info ${r.info}`);
console.log(problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "ALL CRITERIA MET");
```

(Criterion 6 tolerates `BUDGET + 2` because the gags phase adds forced lines such as "...sorry. I lost my temper."; the line-by-line check of forced vs not is in the `speaks` lanes.)

- [ ] **Step 3: Run at level 2 and level 4**

From the scratchpad `ui` folder (muted Chromium; `vroot8` = empty voice cache linked to the real packs):

```bash
node make43.js
R=$(cd ../vroot8 && pwd -W)
LEVEL=2 VROOT="$R" timeout 590 node flow-shoot43.js > run43-2.log 2>&1; node sync-report3.js report-2.json
LEVEL=4 VROOT="$R" timeout 590 node flow-shoot43.js > run43-4.log 2>&1; node sync-report3.js report-4.json
tasklist | grep -ci headless_shell
```

Run each in the background (`run_in_background`), one at a time. Expected: `ALL CRITERIA MET` for both, and `0` headless shells left.

- [ ] **Step 4: Fix and re-run**

For each problem: find the gag line in the source, fix it with the Task 5/6 tables (most likely a `s.say` that was not awaited before the next `s.say`, so the second one waited behind the first), re-run only that gag with `GAGS=<name>`, then re-run the full level once. Commit fixes:

```bash
git add public/web
git commit -m "AURI: sync fixes from the acceptance run" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Ponytail review pass

- [ ] **Step 1: Review the whole change**

Invoke the `ponytail-review` skill on the diff from the spec commit to `HEAD` (`git diff 34956d6..HEAD -- public/web tests`), reading the connected code (queue, voice, director, avatar, antics, packs).

- [ ] **Step 2: Fix what it finds**

For each finding with a concrete failure case: fix it (Edit tool), add or adjust a unit test when the logic is in the queue or the extractor, run `npm test`, and re-run the sync harness for the affected gags. Skip "consider" items without a case.

- [ ] **Step 3: Final checks and commit**

Run: `npm test` (all pass), smoke harness (no console errors, no failed requests), both acceptance levels (`ALL CRITERIA MET`), `tasklist | grep -ci headless_shell` = `0`.

```bash
git add public/web tests
git commit -m "AURI: ponytail review fixes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Hand back**

Report to the user in Italian: what changed, the acceptance numbers for both levels, what was not verified (her real browser), the reminder to restart `npm run web` and reload with Ctrl+F5. Ask before pushing.
