"use strict";

(function initLinuxRuntimeLabels() {
  const replacements = new Map([
    ["WSL distro", "Linux runtime"],
    ["WSL/Kali tools", "Linux tools"],
    ["Use WSL/Kali", "Use Linux tool runner"]
  ]);

  function replaceText(node) {
    if (!node || !node.childNodes) return;
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        let value = child.textContent;
        for (const [from, to] of replacements) value = value.replaceAll(from, to);
        child.textContent = value;
      } else {
        replaceText(child);
      }
    }
  }

  function apply() {
    replaceText(document.body);
    const setup = document.getElementById("setupDistro");
    if (setup) setup.value = "linux";
    const distro = document.getElementById("distro");
    if (distro) distro.value = "linux";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
})();
