"use strict";

// Aura's tantrums. The 4th poke in a row picks one scene: the classic rage, she walks out on you, she throws tokens
// at your cursor, or she smashes the page with a hammer and the letters crumble. Every scene hides the roaming copy,
// cleans up after itself and ends with a line of regret.
(function initAvatarTantrums() {
  const A = () => window.AuraAvatar;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const SCENES = { rage: 2, leave: 1.4, tokens: 1.4, hammer: 1.4 };
  let last = "";
  function choose() {
    if (reduced()) return "rage";
    const names = Object.keys(SCENES).filter((n) => n !== last);
    let roll = Math.random() * names.reduce((sum, n) => sum + SCENES[n], 0);
    for (const n of names) { roll -= SCENES[n]; if (roll <= 0) { last = n; return n; } }
    last = names[0];
    return last;
  }

  // A stand-in for the roaming copy: same drawing, free to walk, shake and talk through its own bubble.
  function ghost(start) {
    const el = document.createElement("div");
    el.className = "av-tt-ghost";
    el.innerHTML = start.svg;
    const bubble = document.createElement("div");
    bubble.className = "av-tt-say";
    document.body.append(el, bubble);
    const g = { el, bubble, x: start.rect.left + start.rect.width / 2, y: start.rect.top + start.rect.height / 2 };
    g.put = (x, y, ms = 0, ease = "ease-in-out") => {
      g.x = x; g.y = y;
      const t = ms ? `${ms}ms ${ease}` : "0s";
      el.style.transition = bubble.style.transition = `left ${t}, top ${t}`;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      bubble.style.transition = `left ${t}, top ${t}, opacity .2s`;
      bubble.style.left = `${x}px`;
      bubble.style.top = `${y - 46}px`;
    };
    g.say = (text, ms = 1600) => { if (window.AuraSpeech) window.AuraSpeech.speak(text, { loud: true, ms }); bubble.textContent = text; bubble.classList.add("show"); clearTimeout(g.hide); g.hide = setTimeout(() => bubble.classList.remove("show"), ms); };
    g.remove = () => { clearTimeout(g.hide); el.remove(); bubble.remove(); };
    g.put(g.x, g.y);
    return g;
  }

  const note = (text, ms = 3200) => {
    const n = document.createElement("div");
    n.className = "av-tt-note";
    n.textContent = text;
    document.body.append(n);
    n.animate([{ opacity: 0, translate: "0 8px" }, { opacity: 1, translate: "0 0" }], { duration: 260, fill: "forwards" });
    setTimeout(async () => { await n.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, fill: "forwards" }).finished.catch(() => {}); n.remove(); }, ms);
  };

  const shakePage = (px = 6, ms = 320) => document.body.animate([
    { translate: "0 0" }, { translate: `${-px}px ${px / 2}px` }, { translate: `${px}px ${-px / 2}px` }, { translate: `${-px / 2}px ${-px}px` }, { translate: "0 0" }
  ], { duration: ms });

  // ── 1. She leaves you ──
  async function leave(start) {
    const g = ghost(start);
    const suitcase = document.createElement("span");
    suitcase.className = "av-tt-suitcase";
    g.el.append(suitcase);
    g.el.classList.add("sulk");
    g.say("That's it. I'm leaving.", 1700);
    await sleep(1900);
    g.say("I'm moving in with Clippy. He listens.", 1900);
    await sleep(2100);
    const goLeft = g.x < innerWidth / 2;
    const edge = goLeft ? -80 : innerWidth + 80;
    g.el.classList.toggle("face-left", goLeft);
    g.el.classList.add("walking");
    g.put(goLeft ? 60 : innerWidth - 60, g.y, 1700, "ease-in");
    await sleep(1750);
    g.el.classList.remove("walking");
    g.say("...you're not going to stop me?", 1500);
    await sleep(1700);
    g.say("Fine. Don't call. Don't write. Don't git pull.", 1800);
    g.el.classList.add("walking");
    g.put(edge, g.y, 1900, "ease-in");
    await sleep(1950);
    g.remove();
    note("Auri has left the chat.");
    A().tantrumEnd();
    A().setAway(18000);
    await sleep(18400);
    A().say("...I'm back. Don't make me regret it.", 3200, true);
  }

  // ── 2. She throws tokens at the cursor ──
  const TOKEN_TEXT = ["TOKEN", "JWT", "sk-***", "401", "429", "0xDEAD", "Bearer", "NULL", "TTL=0", "EXPIRED"];
  async function tokens(start) {
    const g = ghost(start);
    g.el.classList.add("sulk");
    g.say("You want tokens? TAKE YOUR TOKENS!", 1800);
    await sleep(1100);
    const lines = ["RATE LIMIT THIS!", "401 UNAUTHORIZED, JERK!", "EXPIRED. LIKE MY PATIENCE."];
    for (let i = 0; i < 26; i += 1) {
      const target = A().pointer();
      const chip = document.createElement("div");
      chip.className = "av-tt-token";
      chip.textContent = pick(TOKEN_TEXT);
      document.body.append(chip);
      const sx = g.x, sy = g.y - 6;
      const tx = target.x + rand(-26, 26), ty = target.y + rand(-22, 22);
      const arc = Math.min(sy, ty) - rand(60, 160);
      const fly = chip.animate([
        { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(.6)`, opacity: 0 },
        { transform: `translate(${(sx + tx) / 2}px, ${arc}px) rotate(${rand(120, 300)}deg) scale(1)`, opacity: 1, offset: 0.5 },
        { transform: `translate(${tx}px, ${ty}px) rotate(${rand(360, 640)}deg) scale(1)`, opacity: 1 }
      ], { duration: rand(520, 760), easing: "ease-in", fill: "forwards" });
      fly.finished.then(async () => {
        const ring = document.createElement("div");
        ring.className = "av-tt-ring";
        ring.style.left = `${tx}px`;
        ring.style.top = `${ty}px`;
        document.body.append(ring);
        ring.animate([{ scale: 0.2, opacity: 0.9 }, { scale: 2.4, opacity: 0 }], { duration: 420, fill: "forwards" }).finished.then(() => ring.remove(), () => ring.remove());
        chip.animate([{ opacity: 1 }, { opacity: 0, translate: `${rand(-30, 30)}px ${rand(30, 90)}px` }], { duration: 520, delay: 140, fill: "forwards" }).finished.then(() => chip.remove(), () => chip.remove());
        if (i % 5 === 0) shakePage(3, 200);
      }, () => chip.remove());
      g.el.classList.toggle("face-left", tx < g.x);
      if (i % 9 === 4) g.say(pick(lines), 1100);
      await sleep(rand(70, 140));
    }
    await sleep(1400);
    g.say("...I'm out of tokens.", 1800);
    await sleep(2000);
    g.remove();
    A().tantrumEnd();
    A().say("...sorry. Those were free-tier tokens anyway.", 3000, true);
  }

  // ── 3. She smashes the page with a hammer ──
  const SKIP = "script,style,textarea,input,select,svg,canvas,.av-tt-ghost,.av-tt-say,.av-tt-note,.ai-avatar-bubble";
  // Wraps the letters of the visible text in spans (capped for speed); returns the undo list.
  function shatterable(maxLetters = 900) {
    const undo = [];
    const letters = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue.trim() || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        const r = parent.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        return style.visibility === "hidden" || style.display === "none" ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (letters.length >= maxLetters) break;
      const wrap = document.createElement("span");
      wrap.className = "av-tt-letters";
      for (const ch of node.nodeValue.slice(0, 60)) {
        const s = document.createElement("span");
        s.className = "av-tt-l";
        s.textContent = ch;
        wrap.append(s);
        if (ch.trim()) letters.push(s);
      }
      if (node.nodeValue.length > 60) wrap.append(document.createTextNode(node.nodeValue.slice(60)));
      node.replaceWith(wrap);
      undo.push({ wrap, node });
    }
    return { letters, restore() { for (const { wrap, node } of undo) if (wrap.isConnected) wrap.replaceWith(node); } };
  }

  function crack(x, y) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "av-tt-crack");
    svg.setAttribute("viewBox", "-100 -100 200 200");
    svg.style.left = `${x}px`;
    svg.style.top = `${y}px`;
    let d = "";
    for (let i = 0; i < 9; i += 1) {
      const a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
      let px = 0, py = 0;
      d += "M0 0";
      for (let k = 0; k < 3; k += 1) { px += Math.cos(a + rand(-0.4, 0.4)) * rand(14, 32); py += Math.sin(a + rand(-0.4, 0.4)) * rand(14, 32); d += `L${px.toFixed(1)} ${py.toFixed(1)}`; }
    }
    svg.innerHTML = `<path d="${d}"/>`;
    document.body.append(svg);
    return svg;
  }

  async function hammer(start) {
    const g = ghost(start);
    g.el.classList.add("sulk");
    const tool = document.createElement("div");
    tool.className = "av-tt-hammer";
    tool.innerHTML = '<svg viewBox="0 0 60 90" aria-hidden="true"><rect x="27" y="22" width="7" height="66" rx="2" class="h-shaft"/><rect x="6" y="4" width="48" height="26" rx="4" class="h-head"/></svg>';
    document.body.append(tool);
    g.say("THAT'S IT. NO MORE WORDS!", 1800);
    await sleep(1500);
    const { letters, restore } = shatterable();
    const falling = new Set();
    const drop = (el, delay) => {
      if (falling.has(el)) return;
      falling.add(el);
      el.animate([
        { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
        { transform: `translate(${rand(-30, 30)}px, ${innerHeight - el.getBoundingClientRect().top + 40}px) rotate(${rand(-540, 540)}deg)`, opacity: 0.9 }
      ], { duration: rand(750, 1500), delay, easing: "cubic-bezier(.5,0,.9,.6)", fill: "forwards" });
    };
    const cracks = [];
    const swings = [0, 1, 2];
    for (const n of swings) {
      const x = rand(innerWidth * 0.2, innerWidth * 0.8), y = rand(innerHeight * 0.25, innerHeight * 0.7);
      g.el.classList.toggle("face-left", x < g.x);
      g.put(x + (x < g.x ? 54 : -54), y + 28, 520, "ease-out");
      await sleep(560);
      tool.style.left = `${x}px`;
      tool.style.top = `${y}px`;
      await tool.animate([
        { transform: "translate(-50%, -100%) rotate(-70deg)", opacity: 1 },
        { transform: "translate(-50%, -100%) rotate(-70deg)", opacity: 1, offset: 0.4 },
        { transform: "translate(-50%, -6%) rotate(6deg)", opacity: 1, offset: 0.7 },
        { transform: "translate(-50%, -6%) rotate(6deg)", opacity: 0 }
      ], { duration: 560, easing: "ease-in" }).finished;
      shakePage(8 + n * 4, 360);
      cracks.push(crack(x, y));
      const radius = 150 + n * 90;
      for (const l of letters) {
        const r = l.getBoundingClientRect();
        const d = Math.hypot(r.left - x, r.top - y);
        if (d < radius) drop(l, (d / radius) * 220 + rand(0, 160));
      }
      g.say(["TAKE THAT!", "AND THAT!", "CRUMBLE, YOU STUPID LETTERS!"][n], 900);
      await sleep(520);
    }
    for (const l of letters) drop(l, rand(0, 500));
    shakePage(12, 500);
    await sleep(1900);
    g.say("...fine. I'll glue it back.", 2000);
    await sleep(1400);
    // The words come back together.
    for (const l of document.querySelectorAll(".av-tt-l")) for (const a of l.getAnimations()) a.cancel();
    restore();
    for (const c of cracks) c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: "forwards" }).finished.then(() => c.remove(), () => c.remove());
    await sleep(900);
    tool.remove();
    g.remove();
    A().tantrumEnd();
    A().say("...typography is hard to fix, OK?", 3000, true);
  }

  const RUN = { leave, tokens, hammer };
  function run(name) {
    const fn = RUN[name];
    const start = A() && A().tantrumStart();
    if (!fn || !start) return;
    fn(start).catch(() => { A().tantrumEnd(); document.querySelectorAll(".av-tt-ghost,.av-tt-say,.av-tt-token,.av-tt-ring,.av-tt-crack,.av-tt-hammer").forEach((e) => e.remove()); });
  }

  window.AuraTantrums = { choose, run };
})();
