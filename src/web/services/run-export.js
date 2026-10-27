"use strict";

const { buildRunDelta } = require("./run-delta");
const { withScreenshotImages } = require("./screenshot-files");

const EXPORT_FORMATS = {
  json: { contentType: "application/json; charset=utf-8", extension: "json", render: (snapshot) => JSON.stringify(snapshot, null, 2) },
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv", render: runSnapshotCsv },
  markdown: { contentType: "text/markdown; charset=utf-8", extension: "md", render: runSnapshotMarkdown }
};
EXPORT_FORMATS.md = EXPORT_FORMATS.markdown;
const EXPORT_LIST_LIMIT = 100000;

function truncatedNames(snapshot) {
  return Object.entries(snapshot.truncated || {}).filter(([, cut]) => cut).map(([name]) => name);
}

function buildRunSnapshot(store, runId) {
  const run = store.getRun(runId);
  if (!run) return null;
  const counts = store.getRunObservationCounts(runId);
  const domains = store.listDomains({ runId, limit: EXPORT_LIST_LIMIT });
  const httpServices = store.listHttpServices({ runId, limit: EXPORT_LIST_LIMIT });
  const technologies = store.listTechnologySummary({ runId, limit: EXPORT_LIST_LIMIT });
  const urls = store.listUrls({ runId, limit: EXPORT_LIST_LIMIT });
  return {
    exportedAt: new Date().toISOString(),
    run,
    events: store.listLatestEvents(runId, 5000),
    counts,
    // A list shorter than its count was cut by the cap; exports say so instead of looking complete.
    truncated: {
      domains: counts.domains > domains.length,
      httpServices: counts.httpServices > httpServices.length,
      technologies: counts.technologies > technologies.length,
      urls: counts.urls > urls.length
    },
    domains,
    httpServices,
    technologies,
    urls,
    screenshots: store.listScreenshots({ runId }).map(withScreenshotImages),
    toolResults: store.listToolResults({ runId, limit: 1000 }),
    delta: buildRunDelta(store, runId, { domains, urls, httpServices })
  };
}

// Returns { contentType, filename, body } or null when the format is unsupported.
function renderRunExport(snapshot, format) {
  const spec = EXPORT_FORMATS[String(format || "json").toLowerCase()];
  if (!spec) return null;
  return {
    contentType: spec.contentType,
    filename: `aura-run-${snapshot.run.id}.${spec.extension}`,
    body: spec.render(snapshot)
  };
}

function csvCell(value) {
  let text = String(value ?? "");
  // Neutralize spreadsheet formula injection from scanned content (titles, URLs, tool output).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll("\"", "\"\"")}"`;
}

function runSnapshotCsv(snapshot) {
  const rows = [["type", "value", "detail", "source", "status", "seen_at"]];
  const counts = snapshot.counts || {};
  for (const [name, count] of Object.entries(counts)) rows.push(["count", name, String(count), "", "", ""]);
  for (const name of truncatedNames(snapshot)) rows.push(["truncated", name, `list cut at ${EXPORT_LIST_LIMIT} rows, see count`, "", "", ""]);
  for (const domain of snapshot.domains) {
    rows.push(["domain", domain.domain, domain.kind || "", domain.source || "", domain.status || "", domain.first_seen_at || ""]);
  }
  for (const service of snapshot.httpServices) {
    const detail = [service.statusCode, service.title, (service.technologies || []).join("|")].filter(Boolean).join(" ");
    rows.push(["http_service", service.url, detail, service.source || "", "", service.probed_at || ""]);
  }
  for (const technology of snapshot.technologies) {
    rows.push(["technology", technology.name, `${technology.count} services / ${technology.hostCount} hosts`, technology.source || "", "", technology.lastSeenAt || ""]);
  }
  for (const url of snapshot.urls) {
    rows.push(["url", url.url, (url.params || []).join("|"), url.source || "", "", url.first_seen_at || ""]);
  }
  for (const tool of snapshot.toolResults) {
    rows.push(["tool_result", tool.toolName, tool.commandDisplay || "", "tool", tool.status || "", tool.finishedAt || tool.startedAt || ""]);
  }
  const delta = snapshot.delta;
  if (delta?.comparedToRunId) {
    for (const domain of delta.domains.added) {
      rows.push(["run_delta_added_domain", domain.domain, `vs run ${delta.comparedToRunId}`, domain.source || "", domain.status || "", domain.first_seen_at || ""]);
    }
    for (const domain of delta.domains.removed) {
      rows.push(["run_delta_removed_domain", domain.domain, `vs run ${delta.comparedToRunId}`, domain.source || "", domain.status || "", domain.last_seen_at || domain.first_seen_at || ""]);
    }
  }
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function runSnapshotMarkdown(snapshot) {
  const { run, counts, delta } = snapshot;
  const lines = [
    `# A.U.R.A Run ${run.id}`,
    "",
    `- Target: ${run.target_name}`,
    `- Status: ${run.status}`,
    `- Started: ${run.started_at}`,
    `- Finished: ${run.finished_at || "-"}`,
    "",
    "## Counts",
    "",
    `- Domains: ${counts.domains}`,
    `- HTTP services: ${counts.httpServices}`,
    `- Technologies: ${counts.technologies}`,
    `- URLs: ${counts.urls}`,
    `- Screenshots: ${counts.screenshots}`,
    `- Tool results: ${counts.toolResults}`
  ];
  if (delta?.comparedToRunId) {
    lines.push(`- New domains vs run ${delta.comparedToRunId}: ${delta.domains.addedCount}`);
    lines.push(`- Removed domains vs run ${delta.comparedToRunId}: ${delta.domains.removedCount}`);
  } else {
    lines.push("- New domains: no previous run");
  }
  const cut = truncatedNames(snapshot);
  if (cut.length) lines.push("", `> Note: lists truncated at ${EXPORT_LIST_LIMIT} rows: ${cut.join(", ")}.`);
  lines.push("", "## Recent Events", "");
  lines.push(...snapshot.events.slice(-50).map((event) => `- ${event.created_at} ${event.source || "system"}: ${event.message}`));
  lines.push("");
  return lines.join("\n");
}

module.exports = {
  buildRunSnapshot,
  renderRunExport
};
