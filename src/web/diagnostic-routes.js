"use strict";

const { diagnosticDownloadName, exportRunDiagnostics } = require("./log-export");
const { sendJson } = require("./http-utils");

async function handleDiagnosticRequest({ request, response, url, store }) {
  const match = url.pathname.match(/^\/api\/recon-runs\/(\d+)\/diagnostics(?:\.json)?$/);
  if (!match || request.method !== "GET") return false;
  const runId = Number(match[1]);
  const diagnostics = exportRunDiagnostics({ store, runId });
  if (!diagnostics) {
    sendJson(response, { error: "Run not found" }, 404);
    return true;
  }
  const filename = diagnosticDownloadName(diagnostics.run);
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"${filename}\"`,
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(diagnostics, null, 2));
  return true;
}

module.exports = {
  handleDiagnosticRequest
};
