"use strict";

const { providerCatalog, validateProviderKey } = require("../../recon/provider-apis");
const { HttpError, readBody, sendDownload, sendJson } = require("../http-utils");

const REPLACE_KEY_MESSAGE = "Replace this API key, upgrade/enable the provider plan, or disable this provider for recon.";

function statusFromPreflight(preflight) {
  return preflight.ok ? "active" : preflight.status || "failed";
}

function apiKeyAlert(apiKey, preflight = {}) {
  if (!apiKey || !["exhausted", "failed"].includes(apiKey.status)) return null;
  if (apiKey.status === "failed" && preflight.status !== "exhausted") return null;
  return { provider: apiKey.provider, label: apiKey.label, status: apiKey.status, message: preflight.action || REPLACE_KEY_MESSAGE };
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function listApiKeys({ response, store }) {
  sendJson(response, { apiKeys: store.listApiKeys(), providers: providerCatalog() });
}

async function createApiKey({ request, response, store }) {
  const body = await readBody(request);
  const provider = String(body.provider || "").trim();
  const label = String(body.label || "").trim();
  const secret = String(body.apiKey || "").trim();
  if (!provider || !label || !secret) throw new HttpError(400, "provider, label, and apiKey are required");
  const preflight = await validateProviderKey(provider, secret);
  const apiKey = store.addApiKey({
    provider,
    label,
    apiKey: secret,
    status: statusFromPreflight(preflight),
    monthlyLimit: optionalNumber(body.monthlyLimit),
    notes: preflight.message
  });
  sendJson(response, { apiKey, preflight, alert: apiKeyAlert(apiKey, preflight) }, preflight.ok ? 201 : 202);
}

function exportApiKeys({ response, store }) {
  const exportedAt = new Date().toISOString();
  const apiKeys = store.listApiKeys({ includeSecret: true }).map((key) => ({
    provider: key.provider,
    label: key.label,
    apiKey: key.api_key,
    monthlyLimit: key.monthly_limit,
    status: key.status,
    notes: key.notes
  }));
  sendDownload(response, {
    contentType: "application/json; charset=utf-8",
    filename: `aura-api-keys-sensitive-${exportedAt.slice(0, 10)}.json`,
    body: JSON.stringify({ exportedAt, format: "aura-api-keys-v1", apiKeys }, null, 2)
  });
}

async function importApiKeys({ request, response, store }) {
  const body = await readBody(request);
  const rows = Array.isArray(body.apiKeys) ? body.apiKeys : Array.isArray(body) ? body : [];
  const preflightEnabled = body.preflight !== false;
  const results = [];
  for (const row of rows) {
    const provider = String(row?.provider || "").trim();
    const label = String(row?.label || "imported").trim();
    const secret = String(row?.apiKey || row?.api_key || "").trim();
    if (!provider || !label || !secret) {
      results.push({ provider, label, status: "skipped", message: "provider, label, and apiKey are required" });
      continue;
    }
    const preflight = preflightEnabled
      ? await validateProviderKey(provider, secret)
      : { ok: true, message: "Imported without preflight." };
    const apiKey = store.addApiKey({
      provider,
      label,
      apiKey: secret,
      status: statusFromPreflight(preflight),
      monthlyLimit: optionalNumber(row.monthlyLimit ?? row.monthly_limit),
      notes: preflight.message
    });
    results.push({ id: apiKey.id, provider, label, status: apiKey.status, preflight, alert: apiKeyAlert(apiKey, preflight) });
  }
  sendJson(response, { imported: results.filter((item) => item.status !== "skipped").length, results, apiKeys: store.listApiKeys() });
}

async function preflightAllApiKeys({ response, store }) {
  const results = [];
  for (const key of store.listApiKeys({ includeSecret: true })) {
    const preflight = await validateProviderKey(key.provider, key.api_key);
    const status = statusFromPreflight(preflight);
    store.updateApiKeyStatus(key.id, status);
    results.push({ id: key.id, provider: key.provider, label: key.label, status, preflight, alert: apiKeyAlert({ ...key, status }, preflight) });
  }
  sendJson(response, { results, apiKeys: store.listApiKeys(), alerts: results.map((item) => item.alert).filter(Boolean) });
}

async function preflightApiKey({ response, store, params }) {
  const key = store.getApiKeySecret(params.id);
  if (!key) throw new HttpError(404, "API key not found");
  const preflight = await validateProviderKey(key.provider, key.api_key);
  const status = statusFromPreflight(preflight);
  const apiKey = store.updateApiKeyStatus(params.id, status);
  sendJson(response, {
    apiKey,
    alert: apiKeyAlert({ ...key, status }, preflight),
    preflight: { ...preflight, provider: key.provider, label: key.label }
  });
}

function disableApiKey({ response, store, params }) {
  const apiKey = store.updateApiKeyStatus(params.id, "disabled");
  if (!apiKey) throw new HttpError(404, "API key not found");
  sendJson(response, { apiKey });
}

function deleteApiKey({ response, store, params }) {
  if (!store.deleteApiKey(params.id)) throw new HttpError(404, "API key not found");
  sendJson(response, { deleted: true, id: params.id });
}

module.exports = [
  { method: "GET", path: "/api/api-keys", handler: listApiKeys },
  { method: "POST", path: "/api/api-keys", handler: createApiKey },
  { method: "GET", path: "/api/api-keys/export", handler: exportApiKeys },
  { method: "POST", path: "/api/api-keys/import", handler: importApiKeys },
  { method: "POST", path: "/api/api-keys/preflight-all", handler: preflightAllApiKeys },
  { method: "POST", path: "/api/api-keys/:id/preflight", handler: preflightApiKey },
  { method: "POST", path: "/api/api-keys/:id/disable", handler: disableApiKey },
  { method: "DELETE", path: "/api/api-keys/:id", handler: deleteApiKey }
];
