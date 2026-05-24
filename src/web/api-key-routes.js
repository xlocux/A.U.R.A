"use strict";

const { validateProviderKey } = require("../recon/provider-apis");
const { sendJson } = require("./http-utils");

async function handleApiKeyRequest({ request, response, url, store }) {
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
  const status = preflight.ok ? "active" : "failed";
  const apiKey = store.updateApiKeyStatus(id, status);
  sendJson(response, {
    apiKey,
    preflight: {
      ...preflight,
      provider: key.provider,
      label: key.label
    }
  });
}

module.exports = {
  handleApiKeyRequest,
  preflightApiKey
};
