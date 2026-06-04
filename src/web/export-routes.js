"use strict";

const apiRoutes = require("./api-routes");

async function handleApiRequest({ request, response, url, store }) {
  if (!url.pathname.startsWith("/api/recon-runs/") || !url.pathname.endsWith("/export")) return false;

  try {
    const pathParts = url.pathname.replace(/^\/api\/recon-runs\/?/, "").split("/").filter(Boolean);

    // GET /api/recon-runs/:id/export
    if (request.method === "GET" && pathParts.length === 2 && pathParts[1] === "export") {
      return apiRoutes._internal.exportRun(response, store, Number(pathParts[0]), url.searchParams.get("format") || "json");
    }

    return false;
  } catch (error) {
    console.error(`[export-routes] error handling ${request.method} ${url.pathname}:`, error);
    return false;
  }
}

module.exports = { handleApiRequest };
