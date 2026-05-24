"use strict";

(function initAuraGuideDetails() {
  function boot() {
    const guide = window.AuraGuideData;
    const panel = document.getElementById("tab-guide");
    if (!guide || !panel || document.getElementById("guideDetails")) return;
    injectStyles();
    const wrapper = document.createElement("div");
    wrapper.id = "guideDetails";
    wrapper.innerHTML = [
      section("Visible sources and tools", renderGroups(guide.toolGroups || [])),
      section("Candidate correlation techniques", renderCorrelations(guide.correlations || []))
    ].join("");
    panel.appendChild(wrapper);
    patchAgentContext(guide);
  }

  function section(title, html) {
    return `<div class="pane guide-deep-section"><h2>${esc(title)}</h2>${html}</div>`;
  }

  function renderGroups(groups) {
    return groups.map((group) => `
      <div class="guide-deep-group">
        <h3>${esc(group.title)}</h3>
        <div class="guide-deep-grid">${(group.items || []).map(renderTool).join("")}</div>
      </div>
    `).join("");
  }

  function renderTool(item) {
    return `
      <article class="guide-deep-card">
        <div class="guide-deep-head"><strong>${esc(item.name)}</strong><em>${esc(item.status)}</em></div>
        <p>${esc(item.purpose)}</p>
        <dl>
          <dt>Collects</dt><dd>${esc(item.collects)}</dd>
          <dt>Use when</dt><dd>${esc(item.useWhen)}</dd>
          <dt>Feeds</dt><dd>${esc(item.feeds)}</dd>
        </dl>
      </article>
    `;
  }

  function renderCorrelations(items) {
    return `
      <p class="guide-deep-muted">“Not run” means the current run has not produced enough candidate data or evidence for that specific technique yet. It is a state indicator, not automatically an error.</p>
      <div class="guide-deep-grid">${items.map(renderCorrelation).join("")}</div>
    `;
  }

  function renderCorrelation(item) {
    return `
      <article class="guide-deep-card">
        <div class="guide-deep-head"><strong>${esc(item.name)}</strong><em>correlation</em></div>
        <p><b>Not run:</b> ${esc(item.statusMeaning)}</p>
        <p><b>Evidence:</b> ${esc(item.evidence)}</p>
        <p><b>Sources:</b> ${esc(item.sources)}</p>
        <p><b>Action:</b> ${esc(item.action)}</p>
      </article>
    `;
  }

  function patchAgentContext(guide) {
    if (!window.AuraGuide || window.AuraGuide.__deepContextPatched) return;
    const previous = window.AuraGuide.agentContext;
    window.AuraGuide.agentContext = () => [
      previous ? previous() : "",
      "Detailed Guide data:",
      JSON.stringify(guide).slice(0, 16000)
    ].filter(Boolean).join("\n");
    window.AuraGuide.__deepContextPatched = true;
  }

  function injectStyles() {
    if (document.getElementById("aura-guide-details-style")) return;
    const style = document.createElement("style");
    style.id = "aura-guide-details-style";
    style.textContent = `
      .guide-deep-section { padding: 16px; margin-top: 12px; }
      .guide-deep-section h2 { padding: 0 0 10px; margin: 0 0 10px; }
      .guide-deep-group { margin-top: 12px; }
      .guide-deep-group h3 { margin: 0 0 8px; color: var(--accent-2); }
      .guide-deep-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .guide-deep-card { border: 1px solid var(--line); border-radius: 10px; padding: 11px; background: rgba(10, 14, 20, .38); }
      .guide-deep-card p, .guide-deep-card dd, .guide-deep-muted { color: var(--muted); line-height: 1.45; }
      .guide-deep-card dl { display: grid; grid-template-columns: 76px 1fr; gap: 5px 8px; margin: 8px 0 0; }
      .guide-deep-card dt { font-weight: 800; }
      .guide-deep-card dd { margin: 0; }
      .guide-deep-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
      .guide-deep-head em { color: var(--accent-2); font-size: 11px; font-style: normal; text-transform: uppercase; letter-spacing: .05em; }
      @media (max-width: 1000px) { .guide-deep-grid { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
