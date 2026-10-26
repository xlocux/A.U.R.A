"use strict";

// Aura's antics: short choreographed gags that happen on ANY section, not just the Flow.
// wormhole, explode (and rebuild), catch-me (she flees from your cursor), peek, glitch, dance and a section visit.
// They are rare and polite: personality-level aware, never while you type, in a modal or in a fullscreen view,
// with a long cooldown. Double-click her for an instant one. window.AuraAvatar.antic(name) runs one by hand.
(function initAvatarAntics() {
  const A = () => window.AuraAvatar;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const quote = (key, fallback) => (window.AuraQuotes && window.AuraQuotes.get(key, { force: true })) || fallback;
  const line = (first, key, fallback) => first + "\n" + quote(key, fallback || "");

  // ── small effect helpers (fixed, self-removing) ──
  function node(className, x, y, extra = "") {
    const el = document.createElement("div");
    el.className = className;
    el.style.left = x + "px";
    el.style.top = y + "px";
    if (extra) el.style.cssText += extra;
    document.body.appendChild(el);
    return el;
  }
  function portal(x, y) {
    const el = node("av-portal", x, y);
    el.animate([{ scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }], { duration: 450, easing: "ease-out", fill: "forwards" });
    return {
      el,
      close: async () => { await el.animate([{ scale: 1, opacity: 1 }, { scale: 0, opacity: 0 }], { duration: 400, easing: "ease-in", fill: "forwards" }).finished; el.remove(); }
    };
  }
  function burst(x, y, count = 28) {
    for (let i = 0; i < count; i += 1) {
      const p = node("av-particle", x, y);
      const a = Math.random() * Math.PI * 2;
      const d = 70 + Math.random() * 150;
      p.animate([{ transform: "translate(0,0) scale(1)", opacity: 1 }, { transform: "translate(" + Math.cos(a) * d + "px," + Math.sin(a) * d + "px) scale(.2)", opacity: 0 }], { duration: 800 + Math.random() * 700, easing: "cubic-bezier(.1,.8,.3,1)", fill: "forwards" }).finished.then(() => p.remove());
    }
    const ring = node("av-shock", x, y);
    ring.animate([{ transform: "scale(.2)", opacity: 0.9 }, { transform: "scale(7)", opacity: 0 }], { duration: 900, easing: "ease-out", fill: "forwards" }).finished.then(() => ring.remove());
    const flash = node("av-flash", 0, 0, "--fx:" + x + "px;--fy:" + y + "px;");
    flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 520, easing: "ease-out", fill: "forwards" }).finished.then(() => flash.remove());
  }
  function implode(x, y, count = 22) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const d = 80 + Math.random() * 140;
      const p = node("av-particle", x, y);
      p.animate([{ transform: "translate(" + Math.cos(a) * d + "px," + Math.sin(a) * d + "px) scale(.3)", opacity: 0 }, { transform: "translate(0,0) scale(1)", opacity: 1 }], { duration: 900, easing: "ease-in", fill: "forwards" }).finished.then(() => p.remove());
    }
  }

  // ── the gags ──
  const ANTICS = {
    async wormhole(s) {
      const home = s.home();
      const spot = s.randomPoint();
      s.place(home);
      s.say("Hold on, I know a shortcut.", 2600);
      await s.move(home, spot, { ms: 1500 });
      const gate = portal(spot.x + 23, spot.y + 30);
      await s.sleep(450);
      s.say(line("Wormhole engaged.", "gag:wormhole"), 3600);
      await s.anim([{ transform: s.at(spot, 1, 0), opacity: 1 }, { transform: s.at(spot, 0.04, 720), opacity: 0 }], { duration: 950, easing: "ease-in" });
      await gate.close();
      await s.sleep(1400 + Math.random() * 1600);
      const exit = s.randomPoint();
      const gate2 = portal(exit.x + 23, exit.y + 30);
      await s.sleep(450);
      s.say(line("Miss me?", "gag:wormholeBack"), 3400);
      await s.anim([{ transform: s.at(exit, 0.04, -720), opacity: 0 }, { transform: s.at(exit, 1, 0), opacity: 1 }], { duration: 950, easing: "ease-out" });
      await gate2.close();
      s.act("sparkle", 1400);
      await s.sleep(900);
      await s.move(exit, s.home(), { ms: 1500 });
    },

    async explode(s) {
      const home = s.home();
      const spot = s.randomPoint(160);
      s.place(home);
      s.say("Warning: power level critical!", 2400);
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
      s.say(line("BOOM.", "gag:explode"), 3800);
      await s.sleep(2300);
      implode(cx, cy);
      await s.sleep(850);
      burst(cx, cy, 10);
      await s.anim([{ transform: s.at(spot, 0.2), opacity: 0 }, { transform: s.at(spot, 1), opacity: 1 }], { duration: 450, easing: "ease-out" });
      s.say(line("Reconstructing... done. I'm fine!", "gag:rebuilt"), 3600);
      s.act("wink", 1300);
      await s.sleep(1500);
      await s.move(spot, s.home(), { ms: 1500 });
    },

    // She runs away from the cursor. Catch her (click) to win; otherwise she taunts you after 15 seconds.
    async catchMe(s) {
      const r = s.el;
      const home = s.home();
      let pos = s.randomPoint();
      s.place(home);
      s.say(line("Bet you can't catch me!", "gag:catch"), 3600);
      await s.move(home, pos, { ms: 1300 });
      r.style.pointerEvents = "auto";
      r.style.cursor = "pointer";
      let caught = false;
      let dodging = false;
      let dodges = 0;
      let finish;
      const done = new Promise((resolve) => { finish = resolve; });
      const dodge = async (event) => {
        if (caught || dodging) return;
        const cx = pos.x + 23;
        const cy = pos.y + 26;
        if (Math.hypot(event.clientX - cx, event.clientY - cy) > 115) return;
        dodging = true;
        let best = pos;
        let bestDist = -1;
        for (let i = 0; i < 9; i += 1) {
          const p = s.randomPoint(70);
          const d = Math.hypot(event.clientX - (p.x + 23), event.clientY - (p.y + 26));
          if (d > bestDist) { bestDist = d; best = p; }
        }
        const from = pos;
        pos = best;
        dodges += 1;
        if (dodges === 6) s.say("Too slow!", 1800);
        await s.move(from, best, { ms: 360, lift: 30, easing: "cubic-bezier(.2,.8,.2,1)" });
        dodging = false;
      };
      const onClick = () => { caught = true; finish(); };
      window.addEventListener("pointermove", dodge, { passive: true });
      r.addEventListener("click", onClick);
      const timer = setTimeout(finish, 15000);
      await done;
      clearTimeout(timer);
      window.removeEventListener("pointermove", dodge);
      r.removeEventListener("click", onClick);
      r.style.pointerEvents = "none";
      if (caught) {
        const total = Number(localStorage.getItem("auraCatches") || 0) + 1;
        localStorage.setItem("auraCatches", String(total));
        s.act("cheer", 1900);
        s.say(total >= 3 ? line("Okay, " + total + " catches. Pro hacker detected.", "gag:caught") : line("You got me!", "gag:caught"), 4200);
      } else {
        s.act("wink", 1400);
        s.say(line("Too slow, too slow.", "gag:missed"), 3600);
      }
      await s.sleep(2200);
      await s.move(pos, s.home(), { ms: 1500 });
    },

    async peek(s) {
      const side = pick(["right", "left", "bottom"]);
      const y = 130 + Math.random() * (innerHeight - 330);
      const x = 120 + Math.random() * (innerWidth - 380);
      const start = side === "right" ? { x: innerWidth + 6, y } : side === "left" ? { x: -s.size.w - 6, y } : { x, y: innerHeight + 6 };
      const shown = side === "right" ? { x: innerWidth - 40, y } : side === "left" ? { x: -6, y } : { x, y: innerHeight - 46 };
      s.place(start);
      await s.anim([{ transform: s.at(start) }, { transform: s.at(shown) }], { duration: 700, easing: "ease-out" });
      s.act("wink", 1300);
      s.say(line("Psst...", "gag:peek"), 3800);
      await s.sleep(3000);
      await s.anim([{ transform: s.at(shown) }, { transform: s.at(start) }], { duration: 600, easing: "ease-in" });
    },

    async glitch(s) {
      const home = s.home();
      const spot = s.randomPoint();
      s.place(home);
      s.el.classList.add("av-glitching");
      await s.anim([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0 }], { duration: 650 });
      s.place(spot, { opacity: 0 });
      s.el.classList.add("av-glitching");
      await s.anim([{ opacity: 0 }, { opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 650 });
      s.el.classList.remove("av-glitching");
      s.say(line("Teleport complete. Mostly.", "gag:glitch"), 3800);
      await s.sleep(2800);
      s.el.classList.add("av-glitching");
      await s.anim([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 0 }], { duration: 550 });
      s.place(s.home(), { opacity: 0 });
      await s.anim([{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
    },

    // She dances until you move the mouse close, then pretends nothing happened.
    async dance(s) {
      const home = s.home();
      const spot = s.randomPoint();
      s.place(home);
      await s.move(home, spot, { ms: 1400 });
      s.say(line("Nobody's watching, right?", "gag:dance"), 4000);
      let caught = false;
      const watch = (event) => { if (Math.hypot(event.clientX - (spot.x + 23), event.clientY - (spot.y + 26)) < 150) caught = true; };
      window.addEventListener("pointermove", watch, { passive: true });
      for (let i = 0; i < 8 && !caught; i += 1) {
        await s.anim([
          { transform: s.at(spot, 1, i % 2 ? 10 : -10) }, { transform: s.at({ x: spot.x, y: spot.y - 16 }, 1.05, i % 2 ? -10 : 10) }, { transform: s.at(spot, 1, i % 2 ? 10 : -10) }
        ], { duration: 520, easing: "ease-in-out" });
      }
      window.removeEventListener("pointermove", watch);
      if (caught) { s.say("...you saw nothing.", 2400); await s.sleep(1800); }
      await s.move(spot, s.home(), { ms: 1400 });
    },

    // Walks up to something in the current section and comments on it.
    async section(s) {
      const tab = document.querySelector(".tab.active")?.dataset.tab || "recon";
      const target = [...document.querySelectorAll(".tab-panel.active .pane h2, .tab-panel.active h2")].find((el) => el.getClientRects().length && el.getBoundingClientRect().top > 60);
      const home = s.home();
      let spot = s.randomPoint();
      if (target) { const b = target.getBoundingClientRect(); spot = { x: Math.min(innerWidth - 80, b.left + 80), y: Math.max(70, b.top - 54) }; }
      s.place(home);
      await s.move(home, spot, { ms: 1500 });
      s.act("tilt", 1100);
      const text = window.AuraQuotes && window.AuraQuotes.get("section:" + tab, { force: true });
      s.say(text || "Just looking around.", 4200);
      await s.sleep(3600);
      await s.move(spot, s.home(), { ms: 1500 });
    }
  };

  // ── when is it OK to perform? ──
  let lastInput = Date.now();
  let lastAntic = 0;
  let lastName = "";
  const markInput = () => { lastInput = Date.now(); };
  ["pointerdown", "keydown", "wheel"].forEach((type) => window.addEventListener(type, markInput, { passive: true }));

  function okToPerform() {
    const api = A();
    if (!api || api.voice() < 2 || api.isRoaming() || api.isThinking() || document.hidden) return false;
    if (Date.now() - lastInput < 5000) return false; // someone is busy
    if (document.querySelector(".fx-modal:not(.hidden), #flowStageModal.open")) return false;
    if (document.body.classList.contains("topology-fullscreen-mode") || document.body.classList.contains("results-view-expanded") || document.fullscreenElement) return false;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
    return true;
  }

  async function run(name) {
    const api = A();
    if (!api || !ANTICS[name]) return false;
    const performed = await api.stage(ANTICS[name]);
    if (performed) { lastAntic = Date.now(); lastName = name; }
    return performed;
  }

  function chooseName() {
    const names = Object.keys(ANTICS).filter((n) => n !== lastName);
    // explode is the showpiece: keep it rare
    const pool = names.flatMap((n) => (n === "explode" ? [n] : [n, n]));
    return pick(pool);
  }

  function schedule() {
    const level = A() ? A().voice() : 2;
    const gap = level >= 3 ? 100000 : 240000; // minimum time between gags
    const wait = (level >= 3 ? 45000 : 70000) + Math.random() * 50000;
    setTimeout(async () => {
      if (okToPerform() && Date.now() - lastAntic > gap) await run(chooseName());
      schedule();
    }, wait);
  }

  function boot() {
    schedule();
    // Double-click her for an instant gag (any personality level above Silent).
    document.addEventListener("dblclick", (event) => {
      if (!event.target.closest("[data-ai-avatar]") || !A() || A().voice() < 1 || A().isRoaming()) return;
      run(chooseName());
    });
  }

  window.AuraAvatar = Object.assign(window.AuraAvatar || {}, { antic: run, antics: Object.keys(ANTICS) });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
