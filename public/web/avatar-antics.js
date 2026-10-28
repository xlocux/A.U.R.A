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
      r.dataset.catching = "1";
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
      delete r.dataset.catching;
      r.style.pointerEvents = "";
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

  // ── more gags ──
  const lerp = (a, b, t) => a + (b - a) * t;
  const tf = (x, y, sx, sy, rot) => "translate(" + x + "px," + y + "px) rotate(" + rot + "deg) scale(" + sx + "," + sy + ")";

  function bolt(x1, y1, thick = 3) {
    const pts = [];
    let x = x1 + (Math.random() - 0.5) * 220;
    let y = -10;
    const segs = 9;
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      pts.push((lerp(x, x1, t) + (i && i < segs ? (Math.random() - 0.5) * 60 : 0)).toFixed(0) + "," + lerp(y, y1, t).toFixed(0));
    }
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "av-bolt-svg");
    for (const [stroke, width, blur] of [["var(--accent)", thick * 3, true], ["#ffffff", thick, false]]) {
      const line = document.createElementNS(ns, "polyline");
      line.setAttribute("points", pts.join(" "));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", stroke);
      line.setAttribute("stroke-width", String(width));
      line.setAttribute("stroke-linejoin", "round");
      if (blur) line.setAttribute("opacity", ".55");
      svg.appendChild(line);
    }
    document.body.appendChild(svg);
    svg.animate([{ opacity: 1 }, { opacity: 0.15 }, { opacity: 1 }, { opacity: 0 }], { duration: 420, fill: "forwards" }).finished.then(() => svg.remove());
    const flash = node("av-flash", 0, 0, "--fx:" + x1 + "px;--fy:" + y1 + "px;");
    flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 360, fill: "forwards" }).finished.then(() => flash.remove());
  }

  Object.assign(ANTICS, {
    // She tunnels UNDER the interface: dim and hidden behind the panels, popping out for a moment in between.
    async underpass(s) {
      const r = s.el;
      const ltr = Math.random() < 0.5;
      const y = 130 + Math.random() * (innerHeight - 300);
      const a = { x: ltr ? -60 : innerWidth + 14, y };
      const mid = { x: innerWidth * (0.35 + Math.random() * 0.3), y: y + (Math.random() - 0.5) * 100 };
      const b = { x: ltr ? innerWidth + 14 : -60, y: y + (Math.random() - 0.5) * 140 };
      try {
        r.style.zIndex = "1";
        r.style.opacity = "0.55";
        s.place(a, { opacity: 0.55 });
        await s.move(a, mid, { ms: 2600, arc: false });
        r.style.zIndex = "";
        r.style.opacity = "1";
        s.act("wink", 1300);
        s.say(line("Don't mind me, just passing under the UI.", "gag:peek"), 3600);
        await s.sleep(1900);
        r.style.zIndex = "1";
        r.style.opacity = "0.55";
        await s.move(mid, b, { ms: 2600, arc: false });
      } finally {
        r.style.zIndex = "";
      }
    },

    // She falls apart into pieces that bounce around the screen, then reassembles.
    async shatter(s) {
      const r = s.el;
      const home = s.home();
      const spot = s.randomPoint(140);
      s.place(home);
      s.say("I think I'm coming apart...", 2200);
      await s.move(home, spot, { ms: 1300 });
      const cuts = ["inset(0 0 56% 0)", "inset(44% 50% 24% 0)", "inset(44% 0 24% 50%)", "inset(76% 0 0 0)", "inset(30% 0 40% 0)"];
      const pieces = cuts.map((clip) => {
        const p = document.createElement("div");
        p.className = "ai-avatar-roamer av-piece";
        p.style.display = "block";
        p.style.clipPath = clip;
        p.innerHTML = r.innerHTML;
        document.body.appendChild(p);
        return p;
      });
      s.place(spot, { opacity: 0 });
      burst(spot.x + 23, spot.y + 26, 18);
      const spots = pieces.map(() => s.randomPoint(60));
      await Promise.all(pieces.map((p, i) => p.animate([
        { transform: s.at(spot, 1, 0) },
        { transform: s.at({ x: lerp(spot.x, spots[i].x, 0.6), y: spot.y - 90 - Math.random() * 90 }, 1, 200) },
        { transform: s.at(spots[i], 1, 400 + i * 60) }
      ], { duration: 1100, easing: "cubic-bezier(.2,.7,.3,1)", fill: "forwards" }).finished));
      s.say(line("Pieces everywhere.", "gag:explode"), 3600);
      await Promise.all(pieces.map((p, i) => p.animate([
        { transform: s.at(spots[i], 1, 400 + i * 60) },
        { transform: s.at({ x: spots[i].x + (Math.random() - 0.5) * 50, y: spots[i].y - 40 }, 1, 460) },
        { transform: s.at(spots[i], 1, 400 + i * 60) }
      ], { duration: 700 + i * 120, iterations: 3, easing: "ease-in-out", fill: "forwards" }).finished));
      implode(spot.x + 23, spot.y + 26, 16);
      await Promise.all(pieces.map((p, i) => p.animate([
        { transform: s.at(spots[i], 1, 400 + i * 60) }, { transform: s.at(spot, 1, 720) }
      ], { duration: 850, easing: "cubic-bezier(.6,0,.8,.4)", fill: "forwards" }).finished));
      pieces.forEach((p) => p.remove());
      s.place(spot, { opacity: 1 });
      burst(spot.x + 23, spot.y + 26, 8);
      s.say(line("All in one piece. Mostly.", "gag:rebuilt"), 3400);
      s.act("wink", 1300);
      await s.sleep(1500);
      await s.move(spot, s.home(), { ms: 1400 });
    },

    // Pulled into a wormhole with a spiral and spaghettification, spat out later.
    async suck(s) {
      const home = s.home();
      s.place(home);
      const hole = { x: Math.min(innerWidth - 140, home.x + 180 + Math.random() * 200), y: Math.max(110, home.y - 90 - Math.random() * 170) };
      const gate = portal(hole.x + 23, hole.y + 26);
      s.say("Uh-oh. Something is pulling at me...", 2600);
      await s.sleep(900);
      const frames = [];
      const steps = 18;
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const e = Math.pow(t, 1.7);
        const rad = (1 - t) * 70;
        frames.push({ transform: tf(lerp(home.x, hole.x, e) + Math.cos(t * 12) * rad, lerp(home.y, hole.y, e) + Math.sin(t * 12) * rad, 1 - 0.8 * t, 1 + 0.9 * t, t * 900), opacity: 1 - 0.9 * t * t });
      }
      await s.anim(frames, { duration: 2100, easing: "ease-in" });
      await gate.close();
      await s.sleep(2400);
      const exit = s.randomPoint();
      const gate2 = portal(exit.x + 23, exit.y + 26);
      await s.sleep(500);
      s.say(line("Whoa... where am I?", "gag:wormholeBack"), 3400);
      await s.anim([{ transform: tf(exit.x, exit.y, 0.1, 2, 540), opacity: 0 }, { transform: tf(exit.x, exit.y, 1, 1, 0), opacity: 1 }], { duration: 900, easing: "cubic-bezier(.2,1.4,.4,1)" });
      await gate2.close();
      await s.sleep(900);
      await s.move(exit, s.home(), { ms: 1500 });
    },

    // A time-travelling car: accelerates across the screen, leaves two lines of fire, vanishes in a flash.
    async deLorean(s) {
      const home = s.home();
      const dir = Math.random() < 0.5 ? 1 : -1;
      const y = 170 + Math.random() * (innerHeight - 380);
      const startX = dir > 0 ? -150 : innerWidth + 150;
      const endX = dir > 0 ? innerWidth * 0.8 : innerWidth * 0.2;
      s.place(home, { opacity: 0 });
      s.say("Great Scott! Eighty-eight miles an hour...", 2800);
      await s.sleep(1300);
      const carSvg = '<svg viewBox="0 0 120 40" aria-hidden="true"><path d="M3 31 L22 14 L54 9 L98 14 L117 26 L117 32 L3 32Z" fill="#cdd5df" stroke="#fff" stroke-width="1"/><path d="M30 15 L54 11 L80 14 L90 22 L30 22Z" fill="#12202e"/><rect x="2" y="26" width="9" height="4" fill="#7fd8ff"/><circle cx="30" cy="33" r="6" fill="#0a0d12" stroke="#9aa5b3"/><circle cx="92" cy="33" r="6" fill="#0a0d12" stroke="#9aa5b3"/></svg>';
      const car = node("av-car", startX, y, dir < 0 ? "transform-origin:50% 50%;" : "");
      car.innerHTML = carSvg;
      if (dir < 0) car.firstChild.style.transform = "scaleX(-1)";
      const span = Math.abs(endX - startX);
      const left = Math.min(startX, endX) + 55;
      const trails = [y + 22, y + 29].map((ty) => {
        const t = node("av-trail", left, ty, "width:" + span + "px;transform-origin:" + (dir > 0 ? "left" : "right") + " center;");
        t.style.transform = "scaleX(0)";
        return t;
      });
      const ease = "cubic-bezier(.65,0,1,.75)";
      const travel = car.animate([{ transform: "translateX(0)" }, { transform: "translateX(" + (endX - startX) + "px)" }], { duration: 2300, easing: ease, fill: "forwards" });
      trails.forEach((t) => t.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: 2300, easing: ease, fill: "forwards" }));
      await travel.finished;
      burst(endX + 55, y + 18, 26);
      car.remove();
      s.say(line("Roads? Where we're going we don't need roads.", "gag:glitch"), 4200);
      await s.sleep(3600);
      await Promise.all(trails.map((t) => t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 1500, fill: "forwards" }).finished));
      trails.forEach((t) => t.remove());
      await s.anim([{ transform: s.at(home), opacity: 0 }, { transform: s.at(home), opacity: 1 }], { duration: 500 });
    },

    // A thunderstorm rolls in; she is struck and vanishes, then is summoned back by another bolt.
    async storm(s) {
      const home = s.home();
      s.place(home);
      const sky = node("av-storm", 0, 0);
      sky.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: "forwards" });
      s.say("The weather is turning...", 2200);
      await s.sleep(1500);
      for (let i = 0; i < 3; i += 1) {
        bolt(Math.max(60, Math.min(innerWidth - 60, home.x + (Math.random() - 0.5) * 700)), 200 + Math.random() * 400);
        await s.sleep(700 + Math.random() * 500);
      }
      s.say(line("That one was close.", "gag:glitch"), 2000);
      await s.sleep(1300);
      bolt(home.x + 23, home.y + 26, 4);
      s.place(home, { opacity: 0 });
      burst(home.x + 23, home.y + 26, 22);
      const scorch = node("av-scorch", home.x + 23, home.y + 52);
      scorch.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 3600, fill: "forwards" }).finished.then(() => scorch.remove());
      await s.sleep(2600);
      await sky.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: "forwards" }).finished;
      sky.remove();
      bolt(home.x + 23, home.y + 26, 4);
      await s.anim([{ transform: s.at(home, 0.4), opacity: 0 }, { transform: s.at(home, 1), opacity: 1 }], { duration: 450, easing: "ease-out" });
      s.act("sparkle", 1500);
      s.say("Electrifying.", 2600);
      await s.sleep(1600);
    }
  });

  Object.assign(ANTICS, {
    // Alice in Wonderland: drink -> grow enormous (curiouser and curiouser) -> eat -> shrink -> back to normal.
    async alice(s) {
      const home = s.home();
      const spot = { x: Math.max(120, Math.min(innerWidth - 180, innerWidth * (0.3 + Math.random() * 0.4))), y: Math.max(200, innerHeight * 0.55) };
      s.place(home);
      s.say("Down the rabbit hole... I'm late, I'm late!", 2600);
      await s.move(home, spot, { ms: 1500 });
      const bottle = node("av-bottle", spot.x + 62, spot.y + 40);
      bottle.innerHTML = '<svg viewBox="0 0 40 60" aria-hidden="true"><rect x="15" y="2" width="10" height="9" rx="2" fill="#b98a4a"/><path d="M13 11h14v8l7 12v22a5 5 0 0 1-5 5H11a5 5 0 0 1-5-5V31l7-12z" fill="rgba(120,220,255,.35)" stroke="#bfefff" stroke-width="1.4"/><rect x="9" y="30" width="22" height="14" fill="#f4ead2"/><text x="20" y="40" font-size="5.6" text-anchor="middle" fill="#3a2a14" font-family="serif">DRINK ME</text></svg>';
      bottle.animate([{ scale: 0, opacity: 0 }, { scale: 1, opacity: 1 }], { duration: 400, easing: "ease-out", fill: "forwards" });
      await s.sleep(500);
      s.say("It says 'Drink me'. How curious...", 2400);
      await s.sleep(1900);
      s.act("sparkle", 1000);
      bottle.animate([{ transform: "rotate(0deg)", opacity: 1 }, { transform: "rotate(-60deg)", opacity: 1 }, { transform: "rotate(-60deg)", opacity: 0 }], { duration: 900, fill: "forwards" }).finished.then(() => bottle.remove());
      await s.sleep(700);
      const centre = { x: innerWidth / 2 - 23, y: innerHeight * 0.55 };
      s.say("Curiouser and curiouser!", 3000);
      // She grows until she nearly fills the screen; the page shakes a little.
      await s.anim([
        { transform: s.at(spot, 1) },
        { transform: s.at({ x: lerp(spot.x, centre.x, 0.5), y: lerp(spot.y, centre.y, 0.5) }, 4.5) },
        { transform: s.at(centre, 9) }
      ], { duration: 2600, easing: "cubic-bezier(.3,0,.2,1)" });
      document.body.animate([{ transform: "translate(0,0)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(3px,-2px)" }, { transform: "translate(0,0)" }], { duration: 260, iterations: 3 });
      s.say("I'm opening out like the largest telescope that ever was!", 3600);
      await s.sleep(3800);
      s.say("Why, sometimes I've believed as many as six impossible things before breakfast.", 4600);
      await s.sleep(4800);
      s.say("Eat me. Of course.", 2200);
      await s.sleep(1500);
      await s.anim([{ transform: s.at(centre, 9) }, { transform: s.at(centre, 0.35) }], { duration: 1500, easing: "cubic-bezier(.7,0,.3,1)" });
      s.say("Who in the world am I? Ah, that's the great puzzle!", 4200);
      await s.sleep(2400);
      await s.anim([{ transform: s.at(centre, 0.35) }, { transform: s.at(centre, 1) }], { duration: 700, easing: "cubic-bezier(.2,1.5,.4,1)" });
      s.act("wink", 1200);
      await s.sleep(1200);
      await s.move(centre, s.home(), { ms: 1500 });
    }
  });

  // Gags that only appear at the "Psychopathic" personality level.
  const CRAZY = new Set(["swarm", "zoomies", "bounce"]);
  Object.assign(ANTICS, {
    // Seven copies of her run around the screen, then collapse back into one.
    async swarm(s) {
      const home = s.home();
      s.place(home, { opacity: 0 });
      s.say("There are many of me now.", 2400);
      burst(home.x + 23, home.y + 26, 14);
      const clones = Array.from({ length: 7 }, () => {
        const p = document.createElement("div");
        p.className = "ai-avatar-roamer av-piece";
        p.style.display = "block";
        p.style.scale = String(0.6 + Math.random() * 0.6);
        p.innerHTML = s.el.innerHTML;
        document.body.appendChild(p);
        return p;
      });
      const ends = await Promise.all(clones.map(async (p) => {
        let from = home;
        for (let k = 0; k < 5; k += 1) {
          const to = s.randomPoint(30);
          await p.animate([{ transform: s.at(from) }, { transform: s.at({ x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - 50 }) }, { transform: s.at(to) }], { duration: 550 + Math.random() * 450, easing: "ease-in-out", fill: "forwards" }).finished;
          from = to;
        }
        return from;
      }));
      s.say("We're all mad here. All of us.", 2600);
      await Promise.all(clones.map((p, i) => p.animate([{ transform: s.at(ends[i]) }, { transform: s.at(home) }], { duration: 800, easing: "cubic-bezier(.6,0,.8,.4)", fill: "forwards" }).finished));
      clones.forEach((p) => p.remove());
      burst(home.x + 23, home.y + 26, 16);
      s.place(home, { opacity: 1 });
      s.say("Phew. Back to one.", 2000);
      await s.sleep(1500);
    },

    // Dashes between random points at high speed, leaving fading afterimages.
    async zoomies(s) {
      const home = s.home();
      s.place(home);
      s.say("ZOOMIES!", 1600);
      let from = home;
      for (let i = 0; i < 9; i += 1) {
        const to = s.randomPoint(30);
        const ghost = document.createElement("div");
        ghost.className = "ai-avatar-roamer av-piece";
        ghost.style.display = "block";
        ghost.style.transform = s.at(from);
        ghost.innerHTML = s.el.innerHTML;
        document.body.appendChild(ghost);
        ghost.animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: 650, fill: "forwards" }).finished.then(() => ghost.remove());
        await s.move(from, to, { ms: 230, arc: false, easing: "cubic-bezier(.2,.9,.2,1)" });
        from = to;
      }
      await s.move(from, s.home(), { ms: 700, arc: false });
      s.act("dizzy", 1200);
      s.say("...I need to lie down.", 2200);
      await s.sleep(1400);
    },

    // Drops from the top of the screen and bounces with squash and stretch.
    async bounce(s) {
      const x = 120 + Math.random() * (innerWidth - 320);
      const floor = innerHeight - 90;
      s.say("Gravity works!", 1800);
      const frames = [{ transform: tf(x, -90, 1, 1, 0) }];
      let height = floor + 60;
      for (let i = 0; i < 5; i += 1) {
        frames.push({ transform: tf(x + i * 14, floor, 1.35, 0.6, i % 2 ? 8 : -8) });
        height *= 0.55;
        frames.push({ transform: tf(x + i * 14 + 7, floor - height * 0.8, 0.9, 1.2, 0) });
      }
      frames.push({ transform: tf(x + 70, floor, 1.2, 0.75, 0) });
      await s.anim(frames, { duration: 2800, easing: "ease-in-out" });
      s.act("dizzy", 1300);
      await s.sleep(900);
      await s.move({ x: x + 70, y: floor }, s.home(), { ms: 1500 });
    }
  });

  // The UI-wide trip uses an SVG displacement filter (created on first use) applied to the main page areas.
  function ensureTripFilter() {
    if (document.getElementById("avTripSvg")) return;
    document.body.insertAdjacentHTML("beforeend",
      '<svg id="avTripSvg" width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="avTrip" x="-5%" y="-5%" width="110%" height="110%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="3" result="n"><animate attributeName="baseFrequency" dur="6s" values="0.008 0.012;0.016 0.02;0.008 0.012" repeatCount="indefinite"/></feTurbulence>' +
      '<feDisplacementMap in="SourceGraphic" in2="n" scale="26" xChannelSelector="R" yChannelSelector="G"><animate attributeName="scale" dur="3s" values="10;38;10" repeatCount="indefinite"/></feDisplacementMap></filter></svg>');
  }

  Object.assign(ANTICS, {
    async shroom(s) {
      const home = s.home();
      const spot = s.randomPoint(160);
      s.place(home);
      s.say("Is that... a mushroom?", 2200);
      await s.move(home, spot, { ms: 1500 });
      const shroom = node("av-shroom", spot.x + 70, spot.y + 52);
      shroom.innerHTML = '<svg viewBox="0 0 40 44" aria-hidden="true"><path d="M5 22C5 11 12 4 20 4s15 7 15 18z" fill="#e0453a"/><circle cx="14" cy="14" r="3" fill="#fff"/><circle cx="25" cy="11" r="2.4" fill="#fff"/><circle cx="29" cy="18" r="2" fill="#fff"/><path d="M14 22h12v14a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" fill="#f2e3c8"/></svg>';
      shroom.animate([{ scale: 0 }, { scale: 1 }], { duration: 500, easing: "cubic-bezier(.2,1.5,.4,1)", fill: "forwards" });
      await s.sleep(900);
      s.say("Don't mind if I do.", 1800);
      await s.sleep(1300);
      await shroom.animate([{ scale: 1, transform: "translate(0,0)" }, { scale: 0, transform: "translate(-62px,-24px)" }], { duration: 650, easing: "ease-in", fill: "forwards" }).finished;
      shroom.remove();
      s.act("sparkle", 1000);
      await s.sleep(700);
      // Trip: the page blurs/warps/hue-shifts and she wobbles and changes colour.
      ensureTripFilter();
      document.documentElement.classList.add("av-trip");
      s.el.classList.add("av-tripping");
      const lines = [
        "Whoa. The walls are breathing.",
        "Everything is a fractal. Even this button.",
        "I can hear the colours.",
        "The hex tiles are alive. They know.",
        "Packets... so many tiny packets..."
      ];
      const wobble = s.el.animate([
        { transform: s.at(spot, 1, -12) }, { transform: s.at({ x: spot.x + 40, y: spot.y - 30 }, 1.5, 14) },
        { transform: s.at({ x: spot.x - 30, y: spot.y + 10 }, 0.8, -20) }, { transform: s.at({ x: spot.x + 10, y: spot.y - 50 }, 1.8, 10) },
        { transform: s.at(spot, 1, -12) }
      ], { duration: 4200, iterations: 2, easing: "ease-in-out", fill: "forwards" });
      for (const text of lines) { s.say(text, 2300); await s.sleep(1750); }
      await wobble.finished.catch(() => {});
      document.documentElement.classList.remove("av-trip");
      s.el.classList.remove("av-tripping");
      s.act("dizzy", 1300);
      s.say("...okay. That was a lot. I'm fine.", 2800);
      await s.sleep(2000);
      await s.move(spot, s.home(), { ms: 1500 });
    }
  });

  // ── when is it OK to perform? ──
  let lastInput = Date.now();
  let lastAntic = 0;
  let lastName = "";
  const markInput = () => { lastInput = Date.now(); };
  ["pointerdown", "keydown", "wheel"].forEach((type) => window.addEventListener(type, markInput, { passive: true }));

  function okToPerform() {
    const api = A();
    if (!api || api.voice() < 2 || api.isRoaming() || api.isThinking() || api.isAway() || document.hidden) return false;
    if (Date.now() - lastInput < (api.voice() >= 4 ? 1500 : 5000)) return false; // someone is busy
    if (window.AuraSpeech && window.AuraSpeech.isBusy && window.AuraSpeech.isBusy()) return false; // a gag starts when she is quiet: its lines never pile up behind another
    if (document.querySelector(".fx-modal:not(.hidden), #flowStageModal.open")) return false;
    if (document.body.classList.contains("topology-fullscreen-mode") || document.body.classList.contains("results-view-expanded") || document.fullscreenElement) return false;
    // a focused field stops her only while someone is typing in it (the chat keeps the focus after every reply)
    const tag = document.activeElement?.tagName;
    if ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") && Date.now() - lastInput < 8000) return false;
    return true;
  }

  const RARE_EXTRA = [];
  function registerAntic(name, fn, isRare = true) { ANTICS[name] = fn; if (isRare) RARE_EXTRA.push(name); window.AuraAvatar.antics = Object.keys(ANTICS); }

  async function run(name) {
    const api = A();
    if (!api || !ANTICS[name]) return false;
    const performed = await api.stage(ANTICS[name]);
    if (performed) { lastAntic = Date.now(); lastName = name; }
    return performed;
  }

  function chooseName() {
    const wild = A() && A().voice() >= 4;
    const names = Object.keys(ANTICS).filter((n) => n !== lastName && (wild || !CRAZY.has(n)));
    // explode is the showpiece: keep it rare
    const rare = ["explode", "shatter", "storm", "deLorean", "alice", "shroom", ...RARE_EXTRA];
    const pool = names.flatMap((n) => (CRAZY.has(n) ? [n, n, n] : rare.includes(n) ? [n] : [n, n]));
    return pick(pool);
  }

  function schedule(delay) {
    const level = A() ? A().voice() : 2;
    const gap = level >= 4 ? 18000 : level >= 3 ? 100000 : 240000; // minimum time between gags
    const wait = delay ?? (level >= 4 ? 9000 + Math.random() * 9000 : (level >= 3 ? 45000 : 70000) + Math.random() * 50000);
    setTimeout(async () => {
      const since = Date.now() - lastAntic;
      if (okToPerform() && since > gap) {
        await run(chooseName());
        // Psychopathic: sometimes a second (or third) gag right away.
        for (let extra = 0; extra < 2 && A() && A().voice() >= 4 && Math.random() < 0.6 && okToPerform(); extra += 1) { await new Promise((r) => setTimeout(r, 900)); await run(chooseName()); }
        schedule();
        return;
      }
      // Psychopathic: kept back only because she is out for a walk, or the gap is almost over: she tries again soon
      const roaming = Boolean(A() && A().isRoaming()), talking = Boolean(window.AuraSpeech && window.AuraSpeech.isBusy && window.AuraSpeech.isBusy());
      if (roaming || talking) { schedule(2500); return; } // kept back only because she is busy: try again soon, at every level
      if (level >= 4 && since <= gap) { schedule(Math.max(1000, gap - since + 200)); return; }
      schedule();
    }, wait);
  }

  function boot() {
    schedule();
    // Double-click her for an instant gag (any personality level above Silent).
    document.addEventListener("dblclick", (event) => {
      if (!event.target.closest("[data-ai-avatar]") || !A() || A().voice() < 1 || A().isRoaming() || A().isAway()) return;
      run(chooseName());
    });
  }

  // The lines the gags say (the fixed texts of their s.say / s.line calls), so the voice can prepare them ahead and say
  // them on the beat. Lines built while the gag runs are not found here: those are simply generated when said.
  function anticLines() {
    const found = new Set();
    const re = /\bs\.(?:say|line)\(\s*(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
    for (const fn of Object.values(ANTICS)) {
      for (const m of String(fn).matchAll(re)) {
        const text = m[2].replace(/\\(.)/g, "$1");
        if (text.replace(/[^A-Za-z]/g, "").length >= 3) found.add(text);
      }
    }
    return [...found];
  }

  window.AuraAvatar = Object.assign(window.AuraAvatar || {}, { antic: run, registerAntic, antics: Object.keys(ANTICS), anticLines });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
