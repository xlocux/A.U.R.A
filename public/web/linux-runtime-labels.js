"use strict";

(function initLinuxRuntimeLabels() {
  const replacements = [
    ["WSL distro", "Linux runtime"],
    ["WSL/Kali tools", "Linux tools"],
    ["Use WSL/Kali", "Use Linux tool runner"],
    ["Proxy settings are stored locally in this browser and applied to WSL recon tool runs.", "Proxy settings are stored locally in this browser and applied to Linux recon tool runs."]
  ];

  function replaceText(node) {
    if (!node || !node.nodeValue) return;
    let value = node.nodeValue;
    for (const [from, to] of replacements) {
      value = value.replaceAll(from, to);
    }
    node.nodeValue = value;
  }

  function applyLabels() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(replaceText);

    const distro = document.getElementById("distro");
    if (distro) {
      distro.value = "linux";
      distro.disabled = true;
      distro.title = "A.U.R.A runs recon tools on the local Linux host.";
    }
    const setupDistro = document.getElementById("setupDistro");
    if (setupDistro) {
      setupDistro.value = "linux";
      setupDistro.disabled = true;
      setupDistro.title = "A.U.R.A checks and installs tools on the local Linux host.";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyLabels, { once: true });
  } else {
    applyLabels();
  }
})();
