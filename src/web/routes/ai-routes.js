"use strict";

const { readBody, sendJson } = require("../http-utils");
const { answerAgentChat } = require("../services/ai-agent");
const { getAiRuntimeStatus, listOpenRouterFreeModels, normalizeAiProvider } = require("../services/ai-runtime");

async function getAiSettings({ response, store }) {
  sendJson(response, { settings: store.getAiSettings(), models: await listOpenRouterFreeModels() });
}

async function saveAiSettings({ request, response, store }) {
  const body = await readBody(request);
  const autonomyLevel = Number(body.autonomyLevel);
  const settings = store.saveAiSettings({
    provider: normalizeAiProvider(body.provider),
    planningModel: String(body.planningModel || "").trim(),
    executionModel: String(body.executionModel || "").trim(),
    localEndpoint: String(body.localEndpoint || "").trim(),
    localModel: String(body.localModel || "").trim(),
    autonomyLevel: Number.isFinite(autonomyLevel) ? Math.max(0, Math.min(4, Math.round(autonomyLevel))) : 1
  });
  sendJson(response, { settings });
}

async function getRuntimeStatus({ response, url }) {
  sendJson(response, await getAiRuntimeStatus(url.searchParams.get("runtime") || "linux"));
}

async function agentChat({ request, response, store }) {
  const body = await readBody(request);
  sendJson(response, { message: await answerAgentChat({ body, store }) });
}

module.exports = [
  { method: "GET", path: "/api/ai-settings", handler: getAiSettings },
  { method: "POST", path: "/api/ai-settings", handler: saveAiSettings },
  { method: "GET", path: "/api/ai-runtime/status", handler: getRuntimeStatus },
  { method: "POST", path: "/api/agent/chat", handler: agentChat }
];
