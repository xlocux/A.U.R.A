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

  // The previous "Light Mode" option set data-theme="light" but no stylesheet defines a light
  // theme, so it did nothing. Remove any leftover light option and migrate saved state back to the
  // default accent theme so the Appearance controls only expose themes that actually render.
  function removeLightArtifacts() {
    localStorage.removeItem(LIGHT_FLAG);
    const select = document.getElementById("themeSelect");
    select?.querySelector('option[value="light"]')?.remove();
    const settings = getSettings();
    if (settings.theme === "light") {
      saveSettings({ theme: "aura" });
      if (document.documentElement.dataset.theme === "light") document.documentElement.dataset.theme = "";
      if (select) select.value = "aura";
    }
  }

  function boot() {
    removeLightArtifacts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
