"use strict";

// More anime for Aura: dojutsu eyes (Sharingan, Mangekyo, Byakugan, Rinnegan) and Luffy-style moves
// (Gomu Gomu no Pistol and Gatling, Gear 5, Conqueror's Haki). Registered as ordinary antics.
(function initAvatarAnimeEyes() {
  const F = () => window.AuraAnimeFx;

  // ── eyes ──
  const tomoe = (n, r, rot) => Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `<circle cx="${(Math.cos(a) * r).toFixed(1)}" cy="${(Math.sin(a) * r).toFixed(1)}" r="5" fill="#111"/>`;
  }).join("");
  const EYES = {
    sharingan: {
      title: "SHARINGAN", color: "#ff2a1a",
      svg: `<circle r="48" fill="#d3121a"/><circle r="30" fill="none" stroke="#111" stroke-width="1.5"/>${tomoe(3, 30, -90)}<circle r="9" fill="#111"/>`,
      lines: ["Sharingan. I copied your last command.", "I saw that. And I already memorised it."]
    },
    mangekyo: {
      title: "MANGEKYO", color: "#ff2a1a",
      svg: `<circle r="48" fill="#d3121a"/><g fill="#111"><path d="M0 -42C10 -22 10 -12 0 -6C-10 -12 -10 -22 0 -42Z"/><path d="M0 -42C10 -22 10 -12 0 -6C-10 -12 -10 -22 0 -42Z" transform="rotate(120)"/><path d="M0 -42C10 -22 10 -12 0 -6C-10 -12 -10 -22 0 -42Z" transform="rotate(240)"/></g><circle r="8" fill="#111"/>`,
      lines: ["Mangekyo. Tsukuyomi: you now live in my logs.", "Amaterasu: black flames. Your scan history, gone."]
    },
    byakugan: {
      title: "BYAKUGAN", color: "#cfd3ff",
      svg: `<circle r="48" fill="#e8e9ff"/><circle r="40" fill="none" stroke="#9aa0e0" stroke-width="1"/><circle r="14" fill="none" stroke="#9aa0e0" stroke-width="1.2"/><path d="M-46 -6L-18 -3M-44 10L-16 6M46 -6L18 -3M44 10L16 6M-6 -46L-3 -18M6 -46L3 -18M-6 46L-3 18M6 46L3 18" stroke="#6f76c9" stroke-width="1.4"/>`,
      lines: ["Byakugan. 360 degrees. I see every open port.", "I can see through your firewall. And your excuses."]
    },
    rinnegan: {
      title: "RINNEGAN", color: "#b58cff",
      svg: `<circle r="48" fill="#b9a1e8"/>${[40, 32, 24, 16, 8].map((r) => `<circle r="${r}" fill="none" stroke="#4b2a8a" stroke-width="2.2"/>`).join("")}<circle r="3" fill="#111"/>`,
      lines: ["Rinnegan. Shinra Tensei: all your tabs, repelled.", "Six paths, one fuzzing session."]
    }
  };

  async function eyes(s) {
    const { fx, smoke, title, shake, wait, pick } = F();
    const key = pick(Object.keys(EYES));
    const e = EYES[key];
    const home = s.home();
    const spot = s.randomPoint(220);
    s.place(home);
    s.say("Hold on. Something is awakening in my eyes.", 2000);
    await s.move(home, spot, { ms: 1400 });
    const c = { x: spot.x + s.size.w / 2, y: spot.y + s.size.h / 2 - 6 };
    s.el.style.setProperty("--eye", e.color);
    s.el.classList.add("av-eyes");
    const big = fx("av-an-eye", c.x, c.y, `<svg viewBox="-50 -50 100 100">${e.svg}</svg>`);
    big.animate([{ transform: "translate(-50%, -50%) scale(.05) rotate(0deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(3.4) rotate(360deg)", opacity: 1, offset: 0.35 }, { transform: "translate(-50%, -50%) scale(3.6) rotate(720deg)", opacity: 1, offset: 0.85 }, { transform: "translate(-50%, -50%) scale(.2) rotate(900deg)", opacity: 0 }], { duration: 3000, easing: "ease-in-out", fill: "forwards" }).finished.then(() => big.remove(), () => big.remove());
    title(e.title, 1600);
    shake(5, 500);
    await wait(1400);
    s.say(pick(e.lines), 3200);
    if (key === "byakugan") {
      // byakugan: everything on screen gets an x-ray outline for a moment
      document.documentElement.classList.add("av-xray");
      await wait(2600);
      document.documentElement.classList.remove("av-xray");
    } else await wait(2600);
    s.el.classList.remove("av-eyes");
    smoke(c.x, c.y, 8);
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // ── Luffy ──
  function stretch(from, to, ms) {
    const { fx } = F();
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const arm = fx("av-an-arm", from.x, from.y);
    arm.style.width = `${len}px`;
    arm.style.setProperty("--ang", `${ang}deg`);
    const fist = fx("av-an-fist", from.x, from.y);
    const t = { duration: ms, easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" };
    arm.animate([{ transform: `rotate(${ang}deg) scaleX(0)` }, { transform: `rotate(${ang}deg) scaleX(1)` }], t);
    return fist.animate([{ transform: "translate(-50%, -50%)" }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.6)` }], t).finished.then(() => ({ arm, fist }));
  }
  const cleanup = (parts, ms = 250) => { for (const p of [parts.arm, parts.fist]) p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" }).finished.then(() => p.remove(), () => p.remove()); };

  async function gomu(s) {
    const { fx, title, shake, wait, smoke } = F();
    const home = s.home();
    const spot = { x: Math.random() < 0.5 ? 100 : innerWidth - 150, y: s.randomPoint(160).y };
    s.place(home);
    s.say("Watch this. I'm going to be King of the Hackers.", 2200);
    await s.move(home, spot, { ms: 1500 });
    const c = { x: spot.x + 23, y: spot.y + 26 };
    const target = { x: innerWidth / 2 + (Math.random() - 0.5) * 300, y: innerHeight / 2 + (Math.random() - 0.5) * 160 };
    s.el.classList.toggle("face-left", target.x < c.x);
    s.anim([{ transform: s.at(spot, 1, 0) }, { transform: s.at({ x: spot.x + (target.x < c.x ? 14 : -14), y: spot.y }, 1.15, target.x < c.x ? 8 : -8) }], { duration: 700, easing: "ease-in" });
    title("GOMU GOMU NO... PISTOL!", 1500);
    await wait(900);
    const hit = await stretch(c, target, 320);
    const crater = fx("av-an-impact", target.x, target.y);
    crater.animate([{ scale: 0.2, opacity: 1 }, { scale: 3.4, opacity: 0 }], { duration: 600, fill: "forwards" }).finished.then(() => crater.remove());
    shake(14, 500);
    cleanup(hit, 500);
    await wait(900);
    s.say("Now the Gatling!", 1200);
    await wait(500);
    title("GOMU GOMU NO... GATLING!", 1900);
    for (let i = 0; i < 14; i += 1) {
      const t = { x: target.x + (Math.random() - 0.5) * 140, y: target.y + (Math.random() - 0.5) * 100 };
      stretch(c, t, 120).then((parts) => {
        const spark = fx("av-an-impact", t.x, t.y);
        spark.animate([{ scale: 0.2, opacity: 1 }, { scale: 1.8, opacity: 0 }], { duration: 300, fill: "forwards" }).finished.then(() => spark.remove());
        cleanup(parts, 160);
      });
      if (i % 3 === 0) shake(5, 120);
      await wait(95);
    }
    await wait(700);
    smoke(c.x, c.y, 8);
    s.say("I'm gonna be the King of the Pirates. Of the Bugs, at least.", 2800);
    await wait(2200);
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // Gear 5: she turns white, goes rubbery and bounces across the screen laughing.
  async function gear5(s) {
    const { title, wait, fx, shake } = F();
    const home = s.home();
    const spot = s.randomPoint(200);
    s.place(home);
    s.say("My heart is beating like drums of liberation...", 2400);
    await s.move(home, spot, { ms: 1400 });
    const white = fx("av-an-white", 0, 0);
    white.animate([{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished.then(() => white.remove());
    s.el.classList.add("av-gear5");
    title("GEAR 5 - NIKA", 1500);
    shake(8, 500);
    await wait(700);
    s.say("HAHAHAHA!", 1500);
    let p = spot;
    for (let i = 0; i < 4; i += 1) {
      const to = s.randomPoint(140);
      await s.anim([
        { transform: s.at(p, 1, 0) },
        { transform: s.at({ x: (p.x + to.x) / 2, y: Math.min(p.y, to.y) - 90 }, 1.3, i % 2 ? 14 : -14), offset: 0.5 },
        { transform: s.at(to, 1, 0) }
      ], { duration: 620, easing: "ease-in-out" });
      p = to;
      s.say(["Yoohoo!", "This is so fun!", "Rubber, rubber, RUBBER!", "I'm the freest hacker in the world!"][i], 900);
    }
    s.el.classList.remove("av-gear5");
    s.act("dizzy", 900);
    s.say("...Okay, I'm hungry now. Meat.", 2400);
    await wait(1800);
    await s.move(p, s.home(), { ms: 1300 });
  }

  // Conqueror's Haki: the screen darkens, black-red lightning crackles and a shockwave rolls out.
  async function haki(s) {
    const { fx, title, shake, wait, done } = F();
    const home = s.home();
    const spot = { x: innerWidth / 2 - 23, y: innerHeight / 2 - 26 };
    s.place(home);
    s.say("Don't move. I'm about to use something rude.", 2000);
    await s.move(home, spot, { ms: 1500 });
    const c = { x: spot.x + 23, y: spot.y + 26 };
    const veil = fx("av-an-vignette av-an-dark", 0, 0);
    veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: "forwards" });
    title("CONQUEROR'S HAKI", 1700);
    for (let i = 0; i < 3; i += 1) {
      const ring = fx("av-an-ring av-an-hakiring", c.x, c.y);
      done(ring.animate([{ scale: 0.3, opacity: 1 }, { scale: 40, opacity: 0 }], { duration: 1400, delay: i * 380, easing: "ease-out", fill: "forwards" }), ring);
    }
    for (let i = 0; i < 9; i += 1) {
      const bolt = fx("av-an-haki-bolt", c.x, c.y);
      bolt.style.setProperty("--a", `${(360 / 9) * i + Math.random() * 30}deg`);
      bolt.style.setProperty("--l", `${Math.random() * 40 + 40}vmax`);
      done(bolt.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0.3, offset: 0.5 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 1500, delay: i * 90, fill: "forwards" }), bolt);
    }
    shake(12, 1400);
    await wait(1100);
    s.say("Anyone who isn't asleep is a threat actor.", 2800);
    await wait(2400);
    await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished;
    veil.remove();
    await s.move(spot, s.home(), { ms: 1300 });
  }

  function boot() {
    const api = window.AuraAvatar;
    if (!api || !api.registerAntic) return;
    api.registerAntic("eyes", eyes, true);
    api.registerAntic("gomu", gomu, true);
    api.registerAntic("gear5", gear5, true);
    api.registerAntic("haki", haki, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
