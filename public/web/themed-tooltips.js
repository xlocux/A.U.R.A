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
    renderTip(node, text);
    // Restart the "decode" reveal each time a tooltip opens.
    node.classList.remove("hidden", "reveal");
    void node.offsetWidth;
    node.classList.add("reveal");
    position(el);
  }

  // Multi-line text: first line is the title; "Runs: <cmd>" lines render as a command readout.
  function renderTip(node, text) {
    node.textContent = "";
    const lines = String(text).split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length < 2) { node.textContent = lines[0] || ""; node.classList.remove("rich"); return; }
    node.classList.add("rich");
    const title = document.createElement("b");
    title.className = "aura-tip-title";
    title.textContent = lines[0];
    node.appendChild(title);
    for (const line of lines.slice(1)) {
      const row = document.createElement("span");
      row.className = /^runs:/i.test(line) ? "aura-tip-cmd" : "aura-tip-line";
      row.textContent = line.replace(/^runs:\s*/i, "");
      node.appendChild(row);
    }
  }

  function hide() {
    activeEl = null;
    if (tip) tip.classList.add("hidden");
  }

  document.addEventListener("mouseover", (event) => {
    const el = event.target.closest("[title], [data-tooltip]");
    if (!el) return;
    clearTimeout(hideTimer);
    if (el !== activeEl) show(el);
  });
  // Hide with a short grace period, and only when the pointer really leaves the target (moving between its
  // children fires mouseout too, which used to make the tooltip flicker near edges).
  let hideTimer = null;
  document.addEventListener("mouseout", (event) => {
    const el = event.target.closest("[title], [data-tooltip]");
    if (!el || el !== activeEl) return;
    if (event.relatedTarget && el.contains(event.relatedTarget)) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (activeEl === el) hide(); }, 70);
  });
  document.addEventListener("focusin", (event) => {
    const el = event.target.closest?.("[title], [data-tooltip]");
    if (el) show(el);
  });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, true);
  document.addEventListener("click", hide, true);
})();
