"use strict";

(function initAuraReconScanPresets() {
  const API_TOOL_PROVIDERS = new Set([
    "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge",
    "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"
  ]);
  const PASSIVE_TOOL_IDS = [
    "crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal",
    "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx",
    "whoisxmlapi", "whoisfreaks"
  ];
  const LINUX_TOOL_IDS = ["subfinder", "amass", "dnsx", "puredns", "shuffleDns", "gau", "httpx"];
  const SCREENSHOT_TOOL_IDS = ["gowitness", "aquatone", "eyewitness"];
  const TOOL_LABELS = {
    crtsh: "crt.sh",
    wayback: "Wayback CDX",
    rapiddns: "RapidDNS",
    rapid7: "Rapid7 FDNS",
    certspotter: "Cert Spotter",
    securitytrails: "SecurityTrails",
    shodan: "Shodan DNS",
    virustotal: "VirusTotal",
    censys: "Censys",
    binaryedge: "BinaryEdge",
    urlscan: "urlscan.io",
    hunterio: "Hunter.io",
    passivetotal: "PassiveTotal",
    zoomeye: "ZoomEye",
    spyse: "Spyse",
    intelx: "Intelligence X",
    whoisxmlapi: "WhoisXMLAPI DRS",
    whoisfreaks: "WhoisFreaks history",
    subfinder: "subfinder",
    amass: "amass passive",
    dnsx: "dnsx validation",
    puredns: "puredns resolve",
    shuffleDns: "shuffle-dns bruteforce",
    gau: "gau URL mining",
    httpx: "httpx status/tech",
    gowitness: "gowitness",
    aquatone: "aquatone",
    eyewitness: "EyeWitness"
  };
  const PRESETS = {
    rapid: {
      label: "Rapid",
      passive: ["crtsh", "wayback", "rapiddns"],
      linux: ["subfinder", "dnsx", "httpx"],
      screenshots: [],
      timeoutMs: 90000,
      intelPreflight: true,
      fullRecon: false
    },
    normal: {
      label: "Normal",
      passive: ["crtsh", "wayback", "rapiddns", "certspotter", "securitytrails", "shodan", "virustotal", "urlscan"],
      linux: ["subfinder", "dnsx", "gau", "httpx"],
      screenshots: ["gowitness"],
      timeoutMs: 180000,
      intelPreflight: true,
      fullRecon: false
    },
    full: {
      label: "Full",
      passive: [...PASSIVE_TOOL_IDS],
      linux: [...LINUX_TOOL_IDS],
      screenshots: [...SCREENSHOT_TOOL_IDS],
      timeoutMs: 300000,
      intelPreflight: true,
      fullRecon: true
    }
  };

  let activeApiProviders = new Set();
  let apiKeyLoadFailed = false;
  let userInputMode = "single";

  function boot() {
    injectStyles();
    setupControls();
    bindEvents();
    refreshApiState().then(() => applyCurrentPreset());
    window.setInterval(() => refreshApiState().then(() => applyCurrentPreset(false)).catch(() => {}), 20000);
  }

  function setupControls() {
    const reconMode = document.getElementById("reconMode");
    if (!reconMode) return;
    reconMode.dataset.auraInputMode = reconMode.value || "single";
    userInputMode = ["single", "list"].includes(reconMode.value) ? reconMode.value : "single";
    reconMode.innerHTML = `
      <option value="single">Single domain</option>
      <option value="list">Domain list</option>
      <option value="full" hidden>Full backend mode</option>
    `;
    reconMode.value = userInputMode;
    const label = document.querySelector('label[for="reconMode"]');
    if (label) label.textContent = "Input mode";
    if (!document.getElementById("scanPreset")) {
      reconMode.insertAdjacentHTML("afterend", `
        <label for="scanPreset">Scan preset</label>
        <select id="scanPreset">
          <option value="rapid">Rapid - fast baseline</option>
          <option value="normal" selected>Normal - balanced recon</option>
          <option value="full">Full - all available providers/tools</option>
        </select>
        <div id="scanPresetStatus" class="notice muted compact-notice">Choose a preset to automatically select safe passive sources, Linux tools, screenshots, and API-backed providers.</div>
      `);
    }
    const fullOptions = document.getElementById("fullReconOptions");
    fullOptions?.classList.remove("active");
  }

  function bindEvents() {
    document.getElementById("reconMode")?.addEventListener("change", () => {
      const mode = document.getElementById("reconMode")?.value || "single";
      if (["single", "list"].includes(mode)) userInputMode = mode;
      updateSeedPlaceholder();
    });
    document.getElementById("scanPreset")?.addEventListener("change", () => applyCurrentPreset());
    document.getElementById("start")?.addEventListener("click", prepareBackendMode, true);
    document.getElementById("saveApiKey")?.addEventListener("click", () => setTimeout(() => refreshApiState().then(() => applyCurrentPreset(false)).catch(() => {}), 2000));
    document.getElementById("testAllApiKeys")?.addEventListener("click", () => setTimeout(() => refreshApiState().then(() => applyCurrentPreset(false)).catch(() => {}), 4000));
  }

  async function refreshApiState() {
    try {
      const response = await fetch("/api/api-keys");
      if (!response.ok) throw new Error(`API key status failed: ${response.status}`);
      const data = await response.json();
      const keys = Array.isArray(data.apiKeys) ? data.apiKeys : [];
      activeApiProviders = new Set(keys.filter((key) => String(key.status || "").toLowerCase() === "active").map((key) => String(key.provider || "").toLowerCase()));
      apiKeyLoadFailed = false;
    } catch {
      activeApiProviders = new Set();
      apiKeyLoadFailed = true;
    }
  }

  function applyCurrentPreset(forceChecks = true) {
    const presetId = document.getElementById("scanPreset")?.value || "normal";
    const preset = PRESETS[presetId] || PRESETS.normal;
    updateSeedPlaceholder();
    applyFullReconVisibility(preset);
    applyTimeoutAndIntel(preset, forceChecks);
    const selected = new Set([...preset.passive, ...preset.linux, ...preset.screenshots]);
    const skipped = [];
    for (const id of [...PASSIVE_TOOL_IDS, ...LINUX_TOOL_IDS, ...SCREENSHOT_TOOL_IDS]) {
      const input = document.getElementById(id);
      if (!input) continue;
      const requiresApi = API_TOOL_PROVIDERS.has(id);
      const hasApi = !requiresApi || activeApiProviders.has(id);
      input.disabled = requiresApi && !hasApi;
      input.title = requiresApi && !hasApi ? `${TOOL_LABELS[id] || id} requires an active API key in Settings > API Keys and will be skipped.` : "";
      if (forceChecks) input.checked = selected.has(id) && hasApi;
      if (selected.has(id) && requiresApi && !hasApi) skipped.push(id);
      annotateTool(input, requiresApi, hasApi);
    }
    const useLinuxRunner = document.getElementById("useLinuxRunner");
    if (useLinuxRunner && forceChecks) useLinuxRunner.checked = preset.linux.length > 0;
    renderPresetStatus(preset, skipped);
  }

  function applyTimeoutAndIntel(preset, forceChecks) {
    if (!forceChecks) return;
    const timeout = document.getElementById("timeout");
    if (timeout) timeout.value = String(preset.timeoutMs);
    const intel = document.getElementById("intelPreflight");
    if (intel) intel.checked = Boolean(preset.intelPreflight);
  }

  function applyFullReconVisibility(preset) {
    const fullOptions = document.getElementById("fullReconOptions");
    if (!fullOptions) return;
    fullOptions.classList.toggle("active", Boolean(preset.fullRecon));
    fullOptions.classList.toggle("aura-full-recon-visible", Boolean(preset.fullRecon));
    const whoisInput = document.getElementById("fullWhoisInclude");
    if (preset.fullRecon && whoisInput && !whoisInput.value.trim()) {
      const target = document.getElementById("target")?.value || document.getElementById("newTargetName")?.value || "";
      const domains = (document.getElementById("domains")?.value || "").split(/\s+/).filter(Boolean);
      const guess = target || domains[0]?.split(".").slice(0, -1).join(".") || "";
      if (guess) whoisInput.value = guess;
    }
  }

  function updateSeedPlaceholder() {
    const mode = document.getElementById("reconMode")?.value || userInputMode;
    const domains = document.getElementById("domains");
    if (!domains) return;
    if (mode === "single") domains.placeholder = "example.com";
    else domains.placeholder = "example.com\napp.example.com";
  }

  function prepareBackendMode() {
    const reconMode = document.getElementById("reconMode");
    const presetId = document.getElementById("scanPreset")?.value || "normal";
    if (!reconMode) return;
    const inputMode = ["single", "list"].includes(reconMode.value) ? reconMode.value : userInputMode || "single";
    userInputMode = inputMode;
    applyCurrentPreset(false);
    if (presetId === "full") {
      reconMode.value = "full";
      window.setTimeout(() => {
        reconMode.value = inputMode;
        updateSeedPlaceholder();
      }, 0);
    } else {
      reconMode.value = inputMode;
    }
  }

  function annotateTool(input, requiresApi, hasApi) {
    const row = input.closest(".check");
    if (!row) return;
    row.classList.toggle("requires-api", requiresApi);
    row.classList.toggle("missing-api", requiresApi && !hasApi);
  }

  function renderPresetStatus(preset, skipped) {
    const node = document.getElementById("scanPresetStatus");
    if (!node) return;
    const selectedApi = preset.passive.filter((id) => API_TOOL_PROVIDERS.has(id));
    const activeSelected = selectedApi.filter((id) => activeApiProviders.has(id));
    const parts = [
      `${preset.label} preset selected.`,
      `${activeSelected.length}/${selectedApi.length} API-backed passive provider${selectedApi.length === 1 ? "" : "s"} available.`
    ];
    if (apiKeyLoadFailed) parts.push("API key status could not be loaded; API-backed providers are disabled until status is available.");
    if (skipped.length) parts.push(`Skipped because they need an active API key: ${skipped.map((id) => TOOL_LABELS[id] || id).join(", ")}.`);
    if (preset.fullRecon && !activeApiProviders.has("whoisxmlapi")) parts.push("Full provider expansion will continue without Reverse WHOIS unless an active WhoisXMLAPI key is added.");
    node.textContent = parts.join(" ");
    node.className = skipped.length || apiKeyLoadFailed ? "notice warn compact-notice" : "notice ok compact-notice";
  }

  function injectStyles() {
    if (document.getElementById("aura-recon-presets-style")) return;
    const style = document.createElement("style");
    style.id = "aura-recon-presets-style";
    style.textContent = `
      #fullReconOptions { display: none; }
      #fullReconOptions.active, #fullReconOptions.aura-full-recon-visible { display: block; }
      .tool-grid .check.missing-api { opacity: .55; }
      .tool-grid .check.missing-api span::after { content: " · needs API key"; color: var(--warn); font-size: 11px; }
      #scanPresetStatus { white-space: pre-wrap; }
    `;
    document.head.appendChild(style);
  }

  window.AuraReconPresets = { refreshApiState, applyCurrentPreset };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
