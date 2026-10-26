"use strict";

// Graduated sliders: a tick and a short label under every step so the levels are readable at a glance.
(function initRangeTicks() {
  const SLIDERS = {
    avatarVoice: ["Silent", "Quiet", "Balanced", "Chatty", "Psycho"],
    aiAutonomyLevel: ["L0", "L1", "L2", "L3", "L4"]
  };
  function build(id, labels) {
    const input = document.getElementById(id);
    if (!input || input.nextElementSibling?.classList.contains("range-ticks")) return;
    const min = Number(input.min || 0), max = Number(input.max || labels.length - 1);
    const ticks = document.createElement("div");
    ticks.className = "range-ticks";
    for (let v = min; v <= max; v += 1) {
      const t = document.createElement("span");
      t.dataset.v = String(v);
      t.style.left = ((v - min) / Math.max(1, max - min)) * 100 + "%";
      t.textContent = labels[v - min] || String(v);
      t.addEventListener("click", () => { input.value = String(v); input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); });
      ticks.append(t);
    }
    input.after(ticks);
    const sync = () => ticks.querySelectorAll("span").forEach((t) => t.classList.toggle("on", Number(t.dataset.v) === Number(input.value)));
    input.addEventListener("input", sync);
    input.addEventListener("change", sync);
    new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ["value"] });
    setInterval(sync, 800); // values are also set from code (saved settings)
    sync();
  }
  function boot() { for (const [id, labels] of Object.entries(SLIDERS)) build(id, labels); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
