"use strict";

// Aura: a small holographic assistant avatar for the AI agent. Pure SVG/CSS, no libraries.
// Mounts into every [data-ai-avatar]; reacts to the chat and the run, and does small friendly things
// when idle (blink, wink, glance at the cursor, tilt, sparkle, doze off). window.AuraAvatar.react(type).
(function initAuraAvatar() {
  const SVG = `
<svg viewBox="0 0 64 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="avScanGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset=".5" stop-color="currentColor" stop-opacity=".45"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient>
    <clipPath id="avClip"><path d="M10 66 Q12 49 32 47 Q52 49 54 66 Z"/><ellipse cx="32" cy="29" rx="13" ry="16"/></clipPath>
  </defs>
  <g class="av-aura">
    <ellipse class="aura-core" cx="32" cy="40" rx="20" ry="30"/>
    <path class="aura-flame f1" d="M32 70 C16 60 12 44 19 28 C21 37 25 40 28 35 C25 24 29 12 32 2 C35 12 39 24 36 35 C39 40 43 37 45 28 C52 44 48 60 32 70Z"/>
    <path class="aura-flame f2" d="M32 66 C22 58 20 46 24 36 C26 42 29 43 30 39 C29 31 31 22 32 14 C33 22 35 31 34 39 C35 43 38 42 40 36 C44 46 42 58 32 66Z"/>
  </g>
  <ellipse class="av-ring" cx="32" cy="66" rx="22" ry="4.5"/>
  <ellipse class="av-ring r2" cx="32" cy="66" rx="22" ry="4.5"/>
  <g class="av-fig">
    <path class="av-spikes" d="M19 18 L13 3 L24 12 L28 -2 L32 11 L36 -2 L40 12 L51 3 L45 18 Z"/>
    <path class="av-body" d="M10 66 Q12 49 32 47 Q52 49 54 66 Z"/>
    <path class="av-glyph" d="M18 62 Q32 52 46 62 M22 66 Q32 58 42 66"/>
    <ellipse class="av-face" cx="32" cy="29" rx="12" ry="15"/>
    <path class="av-hair" d="M18 31 Q15 11 32 11 Q49 11 46 31 Q45 21 32 19 Q19 21 18 31 Z"/>
    <path class="av-hair" d="M18 31 Q17 40 21 46 Q19 38 21 31 Z M46 31 Q47 40 43 46 Q45 38 43 31 Z"/>
    <path class="av-glyph g2" d="M22 17 Q32 12 42 17 M20 22 Q32 15 44 22 M19 27 Q32 19 45 27"/>
    <path class="av-glyph" d="M26 41 L38 41 M28 44 L36 44"/>
    <g class="av-pupil-shift">
      <ellipse class="av-eye left" cx="27" cy="30" rx="2.3" ry="1.5"/>
      <ellipse class="av-eye right" cx="37" cy="30" rx="2.3" ry="1.5"/>
    </g>
    <path class="av-mouth" d="M29 37 Q32 39.5 35 37"/>
    <ellipse class="av-blush" cx="24" cy="35" rx="3.2" ry="1.7"/><ellipse class="av-blush" cx="40" cy="35" rx="3.2" ry="1.7"/>
    <path class="av-sweat" d="M47 21 q3.6 5.2 0 7.4 q-3.6 -2.2 0 -7.4z"/>
    <path class="av-bolt" d="M10 30 l5 -6 l-3 7 l5 -3"/><path class="av-bolt b2" d="M54 36 l-5 6 l3 -7 l-5 3"/>
    <g clip-path="url(#avClip)"><rect class="av-scan" x="0" y="0" width="64" height="70"/></g>
    <path class="av-spark" d="M12 20 l1.5 3.5 3.5 1.5 -3.5 1.5 -1.5 3.5 -1.5 -3.5 -3.5 -1.5 3.5 -1.5 z"/>
    <path class="av-spark" d="M52 14 l1.2 2.8 2.8 1.2 -2.8 1.2 -1.2 2.8 -1.2 -2.8 -2.8 -1.2 2.8 -1.2 z"/>
    <text class="av-zzz" x="46" y="18">z</text>
  </g>
</svg>`;

  const QUIPS = [
    "Need a hand with the recon?",
    "I'm keeping an eye on the flow.",
    "Tip: click a hex tile for its details.",
    "Correlations look interesting today.",
    "Ask me what to run next."
  ];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  function contextQuip() {
    const running = document.querySelector("#tab-flow.active .flow-hex.running .flow-hex-name")?.textContent?.trim();
    if (running) return pick(["Still on " + running + "...", running + " is cooking.", "Watching " + running + " closely."]);
    if (document.querySelector("#tab-flow.active")) return pick(["Click a tile for its command and events.", "Tiles light up as phases start."]);
    return pick(QUIPS);
  }
  const mounts = () => [...document.querySelectorAll("[data-ai-avatar]")];
  const isVisible = (el) => el.getClientRects().length > 0;
  const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  let bubble = null;
  let bubbleTimer = null;
  let idleTimer = null;
  let sleepTimer = null;
  let lastActivity = Date.now();
  let thinking = false;
  let clicks = [];
  let roamer = null;
  let roaming = false;
  let lastRoam = 0;

  function mountAll() {
    for (const el of mounts()) {
      if (el.dataset.avReady) continue;
      el.dataset.avReady = "true";
      el.innerHTML = SVG;
      el.setAttribute("role", "img");
      el.setAttribute("aria-label", "Aura, the AI assistant");
    }
  }

  function act(name, ms = 1200) {
    for (const el of mounts()) {
      el.classList.add(`act-${name}`);
      setTimeout(() => el.classList.remove(`act-${name}`), ms);
    }
  }

  function setState(name, on) {
    for (const el of mounts()) el.classList.toggle(`state-${name}`, on);
  }

  function say(text, ms = 4200) {
    const visible = (roaming && roamer && isVisible(roamer) ? roamer : null) || mounts().find((el) => el !== roamer && isVisible(el));
    if (!visible) return;
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "ai-avatar-bubble";
      document.body.appendChild(bubble);
    }
    bubble.textContent = text;
    const rect = visible.getBoundingClientRect();
    // Prefer below the avatar (header sits at the top of the panel); flip above near the screen bottom.
    const below = rect.bottom + 8 + 60 < window.innerHeight;
    bubble.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 232))}px`;
    bubble.style.top = below ? `${rect.bottom + 8}px` : `${Math.max(8, rect.top - 52)}px`;
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);
  }

  function wake() {
    lastActivity = Date.now();
    for (const el of mounts()) el.classList.remove("asleep");
  }

  // Idle personality: every so often do something small; doze off after a long quiet spell.
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!thinking && !document.hidden) {
        const canRoam = Date.now() - lastRoam > 90000;
        const action = pick(canRoam ? ["wink", "tilt", "sparkle", "quip", "roam", "roam"] : ["wink", "tilt", "sparkle", "wink", "quip"]);
        if (action === "roam") {
          const hexes = [...document.querySelectorAll("#tab-flow.active .flow-hex")];
          const spot = hexes.length ? pick(hexes) : { x: 120 + Math.random() * (window.innerWidth - 360), y: 120 + Math.random() * (window.innerHeight - 260) };
          roamTo(spot, { text: pick(["Just stretching my pixels.", "Exploring the pipeline.", "Checking the hex grid.", "Nothing to see here... or is there?"]), action: pick(["wink", "sparkle", "tilt"]), stay: 2200 });
        } else if (action === "quip") say(contextQuip());
        else act(action, 1300);
      }
      scheduleIdle();
    }, 14000 + Math.random() * 14000);
  }

  function scheduleSleep() {
    clearInterval(sleepTimer);
    sleepTimer = setInterval(() => {
      if (!thinking && Date.now() - lastActivity > 150000) for (const el of mounts()) el.classList.add("asleep");
    }, 15000);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function ensureRoamer() {
    if (roamer) return roamer;
    roamer = document.createElement("div");
    roamer.className = "ai-avatar-roamer";
    roamer.setAttribute("data-ai-avatar", "");
    document.body.appendChild(roamer);
    mountAll(); // injects the SVG into the new mount
    return roamer;
  }

  // Resolve a target (element or {x,y}) to a top-left point for the roamer, kept inside the viewport.
  function targetPoint(target, size) {
    let x;
    let y;
    if (target instanceof Element) {
      const r = target.getBoundingClientRect();
      x = r.left + r.width / 2 - size.w / 2;
      y = r.top - size.h + 6; // stand just above the tile
    } else {
      x = target.x;
      y = target.y;
    }
    return {
      x: Math.max(8, Math.min(x, window.innerWidth - size.w - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - size.h - 8))
    };
  }

  // Leave the chat, walk (along a gentle arc) to the target, react, then walk back home.
  async function roamTo(target, { text = "", action = "cheer", stay = 2600 } = {}) {
    const origin = mounts().find((el) => el !== roamer && isVisible(el));
    if (roaming || reducedMotion() || !origin || document.hidden) {
      if (text) say(text);
      return;
    }
    roaming = true;
    lastRoam = Date.now();
    const size = { w: 46, h: 52 };
    const r = ensureRoamer();
    const centerOf = (el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left + b.width / 2 - size.w / 2, y: b.top + b.height / 2 - size.h / 2 };
    };
    const home = centerOf(origin);
    const dest = targetPoint(target, size);
    const arc = (a, b) => ({ x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 70 - Math.random() * 50 });
    const at = (p, s = 1) => "translate(" + p.x + "px, " + p.y + "px) scale(" + s + ")";
    try {
      origin.classList.add("av-away");
      r.style.display = "block";
      r.classList.toggle("face-left", dest.x < home.x);
      r.classList.add("walking");
      const out = r.animate([
        { transform: at(home, 0.5), opacity: 0 },
        { transform: at(home, 1), opacity: 1, offset: 0.12 },
        { transform: at(arc(home, dest)), offset: 0.55 },
        { transform: at(dest) }
      ], { duration: 1900, easing: "ease-in-out", fill: "forwards" });
      await out.finished;
      r.classList.remove("walking");
      act(action, action === "saiyan" ? 3400 : 1900);
      if (text) say(text, stay + 800);
      await sleep(stay);
      // Back home (recompute: the panel may have moved or been hidden meanwhile).
      const back = isVisible(origin) ? centerOf(origin) : home;
      r.classList.toggle("face-left", back.x < dest.x);
      r.classList.add("walking");
      const returning = r.animate([
        { transform: at(dest) },
        { transform: at(arc(dest, back)), offset: 0.45 },
        { transform: at(back, 1), opacity: 1, offset: 0.88 },
        { transform: at(back, 0.5), opacity: 0 }
      ], { duration: 1700, easing: "ease-in-out", fill: "forwards" });
      await returning.finished;
    } catch {
      // animation cancelled (e.g. the element was removed): fall through to cleanup
    } finally {
      if (roamer) {
        roamer.style.display = "none";
        roamer.classList.remove("walking", "face-left");
        roamer.getAnimations().forEach((animation) => animation.cancel());
      }
      origin.classList.remove("av-away");
      roaming = false;
    }
  }

  // The eyes glance toward the cursor (throttled to animation frames).
  function trackCursor() {
    let queued = false;
    window.addEventListener("pointermove", (event) => {
      wake();
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        for (const el of mounts()) {
          if (!isVisible(el)) continue;
          const r = el.getBoundingClientRect();
          const dx = event.clientX - (r.left + r.width / 2);
          const dy = event.clientY - (r.top + r.height / 2);
          const len = Math.hypot(dx, dy) || 1;
          el.style.setProperty("--lx", (dx / len).toFixed(2));
          el.style.setProperty("--ly", (dy / len).toFixed(2));
        }
      });
    }, { passive: true });
  }

  // Public reactions, fired by the chat and the run lifecycle.
  function react(type, text, detail = {}) {
    wake();
    if (type === "thinking") { thinking = true; setState("think", true); }
    else if (type === "reply") {
      thinking = false; setState("think", false);
      act(pick(["tilt", "wink", "sparkle"]), 1100);
      if (Math.random() < 0.3) say(pick(["There you go.", "Hope that helps!", "Anything else?"]), 2600);
    } else if (type === "stage") {
      const tile = document.querySelector('#tab-flow.active .flow-hex[data-stage-id="' + detail.stageId + '"]');
      const label = detail.label || "A stage";
      const line = detail.zone === "vuln"
        ? pick([label + " done - check Vulns!", label + " finished. Let's see what turned up."])
        : pick([label + " complete!", label + " wrapped up.", "Nice, " + label + " is done."]);
      // Walk over to the tile when the Flow is on screen and we haven't wandered recently.
      if (tile && Date.now() - lastRoam > 20000) roamTo(tile, { text: line, action: detail.zone === "vuln" ? "sparkle" : "cheer" });
      else { act("sparkle", 1100); say(line, 3200); }
    }
    else if (type === "vuln") {
      // Found something: power up! The aura grows (A.U.R.A, get it?). Walks to the finding's tile if the Flow is open.
      thinking = false; setState("think", false);
      const n = Number(detail.count) || 1;
      const tile = document.querySelector('#tab-flow.active .flow-hex[data-stage-id="' + (detail.stageId || "vnuclei") + '"]');
      const line = pick([
        "Power level rising... " + n + " finding" + (n === 1 ? "" : "s") + "!",
        "Vulnerabilities detected! " + n + " to review.",
        "My power level is over " + (8000 + n * 1000) + "!",
        n + " finding" + (n === 1 ? "" : "s") + " - time to power up!"
      ]);
      if (tile && !roaming && Date.now() - lastRoam > 6000) roamTo(tile, { text: line, action: "saiyan", stay: 4000 });
      else { act("saiyan", 3400); say(line, 4600); }
    } else if (type === "start") {
      act("cheer", 1100);
      say(pick(["Let's hunt!", "Scan launched - I'll watch the flow.", "Here we go.", "Engines on."]), 3000);
    } else if (type === "tool-fail") {
      setState("think", false);
      act("worried", 2800);
      say(text || "A tool failed.", 4200);
    }
    else if (type === "error") { thinking = false; setState("think", false); act("shake", 600); say(text || "Hmm, that didn't work."); }
    else if (type === "done") {
      thinking = false; setState("think", false);
      const hex = document.querySelector('#tab-flow.active .flow-hex[data-stage-id="recovery"]') || document.querySelector("#tab-flow.active .flow-hex");
      if (hex && Date.now() - lastRoam > 8000) roamTo(hex, { text: text || "Recon complete!", action: "cheer", stay: 3200 });
      else { act("cheer", 1900); say(text || "Recon complete!"); }
    }
    else if (type === "say") say(text || pick(QUIPS));
  }

  function bindClick() {
    document.addEventListener("click", (event) => {
      const av = event.target.closest("[data-ai-avatar]");
      if (!av) return;
      wake();
      const restore = document.getElementById("aiRestore");
      if (restore?.classList.contains("active")) restore.click(); // open the chat if minimized
      const now = Date.now();
      clicks = clicks.filter((t) => now - t < 2000).concat(now);
      if (clicks.length >= 3) { act("dizzy", 1200); say(pick(["Hey, that tickles!", "Whoa, easy there!", "I'm dizzy now..."])); clicks = []; }
      else { act(pick(["wink", "tilt", "sparkle", "blush"]), 1300); say(contextQuip()); }
    });
  }

  function boot() {
    mountAll();
    trackCursor();
    bindClick();
    scheduleIdle();
    scheduleSleep();
    window.addEventListener("aura:ai", (event) => react(event.detail?.type, event.detail?.text, event.detail || {}));
    // Mounts can appear later (panel re-render): keep them populated.
    let mountQueued = false;
    new MutationObserver(() => {
      if (mountQueued) return;
      mountQueued = true;
      requestAnimationFrame(() => { mountQueued = false; mountAll(); });
    }).observe(document.body, { childList: true, subtree: true });
    // A short hello once per session.
    if (!sessionStorage.getItem("auraAvatarHello")) {
      sessionStorage.setItem("auraAvatarHello", "1");
      setTimeout(() => { act("wink", 1300); say("Hi, I'm Aura. Ask me about the run."); }, 2200);
    }
  }

  window.AuraAvatar = { react, say, act, roamTo };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
