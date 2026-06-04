"use strict";

const { validateProviderKey } = require("../recon/provider-apis");
const { readBody, sendJson } = require("./http-utils");
const apiRoutes = require("./api-routes");

async function handleApiKeyRequest({ request, response, url, store }) {
  // GET /api/api-keys
  if (request.method === "GET" && url.pathname === "/api/api-keys") {
    return apiRoutes._internal.listApiKeys(response, store);
  }

  // GET /api/api-keys/export
  if (request.method === "GET" && url.pathname === "/api/api-keys/export") {
    return apiRoutes._internal.exportApiKeys(response, store);
  }

  // POST /api/api-keys
  if (request.method === "POST" && url.pathname === "/api/api-keys") {
    return await apiRoutes._internal.createApiKey(request, response, store);
  }

  // POST /api/api-keys/preflight-all
  if (request.method === "POST" && url.pathname === "/api/api-keys/preflight-all") {
    return await apiRoutes._internal.preflightAllApiKeys(response, store);
  }

  // POST /api/api-keys/import
  if (request.method === "POST" && url.pathname === "/api/api-keys/import") {
    return await apiRoutes._internal.importApiKeys(request, response, store);
  }

  const disableMatch = url.pathname.match(/^\/api\/api-keys\/(\d+)\/disable$/);
  if (disableMatch && request.method === "POST") {
    disableApiKey(response, store, Number(disableMatch[1]));
    return true;
  }

  const preflightMatch = url.pathname.match(/^\/api\/api-keys\/(\d+)\/preflight$/);
  if (!preflightMatch || request.method !== "POST") return false;
  await preflightApiKey(response, store, Number(preflightMatch[1]));
  return true;
}

// DELETE /api/api-keys/:id handler
async function deleteApiKeyRoute(response, store, id) {
  return apiRoutes._internal.deleteApiKey(response, store, id);
}

async function preflightApiKey(response, store, id) {
  const key = store.getApiKeySecret(id);
  if (!key) {
    sendJson(response, { error: "API key not found" }, 404);
    return;
  }
  const preflight = await validateProviderKey(key.provider, key.api_key);
  const status = preflight.ok ? "active" : preflight.status || "failed";
  const apiKey = store.updateApiKeyStatus(id, status);
  sendJson(response, {
    apiKey,
    alert: status === "exhausted" ? {
      provider: key.provider,
      label: key.label,
      status,
      message: preflight.action || "Replace this API key, upgrade/enable the provider plan, or disable this provider for recon."
    } : null,
    preflight: {
      ...preflight,
      provider: key.provider,
      label: key.label
    }
  });
}

function disableApiKey(response, store, id) {
  const apiKey = store.updateApiKeyStatus(id, "disabled");
  sendJson(response, apiKey ? { apiKey } : { error: "API key not found" }, apiKey ? 200 : 404);
}

module.exports = {
  disableApiKey,
  handleApiKeyRequest,
  preflightApiKey
};
