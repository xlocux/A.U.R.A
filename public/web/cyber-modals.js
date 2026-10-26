"use strict";

// Gives every modal in the app the same cyber look and open/close effects without editing each one:
// - OPEN  (modal loses .hidden)  -> signal interference (jitter, RGB split, static)
// - CLOSE (modal gains .hidden)  -> we keep it visible for a "signal lost" collapse, then really hide it
// The styling itself is theme-aware CSS (cyber-ui.css). The Flow stage modal has its own equivalent logic.
(function initCyberModals() {
  const MODALS = [
    { modal: ".aura-viewer-modal", dialog: ".aura-viewer" },
    { modal: ".results-fullscreen-modal", dialog: ".results-fullscreen-dialog" },
    { modal: ".aura-dialog-modal", dialog: ".aura-dialog" },
    { modal: ".project-inspector-modal", dialog: ".project-inspector-dialog" },
    { modal: ".proxy-import-modal", dialog: ".proxy-import-dialog" },
    { modal: ".tools-modal", dialog: ".tools-dialog" },
    { modal: ".topology-node-modal", dialog: ".topology-node-dialog" }
  ];
  const BOOT_MS = 780;
  const CLOSE_MS = 700;
  const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function decorate(dialog) {
    if (dialog.dataset.fxReady) return;
    dialog.dataset.fxReady = "true";
    dialog.classList.add("fx-dialog");
    // Corners/noise are absolutely positioned inside the dialog, so it must establish a containing block
    // (but never override a dialog that is already fixed/absolute).
    if (getComputedStyle(dialog).position === "static") dialog.style.position = "relative";
    dialog.insertAdjacentHTML("beforeend",
      '<span class="fx-corner tl"></span><span class="fx-corner tr"></span><span class="fx-corner bl"></span><span class="fx-corner br"></span>' +
      '<div class="fx-noise"></div><div class="fx-lost"><b>SIGNAL LOST</b><small>link terminated</small></div>');
  }

  function adopt(modal, dialogSelector) {
    if (modal._fx) return;
    const dialog = modal.querySelector(dialogSelector);
    if (!dialog) return;
    const state = { wasHidden: modal.classList.contains("hidden"), closeTimer: null, observer: null };
    modal._fx = state;
    modal.classList.add("fx-modal");
    decorate(dialog);
    state.observer = new MutationObserver(() => onClassChange(modal));
    state.observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
    // The modal may already be visible when we adopt it (created and shown in the same tick).
    if (!state.wasHidden) boot(modal);
  }

  function boot(modal) {
    modal.classList.remove("fx-closing");
    if (reduced()) return;
    modal.classList.add("fx-booting");
    setTimeout(() => modal.classList.remove("fx-booting"), BOOT_MS);
  }

  function onClassChange(modal) {
    const state = modal._fx;
    const hidden = modal.classList.contains("hidden");
    if (hidden === state.wasHidden) return;
    if (!hidden) {
      // Opened (by the modal's own code): play the interference burst.
      state.wasHidden = false;
      clearTimeout(state.closeTimer);
      boot(modal);
      return;
    }
    // Closing was requested. Show "signal lost" first, then hide for real.
    state.wasHidden = true;
    if (reduced()) return;
    modal.classList.remove("hidden", "fx-booting");
    modal.classList.add("fx-closing");
    state.observer.takeRecords(); // our own class edit must not be seen as an open
    clearTimeout(state.closeTimer);
    state.closeTimer = setTimeout(() => {
      modal.classList.remove("fx-closing");
      modal.classList.add("hidden");
      state.observer.takeRecords();
    }, CLOSE_MS);
  }

  function scan() {
    for (const { modal, dialog } of MODALS) {
      document.querySelectorAll(modal).forEach((node) => adopt(node, dialog));
    }
  }

  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  }

  function boot0() {
    scan();
    // Most modals are created lazily on first use, so keep watching for them.
    new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true });
  }

  // Same interference / signal-lost effects for fullscreen views that are not modals (topology, flow...).
  // enter(el): play the interference burst. exit(el, done): play "signal lost", then call done().
  function prepFx(el) {
    if (el._fxPrepared) return;
    el._fxPrepared = true;
    el.classList.add("fx-target");
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    el.insertAdjacentHTML("beforeend", '<div class="fx-noise"></div><div class="fx-lost"><b>SIGNAL LOST</b><small>link terminated</small></div>');
  }
  window.AuraFx = {
    enter(el) {
      if (!el || reduced()) return;
      prepFx(el);
      el.classList.remove("fx-out");
      el.classList.add("fx-in");
      setTimeout(() => el.classList.remove("fx-in"), BOOT_MS);
    },
    exit(el, done) {
      if (!el || reduced()) { if (done) done(); return; }
      prepFx(el);
      el.classList.remove("fx-in");
      el.classList.add("fx-out");
      setTimeout(() => { el.classList.remove("fx-out"); if (done) done(); }, CLOSE_MS);
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot0, { once: true });
  else boot0();
})();
