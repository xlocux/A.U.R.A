"use strict";

// Anime gags for Aura: ninja (smoke bomb, shuriken, shadow clones), samurai (the one-cut slash), demon (Kyuubi mode),
// Kamehameha and the "Nani?!" secret move. They register as ordinary antics, so personality level, cooldowns and
// "never while you type" all apply. window.AuraAvatar.antic("ninja") plays one by hand.
// Her voice sets the time (see README.md): `await s.say(...)`, and the battle cries and big titles come from the stage
// (`s.cry`, `s.title`). The shared effects the other packs use are exported at the end (window.AuraAnimeFx).
(function initAvatarAnime() {
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const done = (anim, el) => anim.finished.then(() => el.remove(), () => el.remove());

  function fx(className, x, y, html = "") {
    const el = document.createElement("div");
    el.className = className;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    if (html) el.innerHTML = html;
    document.body.append(el);
    return el;
  }
  function smoke(x, y, count = 14) {
    for (let i = 0; i < count; i += 1) {
      const p = fx("av-an-smoke", x, y);
      const a = Math.random() * Math.PI * 2, d = rand(18, 62);
      done(p.animate([{ transform: "translate(0,0) scale(.4)", opacity: 0.9 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 14}px) scale(${rand(1.4, 2.4)})`, opacity: 0 }], { duration: rand(600, 1000), easing: "ease-out", fill: "forwards" }), p);
    }
  }
  const shake = (px = 8, ms = 400) => document.body.animate([{ translate: "0 0" }, { translate: `${-px}px ${px / 2}px` }, { translate: `${px}px ${-px / 2}px` }, { translate: `${-px / 2}px ${-px}px` }, { translate: "0 0" }], { duration: ms });
  const centre = (p, s) => ({ x: p.x + s.size.w / 2, y: p.y + s.size.h / 2 });

  const GAGS = {
    // Smoke bomb, shuriken that really stick into the page, then a wall of shadow clones.
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
      // the clones pop up while she shouts, and stay while the cry and its caption (it follows the cry) are up
      const cry = await s.cry("KAGE BUNSHIN", { ms: 1300 });
      const caption = s.say("Kage Bunshin no Jutsu!", { voice: false, min: 1800 });
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
      await caption; // her next line would only queue behind it
      for (const c of clones) { smoke(parseFloat(c.style.left) + 23, parseFloat(c.style.top) + 26, 6); c.remove(); }
      s.el.style.opacity = "1";
      s.act("sparkle", 800);
      await s.say("Which one was the real me? ...All of them. Obviously.", { min: 2200 });
      await s.move(spot, s.home(), { ms: 1300 });
    },

    // Iai: she stands still, a flash, a slash across the whole screen and the page shivers apart for a second.
    async samurai(s) {
      const home = s.home();
      const spot = { x: innerWidth / 2 - 23, y: innerHeight / 2 - 26 };
      s.place(home);
      const silence = s.say("Silence. A samurai is concentrating.");
      await silence.started;
      await s.move(home, spot, { ms: 1400 });
      for (let i = 0; i < 16; i += 1) {
        const petal = fx("av-an-petal", rand(0, innerWidth), -10);
        done(petal.animate([{ transform: "translate(0,0) rotate(0deg)", opacity: 1 }, { transform: `translate(${rand(-160, 160)}px, ${innerHeight + 20}px) rotate(${rand(200, 700)}deg)`, opacity: 0.8 }], { duration: rand(3000, 4600), delay: i * 120, fill: "forwards" }), petal);
      }
      await s.anim([{ transform: s.at(spot, 1, 0) }, { transform: s.at(spot, 1.15, -4) }], { duration: 1400, easing: "ease-in" });
      await silence;
      await s.say("...", { min: 900 });
      const angle = rand(-28, 28);
      const slash = fx("av-an-slash", innerWidth / 2, innerHeight / 2);
      slash.style.setProperty("--a", `${angle}deg`);
      const white = fx("av-an-white", 0, 0);
      white.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], { duration: 260, fill: "forwards" });
      done(white.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 300 }), white);
      await slash.animate([{ transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(0)`, opacity: 1 }, { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(1)`, opacity: 1, offset: 0.3 }, { transform: `translate(-50%, -50%) rotate(${angle}deg) scaleX(1)`, opacity: 0 }], { duration: 700, fill: "forwards" }).finished;
      slash.remove();
      document.body.animate([{ transform: "none" }, { transform: `translate(${Math.sin(angle * Math.PI / 180) * -10}px, 8px) skewY(${angle / 20}deg)`, offset: 0.2 }, { transform: "none" }], { duration: 650, easing: "ease-out" });
      await s.say("You were already cut. You just don't know it yet.", { min: 2200 });
      await s.say("Nothing personal, kid.", { min: 1600 });
      await s.move(spot, s.home(), { ms: 1400 });
    },

    // Kyuubi mode: dark red aura, glowing eyes, horns, a demonic voice.
    async demon(s) {
      const home = s.home();
      const spot = s.randomPoint(220);
      s.place(home);
      const stirring = s.say("Something is stirring inside me...");
      await stirring.started;
      await s.move(home, spot, { ms: 1500 });
      const c = centre(spot, s);
      const veil = fx("av-an-vignette", 0, 0);
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 900, fill: "forwards" });
      try {
        for (let i = 0; i < 4; i += 1) {
          const ring = fx("av-an-ring", c.x, c.y);
          done(ring.animate([{ scale: 0.3, opacity: 0.9 }, { scale: 6 + i, opacity: 0 }], { duration: 1500, delay: i * 320, fill: "forwards" }), ring);
        }
        s.el.classList.add("av-demon");
        s.anim([{ transform: s.at(spot, 1, 0) }, { transform: s.at(spot, 2.6, -3), offset: 0.6 }, { transform: s.at(spot, 2.8, 2) }], { duration: 1700, easing: "ease-out" });
        await stirring; // the cry comes when she has said it
        const cry = await s.cry("KYUUBI MODE", { ms: 1500 });
        setTimeout(() => shake(10, 600), cry * 0.5);
        await wait(cry + 150); // her next line comes after the cry, never on top of it
        await s.say("I AM THE NINE-TAILED DAEMON. Also a systemd service.", { min: 2400 });
        await s.say("Do NOT run that scan with root.", { min: 1900 });
        s.el.classList.remove("av-demon");
        await s.anim([{ transform: s.at(spot, 2.8, 0) }, { transform: s.at(spot, 1, 0) }], { duration: 700, easing: "ease-in" });
        await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished;
      } finally { // the page and her copy are back to normal even if the gag is cut short
        veil.remove();
        s.el.classList.remove("av-demon");
      }
      s.act("dizzy", 1000);
      await s.say("...I need a nap. That costs chakra.", { min: 1800 });
      await s.move(spot, s.home(), { ms: 1300 });
    },

    // Charge, Ka-me-ha-me-HA, a beam across the whole screen.
    async kamehameha(s) {
      const home = s.home();
      const spot = { x: rand(90, innerWidth * 0.35), y: rand(160, innerHeight - 200) };
      s.place(home);
      const standBack = s.say("Stand back. I'm going to need both hands.");
      await standBack.started;
      await s.move(home, spot, { ms: 1400 });
      const c = centre(spot, s);
      const orb = fx("av-an-orb", c.x + 30, c.y);
      try {
        orb.animate([{ scale: 0.2 }, { scale: 3.2 }], { duration: 2400, easing: "ease-in", fill: "forwards" });
        for (let i = 0; i < 24; i += 1) {
          const p = fx("av-particle", c.x + 30 + Math.cos(i) * 90, c.y + Math.sin(i) * 90);
          done(p.animate([{ transform: "translate(0,0)", opacity: 0 }, { transform: `translate(${-Math.cos(i) * 90}px, ${-Math.sin(i) * 90}px)`, opacity: 1 }], { duration: 900, delay: i * 90, easing: "ease-in", fill: "forwards" }), p);
        }
        await standBack; // the chant starts when she has said it
        // the charge is a chant in bubbles; the voice is the cry, and the beam fires on its final "HAAA"
        for (const w of ["Ka...", "me...", "ha...", "me..."]) await s.say(w, { voice: false, min: 600 });
        const cry = await s.cry("KAMEHAMEHA", { ms: 1600 });
        const haaa = s.say("HAAAAAAA!!", { voice: false, min: 1500 }); // the caption follows the cry
        await wait(Math.min(cry * 0.55, 1400));
        const beam = fx("av-an-beam", c.x + 30, c.y);
        beam.style.setProperty("--len", `${innerWidth}px`);
        shake(10, 1100);
        await beam.animate([{ transform: "translateY(-50%) scaleX(0) scaleY(.4)", opacity: 1 }, { transform: "translateY(-50%) scaleX(1) scaleY(1)", opacity: 1, offset: 0.2 }, { transform: "translateY(-50%) scaleX(1) scaleY(1.15)", opacity: 1, offset: 0.8 }, { transform: "translateY(-50%) scaleX(1) scaleY(0)", opacity: 0 }], { duration: 1500, fill: "forwards" }).finished;
        beam.remove();
        orb.remove();
        await haaa; // her next line would only queue behind it
      } finally { // the orb goes even if the gag is cut short
        orb.remove();
      }
      s.act("dizzy", 900);
      await s.say("It's over 9000. Milliseconds. Of latency.", { min: 2000 });
      await s.move(spot, s.home(), { ms: 1300 });
    },

    // The secret move: she points at the cursor, "Omae wa mou shindeiru." "NANI?!"
    async nani(s) {
      const home = s.home();
      const target = window.AuraAvatar.pointer();
      const spot = { x: Math.max(40, Math.min(innerWidth - 90, target.x - 120)), y: Math.max(90, Math.min(innerHeight - 140, target.y - 20)) };
      s.place(home);
      const hey = s.say("Hey. You. Stay right there.");
      await hey.started;
      await s.move(home, spot, { ms: 1500 });
      s.el.classList.toggle("face-left", target.x < spot.x);
      await wait(500);
      await hey;
      await s.say("Omae wa mou shindeiru.", { min: 2000 }); // "NANI?!" only once the line is over
      const cry = await s.cry("NANI?!", { ms: 1300 });
      shake(9, 500);
      await wait(Math.max(900, cry + 150));
      await s.say("(That's the secret move. You were not supposed to see it.)", { min: 2500 });
      await s.move(spot, s.home(), { ms: 1300 });
    }
  };


  // Little victory dances when results show up: "Yatta!", confetti and a cheer, now and then (never spammy).
  const CHEERS = ["YATTA!", "Sugoi!", "Yosh! Got one!", "Kita kita kita!", "Banzai!", "Nailed it, desu!", "Sasuga, me.", "Yattaaa~!"];
  let lastCheer = 0;
  async function cheer() {
    const api = window.AuraAvatar, speech = window.AuraSpeech;
    if (!api || !speech || api.voice() < 2 || api.isAway() || api.isRoaming() || document.hidden) return;
    if (Date.now() - lastCheer < (api.voice() >= 4 ? 25000 : 70000) || Math.random() > (api.voice() >= 3 ? 0.55 : 0.3)) return;
    const home = api.mounts().find((el) => el.getBoundingClientRect().width > 0 && !el.classList.contains("ai-avatar-roamer"));
    if (!home) return;
    lastCheer = Date.now();
    // the confetti fly as she starts cheering: a forced line that waits its turn (its bubble is the line's own)
    await speech.speak(pick(CHEERS), { min: 2600, forced: true }).started;
    const r = home.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    api.act("cheer", 1600);
    for (let i = 0; i < 22; i += 1) {
      const p = fx("av-an-confetti", x, y);
      p.style.background = pick(["var(--accent)", "var(--accent-2)", "var(--warn)", "var(--ink)"]);
      const a = rand(-Math.PI * 0.95, -Math.PI * 0.05), d = rand(50, 130);
      done(p.animate([{ transform: "translate(0,0) rotate(0deg)", opacity: 1 }, { transform: `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d + 70}px) rotate(${rand(200, 600)}deg)`, opacity: 0 }], { duration: rand(900, 1500), easing: "cubic-bezier(.2,.7,.4,1)", fill: "forwards" }), p);
    }
  }

  window.AuraAnimeFx = { fx, smoke, shake, wait, rand, pick, done, centre };

  function boot() {
    // the cheers are prepared ahead, so the confetti fly the moment she starts one (the gags' lines are prepared by the director)
    const speech = window.AuraSpeech;
    if (speech && speech.prefetch) setTimeout(() => speech.prefetch(CHEERS.map((text) => [text, speech.emotionFor(text), ""])), 6000);
    window.addEventListener("aura:ai", (event) => {
      const type = event.detail && event.detail.type;
      if (type === "vuln" || type === "done") setTimeout(cheer, 900);
    });
    const api = window.AuraAvatar;
    if (!api || !api.registerAntic) return;
    for (const [name, fn] of Object.entries(GAGS)) api.registerAntic(name, fn, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
