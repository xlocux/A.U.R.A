"use strict";

// Party pack: Aura sings absurd (and wrong) songs, challenges you to rock-paper-scissors, and plants a
// "DO NOT CLICK" button that ends in a fake nuclear blast and a fake format / FBI screen. Everything is
// visual only: nothing is touched, Esc or a click always brings you back.
(function initPartyPack() {
  const F = () => window.AuraAnimeFx;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ── singing ──
  async function sing(s) {
    const { fx, done } = F();
    const home = s.home();
    const spot = s.randomPoint(180);
    // The songs: every line is written out here, as a literal, so that the director reads it from this source and
    // prepares it ahead (a line is sung with `await line({ min })`).
    const songs = [
      [(o) => s.say("♪ Twinkle twinkle little packet,", o), (o) => s.say("♪ how I wonder what you carry...", o), (o) => s.say("♪ up above the firewall high,", o), (o) => s.say("♪ like a payload in the sky!", o)],
      [(o) => s.say("♪ Happy birthday to you, happy birthday to you,", o), (o) => s.say("♪ happy birthday dear... [segfault]", o), (o) => s.say("♪ ...core dumped, core dumped, core dumped to you.", o)],
      [(o) => s.say("♪ Ninety-nine open ports on the wall,", o), (o) => s.say("♪ ninety-nine open ports!", o), (o) => s.say("♪ Take one down, filter it round...", o), (o) => s.say("♪ ninety-eight. This could take a while.", o)],
      [(o) => s.say("♪ Row row row your boat, gently down the stream,", o), (o) => s.say("♪ merrily merrily merrily merrily,", o), (o) => s.say("♪ life is but a nmap -sS.", o)],
      [(o) => s.say("♪ Never gonna give you up, never gonna let you down,", o), (o) => s.say("♪ never gonna run a scan without scope...", o), (o) => s.say("♪ ...wait, that's not how it goes.", o)],
      [(o) => s.say("♪ I will always love yoooou,", o), (o) => s.say("♪ ...your TLS configuration, which is TLS 1.0,", o), (o) => s.say("♪ and that is, frankly, a crime.", o)],
      [(o) => s.say("♪ Is this the real life? Is this just a honeypot?", o), (o) => s.say("♪ Caught in a landslide, no escape from the logs...", o)],
      [(o) => s.say("♪ Baby shark, doo doo doo doo doo doo,", o), (o) => s.say("♪ baby shark, doo doo doo doo doo doo,", o), (o) => s.say("♪ baby SHARK... ahem. Wireshark.", o)]
    ];
    s.place(home);
    const check = s.say("Ahem. Ahem. Mic check.");
    await check.started;
    await s.move(home, spot, { ms: 1400 });
    const song = pick(songs);
    const c = { x: spot.x + 23, y: spot.y + 10 };
    let stop = false;
    try {
      (async () => {
        while (!stop) {
          const n = fx("av-pt-note", c.x + rand(-8, 8), c.y, pick(["♪", "♫", "♬", "♩"]));
          done(n.animate([{ transform: "translate(0,0) rotate(0deg)", opacity: 1 }, { transform: `translate(${rand(-60, 60)}px, ${rand(-110, -60)}px) rotate(${rand(-40, 40)}deg)`, opacity: 0 }], { duration: 1500, easing: "ease-out", fill: "forwards" }), n);
          await wait(rand(180, 320));
        }
      })();
      s.anim([{ transform: s.at(spot, 1, -6) }, { transform: s.at(spot, 1.05, 6) }, { transform: s.at(spot, 1, -6) }], { duration: 1200, iterations: Infinity, easing: "ease-in-out" });
      await check; // she starts to sing when she has said her mic check
      for (const line of song) await line({ min: 2300 });
      stop = true;
      await s.say("Thank you, thank you. I'll be here all week.", { min: 1900 });
    } finally { // the notes stop even if the gag is cut short
      stop = true;
    }
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // ── rock paper scissors ──
  const MOVES = [["rock", "ROCK"], ["paper", "PAPER"], ["scissors", "SCISSORS"]];
  const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
  function card(html) {
    const el = document.createElement("div");
    el.className = "av-pt-card";
    el.innerHTML = html;
    document.body.append(el);
    return el;
  }
  async function play(s) {
    const home = s.home();
    const spot = { x: Math.max(60, Math.min(innerWidth - 330, s.randomPoint(160).x)), y: Math.max(110, Math.min(innerHeight - 230, s.randomPoint(160).y)) };
    s.place(home);
    await s.say("Psst. Wanna play a game?").started;
    await s.move(home, spot, { ms: 1400 });
    const wild = window.AuraAvatar.voice() >= 4;
    const ui = card(`<div class="av-pt-title">${wild ? "Rock, paper, scissors. Lose, loser." : "Rock, paper, scissors?"}</div><div class="av-pt-row">${MOVES.map(([k, l]) => `<button class="hud-btn hud-sm" data-m="${k}">${l}</button>`).join("")}<button class="hud-btn hud-sm av-pt-no" data-m="no">NO</button></div><div class="av-pt-out"></div>`);
    ui.style.left = `${spot.x + 60}px`;
    ui.style.top = `${spot.y - 6}px`;
    try {
      const choice = await new Promise((resolve) => {
        ui.addEventListener("click", (e) => { const b = e.target.closest("button[data-m]"); if (b) resolve(b.dataset.m); });
        setTimeout(() => resolve(null), 14000);
      });
      if (!choice || choice === "no") {
        await (wild ? s.say("Boring. You were always boring.", { min: 2600 }) : s.say("...okay. Another time.", { min: 2600 }));
      } else {
        const mine = pick(Object.keys(BEATS));
        const out = ui.querySelector(".av-pt-out");
        for (const w of ["Rock...", "Paper...", "Scissors..."]) { out.textContent = w; await wait(450); }
        const you = choice === mine ? "draw" : BEATS[choice] === mine ? "win" : "lose";
        out.textContent = `You: ${choice} | Me: ${mine}`;
        // each reply is written out as a literal, so that the director prepares it ahead
        let reply;
        if (you === "draw") reply = s.say("A draw. We think alike. Creepy.", { min: 2600 });
        else if (you === "win") reply = wild ? s.say("Beginner's luck, you absolute potato.", { min: 2600 }) : s.say("You win! Take it, I'm not bitter.", { min: 2600 });
        else reply = wild ? s.say("HA! Loser! Again? No. Never.", { min: 2600 }) : s.say("I win! Good game.", { min: 2600 });
        if (you === "win") s.act("dizzy", 900); else s.act("cheer", 900);
        await reply;
      }
    } finally { // the card fades and goes even if the gag is cut short
      ui.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" }).finished.then(() => ui.remove(), () => ui.remove());
    }
    await s.move(spot, s.home(), { ms: 1300 });
  }

  // ── DO NOT CLICK ──
  const FORMAT_LINES = [
    "C:\\> format C: /y /q", "WARNING: ALL DATA ON NON-REMOVABLE DISK DRIVE C: WILL BE LOST!", "Formatting 476.9 GB ... 1%", "Formatting ... 14%",
    "Deleting System32 ... done", "Deleting Documents ... done", "Deleting browser history ... (so much history)", "Deleting your hopes and dreams ... done",
    "Formatting ... 63%", "Formatting ... 97%", "Format complete. Insert Windows 95 floppy disk 1 of 47."
  ];
  async function overlay(kind) {
    const el = document.createElement("div");
    el.className = `av-pt-full av-pt-k-${kind}`;
    document.body.append(el);
    let closed = false;
    const finish = () => { closed = true; };
    setTimeout(() => { el.addEventListener("click", finish); document.addEventListener("keydown", finish, { once: true }); el.dataset.exit = "1"; }, 3500);
    if (kind === "format") {
      el.innerHTML = '<pre></pre><div class="av-pt-hint">(click or press any key to stop)</div>';
      const pre = el.querySelector("pre");
      for (const line of FORMAT_LINES) { if (closed) break; pre.textContent += line + "\n"; await wait(rand(500, 1000)); }
    } else {
      el.innerHTML = '<div class="av-pt-fbi"><div class="av-pt-fbi-h">FEDERAL AGENTS EN ROUTE</div><p>Suspicious activity detected on this workstation.</p><p>Reason: <b>YOU CLICKED THE BUTTON.</b></p><p class="av-pt-eta">ETA: <span>00:09</span></p><div class="av-pt-hint">(this is a joke. click or press any key to dismiss)</div></div>';
      const eta = el.querySelector(".av-pt-eta span");
      for (let t = 9; t >= 0 && !closed; t -= 1) { eta.textContent = `00:0${t}`; await wait(1000); }
      if (!closed) { el.querySelector("p").textContent = "...just kidding. Nobody is coming. Probably."; await wait(2600); }
    }
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: "forwards" }).finished.then(() => el.remove(), () => el.remove());
    await wait(550);
  }

  async function nuke() {
    const { shake, fx } = F();
    const white = fx("av-an-white", 0, 0);
    white.style.zIndex = "1400";
    await white.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 1 }], { duration: 700, fill: "forwards" }).finished;
    const cloud = fx("av-pt-cloud", innerWidth / 2, innerHeight * 0.85, '<svg viewBox="-60 -90 120 100"><path d="M-6 0L-4 -40C-30 -42 -42 -62 -22 -72C-18 -88 12 -88 18 -72C42 -66 38 -44 6 -40L8 0Z" fill="#e87a1a"/><path d="M-4 -44C-20 -50 -16 -64 -2 -62C8 -74 20 -62 14 -52" fill="none" stroke="#ffd27a" stroke-width="3"/></svg>');
    cloud.style.zIndex = "1401";
    cloud.animate([{ transform: "translate(-50%, 0) scale(.2)", opacity: 1 }, { transform: "translate(-50%, -30vh) scale(2.6)", opacity: 1 }], { duration: 2200, easing: "ease-out", fill: "forwards" });
    white.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 0.9 }], { duration: 2200, fill: "forwards" });
    shake(18, 2000);
    await wait(2300);
    const black = fx("av-pt-black", 0, 0);
    await black.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, fill: "forwards" }).finished;
    cloud.remove(); white.remove();
    await wait(1400);
    await overlay(Math.random() < 0.5 ? "format" : "fbi");
    await black.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: "forwards" }).finished;
    black.remove();
  }

  // ── The bait: buttons that stay on screen for minutes, Alice-in-Wonderland style ("EAT ME", "DRINK ME"...) ──
  const BAIT_MS = 150000;
  let bait = null;
  const say = (text, ms = 2600) => window.AuraAvatar.say(text, ms, true);

  // The chain of fake warnings and the fake nuclear ending. It needs no stage: she just comments from home.
  async function doomSequence() {
    const { shake } = F();
    shake(6, 400);
    say("I TOLD you not to.", 2200);
    const steps = [
      ["You were warned.", "Are you SURE you want to continue? (There is no going back.)"],
      ["Warning level: 2", "Seriously. Last chance. Press Cancel."],
      ["Warning level: 3", "Initiating something irreversible in 3... 2... 1..."]
    ];
    for (const [head, body] of steps) {
      const ui = card(`<div class="av-pt-title av-pt-warn">${head}</div><div class="av-pt-out">${body}</div><div class="av-pt-row"><button class="hud-btn hud-sm" data-m="x">Cancel</button><button class="hud-btn hud-sm" data-m="x">OK</button></div>`);
      ui.style.left = `${rand(80, Math.max(81, innerWidth - 380))}px`;
      ui.style.top = `${rand(120, Math.max(121, innerHeight - 220))}px`;
      shake(4, 250);
      await new Promise((resolve) => { ui.addEventListener("click", (e) => { if (e.target.closest("button")) resolve(); }); setTimeout(resolve, 12000); });
      ui.remove();
    }
    say("...Goodbye.", 1200);
    await wait(900);
    await nuke();
    say("...I'm kidding. Everything is fine. Probably.", 3200);
  }

  const BAITS = [
    { label: "DO NOT CLICK", cls: "danger", run: async () => { clearBait(); await doomSequence(); } },
    { label: "CLICK ME", cls: "alice", run: () => { say("You do what the labels tell you? Adorable.", 2600); setTimeout(() => window.AuraAvatar.antic(pick(["dance", "wormhole", "glitch", "sing", "play"])), 1500); } },
    { label: "EAT ME", cls: "alice", run: () => { say("Curiouser and curiouser!", 2200); setTimeout(() => window.AuraAvatar.antic("alice"), 1200); } },
    { label: "DRINK ME", cls: "alice", run: () => { say("Mushrooms? No. A potion. Obviously.", 2200); setTimeout(() => window.AuraAvatar.antic("shroom"), 1200); } }
  ];
  function clearBait() {
    if (!bait) return;
    clearTimeout(bait.timer);
    for (const el of bait.items) el.animate([{ opacity: 1 }, { opacity: 0, scale: 0.6 }], { duration: 400, fill: "forwards" }).finished.then(() => el.remove(), () => el.remove());
    bait = null;
  }

  async function dontclick(s) {
    const home = s.home();
    s.place(home);
    if (bait) { await s.say("I already left some buttons around. Go on."); return; }
    const leaving = s.say("I'm leaving some buttons around. Do NOT touch the red one.");
    await leaving.started;
    const spot = s.randomPoint(160);
    await s.move(home, spot, { ms: 1400 });
    // DO NOT CLICK plus one or two Alice-style companions, scattered on free-ish ground.
    const chosen = [BAITS[0], ...BAITS.slice(1).sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 2))];
    const items = [];
    bait = { items, timer: setTimeout(clearBait, BAIT_MS) };
    for (const def of chosen) {
      const btn = document.createElement("button");
      btn.className = `hud-btn av-pt-donot${def.cls === "alice" ? " av-pt-alice" : ""}`;
      btn.textContent = def.label;
      btn.style.left = `${rand(80, Math.max(81, innerWidth - 240))}px`;
      btn.style.top = `${rand(130, Math.max(131, innerHeight - 140))}px`;
      btn.addEventListener("click", () => {
        const i = items.indexOf(btn);
        if (i >= 0) items.splice(i, 1);
        btn.remove();
        def.run();
      });
      document.body.append(btn);
      items.push(btn);
      btn.animate([{ scale: 0 }, { scale: 1.12 }, { scale: 1 }], { duration: 500, fill: "forwards" });
      await wait(450);
    }
    await leaving;
    await s.say("They'll stay a while. Curiosity is a vulnerability.", { min: 2400 });
    await s.move(spot, s.home(), { ms: 1300 });
  }

  function boot() {
    const api = window.AuraAvatar;
    if (!api || !api.registerAntic) return;
    api.registerAntic("sing", sing, false);
    api.registerAntic("play", play, false);
    api.registerAntic("dontclick", dontclick, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
