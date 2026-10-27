"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { answerAgentChat, buildAgentPromptWithContext } = require("../src/web/services/ai-agent");

function fakeStore(overrides = {}) {
  return {
    getAiSettings: () => ({ provider: "openrouter", executionModel: "", planningModel: "" }),
    getActiveApiKey: () => ({ id: 1, api_key: "test-key" }),
    markApiKeyUsed: () => {},
    getRun: () => null,
    getLatestRunForTarget: () => null,
    listLatestEvents: () => [],
    listToolResults: () => [],
    listDomains: () => [],
    getRunObservationCounts: () => null,
    listTechnologySummary: () => [],
    listScreenshots: () => [],
    ...overrides
  };
}

test("agent switches to the next free model when the first is rate-limited (429)", async () => {
  const originalFetch = global.fetch;
  let chatCalls = 0;
  global.fetch = async (url) => {
    if (String(url).includes("/models")) {
      return { ok: true, json: async () => ({ data: [
        { id: "free/first", pricing: { prompt: "0", completion: "0" } },
        { id: "free/second", pricing: { prompt: "0", completion: "0" } }
      ] }) };
    }
    chatCalls += 1;
    if (chatCalls === 1) return { ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "hello from second model" } }] }) };
  };
  try {
    const reply = await answerAgentChat({ body: { prompt: "ciao" }, store: fakeStore() });
    assert.match(reply, /hello from second model/);
    assert.match(reply, /switched to free\/second/);
    assert.ok(chatCalls >= 2, "should have retried on a second model");
  } finally {
    global.fetch = originalFetch;
  }
});

test("agent reports clearly when all free models are rate-limited", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/models")) {
      return { ok: true, json: async () => ({ data: [{ id: "free/only", pricing: { prompt: "0", completion: "0" } }] }) };
    }
    return { ok: false, status: 429, json: async () => ({ error: { message: "rate limited" } }) };
  };
  try {
    const reply = await answerAgentChat({ body: { prompt: "ciao" }, store: fakeStore() });
    assert.match(reply, /All attempted OpenRouter models failed/);
    assert.match(reply, /rate-limited/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("agent tells the user when no OpenRouter key is configured", async () => {
  const reply = await answerAgentChat({ body: { prompt: "ciao" }, store: fakeStore({ getActiveApiKey: () => null }) });
  assert.match(reply, /no active OpenRouter API key/i);
});

test("buildAgentPromptWithContext grounds the prompt in run data and the question", () => {
  const store = fakeStore({
    getLatestRunForTarget: () => ({ id: 7, target_name: "acme", status: "completed", active_phase: "completed" }),
    getRunObservationCounts: () => ({ domains: 3, urls: 2, httpServices: 1, technologies: 4, screenshots: 0 }),
    listDomains: () => [{ domain: "acme.example" }]
  });
  const prompt = buildAgentPromptWithContext({ prompt: "what did you find?", body: { targetName: "acme" }, store });
  assert.match(prompt, /Current run: 7/);
  assert.match(prompt, /domains=3/);
  assert.match(prompt, /acme\.example/);
  assert.match(prompt, /what did you find\?/);
});

test("CLI agent runs in an empty temp cwd (not the repo) and codex gets the read-only sandbox", async () => {
  const calls = [];
  const runner = {
    run: async (command, timeoutMs, options) => {
      calls.push({ command, options, existed: options?.cwd && require("node:fs").existsSync(options.cwd) });
      return { status: "completed", stdout: "ok" };
    }
  };
  const reply = await require("../src/web/services/ai-agent").callCliAgent({ prompt: "hi", provider: "codex", runner });
  assert.equal(reply, "ok");
  const run = calls[1];
  assert.ok(run.options.cwd);
  assert.notEqual(require("node:path").resolve(run.options.cwd), process.cwd());
  assert.ok(run.existed);
  assert.match(run.command, /--sandbox read-only/);
  assert.equal(require("node:fs").existsSync(run.options.cwd), false, "temp dir removed afterwards");
});
