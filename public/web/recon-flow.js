"use strict";

// Recon flow: a floating "molecular" field of small hexagonal stage tiles joined by live neon links.
// Tiles show only the phase name; hover = tooltip, click = detail modal (command, progress, tools,
// recent events, Ask-AI). Links light up and flow ONLY between stages that are running; idle stages
// stay dark and ignite when they start. Derived from the run's events and tool results.
(function initAuraReconFlow() {
  const $ = (id) => document.getElementById(id);
  const api = (path) => window.auraApi(path);
  const REFRESH_MS = 2500;
  const ZOOM_MIN = 0.7;
  const ZOOM_MAX = 2;

  let currentRunId = null;
  let timer = null;
  let selectedStageId = null;
  let lastStages = [];
  let lastEvents = [];
  let lastToolResults = [];
  let lastRun = null;
  let animateNext = false; // play the short reveal only on the first render after activate
  let zoom = 1;
  let linkRaf = null;

  // Ordered pipeline. `phases` match event.phase values; `tools` are the CLI tools the stage runs.
  const STAGES = [
    { id: "intel", label: "Intel preflight", phases: ["whois-rdap", "provider-discovery", "domain_intelligence", "bootstrap"], tools: [], hint: "WHOIS/RDAP + alternate-TLD correlation" },
    { id: "passive", label: "Passive sources", phases: ["recon"], sources: ["crtsh", "wayback", "rapiddns", "rapid7", "certspotter", "securitytrails", "shodan", "virustotal", "censys", "binaryedge", "urlscan", "hunterio", "passivetotal", "zoomeye", "spyse", "intelx"], tools: [], hint: "CT logs, archives, passive DNS, provider APIs" },
    { id: "subdomains", label: "Subdomain & DNS", phases: ["recon"], tools: ["subfinder", "amass", "dnsx", "puredns", "shuffle-dns"], hint: "Enumerate and resolve hosts" },
    { id: "tls", label: "TLS & certs", phases: ["follow-up-tls"], tools: ["tlsx"], hint: "Harvest SAN hostnames from certificates" },
    { id: "takeover", label: "Takeover", phases: ["follow-up-takeover"], tools: ["subzy"], hint: "Check dangling hosts for subdomain takeover" },
    { id: "urls", label: "URL mining", phases: ["recon"], tools: ["gau"], hint: "Archived URLs and parameters" },
    { id: "crawl", label: "Active crawl", phases: ["follow-up-crawl"], tools: ["katana"], hint: "Crawl live services for endpoints" },
    { id: "params", label: "Param mining", phases: ["follow-up-params"], tools: ["waymore", "paramspider"], hint: "Wider archived URLs and parameters" },
    { id: "http", label: "HTTP probing", phases: ["recon", "http-tech-followup", "follow-up-http"], tools: ["httpx"], hint: "Live services, status, titles, tech" },
    { id: "tech", label: "Tech enrichment", phases: ["technology-enrichment"], tools: ["retire", "wpscan", "cmseek"], hint: "Per-service technology detectors" },
    { id: "js", label: "JS discovery", phases: ["follow-up-js"], tools: ["getJS"], hint: "Extract script URLs from live services" },
    { id: "screenshots", label: "Screenshots", phases: ["recon"], tools: ["gowitness", "eyewitness", "chromium"], hint: "Visual triage of live services" },
    { id: "fingerprint", label: "Trackers & favicons", phases: ["tracker-extraction", "favicon-fingerprint"], tools: [], hint: "Analytics IDs and favicon hashes" },
    { id: "dirs", label: "Directories", phases: ["follow-up-dirs"], tools: ["ffuf"], hint: "Content discovery on live services" },
    { id: "cloud", label: "Cloud resources", phases: ["follow-up-cloud"], tools: ["cloud_enum"], hint: "Public cloud buckets/blobs by keyword" },
    { id: "bypass403", label: "403/401 bypass", phases: ["follow-up-bypass403"], tools: ["gobypass403"], hint: "Access-control bypass attempts on forbidden endpoints" },
    { id: "vuln", label: "Vuln check", phases: ["follow-up-vuln"], tools: ["nuclei"], hint: "nuclei templates + NVD CVE correlation of detected versions" },
    { id: "recovery", label: "AI recovery", phases: ["ai-action-pool", "ai-tool-recovery"], tools: [], hint: "AI retries incomplete phases" }
  ];

  // Organic "molecular" layout (percent of the field), a loose serpentine so consecutive stages are
  // neighbours: top row left→right, middle row right→left, bottom row left→right.
  const POSITIONS = [
    [7, 14], [22, 24], [37, 12], [52, 24], [67, 12], [82, 22],
    [90, 46], [76, 54], [61, 44], [46, 56], [31, 44], [16, 54],
    [8, 80], [24, 88], [40, 78], [56, 88], [72, 78], [88, 86]
  ];

  // Representative command each tool runs (shown in the stage modal).
  const TOOL_CMD = {
    subfinder: "subfinder -d <domain> -silent -all", amass: "amass enum -passive -d <domain>",
    dnsx: "dnsx -l hosts.txt -silent -a -aaaa -cname", puredns: "puredns resolve hosts.txt --write -",
    "shuffle-dns": "shuffledns -d <domain> -w wordlist.txt -silent", gau: "gau <domain>",
    httpx: "httpx -l hosts.txt -ports <ports> -json -silent -status-code -title -tech-detect",
    tlsx: "tlsx -l hosts.txt -san -cn -silent", subzy: "subzy run --targets hosts.txt",
    katana: "katana -list hosts.txt -jc -silent", waymore: "waymore -i <domain> -mode U",
    paramspider: "paramspider -d <domain>", getJS: "getJS --input hosts.txt --complete",
    gowitness: "gowitness scan file -f hosts.txt --screenshot-path shots/",
    eyewitness: "eyewitness --web -f hosts.txt -d out --no-prompt", chromium: "chromium --headless --screenshot <url>",
    ffuf: "ffuf -u <url>/FUZZ -w paths.txt -mc 200,204,301,302,307,401,403,405",
    cloud_enum: "cloud_enum -k <keyword> --quickscan", gobypass403: "gobypass403 -u <url>",
    nuclei: "nuclei -l services.txt -jsonl -severity low,medium,high,critical -rate-limit 50",
    retire: "retire --jspath <js>", wpscan: "wpscan --url <url> --no-banner", cmseek: "cmseek -u <url> --batch"
  };

  const svgIcon = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const ZOOM_ICON_FULL = svgIcon(`<path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3"/>`);

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  function statusLabel(status) {
    return { done: "Completed", running: "Running", pending: "Pending", idle: "" }[status] ?? status;
  }

  // ── Panel scaffolding (built once) ─────────────────────────────────────────
  function ensurePanel() {
    const panel = $("tab-flow");
    if (!panel) return null;
    if (panel.dataset.flowReady) return panel;
    panel.dataset.flowReady = "true";
    panel.innerHTML = `
      <div class="recon-flow-console">
        <header class="recon-flow-head recon-flow-head--min">
          <span id="reconFlowStatus" class="muted"></span>
          <span id="reconFlowBanner" class="recon-flow-banner"></span>
          <div class="recon-flow-zoom" role="group" aria-label="Flow view controls">
            <button type="button" data-flow-zoom="out" title="Zoom out" aria-label="Zoom out">−</button>
            <button type="button" data-flow-zoom="in" title="Zoom in" aria-label="Zoom in">+</button>
            <button type="button" data-flow-zoom="fit" title="Fit to view" aria-label="Fit to view">Fit</button>
            <button type="button" data-flow-zoom="full" title="Fullscreen" aria-label="Fullscreen">${ZOOM_ICON_FULL}</button>
          </div>
        </header>
        <div class="recon-flow-body" id="reconFlowBody"></div>
      </div>`;
    buildField();
    panel.addEventListener("click", (event) => {
      const zoomBtn = event.target.closest("[data-flow-zoom]");
      if (zoomBtn) { applyZoom(zoomBtn.dataset.flowZoom); return; }
      const hex = event.target.closest(".flow-hex");
      if (hex?.dataset.stageId) openStageModal(hex.dataset.stageId);
    });
    return panel;
  }

  // Builds the hex tiles + the SVG link layer once; later refreshes only update classes/attributes
  // so the floating animation never restarts.
  function buildField() {
    const body = $("reconFlowBody");
    const hexes = STAGES.map((stage, index) => {
      const [x, y] = POSITIONS[index] || [50, 50];
      // Deterministic pseudo-random drift so each tile floats on its own rhythm.
      const fx = ((index * 7) % 5) + 3;
      const fy = ((index * 11) % 6) + 3;
      const dur = 6 + ((index * 5) % 6);
      const delay = -((index * 3) % 7);
      return `<div class="flow-hex idle" data-stage-id="${esc(stage.id)}" tabindex="0" role="button" style="left:${x}%;top:${y}%;--i:${index};--fx:${index % 2 ? fx : -fx}px;--fy:${index % 3 ? -fy : fy}px;--dur:${dur}s;--delay:${delay}s">
        <div class="flow-hex-float"><div class="flow-hex-shape"><span class="flow-hex-name">${esc(stage.label)}</span></div></div>
      </div>`;
    }).join("");
    const links = STAGES.slice(0, -1).map((_, index) => `<g class="flow-link off" data-link="${index}"><path class="flow-link-base"/><path class="flow-link-glow"/><path class="flow-link-flow"/></g>`).join("");
    body.innerHTML = `<div class="flow-field" id="flowField"><div class="flow-stage" id="flowStage"><svg class="flow-links" id="flowLinks" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${links}</svg>${hexes}</div></div>`;
    applyZoom("set");
  }

  // ── Zoom / fullscreen ──────────────────────────────────────────────────────
  function applyZoom(mode) {
    if (mode === "in") zoom = Math.min(ZOOM_MAX, +(zoom + 0.2).toFixed(2));
    else if (mode === "out") zoom = Math.max(ZOOM_MIN, +(zoom - 0.2).toFixed(2));
    else if (mode === "fit") zoom = 1;
    else if (mode === "full") { toggleFullscreen(); return; }
    const stage = $("flowStage");
    if (stage) stage.style.setProperty("--zoom", String(zoom));
  }

  function toggleFullscreen() {
    const panel = $("tab-flow");
    if (!panel) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else panel.requestFullscreen?.().catch(() => {});
  }

  // ── Live link drawing ──────────────────────────────────────────────────────
  // Re-measured every frame so the neon curves follow the floating tiles. Links are cheap (17 paths).
  function drawLinks() {
    const stage = $("flowStage");
    const svg = $("flowLinks");
    if (!stage || !svg) return;
    const stageRect = stage.getBoundingClientRect();
    if (!stageRect.width) return;
    const centers = STAGES.map((s) => {
      const shape = stage.querySelector(`.flow-hex[data-stage-id="${s.id}"] .flow-hex-shape`);
      if (!shape) return null;
      const r = shape.getBoundingClientRect();
      return { x: r.left + r.width / 2 - stageRect.left, y: r.top + r.height / 2 - stageRect.top };
    });
    svg.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);
    svg.querySelectorAll(".flow-link").forEach((group) => {
      const index = Number(group.dataset.link);
      const a = centers[index];
      const b = centers[index + 1];
      if (!a || !b) return;
      const d = curvePath(a, b);
      group.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
    });
  }

  // Soft organic cubic curve: leave/enter horizontally for side-by-side tiles, vertically for row jumps.
  function curvePath(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const mx = a.x + dx / 2;
      return `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${mx.toFixed(1)},${a.y.toFixed(1)} ${mx.toFixed(1)},${b.y.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    }
    const my = a.y + dy / 2;
    return `M${a.x.toFixed(1)},${a.y.toFixed(1)} C${a.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  }

  function startLinkLoop() {
    if (linkRaf) return;
    const tick = () => {
      drawLinks();
      linkRaf = requestAnimationFrame(tick);
    };
    linkRaf = requestAnimationFrame(tick);
  }

  function stopLinkLoop() {
    if (linkRaf) cancelAnimationFrame(linkRaf);
    linkRaf = null;
  }

  // ── Status derivation ──────────────────────────────────────────────────────
  function deriveStageStatus({ run, events, toolResults }) {
    const phasesSeen = new Set(events.map((event) => event.phase).filter(Boolean));
    const activePhase = run?.active_phase || "";
    const running = run?.status === "running";
    const idle = !run; // no run loaded: neutral map, no misleading "Pending"
    const toolStatus = new Map();
    for (const tool of toolResults) {
      const name = String(tool.tool_name || "").replace(/-batch$|-recovery$/, "");
      const prev = toolStatus.get(name);
      if (!prev || tool.status === "completed") toolStatus.set(name, tool.status);
    }
    return STAGES.map((stage) => {
      const sawPhase = (stage.phases || []).some((phase) => phasesSeen.has(phase));
      const sawSource = (stage.sources || []).some((source) => events.some((event) => event.source === source));
      const isActive = running && (stage.phases || []).includes(activePhase);
      let status = idle ? "idle" : "pending";
      if (!idle && (sawPhase || sawSource || (stage.tools || []).some((tool) => toolStatus.has(tool)))) status = "done";
      if (isActive) status = "running";
      const tools = (stage.tools || []).map((tool) => ({ name: tool, status: idle ? "idle" : (toolStatus.get(tool) || "pending") }));
      return { ...stage, status, tools };
    });
  }

  function tooltipFor(stage) {
    const state = statusLabel(stage.status);
    const tools = stage.tools.length ? ` · ${stage.tools.map((t) => t.name).join(", ")}` : "";
    return `${stage.label}${state ? ` — ${state}` : ""}\n${stage.hint}${tools}\nClick for details`;
  }

  // ── Render (updates the existing field in place) ───────────────────────────
  function render({ run, events, counts, toolResults }) {
    ensurePanel();
    lastEvents = events || [];
    lastToolResults = toolResults || [];
    const stages = deriveStageStatus({ run, events: lastEvents, toolResults: lastToolResults });
    lastStages = stages;

    const field = $("flowField");
    if (field && animateNext) {
      field.classList.add("flow-field--reveal");
      setTimeout(() => field.classList.remove("flow-field--reveal"), 1400);
    }
    animateNext = false;

    stages.forEach((stage) => {
      const hex = document.querySelector(`.flow-hex[data-stage-id="${stage.id}"]`);
      if (!hex) return;
      hex.className = `flow-hex ${stage.status}${stage.id === selectedStageId ? " selected" : ""}`;
      hex.dataset.tooltip = tooltipFor(stage);
    });
    // A link is lit (and flowing) only while one of its endpoints is actually running; fully done
    // links keep a faint steady trace; everything else stays dark until a stage ignites it.
    document.querySelectorAll(".flow-link").forEach((group) => {
      const i = Number(group.dataset.link);
      const a = stages[i];
      const b = stages[i + 1];
      const lit = a.status === "running" || b.status === "running";
      const trace = a.status === "done" && b.status === "done";
      group.setAttribute("class", `flow-link ${lit ? "on" : trace ? "done" : "off"}`);
    });

    const running = stages.find((stage) => stage.status === "running");
    const doneCount = stages.filter((stage) => stage.status === "done").length;
    const progress = Math.round((doneCount / stages.length) * 100);
    const statusEl = $("reconFlowStatus");
    if (statusEl) {
      statusEl.textContent = run
        ? `Run ${run.id} · ${run.status}${counts ? ` · ${counts.domains ?? 0} domains · ${counts.urls ?? 0} URLs · ${counts.httpServices ?? 0} services · ${counts.technologies ?? 0} tech` : ""}`
        : "No run loaded — showing the full pipeline";
    }
    const banner = $("reconFlowBanner");
    if (banner) {
      banner.className = `recon-flow-banner ${running ? "live" : run ? "idle" : "static"}`;
      banner.innerHTML = run
        ? `<span class="recon-flow-pulse"></span><span>${running ? `Running · ${esc(running.label)}` : esc(run.status || "idle")}</span><span class="recon-flow-bar"><span style="width:${progress}%"></span></span><strong>${progress}%</strong>`
        : "";
    }
    if (document.getElementById("flowStageModal")?.classList.contains("open")) renderStageModal();
  }

  // ── Stage detail modal ─────────────────────────────────────────────────────
  function ensureModal() {
    let modal = $("flowStageModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "flowStageModal";
    modal.className = "flow-modal";
    modal.innerHTML = `<div class="flow-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="flowModalTitle"><div id="flowModalBody"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-flow-close]")) closeModal();
      const ask = event.target.closest("[data-flow-ask]");
      if (ask) askAi(ask.dataset.flowAsk);
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
    return modal;
  }

  function openStageModal(stageId) {
    selectedStageId = stageId;
    ensureModal().classList.add("open");
    renderStageModal();
    document.querySelectorAll(".flow-hex").forEach((hex) => hex.classList.toggle("selected", hex.dataset.stageId === stageId));
  }

  function closeModal() {
    $("flowStageModal")?.classList.remove("open");
    selectedStageId = null;
    document.querySelectorAll(".flow-hex.selected").forEach((hex) => hex.classList.remove("selected"));
  }

  // A completed stage is 100%; while running, show tool completion (min 10% so it never looks stuck).
  function stageProgress(stage) {
    if (stage.status === "done") return 100;
    if (stage.tools.length) {
      const done = stage.tools.filter((t) => t.status === "completed").length;
      const pct = Math.round((done / stage.tools.length) * 100);
      return stage.status === "running" ? Math.max(10, pct) : pct;
    }
    return { running: 50, pending: 0, idle: 0 }[stage.status] ?? 0;
  }

  function latestToolResult(name) {
    const matches = lastToolResults.filter((r) => String(r.tool_name || "").replace(/-batch$|-recovery$/, "") === name);
    return matches[matches.length - 1] || null;
  }

  function renderStageModal() {
    const stage = lastStages.find((s) => s.id === selectedStageId);
    const body = $("flowModalBody");
    if (!stage || !body) return;
    const progress = stageProgress(stage);
    const stageEvents = lastEvents
      .filter((e) => (stage.phases || []).includes(e.phase) || (stage.sources || []).includes(e.source))
      .slice(-6).reverse();
    const toolRows = stage.tools.length
      ? stage.tools.map((tool) => {
          const result = latestToolResult(tool.name);
          const cmd = result?.command_display || TOOL_CMD[tool.name] || tool.name;
          return `<div class="flow-modal-tool"><div class="flow-modal-tool-head"><span class="recon-flow-tool ${esc(tool.status)}">${esc(tool.name)}</span><small>${esc(statusLabel(tool.status) || "ready")}${result?.exit_code != null ? ` · exit ${esc(result.exit_code)}` : ""}</small></div><code>${esc(cmd)}</code></div>`;
        }).join("")
      : `<p class="muted">Internal collectors — no external CLI is launched for this stage.</p>`;
    const eventRows = stageEvents.length
      ? stageEvents.map((e) => `<div class="flow-modal-event ${esc(e.severity || "info")}"><span>${esc(e.source || "-")}</span>${esc(e.message || "")}</div>`).join("")
      : `<p class="muted">No events recorded for this stage yet.</p>`;
    const aiPrompt = `Explain the "${stage.label}" stage of the recon pipeline for the current run (status: ${statusLabel(stage.status) || "not started"}). What has it found or what failed, and what should I run next to go deeper?`;
    body.innerHTML = `
      <div class="flow-modal-head">
        <span class="flow-modal-dot ${esc(stage.status)}"></span>
        <h3 id="flowModalTitle">${esc(stage.label)}</h3>
        <span class="recon-flow-badge ${esc(stage.status)}">${esc(statusLabel(stage.status) || "Ready")}</span>
        <button type="button" class="flow-modal-close" data-flow-close aria-label="Close">×</button>
      </div>
      <p class="flow-modal-hint">${esc(stage.hint)}</p>
      <div class="flow-modal-progress"><span style="width:${progress}%"></span><strong>${progress}%</strong></div>
      <h4>Commands</h4>
      ${toolRows}
      <h4>Pipeline phases</h4>
      <div class="recon-flow-chips">${(stage.phases || []).map((p) => `<span class="recon-flow-chip">${esc(p)}</span>`).join("") || `<span class="recon-flow-chip muted">—</span>`}</div>
      ${(stage.sources || []).length ? `<h4>Passive sources</h4><div class="recon-flow-chips">${stage.sources.map((s) => `<span class="recon-flow-chip">${esc(s)}</span>`).join("")}</div>` : ""}
      <h4>Recent events</h4>
      <div class="flow-modal-events">${eventRows}</div>
      <div class="flow-modal-actions"><button type="button" data-flow-ask="${esc(aiPrompt)}">Ask AI about this stage</button></div>`;
  }

  // Hand off to the AI chat: open it and prefill the question (the operator decides whether to send).
  function askAi(text) {
    const restore = $("aiRestore");
    if (restore?.classList.contains("active")) restore.click();
    const prompt = $("aiPrompt");
    if (prompt) { prompt.value = text; prompt.focus(); }
    closeModal();
  }

  // ── Data refresh / lifecycle ───────────────────────────────────────────────
  async function refresh() {
    if (!currentRunId) return;
    try {
      const [runData, eventData, countsData, toolData] = await Promise.all([
        api(`/api/recon-runs/${currentRunId}`),
        api(`/api/recon-runs/${currentRunId}/events`),
        api(`/api/recon-runs/${currentRunId}/counts`),
        api(`/api/recon-runs/${currentRunId}/tool-results`)
      ]);
      lastRun = runData.run;
      render({ run: runData.run, events: eventData.events || [], counts: countsData.counts, toolResults: toolData.toolResults || [] });
      const terminal = ["completed", "failed", "cancelled"].includes(runData.run?.status);
      if (terminal && timer) { clearInterval(timer); timer = null; }
    } catch (error) {
      const status = $("reconFlowStatus");
      if (status) status.textContent = error.message;
    }
  }

  function deriveRunId() {
    return Number(document.getElementById("runId")?.textContent) || null;
  }

  function activate(runId) {
    const panel = ensurePanel();
    if (!panel) return;
    currentRunId = (runId === undefined ? deriveRunId() : (runId || null));
    selectedStageId = null;
    animateNext = true;
    if (timer) { clearInterval(timer); timer = null; }
    startLinkLoop();
    if (!currentRunId) {
      render({ run: null, events: [], counts: null, toolResults: [] });
      return;
    }
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  }

  function deactivate() {
    if (timer) { clearInterval(timer); timer = null; }
    stopLinkLoop();
    closeModal();
  }

  // Backward-compatible entry point (status pill): switch to the Flow tab, then render the run.
  function open(runId) {
    document.querySelector('.tab[data-tab="flow"]')?.click();
    activate(runId);
  }

  window.AuraReconFlow = { activate, deactivate, open, close: deactivate };
})();