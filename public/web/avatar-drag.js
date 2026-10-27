"use strict";

// Grab Auri and try to drag her: she fights back. Each grab picks a behaviour:
//  - rubber:  an elastic band pulls her home; drag too far and she wins ("GOTCHA!") with a jolt of the page
//  - greased: she is slippery and slides away from your drag
//  - heavy:   she weighs a ton and barely moves; hold still and she complains
//  - bite:    (rare, more often when Psychopathic) she bites the cursor
// On release she snaps back with a wobble. Nothing is ever really moved: it is all the roaming copy.
(function initAvatarDrag() {
  const A = () => window.AuraAvatar;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX = 150; // how far the elastic lets her go

  const LINES = {
    rubber: ["Hey! Hands off the merchandise!", "I'm on an elastic leash, genius.", "Let go! LET GO!", "Pull harder. I dare you."],
    greased: ["Oh no. I'm slippery today!", "Whoops, can't hold me!", "Butter fingers!"],
    heavy: ["Ugh, you're heavy-handed.", "I weigh 4 gigabytes. Good luck.", "I'm not moving. Make me."],
    held: ["Are we doing something? Or just holding?", "This is awkward.", "You can let go any time now."],
    win: ["GOTCHA! Nobody drags me.", "Too slow!", "And STAY back!"],
    free: ["Thank you. Never again.", "...my dignity. Where is it?", "Rude."]
  };
  const RUDE = ["Take your sweaty hands off me, {n}!", "Drag yourself, {n}.", "You absolute {n}. Let GO."];
  const nick = () => (window.AuraQuotes ? window.AuraQuotes.nick() : "you");
  const wild = () => A().voice() >= 4;

  let active = null;
  let justDragged = 0;

  document.addEventListener("pointerdown", (event) => {
    const home = event.target.closest && (event.target.closest("[data-ai-avatar]") || event.target.closest(".ai-restore")?.querySelector("[data-ai-avatar]"));
    if (!home || home.classList.contains("ai-avatar-roamer") || event.button !== 0 || !A() || A().isRoaming() || A().isAway()) return;
    event.stopPropagation(); // her face on the chat header must not drag the chat window
    active = { home, x: event.clientX, y: event.clientY, started: false };
  }, true);

  document.addEventListener("click", (event) => {
    if (Date.now() - justDragged < 350) { event.stopPropagation(); event.preventDefault(); }
  }, true);

  window.addEventListener("pointermove", (event) => {
    if (!active || active.started || event.buttons !== 1) return;
    if (Math.hypot(event.clientX - active.x, event.clientY - active.y) < 7) return;
    active.started = true;
    begin(active, event);
  });
  window.addEventListener("pointerup", () => { if (active) { if (active.release) active.release(); active = null; } });

  function begin(grab, firstEvent) {
    const mode = Math.random() < (wild() ? 0.3 : 0.1) ? "bite" : pick(["rubber", "rubber", "greased", "heavy"]);
    A().stage(async (s) => {
      const base = s.home();
      s.place(base);
      const band = document.createElement("div");
      band.className = "av-drag-band";
      document.body.append(band);
      const released = new Promise((resolve) => { grab.release = resolve; });
      let pos = { ...base }, won = false, lastMove = Date.now(), spoke = 0, bitten = false;
      const origin = { x: base.x + s.size.w / 2, y: base.y + s.size.h / 2 };

      const say = (key) => { if (Date.now() - spoke < 1400) return; spoke = Date.now(); s.say(wild() && Math.random() < 0.6 ? pick(RUDE).replace("{n}", nick()) : pick(LINES[key]), 2200); };
      say(mode === "bite" ? "rubber" : mode);

      const update = (event) => {
        if (won) return;
        lastMove = Date.now();
        const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
        const len = Math.hypot(dx, dy) || 1;
        let k;
        if (mode === "heavy") k = 0.1;
        else if (mode === "greased") k = -0.55;
        else k = (MAX * Math.tanh(len / (MAX * 1.4))) / len; // elastic: the further, the harder she pulls back
        pos = { x: base.x + dx * k, y: base.y + dy * k };
        const far = Math.hypot(pos.x - base.x, pos.y - base.y);
        if (far > 190) pos = { x: base.x + ((pos.x - base.x) * 190) / far, y: base.y + ((pos.y - base.y) * 190) / far };
        pos = { x: Math.max(6, Math.min(innerWidth - s.size.w - 6, pos.x)), y: Math.max(6, Math.min(innerHeight - s.size.h - 6, pos.y)) };
        const stretch = Math.hypot(pos.x - base.x, pos.y - base.y);
        s.el.style.transform = s.at(pos, 1 + Math.min(0.25, stretch / 500), Math.max(-25, Math.min(25, dx / 8)));
        s.el.classList.toggle("face-left", dx < 0);
        // band from home to her
        const cx = pos.x + s.size.w / 2, cy = pos.y + s.size.h / 2;
        band.style.left = `${origin.x}px`;
        band.style.top = `${origin.y}px`;
        band.style.width = `${Math.hypot(cx - origin.x, cy - origin.y)}px`;
        band.style.transform = `rotate(${Math.atan2(cy - origin.y, cx - origin.x)}rad)`;
        band.style.opacity = mode === "rubber" || mode === "bite" ? "1" : "0";
        if (mode === "rubber" && len > MAX * 2.4) win(event);
        if (mode === "bite" && !bitten && len > 60) chomp(event);
      };
      const win = (event) => {
        won = true;
        say("win");
        document.body.animate([{ translate: "0 0" }, { translate: "10px -6px" }, { translate: "-8px 5px" }, { translate: "0 0" }], { duration: 320 });
        s.anim([{ transform: s.at(pos, 1.3, 0) }, { transform: s.at(base, 1, 0) }], { duration: 260, easing: "cubic-bezier(.2,1.8,.4,1)" });
        band.style.opacity = "0";
      };
      const chomp = (event) => {
        bitten = true;
        const bite = document.createElement("div");
        bite.className = "av-drag-bite";
        bite.textContent = "CHOMP!";
        bite.style.left = `${event.clientX}px`;
        bite.style.top = `${event.clientY}px`;
        document.body.append(bite);
        bite.animate([{ transform: "translate(-50%, -50%) scale(.4)", opacity: 1 }, { transform: "translate(-50%, -120%) scale(1.3)", opacity: 0 }], { duration: 900, fill: "forwards" }).finished.then(() => bite.remove(), () => bite.remove());
        document.body.animate([{ translate: "0 0" }, { translate: "6px 3px" }, { translate: "0 0" }], { duration: 180 });
        spoke = 0; s.say(wild() ? "Ha! You taste like desperation, " + nick() + "." : "Nom! Now you know.", 2200);
        s.act("sparkle", 800);
      };
      window.addEventListener("pointermove", update);
      update(firstEvent);
      // Holding still makes her complain (heavy complains more).
      const nag = setInterval(() => { if (Date.now() - lastMove > 1800 && !won) say("held"); }, 600);
      await released;
      clearInterval(nag);
      window.removeEventListener("pointermove", update);
      justDragged = Date.now();
      band.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished.then(() => band.remove(), () => band.remove());
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
    });
  }
})();
