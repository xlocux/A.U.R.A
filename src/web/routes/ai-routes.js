"use strict";

const { readBody, sendJson, HttpError } = require("../http-utils");
const { answerAgentChat } = require("../services/ai-agent");
const { getAiRuntimeStatus, listOpenRouterFreeModels, normalizeAiProvider } = require("../services/ai-runtime");
const { startDeepSeekLogin, deepSeekLoginStatus, cancelDeepSeekLogin } = require("../services/deepseek-login");
const { deepSeekUpload, ensureDeviceId } = require("../services/deepseek-web");

async function getAiSettings({ response, store }) {
  sendJson(response, { settings: store.getAiSettings(), models: await listOpenRouterFreeModels() });
}

async function saveAiSettings({ request, response, store }) {
  const body = await readBody(request);
  const autonomyLevel = Number(body.autonomyLevel);
  const current = store.getAiSettings();
  const settings = store.saveAiSettings({
    deepseekDeviceId: current.deepseekDeviceId, // preserve the stable device id across form saves
    provider: normalizeAiProvider(body.provider),
    planningModel: String(body.planningModel || "").trim(),
    executionModel: String(body.executionModel || "").trim(),
    localEndpoint: String(body.localEndpoint || "").trim(),
    localModel: String(body.localModel || "").trim(),
    autonomyLevel: Number.isFinite(autonomyLevel) ? Math.max(0, Math.min(4, Math.round(autonomyLevel))) : 1,
    deepseekToken: String(body.deepseekToken || "").trim()
  });
  sendJson(response, { settings });
}

async function getRuntimeStatus({ response, url }) {
  sendJson(response, await getAiRuntimeStatus(url.searchParams.get("runtime") || "linux"));
}

// Manual refresh of the OpenRouter free-model list (bypasses the cache when ?refresh=true).
async function getAiModels({ response, url }) {
  sendJson(response, { models: await listOpenRouterFreeModels(url.searchParams.get("refresh") === "true") });
}

async function agentChat({ request, response, store }) {
  const body = await readBody(request);
  sendJson(response, { message: await answerAgentChat({ body, store }) });
}

// Experimental DeepSeek web login: open a browser, let the user log in, capture the session token.
// Upload a file to the user's DeepSeek session (base64 in, file id out) for use as a chat attachment.
async function deepSeekUploadRoute({ request, response, store }) {
  const body = await readBody(request);
  const token = String(store.getAiSettings().deepseekToken || "").trim();
  if (!token) throw new HttpError(400, "DeepSeek session token is not set.");
  const buffer = Buffer.from(String(body.dataBase64 || ""), "base64");
  if (!buffer.length) throw new HttpError(400, "No file data provided.");
  const result = await deepSeekUpload({ token, deviceId: ensureDeviceId(store), buffer, fileName: body.fileName, contentType: body.contentType });
  sendJson(response, result);
}

function deepSeekLoginStart({ response, store }) { sendJson(response, startDeepSeekLogin(store)); }
function deepSeekLoginStatusRoute({ response }) { sendJson(response, deepSeekLoginStatus()); }
function deepSeekLoginCancel({ response }) { sendJson(response, cancelDeepSeekLogin()); }

module.exports = [
  { method: "GET", path: "/api/ai-settings", handler: getAiSettings },
  { method: "POST", path: "/api/ai-settings", handler: saveAiSettings },
  { method: "GET", path: "/api/ai-runtime/status", handler: getRuntimeStatus },
  { method: "GET", path: "/api/ai-models", handler: getAiModels },
  { method: "POST", path: "/api/agent/chat", handler: agentChat },
  { method: "POST", path: "/api/ai/deepseek/upload", handler: deepSeekUploadRoute },
  { method: "POST", path: "/api/ai/deepseek/login", handler: deepSeekLoginStart },
  { method: "GET", path: "/api/ai/deepseek/login/status", handler: deepSeekLoginStatusRoute },
  { method: "POST", path: "/api/ai/deepseek/login/cancel", handler: deepSeekLoginCancel }
];
