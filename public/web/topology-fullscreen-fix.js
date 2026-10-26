"use strict";

(function initAuraTopologyFullscreenFix() {
  function boot() {
    injectStyles();
    ensureControls();
    bindControls();
  }

  function ensureControls() {
    const topology = document.getElementById("tab-topology");
    const main = topology?.querySelector(".topology-main");
    const actions = topology?.querySelector(".topology-actions");
    if (!topology || !main) return false;
    if (!document.getElementById("topologyFullscreen")) {
      const openButton = document.createElement("button");
      openButton.id = "topologyFullscreen";
      openButton.type = "button";
      openButton.className = "icon-btn";
      openButton.title = "Fullscreen";
      openButton.setAttribute("aria-label", "Fullscreen");
      openButton.innerHTML = window.AuraIcons ? window.AuraIcons.expand : "";
      actions?.appendChild(openButton);
    }
    document.getElementById("topologyFullscreenClose")?.remove(); // the fullscreen button toggles back, no Close needed
    return true;
  }

  function bindControls() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("#topologyFullscreen")) {
        event.preventDefault();
        event.stopPropagation();
        if (document.body.classList.contains("topology-fullscreen-mode")) closeFullscreen(); else openFullscreen();
        return;
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeFullscreen();
    });
  }

  function openFullscreen() {
    ensureControls();
    document.body.classList.add("topology-fullscreen-mode");
    window.AuraFx?.enter(document.querySelector("#tab-topology .topology-main"));
    syncIcon();
    rerenderTopology();
  }

  function closeFullscreen() {
    if (!document.body.classList.contains("topology-fullscreen-mode")) return;
    const finish = () => { document.body.classList.remove("topology-fullscreen-mode"); syncIcon(); rerenderTopology(); };
    const main = document.querySelector("#tab-topology .topology-main");
    if (window.AuraFx && main) window.AuraFx.exit(main, finish); else finish();
  }

  // The one fullscreen button swaps between "enter" and "exit" icons.
  function syncIcon() {
    const button = document.getElementById("topologyFullscreen");
    if (!button || !window.AuraIcons) return;
    const full = document.body.classList.contains("topology-fullscreen-mode");
    button.innerHTML = full ? window.AuraIcons.collapse : window.AuraIcons.expand;
    button.title = full ? "Exit fullscreen" : "Fullscreen";
    button.setAttribute("aria-label", button.title);
  }

  function rerenderTopology() {
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => { if (window.AuraTopology?.fit) window.AuraTopology.fit(); else window.AuraTopology?.render?.(); }, 120);
  }

  function injectStyles() {
    if (document.getElementById("aura-topology-fullscreen-fix-style")) return;
    const style = document.createElement("style");
    style.id = "aura-topology-fullscreen-fix-style";
    style.textContent = `
      body.topology-fullscreen-mode { overflow: hidden !important; }
      body.topology-fullscreen-mode header,
      body.topology-fullscreen-mode #workspaceNav,
      body.topology-fullscreen-mode .topology-side,
      body.topology-fullscreen-mode .topology-view-tabs { display: none !important; }
      body.topology-fullscreen-mode .workspace,
      body.topology-fullscreen-mode .workspace-main,
      body.topology-fullscreen-mode #tab-topology,
      body.topology-fullscreen-mode .topology-shell { position: static !important; width: 100vw !important; max-width: none !important; height: 100dvh !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      body.topology-fullscreen-mode .topology-main { position: fixed !important; inset: 0 !important; z-index: 9998 !important; display: grid !important; grid-template-rows: auto auto minmax(0, 1fr) !important; width: 100vw !important; height: 100dvh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 12px !important; border-radius: 0 !important; background: color-mix(in srgb, var(--bg) 62%, transparent) !important; border: 0 !important; box-shadow: none !important; overflow: hidden !important; }
      body.topology-fullscreen-mode .topology-head { min-height: 48px !important; padding-right: 12px !important; }
      body.topology-fullscreen-mode .topology-smartbar { align-items: center !important; min-height: 48px !important; }
      body.topology-fullscreen-mode #topologyResetSmart { width: auto !important; min-width: max-content !important; min-height: 34px !important; max-height: 34px !important; align-self: center !important; justify-self: end !important; padding: 0 12px !important; }
      body.topology-fullscreen-mode #topologyCanvas { display: block !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; max-width: 100% !important; max-height: calc(100dvh - 72px) !important; }
      #topologyFullscreen svg { width: 16px; height: 16px; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
