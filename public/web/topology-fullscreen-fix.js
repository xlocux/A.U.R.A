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
      openButton.textContent = "Fullscreen";
      actions?.appendChild(openButton);
    }
    if (!document.getElementById("topologyFullscreenClose")) {
      const closeButton = document.createElement("button");
      closeButton.id = "topologyFullscreenClose";
      closeButton.type = "button";
      closeButton.className = "topology-fullscreen-close";
      closeButton.textContent = "Close";
      main.appendChild(closeButton);
    }
    return true;
  }

  function bindControls() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("#topologyFullscreen")) {
        event.preventDefault();
        event.stopPropagation();
        openFullscreen();
        return;
      }
      if (event.target.closest("#topologyFullscreenClose")) {
        event.preventDefault();
        event.stopPropagation();
        closeFullscreen();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeFullscreen();
    });
  }

  function openFullscreen() {
    ensureControls();
    document.body.classList.add("topology-fullscreen-mode");
    rerenderTopology();
  }

  function closeFullscreen() {
    document.body.classList.remove("topology-fullscreen-mode");
    rerenderTopology();
  }

  function rerenderTopology() {
    window.dispatchEvent(new Event("resize"));
    setTimeout(() => window.AuraTopology?.render?.(), 80);
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
      body.topology-fullscreen-mode .topology-main { position: fixed !important; inset: 0 !important; z-index: 9998 !important; display: grid !important; grid-template-rows: auto auto minmax(0, 1fr) !important; width: 100vw !important; height: 100dvh !important; max-width: none !important; max-height: none !important; margin: 0 !important; padding: 12px !important; border-radius: 0 !important; background: rgba(5, 7, 11, .99) !important; border: 0 !important; box-shadow: none !important; overflow: hidden !important; }
      body.topology-fullscreen-mode .topology-head { min-height: 48px !important; padding-right: 112px !important; }
      body.topology-fullscreen-mode .topology-smartbar { align-items: center !important; min-height: 48px !important; }
      body.topology-fullscreen-mode #topologyResetSmart { width: auto !important; min-width: max-content !important; min-height: 34px !important; max-height: 34px !important; align-self: center !important; justify-self: end !important; padding: 0 12px !important; }
      body.topology-fullscreen-mode #topologyCanvas { display: block !important; width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important; max-width: 100% !important; max-height: calc(100dvh - 72px) !important; }
      .topology-fullscreen-close { display: none; }
      body.topology-fullscreen-mode #topologyFullscreenClose { display: inline-flex !important; position: fixed !important; top: 14px !important; right: 14px !important; left: auto !important; bottom: auto !important; z-index: 10060 !important; width: auto !important; min-width: 86px !important; min-height: 36px !important; align-items: center !important; justify-content: center !important; margin: 0 !important; padding: 0 14px !important; border: 1px solid var(--vercel-line-strong, var(--line)) !important; border-radius: 8px !important; color: #ffffff !important; background: #18181b !important; box-shadow: 0 12px 30px rgba(0,0,0,.45) !important; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
