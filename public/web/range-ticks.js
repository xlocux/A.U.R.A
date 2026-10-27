"use strict";

// Graduated sliders: every range input gets ticks and short labels under it, so levels are readable at a glance.
// Known sliders get named steps; the others get evenly spaced value labels. Sliders added later (e.g. the voice
// volume) are picked up automatically.
(function initRangeTicks() {
  const NAMED = {
    avatarVoice: ["Silent", "Quiet", "Balanced", "Chatty", "Psycho"],
    aiAutonomyLevel: ["L0", "L1", "L2", "L3", "L4"]
  };
  const FORMAT = {
    fontScale: (v) => `${v}%`,
    auriSpeechVol: (v) => `${Math.round(v * 100)}%`
  };

  function stops(input) {
    const min = Number(input.min || 0), max = Number(input.max || 100), step = Number(input.step || 1) || 1;
    const named = NAMED[input.id];
    if (named) return named.map((label, i) => ({ value: min + i, label }));
    const count = Math.round((max - min) / step) <= 8 ? Math.round((max - min) / step) + 1 : 5;
    const fmt = FORMAT[input.id] || ((v) => String(Math.round(v * 100) / 100));
    return Array.from({ length: count }, (_, i) => {
      const value = min + ((max - min) * i) / (count - 1);
      return { value, label: fmt(Math.round(value / step) * step) };
    });
  }

  function build(input) {
    if (input.dataset.ticks === "done" || input.closest(".range-ticks-skip")) return;
    input.dataset.ticks = "done";
    const min = Number(input.min || 0), max = Number(input.max || 100);
    const list = stops(input);
    const ticks = document.createElement("div");
    ticks.className = "range-ticks";
    ticks.style.setProperty("--n", String(Math.max(1, list.length - 1)));
    for (const s of list) {
      const t = document.createElement("span");
      t.dataset.v = String(s.value);
      t.textContent = s.label;
      t.style.left = `${((s.value - min) / Math.max(1e-9, max - min)) * 100}%`;
      t.addEventListener("click", () => {
        input.value = String(s.value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      ticks.append(t);
    }
    input.after(ticks);
    const sync = () => {
      const v = Number(input.value);
      let best = null;
      for (const t of ticks.children) { const d = Math.abs(Number(t.dataset.v) - v); if (!best || d < best.d) best = { t, d }; }
      for (const t of ticks.children) t.classList.toggle("on", best && t === best.t);
    };
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    setInterval(sync, 800); // values are also set from code (saved settings)
    sync();
  }

  const scan = () => document.querySelectorAll('input[type="range"]').forEach(build);
  function boot() {
    scan();
    new MutationObserver(() => scan()).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
