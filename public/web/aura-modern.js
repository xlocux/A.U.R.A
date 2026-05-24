"use strict";

(function initAuraModernThemeExtension() {
  const STORAGE_KEY = "aura.uiSettings";
  const LIGHT_FLAG = "aura.lightThemeEnabled";

  function getSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveSettings(next) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...getSettings(), ...next }));
  }

  function ensureLightOption() {
    const select = document.getElementById("themeSelect");
    if (!select || select.querySelector('option[value="light"]')) return;
    const option = document.createElement("option");
    option.value = "light";
    option.textContent = "Light Mode";
    select.appendChild(option);
  }

  function applyLightTheme() {
    const select = document.getElementById("themeSelect");
    ensureLightOption();
    document.documentElement.dataset.theme = "light";
    if (select) select.value = "light";
    localStorage.setItem(LIGHT_FLAG, "1");
    saveSettings({ theme: "light" });
    window.dispatchEvent(new CustomEvent("aura:appearance-change"));
  }

  function clearLightFlag() {
    localStorage.removeItem(LIGHT_FLAG);
  }

  function bindLightTheme() {
    const select = document.getElementById("themeSelect");
    if (!select || select.dataset.lightExtensionBound === "true") return;
    select.dataset.lightExtensionBound = "true";
    ensureLightOption();
    select.addEventListener("change", (event) => {
      if (select.value !== "light") {
        clearLightFlag();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      applyLightTheme();
    }, true);
  }

  function restoreLightThemeIfNeeded() {
    ensureLightOption();
    const settings = getSettings();
    if (settings.theme === "light" || localStorage.getItem(LIGHT_FLAG) === "1") {
      applyLightTheme();
    }
  }

  function injectScript(src, id) {
    if (document.getElementById(id)) return;
    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.defer = true;
    document.head.appendChild(script);
  }

  function boot() {
    bindLightTheme();
    restoreLightThemeIfNeeded();
    injectScript("/product-title.js", "aura-product-title-js");
    injectScript("/api-key-actions.js", "aura-api-key-actions-js");
    injectScript("/http-port-options.js", "aura-http-port-options-js");
    injectScript("/guide-data.js", "aura-guide-data-js");
    injectScript("/guide-view.js", "aura-guide-view-js");
    window.addEventListener("aura:appearance-change", () => {
      ensureLightOption();
      if (document.documentElement.dataset.theme !== "light") clearLightFlag();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
