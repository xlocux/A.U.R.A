"use strict";

const apiRoutes = require("./api-routes");

async function handleApiRequest({ request, response, url, store, config }) {
  if (!url.pathname.startsWith("/api/targets")) return false;

  try {
    const pathParts = url.pathname.replace(/^\/api\/targets\/?/, "").split("/").filter(Boolean);

    // GET /api/targets/:name  (alias used by loadTargetConfig in app.js)
    if (request.method === "GET" && pathParts.length === 1) {
      return apiRoutes._internal.getTargetConfig(response, store, pathParts[0]);
    }

    // GET /api/targets/:name/config
    if (request.method === "GET" && pathParts.length === 2 && pathParts[1] === "config") {
      return apiRoutes._internal.getTargetConfig(response, store, pathParts[0]);
    }

    // PUT /api/targets/:name/config
    if (request.method === "PUT" && pathParts.length === 2 && pathParts[1] === "config") {
      return await apiRoutes._internal.updateTargetConfig(request, response, store, pathParts[0]);
    }

    // DELETE /api/targets/:name
    if (request.method === "DELETE" && pathParts.length === 1) {
      return apiRoutes._internal.deleteTarget(response, store, pathParts[0]);
    }

    return false;
  } catch (error) {
    console.error(`[target-routes] error handling ${request.method} ${url.pathname}:`, error);
    return false;
  }
}

module.exports = { handleApiRequest };
