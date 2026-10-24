"use strict";

// Recon flow diagram: a block view of the full recon pipeline with per-stage and per-tool status,
// derived from the run's events and tool results. Opens from the run status pill / Status tile.
(function initAuraReconFlow() {
  const $ = (id) => document.getElementById(id);
  const api = (path) => window.auraApi(path);
  const REFRESH_MS = 2500;
  let currentRunId = null;
  let timer = null;

  // Ordered pipeline. `phases` match event.phase values; `tools` are the CLI tools the stage runs.
  const STAGES = [
    { id: "intel", label: "Intel preflight", phases: ["whois-rdap", "provider-discovery", "domain_intelligence", "bootstrap"], tools: [], hint: "WHOIS/RDAP + alternate-TLD correlation" },
    { id: "passive", label: "Passive sources", phases: ["recon"], sources: ["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx"], tools: [], hint: "CT logs, archives, passive DNS, provider APIs" },
    { id: "subdomains", label: "Subdomain & DNS", phases: ["recon"], tools: ["subfinder", "amass", "dnsx", "puredns", "shuffle-dns"], hint: "Enumerate and resolve hosts" },
    { id: "urls", label: "URL mining", phases: ["recon"], tools: ["gau"], hint: "Archived URLs and parameters" },
    { id: "http", label: "HTTP probing", phases: ["recon", "http-tech-followup", "follow-up-http"], tools: ["httpx"], hint: "Live services, status, titles, tech" },
    { id: "tech", label: "Technology enrichment", phases: ["technology-enrichment"], tools: ["retire", "wpscan", "cmseek"], hint: "Per-service tech detectors" },
    { id: "screenshots", label: "Screenshots", phases: ["recon"], tools: ["gowitness", "eyewitness", "chromium"], hint: "Visual triage of live services" },
    { id: "fingerprint", label: "Trackers & favicons", phases: ["tracker-extraction", "favicon-fingerprint"], tools: [], hint: "Analytics IDs and favicon hashes" },
    { id: "dirs", label: "Directory discovery", phases: ["follow-up-dirs"], tools: ["ffuf"], hint: "Content discovery on live services" },
    { id: "cloud", label: "Cloud resources", phases: ["follow-up-cloud"], tools: ["cloud_enum"], hint: "Public cloud buckets/blobs by keyword" },
    { id: "recovery", label: "AI recovery pool", phases: ["ai-action-pool", "ai-tool-recovery"], tools: [], hint: "Retries incomplete phases" }
  ];

  function ensureModal() {
    let modal = $("reconFlowModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "reconFlowModal";
    modal.className = "recon-flow-modal hidden";
    modal.innerHTML = `
      <div class="recon-flow-dialog" role="dialog" aria-modal="true" aria-label="Recon flow">
        <header class="recon-flow-head">
          <strong id="reconFlowTitle">Recon flow</strong>
          <span id="reconFlowStatus" class="muted"></span>
          <button type="button" id="reconFlowClose" class="results-fullscreen-close">Close (Esc)</button>
        </header>
        <div class="recon-flow-body" id="reconFlowBody"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#reconFlowClose").addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.classList.contains("hidden")) close(); });
    return modal;
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function deriveStageStatus({ run, events, toolResults }) {
    const phasesSeen = new Set(events.map((event) => event.phase).filter(Boolean));
    const activePhase = run?.active_phase || "";
    const running = run?.status === "running";
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
      let status = "pending";
      if (sawPhase || sawSource || (stage.tools || []).some((tool) => toolStatus.has(tool))) status = "done";
      if (isActive) status = "running";
      const tools = (stage.tools || []).map((tool) => ({ name: tool, status: toolStatus.get(tool) || "pending" }));
      return { ...stage, status, tools };
    });
  }

  function render({ run, events, counts, toolResults }) {
    const body = $("reconFlowBody");
    const stages = deriveStageStatus({ run, events, toolResults });
    const statusEl = $("reconFlowStatus");
    if (statusEl) statusEl.textContent = run ? `Run ${run.id} · ${run.status} · phase ${run.active_phase || "-"}` : "No run";
    const summary = counts
      ? `<div class="recon-flow-counts">${["domains", "urls", "httpServices", "technologies", "screenshots"].map((key) => `<span>${esc(labelFor(key))}: <strong>${esc(counts[key] ?? 0)}</strong></span>`).join("")}</div>`
      : "";
    body.innerHTML = `${summary}<div class="recon-flow-chain">${stages.map((stage, index) => `
      <div class="recon-flow-stage ${esc(stage.status)}">
        <div class="recon-flow-stage-head"><span class="recon-flow-dot"></span><strong>${esc(stage.label)}</strong><small>${esc(statusLabel(stage.status))}</small></div>
        <p>${esc(stage.hint)}</p>
        ${stage.tools.length ? `<div class="recon-flow-tools">${stage.tools.map((tool) => `<span class="recon-flow-tool ${esc(tool.status)}">${esc(tool.name)}</span>`).join("")}</div>` : ""}
      </div>${index < stages.length - 1 ? '<div class="recon-flow-arrow">↓</div>' : ""}`).join("")}</div>`;
  }

  function labelFor(key) {
    return { domains: "Domains", urls: "URLs", httpServices: "Services", technologies: "Tech", screenshots: "Screens" }[key] || key;
  }
  function statusLabel(status) {
    return { done: "Completed", running: "Running", pending: "Pending" }[status] || status;
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

  function open(runId) {
    if (!runId) return;
    currentRunId = runId;
    const modal = ensureModal();
    modal.classList.remove("hidden");
    document.body.classList.add("recon-flow-open");
    refresh();
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, REFRESH_MS);
  }

  function close() {
    const modal = $("reconFlowModal");
    if (modal) modal.classList.add("hidden");
    document.body.classList.remove("recon-flow-open");
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.AuraReconFlow = { open, close };
})();
