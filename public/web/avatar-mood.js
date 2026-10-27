"use strict";

// Auri's mood during a scan: she gets bored when nothing turns up, hyped when results pour in, and a vulnerability
// is a shot of adrenaline (edge pulse, heartbeat, manga title). Scaled by the personality level.
(function initAvatarMood() {
  const A = () => window.AuraAvatar;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const level = () => (A() ? A().voice() : 2);

  const BORED = [
    "...Is anything going to happen?", "I've seen faster glaciers.", "Wake me up when something shows up. *yawn*",
    "Nothing. Still nothing. Riveting.", "I could be counting pixels right now."
  ];
  const BORED_RUDE = [
    "This target is boring. Like you, {n}.", "Nothing. Great scope, {n}. Really inspired.", "I'm falling asleep. Pick a better target, {n}."
  ];
  const HYPE = ["SO. MUCH. DATA!", "It's raining results!", "Everything is lighting up, I can't keep up!", "Yes yes yes yes YES!"];
  const HYPE_WILD = ["I CAN'T TAKE IT! THE DATA! THE BEAUTIFUL DATA!", "MORE! GIVE ME MORE, {n}!", "WE'RE EATING GOOD TONIGHT!!"];
  const ADR = ["ADRENALINE! LOOK AT THAT!", "THERE IT IS! THERE IT IS!", "OH YES OH YES OH YES!", "GOT YOU, YOU BEAUTIFUL BUG!", "HEART RATE: 200!"];

  let run = null; // { start, lastFind, events: [timestamps] }
  let lastBored = 0, lastHype = 0, lastAdr = 0;
  const homes = () => (A() ? A().mounts().filter((el) => !el.classList.contains("ai-avatar-roamer")) : []);
  const rude = (list) => pick(list).replace("{n}", window.AuraQuotes ? window.AuraQuotes.nick() : "you");

  function flag(cls, ms) {
    const els = homes();
    els.forEach((el) => el.classList.add(cls));
    setTimeout(() => els.forEach((el) => el.classList.remove(cls)), ms);
  }

  function adrenaline(n) {
    if (Date.now() - lastAdr < 6000) return;
    lastAdr = Date.now();
    const edge = document.createElement("div");
    edge.className = "av-adr";
    document.body.append(edge);
    edge.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0 }], { duration: n >= 3 ? 2600 : 1700 }).finished.then(() => edge.remove(), () => edge.remove());
    flag("av-heartbeat", 2600);
    if (level() >= 2) {
      document.body.animate([{ translate: "0 0" }, { translate: "3px -2px" }, { translate: "-3px 2px" }, { translate: "0 0" }], { duration: 260, iterations: n >= 3 ? 4 : 2 });
      if ((n >= 3 || level() >= 3) && window.AuraAnimeFx) window.AuraAnimeFx.title(n >= 5 ? "JACKPOT!" : "FOUND IT!", 1100);
    }
    if (level() >= 3) setTimeout(() => A().say(pick(ADR), 2600, true), 1300);
  }

  function hype() {
    if (Date.now() - lastHype < 70000 || level() < 2) return;
    lastHype = Date.now();
    A().act("cheer", 1600);
    A().say(level() >= 4 ? rude(HYPE_WILD) : pick(HYPE), 3200, true);
    flag("av-hyper", 5000);
    // Chatty and up: she loses it a little.
    if (level() >= 3 && !A().isRoaming()) setTimeout(() => A().antic(pick(level() >= 4 ? ["zoomies", "swarm", "bounce", "dance"] : ["dance", "wormhole"])), 2200);
  }

  function bored() {
    const limit = [0, 0, 240000, 150000, 80000][level()];
    if (!run || !limit || Date.now() - run.lastFind < limit || Date.now() - lastBored < limit * 1.5 || A().isAway() || A().isRoaming() || document.hidden) return;
    lastBored = Date.now();
    flag("av-bored", 9000);
    A().say(level() >= 4 ? rude(BORED_RUDE) : pick(BORED), 4200, true);
    // Chatty and up: she finds her own entertainment.
    if (level() >= 3) setTimeout(() => { if (!A().isRoaming() && !A().isThinking()) A().antic(pick(["sing", "play", "dance", "peek"])); }, 4600);
  }

  function onEvent(detail) {
    const type = detail && detail.type;
    const now = Date.now();
    if (type === "start") run = { start: now, lastFind: now, events: [] };
    else if (type === "done" || type === "error") run = null;
    else if (run && (type === "stage" || type === "vuln")) {
      run.lastFind = now;
      run.events = run.events.filter((t) => now - t < 45000).concat(now);
      if (type === "vuln") adrenaline(Number(detail.count) || 1);
      if (run.events.length >= 4) { run.events = []; hype(); }
    }
  }

  function boot() {
    window.addEventListener("aura:ai", (event) => onEvent(event.detail));
    setInterval(bored, 15000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
