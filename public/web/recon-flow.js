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
  const announcedEvents = new Set(); // event ids already handled by announceNew
  const announcedTools = new Set(); // tool names whose failure was already announced
  let prevStatus = null; // stage id -> last status, to detect a stage finishing

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
    { id: "screenshots", label: "Screens", phases: ["recon"], tools: ["gowitness", "eyewitness", "chromium"], hint: "Visual triage of live services" },
    { id: "fingerprint", label: "Trackers & favicons", phases: ["tracker-extraction", "favicon-fingerprint"], tools: [], hint: "Analytics IDs and favicon hashes" },
    { id: "dirs", label: "Directories", phases: ["follow-up-dirs"], tools: ["ffuf"], hint: "Content discovery on live services" },
    { id: "cloud", label: "Cloud resources", phases: ["follow-up-cloud"], tools: ["cloud_enum"], hint: "Public cloud buckets/blobs by keyword" },
    { id: "bypass403", label: "403/401 bypass", phases: ["follow-up-bypass403"], tools: ["gobypass403"], hint: "Access-control bypass attempts on forbidden endpoints" },
    { id: "recovery", label: "AI recovery", phases: ["ai-action-pool", "ai-tool-recovery"], tools: [], hint: "AI retries incomplete phases" },
    // ── Vulnerability zone: a distinct phase that starts once recon has produced live services ──
    { id: "vport", zone: "vuln", label: "Port scan", phases: ["follow-up-ports"], tools: ["nmap"], hint: "nmap service/version detection on the chosen ports" },
    { id: "vversion", zone: "vuln", strict: true, label: "Version → CVE", phases: ["follow-up-vuln"], sources: ["nvd"], tools: [], hint: "Detected software versions correlated with NVD CVEs" },
    { id: "vnuclei", zone: "vuln", strict: true, label: "Template scan", phases: ["follow-up-vuln"], sources: ["nuclei"], tools: ["nuclei"], hint: "nuclei templates against live services (CVE / misconfig / exposure)" }
  ];
  STAGES.forEach((stage) => { stage.zone = stage.zone || "recon"; });

  // Categories drive the tile colour (theme-aware, see flow-hex.css). vuln uses the theme's "bad" colour.
  const CATEGORY_OF = {
    intel: "osint", passive: "osint",
    subdomains: "enum", tls: "enum", takeover: "enum",
    urls: "content", crawl: "content", params: "content", js: "content", dirs: "content",
    http: "analysis", tech: "analysis", screenshots: "analysis", fingerprint: "analysis",
    cloud: "exposure", bypass403: "exposure", recovery: "ai",
    vport: "vuln", vversion: "vuln", vnuclei: "vuln"
  };
  const CATEGORY_LABEL = { osint: "Intel", enum: "Enumeration", content: "Content", analysis: "Analysis", exposure: "Exposure", ai: "AI", vuln: "Vulnerability" };
  STAGES.forEach((stage) => { stage.cat = CATEGORY_OF[stage.id] || "osint"; });

  // Organic "molecular" layout (percent of the field). Recon (left ~75%) is a loose 3-row serpentine;
  // the vulnerability phase sits in its own zone on the right, entered through the handoff divider.
  const POSITIONS = [
    [7, 21], [19.3, 31], [31.6, 19], [43.9, 31], [56.2, 19], [68.5, 29],
    [66, 51], [53.7, 59], [41.4, 49], [29.1, 61], [16.8, 49],
    [8, 80], [20, 87], [32, 78], [44, 87], [56, 78], [68, 85],
    [88, 75], [90, 51], [88, 27]
  ];
  const DIVIDER_X = 77; // percent

  // Synapses: data-dependency / correlation links between NON-consecutive stages (what feeds what).
  // They fire (pulse along a curved dendrite) when an endpoint is running or a correlation event lands.
  const SYNAPSES = [
    ["tls", "subdomains"], ["subdomains", "http"], ["urls", "params"], ["crawl", "js"], ["http", "tech"],
    ["http", "screenshots"], ["http", "bypass403"], ["subdomains", "cloud"], ["params", "dirs"],
    ["tech", "vversion"], ["http", "vport"], ["http", "vnuclei"], ["vport", "vversion"]
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
    nmap: "nmap -iL hosts.txt -p <ports> -sV --open -T3", nuclei: "nuclei -l services.txt -jsonl -severity low,medium,high,critical -rate-limit 50",
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
          <span class="flow-legend" aria-label="Category colours">${Object.entries(CATEGORY_LABEL).map(([key, label]) => `<i data-cat="${key}"><b></b><em>${label}</em></i>`).join("")}</span>
          <div class="recon-flow-zoom" role="group" aria-label="Flow view controls"><button type="button" class="flow-ctl" data-flow-zoom="out" title="Zoom out" aria-label="Zoom out"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/></svg></button><button type="button" class="flow-ctl" data-flow-zoom="in" title="Zoom in" aria-label="Zoom in"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button><button type="button" class="flow-ctl" data-flow-zoom="fit" title="Fit to view" aria-label="Fit to view"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3"/><circle cx="12" cy="12" r="2.2"/></svg></button><button type="button" class="flow-ctl" data-flow-zoom="full" title="Fullscreen" aria-label="Fullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg></button></div>
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

  // Per-tile decoration, drawn in a 200x200 box centred on the tile (hex radius ~67 units).
  // Layers: segmented contour, corner brackets, HUD ring + arcs, and circuit traces with pads.
  // All geometry is deterministic per tile index so every tile looks related but not identical.
  function decoSvg(index) {
    const vertex = (r, k) => [r * Math.cos((k * Math.PI) / 3), r * Math.sin((k * Math.PI) / 3)];
    const fmt = (p) => p[0].toFixed(1) + "," + p[1].toFixed(1);
    const contour = [0, 1, 2, 3, 4, 5].map((k) => fmt(vertex(74, k))).join(" ");
    let brackets = "";
    for (let k = 0; k < 6; k += 1) {
      const v = vertex(78, k);
      const prev = vertex(78, (k + 5) % 6);
      const next = vertex(78, (k + 1) % 6);
      const toward = (q) => [v[0] + (q[0] - v[0]) * 0.24, v[1] + (q[1] - v[1]) * 0.24];
      brackets += '<polyline class="fx-brk" points="' + fmt(toward(prev)) + " " + fmt(v) + " " + fmt(toward(next)) + '"/>';
    }
    // Two opposite sides carry circuit traces (chip-pin look), chosen per tile.
    let traces = "";
    for (const side of [(index * 5) % 6, ((index * 5) % 6 + 3) % 6]) {
      const angle = ((side + 0.5) * Math.PI) / 3;
      const u = [Math.cos(angle), Math.sin(angle)];
      const p = [-u[1], u[0]];
      for (const j of [-1, 0, 1]) {
        const start = [u[0] * 66 + p[0] * j * 9, u[1] * 66 + p[1] * j * 9];
        const bend = [start[0] + u[0] * (j === 0 ? 14 : 8), start[1] + u[1] * (j === 0 ? 14 : 8)];
        const end = [bend[0] + (u[0] * 0.7 + p[0] * j * 0.7) * 10, bend[1] + (u[1] * 0.7 + p[1] * j * 0.7) * 10];
        traces += '<polyline class="fx-tr" points="' + fmt(start) + " " + fmt(bend) + " " + fmt(end) + '"/><circle class="fx-pad" cx="' + end[0].toFixed(1) + '" cy="' + end[1].toFixed(1) + '" r="1.9"/>';
      }
    }
    return '<svg class="flow-deco" viewBox="-100 -100 200 200" aria-hidden="true">' +
      '<circle class="fx-ring" r="90"/><circle class="fx-arc" r="95" pathLength="100"/>' +
      '<polygon class="fx-seg" pathLength="100" points="' + contour + '"/>' + brackets + traces + "</svg>";
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
      const vertices = ["v1", "v2", "v3", "v4", "v5", "v6"].map((v) => `<i class="flow-vtx ${v}"></i>`).join("");
      return `<div class="flow-hex idle" data-stage-id="${esc(stage.id)}" data-zone="${esc(stage.zone)}" data-cat="${esc(stage.cat)}" tabindex="0" role="button" style="left:${x}%;top:${y}%;--i:${index};--fx:${index % 2 ? fx : -fx}px;--fy:${index % 3 ? -fy : fy}px;--dur:${dur}s;--delay:${delay}s">
        <div class="flow-hex-float">${decoSvg(index)}${vertices}<div class="flow-hex-shape"><span class="flow-hex-ring"></span><span class="flow-hex-core"></span><span class="flow-hex-name">${esc(stage.label)}</span></div></div>
      </div>`;
    }).join("");
    const links = STAGES.slice(0, -1).map((_, index) => `<g class="flow-link off" data-link="${index}"><path class="flow-link-base"/><path class="flow-link-glow"/><path class="flow-link-flow"/><path class="flow-link-glint" pathLength="100"/></g>`).join("");
    // Two glowing "data packets" ride each link while it is active (positioned via CSS offset-path).
    const packets = STAGES.slice(0, -1).map((_, index) => `<i class="flow-packet" data-packet="${index}" style="--pd:0s"></i><i class="flow-packet" data-packet="${index}" style="--pd:-0.75s"></i>`).join("");
    const synapses = SYNAPSES.map((_, k) => `<g class="flow-syn off" data-syn="${k}"><path class="syn-base"/><path class="syn-pulse" pathLength="100"/></g>`).join("");
    const zones = `<div class="flow-zone-label recon" style="left:1.5%">RECON<small>discovery &amp; enumeration</small></div>
      <div class="flow-zone-label vuln" style="left:${DIVIDER_X + 2.5}%">VULNERABILITY<small>exposure &amp; CVE</small></div>`;
    body.innerHTML = `<div class="flow-field" id="flowField"><div class="flow-stage" id="flowStage">${zones}<svg class="flow-links" id="flowLinks" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><g class="flow-synapses">${synapses}</g>${links}</svg>${packets}${hexes}</div></div>`;
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
    // No scrollbar at the default fit; only scroll while zoomed in.
    const field = $("flowField");
    if (field) field.style.overflow = zoom > 1 ? "auto" : "hidden";
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
    const firstShape = stage.querySelector(".flow-hex-shape");
    const hexW = firstShape ? firstShape.getBoundingClientRect().width : 110;
    svg.setAttribute("viewBox", `0 0 ${stageRect.width} ${stageRect.height}`);
    svg.querySelectorAll(".flow-link").forEach((group) => {
      const index = Number(group.dataset.link);
      const a = centers[index];
      const b = centers[index + 1];
      if (!a || !b) return;
      const d = curvePath(a, b, hexW);
      group.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
      if (group.classList.contains("on")) {
        stage.querySelectorAll(`.flow-packet[data-packet="${index}"]`).forEach((packet) => { packet.style.offsetPath = `path("${d}")`; });
      }
    });
    const idIndex = new Map(STAGES.map((s, i) => [s.id, i]));
    svg.querySelectorAll(".flow-syn").forEach((group) => {
      const [fromId, toId] = SYNAPSES[Number(group.dataset.syn)];
      const a = centers[idIndex.get(fromId)];
      const b = centers[idIndex.get(toId)];
      if (!a || !b) return;
      const d = synapsePath(a, b, Number(group.dataset.syn) % 2 ? 1 : -1, hexW);
      group.querySelectorAll("path").forEach((p) => p.setAttribute("d", d));
    });
  }

  // Dendrite-like arc: a quadratic curve bowed perpendicular to the line between two tiles, trimmed at the tile edge.
  function synapsePath(a0, b0, side, hexW = 110) {
    const dx0 = b0.x - a0.x;
    const dy0 = b0.y - a0.y;
    const len0 = Math.hypot(dx0, dy0) || 1;
    const trim = hexW * 0.5 + 3;
    const a = { x: a0.x + (dx0 / len0) * trim, y: a0.y + (dy0 / len0) * trim };
    const b = { x: b0.x - (dx0 / len0) * trim, y: b0.y - (dy0 / len0) * trim };
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bow = Math.min(70, len * 0.22) * side;
    const cx = mx + (-dy / len) * bow;
    const cy = my + (dx / len) * bow;
    return "M" + a.x.toFixed(1) + "," + a.y.toFixed(1) + " Q" + cx.toFixed(1) + "," + cy.toFixed(1) + " " + b.x.toFixed(1) + "," + b.y.toFixed(1);
  }

  // Soft organic cubic curve between two tiles, trimmed so it starts/ends at the tile edge: it leaves through
  // the left/right vertex for side-by-side tiles and through the top/bottom edge for row jumps.
  function curvePath(a, b, hexW = 110) {
    const gap = 3;
    const rx = hexW / 2 + gap;
    const ry = hexW * 0.433 + gap;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const f = (n) => n.toFixed(1);
    if (Math.abs(dx) >= Math.abs(dy)) {
      const sx = Math.sign(dx) || 1;
      const x1 = a.x + sx * rx;
      const x2 = b.x - sx * rx;
      const mx = (x1 + x2) / 2;
      return "M" + f(x1) + "," + f(a.y) + " C" + f(mx) + "," + f(a.y) + " " + f(mx) + "," + f(b.y) + " " + f(x2) + "," + f(b.y);
    }
    const sy = Math.sign(dy) || 1;
    const y1 = a.y + sy * ry;
    const y2 = b.y - sy * ry;
    const my = (y1 + y2) / 2;
    return "M" + f(a.x) + "," + f(y1) + " C" + f(a.x) + "," + f(my) + " " + f(b.x) + "," + f(my) + " " + f(b.x) + "," + f(y2);
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
      const sawPhase = !stage.strict && (stage.phases || []).some((phase) => phasesSeen.has(phase));
      const sawSource = (stage.sources || []).some((source) => events.some((event) => event.source === source));
      const isActive = running && (stage.phases || []).includes(activePhase);
      let status = idle ? "idle" : "pending";
      if (!idle && (sawPhase || sawSource || (stage.tools || []).some((tool) => toolStatus.has(tool)))) status = "done";
      if (isActive) status = "running";
      const tools = (stage.tools || []).map((tool) => ({ name: tool, status: idle ? "idle" : (toolStatus.get(tool) || "pending") }));
      return { ...stage, status, tools };
    });
  }

  // Stage ids touched by a correlation/AI event in the last 90s (events carry created_at timestamps).
  function hotStageIds(events, stages) {
    const hot = new Set();
    const now = Date.now();
    for (const event of events || []) {
      const label = `${event.phase || ""} ${event.source || ""}`;
      if (!/correlat|ai-|ai_/i.test(label)) continue;
      const t = Date.parse(event.created_at || "");
      if (!Number.isNaN(t) && now - t > 90000) continue;
      for (const stage of stages) {
        const hit = (stage.phases || []).includes(event.phase) || (stage.sources || []).includes(event.source) || (stage.tools || []).some((tool) => tool.name === event.source);
        if (hit) hot.add(stage.id);
      }
    }
    return hot;
  }

  // Tell the avatar about notable things: new vulnerability findings and failing tools. The first
  // render of a run only records what already happened, so reopening a finished run stays quiet.
  function announceNew(firstRender) {
    let vulnCount = 0;
    let vulnStage = "vnuclei";
    for (const event of lastEvents) {
      if (announcedEvents.has(event.id)) continue;
      announcedEvents.add(event.id);
      if (firstRender || event.phase !== "follow-up-vuln") continue;
      const match = String(event.message || "").match(/(\d+)\s+(?:template finding|CVE)/i);
      const n = match ? Number(match[1]) : 0;
      if (n > 0) { vulnCount += n; vulnStage = event.source === "nvd" ? "vversion" : "vnuclei"; }
    }
    if (vulnCount > 0) window.dispatchEvent(new CustomEvent("aura:ai", { detail: { type: "vuln", count: vulnCount, stageId: vulnStage } }));
    for (const result of lastToolResults) {
      const name = String(result.tool_name || "").replace(/-batch$|-recovery$|-\d+$/, "");
      if (!name || announcedTools.has(name)) continue;
      if (!/^(failed|timeout|error)$/i.test(String(result.status || ""))) continue;
      announcedTools.add(name);
      if (firstRender) continue;
      const word = /timeout/i.test(result.status) ? "timed out" : "failed";
      window.dispatchEvent(new CustomEvent("aura:ai", { detail: { type: "tool-fail", text: name + " " + word + " - I'll keep an eye on it." } }));
    }
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

    // A stage that just finished (was pending/running, now done): let the AI avatar react to it.
    // Only one announcement per refresh, preferring the vulnerability zone; never on the first render.
    const firstRender = !prevStatus;
    if (prevStatus) {
      const finished = stages.filter((s) => s.status === "done" && (prevStatus[s.id] === "running" || prevStatus[s.id] === "pending"));
      const pick = finished.find((s) => s.zone === "vuln") || finished[0];
      if (pick) window.dispatchEvent(new CustomEvent("aura:ai", { detail: { type: "stage", stageId: pick.id, label: pick.label, zone: pick.zone } }));
    }
    prevStatus = Object.fromEntries(stages.map((s) => [s.id, s.status]));
    announceNew(firstRender);

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
      group.dataset.cat = b.cat;
      const zone = b.zone === "vuln" ? " zone-vuln" : "";
      const gate = a.zone !== b.zone ? " gate" : "";
      group.setAttribute("class", `flow-link ${lit ? "on" : trace ? "done" : "off"}${zone}${gate}`);
      document.querySelectorAll(`.flow-packet[data-packet="${i}"]`).forEach((packet) => {
        packet.classList.toggle("live", lit);
        packet.dataset.cat = b.cat;
        packet.classList.toggle("zone-vuln", b.zone === "vuln");
      });
    });

    // Synapses fire while a connected stage runs or when a fresh correlation/AI event touches either end;
    // otherwise two completed stages keep a faint trace, and nothing shows before the run starts.
    const hot = hotStageIds(lastEvents, stages);
    const byId = new Map(stages.map((s) => [s.id, s]));
    document.querySelectorAll(".flow-syn").forEach((group) => {
      const [fromId, toId] = SYNAPSES[Number(group.dataset.syn)];
      const a = byId.get(fromId);
      const b = byId.get(toId);
      const fire = a.status === "running" || b.status === "running" || hot.has(fromId) || hot.has(toId);
      const dim = a.status === "done" && b.status === "done";
      group.setAttribute("class", `flow-syn ${fire ? "fire" : dim ? "dim" : "off"}${b.zone === "vuln" ? " zone-vuln" : ""}`);
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
    modal.innerHTML = `<div class="flow-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="flowModalTitle"><span class="fm-corner tl"></span><span class="fm-corner tr"></span><span class="fm-corner bl"></span><span class="fm-corner br"></span><div class="flow-modal-noise"></div><div class="flow-modal-lost"><b>SIGNAL LOST</b><small>link terminated</small></div><div id="flowModalBody"></div></div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-flow-close]")) closeModal();
      const ask = event.target.closest("[data-flow-ask]");
      if (ask) askAi(ask.dataset.flowAsk);
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
    return modal;
  }

  let closeTimer = null;

  function openStageModal(stageId) {
    selectedStageId = stageId;
    const modal = ensureModal();
    clearTimeout(closeTimer);
    modal.classList.remove("closing");
    modal.classList.add("open", "booting");
    setTimeout(() => modal.classList.remove("booting"), 750);
    renderStageModal();
    document.querySelectorAll(".flow-hex").forEach((hex) => hex.classList.toggle("selected", hex.dataset.stageId === stageId));
  }

  function closeModal() {
    const modal = $("flowStageModal");
    if (modal?.classList.contains("open") && !modal.classList.contains("closing")) {
      // "Signal lost": the panel tears/collapses to a line over static, then disappears.
      modal.classList.remove("booting");
      modal.classList.add("closing");
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => modal.classList.remove("open", "closing"), 700);
    }
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
    const index = STAGES.findIndex((s) => s.id === stage.id);
    const segs = 20;
    const lit = Math.round((progress / 100) * segs);
    const segBar = Array.from({ length: segs }, (_, i) => `<i class="${i < lit ? "on" : ""}"></i>`).join("");
    $("flowStageModal")?.setAttribute("data-zone", stage.zone || "recon");
    $("flowStageModal")?.setAttribute("data-cat", stage.cat);
    body.innerHTML = `
      <div class="flow-modal-head">
        <span class="flow-modal-tag">STAGE // ${String(index + 1).padStart(2, "0")} · ${esc((CATEGORY_LABEL[stage.cat] || stage.zone).toUpperCase())}</span>
        <span class="recon-flow-badge ${esc(stage.status)}">${esc(statusLabel(stage.status) || "Ready")}</span>
        <button type="button" class="flow-modal-close" data-flow-close aria-label="Close">×</button>
      </div>
      <h3 id="flowModalTitle" class="flow-modal-title"><span class="flow-modal-dot ${esc(stage.status)}"></span><span data-text="${esc(stage.label)}">${esc(stage.label)}</span></h3>
      <p class="flow-modal-hint">${esc(stage.hint)}</p>
      <div class="flow-modal-progress"><div class="seg">${segBar}</div><strong>${progress}%</strong></div>
      <h4>Commands</h4>
      ${toolRows}
      <h4>Pipeline phases</h4>
      <div class="recon-flow-chips">${(stage.phases || []).map((p) => `<span class="recon-flow-chip">${esc(p)}</span>`).join("") || `<span class="recon-flow-chip muted">—</span>`}</div>
      ${(stage.sources || []).length ? `<h4>Sources</h4><div class="recon-flow-chips">${stage.sources.map((s) => `<span class="recon-flow-chip">${esc(s)}</span>`).join("")}</div>` : ""}
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
    prevStatus = null;
    announcedEvents.clear();
    announcedTools.clear();
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