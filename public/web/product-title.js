"use strict";

(function initAuraProductTitle() {
  const fullName = "Asset Unveiling & Reconnaissance Automation";

  function applyTitle() {
    document.title = fullName;
    const heading = document.querySelector("header h1");
    if (heading) {
      // Wrap the name in a span so CSS can clamp it to two lines instead of cutting it off.
      let titleSpan = heading.querySelector(".header-title-text");
      if (!titleSpan) {
        titleSpan = document.createElement("span");
        titleSpan.className = "header-title-text";
        for (const node of [...heading.childNodes]) {
          if (node.nodeType === Node.TEXT_NODE) node.remove();
        }
        heading.appendChild(titleSpan);
      }
      titleSpan.textContent = fullName;
    }
    injectScript("/auth-persistence.js", "aura-auth-persistence-js");
    injectScript("/workspace-layout-current.js", "aura-workspace-layout-current-js");
    injectScript("/security-settings.js", "aura-security-settings-js");
    injectScript("/header-profile-menu.js", "aura-header-profile-menu-js");
    injectScript("/topology-fullscreen-fix.js", "aura-topology-fullscreen-fix-js");
    injectScript("/recon-status-bar.js", "aura-recon-status-bar-js");
  }

  function injectScript(src, id) {
    if (document.getElementById(id)) return;
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyTitle, { once: true });
  } else {
    applyTitle();
  }
})();
