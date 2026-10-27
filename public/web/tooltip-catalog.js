"use strict";

// Declarative tooltip catalog: gives the whole UI rich HUD tooltips (title + detail [+ command]) without
// touching each element's markup. Elements that already have a title/data-tooltip keep their own.
// Format of a tip: "Title\nDetail line\nRuns: command" (see themed-tooltips.js for how it renders).
(function initTooltipCatalog() {
  const CATALOG = [
    // Sidebar
    ['.tab[data-tab="recon"]', "Recon", "Start a scan: domains, depth and tools"],
    ['.tab[data-tab="wordlists"]', "Wordlists", "Manage wordlists and generate them from recon data"],
    ['.tab[data-tab="search"]', "Search", "Query saved domains, URLs and findings"],
    ['.tab[data-tab="topology"]', "Topology", "Graph of domains, services and their relations"],
    ['.tab[data-tab="results"]', "Results", "Assets, screenshots, activity and exports"],
    ['.tab[data-tab="flow"]', "Flow", "Live control room: every pipeline phase in real time"],
    ['.tab[data-tab="tools"]', "Tools", "Local converters: Base64, JWT, hashes and more"],
    ['.tab[data-tab="logs"]', "Logs", "Raw tool output and warnings & errors"],
    ['.tab[data-tab="settings"]', "Settings", "Environment, AI, proxy, API keys, storage"],
    ['.tab[data-tab="guide"]', "Guide", "How A.U.R.A works, tool by tool"],
    ["#sidebarToggle", "Sidebar", "Collapse or expand the navigation"],
    // Header
    ["#aiModelBadge", "Active AI model", "The model answering in the chat and planning recovery"],
    ["#dashboardQuickSearch", "Quick search", "Press Ctrl+K to search targets, runs and providers"],
    // Results
    ['[data-results-view="explorer"]', "Explorer", "Overview of the run with filters and run delta"],
    ['[data-results-view="assets"]', "Assets", "Domains, services, URLs, tech, risk URLs, cloud, vulns"],
    ['[data-results-view="screenshots"]', "Screenshots", "Visual triage; identical pages are grouped"],
    ['[data-results-view="activity"]', "Activity", "Live feed of events, tools and AI actions"],
    ['[data-results-view="export"]', "Export", "Follow-ups plus JSON / CSV / Burp / Caido exports"],
    ['.assets-tab[data-asset="domains"]', "Domains", "Discovered domains and subdomains"],
    ['.assets-tab[data-asset="services"]', "Services", "Live HTTP services with status, title and tech"],
    ['.assets-tab[data-asset="urls"]', "URLs", "Archived and crawled URLs with parameters"],
    ['.assets-tab[data-asset="technologies"]', "Technologies", "Detected stack, grouped by service and host"],
    ['.assets-tab[data-asset="risk"]', "Risk URLs", "Parameterised URLs bucketed by likely issue class"],
    ['.assets-tab[data-asset="cloud"]', "Cloud", "Public buckets and endpoints found by cloud_enum"],
    ['.assets-tab[data-asset="vulns"]', "Vulnerabilities", "nuclei findings and NVD CVEs for detected versions"],
    // Recon form
    ["#quickStart", "Create & start", "Creates the target if needed and launches a run at the chosen depth"],
    ["#quickAdvancedToggle", "Advanced options", "Show target management, tools and provider leads"],
    ["#scanTier", "Scan depth", "Light is passive-leaning, Normal balanced, Full deep and noisy"],
    ["#deleteTarget", "Delete target", "Remove this target and its saved configuration"],
    ["#start", "Start recon", "Run with the tools and sources selected below"],
    ["#nmapPreset", "nmap ports", "Preset or custom ports for the service/version scan"],
    // Run control
    ["#pauseRun", "Pause", "Pauses after the current tool finishes"],
    ["#resumeRun", "Resume", "Continue a paused run"],
    ["#cancelRun", "Cancel", "Stop the run immediately"],
    // Exports
    ["#exportUrlList", "URL list", "All discovered URLs as .txt for Burp or Caido"],
    ["#exportLiveServices", "Live services", "Only URLs of services that answered"],
    ["#exportBurpScope", "Burp scope", "Target-scope JSON built from the discovered hosts"],
    ["#exportCaidoScope", "Caido scope", "Host globs for Caido's scope"],
    ["#exportRiskUrls", "Export risk URLs", "The currently filtered candidates as .txt"],
    // Settings
    ["#checkEnvironment", "Check environment", "Verify which recon tools are installed"],
    ["#installEnvironment", "Install / update", "Install or update every missing tool"],
    ["#setupLogExpand", "Setup output", "Expand or collapse the install log"],
    ["#saveAiSettings", "Save AI settings", "Persist provider, models and autonomy"],
    ["#testAiSettings", "Test AI", "Ping the selected provider and models"],
    ["#refreshAiModels", "Refresh models", "Fetch the current free OpenRouter models"],
    ["#deepseekLogin", "DeepSeek login", "Opens a browser, captures and verifies your session token"],
    // AI chat
    ["#sendAiPrompt", "Send", "Ask about the current target, run or next step"],
    ["#aiAttach", "Attach a file", "Upload a file for the assistant (DeepSeek)"],
    ["#aiMinimize", "Hide chat", "Minimise the AI panel"],
    ["#aiRestore", "AURI Agent", "Open or close the assistant (AURI is the AI agent of A.U.R.A)"]
  ];

  const text = (title, detail, cmd) => [title, detail, cmd ? "Runs: " + cmd : ""].filter(Boolean).join("\n");

  function apply() {
    for (const [selector, title, detail, cmd] of CATALOG) {
      document.querySelectorAll(selector).forEach((el) => {
        if (el.dataset.tooltip || el.hasAttribute("title")) return;
        el.dataset.tooltip = text(title, detail, cmd);
      });
    }
    // Sidebar submenu items are created at runtime: name them after their label.
    document.querySelectorAll(".nav-subitem").forEach((el) => {
      if (el.dataset.tooltip || el.hasAttribute("title")) return;
      el.dataset.tooltip = text(el.textContent.trim(), "Open this section");
    });
  }

  let queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; apply(); });
  }

  function boot() {
    apply();
    // Many controls are injected after load (Logs, Topology views, modals): re-apply on DOM changes.
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
