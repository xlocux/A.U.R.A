"use strict";

(function initAuraHeaderProfileMenu() {
  function boot() {
    const timer = setInterval(() => {
      const profile = document.getElementById("headerProfile");
      const button = document.getElementById("headerProfileButton");
      const logout = document.getElementById("headerLogoutSession");
      if (!profile || !button || !logout || profile.dataset.dropdownEnhanced) return;
      profile.dataset.dropdownEnhanced = "true";
      profile.classList.add("header-profile-dropdown");
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      const menu = document.createElement("div");
      menu.id = "headerProfileMenu";
      menu.className = "profile-menu";
      menu.hidden = true;
      logout.className = "profile-menu-item";
      menu.appendChild(logout);
      profile.appendChild(menu);
      clearInterval(timer);
    }, 250);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#headerProfileButton");
    const menu = document.getElementById("headerProfileMenu");
    if (button && menu) {
      event.preventDefault();
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
    }
  }, true);

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
