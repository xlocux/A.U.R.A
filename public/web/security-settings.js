"use strict";

(function initAuraSecuritySettings() {
  function boot() {
    injectStyles();
    ensureSecurityTab();
    bindSecurityActions();
    loadCurrentUser();
  }

  function ensureSecurityTab() {
    const tabs = document.querySelector(".settings-tabs");
    const storageButton = tabs?.querySelector('[data-settings-panel="storage"]');
    if (tabs && !tabs.querySelector('[data-settings-panel="security"]')) {
      const button = document.createElement("button");
      button.className = "settings-tab";
      button.dataset.settingsPanel = "security";
      button.type = "button";
      button.textContent = "Security";
      tabs.insertBefore(button, storageButton || null);
    }
    const settingsLayout = document.querySelector(".settings-layout");
    if (!settingsLayout || document.getElementById("settings-security")) return;
    const panel = document.createElement("div");
    panel.className = "pane settings-panel";
    panel.id = "settings-security";
    panel.innerHTML = `
      <h2>Security</h2>
      <div class="security-grid">
        <div class="embedded-window">
          <h2>Local Login</h2>
          <div class="form-body">
            <div id="securityCurrentUser" class="notice muted compact-notice">Loading current user...</div>
            <label for="securityUsername">Username</label>
            <input id="securityUsername" type="text" autocomplete="username" placeholder="locu">
            <label for="securityCurrentPassword">Current password</label>
            <input id="securityCurrentPassword" type="password" autocomplete="current-password" placeholder="Required to save changes">
            <div class="row">
              <div>
                <label for="securityNewPassword">New password</label>
                <input id="securityNewPassword" type="password" autocomplete="new-password" placeholder="Leave empty to keep current">
              </div>
              <div>
                <label for="securityConfirmPassword">Confirm new password</label>
                <input id="securityConfirmPassword" type="password" autocomplete="new-password" placeholder="Repeat new password">
              </div>
            </div>
            <div class="row">
              <button id="saveSecurityCredentials" type="button">Save Credentials</button>
              <button id="logoutSecuritySession" type="button" class="danger-button">Logout</button>
            </div>
            <div id="securityStatus" class="notice muted compact-notice">Credentials are stored locally in SQLite as salted PBKDF2 hashes. The web session is persisted with an HttpOnly cookie.</div>
          </div>
        </div>
        <div class="embedded-window">
          <h2>Storage Overview</h2>
          <div id="storageOverview" class="storage-overview">
            <div><span>Database</span><strong>data/aura.db</strong></div>
            <div><span>Artifacts</span><strong>data/recon-runs/</strong></div>
            <div><span>Generated wordlists</span><strong>data/wordlists/generated/</strong></div>
            <div><span>Targets</span><strong>targets/</strong></div>
          </div>
          <div class="notice muted compact-notice">Storage actions such as backup, cleanup old runs, vacuum DB, and artifact pruning belong here next. Security is separate so credential changes are easy to find.</div>
        </div>
      </div>
    `;
    const storagePanel = document.getElementById("settings-storage");
    settingsLayout.insertBefore(panel, storagePanel || null);
    if (storagePanel && !storagePanel.dataset.storageEnhanced) {
      storagePanel.dataset.storageEnhanced = "true";
      storagePanel.innerHTML = `
        <h2>Storage</h2>
        <div class="storage-overview">
          <div><span>SQLite DB</span><strong>data/aura.db</strong></div>
          <div><span>Run artifacts</span><strong>data/recon-runs/</strong></div>
          <div><span>Generated wordlists</span><strong>data/wordlists/generated/</strong></div>
          <div><span>Target configs</span><strong>targets/</strong></div>
        </div>
        <div class="notice muted compact-notice">This section should contain DB size, artifact size, run counts, backup/export, cleanup old runs, orphan artifact cleanup, and SQLite vacuum. Login changes are in Settings > Security.</div>
      `;
    }
  }

  function bindSecurityActions() {
    document.addEventListener("click", (event) => {
      const tab = event.target.closest('[data-settings-panel="security"]');
      if (tab) {
        event.preventDefault();
        activateSettingsPanel("security");
        setTimeout(loadCurrentUser, 50);
      }
      if (event.target.closest("#saveSecurityCredentials")) saveCredentials();
      if (event.target.closest("#logoutSecuritySession")) logout();
    }, true);
  }

  function activateSettingsPanel(name) {
    document.querySelectorAll(".settings-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.settingsPanel === name));
    document.querySelectorAll(".settings-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `settings-${name}`));
  }

  async function loadCurrentUser() {
    const box = document.getElementById("securityCurrentUser");
    if (!box) return;
    try {
      const response = await fetch("/api/auth/user");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load user");
      document.getElementById("securityUsername").value = data.username || "";
      box.textContent = `Logged in as ${data.username || "unknown"}. Last login: ${formatDate(data.lastLoginAt)}. Updated: ${formatDate(data.updatedAt)}.`;
    } catch (error) {
      box.textContent = `Unable to load current user: ${error.message}`;
    }
  }

  async function saveCredentials() {
    const username = document.getElementById("securityUsername")?.value.trim();
    const currentPassword = document.getElementById("securityCurrentPassword")?.value || "";
    const newPassword = document.getElementById("securityNewPassword")?.value || "";
    const confirmPassword = document.getElementById("securityConfirmPassword")?.value || "";
    const status = document.getElementById("securityStatus");
    const setStatus = (message, isError) => { if (status) { status.textContent = message; status.classList.toggle("error", Boolean(isError)); } };
    if (!currentPassword) return setStatus("Current password is required.", true);
    if (newPassword && newPassword !== confirmPassword) return setStatus("New password confirmation does not match.", true);
    try {
      const response = await fetch("/api/auth/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, currentPassword, newPassword })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save credentials");
      document.getElementById("securityCurrentPassword").value = "";
      document.getElementById("securityNewPassword").value = "";
      document.getElementById("securityConfirmPassword").value = "";
      setStatus(`Credentials updated for ${data.username}.`, false);
      loadCurrentUser();
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    try { localStorage.removeItem("aura.authToken"); } catch {}
    window.location.href = "/login.html";
  }

  function formatDate(value) {
    if (!value) return "never";
    try { return new Date(value).toLocaleString(); } catch { return value; }
  }

  function injectStyles() {
    if (document.getElementById("aura-security-settings-style")) return;
    const style = document.createElement("style");
    style.id = "aura-security-settings-style";
    style.textContent = `
      .security-grid { display: grid; grid-template-columns: minmax(360px, 1.1fr) minmax(320px, .9fr); gap: 10px; }
      .storage-overview { display: grid; gap: 8px; }
      .storage-overview div { border: 1px solid var(--line); border-radius: 10px; padding: 9px; background: rgba(10,14,20,.36); }
      .storage-overview span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
      .storage-overview strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
      #securityStatus.error { border-color: rgba(255, 99, 132, .6); color: #ffb3c1; }
      @media (max-width: 1000px) { .security-grid { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
