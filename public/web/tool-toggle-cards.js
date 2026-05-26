"use strict";

(function initAuraToggleControls() {
  const TOOL_META = {
    crtsh: ["Passive source", "Public CT discovery"],
    wayback: ["Passive source", "Historical URLs"],
    rapiddns: ["Passive source", "Public DNS index"],
    rapid7: ["API-backed source", "FDNS dataset"],
    certspotter: ["API-backed source", "Certificate transparency"],
    securitytrails: ["API-backed source", "DNS intelligence"],
    shodan: ["API-backed source", "Host intelligence"],
    virustotal: ["API-backed source", "Domain intelligence"],
    censys: ["API-backed source", "Internet intelligence"],
    binaryedge: ["API-backed source", "DNS intelligence"],
    urlscan: ["API-backed source", "Archived scans"],
    hunterio: ["API-backed source", "Domain intelligence"],
    passivetotal: ["API-backed source", "Passive DNS"],
    zoomeye: ["API-backed source", "Asset search"],
    spyse: ["API-backed source", "Domain intelligence"],
    intelx: ["API-backed source", "Domain mentions"],
    whoisxmlapi: ["API-backed source", "Reverse WHOIS"],
    whoisfreaks: ["API-backed source", "Historical WHOIS"],
    useLinuxRunner: ["Local runtime", "Run installed CLI tools"],
    subfinder: ["Linux tool", "Passive subdomain enum"],
    amass: ["Linux tool", "Passive graph enum"],
    dnsx: ["Validation", "DNS resolution"],
    puredns: ["Validation", "Resolver pipeline"],
    shuffleDns: ["Bruteforce", "Wordlist DNS enum"],
    gau: ["URL mining", "Historical URL corpus"],
    httpx: ["HTTP / tech", "Status and technology"],
    gowitness: ["Screenshots", "Browser capture"],
    aquatone: ["Screenshots", "Visual report"],
    eyewitness: ["Screenshots", "Visual triage"]
  };

  const GENERIC_META = {
    intelPreflight: ["AI-assisted intel", "WHOIS/RDAP and TLD pivots"],
    searchCurrentTarget: ["Search scope", "Limit search to active target"],
    topologyDomains: ["Topology layer", "Show discovered domains"],
    topologyServices: ["Topology layer", "Show HTTP services"],
    topologyArtifacts: ["Topology layer", "Show URLs and screenshot artifacts"],
    topologyCandidates: ["Topology layer", "Show 100% verified candidates"],
    resultFilterHttp: ["Results filter", "Only nodes with HTTP evidence"],
    resultFilterTech: ["Results filter", "Only nodes with technologies"],
    resultFilterUrls: ["Results filter", "Only nodes with URL evidence"],
    resultFilterNew: ["Results filter", "Only new observations"],
    useLocalModel: ["AI runtime", "Use a direct local model endpoint"],
    proxyEnabled: ["Proxy routing", "Route recon tools through authorized proxy"],
    sourceWhoisXml: ["Provider source", "Reverse WHOIS enrichment"],
    sourceCensys: ["Provider source", "Host and certificate enrichment"],
    sourceShodan: ["Provider source", "Host, favicon, and service enrichment"],
    sourceRdap: ["Provider source", "RDAP / WHOIS enrichment"]
  };

  const TOOL_RECOMMENDED = new Set([
    "crtsh", "wayback", "rapiddns", "certspotter", "securitytrails", "shodan", "virustotal",
    "urlscan", "useLinuxRunner", "subfinder", "dnsx", "gau", "httpx", "gowitness"
  ]);

  let syncQueued = false;

  function statusIcon(state) {
    if (state === "locked") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
    if (state === "enabled") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path></svg>';
  }

  function enhanceControl(control) {
    const input = control.querySelector('input[type="checkbox"]');
    const label = control.querySelector("span");
    if (!input || !label || control.dataset.auraToggleReady) return;

    const variant = control.closest(".tool-grid") ? "tool" : "button";
    const titleId = `${input.id || Math.random().toString(36).slice(2)}-toggle-title`;
    const labelText = label.textContent.trim();

    control.dataset.auraToggleReady = "true";
    control.dataset.auraToggleVariant = variant;
    control.classList.add("aura-toggle-control");
    control.tabIndex = 0;
    control.setAttribute("role", "switch");
    control.setAttribute("aria-labelledby", titleId);

    if (variant === "tool") {
      control.classList.add("tool-toggle-card");
      label.classList.add("tool-toggle-copy");
      label.innerHTML = `
        <span class="tool-toggle-main"><span id="${titleId}" class="tool-toggle-name">${escapeHtml(labelText)}</span><span class="tool-toggle-state"></span></span>
        <span class="tool-toggle-meta"></span>`;
      control.insertAdjacentHTML("afterbegin", '<span class="tool-toggle-icon" aria-hidden="true"></span>');
    } else {
      control.classList.add("aura-toggle-button");
      label.classList.add("aura-toggle-copy");
      label.innerHTML = `
        <span class="aura-toggle-icon" aria-hidden="true"></span>
        <span id="${titleId}" class="aura-toggle-name">${escapeHtml(labelText)}</span>
        <span class="aura-toggle-state"></span>`;
    }

    control.addEventListener("click", (event) => {
      if (event.target === input) return;
      event.preventDefault();
      event.stopPropagation();
      toggleInput(input);
    });
    control.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      toggleInput(input);
    });
    input.addEventListener("change", () => syncControl(control));
  }

  function toggleInput(input) {
    if (input.disabled) {
      if (input.closest(".missing-api") || input.closest(".requires-api")) {
        window.AuraDialogs?.alert({
          tone: "info",
          title: "API key required",
          message: "This provider is locked until an active API key is available in Settings > API Keys.",
          confirmLabel: "Got it"
        });
      }
      return;
    }
    setInputChecked(input, !input.checked);
  }

  function setInputChecked(input, checked) {
    input.checked = Boolean(checked);
    input.toggleAttribute("checked", input.checked);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.closest(".check") && syncControl(input.closest(".check"));
  }

  function syncControl(control) {
    const input = control.querySelector('input[type="checkbox"]');
    if (!input) return;
    const variant = control.dataset.auraToggleVariant || (control.closest(".tool-grid") ? "tool" : "button");
    const state = input.disabled || control.classList.contains("missing-api") ? "locked" : input.checked ? "enabled" : "disabled";

    control.dataset.toolState = state;
    control.dataset.toggleState = state;
    control.setAttribute("aria-checked", input.checked && state !== "locked" ? "true" : "false");
    control.setAttribute("aria-disabled", state === "locked" ? "true" : "false");

    if (variant === "tool") syncToolControl(control, input, state);
    else syncButtonControl(control, input, state);
  }

  function syncToolControl(control, input, state) {
    const meta = TOOL_META[input.id] || ["Recon option", "A.U.R.A aware recon module"];
    const stateNode = control.querySelector(".tool-toggle-state");
    const metaNode = control.querySelector(".tool-toggle-meta");
    const icon = control.querySelector(".tool-toggle-icon");
    if (stateNode) stateNode.textContent = state === "locked" ? "Needs API key" : state === "enabled" ? "Enabled" : "Disabled";
    if (metaNode) metaNode.textContent = state === "locked" ? `${meta[0]} · add key in Settings` : `${meta[0]} · ${meta[1]}`;
    if (icon) icon.innerHTML = statusIcon(state);
  }

  function syncButtonControl(control, input, state) {
    const icon = control.querySelector(".aura-toggle-icon");
    const stateNode = control.querySelector(".aura-toggle-state");
    const meta = GENERIC_META[input.id] || ["Toggle", "A.U.R.A aware option"];
    control.title = state === "locked" ? `${meta[0]} · locked` : meta[1];
    if (icon) icon.innerHTML = statusIcon(state);
    if (stateNode) stateNode.textContent = state === "locked" ? "Locked" : state === "enabled" ? "On" : "Off";
  }

  function syncAll() {
    document.querySelectorAll(".check").forEach((control) => {
      enhanceControl(control);
      syncControl(control);
    });
  }

  function queueSyncAll() {
    if (syncQueued) return;
    syncQueued = true;
    window.requestAnimationFrame(() => {
      syncQueued = false;
      syncAll();
    });
  }

  function addQuickActions() {
    const grid = document.querySelector(".tool-grid");
    if (!grid || document.getElementById("toolQuickActions")) return;
    grid.insertAdjacentHTML("afterbegin", `
      <div id="toolQuickActions" class="tool-quick-actions" aria-label="Tool selection shortcuts">
        <button type="button" data-tool-action="recommended">Enable recommended</button>
        <button type="button" data-tool-action="disable">Disable all</button>
        <button type="button" data-tool-action="api">API-key ready</button>
      </div>`);
    grid.querySelector("#toolQuickActions")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tool-action]");
      if (!button) return;
      applyQuickAction(button.dataset.toolAction);
    });
  }

  function applyQuickAction(action) {
    document.querySelectorAll(".tool-grid input[type='checkbox']").forEach((input) => {
      if (input.disabled) return;
      if (action === "disable") setInputChecked(input, false);
      if (action === "recommended") setInputChecked(input, TOOL_RECOMMENDED.has(input.id));
      if (action === "api") setInputChecked(input, Boolean(input.closest(".requires-api")) && !input.closest(".missing-api"));
    });
    syncAll();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function boot() {
    addQuickActions();
    syncAll();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.type === "childList" || ["class", "disabled", "checked"].includes(mutation.attributeName))) {
        queueSyncAll();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled", "checked"] });
    window.AuraToggleControls = { syncAll, queueSyncAll };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
