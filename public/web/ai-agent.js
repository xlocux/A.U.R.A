"use strict";

(function initAuraAiAgent() {
  let aiWindowDrag = null;
  let aiRunFeed = emptyRunFeed(null);
  const AI_WINDOW_STORAGE_KEY = "aura.aiWindow";

  const $ = (id) => document.getElementById(id);

  function emptyRunFeed(runId) {
    return {
      runId,
      eventIds: new Set(),
      advisoryKeys: new Set(),
      lastTotals: null,
      lastDelta: null,
      lastTechKeys: new Set(),
      lastScreenshotCount: 0
    };
  }

  async function postAgentPrompt(prompt) {
    const context = window.getAuraAgentContext ? window.getAuraAgentContext() : {};
    const guideContext = window.AuraGuide?.agentContext ? window.AuraGuide.agentContext() : "";
    const enrichedPrompt = guideContext ? [
      "A.U.R.A Guide context:",
      guideContext,
      "",
      "User question:",
      prompt
    ].join("\n") : prompt;
    const data = await window.auraApi("/api/agent/chat", {
      method: "POST",
      body: JSON.stringify({
        prompt: enrichedPrompt,
        targetName: context.targetName || "",
        runId: context.runId || null,
        runtime: context.linuxRuntime || "linux",
        guideContext,
        conversation: getConversationContext()
      })
    });
    return data.message;
  }

  function getConversationContext(limit = 12) {
    return [...$("aiMessages").querySelectorAll(".ai-message")]
      .slice(-limit)
      .map((node) => ({
        role: node.classList.contains("user") ? "user" : "assistant",
        content: node.textContent.trim().slice(0, 1200)
      }))
      .filter((item) => item.content);
  }

  function resetRunFeed(runId) {
    aiRunFeed = emptyRunFeed(runId);
  }

  function publishRunInsights({ run, events, counts, delta, technologies, screenshots }) {
    if (!run) return;
    if (aiRunFeed.runId !== run.id) resetRunFeed(run.id);
    const messages = [];
    for (const event of events || []) {
      if (aiRunFeed.eventIds.has(event.id)) continue;
      aiRunFeed.eventIds.add(event.id);
      const insight = insightFromEvent(event);
      if (insight) messages.push(insight);
    }
    const totalInsight = insightFromTotals(counts);
    if (totalInsight) messages.push(totalInsight);
    const deltaInsight = insightFromDelta(delta);
    if (deltaInsight) messages.push(deltaInsight);
    const techInsight = insightFromTechnologies(technologies);
    if (techInsight) messages.push(techInsight);
    const screenshotInsight = insightFromScreenshots(screenshots);
    if (screenshotInsight) messages.push(screenshotInsight);
    if (["completed", "failed", "cancelled"].includes(run.status)) {
      const finalKey = `final:${run.id}:${run.status}`;
      if (!aiRunFeed.eventIds.has(finalKey)) {
        aiRunFeed.eventIds.add(finalKey);
        messages.push(`Run ${run.id} finished with status ${run.status}. Next useful step: review Results, then run HTTP/Tech Follow-up only if services or screenshots are missing.`);
      }
    }
    for (const message of messages.slice(0, 3)) appendMessage("assistant insight", message);
  }

  function insightFromEvent(event) {
    const text = String(event.message || "");
    const source = event.source || "tool";
    if (event.phase === "ai-tool-recovery") {
      if (event.payload?.stage === "retrying") return once(`tool-retry:${event.payload.toolName}:${event.payload.attempt}`, text);
      if (event.payload?.stage === "recovered") return once(`tool-recovered:${event.payload.toolName}`, text);
      if (event.payload?.stage === "exhausted") return once(`tool-exhausted:${event.payload.toolName}`, text);
      return once(`tool-recovery:${text.slice(0, 80)}`, text);
    }
    if (event.severity === "error") return once(`error:${source}:${text.slice(0, 80)}`, `Attention: ${source} hit an error. Check Runs & Logs before launching another phase.`);
    if (event.severity === "warn" && /No such option: -l/i.test(text) && source === "httpx") {
      return once("httpx-cli-mismatch", "httpx looks like the Python package instead of ProjectDiscovery httpx. Run Settings > Environment > Install / Update Tools, then use HTTP/Tech Follow-up on the saved domains.");
    }
    if (event.severity === "warn" && /not found|exit 127|No such file|command/i.test(text) && /(retire|wpscan|cmseek)/i.test(source)) {
      return once(`missing-detector:${source}`, `${source} is missing. Re-run Settings > Environment > Install / Update Tools so technology enrichment can use it.`);
    }
    if (event.severity === "warn" && /timeout/i.test(text)) {
      return once(`timeout:${source}`, `${source} timed out. Keep the partial results, then run a focused follow-up instead of restarting full discovery.`);
    }
    if (event.severity === "warn" && /(failed|error)/i.test(text)) {
      return once(`warn:${source}:${text.slice(0, 80)}`, `${source} needs attention. Open Runs & Logs for the raw error and continue with the other collected data.`);
    }
    if (/parsed \d+ HTTP services/i.test(text)) return `HTTP probing found live services. Review Results > HTTP Services, then let screenshots and technology enrichment finish before deciding the next phase.`;
    if (/parsed \d+ archived URLs/i.test(text)) return `Archive mining found URLs. Useful next checks: parameter review, Wayback gaps, and endpoints that are not present in the current crawl.`;
    if (/screenshot run completed/i.test(text)) return `Visual triage is ready. Open Results > Screenshots and prioritize unusual login, admin, support, or legacy surfaces.`;
    if (/Recon completed with/i.test(text)) return `Discovery completed. Review the run delta first to see what is new before launching more tools.`;
    return null;
  }

  function once(key, message) {
    if (aiRunFeed.advisoryKeys.has(key)) return null;
    aiRunFeed.advisoryKeys.add(key);
    return message;
  }

  function insightFromTotals(counts = {}) {
    const current = {
      domains: counts.domains || 0,
      services: counts.httpServices || 0,
      technologies: counts.technologies || 0,
      screenshots: counts.screenshots || 0
    };
    const previous = aiRunFeed.lastTotals;
    aiRunFeed.lastTotals = current;
    if (!previous) return null;
    const domainGrowth = current.domains - previous.domains;
    const serviceGrowth = current.services - previous.services;
    if (domainGrowth >= 1000) return `Discovery jump: ${domainGrowth} new domains were added. Let DNS and HTTP validation catch up before starting another broad phase.`;
    if (serviceGrowth >= 25) return `HTTP surface expanded by ${serviceGrowth} services. Good moment to inspect technologies and screenshot clusters.`;
    return null;
  }

  function insightFromDelta(delta) {
    if (!delta?.comparedToRunId) return null;
    const current = {
      addedDomains: delta.domains.addedCount || 0,
      addedServices: delta.httpServices.addedCount || 0,
      addedUrls: delta.urls.addedCount || 0
    };
    const previous = aiRunFeed.lastDelta;
    aiRunFeed.lastDelta = current;
    if (previous && previous.addedDomains === current.addedDomains && previous.addedServices === current.addedServices && previous.addedUrls === current.addedUrls) return null;
    if (current.addedDomains || current.addedServices || current.addedUrls) {
      return `Run delta vs ${delta.comparedToRunId}: ${current.addedDomains} new domains, ${current.addedServices} new services, ${current.addedUrls} new URLs. Prioritize the new items first.`;
    }
    return null;
  }

  function insightFromTechnologies(technologies = []) {
    const keys = new Set(technologies.map((tech) => String(tech.name || "").toLowerCase()).filter(Boolean));
    const newTech = [...keys].filter((key) => !aiRunFeed.lastTechKeys.has(key));
    aiRunFeed.lastTechKeys = keys;
    if (newTech.length === 0) return null;
    const top = technologies
      .filter((tech) => newTech.includes(String(tech.name || "").toLowerCase()))
      .slice(0, 5)
      .map((tech) => `${tech.name} (${tech.count})`);
    return top.length ? `Technology stack changed: ${top.join(", ")}. Use Search to pivot by any tech with fresh CVEs.` : null;
  }

  function insightFromScreenshots(screenshots = []) {
    const total = screenshots.reduce((sum, shot) => sum + Number(shot.metadata?.screenshotCount || 0), 0);
    if (total <= aiRunFeed.lastScreenshotCount) return null;
    const delta = total - aiRunFeed.lastScreenshotCount;
    aiRunFeed.lastScreenshotCount = total;
    return `Visual triage captured ${delta} new screenshots. Look for low-traffic portals, auth screens, and old branding.`;
  }

  function appendMessage(role, text) {
    const message = document.createElement("div");
    message.className = `ai-message ${role}`;
    message.textContent = text;
    $("aiMessages").appendChild(message);
    $("aiMessages").scrollTop = $("aiMessages").scrollHeight;
  }

  async function sendPrompt() {
    const prompt = $("aiPrompt").value.trim();
    if (!prompt) return;
    $("sendAiPrompt").disabled = true;
    appendMessage("user", prompt);
    $("aiPrompt").value = "";
    try {
      appendMessage("assistant", await postAgentPrompt(prompt));
    } catch (error) {
      appendMessage("assistant", error.message);
    } finally {
      $("sendAiPrompt").disabled = false;
      $("aiPrompt").focus();
    }
  }

  function getWindowState() {
    try {
      return JSON.parse(localStorage.getItem(AI_WINDOW_STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function saveWindowState() {
    const panel = $("aiPanel");
    const rect = panel.getBoundingClientRect();
    localStorage.setItem(AI_WINDOW_STORAGE_KEY, JSON.stringify({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      minimized: panel.classList.contains("minimized")
    }));
  }

  function applyWindowState() {
    const panel = $("aiPanel");
    const state = getWindowState();
    if (Number.isFinite(state.width)) panel.style.width = `${state.width}px`;
    if (Number.isFinite(state.height)) panel.style.height = `${state.height}px`;
    if (Number.isFinite(state.left)) panel.style.left = `${state.left}px`;
    if (Number.isFinite(state.top)) panel.style.top = `${state.top}px`;
    if (state.minimized) {
      panel.classList.add("minimized");
      $("aiRestore").classList.add("active");
    }
    clampPanel();
  }

  function clampPanel() {
    const panel = $("aiPanel");
    if (panel.classList.contains("minimized")) return;
    const margin = 16;
    const minWidth = 280;
    const minHeight = 240;
    const maxWidth = Math.max(minWidth, window.innerWidth - margin * 2);
    const maxHeight = Math.max(minHeight, window.innerHeight - margin * 2);
    const rect = panel.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, minWidth), maxWidth);
    const height = Math.min(Math.max(rect.height, minHeight), maxHeight);
    const left = Math.min(Math.max(rect.left, margin), window.innerWidth - width - margin);
    const top = Math.min(Math.max(rect.top, margin), window.innerHeight - height - margin);
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function minimizePanel() {
    $("aiPanel").classList.add("minimized");
    $("aiRestore").classList.add("active");
    saveWindowState();
  }

  function restorePanel() {
    $("aiPanel").classList.remove("minimized");
    $("aiRestore").classList.remove("active");
    clampPanel();
    saveWindowState();
  }

  function startDrag(event) {
    if (event.target.closest("button")) return;
    const rect = $("aiPanel").getBoundingClientRect();
    aiWindowDrag = { type: "move", pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    $("aiDragHandle").setPointerCapture(event.pointerId);
  }

  function startResize(event) {
    const rect = $("aiPanel").getBoundingClientRect();
    aiWindowDrag = { type: "resize", edge: event.target.dataset.resize, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    event.target.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function updateWindow(event) {
    if (!aiWindowDrag) return;
    const panel = $("aiPanel");
    const deltaX = event.clientX - aiWindowDrag.startX;
    const deltaY = event.clientY - aiWindowDrag.startY;
    let { left, top, width, height } = aiWindowDrag;
    if (aiWindowDrag.type === "move") {
      left += deltaX;
      top += deltaY;
    } else {
      if (aiWindowDrag.edge.includes("e")) width += deltaX;
      if (aiWindowDrag.edge.includes("s")) height += deltaY;
      if (aiWindowDrag.edge.includes("w")) {
        width -= deltaX;
        left += deltaX;
      }
      if (aiWindowDrag.edge.includes("n")) {
        height -= deltaY;
        top += deltaY;
      }
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    clampPanel();
  }

  function endWindowEdit() {
    if (!aiWindowDrag) return;
    aiWindowDrag = null;
    clampPanel();
    saveWindowState();
  }

  function bind() {
    $("sendAiPrompt").addEventListener("click", sendPrompt);
    $("aiMinimize").addEventListener("click", minimizePanel);
    $("aiRestore").addEventListener("click", restorePanel);
    $("aiDragHandle").addEventListener("pointerdown", startDrag);
    document.querySelectorAll(".ai-resize-handle").forEach((handle) => {
      handle.addEventListener("pointerdown", startResize);
    });
    window.addEventListener("pointermove", updateWindow);
    window.addEventListener("pointerup", endWindowEdit);
    window.addEventListener("resize", () => {
      clampPanel();
      saveWindowState();
    });
    $("aiPrompt").addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) sendPrompt();
    });
    applyWindowState();
  }

  window.AuraAiAgent = {
    appendMessage,
    ask: postAgentPrompt,
    bind,
    publishRunInsights,
    resetRunFeed
  };
})();
