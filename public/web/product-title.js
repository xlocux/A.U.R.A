"use strict";

(function initAuraProductTitle() {
  const fullName = "A.U.R.A - Asset Unveiling & Reconnaissance Automation";

  function applyTitle() {
    document.title = fullName;
    const heading = document.querySelector("header h1");
    if (heading) heading.textContent = fullName;
    injectScript("/auth-persistence.js", "aura-auth-persistence-js");
    injectScript("/workspace-layout-current.js", "aura-workspace-layout-current-js");
    injectScript("/security-settings.js", "aura-security-settings-js");
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
