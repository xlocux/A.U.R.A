"use strict";

(function initAuraProductTitle() {
  const fullName = "A.U.R.A - Asset Unveiling & Reconnaissance Automation";

  function applyTitle() {
    document.title = fullName;
    const heading = document.querySelector("header h1");
    if (heading) heading.textContent = fullName;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyTitle, { once: true });
  } else {
    applyTitle();
  }
})();
