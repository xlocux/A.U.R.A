"use strict";

(function initAuraProductTitle() {
  const fullName = "A.U.R.A - Asset Unveiling & Reconnaissance Automation";

  function applyTitle() {
    document.title = fullName;
    const heading = document.querySelector("header h1");
    if (heading) {
      const textNode = [...heading.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode) textNode.textContent = fullName;
      else heading.append(document.createTextNode(fullName));
    }
    injectScript("/auth-persistence.js", "aura-auth-persistence-js");
    injectScript("/workspace-layout-current.js", "aura-workspace-layout-current-js");
    injectScript("/security-settings.js", "aura-security-settings-js");
    injectScript("/header-profile-menu.js", "aura-header-profile-menu-js");
    injectScript("/topology-fullscreen-fix.js", "aura-topology-fullscreen-fix-js");
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
