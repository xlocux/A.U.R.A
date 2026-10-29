"use strict";

// Gag pack loader. Aura's extra gags live in /gags/*.js and are listed in /gags/manifest.json, so new ones can ship
// with any release without touching the core avatar code: drop in a pack file, add a manifest entry, done.
//  - packs load in manifest order (a pack may depend on the ones above it)
//  - "disabled" in the manifest switches individual gags off (kill-switch for a gag that misbehaves)
//  - a pack that fails to load is skipped; it never breaks the avatar
//  - packs the user has not seen yet are announced once ("New moves unlocked"), never on the very first run
(function initGagLoader() {
  const SEEN_KEY = "aura.gags.seen";

  const load = (src) => new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.append(script);
  });

  function announce(fresh) {
    const api = window.AuraAvatar;
    if (!fresh.length || !api || api.voice() < 1) return;
    const names = fresh.flatMap((p) => p.gags || []).slice(0, 4).join(", ");
    setTimeout(() => api.say(`New moves unlocked: ${names}. Double-click me.`, 5200, true), 4500);
  }

  async function boot() {
    let manifest;
    try { manifest = await fetch("/gags/manifest.json", { cache: "no-cache" }).then((r) => r.json()); } catch { return; }
    const api = window.AuraAvatar;
    if (!api || !api.registerAntic) return;
    // Wrap registration so the kill-switch applies to every pack.
    const off = new Set(manifest.disabled || []);
    const register = api.registerAntic;
    api.registerAntic = (name, fn, isRare) => { if (!off.has(name)) register(name, fn, isRare); };
    const loaded = [];
    for (const pack of manifest.packs || []) {
      if (await load(`/gags/${pack.file}?v=${encodeURIComponent(pack.since || "0")}`)) loaded.push(pack);
    }
    api.registerAntic = register;
    window.AuraGags = { manifest, loaded: loaded.map((p) => p.id) };
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
    try {
      const raw = localStorage.getItem(SEEN_KEY);
      const seen = new Set(raw ? JSON.parse(raw) : []);
      if (raw) announce(loaded.filter((p) => !seen.has(p.id)));
      localStorage.setItem(SEEN_KEY, JSON.stringify(loaded.map((p) => p.id)));
    } catch { /* storage unavailable */ }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
