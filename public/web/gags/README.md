# Aura gag packs

Extra avatar gags live here so they can be added with any release without touching the core avatar code.

## Add a new gag

1. Create `gags/my-pack.js` (one pack can hold several gags):

```js
"use strict";
(function () {
  // s = the stage (see "Writing a gag" below). Shared effect helpers (smoke, shake, fx, wait, rand, pick, done, centre)
  // are in window.AuraAnimeFx (gags/anime.js).
  async function myGag(s) {
    const home = s.home();
    const spot = s.randomPoint();
    s.place(home);
    await s.say("Something new!").started;
    await s.move(home, spot, { ms: 1400 });
    await s.say("Here I am.", { min: 1200 });
    await s.move(spot, s.home(), { ms: 1300 });
  }
  window.AuraAvatar.registerAntic("myGag", myGag, true); // true = rare
})();
```

2. Add CSS for it at the end of `ai-avatar.css` (use theme tokens: `--accent`, `--bad`, `--warn`, `--ink`, `--panel`).
3. List the pack in `manifest.json` (`id`, `file`, `since` = release version, `title`, `gags`). Bump `since` when you change a pack so browsers refetch it.
4. Test it by hand: `AuraAvatar.antic("myGag")` in the console.

## Writing a gag

A gag is `async function name(s) { ... }` registered with `window.AuraAvatar.registerAntic(name, fn, isRare)`. It runs
as a performance (`window.AuraDirector.perform`): it starts only when its lines are ready, she is not clickable while
it runs, and no other line is said until it ends.

Her voice sets the time:

- `await s.say("Line.")`: ends when she has said it. `await s.say("Line.", { min: 1500 })`: and at least 1.5 s.
- `await s.say("Line.").started`: she has just started; walk or animate while she talks.
- `s.say("Line.")` without `await`: a remark during an effect; it still waits its turn after the previous line.
- `const ms = await s.cry("KAMEHAMEHA", { ms: 1500 })`: the battle cry (Japanese when the move is in the director's
  table); the big title appears as she starts it and resolves then, with the cry's length in `ms` (to time the
  strike). The `ms` option is the minimum time the title stays up: it stays up for the cry's length plus 0.2 s if
  that is longer (default 1.5 s). `{ silentTitle: true }` skips the title (she only shouts), for a gag that draws its own.
- `s.title("MOVE", 1500)`: the title only, silent.
- `s.say(s.pick(["A.", "B."]))`, `s.say(s.quote("First.", "gag:key"))`: random lines that are still prepared ahead.
- `s.say("Text", { voice: false, min: 1800 })`: a bubble only; it lasts exactly `min` (without `min`, the time to
  read it). The director does not prepare any audio for it.

Write the lines as string literals in those calls: the director reads them from the source to prepare them. A line
built at run time (a number, a host name) works too; the gag waits for it at that beat.

Lines kept in a table are not literals in a call, so the director cannot find them. Unroll them into literal calls:
`const says = [(o) => s.say("A.", o), (o) => s.say("B.", o)]` (then `await says[i]({ min: 1200 })`), not
`const lines = ["A.", "B."]` with `s.say(lines[i])`.

Drawing helpers: `s.el`, `s.size`, `s.at(p, scale, rot)`, `s.place(p, o)`, `s.move(from, to, o)`, `s.anim(frames, o)`,
`s.act(name, ms)`, `s.sleep(ms)`, `s.home()`, `s.randomPoint(margin)`. Shared effects: `window.AuraAnimeFx`.

## Rules of the stage

- Never leave elements behind: remove every node you create, finish animations, use `fill: "forwards"` only on nodes you remove.
- Lines are said one at a time, in order: before a beat that depends on a line (a cry, a strike), `await` the previous line,
  or the new one waits behind it.
- A performance can be cut short (60 s cap, an error): wrap the part between a change outside her copy (a class on
  `document.documentElement` or `body`, an overlay) and its undo in `try { ... } finally { ... }`. Effects that remove
  themselves (`done(anim, el)`) need nothing.
- Reduced motion is handled by the stage (gags do not run when it is on).
- A misbehaving gag can be switched off without a release by adding its name to `"disabled"` in `manifest.json`.
- Packs the user has not seen yet are announced once ("New moves unlocked").
