"use strict";

const { createEnvironmentRunner } = require("../../recon/environment-setup");
const { TOOL_PATH_EXPORT, shellQuote, stripAnsi } = require("../../core/shell");

const RUNTIME_CHECK_TIMEOUT_MS = 15000;
const MODEL_LIST_TIMEOUT_MS = 8000;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const OPENCODE_CONFIG_PATHS = [
  "$HOME/.config/opencode/opencode.json",
  "$HOME/.config/opencode/config.json",
  "$HOME/.opencode/config.json",
  "$HOME/.config/opencode/opencode.toml",
  "$HOME/.config/opencode/config.toml"
];
const AI_PROVIDERS = ["opencode", "openrouter", "codex", "claude", "local", "deepseek-web"];

let cachedModels = null;

function normalizeAiProvider(provider) {
  return AI_PROVIDERS.includes(provider) ? provider : "opencode";
}

function defaultAiModels() {
  return [
    { id: "qwen/qwen3-coder:free", label: "Qwen3 Coder Free", provider: "openrouter", tags: ["coding", "free"] },
    { id: "deepseek/deepseek-r1-0528:free", label: "DeepSeek R1 Free", provider: "openrouter", tags: ["reasoning", "free"] },
    { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B Free", provider: "openrouter", tags: ["general", "free"] },
    { id: "google/gemma-3-27b-it:free", label: "Gemma 3 27B Free", provider: "openrouter", tags: ["general", "free"] },
    { id: "mistralai/mistral-small-3.2-24b-instruct:free", label: "Mistral Small Free", provider: "openrouter", tags: ["fast", "free"] }
  ];
}

// Free OpenRouter models, cached so opening Settings does not block on the network every time.
async function listOpenRouterFreeModels(force = false) {
  if (!force && cachedModels && Date.now() - cachedModels.fetchedAt < MODEL_CACHE_TTL_MS) return cachedModels.models;
  let models = defaultAiModels();
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS) });
    const data = await response.json();
    if (response.ok && Array.isArray(data.data)) {
      const free = data.data
        .filter((model) => model.id && model.pricing?.prompt === "0" && model.pricing?.completion === "0")
        .filter((model) => !model.architecture?.modality || String(model.architecture.modality).includes("text"))
        .slice(0, 12)
        .map((model) => ({
          id: model.id,
          label: model.name || model.id,
          provider: "openrouter",
          tags: ["free", `${Math.round((model.context_length || 0) / 1000)}k context`]
        }));
      if (free.length > 0) models = free;
    }
  } catch {
    // Offline or provider error: fall back to the curated default list.
  }
  cachedModels = { models, fetchedAt: Date.now() };
  return models;
}

async function inspectCliRuntime({ runner, id, binary }) {
  const quoted = shellQuote(binary);
  const command = [
    TOOL_PATH_EXPORT,
    `if command -v ${quoted} >/dev/null 2>&1; then`,
    `  printf 'path=%s\\n' "$(command -v ${quoted})"`,
    `  ${quoted} --version 2>&1 | head -n 3`,
    "else",
    "  exit 127",
    "fi"
  ].join("\n");
  const result = await runner.run(command, RUNTIME_CHECK_TIMEOUT_MS);
  return {
    id,
    installed: result.status === "completed",
    status: result.status,
    detail: result.status === "completed"
      ? stripAnsi(result.stdout)
      : stripAnsi(result.stderr || result.errorMessage || "not installed")
  };
}

async function inspectOpenCodeConfig(runner) {
  const command = [
    "set -eu",
    `for file in ${OPENCODE_CONFIG_PATHS.join(" ")}; do`,
    "  if [ -f \"$file\" ]; then",
    "    printf 'path=%s\\n' \"$file\"",
    "    sed -E 's/(api[_-]?key|token|secret|password)[\"'\"']?[[:space:]]*[:=][[:space:]]*[\"'\"']?[^\"'\"',[:space:]]+/\\1: REDACTED/Ig' \"$file\" | head -n 80",
    "    exit 0",
    "  fi",
    "done",
    "printf 'No OpenCode config file found in the default locations.'"
  ].join("\n");
  const result = await runner.run(command, RUNTIME_CHECK_TIMEOUT_MS);
  return { status: result.status, detail: stripAnsi(result.stdout || result.stderr || result.errorMessage) };
}

async function getAiRuntimeStatus(runtime = "linux") {
  const runner = createEnvironmentRunner({ runtime });
  const [opencode, codex, claude, opencodeConfig] = await Promise.all([
    inspectCliRuntime({ runner, id: "opencode", binary: "opencode" }),
    inspectCliRuntime({ runner, id: "codex", binary: "codex" }),
    inspectCliRuntime({ runner, id: "claude", binary: "claude" }),
    inspectOpenCodeConfig(runner)
  ]);
  return { runtime, mode: runner.mode, runtimes: { opencode, codex, claude }, opencodeConfig };
}

module.exports = {
  getAiRuntimeStatus,
  listOpenRouterFreeModels,
  normalizeAiProvider
};
