# Aura gag packs

Extra avatar gags live here so they can be added with any release without touching the core avatar code.

## Add a new gag

1. Create `gags/my-pack.js` (one pack can hold several gags):

```js
"use strict";
(function () {
  // s = stage helpers: place, move, anim, at, say, act, sleep, home, randomPoint, size, el
  // Shared effect helpers (smoke, title, shake, fx, wait, rand, pick, done) are in window.AuraAnimeFx (gags/anime.js).
  async function myGag(s) {
    const home = s.home();
    s.place(home);
    s.say("Something new!", 1800);
    await s.move(home, s.randomPoint(), { ms: 1400 });
    await s.sleep(1200);
    await s.move(s.randomPoint(), s.home(), { ms: 1300 });
  }
  window.AuraAvatar.registerAntic("myGag", myGag, true); // true = rare
})();
```

2. Add CSS for it at the end of `ai-avatar.css` (use theme tokens: `--accent`, `--bad`, `--warn`, `--ink`, `--panel`).
3. List the pack in `manifest.json` (`id`, `file`, `since` = release version, `title`, `gags`). Bump `since` when you change a pack so browsers refetch it.
4. Test it by hand: `AuraAvatar.antic("myGag")` in the console.

## Rules of the stage

- Never leave elements behind: remove every node you create, finish animations, use `fill: "forwards"` only on nodes you remove.
- Use `s.say(...)`; it already respects the personality level.
- Reduced motion is handled by the stage (gags do not run when it is on).
- A misbehaving gag can be switched off without a release by adding its name to `"disabled"` in `manifest.json`.
- Packs the user has not seen yet are announced once ("New moves unlocked").
