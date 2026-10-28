# AURI director: one conductor for voice, bubbles and gags

Status: approved design (2026-10-29). Sub-project 1 of 2. Sub-project 2 (AURI aware of the dashboard section and of
the data on screen) gets its own design after this one ships.

## Problem

Gags look broken: her voice and her moves do not match, she talks while no bubble shows, gags end abruptly or stand
still. Measured with the headless sync check (all gags, Kokoro Tebukuro, 7 minutes) and confirmed in the code:

1. **Two clocks.** Gag scripts time their visuals with fixed waits (about 190 `s.say` / `wait` / `s.sleep` calls in
   `avatar-antics.js`, `gags/*.js`). `s.say` only queues a line; a Kokoro line starts 0.1-8 s later. Only `move` and
   `anim` wait for the line to start; effects, clones and `wait()` do not. Example: ninja asks "Which one was the real
   me?" at 67.5 s, it is heard at 70.5 s, the gag waited 2.2 s and was already walking home. The stage then waits up to
   20 s for leftover lines.
2. **Shared queue.** A gag starts when the queue looks idle at one instant. A chatter line queued just before is said in
   the middle of the gag, split around the gag's lines (seen in "nani").
3. **Repeat bug.** Each rage cry preempts the line in progress; that line resumes from its cut piece between two cries
   and is cut again. "So many assets. The Risk URLs tab has the juicy ones." was heard 6 times in one rage scene.
4. **Bubbles keyed by text, five paths.** Pending bubble, silent bubble, `line()`'s own bubble, move title, rage text,
   all on one element and matched by text. Lines said with `AuraSpeech.speak()` directly have no bubble; bubbles during
   a rage are hidden; a voice that starts after the gag ended pops its bubble late at the home avatar.
5. **Random share hits gags.** The "she voices only a share of her remarks" rule skips cries and `line()` but not the
   gag's `s.say` lines: some gag lines are silent at random.
6. **Prefetch misses.** Gag lines are prefetched at start-up with the emotion inferred at that moment. The emotion
   depends on the personality level (level 4 turns a neutral line "creepy"), and the cache key holds emotion and speed,
   so a prefetched line can miss the cache and be generated in the middle of the gag.

## Goals

- A gag starts only when its lines are ready, then every move follows the real length of her voice.
- No chatter ever plays during a performance (gag, rage, tantrum scene).
- Every line, spoken or silent, has exactly one bubble, shown from the start to the end of the line.
- No line is lost: a line is either spoken or shown as a bubble in its turn.
- The director sets the pace: a breathing gap between lines and a per-level budget of spoken chatter. She never talks
  in bursts unless an important event forces it.
- No line is said twice.

## Non-goals

- Changing what she says (that is sub-project 2), the voice server (`src/web/services/voice-engine.js`), the voice
  packs, the A.U.R.I widget.
- A declarative timeline or sample-accurate scheduling: gags stay imperative scripts.

## Decisions taken with the user

- Slow voice: prepare first, then perform. A gag whose lines are not ready in time is postponed, never played with
  pauses in the middle.
- During a gag she is not clickable (no poke, no drag, no double-click). Walks to a tile (`roamTo`) stay clickable as
  today, so poking her (and the rage after 4 pokes) still works.
- We manage time: breathing gap and chatter budget, forced lines excepted.

## Architecture

Three units, one job each.

### Voice: `public/web/avatar-voice.js` (queue, generation, player)

Knows nothing about gags or bubbles.

- `speak(text, opts) -> handle`. `handle = { id, started, ended, voiced }`.
  - `started`: Promise resolving with the line's length in ms when she starts it (0 when the line is skipped by `stop()`).
  - `ended`: Promise resolving when the line is over (spoken, shown silently for its estimated length, or stopped).
  - `voiced`: false when the line will be a silent bubble (budget, voice off, nothing pronounceable).
  - `opts`: `lane` (`"show"` | `"chatter"`, default chatter), `show` (performance id), `forced` (bool), `emotion`,
    `lang`, `voice` (false = bubble only), `bubble` (false = no bubble, or `{ pain: true }`), `min` (ms, minimum length
    of the line's slot), `loud`.
- `prepare(lines, { timeoutMs }) -> Promise<{ ready, missing }>`. `lines` = `[{ text, emotion, lang }]`. Generates
  every piece with the exact cache key it will use when spoken, at high priority on the server. Resolves when all are
  ready or at the timeout.
- `hold(showId)` / `release(showId)`: while held, only `show` items of that id play. Chatter waits in its lane.
- `idle()`: true when nothing plays, nothing is queued and nothing is generating (except background prefetch).
- `emotionFor(text, opts)`: the emotion a line will get now (exported so the director prepares with the same one).
- Events: `aura:line` with `{ id, text, ms, phase: "start" | "end", bubble }`. The only source bubbles listen to.
  `aura:speech` is removed (its listeners move to `aura:line`).
- Queue order: `show` lane of the held performance; then forced chatter; then chatter. Chatter is held during a
  performance and paced by the metronome.
- Interruption: only a poke or a rage outside a performance cuts the line in progress (`loud`). The cut line resumes
  from its cut piece **once**; a second cut turns its remaining pieces into a silent bubble. A performance never cuts
  and is never cut.
- The random share is removed from the voice; the metronome replaces it (below).
- Removed: `cue`, `onStart`, `done`, `deadline`, `deadlineFor`, `busyWith`, the text-keyed `aura:speech` contract.

### Director: `public/web/avatar-director.js` (new, ~300 lines)

Owns every performance: antics and gag packs, rage, tantrum scenes.

`perform(name, script, opts) -> Promise<boolean>` (false = not performed, try later):

1. **Can perform?** The checks now in `avatar-antics.js` `okToPerform` move here (level, not typing, no modal, not
   fullscreen, page visible, not roaming, not thinking, not away, no other performance running).
2. **Floor.** `voice.hold(showId)` at once, so no new chatter line starts. If a line is playing, wait for it to end
   (never cut it), at most 10 s; past that, `release` and return false. Chatter already queued stays queued.
3. **Prepare.** Extract the gag's lines from `String(script)` (see Line extraction), map each to
   `{ text, emotion: voice.emotionFor(text), lang }`, call `voice.prepare(lines, { timeoutMs: 6000 })`. If anything is
   missing at the timeout: `release`, return false. Preparation keeps running in the background, so the next attempt is
   instant.
4. **Stage.** Hide the home avatar, show the roamer, `pointer-events: none` on it, disable drag and double-click.
5. **Run** the script with the stage API (below).
6. **Close.** Await the `ended` of every line the gag asked for, remove leftover effects, roamer home and hidden,
   pointer events back, `voice.release(showId)`. Always in a `finally`.

Stage API given to scripts (`s`):

- `say(text, opts) -> handle`. The stage handle is a thenable: `await s.say(x)` (or `await v` on a kept handle)
  resolves at `handle.ended`, and not before `opts.min` ms from the line's start.
  Lines go to the `show` lane, always voiced (no budget), with a bubble. `opts.voice: false` = bubble only.
- `cry(move, opts) -> Promise<ms>`: the battle cry (Japanese romaji via the `JAPANESE` table, emotion `shout`,
  `bubble: false`), shows the big move title as she starts it, resolves at the start with the cry's length so the gag
  can time its strike. Replaces `title()` / `shout()` in `gags/anime.js` (they move into the director).
- `pick(list)`: random choice; also marks every option for preparation.
- `move`, `anim`, `place`, `at`, `act`, `sleep`, `home`, `randomPoint`, `el`, `size`: as today. `move` and `anim` no
  longer wait implicitly for a line (`pace` is removed): the script awaits the line it needs.
- `line(text, ms)` is kept as an alias of `say(text, { min: ms })` for old packs.

### Avatar: `public/web/ai-avatar.js` (drawing, bubble, reactions)

- One `renderBubble`, driven by `aura:line`: on `start`, show the line's text (original text, with `#@%&`) over the
  visible mount (the roamer during a performance, the home avatar otherwise); on `end`, hide it 300 ms later unless a
  newer line took it. `bubble: false` lines show nothing; `{ pain: true }` gets the red style.
- Removed: `pendingBubbles`, `showBubble` calls from other modules, the "silent bubble only when not busy" path,
  `deferred` / `flushDeferred` (the chatter lane replaces them).
- `say(text, ms, force, opts)` stays as the chatter entry point: it calls `voice.speak` on the chatter lane. A click
  on the home avatar, a poke and important events (vuln found, run done, stage failed) are `forced`.
- `stage()` and `rage()` move to the director (rage becomes a performance: its cries are prepared and said in a row
  with the full-screen text, no bubble).
- Expected size: ~630 -> ~480 lines.

## The metronome (pace)

Lives in the voice queue, applies to the chatter lane only (a performance sets its own timing).

- Breathing gap between the end of a line and the start of the next: level 0-1: 1.5 s, 2: 1.2 s, 3: 1.0 s,
  4: 0.8 s. Never zero. Forced lines also respect it (a gap of silence is not a burst).
- Spoken chatter budget per rolling minute: level 1: 0 (only forced lines are spoken, as today's "important moments
  only"), 2: 3, 3: 5, 4: 8. Level 0 says nothing (as today). Over budget, a chatter line becomes a silent bubble in its turn, with the same gap. Forced lines
  do not use the budget and are always spoken.
- Coalescing: chatter lines with the same `kind` (e.g. `"status"`) waiting in the lane replace each other: only the
  newest is said. Lines without a `kind` are never merged.
- After a performance the held chatter plays through the metronome, one at a time.

## Line extraction

Regex over the script source, as `anticLines()` does today, extended:

- literal first argument of `s.say(...)`, `s.line(...)`, `s.cry(...)` (cry text mapped to its romaji and `ja`);
- every string literal inside `s.pick([...])`.

Lines built at run time (numbers, names from the run) are not found: they are generated when said and the script
waits at that beat, so sync holds. `anticLines()` and the start-up prefetch use the same extractor and
`emotionFor()` with the current level.

## Gag conversion rules

All antics in `avatar-antics.js`, every pack in `gags/*.js`, the scenes in `avatar-tantrums.js`:

| Today | After |
| --- | --- |
| `s.say(x, ms); await wait(n)` / `await s.sleep(n)` | `await s.say(x, { min: n })` |
| talk while moving | `const v = s.say(x); await s.move(...); await v` |
| `await title("MOVE")` | `const cryMs = await s.cry("MOVE")` |
| `s.say(pick([...]))` | `s.say(s.pick([...]))` |
| `s.say(x, ms, false, { silent: true })` | `s.say(x, { voice: false, min: ms })` |
| `AuraSpeech.cue(...)` inside a scene | `await s.say(...)` / `s.cry(...)` |
| visual-only timing (`wait` between effects) | unchanged |

`gags/README.md` is rewritten for the new API.

## Failure handling

- Voice off, engine not ready, audio blocked by the browser: handles resolve on estimated lengths
  (380 ms per word + 700 ms); bubbles behave the same; gags run unchanged.
- A line that fails to generate during a performance: shown as a silent bubble for its estimated length; the gag goes
  on.
- A script that throws: the `finally` closes the performance (effects removed, avatar home, clicks back, chatter
  released).
- `stop()` (voice settings opened, voice turned off): every handle resolves (`started` with 0), bubbles hide, the
  performance ends at its next await.
- A performance must never hold the chatter lane forever: a hard cap of 60 s per performance, then close.

## Acceptance (how we say "it works")

The headless sync check (`flow-shoot42` + `sync-report2`, muted, Kokoro Tebukuro) is extended and run on every gag,
Nico Robin's Mil Fleur included, at levels 2 and 4. Measured criteria:

1. A prepared gag line is heard within 250 ms of the moment the gag asks for it.
2. Zero chatter lines between a gag's start and end.
3. Every heard line has its bubble: shown within 50 ms of the voice start, hidden within 400 ms of its end.
4. No line heard twice.
5. The gap between two consecutive lines is never below the breathing gap, except inside a performance.
6. Over budget, extra chatter shows as bubbles; the count of lines asked equals spoken + silent (none lost).
7. Zero console errors; no test process left running.

Node unit tests (vm-loaded browser modules, fake audio): line extraction, metronome (gap, budget, coalescing), queue
lanes and hold/release, resume-once.

Final judgement: the user, watching her live.

## Files

- New: `public/web/avatar-director.js`, `tests/avatar-director.test.js`, `tests/avatar-voice-queue.test.js`.
- Changed: `public/web/avatar-voice.js`, `public/web/ai-avatar.js`, `public/web/avatar-antics.js`,
  `public/web/avatar-tantrums.js`, `public/web/avatar-gags.js`, `public/web/avatar-drag.js`, `public/web/gags/*.js`,
  `public/web/gags/README.md`, `public/web/index.html` (script order: voice, director, avatar, antics, packs).
- Unchanged: the voice server and routes, `avatar-quotes.js` (sub-project 2), storage, every non-AURI file.
