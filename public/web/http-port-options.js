"use strict";

(function initAuraHttpPortOptions() {
  const PRESETS = {
    small: "80,443,8080,8443",
    medium: "80,443,8009,8080,8081,8090,8180,8443,27000,27001,5000,5001,9001,81,9443,25,23",
    large: "21,22,23,25,53,80,81,110,143,443,465,587,993,995,3000,3001,4000,5000,5001,5601,7000,7001,8000,8001,8008,8009,8080,8081,8082,8088,8090,8180,8443,8888,9000,9001,9090,9200,9443,10000,27000,27001"
  };

  function boot() {
    injectReconPresets();
    injectStyles();
    injectControls();
    patchFetchOnce();
  }

  function injectReconPresets() {
    if (document.getElementById("aura-recon-scan-presets-js")) return;
    const script = document.createElement("script");
    script.id = "aura-recon-scan-presets-js";
    script.src = "/recon-scan-presets.js";
    script.defer = true;
    document.head.appendChild(script);
  }

  function injectControls() {
    const httpx = document.getElementById("httpx");
    if (!httpx || document.getElementById("httpxPortPreset")) return;
    const row = httpx.closest(".check");
    if (!row) return;
    const panel = document.createElement("div");
    panel.className = "http-port-options";
    panel.innerHTML = `
      <label for="httpxPortPreset">HTTP probe port preset</label>
      <select id="httpxPortPreset">
        <option value="small">Small - web basics</option>
        <option value="medium" selected>Medium - common web/app ports</option>
        <option value="large">Large - extended service surface</option>
        <option value="custom">Custom</option>
      </select>
      <label for="httpxCustomPorts">Custom ports</label>
      <textarea id="httpxCustomPorts" rows="2" placeholder="80,443,8080,8443">${PRESETS.medium}</textarea>
      <div class="notice muted compact-notice">httpx uses the selected preset unless custom ports are provided. Invalid ports and port 0 are ignored.</div>
    `;
    row.insertAdjacentElement("afterend", panel);
    const preset = document.getElementById("httpxPortPreset");
    const custom = document.getElementById("httpxCustomPorts");
    preset.addEventListener("change", () => {
      if (preset.value !== "custom") custom.value = PRESETS[preset.value] || PRESETS.medium;
    });
  }

  function selectedPortConfig() {
    const preset = document.getElementById("httpxPortPreset")?.value || "medium";
    const customPorts = document.getElementById("httpxCustomPorts")?.value || "";
    return { preset, customPorts: preset === "custom" ? customPorts : "" };
  }

  function patchFetchOnce() {
    if (window.__auraHttpPortOptionsFetchPatched) return;
    window.__auraHttpPortOptionsFetchPatched = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function auraFetch(input, init = {}) {
      const url = typeof input === "string" ? input : input?.url || "";
      if (String(init?.method || "GET").toUpperCase() === "POST" && url === "/api/recon-runs" && init?.body) {
        try {
          const body = JSON.parse(init.body);
          const portConfig = selectedPortConfig();
          if (Array.isArray(body.linuxTools)) {
            body.linuxTools = body.linuxTools.map((tool) => tool === "httpx" ? { name: "httpx", ...portConfig } : tool);
          }
          body.httpx = portConfig;
          init = { ...init, body: JSON.stringify(body) };
        } catch {
          // Keep original request body when it is not JSON.
        }
      }
      return originalFetch(input, init);
    };
  }

  function injectStyles() {
    if (document.getElementById("aura-http-port-options-style")) return;
    const style = document.createElement("style");
    style.id = "aura-http-port-options-style";
    style.textContent = `
      .http-port-options { grid-column: 1 / -1; border: 1px solid var(--line); border-radius: 10px; padding: 9px; background: rgba(10, 14, 20, .42); display: grid; gap: 6px; }
      .http-port-options textarea { min-height: 46px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
      .http-port-options label { margin: 0; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
