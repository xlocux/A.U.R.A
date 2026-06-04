"use strict";

const { sendJson } = require("./http-utils");
const apiRoutes = require("./api-routes");

async function handleApiRequest({ request, response, url, store }) {
  // AI settings and chat routes
  if (!url.pathname.startsWith("/api/ai-") && !url.pathname.startsWith("/api/agent/")) return false;

  try {
    // GET /api/ai-settings
    if (request.method === "GET" && url.pathname === "/api/ai-settings") {
      const { listOpenRouterFreeModels } = apiRoutes._internal;
      const models = await listOpenRouterFreeModels();
      sendJson(response, { settings: store.getAiSettings(), models });
      return true;
    }

    // POST /api/ai-settings
    if (request.method === "POST" && url.pathname === "/api/ai-settings") {
      return await apiRoutes._internal.saveAiSettings(request, response, store);
    }

    // GET /api/ai-runtime/status
    if (request.method === "GET" && url.pathname === "/api/ai-runtime/status") {
      return await apiRoutes._internal.getAiRuntimeStatus(response, url);
    }

    // POST /api/agent/chat
    if (request.method === "POST" && url.pathname === "/api/agent/chat") {
      return await apiRoutes._internal.agentChat(request, response, store);
    }

    return false;
  } catch (error) {
    console.error(`[ai-routes] error handling ${request.method} ${url.pathname}:`, error);
    return false;
  }
}

module.exports = { handleApiRequest };
