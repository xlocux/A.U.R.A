"use strict";

(function initAuraAiLog() {
  const $ = (id) => document.getElementById(id);

  async function refresh(runId) {
    if (!runId) {
      renderEmpty("No run loaded.");
      return;
    }
    try {
      const data = await window.auraApi(`/api/recon-runs/${runId}/ai-log`);
      renderTechniques(data.techniques || []);
      renderEvents(data.events || []);
    } catch (error) {
      renderEmpty(error.message);
    }
  }

  function renderTechniques(techniques) {
    const container = $("aiCorrelationTechniques");
    if (!container) return;
    container.innerHTML = techniques.map((technique) => `
      <div class="correlation-technique">
        <strong>${escapeHtml(technique.label)}</strong>
        <span>${escapeHtml(technique.description)}</span>
      </div>
    `).join("");
  }

  function renderEvents(events) {
    const rows = $("aiLogRows");
    if (!rows) return;
    if (events.length === 0) {
      rows.innerHTML = `<tr><td colspan="4" class="muted">No AI correlation log for this run yet.</td></tr>`;
      return;
    }
    rows.innerHTML = events.map((event) => `
      <tr>
        <td>${escapeHtml(event.created_at)}</td>
        <td>${escapeHtml(event.source || "ai")}</td>
        <td>${escapeHtml(event.message)}</td>
        <td>${escapeHtml(formatPayload(event.payload))}</td>
      </tr>
    `).join("");
  }

  function renderEmpty(message) {
    const rows = $("aiLogRows");
    if (rows) rows.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(message)}</td></tr>`;
  }

  function formatPayload(payload) {
    if (!payload || Object.keys(payload).length === 0) return "";
    if (payload.technique) return payload.technique;
    if (payload.best?.length) return payload.best.map((item) => `${item.domain}: ${item.score}`).join(", ");
    return payload.stage || "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  window.AuraAiLog = { refresh };
})();
