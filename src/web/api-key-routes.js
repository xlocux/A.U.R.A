"use strict";

const { validateProviderKey } = require("../recon/provider-apis");
const { sendJson } = require("./http-utils");

async function handleApiKeyRequest({ request, response, url, store }) {
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
