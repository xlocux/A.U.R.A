"use strict";

// More anime for Aura: dojutsu eyes (Sharingan, Mangekyo, Byakugan, Rinnegan), Luffy-style moves
// (Gomu Gomu no Pistol and Gatling, Gear 5, Conqueror's Haki) and Nico Robin's Mil Fleur (a thousand hands). Registered as ordinary antics.
(function initAvatarAnimeEyes() {
  const F = () => window.AuraAnimeFx;

  // ── eyes ──
  const tomoe = (n, r, rot) => Array.from({ length: n }, (_, i) => {
    const a = ((rot + (360 / n) * i) * Math.PI) / 180;
    return `<circle cx="${(Math.cos(a) * r).toFixed(1)}" cy="${(Math.sin(a) * r).toFixed(1)}" r="5" fill="#111"/>`;
  }).join("");
  const EYES = {
    sharingan: {
      color: "#ff2a1a",
      svg: `<circle r="48" fill="#d3121a"/><circle r="30" fill="none" stroke="#111" stroke-width="1.5"/>${tomoe(3, 30, -90)}<circle r="9" fill="#111"/>`
    },
    mangekyo: {
      color: "#ff2a1a",
      svg: `<circle r="48" fill="#d3121a"/><g fill="#111"><path d="M0 -42C10 -22 10 -12 0 -6C-10 -12 -10 -22 0 -42Z"/><path d="M0 -42C10 -22 10 -12 0 -6C-10 -12 -10 -22 0 -42Z" transform="rotate(120)"/><path d="M0 -42C10 -22 10 -12 0 -6C-10 -12 -10 -22 0 -42Z" transform="rotate(240)"/></g><circle r="8" fill="#111"/>`
    },
    byakugan: {
      color: "#cfd3ff",
      svg: `<circle r="48" fill="#e8e9ff"/><circle r="40" fill="none" stroke="#9aa0e0" stroke-width="1"/><circle r="14" fill="none" stroke="#9aa0e0" stroke-width="1.2"/><path d="M-46 -6L-18 -3M-44 10L-16 6M46 -6L18 -3M44 10L16 6M-6 -46L-3 -18M6 -46L3 -18M-6 46L-3 18M6 46L3 18" stroke="#6f76c9" stroke-width="1.4"/>`
    },
    rinnegan: {
      color: "#b58cff",
      svg: `<circle r="48" fill="#b9a1e8"/>${[40, 32, 24, 16, 8].map((r) => `<circle r="${r}" fill="none" stroke="#4b2a8a" stroke-width="2.2"/>`).join("")}<circle r="3" fill="#111"/>`
    }
  };

  async function eyes(s) {
    const { fx, smoke, shake, wait, pick } = F();
    const key = pick(Object.keys(EYES));
    const e = EYES[key];
    // her cry and her line for each eye are written out here, as literals: the director reads them from this source to prepare them ahead
    const says = {
      sharingan: { cry: () => s.cry("SHARINGAN", { ms: 1600 }), quip: s.pick(["Sharingan. I copied your last command.", "I saw that. And I already memorised it."]) },
      mangekyo: { cry: () => s.cry("MANGEKYO", { ms: 1600 }), quip: s.pick(["Mangekyo. Tsukuyomi: you now live in my logs.", "Amaterasu: black flames. Your scan history, gone."]) },
      byakugan: { cry: () => s.cry("BYAKUGAN", { ms: 1600 }), quip: s.pick(["Byakugan. 360 degrees. I see every open port.", "I can see through your firewall. And your excuses."]) },
      rinnegan: { cry: () => s.cry("RINNEGAN", { ms: 1600 }), quip: s.pick(["Rinnegan. Shinra Tensei: all your tabs, repelled.", "Six paths, one fuzzing session."]) }
    }[key];
    const home = s.home();
    const spot = s.randomPoint(220);
    s.place(home);
    const hold = s.say("Hold on. Something is awakening in my eyes.");
    await hold.started;
    await s.move(home, spot, { ms: 1400 });
    await hold; // the eye awakens on her cry, not on top of her line
    const c = { x: spot.x + s.size.w / 2, y: spot.y + s.size.h / 2 - 6 };
    s.el.style.setProperty("--eye", e.color);
    s.el.classList.add("av-eyes");
    try {
      const big = fx("av-an-eye", c.x, c.y, `<svg viewBox="-50 -50 100 100">${e.svg}</svg>`);
      big.animate([{ transform: "translate(-50%, -50%) scale(.05) rotate(0deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(3.4) rotate(360deg)", opacity: 1, offset: 0.35 }, { transform: "translate(-50%, -50%) scale(3.6) rotate(720deg)", opacity: 1, offset: 0.85 }, { transform: "translate(-50%, -50%) scale(.2) rotate(900deg)", opacity: 0 }], { duration: 3000, easing: "ease-in-out", fill: "forwards" }).finished.then(() => big.remove(), () => big.remove());
      const cry = await says.cry();
      shake(5, 500);
      await wait(Math.max(1400, cry + 150)); // her line comes after the cry
      const talk = s.say(says.quip, { min: 2600 });
      await talk.started;
      // byakugan: everything on screen gets an x-ray outline while she talks
      if (key === "byakugan") document.documentElement.classList.add("av-xray");
      await talk;
    } finally { // her eyes and the page are back to normal even if the gag is cut short
      s.el.classList.remove("av-eyes");
      document.documentElement.classList.remove("av-xray");
    }
    smoke(c.x, c.y, 8);
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // ── Luffy ──
  // size = how big the fist gets at the end (the arm gets thicker with it)
  function stretch(from, to, ms, size = 1.6) {
    const { fx } = F();
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const arm = fx("av-an-arm", from.x, from.y);
    arm.style.width = `${len}px`;
    arm.style.setProperty("--ang", `${ang}deg`);
    if (size > 2) { arm.style.height = `${Math.round(size * 5)}px`; arm.style.marginTop = `${-Math.round(size * 2.5)}px`; }
    const fist = fx("av-an-fist", from.x, from.y);
    const t = { duration: ms, easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" };
    arm.animate([{ transform: `rotate(${ang}deg) scaleX(0)` }, { transform: `rotate(${ang}deg) scaleX(1)` }], t);
    return fist.animate([{ transform: "translate(-50%, -50%)" }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${size})` }], t).finished.then(() => ({ arm, fist }));
  }
  // Luffy's first strike (the Gatling always follows); its cry and line are in gomu().
  // blast = size of the impact ring, jolt = how hard the page shakes.
  const STRIKES = {
    pistol: { hands: 1, size: 1.6, blast: 3.4, jolt: 14 },
    bazooka: { hands: 2, size: 2, blast: 4.8, jolt: 20 },
    elephant: { hands: 1, size: 3.6, blast: 6.5, jolt: 28 }
  };
  const cleanup = (parts, ms = 250) => { for (const p of [parts.arm, parts.fist]) p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" }).finished.then(() => p.remove(), () => p.remove()); };

  async function gomu(s) {
    const { fx, shake, wait, smoke } = F();
    const home = s.home();
    const spot = { x: Math.random() < 0.5 ? 100 : innerWidth - 150, y: s.randomPoint(160).y };
    const name = F().pick(Object.keys(STRIKES));
    const strike = STRIKES[name];
    // the line and the cry of each strike are written out here, as literals: the director reads them from this source to prepare them ahead
    const says = {
      pistol: { quip: () => s.say("Watch this. I'm going to be King of the Hackers."), cry: () => s.cry("GOMU GOMU NO... PISTOL!", { ms: 1700 }) },
      bazooka: { quip: () => s.say("Both hands. No more Mr. Nice Hacker."), cry: () => s.cry("GOMU GOMU NO... BAZOOKA!", { ms: 1700 }) },
      elephant: { quip: () => s.say("This one is the size of an elephant. Brace."), cry: () => s.cry("GOMU GOMU NO... ELEPHANT GUN!", { ms: 1700 }) }
    }[name];
    s.place(home);
    const quip = says.quip();
    await quip.started;
    await s.move(home, spot, { ms: 1500 });
    await quip; // the strike follows her cry, not her line
    const c = { x: spot.x + 23, y: spot.y + 26 };
    const target = { x: innerWidth / 2 + (Math.random() - 0.5) * 300, y: innerHeight / 2 + (Math.random() - 0.5) * 160 };
    s.el.classList.toggle("face-left", target.x < c.x);
    s.anim([{ transform: s.at(spot, 1, 0) }, { transform: s.at({ x: spot.x + (target.x < c.x ? 14 : -14), y: spot.y }, 1.15, target.x < c.x ? 8 : -8) }], { duration: 700, easing: "ease-in" });
    // The strike follows the cry: "goooomu goooomu no..." winds up, the fist lands on the move's name.
    const cry = await says.cry();
    const windUp = cry * 0.62 - 320;
    await wait(Math.max(200, windUp));
    // one fist, or both hands side by side for the Bazooka
    const offsets = strike.hands === 2 ? [-10, 10] : [0];
    const hits = await Promise.all(offsets.map((o) => stretch({ x: c.x, y: c.y + o }, { x: target.x, y: target.y + o * 1.6 }, 320, strike.size)));
    const crater = fx("av-an-impact", target.x, target.y);
    crater.animate([{ scale: 0.2, opacity: 1 }, { scale: strike.blast, opacity: 0 }], { duration: 650, fill: "forwards" }).finished.then(() => crater.remove());
    shake(strike.jolt, 550);
    for (const hit of hits) cleanup(hit, 500);
    // the next line waits for the end of the cry
    await wait(Math.max(900, cry - Math.max(200, windUp) - 320 + 250));
    await s.say("Now the Gatling!", { min: 500 });
    const gatling = await s.cry("GOMU GOMU NO... GATLING!", { ms: 1900 });
    // the barrage starts on "gatoriiinguuuu" and lasts as long as the cry
    await wait(gatling * 0.45);
    const shots = Math.max(14, Math.ceil((gatling * 0.55) / 95));
    for (let i = 0; i < shots; i += 1) {
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
    await s.say("I'm gonna be the King of the Pirates. Of the Bugs, at least.", { min: 2200 });
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // Gear 5: she turns white, goes rubbery and bounces across the screen laughing.
  async function gear5(s) {
    const { wait, fx, shake } = F();
    const home = s.home();
    const spot = s.randomPoint(200);
    s.place(home);
    const drums = s.say("My heart is beating like drums of liberation...");
    await drums.started;
    await s.move(home, spot, { ms: 1400 });
    // the four shouts of the bounce are written out here, as literals: the director reads them from this source to prepare them ahead
    const shouts = [() => s.say("Yoohoo!"), () => s.say("This is so fun!"), () => s.say("Rubber, rubber, RUBBER!"), () => s.say("I'm the freest hacker in the world!")];
    await drums; // she turns white on her cry, not on top of her line
    const white = fx("av-an-white", 0, 0);
    white.animate([{ opacity: 0 }, { opacity: 0.85 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished.then(() => white.remove());
    s.el.classList.add("av-gear5");
    let p = spot;
    try {
      const cry = await s.cry("GEAR 5 - NIKA", { ms: 1500 });
      shake(8, 500);
      await wait(Math.max(700, cry + 150)); // the laugh comes after the cry
      const laugh = s.say("HAHAHAHA!"); // she laughs while she bounces
      await laugh.started;
      let said = laugh;
      for (let i = 0; i < 4; i += 1) {
        const to = s.randomPoint(140);
        // a bounce lands when she has said her last shout; then the next shout starts and the next bounce goes with it
        await Promise.all([s.anim([
          { transform: s.at(p, 1, 0) },
          { transform: s.at({ x: (p.x + to.x) / 2, y: Math.min(p.y, to.y) - 90 }, 1.3, i % 2 ? 14 : -14), offset: 0.5 },
          { transform: s.at(to, 1, 0) }
        ], { duration: 620, easing: "ease-in-out" }), said]);
        p = to;
        said = shouts[i]();
        await said.started;
      }
      await said;
    } finally { // her copy is back to normal even if the gag is cut short
      s.el.classList.remove("av-gear5");
    }
    s.act("dizzy", 900);
    await s.say("...Okay, I'm hungry now. Meat.", { min: 1800 });
    await s.move(p, s.home(), { ms: 1300 });
  }

  // Conqueror's Haki: the screen darkens, black-red lightning crackles and a shockwave rolls out.
  async function haki(s) {
    const { fx, shake, wait, done } = F();
    const home = s.home();
    const spot = { x: innerWidth / 2 - 23, y: innerHeight / 2 - 26 };
    s.place(home);
    const warn = s.say("Don't move. I'm about to use something rude.");
    await warn.started;
    await s.move(home, spot, { ms: 1500 });
    const c = { x: spot.x + 23, y: spot.y + 26 };
    const veil = fx("av-an-vignette av-an-dark", 0, 0);
    veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: "forwards" });
    try {
      await warn; // the shockwave rolls out as she shouts, after her line
      const cry = await s.cry("CONQUEROR'S HAKI", { ms: 1700 });
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
      await wait(Math.max(1100, cry + 150));
      await s.say("Anyone who isn't asleep is a threat actor.", { min: 2400 });
      await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished;
    } finally { // the dark veil goes even if the gag is cut short
      veil.remove();
    }
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // ── Nico Robin: Hana Hana no Mi, Mil Fleur ──
  const HAND = '<svg viewBox="0 0 40 48"><path d="M10 46C4 38 4 30 6 24V12a3 3 0 0 1 6 0V22L13 6a3 3 0 0 1 6 0V22L21 4a3 3 0 0 1 6 0V22L29 10a3 3 0 0 1 6 0V32C35 40 30 46 24 46Z" fill="currentColor" stroke="#4b2a8a" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  async function robin(s) {
    const { fx, shake, wait, rand } = F();
    const home = s.home();
    const spot = s.randomPoint(220);
    s.place(home);
    const lend = s.say("Let me lend you a few hands.");
    await lend.started;
    await s.move(home, spot, { ms: 1400 });
    await lend; // the move starts on her cry, not on top of her line
    const c = { x: spot.x + s.size.w / 2, y: spot.y + s.size.h / 2 };
    // arms crossed over her chest: the sign of the move
    const cross = fx("av-an-cross", c.x, c.y, '<svg viewBox="-30 -30 60 60"><path d="M-22 -22L22 22M22 -22L-22 22" stroke="currentColor" stroke-width="9" stroke-linecap="round"/></svg>');
    cross.animate([{ transform: "scale(.2) rotate(-40deg)", opacity: 0 }, { transform: "scale(1) rotate(0deg)", opacity: 1, offset: 0.25 }, { transform: "scale(1) rotate(0deg)", opacity: 1, offset: 0.9 }, { transform: "scale(1.3)", opacity: 0 }], { duration: 2600, fill: "forwards" }).finished.then(() => cross.remove(), () => cross.remove());
    const cry = await s.cry("HANA HANA NO... MIL FLEUR!", { ms: 1800 });
    await wait(cry * 0.45); // the hands bloom on "miru furuuuuru"
    // a thousand hands: they sprout from her in waves, farther and farther, then fade
    const reach = Math.hypot(innerWidth, innerHeight) * 0.6, bloom = Math.max(900, cry * 0.55);
    shake(10, 600);
    const hands = [];
    for (let i = 0; i < 110; i += 1) {
      const dist = Math.pow(Math.random(), 0.7) * reach, ang = rand(0, Math.PI * 2);
      const x = Math.max(10, Math.min(innerWidth - 10, c.x + Math.cos(ang) * dist)), y = Math.max(10, Math.min(innerHeight - 10, c.y + Math.sin(ang) * dist));
      const h = fx("av-an-hand", x, y, HAND);
      const rot = rand(-70, 70), size = rand(0.7, 1.5), wave = (dist / reach) * bloom;
      h.style.opacity = "0";
      hands.push(h.animate([{ transform: "scale(0) rotate(" + (rot - 40) + "deg)", opacity: 0 }, { transform: "scale(" + size * 1.15 + ") rotate(" + rot + "deg)", opacity: 1, offset: 0.3 }, { transform: "scale(" + size + ") rotate(" + (rot + rand(-8, 8)) + "deg)", opacity: 1, offset: 0.8 }, { transform: "scale(" + size * 0.8 + ")", opacity: 0 }], { duration: 2000, delay: wave, easing: "ease-out", fill: "forwards" }).finished.then(() => h.remove(), () => h.remove()));
    }
    await wait(Math.max(900, bloom * 0.8, cry * 0.55 + 100)); // the rest of the cry (the hands are going on meanwhile), then her line
    const quip = s.say(s.pick(["Mil Fleur. A thousand hands, and none of them touched your cache.", "Many hands make light work. Of your firewall.", "Hands everywhere. Don't worry, they only wave."]));
    await Promise.all([...hands, quip]); // she goes home when the hands are gone and she has said it
    await s.move(spot, s.home(), { ms: 1300 });
  }

  function boot() {
    const api = window.AuraAvatar;
    if (!api || !api.registerAntic) return;
    api.registerAntic("eyes", eyes, true);
    api.registerAntic("gomu", gomu, true);
    api.registerAntic("gear5", gear5, true);
    api.registerAntic("haki", haki, true);
    api.registerAntic("robin", robin, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
