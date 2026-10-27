"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// Route modules resolve targets/ and data/ from the working directory, so isolate them first.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-routes-fix-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

// Stub the bootstrap so no real recon (network) starts; count the calls instead.
const bootstrapPath = require.resolve("../src/web/services/target-bootstrap");
const bootstrapCalls = [];
require.cache[bootstrapPath] = {
  id: bootstrapPath, filename: bootstrapPath, loaded: true,
  exports: { startTargetBootstrap: (args) => { bootstrapCalls.push(args); return { id: 1 }; } }
};

const { openScanStore } = require("../src/db/scan-store");
const { createWebAuth } = require("../src/web/auth");
const { createRequestHandler } = require("../src/web/server");
const { ensureDefaultWordlists, DEFAULT_WORDLISTS } = require("../src/web/services/wordlist-files");

let server;
let baseUrl;
let store;
let cookie = "";

async function request(method, urlPath, { body, auth = true } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, json, headers: response.headers };
}

test.before(async () => {
  store = openScanStore(path.join(workDir, "aura.db"));
  server = http.createServer(createRequestHandler({ store, auth: createWebAuth({ store }), bindHost: "127.0.0.1" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await request("POST", "/api/auth/login", { body: { username: "locu", password: "locu" }, auth: false });
  assert.equal(login.status, 200);
  cookie = login.headers.get("set-cookie").split(";")[0];
});

test.after(() => {
  server.close();
  store.close();
});

test("POST /api/targets skips the bootstrap only when bootstrap is false", async () => {
  const make = (name, extra) => request("POST", "/api/targets", {
    body: { targetName: name, programUrl: "", inScope: [`${name}.example.com`], outOfScope: [], ...extra }
  });
  const quick = await make("quicktarget", { bootstrap: false });
  assert.equal(quick.status, 201);
  assert.equal(bootstrapCalls.length, 0);
  assert.equal(quick.json.bootstrapRun, null);
  const normal = await make("normaltarget", {});
  assert.equal(normal.status, 201);
  assert.equal(bootstrapCalls.length, 1);
});

test("ensureDefaultWordlists does not override operator wordlists or disabled defaults", () => {
  store.addWordlist({ name: "my domains", category: "domains", path: "/tmp/mine.txt", status: "active" });
  const first = DEFAULT_WORDLISTS.find((w) => w.category === "domains");
  store.addWordlist({ ...first, status: "disabled" });
  ensureDefaultWordlists(store);
  assert.equal(store.getActiveWordlist("domains").name, "my domains");
  assert.equal(store.getWordlistByName(first.name).status, "disabled");
  assert.ok(store.getWordlistByName("SecLists Web Common"), "missing defaults are still inserted");
});

test("ai-settings masks the DeepSeek token and keeps it on empty or masked saves", async () => {
  const token = "sk-1234567890abcdefghij";
  const save = (deepseekToken) => request("POST", "/api/ai-settings", { body: { provider: "deepseek-web", autonomyLevel: 1, deepseekToken } });
  assert.equal((await save(token)).status, 200);
  assert.equal(store.getAiSettings().deepseekToken, token);
  const got = await request("GET", "/api/ai-settings");
  const masked = got.json.settings.deepseekToken;
  assert.notEqual(masked, token);
  assert.ok(!JSON.stringify(got.json.settings).includes(token));
  await save(masked);
  assert.equal(store.getAiSettings().deepseekToken, token);
  await save("");
  assert.equal(store.getAiSettings().deepseekToken, token);
  await save("new-token-value-0987654321");
  assert.equal(store.getAiSettings().deepseekToken, "new-token-value-0987654321");
});
