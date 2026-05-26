"use strict";

(function initAuraApiKeyActions() {
  const $ = (id) => document.getElementById(id);

  injectApiKeyStyles();

  function bind() {
    const rows = $("apiKeyRows");
    if (!rows || rows.dataset.apiKeyActionsBound === "true") return;
    rows.dataset.apiKeyActionsBound = "true";
    upgradeRows();
    new MutationObserver(upgradeRows).observe(rows, { childList: true });
    rows.addEventListener("click", async (event) => {
      const button = event.target.closest(".api-key-test");
      if (button) {
        event.preventDefault();
        await testApiKey(button);
        return;
      }
      const disableButton = event.target.closest(".api-key-disable");
      if (disableButton) {
        event.preventDefault();
        await disableApiKey(disableButton);
      }
    });
  }

  function upgradeRows() {
    document.querySelectorAll("#apiKeyRows .api-key-delete").forEach((deleteButton) => {
      const cell = deleteButton.closest("td");
      if (!cell || cell.querySelector(".api-key-test")) return;
      cell.classList.add("api-key-actions-cell");
      deleteButton.classList.add("api-key-row-button");
      deleteButton.insertAdjacentHTML("beforebegin", `<button class="api-key-test api-key-row-button" type="button" data-api-key-id="${escapeHtml(deleteButton.dataset.apiKeyId)}">Test</button>`);
      deleteButton.insertAdjacentHTML("beforebegin", `<button class="api-key-disable api-key-row-button" type="button" data-api-key-id="${escapeHtml(deleteButton.dataset.apiKeyId)}">Disable</button>`);
    });
  }

  async function testApiKey(button) {
    const id = button.dataset.apiKeyId;
    if (!id) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Testing";
    setApiPreflightStateSafe("running", "Testing API key...", "Running a provider-specific preflight for this stored key.");
    try {
      const data = await apiFetch(`/api/api-keys/${encodeURIComponent(id)}/preflight`, { method: "POST" });
      const ok = data.preflight?.ok !== false;
      const alert = data.alert?.message ? ` ${data.alert.message}` : "";
      setApiPreflightStateSafe(ok ? "ok" : "failed", ok ? "API key preflight passed" : "API key preflight failed", `${data.preflight?.message || ""}${alert}`);
      updateRowStatus(button, data.apiKey?.status || (ok ? "active" : "failed"));
    } catch (error) {
      setApiPreflightStateSafe("failed", "API key preflight failed", error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function disableApiKey(button) {
    const id = button.dataset.apiKeyId;
    if (!id) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Disabling";
    try {
      const data = await apiFetch(`/api/api-keys/${encodeURIComponent(id)}/disable`, { method: "POST" });
      updateRowStatus(button, data.apiKey?.status || "disabled");
      setApiPreflightStateSafe("ok", "API provider disabled", "This key will not be selected for recon until you replace or re-enable it.");
    } catch (error) {
      setApiPreflightStateSafe("failed", "Disable failed", error.message);
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function updateRowStatus(button, status) {
    const row = button.closest("tr");
    const badge = row?.querySelector(".api-status-badge");
    if (!badge) return;
    const normalized = String(status || "unknown").toLowerCase();
    const safe = ["active", "failed", "disabled", "exhausted"].includes(normalized) ? normalized : "unknown";
    if (window.AuraStatusBadges?.applyToElement) {
      window.AuraStatusBadges.applyToElement(badge, status || "unknown", { className: `api-status-badge ${safe}` });
    } else {
      badge.className = `api-status-badge ${safe}`;
      badge.textContent = status || "unknown";
    }
  }

  async function apiFetch(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  function setApiPreflightStateSafe(state, title, detail) {
    const node = $("apiPreflightStatus");
    if (!node) return;
    node.className = `api-preflight ${state}`;
    node.querySelector("strong").textContent = title;
    node.querySelector("small").textContent = detail || "";
  }

  function injectApiKeyStyles() {
    if ($("aura-api-key-actions-style")) return;
    const style = document.createElement("style");
    style.id = "aura-api-key-actions-style";
    style.textContent = `
      #settings-credentials .split.embedded {
        grid-template-columns: minmax(320px, 420px) minmax(0, 1fr);
        gap: 10px;
        min-height: 0;
      }
      #settings-credentials .form-body {
        padding: 8px 10px;
      }
      #settings-credentials .notice {
        padding: 9px 10px;
        font-size: 12px;
      }
      #settings-credentials label {
        margin: 7px 0 4px;
      }
      #settings-credentials .row,
      #settings-credentials .row3 {
        gap: 7px;
      }
      #settings-credentials table {
        font-size: 12px;
      }
      #settings-credentials th,
      #settings-credentials td {
        padding: 5px 7px;
        vertical-align: middle;
      }
      #settings-credentials th {
        font-size: 10px;
      }
      #settings-credentials .scroll { max-height: none; }
      #settings-credentials .api-key-table-wrap { min-height: 0; }
      .api-key-actions-cell {
        display: flex;
        gap: 5px;
        align-items: center;
        white-space: nowrap;
      }
      .api-key-row-button {
        width: auto;
        margin: 0;
        min-height: 0;
        padding: 4px 7px;
        font-size: 11px;
        line-height: 1.1;
      }
      .api-key-test {
        background: rgba(67, 197, 158, .14);
        border: 1px solid rgba(67, 197, 158, .45);
        color: var(--accent-2);
      }
      .api-status-badge {
        min-width: 58px;
        padding: 2px 6px;
        font-size: 10px;
      }
      @media (max-width: 900px) {
        #settings-credentials .split.embedded { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
