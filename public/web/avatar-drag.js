"use strict";

// Grab Auri and try to drag her: she fights back. Each grab picks a behaviour:
//  - rubber:  an elastic band pulls her back; drag too far and she wins ("GOTCHA!") with a jolt of the page
//  - greased: she is slippery and slides away from your drag
//  - heavy:   she weighs a ton and barely moves; hold still and she complains
//  - bite:    (rare, more often when Psychopathic) she bites the cursor
// Two places: her home avatar (a short stage with the roaming copy), or the roaming copy while she is out on the
// screen: then her current gag freezes while you hold her and carries on when you let go.
(function initAvatarDrag() {
  const A = () => window.AuraAvatar;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX = 150; // how far the elastic lets her go
  const FAR = 190; // no behaviour ever takes her further than this

  const LINES = {
    rubber: ["Hey! Hands off the merchandise!", "I'm on an elastic leash, genius.", "Let go! LET GO!", "Pull harder. I dare you."],
    greased: ["Oh no. I'm slippery today!", "Whoops, can't hold me!", "Butter fingers!"],
    heavy: ["Ugh, you're heavy-handed.", "I weigh 4 gigabytes. Good luck.", "I'm not moving. Make me."],
    held: ["Are we doing something? Or just holding?", "This is awkward.", "You can let go any time now."],
    win: ["GOTCHA! Nobody drags me.", "Too slow!", "And STAY back!"],
    free: ["Thank you. Never again.", "...my dignity. Where is it?", "Rude."],
    busy: ["I'm WORKING here! Put me down!", "Excuse me, I was in the middle of something!", "Not now, I'm performing!"]
  };
  const RUDE = ["Take your sweaty hands off me, {n}!", "Drag yourself, {n}.", "You absolute {n}. Let GO."];
  const nick = () => (window.AuraQuotes ? window.AuraQuotes.nick() : "you");
  const wild = () => A().voice() >= 4;
  const chooseMode = () => (Math.random() < (wild() ? 0.3 : 0.1) ? "bite" : pick(["rubber", "rubber", "greased", "heavy"]));
  const line = (key) => (wild() && Math.random() < 0.6 ? pick(RUDE).replace("{n}", nick()) : pick(LINES[key]));

  // How far she follows a drag of (dx, dy): the elastic pulls back harder the further you go.
  function resist(mode, dx, dy) {
    const len = Math.hypot(dx, dy) || 1;
    const k = mode === "heavy" ? 0.1 : mode === "greased" ? -0.55 : (MAX * Math.tanh(len / (MAX * 1.4))) / len;
    let off = { x: dx * k, y: dy * k };
    const far = Math.hypot(off.x, off.y);
    if (far > FAR) off = { x: (off.x * FAR) / far, y: (off.y * FAR) / far };
    return off;
  }
  // keeps a box of size (w, h) at top-left p inside the viewport
  const inView = (p, w, h) => ({ x: Math.max(6, Math.min(innerWidth - w - 6, p.x)), y: Math.max(6, Math.min(innerHeight - h - 6, p.y)) });
  function makeBand() {
    const band = document.createElement("div");
    band.className = "av-drag-band";
    document.body.append(band);
    return band;
  }
  function drawBand(band, from, to, mode) {
    band.style.left = `${from.x}px`;
    band.style.top = `${from.y}px`;
    band.style.width = `${Math.hypot(to.x - from.x, to.y - from.y)}px`;
    band.style.transform = `rotate(${Math.atan2(to.y - from.y, to.x - from.x)}rad)`;
    band.style.opacity = mode === "rubber" || mode === "bite" ? "1" : "0";
  }
  const dropBand = (band) => band.animate([{ opacity: getComputedStyle(band).opacity }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished.then(() => band.remove(), () => band.remove());
  const jolt = () => document.body.animate([{ translate: "0 0" }, { translate: "10px -6px" }, { translate: "-8px 5px" }, { translate: "0 0" }], { duration: 320 });
  function chomp(event, say) {
    const bite = document.createElement("div");
    bite.className = "av-drag-bite";
    bite.textContent = "CHOMP!";
    bite.style.left = `${event.clientX}px`;
    bite.style.top = `${event.clientY}px`;
    document.body.append(bite);
    bite.animate([{ transform: "translate(-50%, -50%) scale(.4)", opacity: 1 }, { transform: "translate(-50%, -120%) scale(1.3)", opacity: 0 }], { duration: 900, fill: "forwards" }).finished.then(() => bite.remove(), () => bite.remove());
    document.body.animate([{ translate: "0 0" }, { translate: "6px 3px" }, { translate: "0 0" }], { duration: 180 });
    say(wild() ? "Ha! You taste like desperation, " + nick() + "." : "Nom! Now you know.");
    A().act("sparkle", 800);
  }

  let active = null;
  let justDragged = 0;

  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !A() || A().isAway() || !event.target.closest) return;
    const roamer = event.target.closest(".ai-avatar-roamer");
    if (roamer) {
      // the catch-me game and the tantrum pieces have their own clicks
      if (!A().isRoaming() || roamer.dataset.catching || roamer.classList.contains("av-piece") || window.AuraDirector?.isPerforming?.()) return;
      event.preventDefault(); // no text selection while she is pulled across the page (the click/poke still fires)
      active = { el: roamer, roaming: true, x: event.clientX, y: event.clientY, started: false };
      return;
    }
    const home = event.target.closest("[data-ai-avatar]") || event.target.closest(".ai-restore")?.querySelector("[data-ai-avatar]");
    if (!home || A().isRoaming()) return;
    event.stopPropagation(); // her face on the chat header must not drag the chat window
    active = { home, x: event.clientX, y: event.clientY, started: false };
  }, true);

  // A drag is not a click: no poke, no chat toggle.
  document.addEventListener("click", (event) => {
    if (Date.now() - justDragged < 350) { event.stopPropagation(); event.preventDefault(); }
  }, true);

  window.addEventListener("pointermove", (event) => {
    if (!active || active.started || event.buttons !== 1) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 7) return;
    active.started = true;
    document.documentElement.classList.add("av-dragging");
    if (active.roaming) dragRoaming(active, event); else dragHome(active, event);
  });
  // a lost pointerup (cancelled touch, window switched away) must not keep her on stage forever
  function endGrab() {
    if (!active) return;
    if (active.started) justDragged = Date.now();
    document.documentElement.classList.remove("av-dragging");
    if (active.release) active.release();
    active = null;
  }
  window.addEventListener("pointerup", endGrab);
  window.addEventListener("pointercancel", endGrab);
  window.addEventListener("blur", endGrab);

  // ── home avatar: a short stage with the roaming copy ──
  function dragHome(grab, firstEvent) {
    if (!window.AuraDirector) return;
    const mode = chooseMode();
    window.AuraDirector.perform("carry", async (s) => {
      const base = s.home();
      s.place(base);
      const band = makeBand();
      const released = new Promise((resolve) => { grab.release = resolve; });
      let pos = { ...base }, won = false, lastMove = Date.now(), spoke = 0, bitten = false;
      const origin = { x: base.x + s.size.w / 2, y: base.y + s.size.h / 2 };
      const say = (key) => { if (Date.now() - spoke < 1400) return; spoke = Date.now(); s.say(line(key)); };
      say(mode === "bite" ? "rubber" : mode);

      const update = (event) => {
        if (won) return;
        lastMove = Date.now();
        const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
        const off = resist(mode, dx, dy);
        pos = inView({ x: base.x + off.x, y: base.y + off.y }, s.size.w, s.size.h);
        const stretch = Math.hypot(pos.x - base.x, pos.y - base.y);
        s.el.style.transform = s.at(pos, 1 + Math.min(0.25, stretch / 500), Math.max(-25, Math.min(25, dx / 8)));
        s.el.classList.toggle("face-left", dx < 0);
        drawBand(band, origin, { x: pos.x + s.size.w / 2, y: pos.y + s.size.h / 2 }, mode);
        const len = Math.hypot(dx, dy);
        if (mode === "rubber" && len > MAX * 2.4) {
          won = true;
          say("win");
          jolt();
          s.anim([{ transform: s.at(pos, 1.3, 0) }, { transform: s.at(base, 1, 0) }], { duration: 260, easing: "cubic-bezier(.2,1.8,.4,1)" });
          band.style.opacity = "0";
        }
        if (mode === "bite" && !bitten && len > 60) { bitten = true; chomp(event, (t) => { spoke = Date.now(); s.say(t); }); }
      };
      window.addEventListener("pointermove", update);
      update(firstEvent);
      // Holding still makes her complain (heavy complains more).
      const nag = setInterval(() => { if (Date.now() - lastMove > 1800 && !won) say("held"); }, 600);
      await released;
      clearInterval(nag);
      window.removeEventListener("pointermove", update);
      dropBand(band);
      const stretched = Math.hypot(pos.x - base.x, pos.y - base.y);
      // Snap home with a rubbery wobble.
      await s.anim([
        { transform: s.at(pos, 1.1, 0) },
        { transform: s.at({ x: base.x - (pos.x - base.x) * 0.35, y: base.y - (pos.y - base.y) * 0.35 }, 0.9, 0), offset: 0.45 },
        { transform: s.at({ x: base.x + (pos.x - base.x) * 0.12, y: base.y + (pos.y - base.y) * 0.12 }, 1.04, 0), offset: 0.75 },
        { transform: s.at(base, 1, 0) }
      ], { duration: 520, easing: "ease-out" });
      if (stretched > 70 || mode === "greased") { s.act("dizzy", 900); say("free"); }
      await wait(1200);
    }, { interactive: true, immediate: true });
  }

  // ── roaming copy: she is in the middle of a gag. Her animations are paused while held (and any step the gag
  // starts meanwhile), the pull is an extra `translate` on top of the gag's transform, and on release everything resumes.
  function dragRoaming(grab, firstEvent) {
    const el = grab.el;
    const mode = chooseMode();
    const r = el.getBoundingClientRect();
    const origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const frozen = new Set();
    const freeze = () => el.getAnimations({ subtree: true }).forEach((a) => { if (a.playState === "running") { a.pause(); frozen.add(a); } });
    const resume = () => { frozen.forEach((a) => { try { a.play(); } catch { /* cancelled by the gag */ } }); frozen.clear(); };
    freeze();
    const hold = setInterval(freeze, 80);
    const band = makeBand();
    let off = { x: 0, y: 0 }, won = false, bitten = false, lastMove = Date.now(), spoke = 0, done = false;
    const say = (key) => { if (Date.now() - spoke < 1400) return; spoke = Date.now(); A().say(line(key), 2200, true); };
    say(Math.random() < 0.5 ? "busy" : mode === "bite" ? "rubber" : mode);

    const wobbleBack = (from) => {
      el.style.translate = "";
      el.style.rotate = "";
      return el.animate([
        { translate: `${from.x}px ${from.y}px` },
        { translate: `${-from.x * 0.35}px ${-from.y * 0.35}px`, offset: 0.45 },
        { translate: `${from.x * 0.12}px ${from.y * 0.12}px`, offset: 0.75 },
        { translate: "0px 0px" }
      ], { duration: 520, easing: "ease-out" }).finished.catch(() => {});
    };
    const update = (event) => {
      if (won || done) return;
      if (!A().isRoaming()) { finish(); return; } // her gag ended while held
      lastMove = Date.now();
      const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
      const want = resist(mode, dx, dy);
      const centre = inView({ x: origin.x + want.x - r.width / 2, y: origin.y + want.y - r.height / 2 }, r.width, r.height);
      off = { x: centre.x + r.width / 2 - origin.x, y: centre.y + r.height / 2 - origin.y };
      el.style.translate = `${off.x}px ${off.y}px`;
      el.style.rotate = `${Math.max(-25, Math.min(25, dx / 8))}deg`;
      drawBand(band, origin, { x: origin.x + off.x, y: origin.y + off.y }, mode);
      const len = Math.hypot(dx, dy);
      if (mode === "rubber" && len > MAX * 2.4) {
        // she breaks free and gets back to work at once
        won = true;
        say("win");
        jolt();
        band.style.opacity = "0";
        clearInterval(hold);
        wobbleBack(off).then(resume);
      }
      if (mode === "bite" && !bitten && len > 60) { bitten = true; chomp(event, (t) => { spoke = Date.now(); A().say(t, 2200, true); }); }
    };
    const nag = setInterval(() => { if (Date.now() - lastMove > 1800 && !won) say("held"); }, 600);
    async function finish() {
      if (done) return;
      done = true;
      clearInterval(hold);
      clearInterval(nag);
      window.removeEventListener("pointermove", update);
      dropBand(band);
      if (won) return;
      const stretched = Math.hypot(off.x, off.y);
      await wobbleBack(off);
      resume();
      if (stretched > 70 || mode === "greased") { A().act("dizzy", 900); spoke = 0; say("free"); }
    }
    grab.release = finish;
    window.addEventListener("pointermove", update);
    update(firstEvent);
  }
})();
