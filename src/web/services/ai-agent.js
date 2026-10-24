"use strict";

const { createEnvironmentRunner } = require("../../recon/environment-setup");
const { TOOL_PATH_EXPORT, shellQuote } = require("../../core/shell");

const SYSTEM_PROMPT = "You are A.U.R.A's local assistant. Answer in English. Be concise, evidence-driven, and safe. Do not suggest evasion, exploitation, or out-of-scope activity.";
const CLI_CHECK_TIMEOUT_MS = 15000;
const CLI_RUN_TIMEOUT_MS = 120000;
const HTTP_TIMEOUT_MS = 120000;
const MAX_CONVERSATION_MESSAGES = 12;

const CLI_RUNTIMES = {
  claude: { name: "Claude Code", binary: "claude", command: (prompt) => `claude -p ${shellQuote(prompt)}` },
  codex: { name: "Codex CLI", binary: "codex", command: (prompt) => `codex exec --skip-git-repo-check ${shellQuote(prompt)}` },
  opencode: { name: "OpenCode", binary: "opencode", command: (prompt) => `opencode run ${shellQuote(prompt)}` }
};

function formatConversationForPrompt(conversation) {
  return conversation
    .map((message) => `  ${message.role === "user" ? "user" : "assistant"}: ${String(message.content || "").replace(/\s+/g, " ").slice(0, 1000)}`)
    .join("\n");
}

// Grounds the user's question in the current run so the model answers from stored evidence.
function buildAgentPromptWithContext({ prompt, body, store }) {
  const runId = Number(body.runId || 0);
  const targetName = String(body.targetName || "").trim();
  const run = runId ? store.getRun(runId) : targetName ? store.getLatestRunForTarget(targetName) : null;
  const events = run ? store.listEvents(run.id, 0, 20) : [];
  const tools = run ? store.listToolResults({ runId: run.id, limit: 10 }) : [];
  const domains = run ? store.listDomains({ runId: run.id, limit: 10 }) : [];
  const counts = run ? store.getRunObservationCounts(run.id) : null;
  const technologies = run ? store.listTechnologySummary({ runId: run.id, limit: 10 }) : [];
  const screenshots = run ? store.listScreenshots({ runId: run.id }) : [];
  const latestEvent = events.at(-1);
  const conversation = Array.isArray(body.conversation) ? body.conversation.slice(-MAX_CONVERSATION_MESSAGES) : [];
  return [
    "Answer in English. Use only the A.U.R.A context below for target-specific facts. If data is missing, say so clearly.",
    "Explain current activity with concrete run IDs, phases, events, and tools.",
    "Use the recent chat history for continuity. Do not repeat automatic log-style insights unless the user asks for logs.",
    "",
    "A.U.R.A context:",
    run ? `- Current run: ${run.id} target=${run.target_name} status=${run.status} phase=${run.active_phase || "-"}` : "- Current run: none loaded",
    counts ? `- Run totals: domains=${counts.domains} urls=${counts.urls} services=${counts.httpServices} technologies=${counts.technologies} screenshots=${counts.screenshots}` : "- Run totals: none",
    latestEvent ? `- Latest event: ${latestEvent.created_at} ${latestEvent.source || "system"}: ${latestEvent.message}` : "- Latest event: none",
    tools.length ? `- Recent tool results: ${tools.map((tool) => `${tool.toolName}:${tool.status}`).join(", ")}` : "- Recent tool results: none",
    domains.length ? `- Sample domains: ${domains.map((domain) => domain.domain).join(", ")}` : "- Sample domains: none",
    technologies.length ? `- Technologies: ${technologies.map((tech) => `${tech.name}(${tech.count})`).join(", ")}` : "- Technologies: none",
    screenshots.length ? `- Screenshot runs: ${screenshots.map((shot) => `${shot.tool_name}:${shot.metadata?.screenshotCount ?? 0}`).join(", ")}` : "- Screenshot runs: none",
    conversation.length ? `- Recent chat:\n${formatConversationForPrompt(conversation)}` : "- Recent chat: none",
    "",
    "User question:",
    prompt
  ].join("\n");
}

async function callOpenAiCompatible({ url, apiKey, model, prompt, headers = {} }) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt }
        ]
      })
    });
  } catch (error) {
    return `AI provider request failed: ${error.name === "TimeoutError" ? "request timed out" : error.message}`;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return `AI provider request failed: ${data.error?.message || response.statusText}`;
  return data.choices?.[0]?.message?.content || "The AI provider returned an empty response.";
}

async function callOpenRouterAgent({ prompt, settings, store }) {
  const apiKey = store.getActiveApiKey("openrouter");
  if (!apiKey?.api_key) {
    return "OpenRouter is selected, but no active OpenRouter API key is stored. Add it in Settings > API Keys with provider `openrouter`, then try again.";
  }
  const result = await callOpenAiCompatible({
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: apiKey.api_key,
    model: settings.executionModel || settings.planningModel || "qwen/qwen3-coder:free",
    prompt,
    headers: { "HTTP-Referer": "http://127.0.0.1:31338", "X-Title": "A.U.R.A Recon" }
  });
  store.markApiKeyUsed(apiKey.id);
  return result;
}

async function callLocalAgent({ prompt, settings }) {
  if (!settings.localEndpoint || !settings.localModel) {
    return "Local model is selected, but the endpoint or model is missing. Configure them in Settings > AI Agent.";
  }
  return callOpenAiCompatible({ url: settings.localEndpoint, apiKey: null, model: settings.localModel, prompt });
}

function setupHelpMessage(prompt) {
  const lower = prompt.toLowerCase();
  if (["install", "tool", "opencode", "ai"].some((word) => lower.includes(word))) {
    return [
      "Go to Settings > Environment.",
      "1. Click Check Environment.",
      "2. Click Install / Update Tools.",
      "3. A.U.R.A installs system prerequisites first, then OpenCode, then registry tools.",
      "4. Add optional provider API keys later in Settings > API Keys.",
      "If OpenCode is installed but chat still fails, configure its model/provider in the Linux environment."
    ].join("\n");
  }
  return "OpenCode is not available to the backend yet. Go to Settings > Environment and run Install / Update Tools first.";
}

async function callCliAgent({ prompt, provider, runtimeName }) {
  const cli = CLI_RUNTIMES[provider] || CLI_RUNTIMES.opencode;
  const runner = createEnvironmentRunner({ runtime: runtimeName || "linux" });
  const check = await runner.run(`${TOOL_PATH_EXPORT} && command -v ${shellQuote(cli.binary)}`, CLI_CHECK_TIMEOUT_MS);
  if (check.status !== "completed") {
    if (provider === "opencode") return setupHelpMessage(prompt);
    return `${cli.name} is selected, but the ${cli.binary} CLI was not found in the execution environment. Install it or select OpenCode/OpenRouter in Settings > AI Agent.`;
  }
  const result = await runner.run(`${TOOL_PATH_EXPORT} && ${cli.command(`${SYSTEM_PROMPT}\n\n${prompt}`)}`, CLI_RUN_TIMEOUT_MS);
  if (result.status === "completed" && result.stdout) return result.stdout;
  return `${cli.name} did not complete the request.\n${result.stderr || result.errorMessage || "Check the CLI authentication and configuration."}`;
}

async function answerAgentChat({ body, store }) {
  const prompt = String(body.prompt || "").trim();
  if (!prompt) return "Ask me what you want to do next.";
  const contextualPrompt = buildAgentPromptWithContext({ prompt, body, store });
  const settings = store.getAiSettings();
  if (settings.provider === "openrouter") return callOpenRouterAgent({ prompt: contextualPrompt, settings, store });
  if (settings.provider === "local") return callLocalAgent({ prompt: contextualPrompt, settings });
  const provider = settings.provider === "codex" || settings.provider === "claude" ? settings.provider : "opencode";
  return callCliAgent({ prompt: contextualPrompt, provider, runtimeName: body.runtime || body.linuxRuntime || "linux" });
}

module.exports = {
  answerAgentChat,
  buildAgentPromptWithContext
};
