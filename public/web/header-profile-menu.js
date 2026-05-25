"use strict";

(function initAuraHeaderProfileMenu() {
  function boot() {
    injectStyles();
    const timer = setInterval(() => {
      const profile = document.getElementById("headerProfile");
      const button = document.getElementById("headerProfileButton");
      const logout = document.getElementById("headerLogoutSession");
      if (!profile || !button || !logout || profile.dataset.dropdownEnhanced) return;
      profile.dataset.dropdownEnhanced = "true";
      profile.classList.add("header-profile-dropdown");
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", "headerProfileMenu");
      const caret = document.createElement("span");
      caret.className = "profile-caret";
      caret.setAttribute("aria-hidden", "true");
      caret.textContent = "▾";
      button.appendChild(caret);
      const menu = document.createElement("div");
      menu.id = "headerProfileMenu";
      menu.className = "profile-menu";
      menu.setAttribute("role", "menu");
      menu.hidden = true;
      logout.className = "profile-menu-item";
      logout.setAttribute("role", "menuitem");
      menu.appendChild(logout);
      profile.appendChild(menu);
      clearInterval(timer);
    }, 250);
    setTimeout(() => clearInterval(timer), 10000);
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#headerProfileButton");
    const profile = document.getElementById("headerProfile");
    const menu = document.getElementById("headerProfileMenu");
    if (button && menu) {
      event.preventDefault();
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
      if (profile) profile.classList.toggle("menu-open", !menu.hidden);
      return;
    }
    if (!event.target.closest("#headerProfile") && menu) {
      menu.hidden = true;
      profile?.classList.remove("menu-open");
      document.getElementById("headerProfileButton")?.setAttribute("aria-expanded", "false");
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const menu = document.getElementById("headerProfileMenu");
    if (menu) menu.hidden = true;
    document.getElementById("headerProfile")?.classList.remove("menu-open");
    document.getElementById("headerProfileButton")?.setAttribute("aria-expanded", "false");
  });

  function injectStyles() {
    if (document.getElementById("aura-header-profile-menu-style")) return;
    const style = document.createElement("style");
    style.id = "aura-header-profile-menu-style";
    style.textContent = `
      .header-profile-dropdown { position: relative; }
      .header-profile-dropdown .profile-button { padding-right: 9px !important; }
      .profile-caret { display: inline-flex; align-items: center; color: var(--muted); font-size: 11px; line-height: 1; transition: transform .15s ease; }
      .header-profile-dropdown.menu-open .profile-caret { transform: rotate(180deg); }
      .profile-menu { position: absolute; top: calc(100% + 8px); right: 0; z-index: 10050; min-width: 180px; padding: 6px; border: 1px solid var(--vercel-line-strong, var(--line)); border-radius: 10px; background: rgba(5,5,5,.98); box-shadow: var(--vercel-shadow, 0 18px 70px rgba(0,0,0,.34)); }
      .profile-menu[hidden] { display: none !important; }
      .profile-menu-item { display: flex !important; align-items: center; justify-content: flex-start; width: 100% !important; min-width: 0 !important; min-height: 36px !important; margin: 0 !important; padding: 0 10px !important; border: 1px solid transparent !important; border-radius: 8px !important; background: transparent !important; box-shadow: none !important; color: #fecaca !important; text-align: left; }
      .profile-menu-item:hover { border-color: rgba(239,68,68,.45) !important; background: rgba(239,68,68,.14) !important; }
      @media (max-width:900px) { .profile-menu { min-width: 150px; } }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
