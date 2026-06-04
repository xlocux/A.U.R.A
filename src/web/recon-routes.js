"use strict";

const apiRoutes = require("./api-routes");

async function handleApiRequest({ request, response, url, store }) {
  if (!url.pathname.startsWith("/api/recon-runs")) return false;

  try {
    const pathParts = url.pathname.replace(/^\/api\/recon-runs\/?/, "").split("/").filter(Boolean);

    // POST /api/recon-runs (create run)
    if (request.method === "POST" && pathParts.length === 0) {
      return await apiRoutes._internal.createReconRun(request, response, store, url);
    }

    // Run control routes: pause, resume, cancel
    if (request.method === "POST" && pathParts.length === 2 && ["pause", "resume", "cancel"].includes(pathParts[1])) {
      return apiRoutes._internal.updateRunControl(response, store, pathParts[0], pathParts[1]);
    }

    // HTTP follow-up
    if (request.method === "POST" && pathParts.length === 2 && pathParts[1] === "http-followup") {
      return await apiRoutes._internal.createHttpFollowupRun(request, response, store, pathParts[0]);
    }

    // Focused follow-up
    if (request.method === "POST" && pathParts.length === 2 && pathParts[1] === "focused-followup") {
      return await apiRoutes._internal.createFocusedFollowupRun(request, response, store, pathParts[0]);
    }

    return false;
  } catch (error) {
    console.error(`[recon-routes] error handling ${request.method} ${url.pathname}:`, error);
    return false;
  }
}

module.exports = { handleApiRequest };
