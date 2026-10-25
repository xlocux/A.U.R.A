"use strict";

// Themed tooltips: replaces the OS-native title bubble (which ignores the UI theme) with a single
// floating element styled by the app. Works for any element with a `title` or `data-tooltip`
// attribute, including dynamically-rendered content (delegated on mouseover).
(function initAuraTooltips() {
  let tip = null;
  let activeEl = null;

  function ensureTip() {
    if (tip) return tip;
    tip = document.createElement("div");
    tip.id = "auraTooltip";
    tip.className = "aura-tooltip hidden";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    return tip;
  }

  function textFor(el) {
    // Move a native title onto data-tooltip once so the browser never shows its own bubble.
    if (el.hasAttribute("title")) {
      const value = el.getAttribute("title");
      if (value) el.dataset.tooltip = value;
      el.removeAttribute("title");
    }
    return el.dataset.tooltip || "";
  }

  function position(el) {
    const rect = el.getBoundingClientRect();
    const node = ensureTip();
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.top - height - 10;
    node.classList.toggle("below", top < 8);
    if (top < 8) top = rect.bottom + 10;
    node.style.left = `${Math.round(left)}px`;
    node.style.top = `${Math.round(top)}px`;
  }

  function show(el) {
    const text = textFor(el);
    if (!text) return;
    activeEl = el;
    const node = ensureTip();
    node.textContent = text;
    node.classList.remove("hidden");
    position(el);
  }

  function hide() {
    activeEl = null;
    if (tip) tip.classList.add("hidden");
  }

  document.addEventListener("mouseover", (event) => {
    const el = event.target.closest("[title], [data-tooltip]");
    if (el && el !== activeEl) show(el);
  });
  document.addEventListener("mouseout", (event) => {
    const el = event.target.closest("[title], [data-tooltip]");
    if (el && el === activeEl) hide();
  });
  document.addEventListener("focusin", (event) => {
    const el = event.target.closest?.("[title], [data-tooltip]");
    if (el) show(el);
  });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, true);
  document.addEventListener("click", hide, true);
})();
