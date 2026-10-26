"use strict";

// Recon flow diagram: a block view of the full recon pipeline with per-stage and per-tool status,
// derived from the run's events and tool results. Opens from the run status pill / Status tile.
(function initAuraReconFlow() {
  const $ = (id) => document.getElementById(id);
  const api = (path) => window.auraApi(path);
  const REFRESH_MS = 2500;
  let currentRunId = null;
  let timer = null;
  let selectedStageId = null;
  let lastStages = [];
  let animateNext = false; // play the short "draw" reveal only on the first render after activate

  // Ordered pipeline. `phases` match event.phase values; `tools` are the CLI tools the stage runs.
  const STAGES = [
    { id: "intel", label: "Intel preflight", phases: ["whois-rdap", "provider-discovery", "domain_intelligence", "bootstrap"], tools: [], hint: "WHOIS/RDAP + alternate-TLD correlation" },
    { id: "passive", label: "Passive sources", phases: ["recon"], sources: ["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx"], tools: [], hint: "CT logs, archives, passive DNS, provider APIs" },
    { id: "subdomains", label: "Subdomain & DNS", phases: ["recon"], tools: ["subfinder", "amass", "dnsx", "puredns", "shuffle-dns"], hint: "Enumerate and resolve hosts" },
    { id: "tls", label: "TLS & certificates", phases: ["follow-up-tls"], tools: ["tlsx"], hint: "Harvest SAN hostnames from certificates" },
    { id: "takeover", label: "Subdomain takeover", phases: ["follow-up-takeover"], tools: ["subzy"], hint: "Check dangling hosts for takeover" },
    { id: "urls", label: "URL mining", phases: ["recon"], tools: ["gau"], hint: "Archived URLs and parameters" },
    { id: "crawl", label: "Active crawl", phases: ["follow-up-crawl"], tools: ["katana"], hint: "Crawl live services for endpoints" },
    { id: "params", label: "Param & archive mining", phases: ["follow-up-params"], tools: ["waymore", "paramspider"], hint: "Wider archived URLs and parameters" },
    { id: "http", label: "HTTP probing", phases: ["recon", "http-tech-followup", "follow-up-http"], tools: ["httpx"], hint: "Live services, status, titles, tech" },
    { id: "tech", label: "Technology enrichment", phases: ["technology-enrichment"], tools: ["retire", "wpscan", "cmseek"], hint: "Per-service tech detectors" },
    { id: "js", label: "JavaScript discovery", phases: ["follow-up-js"], tools: ["getJS"], hint: "Extract script URLs from live services" },
    { id: "screenshots", label: "Screenshots", phases: ["recon"], tools: ["gowitness", "eyewitness", "chromium"], hint: "Visual triage of live services" },
    { id: "fingerprint", label: "Trackers & favicons", phases: ["tracker-extraction", "favicon-fingerprint"], tools: [], hint: "Analytics IDs and favicon hashes" },
    { id: "dirs", label: "Directory discovery", phases: ["follow-up-dirs"], tools: ["ffuf"], hint: "Content discovery on live services" },
    { id: "cloud", label: "Cloud resources", phases: ["follow-up-cloud"], tools: ["cloud_enum"], hint: "Public cloud buckets/blobs by keyword" },
    { id: "bypass403", label: "403/401 bypass", phases: ["follow-up-bypass403"], tools: ["gobypass403"], hint: "Attempt access-control bypasses on forbidden endpoints" },
    { id: "recovery", label: "AI recovery pool", phases: ["ai-action-pool", "ai-tool-recovery"], tools: [], hint: "Retries incomplete phases" }
  ];

  // Per-stage line icons (24x24, stroke=currentColor) for the cyberpunk block header.
  const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ICONS = {
    intel: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`),
    passive: svg(`<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>`),
    subdomains: svg(`<rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M12 8v4M6 16v-2h12v2"/>`),
    urls: svg(`<path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>`),
    http: svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`),
    tech: svg(`<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2"/>`),
    js: svg(`<path d="M8 6l-5 6 5 6M16 6l5 6-5 6M13 4l-2 16"/>`),
    screenshots: svg(`<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3.2"/><path d="M8 6l1.5-2h5L16 6"/>`),
    fingerprint: svg(`<path d="M6 11a6 6 0 0 1 12 0M8.5 12.5a3.5 3.5 0 0 1 7 0v1M12 13v4M9 17v1M15 15v3"/>`),
    dirs: svg(`<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M8 14h8"/>`),
    cloud: svg(`<path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1A3.5 3.5 0 0 1 18 18z"/>`),
    bypass403: svg(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7-2.6M12 15v2"/>`),
    recovery: svg(`<path d="M21 12a9 9 0 1 1-3-6.7M21 4v4h-4"/>`),
    tls: svg(`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><circle cx="12" cy="15.5" r="1.2"/>`),
    takeover: svg(`<path d="M12 3l8 4v5c0 4.5-3.2 7.5-8 9-4.8-1.5-8-4.5-8-9V7z"/><path d="m9.5 12 2 2 3.5-3.5"/>`),
    crawl: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="19" cy="5" r="1.5"/><circle cx="5" cy="19" r="1.5"/>`),
    params: svg(`<path d="M7 4H5a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h2M17 4h2a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-2"/>`)
  };

  // The flow lives inline as a workspace panel (#tab-flow), like every other menu — not a modal.
  function ensurePanel() {
    const panel = $("tab-flow");
    if (!panel) return null;
    if (panel.dataset.flowReady) return panel;
    panel.dataset.flowReady = "true";
    panel.innerHTML = `
      <div class="recon-flow-console">
        <header class="recon-flow-head">
          <strong id="reconFlowTitle">Recon flow</strong>
          <span id="reconFlowStatus" class="muted"></span>
        </header>
        <div class="recon-flow-body" id="reconFlowBody"></div>
      </div>`;
    // Clicking a stage block toggles its detail panel; clicking it again clears the selection.
    panel.addEventListener("click", (event) => {
      const card = event.target.closest(".recon-flow-stage");
      if (card && card.dataset.stageId) {
        selectedStageId = selectedStageId === card.dataset.stageId ? null : card.dataset.stageId;
        highlightSelected();
        renderDetail();
      }
    });
    return panel;
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function deriveStageStatus({ run, events, toolResults }) {
    const phasesSeen = new Set(events.map((event) => event.phase).filter(Boolean));
    const activePhase = run?.active_phase || "";
    const running = run?.status === "running";
    // With no run loaded, show the pipeline map in a neutral "idle" state (no misleading "Pending").
    const idle = !run;
    const toolStatus = new Map();
    for (const tool of toolResults) {
      const name = String(tool.tool_name || "").replace(/-batch$|-recovery$/, "");
      const prev = toolStatus.get(name);
      // Prefer a completed status over a failed/earlier one.
      if (!prev || tool.status === "completed") toolStatus.set(name, tool.status);
    }
    return STAGES.map((stage, index) => {
      const sawPhase = (stage.phases || []).some((phase) => phasesSeen.has(phase));
      const sawSource = (stage.sources || []).some((source) => events.some((event) => event.source === source));
      const isActive = running && (stage.phases || []).includes(activePhase) && index >= 0;
      let status = idle ? "idle" : "pending";
      if (!idle && (sawPhase || sawSource || (stage.tools || []).some((tool) => toolStatus.has(tool)))) status = "done";
      if (isActive) status = "running";
      const tools = (stage.tools || []).map((tool) => ({ name: tool, status: idle ? "idle" : (toolStatus.get(tool) || "pending") }));
      return { ...stage, status, tools };
    });
  }

  function render({ run, events, counts, toolResults }) {
    const body = $("reconFlowBody");
    const stages = deriveStageStatus({ run, events, toolResults });
    lastStages = stages;
    const statusEl = $("reconFlowStatus");
    if (statusEl) statusEl.textContent = run ? `Run ${run.id} · ${run.status} · phase ${run.active_phase || "-"}` : "No run";
    const running = stages.find((stage) => stage.status === "running");
    const doneCount = stages.filter((stage) => stage.status === "done").length;
    const progress = Math.round((doneCount / stages.length) * 100);
    const phaseBanner = `
      <div class="recon-flow-phase ${running ? "live" : (run ? "idle" : "static")}">
        <span class="recon-flow-phase-pulse"></span>
        <span class="recon-flow-phase-label">${running ? `Running · ${esc(running.label)}` : (run ? `${esc((run.status || "idle"))}` : "Full recon pipeline")}</span>
        <span class="recon-flow-phase-progress"><span style="width:${progress}%"></span></span>
        <span class="recon-flow-phase-pct">${progress}%</span>
      </div>`;
    const summary = counts
      ? `<div class="recon-flow-counts">${["domains", "urls", "httpServices", "technologies", "screenshots"].map((key) => `<span>${esc(labelFor(key))}: <strong>${esc(counts[key] ?? 0)}</strong></span>`).join("")}</div>`
      : "";
    const drawClass = animateNext ? " recon-flow-chain--draw" : "";
    animateNext = false;
    body.innerHTML = `${phaseBanner}${summary}<div class="recon-flow-chain${drawClass}">${stages.map((stage, index) => `
      <div class="recon-flow-stage ${esc(stage.status)}" data-stage-id="${esc(stage.id)}" style="--i:${index}" tabindex="0" role="button" title="${esc(stage.label)} — ${esc(stage.hint)} (click for details)">
        <span class="recon-flow-corner"></span>
        <div class="recon-flow-stage-top">
          <span class="recon-flow-icon">${ICONS[stage.id] || ""}</span>
          <span class="recon-flow-step">${String(index + 1).padStart(2, "0")}</span>
          ${statusLabel(stage.status) ? `<small>${esc(statusLabel(stage.status))}</small>` : ""}
        </div>
        <strong class="recon-flow-stage-name">${esc(stage.label)}</strong>
        <p>${esc(stage.hint)}</p>
        ${stage.tools.length ? `<div class="recon-flow-tools">${stage.tools.map((tool) => `<span class="recon-flow-tool ${esc(tool.status)}">${esc(tool.name)}</span>`).join("")}</div>` : ""}
      </div>${index < stages.length - 1 ? `<div class="recon-flow-arrow ${stage.status === "done" ? "flowed" : stage.status === "running" ? "flowing" : ""}" aria-hidden="true"></div>` : ""}`).join("")}</div>
      <div class="recon-flow-detail" id="reconFlowDetail"></div>`;
    highlightSelected();
    renderDetail();
  }

  function highlightSelected() {
    document.querySelectorAll(".recon-flow-stage").forEach((card) => card.classList.toggle("selected", card.dataset.stageId === selectedStageId));
  }

  function renderDetail() {
    const el = $("reconFlowDetail");
    if (!el) return;
    const stage = lastStages.find((item) => item.id === selectedStageId);
    if (!stage) {
      el.classList.remove("open");
      el.innerHTML = `<p class="recon-flow-detail-hint">Click any stage block above for its phases, tools, and live status.</p>`;
      return;
    }
    el.classList.add("open");
    const chips = (items, mapper) => items.length ? items.map(mapper).join("") : `<span class="recon-flow-chip muted">—</span>`;
    const toolChips = chips(stage.tools, (tool) => `<span class="recon-flow-tool ${esc(tool.status)}">${esc(tool.name)} · ${esc(statusLabel(tool.status))}</span>`);
    const phaseChips = chips(stage.phases || [], (phase) => `<span class="recon-flow-chip">${esc(phase)}</span>`);
    const sourceChips = (stage.sources || []).length
      ? `<div class="recon-flow-detail-col"><h4>Passive sources</h4><div class="recon-flow-chips">${(stage.sources || []).map((source) => `<span class="recon-flow-chip">${esc(source)}</span>`).join("")}</div></div>`
      : "";
    el.innerHTML = `
      <div class="recon-flow-detail-head">
        <span class="recon-flow-dot ${esc(stage.status)}"></span>
        <strong>${esc(stage.label)}</strong>
        <span class="recon-flow-badge ${esc(stage.status)}">${esc(statusLabel(stage.status))}</span>
        <button type="button" class="recon-flow-detail-close" aria-label="Close details">✕</button>
      </div>
      <p class="recon-flow-detail-hint">${esc(stage.hint)}</p>
      <div class="recon-flow-detail-cols">
        <div class="recon-flow-detail-col"><h4>Pipeline phases</h4><div class="recon-flow-chips">${phaseChips}</div></div>
        <div class="recon-flow-detail-col"><h4>Tools</h4><div class="recon-flow-chips">${stage.tools.length ? toolChips : `<span class="recon-flow-chip muted">Internal collectors (no external CLI)</span>`}</div></div>
        ${sourceChips}
      </div>`;
    el.querySelector(".recon-flow-detail-close")?.addEventListener("click", () => { selectedStageId = null; highlightSelected(); renderDetail(); });
  }

  function labelFor(key) {
    return { domains: "Domains", urls: "URLs", httpServices: "Services", technologies: "Tech", screenshots: "Screens" }[key] || key;
  }
  function statusLabel(status) {
    // "idle" (no run loaded) renders no label, so the static map doesn't read as "Pending" everywhere.
    return { done: "Completed", running: "Running", pending: "Pending", idle: "" }[status] ?? status;
  }

  async function refresh() {
    if (!currentRunId) return;
    try {
      const [runData, eventData, countsData, toolData] = await Promise.all([
        api(`/api/recon-runs/${currentRunId}`),
        api(`/api/recon-runs/${currentRunId}/events`),
        api(`/api/recon-runs/${currentRunId}/counts`),
        api(`/api/recon-runs/${currentRunId}/tool-results`)
      ]);
      render({ run: runData.run, events: eventData.events || [], counts: countsData.counts, toolResults: toolData.toolResults || [] });
      const terminal = ["completed", "failed", "cancelled"].includes(runData.run?.status);
      if (terminal && timer) { clearInterval(timer); timer = null; }
    } catch (error) {
      $("reconFlowBody").innerHTML = `<p class="danger-text">${esc(error.message)}</p>`;
    }
  }

  function deriveRunId() {
    return Number(document.getElementById("runId")?.textContent) || null;
  }

  // Render the flow into its panel. Called when the Flow tab is activated.
  function activate(runId) {
    const panel = ensurePanel();
    if (!panel) return;
    currentRunId = (runId === undefined ? deriveRunId() : (runId || null));
    selectedStageId = null;
    animateNext = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (!currentRunId) {
      // No run loaded: show the static pipeline map (idle, no "Pending") so the full flow is still visible.
      render({ run: null, events: [], counts: null, toolResults: [] });
      $("reconFlowStatus").textContent = "No run loaded — showing the full recon pipeline.";
      return;
    }
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // Backward-compatible entry point (status pill): switch to the Flow tab, then render the run.
  function open(runId) {
    document.querySelector('.tab[data-tab="flow"]')?.click();
    activate(runId);
  }

  window.AuraReconFlow = { activate, deactivate, open, close: deactivate };
})();
