"use strict";

(function initToolToggleCards() {
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

  function statusIcon(state) {
    if (state === "locked") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
    if (state === "enabled") return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path></svg>';
  }

  function enhanceCard(card) {
    const input = card.querySelector('input[type="checkbox"]');
    const label = card.querySelector("span");
    if (!input || !label || card.dataset.toolCardReady) return;
    card.dataset.toolCardReady = "true";
    card.classList.add("tool-toggle-card");
    card.tabIndex = 0;
    card.setAttribute("role", "switch");
    card.setAttribute("aria-labelledby", `${input.id}-tool-title`);
    label.classList.add("tool-toggle-copy");
    label.innerHTML = `
      <span class="tool-toggle-main"><span id="${input.id}-tool-title" class="tool-toggle-name">${label.textContent.trim()}</span><span class="tool-toggle-state"></span></span>
      <span class="tool-toggle-meta"></span>`;
    card.insertAdjacentHTML("afterbegin", '<span class="tool-toggle-icon" aria-hidden="true"></span>');
    card.addEventListener("click", (event) => {
      if (event.target === input) return;
      event.preventDefault();
      toggleInput(input);
    });
    card.addEventListener("keydown", (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      toggleInput(input);
    });
    input.addEventListener("change", () => syncCard(card));
  }

  function toggleInput(input) {
    if (input.disabled) {
      window.AuraDialogs?.alert({
        tone: "info",
        title: "API key required",
        message: "This provider is locked until an active API key is available in Settings > API Keys.",
        confirmLabel: "Got it"
      });
      return;
    }
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function syncCard(card) {
    const input = card.querySelector('input[type="checkbox"]');
    if (!input) return;
    const state = input.disabled || card.classList.contains("missing-api") ? "locked" : input.checked ? "enabled" : "disabled";
    card.dataset.toolState = state;
    card.setAttribute("aria-checked", input.checked && state !== "locked" ? "true" : "false");
    card.setAttribute("aria-disabled", state === "locked" ? "true" : "false");
    const meta = TOOL_META[input.id] || ["Recon option", "A.U.R.A aware recon module"];
    const stateNode = card.querySelector(".tool-toggle-state");
    const metaNode = card.querySelector(".tool-toggle-meta");
    const icon = card.querySelector(".tool-toggle-icon");
    if (stateNode) stateNode.textContent = state === "locked" ? "Needs API key" : state === "enabled" ? "Enabled" : "Disabled";
    if (metaNode) metaNode.textContent = state === "locked" ? `${meta[0]} · add key in Settings` : `${meta[0]} · ${meta[1]}`;
    if (icon) icon.innerHTML = statusIcon(state);
  }

  function syncAll() {
    document.querySelectorAll(".tool-grid .check").forEach((card) => {
      enhanceCard(card);
      syncCard(card);
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
    const recommended = new Set(["crtsh", "wayback", "rapiddns", "certspotter", "securitytrails", "shodan", "virustotal", "urlscan", "useLinuxRunner", "subfinder", "dnsx", "gau", "httpx", "gowitness"]);
    document.querySelectorAll(".tool-grid input[type='checkbox']").forEach((input) => {
      if (input.disabled) return;
      if (action === "disable") input.checked = false;
      if (action === "recommended") input.checked = recommended.has(input.id);
      if (action === "api") input.checked = input.closest(".requires-api") && !input.closest(".missing-api");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    syncAll();
  }

  function boot() {
    addQuickActions();
    syncAll();
    const grid = document.querySelector(".tool-grid");
    if (!grid) return;
    const observer = new MutationObserver(() => syncAll());
    observer.observe(grid, { attributes: true, subtree: true, attributeFilter: ["class", "disabled", "checked"] });
    window.setInterval(syncAll, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
