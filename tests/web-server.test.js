"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// Route modules resolve targets/ and data/ from the working directory, so isolate them first.
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-web-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

const { openScanStore } = require("../src/db/scan-store");
const { createWebAuth } = require("../src/web/auth");
const { createRequestHandler } = require("../src/web/server");
const { matchSegments } = require("../src/web/router");
const { targetConfigPath } = require("../src/web/services/target-configs");

let server;
let baseUrl;
let store;
let cookie = "";

async function request(method, urlPath, { body, headers = {}, auth = true } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth && cookie ? { Cookie: cookie } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

test.before(async () => {
  store = openScanStore(path.join(workDir, "aura.db"));
  const auth = createWebAuth({ store });
  server = http.createServer(createRequestHandler({ store, auth, bindHost: "127.0.0.1" }));
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

test("router converts id params to numbers and rejects non-numeric ids", () => {
  const segments = "/api/recon-runs/:id/events".split("/").filter(Boolean);
  assert.deepEqual(matchSegments(segments, "/api/recon-runs/42/events"), { id: 42 });
  assert.equal(matchSegments(segments, "/api/recon-runs/abc/events"), null);
  assert.deepEqual(matchSegments(["api", "targets", ":name"], "/api/targets/acme%20corp"), { name: "acme corp" });
});

test("API requires authentication and rejects wrong passwords", async () => {
  assert.equal((await request("GET", "/api/targets", { auth: false })).status, 401);
  assert.equal((await request("POST", "/api/auth/login", { body: { username: "locu", password: "nope" }, auth: false })).status, 401);
  assert.equal((await request("GET", "/api/targets")).status, 200);
});

test("loopback server rejects foreign Host headers and cross-origin writes", async () => {
  const rebinding = await new Promise((resolve) => {
    http.get(`${baseUrl}/api/auth/status`, { headers: { Host: "evil.example:31338" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
  });
  assert.equal(rebinding, 421);
  const crossOrigin = await request("POST", "/api/targets", {
    body: { targetName: "x", inScope: "example.com" },
    headers: { Origin: "http://localhost:9999", "Sec-Fetch-Site": "same-site" }
  });
  assert.equal(crossOrigin.status, 403);
});

test("malformed JSON bodies return 400 instead of 500", async () => {
  const response = await fetch(`${baseUrl}/api/wordlists`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: "{not json"
  });
  assert.equal(response.status, 400);
});

test("target names cannot escape the targets directory", async () => {
  assert.throws(() => targetConfigPath("../../etc"), /Invalid target name/);
  assert.throws(() => targetConfigPath("C:\\Windows\\win.ini"), /Invalid target name/);
  assert.equal((await request("GET", "/api/targets/..%2F..%2Fpackage.json/config")).status, 400);
});

test("wordlists cannot point at non-wordlist files", async () => {
  const response = await request("POST", "/api/wordlists", { body: { name: "db", category: "paths", path: path.join(workDir, "aura.db") } });
  assert.equal(response.status, 400);
});

test("artifact endpoint never serves database files", async () => {
  const run = store.createRun({ targetName: "demo" });
  const response = await request("GET", `/api/recon-runs/${run.id}/artifacts/file?path=${encodeURIComponent(path.join(workDir, "aura.db"))}`);
  assert.equal(response.status, 404);
});

test("earlier runs keep their results when a later run sees the same observations", async () => {
  const first = store.createRun({ targetName: "demo" });
  const second = store.createRun({ targetName: "demo" });
  const domain = { domain: "app.example.com", rootDomain: "example.com", source: "subfinder" };
  const service = { url: "https://app.example.com", host: "app.example.com", statusCode: 200, technologies: ["nginx"] };
  store.saveDomains(first.id, "demo", [domain]);
  store.saveHttpServices(first.id, "demo", [service]);
  store.saveDomains(second.id, "demo", [domain]);
  store.saveHttpServices(second.id, "demo", [service]);

  const firstDomains = await request("GET", `/api/recon-runs/${first.id}/domains`);
  const firstServices = await request("GET", `/api/recon-runs/${first.id}/http-services`);
  assert.equal(firstDomains.json.domains.length, 1);
  assert.equal(firstServices.json.services.length, 1);
  const delta = await request("GET", `/api/recon-runs/${second.id}/delta`);
  assert.equal(delta.json.delta.domains.stableCount, 1);
  assert.equal(delta.json.delta.domains.addedCount, 0);
});

test("recon runs can be filtered by target and exported by path format", async () => {
  const run = store.createRun({ targetName: "other-target" });
  const filtered = await request("GET", "/api/recon-runs?targetName=other-target&limit=5");
  assert.deepEqual(filtered.json.runs.map((item) => item.id), [run.id]);
  const csv = await request("GET", `/api/recon-runs/${run.id}/export/csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-disposition"), /aura-run-\d+\.csv/);
  assert.equal((await request("GET", `/api/recon-runs/${run.id}/export/xml`)).status, 400);
});

test("completed runs cannot be cancelled after the fact", async () => {
  const run = store.createRun({ targetName: "demo" });
  store.updateRun(run.id, { status: "completed" });
  assert.equal((await request("POST", `/api/recon-runs/${run.id}/cancel`, { body: {} })).status, 409);
  assert.equal(store.getRun(run.id).status, "completed");
});

test("re-adding an API key returns the same record", async () => {
  const first = store.addApiKey({ provider: "a", label: "x", apiKey: "secret-one" });
  store.addApiKey({ provider: "b", label: "y", apiKey: "secret-two" });
  const again = store.addApiKey({ provider: "a", label: "x", apiKey: "secret-three" });
  assert.equal(again.id, first.id);
  assert.equal(again.provider, "a");
});

test("renaming the web user retires the old username", async () => {
  const response = await request("POST", "/api/auth/credentials", {
    body: { currentPassword: "locu", username: "operator", newPassword: "long-enough-password" }
  });
  assert.equal(response.status, 200);
  assert.equal(store.getWebUser("locu"), null);
  assert.equal((await request("POST", "/api/auth/login", { body: { username: "locu", password: "locu" }, auth: false })).status, 401);
  assert.equal((await request("GET", "/api/auth/status")).json.username, "operator");
});
