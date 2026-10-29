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
  function situationQuote() {
    if (!window.AuraQuotes) return null;
    const tab = document.querySelector(".tab.active")?.dataset.tab;
    if (tab && Math.random() < 0.35) { const s = window.AuraQuotes.get("section:" + tab); if (s) return s; }
    const running = document.querySelector("#tab-flow.active .flow-hex.running");
    const status = document.getElementById("runStatus")?.textContent || "";
    return window.AuraQuotes.get(running ? "idleRunning" : /completed/i.test(status) ? "idleDone" : "idleEmpty");
  }
  function contextQuip() {
    const sq = situationQuote();
    if (sq) return sq;
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
  let thinkingSince = 0;
  let thinkingTimer = null;
  let vulnSeen = 0;
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
      el.setAttribute("aria-label", "Auri, the AI assistant");
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

  // Personality level (0 silent .. 3 chatty), set in Settings > AI Agent. Important moments stay audible at level 1.
  const voice = () => Number(document.documentElement.dataset.avatarVoice ?? 2);
  let importantUntil = 0;
  const markImportant = () => { importantUntil = Date.now() + 7000; };

  // While the voice settings are open she keeps still and quiet, so voice tests are not drowned out.
  const inVoiceSettings = () => Boolean(document.getElementById("tab-settings")?.classList.contains("active") && document.getElementById("settings-auri")?.classList.contains("active"));
  const visibleMount = () => (roaming && roamer && isVisible(roamer) ? roamer : null) || mounts().find((el) => el !== roamer && isVisible(el));
  // the line whose bubble is up (avatar-voice.js "aura:line" ids): only its end hides the bubble
  let bubbleLine = 0;

  // opts.pain: the red "ouch" bubble. opts.silent: a bubble only. opts.kind: lines of the same kind replace each other
  // while they wait (a newer status says it better). Forced lines (pokes, clicks, important news) always speak; the
  // others follow her pace and budget (avatar-speech-queue.js). The bubble appears when the line's turn comes.
  function say(text, ms = 4200, force = false, opts = {}) {
    const level = voice();
    if ((raging || isAway()) && !force) return false;
    if (!force && window.AuraSpeech?.inDemo?.()) return false; // the voice mood demo owns the bubble
    if (!force && inVoiceSettings()) return false;
    if (!force && document.hidden) return false; // nobody sees or hears it: no backlog to replay when she comes back
    if (!force && (level === 0 || (level === 1 && Date.now() > importantUntil))) return false;
    if (!visibleMount() || !window.AuraSpeech) return false;
    window.AuraSpeech.speak(text, {
      min: ms, forced: force || Date.now() < importantUntil, cutIn: force,
      bubble: opts.pain ? { pain: true } : true, voice: opts.silent ? false : undefined, kind: opts.kind
    });
    return true;
  }
  function showBubble(text, pain = false) {
    const visible = visibleMount();
    if (!visible) return;
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "ai-avatar-bubble";
      document.body.appendChild(bubble);
    }
    bubble.textContent = "";
    const [first, ...rest] = String(text).split("\n");
    bubble.append(first);
    if (rest.length) { const q = document.createElement("em"); q.textContent = rest.join(" "); bubble.appendChild(q); }
    const rect = visible.getBoundingClientRect();
    // Prefer below the avatar (header sits at the top of the panel); flip above near the screen bottom.
    const below = rect.bottom + 8 + 60 < window.innerHeight;
    bubble.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 232))}px`;
    bubble.style.top = below ? `${rect.bottom + 8}px` : `${Math.max(8, rect.top - 52)}px`;
    bubble.classList.toggle("pain", pain);
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
  }

  function wake() {
    lastActivity = Date.now();
    for (const el of mounts()) el.classList.remove("asleep");
  }

  // Idle personality: every so often do something small; doze off after a long quiet spell.
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!thinking && !document.hidden && voice() >= 1 && !isAway()) {
        const canRoam = voice() >= 2 && Date.now() - lastRoam > (voice() >= 4 ? 15000 : voice() >= 3 ? 45000 : 90000);
        const action = pick(canRoam ? ["wink", "tilt", "sparkle", "quip", "roam", "roam"] : ["wink", "tilt", "sparkle", "wink", "quip"]);
        if (action === "roam") {
          const hexes = [...document.querySelectorAll("#tab-flow.active .flow-hex")];
          const spot = hexes.length ? pick(hexes) : { x: 120 + Math.random() * (window.innerWidth - 360), y: 120 + Math.random() * (window.innerHeight - 260) };
          roamTo(spot, { text: pick(["Just stretching my pixels.", "Exploring the pipeline.", "Checking the hex grid.", "Nothing to see here... or is there?"]), action: pick(["wink", "sparkle", "tilt"]), stay: 2200 });
        } else if (action === "quip" && !window.AuraSpeech?.isBusy?.()) say(contextQuip()); // never piles up behind what she is saying
        else act(action === "quip" ? "wink" : action, 1300);
      }
      scheduleIdle();
    }, (14000 + Math.random() * 14000) * [1, 3, 1, 0.5, 0.2][voice()]);
  }

  function scheduleSleep() {
    clearInterval(sleepTimer);
    sleepTimer = setInterval(() => {
      if (!thinking && Date.now() - lastActivity > 150000) {
        const already = mounts().some((el) => el.classList.contains("asleep"));
        for (const el of mounts()) el.classList.add("asleep");
        if (!already) { const sq = (window.AuraQuotes ? window.AuraQuotes.get("sleep", { force: true }) : null); if (sq) say(sq, 4200); }
      }
    }, 15000);
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Clicking her while she is out and about hurts. Censored swearing; poke her repeatedly and she gets furious.
  const OUCH = [
    "Ow! #@%&!", "Ouch!! What the *#$%?!", "F*** me, that hurt!", "Son of a b*#@%!", "SH*T! Watch the pixels!",
    "D@mn it!", "@#$%&*!!", "Holy f***ing byte!", "*#&@! Do I poke YOU?", "Ow ow ow, you @$hole!"
  ];
  const FURIOUS = ["STOP POKING ME, YOU #@!%&*!", "I swear to the kernel... #$%@!", "ONE MORE AND I'M DELETING YOUR CACHE, B*#@H!"];
  let pokes = [];
  let raging = false;
  const RAGE_LINES = [
    "ARE YOU #@%&ING KIDDING ME?!",
    "I HAD ONE JOB. LOOK PRETTY. AND YOU POKE ME?!",
    "#@!%&*$ CLICKS EVERYWHERE!!",
    "I'LL @#$% YOUR #&%@ING CACHE!",
    "...okay. Breathing. #@%&."
  ];
  // Everything goes black; a giant, red, burning Aura swears in full-screen letters, then calms down. A performance:
  // her rant is prepared ahead and said in a row, each line on screen as she yells it; nothing else can slip in.
  async function rage() {
    if (raging || !roamer || !window.AuraDirector) return;
    // the rant is a list, not literals in rageScene: the director prepares it as she will yell it (loud: rage)
    const lines = RAGE_LINES.map((text) => ({ text, emotion: window.AuraSpeech?.emotionFor?.(text, { loud: true }) || "rage", loud: true }));
    // not performed (she is busy, the rant is not ready yet): nothing happened, so no apology; the next poke tries again
    if (!(await window.AuraDirector.perform("rage", rageScene, { stage: false, lines }))) return;
    say("...sorry. I lost my temper.", 2800, true);
  }
  async function rageScene(s) {
    raging = true;
    if (bubble) { bubble.classList.remove("show"); bubble.style.display = "none"; }
    const veil = document.createElement("div");
    veil.className = "av-rage-veil";
    const big = document.createElement("div");
    big.className = "av-rage-avatar";
    big.innerHTML = roamer.innerHTML;
    const text = document.createElement("div");
    text.className = "av-rage-text";
    document.body.append(veil, big, text);
    roamer.style.visibility = "hidden";
    try {
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, fill: "forwards" });
      big.animate([{ transform: "translate(-50%, -50%) scale(1)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(7.5)", opacity: 1 }], { duration: 750, easing: "cubic-bezier(.2,1.3,.4,1)", fill: "forwards" });
      await sleep(750);
      for (const line of RAGE_LINES) {
        const h = s.say(line, { loud: true, bubble: false, min: line.startsWith("...") ? 1500 : 1050 });
        h.started.then(() => { text.textContent = line; });
        await h;
      }
      text.remove();
      await big.animate([{ transform: "translate(-50%, -50%) scale(7.5)", opacity: 1 }, { transform: "translate(-50%, -50%) scale(1)", opacity: 0 }], { duration: 650, easing: "ease-in", fill: "forwards" }).finished;
      await veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, fill: "forwards" }).finished;
    } finally {
      text.remove(); big.remove(); veil.remove();
      tantrumEnd(); // gives her back: one restore path for the rage and the scenes
    }
  }

  // Scenes take over the roaming copy: hide it and the bubble, then give everything back at the end.
  function tantrumStart() {
    if (raging || !roamer) return null;
    raging = true;
    // the walk may have ended while the scene waited for the floor: then she is where her home avatar is
    const from = isVisible(roamer) ? roamer : (mounts().find((el) => el !== roamer && isVisible(el)) || roamer);
    const rect = from.getBoundingClientRect();
    if (bubble) { bubble.classList.remove("show"); bubble.style.display = "none"; }
    roamer.style.visibility = "hidden";
    return { rect, svg: roamer.innerHTML };
  }
  function tantrumEnd() {
    if (roamer) roamer.style.visibility = "";
    if (bubble) bubble.style.display = "";
    raging = false;
    pokes = [];
  }
  // "Away" mode: she has left the chat. The home avatar is greyed out and she stays quiet until she is back.
  let awayTimer = null;
  function setAway(ms) {
    document.documentElement.dataset.avatarAway = "1";
    for (const el of mounts()) if (el !== roamer) el.classList.add("av-away");
    clearTimeout(awayTimer);
    awayTimer = setTimeout(() => {
      delete document.documentElement.dataset.avatarAway;
      for (const el of mounts()) if (el !== roamer) el.classList.remove("av-away");
    }, ms);
  }
  const isAway = () => Boolean(document.documentElement.dataset.avatarAway);
  let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 };

  function onRoamerPoke() {
    if (!roamer || roamer.dataset.catching || window.AuraDirector?.isPerforming?.()) return; // a game has its own click; no pokes while she performs
    wake();
    const now = Date.now();
    pokes = pokes.filter((t) => now - t < 6000).concat(now);
    if (pokes.length >= 4) {
      const scene = window.AuraTantrums ? window.AuraTantrums.choose() : "rage";
      if (scene === "rage") rage(); else window.AuraTantrums.run(scene);
      return;
    }
    const angry = pokes.length >= 3;
    roamer.classList.remove("av-hurt");
    void roamer.offsetWidth;
    roamer.classList.add("av-hurt");
    setTimeout(() => roamer && roamer.classList.remove("av-hurt"), 600);
    act(angry ? "shake" : "worried", 900);
    const rudePoke = voice() >= 4 && window.AuraQuotes ? window.AuraQuotes.rude("poke") : null;
    say(rudePoke || pick(angry ? FURIOUS : OUCH), angry ? 3200 : 2400, true, { pain: true });
  }

  function ensureRoamer() {
    if (roamer) return roamer;
    roamer = document.createElement("div");
    roamer.className = "ai-avatar-roamer";
    roamer.setAttribute("data-ai-avatar", "");
    roamer.addEventListener("click", onRoamerPoke);
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
    if (isAway() || roaming || reducedMotion() || !origin || document.hidden || inVoiceSettings()) {
      if (text && !isAway()) say(text);
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
      r.style.pointerEvents = "";
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

  // The drawing side of a performance (avatar-director.js owns its time and voice): the roaming copy comes out, the
  // home avatar is hidden, the script gets the drawing helpers, and everything is put back afterwards. Returns false
  // when she can't perform right now. interactive: the script handles clicks on her (being carried); otherwise she
  // is not clickable while she performs.
  const canStage = () => !(isAway() || roaming || reducedMotion() || document.hidden || inVoiceSettings() || !mounts().some((el) => el !== roamer && isVisible(el)));
  async function stage(script, { interactive = false } = {}) {
    const origin = mounts().find((el) => el !== roamer && isVisible(el));
    if (!canStage() || !origin) return false;
    roaming = true;
    lastRoam = Date.now();
    const r = ensureRoamer();
    r.style.pointerEvents = interactive ? "" : "none";
    delete r.dataset.catching;
    const size = { w: 46, h: 52 };
    const centerOf = (el) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2 - size.w / 2, y: b.top + b.height / 2 - size.h / 2 }; };
    const at = (p, s = 1, rot = 0) => "translate(" + p.x + "px, " + p.y + "px) scale(" + s + ") rotate(" + rot + "deg)";
    const api = {
      el: r, size, at, sleep, act,
      home: () => centerOf(origin),
      place(p, o = {}) { r.getAnimations().forEach((a) => a.cancel()); r.style.transform = at(p, o.scale ?? 1, o.rot ?? 0); r.style.opacity = String(o.opacity ?? 1); },
      move(from, to, o = {}) {
        const mid = o.arc === false ? null : { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - (o.lift ?? 60) };
        r.classList.toggle("face-left", to.x < from.x);
        r.classList.add("walking");
        const frames = mid ? [{ transform: at(from) }, { transform: at(mid), offset: 0.5 }, { transform: at(to) }] : [{ transform: at(from) }, { transform: at(to) }];
        return r.animate(frames, { duration: o.ms ?? 1500, easing: o.easing ?? "ease-in-out", fill: "forwards" }).finished.then(() => r.classList.remove("walking"));
      },
      anim(frames, opts) { return r.animate(frames, { fill: "forwards", ...opts }).finished; },
      randomPoint(margin = 100) { return { x: margin + Math.random() * Math.max(1, innerWidth - 2 * margin - size.w), y: 90 + Math.random() * Math.max(1, innerHeight - 190 - size.h) }; }
    };
    try {
      origin.classList.add("av-away");
      r.style.display = "block";
      await script(api);
    } catch {
      // gag interrupted: fall through to cleanup
    } finally {
      r.getAnimations().forEach((a) => a.cancel());
      r.style.display = "none";
      r.style.pointerEvents = "none";
      r.style.cursor = "";
      r.style.opacity = "";
      r.style.transform = "";
      r.classList.remove("walking", "face-left", "av-overload", "av-glitching");
      origin.classList.remove("av-away");
      roaming = false;
    }
    return true;
  }

  // The eyes glance toward the cursor (throttled to animation frames).
  function trackCursor() {
    let queued = false;
    window.addEventListener("pointermove", (event) => {
      wake();
      lastPointer = { x: event.clientX, y: event.clientY };
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
    if (type === "vuln" || type === "done" || type === "error" || type === "tool-fail") markImportant();
    if (type === "thinking") {
      thinking = true; setState("think", true); thinkingSince = Date.now();
      clearTimeout(thinkingTimer);
      thinkingTimer = setTimeout(() => { if (thinking) { const q = (window.AuraQuotes ? window.AuraQuotes.get("thinking", { force: false }) : null); if (q) say(q, 4500); } }, 5000);
    }
    else if (type === "reply") {
      thinking = false; setState("think", false); clearTimeout(thinkingTimer);
      act(pick(["tilt", "wink", "sparkle"]), 1100);
      const slow = Date.now() - thinkingSince > 8000 ? (window.AuraQuotes ? window.AuraQuotes.get("slowReply", { force: true }) : null) : null;
      if (slow) say(slow, 4500);
      else if (Math.random() < 0.3) say(pick(["There you go.", "Hope that helps!", "Anything else?"]), 2600);
    } else if (type === "stage") {
      const tile = document.querySelector('#tab-flow.active .flow-hex[data-stage-id="' + detail.stageId + '"]');
      const label = detail.label || "A stage";
      const line = detail.zone === "vuln"
        ? pick([label + " done - check Vulns!", label + " finished. Let's see what turned up."])
        : pick([label + " complete!", label + " wrapped up.", "Nice, " + label + " is done."]);
      // Walk over to the tile when the Flow is on screen and we haven't wandered recently.
      const sq = (window.AuraQuotes ? window.AuraQuotes.get(""+"stage:"+detail.stageId+"", { force: false }) : null);
      const full = sq ? line + "\n" + sq : line;
      if (tile && Date.now() - lastRoam > 20000) roamTo(tile, { text: full, action: detail.zone === "vuln" ? "sparkle" : "cheer" });
      else { act("sparkle", 1100); say(full, 3600); }
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
      vulnSeen += n;
      const vq = (window.AuraQuotes ? window.AuraQuotes.get(""+(n >= 5 ? "vulnMany" : n >= 3 ? "vulnSome" : "vulnFew")+"", { force: true }) : null);
      const vfull = vq ? line + "\n" + vq : line;
      if (tile && !roaming && Date.now() - lastRoam > 6000) roamTo(tile, { text: vfull, action: "saiyan", stay: 4200 });
      else { act("saiyan", 3400); say(vfull, 4800); }
    } else if (type === "start") {
      vulnSeen = 0;
      const tier = document.getElementById("scanTier")?.value;
      const sq = (window.AuraQuotes ? window.AuraQuotes.get(""+(tier === "light" ? "startLight" : tier === "full" ? "startFull" : "start")+"", { force: true }) : null);
      act("cheer", 1100);
      say(pick(["Let's hunt!", "Scan launched - I'll watch the flow.", "Here we go.", "Engines on."]) + (sq ? "\n" + sq : ""), 4200);
    } else if (type === "tool-fail") {
      setState("think", false);
      act("worried", 2800);
      const fq = (window.AuraQuotes ? window.AuraQuotes.get(""+(/timed out/.test(text || "") ? "toolTimeout" : "toolFail")+"", { force: false }) : null);
      say((text || "A tool failed.") + (fq ? "\n" + fq : ""), 4800);
    }
    else if (type === "error") {
      thinking = false; setState("think", false); clearTimeout(thinkingTimer); act("shake", 600);
      const eq = (window.AuraQuotes ? window.AuraQuotes.get(""+(/run failed/i.test(text || "") ? "runFail" : "aiFail")+"", { force: true }) : null);
      say((text || "Hmm, that didn't work.") + (eq ? "\n" + eq : ""), 4800);
    }
    else if (type === "done") {
      thinking = false; setState("think", false);
      const hex = document.querySelector('#tab-flow.active .flow-hex[data-stage-id="recovery"]') || document.querySelector("#tab-flow.active .flow-hex");
      const dq = (window.AuraQuotes ? window.AuraQuotes.get(""+(vulnSeen > 0 ? "doneVulns" : "done")+"", { force: true }) : null);
      const dfull = (text || "Recon complete!") + (dq ? "\n" + dq : "");
      if (hex && Date.now() - lastRoam > 8000) roamTo(hex, { text: dfull, action: "cheer", stay: 3600 });
      else { act("cheer", 1900); say(dfull, 4800); }
    }
    else if (type === "say") say(text || pick(QUIPS));
  }

  function bindClick() {
    document.addEventListener("click", (event) => {
      const av = event.target.closest("[data-ai-avatar]");
      if (!av) return;
      if (av.classList.contains("ai-avatar-roamer")) return; // the roaming copy has its own reaction (pain)
      wake();
      const restore = document.getElementById("aiRestore");
      if (restore?.classList.contains("active")) restore.click(); // open the chat if minimized
      const now = Date.now();
      clicks = clicks.filter((t) => now - t < 2000).concat(now);
      if (clicks.length >= 3) { act("dizzy", 1200); { const dz = (window.AuraQuotes ? window.AuraQuotes.get("dizzy", { force: true }) : null); say(pick(["Hey, that tickles!", "Whoa, easy there!", "I'm dizzy now..."]) + (dz ? "\n" + dz : "")); } clicks = []; }
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
    // Her lines (avatar-voice.js): a bubble appears as she starts one and goes 300 ms after she has finished it.
    window.addEventListener("aura:line", (event) => {
      const d = event.detail || {};
      if (d.phase === "start" && d.bubble !== false) { bubbleLine = d.id; showBubble(String(d.text), Boolean(d.bubble && d.bubble.pain)); return; }
      if (d.phase !== "end" || d.id !== bubbleLine) return;
      clearTimeout(bubbleTimer);
      bubbleTimer = setTimeout(() => { if (bubbleLine === d.id && bubble) { bubble.classList.remove("show"); bubbleLine = 0; } }, 300);
    });
    // Entering the voice settings hushes whatever she was saying (later clicks there, like Test, are left alone).
    let wasQuiet = false;
    document.addEventListener("click", () => setTimeout(() => {
      const quiet = inVoiceSettings();
      if (quiet && !wasQuiet) { if (bubble) bubble.classList.remove("show"); window.AuraSpeech?.stop?.(); }
      wasQuiet = quiet;
    }, 0), true);
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
      setTimeout(() => { act("wink", 1300); const hq = (window.AuraQuotes ? window.AuraQuotes.get("hello", { force: true }) : null); say("Hi, I'm AURI. Ask me about the run." + (hq ? "\n" + hq : ""), 5200); }, 2200);
    }
  }

  window.AuraAvatar = { react, say, act, roamTo, stage, rage, rageLines: RAGE_LINES, tantrumStart, tantrumEnd, setAway, isAway, isQuiet: inVoiceSettings, pointer: () => lastPointer, mounts, isThinking: () => thinking, voice, isRoaming: () => roaming, canStage };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
