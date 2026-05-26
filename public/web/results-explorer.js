"use strict";

(function initAuraResultsExplorer() {
  const $ = (id) => document.getElementById(id);
  let currentTree = null;
  let currentFiltered = { roots: [], candidates: [] };
  let selectedNode = null;

  async function refresh(runId) {
    if (!runId) {
      currentTree = null;
      currentFiltered = { roots: [], candidates: [] };
      selectedNode = null;
      render();
      return;
    }
    const data = await window.auraApi(`/api/recon-runs/${runId}/result-tree`);
    currentTree = data.tree;
    selectedNode = null;
    render();
  }

  function render() {
    if (!$("resultTree")) return;
    if (!currentTree) {
      $("resultTree").innerHTML = `<div class="empty-state">No run loaded.</div>`;
      $("resultDetail").innerHTML = `<div class="empty-state">Select a domain, service, URL, technology, screenshot run, or candidate.</div>`;
      updateSummary(null);
      return;
    }
    currentFiltered = filterTree(currentTree, readFilters());
    if (selectedNode && !isVisibleSelection(selectedNode, currentFiltered)) selectedNode = null;
    updateSummary(currentFiltered);
    renderTree(currentFiltered);
    renderDetail(selectedNode || firstVisibleDomain(currentFiltered) || currentFiltered.candidates[0] || null);
  }

  function readFilters() {
    return {
      query: lower($("resultFilterQuery")?.value),
      status: $("resultFilterStatus")?.value || "all",
      minScore: Number($("resultFilterScore")?.value || 0),
      hasHttp: Boolean($("resultFilterHttp")?.checked),
      hasTech: Boolean($("resultFilterTech")?.checked),
      hasUrls: Boolean($("resultFilterUrls")?.checked),
      onlyNew: Boolean($("resultFilterNew")?.checked)
    };
  }

  function filterTree(tree, filters) {
    const roots = tree.roots.map((root) => {
      const children = root.children.filter((node) => domainMatches(node, filters));
      return {
        ...root,
        children,
        summary: summarizeChildren(children)
      };
    }).filter((root) => root.children.length > 0 || textMatches(root.domain, filters.query));
    const candidates = tree.candidates.filter((candidate) => candidateMatches(candidate, filters));
    return {
      ...tree,
      roots,
      candidates,
      filteredSummary: summarizeFiltered(roots, candidates)
    };
  }

  function domainMatches(node, filters) {
    if (filters.query && !nodeSearchText(node).includes(filters.query)) return false;
    if (filters.status !== "all" && node.scopeStatus !== filters.status) return false;
    if (filters.hasHttp && node.services.length === 0) return false;
    if (filters.hasTech && node.technologies.length === 0) return false;
    if (filters.hasUrls && node.urls.length === 0) return false;
    if (filters.onlyNew && !node.isNew) return false;
    return true;
  }

  function candidateMatches(candidate, filters) {
    if (filters.query && !candidateSearchText(candidate).includes(filters.query)) return false;
    if (filters.status !== "all" && candidate.status !== filters.status) return false;
    if (filters.minScore && candidate.score < filters.minScore) return false;
    if (filters.hasHttp || filters.hasTech || filters.hasUrls || filters.onlyNew) return false;
    return true;
  }

  function renderTree(tree) {
    const rootSections = tree.roots.map((root) => `
      <details class="tree-group" open>
        <summary>${escapeHtml(root.domain)} <span>${root.summary.domains} domains / ${root.summary.services} services / ${root.summary.urls} URLs</span></summary>
        ${root.children.map(renderDomainNode).join("")}
      </details>
    `).join("");
    const candidateSection = tree.candidates.length ? `
      <details class="tree-group" open>
        <summary>Candidate Domains <span>${tree.candidates.length} review leads</span></summary>
        ${tree.candidates.map(renderCandidateNode).join("")}
      </details>
    ` : "";
    const screenshotSection = currentTree.screenshots.length ? `
      <details class="tree-group">
        <summary>Screenshot Runs <span>${currentTree.summary.screenshotCount} images</span></summary>
        ${currentTree.screenshots.map(renderScreenshotNode).join("")}
      </details>
    ` : "";
    $("resultTree").innerHTML = rootSections || candidateSection || screenshotSection
      ? `${rootSections}${candidateSection}${screenshotSection}`
      : `<div class="empty-state">No results match the current filters.</div>`;
    bindTreeClicks();
  }

  function renderDomainNode(node) {
    return `
      <div class="tree-node" data-node-type="domain" data-node-id="${escapeAttr(node.id)}">
        <div>
          <strong>${escapeHtml(node.domain)}</strong>
          <span>${escapeHtml(node.kind)} / ${node.services.length} services / ${node.urls.length} URLs / ${node.technologies.length} tech</span>
        </div>
        ${node.isNew ? `<em>new</em>` : ""}
      </div>
    `;
  }

  function renderCandidateNode(candidate) {
    return `
      <div class="tree-node candidate" data-node-type="candidate" data-node-id="${escapeAttr(candidate.id)}">
        <div>
          <strong>${escapeHtml(candidate.domain)}</strong>
          <span>${escapeHtml(candidate.status)} / score ${escapeHtml(candidate.score)} / ${escapeHtml(candidate.source)}</span>
        </div>
      </div>
    `;
  }

  function renderScreenshotNode(shot) {
    return `
      <div class="tree-node artifact" data-node-type="screenshot" data-node-id="${escapeAttr(String(shot.id))}">
        <div>
          <strong>${escapeHtml(shot.tool_name)}</strong>
          <span>${escapeHtml(shot.metadata?.screenshotCount ?? 0)} screenshots / ${escapeHtml(shot.report_path || shot.output_dir || "")}</span>
        </div>
      </div>
    `;
  }

  function bindTreeClicks() {
    $("resultTree").querySelectorAll(".tree-node").forEach((nodeEl) => {
      nodeEl.addEventListener("click", () => {
        selectedNode = findNode(nodeEl.dataset.nodeType, nodeEl.dataset.nodeId);
        renderDetail(selectedNode);
      });
    });
  }

  function findNode(type, id) {
    if (type === "domain") {
      for (const root of currentFiltered.roots) {
        const found = root.children.find((node) => node.id === id);
        if (found) return found;
      }
    }
    if (type === "candidate") return currentFiltered.candidates.find((candidate) => candidate.id === id) || null;
    if (type === "screenshot") return currentTree.screenshots.find((shot) => String(shot.id) === id) || null;
    return null;
  }

  function firstVisibleDomain(tree) {
    for (const root of tree.roots) {
      if (root.children[0]) return root.children[0];
    }
    return null;
  }

  function isVisibleSelection(node, tree) {
    if (node.type === "candidate") return tree.candidates.some((candidate) => candidate.id === node.id);
    if (node.type === "domain") return tree.roots.some((root) => root.children.some((child) => child.id === node.id));
    return true;
  }

  function renderDetail(node) {
    if (!node) {
      $("resultDetail").innerHTML = `<div class="empty-state">Select a result node.</div>`;
      return;
    }
    if (node.type === "candidate") {
      $("resultDetail").innerHTML = renderCandidateDetail(node);
      return;
    }
    if (node.tool_name) {
      $("resultDetail").innerHTML = renderScreenshotDetail(node);
      return;
    }
    $("resultDetail").innerHTML = renderDomainDetail(node);
  }

  function renderDomainDetail(node) {
    return `
      <div class="detail-head">
        <div>
          <h3>${escapeHtml(node.domain)}</h3>
          <p>${escapeHtml(node.scopeStatus)} / ${escapeHtml(node.kind)}${node.isNew ? " / new in this run" : ""}</p>
        </div>
        <button type="button" data-export-node="${escapeAttr(node.id)}">Export Node JSON</button>
      </div>
      ${detailMetrics([
        ["Services", node.services.length],
        ["URLs", node.urls.length],
        ["Tech", node.technologies.length],
        ["Params", node.parameters.length]
      ])}
      <div class="detail-sections-grid">
        ${detailSection("Sources", node.sources, 8)}
        ${detailSection("Technologies", node.technologies, 8)}
        ${serviceSection(node.services, 4)}
        ${urlSection(node.urls, 4)}
        ${detailSection("Parameters", node.parameters, 8)}
      </div>
    `;
  }

  function renderCandidateDetail(candidate) {
    return `
      <div class="detail-head">
        <div>
          <h3>${escapeHtml(candidate.domain)}</h3>
          <p>${escapeHtml(candidate.status)} / score ${escapeHtml(candidate.score)} / ${escapeHtml(candidate.confidence)}</p>
        </div>
        <button type="button" data-export-node="${escapeAttr(candidate.id)}">Export Node JSON</button>
      </div>
      <div class="detail-sections-grid">
        ${detailSection("Correlation Rationale", candidate.rationale, 4)}
        ${correlationEngineSection(candidate.correlationEngineResult)}
        ${detailSection("Techniques", candidate.techniques, 6)}
        ${detailSection("Matched Terms", candidate.matchTerms, 8)}
        <div class="detail-section"><h4>Recommended Action</h4><p>${escapeHtml(candidate.recommendedAction)}</p></div>
      </div>
    `;
  }

  function renderScreenshotDetail(shot) {
    return `
      <div class="detail-head">
        <div>
          <h3>${escapeHtml(shot.tool_name)}</h3>
          <p>${escapeHtml(shot.metadata?.screenshotCount ?? 0)} screenshots captured</p>
        </div>
        <button type="button" data-export-node="${escapeAttr(String(shot.id))}">Export Node JSON</button>
      </div>
      ${detailMetrics([
        ["URLs", shot.metadata?.urlCount ?? 0],
        ["Screens", shot.metadata?.screenshotCount ?? 0],
        ["Status", shot.metadata?.status || "-"],
        ["Exit", shot.metadata?.exitCode ?? "-"]
      ])}
      <div class="detail-sections-grid">
        ${detailSection("Output", [shot.report_path || shot.output_dir || "-"], 4)}
      </div>
    `;
  }

  function detailMetrics(items) {
    return `<div class="detail-metrics">${items.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
  }

  function detailSection(title, items, maxItems = 6) {
    const values = (items || []).filter((item) => String(item ?? "").trim());
    const visible = values.slice(0, maxItems);
    const remaining = Math.max(0, values.length - visible.length);
    return `<div class="detail-section"><h4>${escapeHtml(title)}</h4>${visible.length ? `<ul>${visible.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>${moreIndicator(remaining, "item")}` : `<p class="muted">None recorded.</p>`}</div>`;
  }

  function moreIndicator(count, label) {
    if (!count) return "";
    const plural = count === 1 ? label : `${label}s`;
    return `<div class="detail-more">+${count} more ${escapeHtml(plural)} in export</div>`;
  }

  function correlationEngineSection(result) {
    if (!result) return "";
    const signals = result.signals || [];
    return `
      <div class="detail-section">
        <h4>TLD Correlation Engine</h4>
        ${detailMetrics([
          ["Confidence", `${result.confidence_score}%`],
          ["Level", result.confidence_level || "-"],
          ["Signals", signals.length],
          ["Eligible", result.promotion_eligible ? "yes" : "review"]
        ])}
        ${detailSection("Evidence Signals", signals.map((signal) => `[${signal.weight > 0 ? "+" : ""}${signal.weight}] ${signal.signal}: ${signal.evidence}`), 4)}
        <p>${escapeHtml(result.reasoning || "")}</p>
      </div>
    `;
  }

  function serviceSection(services, maxItems = 4) {
    const visible = services.slice(0, maxItems);
    const remaining = Math.max(0, services.length - visible.length);
    return `<div class="detail-section"><h4>HTTP Services</h4>${visible.length ? visible.map((service) => `
      <div class="detail-card">
        <strong>${escapeHtml(service.url)}</strong>
        <span>${escapeHtml(service.statusCode || "-")} / ${escapeHtml(service.title || "-")} / ${escapeHtml((service.technologies || []).join(", ") || "no tech")}</span>
      </div>
    `).join("") + moreIndicator(remaining, "service") : `<p class="muted">No HTTP services recorded.</p>`}</div>`;
  }

  function urlSection(urls, maxItems = 4) {
    const visible = urls.slice(0, maxItems);
    const remaining = Math.max(0, urls.length - visible.length);
    return `<div class="detail-section"><h4>URLs And Pages</h4>${visible.length ? visible.map((url) => `
      <div class="detail-card">
        <strong>${escapeHtml(url.path || url.url)}</strong>
        <span>${escapeHtml(url.url)}${(url.params || []).length ? ` / params: ${escapeHtml(url.params.join(", "))}` : ""}</span>
      </div>
    `).join("") + moreIndicator(remaining, "URL") : `<p class="muted">No URLs recorded.</p>`}</div>`;
  }

  function updateSummary(tree) {
    if (!$("resultExplorerSummary")) return;
    if (!tree) {
      $("resultExplorerSummary").innerHTML = "";
      return;
    }
    const summary = tree.filteredSummary || tree.summary;
    $("resultExplorerSummary").innerHTML = [
      ["Domains", summary.domains],
      ["Services", summary.services],
      ["URLs", summary.urls],
      ["Tech", summary.technologies],
      ["Candidates", summary.candidates || 0],
      ["New", summary.newDomains]
    ].map(([label, value]) => `<div class="mini-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  }

  function summarizeChildren(children) {
    return children.reduce((summary, node) => {
      summary.domains += 1;
      summary.services += node.services.length;
      summary.urls += node.urls.length;
      summary.technologies += node.technologies.length;
      summary.parameters += node.parameters.length;
      if (node.isNew) summary.newDomains += 1;
      return summary;
    }, emptySummary());
  }

  function summarizeFiltered(roots, candidates) {
    const summary = roots.reduce((total, root) => {
      for (const key of Object.keys(total)) total[key] += root.summary[key] || 0;
      return total;
    }, emptySummary());
    summary.candidates = candidates.length;
    return summary;
  }

  function emptySummary() {
    return { domains: 0, services: 0, urls: 0, technologies: 0, parameters: 0, newDomains: 0, candidates: 0 };
  }

  function exportFiltered(format) {
    if (!currentTree) return;
    const filename = `aura-results-${currentTree.run?.id || "run"}.${format}`;
    const content = format === "csv" ? filteredCsv(currentFiltered) : JSON.stringify(currentFiltered, null, 2);
    const type = format === "csv" ? "text/csv" : "application/json";
    download(filename, content, type);
  }

  function filteredCsv(tree) {
    const rows = [["type", "domain", "value", "detail", "source", "score"]];
    for (const root of tree.roots) {
      for (const node of root.children) {
        rows.push(["domain", node.domain, node.domain, `${node.services.length} services; ${node.urls.length} urls; ${node.technologies.join("|")}`, node.sources.join("|"), ""]);
        for (const service of node.services) rows.push(["http_service", node.domain, service.url, [service.statusCode, service.title, (service.technologies || []).join("|")].filter(Boolean).join(" "), service.source || "", ""]);
        for (const url of node.urls) rows.push(["url", node.domain, url.url, (url.params || []).join("|"), url.source || "", ""]);
      }
    }
    for (const candidate of tree.candidates) rows.push(["candidate", candidate.domain, candidate.domain, candidate.rationale.join("|"), candidate.source, candidate.score]);
    return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`;
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function nodeSearchText(node) {
    return lower([node.domain, node.kind, node.scopeStatus, node.sources.join(" "), node.technologies.join(" "), node.parameters.join(" "), ...node.urls.map((url) => url.url), ...node.services.map((service) => `${service.url} ${service.title || ""}`)].join(" "));
  }

  function candidateSearchText(candidate) {
    return lower([candidate.domain, candidate.source, candidate.status, candidate.confidence, candidate.matchTerms.join(" "), candidate.rationale.join(" "), candidate.techniques.join(" ")].join(" "));
  }

  function textMatches(value, query) {
    return !query || lower(value).includes(query);
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("'", "&#39;");
  }

  function bindControls() {
    ["resultFilterQuery", "resultFilterStatus", "resultFilterScore", "resultFilterHttp", "resultFilterTech", "resultFilterUrls", "resultFilterNew"]
      .forEach((id) => $(id)?.addEventListener("input", render));
    $("exportFilteredJson")?.addEventListener("click", () => exportFiltered("json"));
    $("exportFilteredCsv")?.addEventListener("click", () => exportFiltered("csv"));
    document.addEventListener("click", (event) => {
      const nodeId = event.target?.dataset?.exportNode;
      if (!nodeId || !selectedNode) return;
      download(`aura-node-${nodeId.replace(/[^a-z0-9.-]+/gi, "_")}.json`, JSON.stringify(selectedNode, null, 2), "application/json");
    });
  }

  document.addEventListener("DOMContentLoaded", bindControls);
  window.AuraResultsExplorer = { refresh };
})();
