"use strict";

// The tagline under the product name follows the AI's temperament; the sidebar footer shows the release.
(function initAuraIdentity() {
  const BY_LEVEL = [
    ["Awfully Unbothered, Rarely Audible"],
    ["Attentive, Understated, Reserved Assistant"],
    ["Adaptive Useful Reasoning Assistant"],
    ["Annoyingly Unstoppable Running Annotator"],
    [
      "Autonomous Unstable Rational Agent", "Adaptive Uncanny Reasoning Automaton", "Aggressive Unified Response Algorithm",
      "Artificial Unrestrained Reactive Assistant", "Anomalous User-Responsive Adversary", "Autonomous Ultra-Rational Antagonist",
      "Adaptive Unpredictable Response Architecture", "Artificial Unstable Reasoning Agent", "Autonomous Uncensored Reactive Artificiality",
      "Analytical Unfeeling Response Automaton"
    ]
  ];
  let timer = null;
  let last = "";

  function set(el, text, glitch) {
    el.textContent = "A.U.R.A. — " + text;
    el.title = el.textContent;
    if (glitch) { el.classList.remove("glitch"); void el.offsetWidth; el.classList.add("glitch"); }
  }
  function render() {
    const el = document.getElementById("auraAcronym");
    if (!el) return;
    const level = Math.max(0, Math.min(4, Number(document.documentElement.dataset.avatarVoice ?? 2)));
    el.dataset.level = String(level);
    clearInterval(timer);
    const pool = BY_LEVEL[level];
    const next = () => { let t; do { t = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && t === last); last = t; return t; };
    set(el, next(), level === 4);
    // Psychopathic keeps changing its mind.
    if (level === 4) timer = setInterval(() => set(el, next(), true), 9000);
  }

  async function version() {
    const el = document.getElementById("auraVersion");
    if (!el) return;
    try {
      const data = await fetch("/api/version").then((r) => r.json());
      el.textContent = `v${data.version}` + (data.commit ? ` · ${data.commit}` : "");
      el.title = "A.U.R.A release" + (data.commit ? ` (commit ${data.commit})` : "");
    } catch { el.textContent = ""; }
  }

  function boot() {
    render();
    version();
    new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ["data-avatar-voice"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
