"use strict";

// End-to-end check that seeded recon data is visible through the exact endpoints the UI reads,
// and that every export format round-trips the data. Guards the "results don't show / export broken" class of bugs.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-results-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

const { openScanStore } = require("../src/db/scan-store");
const { createWebAuth } = require("../src/web/auth");
const { createRequestHandler } = require("../src/web/server");
const { buildResultTree } = require("../src/recon/result-tree");

let server;
let baseUrl;
let store;
let cookie = "";
let runId;

async function api(urlPath) {
  const response = await fetch(`${baseUrl}${urlPath}`, { headers: { Cookie: cookie } });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: response.status, json, text, headers: response.headers };
}

function seedRun() {
  const target = store.upsertTarget(path.join(workDir, "targets", "acme", "target.json"), {
    schema_version: "1.0",
    target_name: "acme",
    default_mode: "blackbox",
    allowed_modes: ["blackbox"],
    program_url: "https://acme.example",
    logs_dir: "./logs",
    intelligence_dir: "./intel",
    scope: { in_scope: ["acme.example"], out_of_scope: [] },
    recon: { notes: [], rules: [] }
  });
  const run = store.createRun({ targetName: target.target_name, runType: "recon", mode: "list" });
  store.saveDomains(run.id, "acme", [
    { domain: "acme.example", rootDomain: "acme.example", kind: "root", source: "subfinder" },
    { domain: "api.acme.example", rootDomain: "acme.example", kind: "subdomain", source: "subfinder" },
    { domain: "shop.acme.example", rootDomain: "acme.example", kind: "subdomain", source: "crtsh" }
  ]);
  store.saveHttpServices(run.id, "acme", [
    { url: "https://acme.example", host: "acme.example", scheme: "https", port: 443, statusCode: 200, title: "ACME", technologies: ["nginx", "React"], webserver: "nginx" },
    { url: "https://api.acme.example", host: "api.acme.example", scheme: "https", port: 443, statusCode: 401, title: "API", technologies: ["nginx", "Express"], webserver: "nginx" },
    { url: "https://shop.acme.example", host: "shop.acme.example", scheme: "https", port: 443, statusCode: 200, title: "Shop", technologies: ["React", "Cloudflare"] }
  ]);
  store.saveUrls(run.id, "acme", [
    { url: "https://acme.example/login?next=/", host: "acme.example", path: "/login", query: "next=/", params: ["next"] },
    { url: "https://api.acme.example/v1/users", host: "api.acme.example", path: "/v1/users", query: "", params: [] }
  ], "gau");
  store.appendEvent(run.id, { phase: "recon", severity: "ok", source: "engine", message: "Recon completed with 3 unique domains" });
  store.updateRun(run.id, { status: "completed", activePhase: "completed", finishedAt: new Date().toISOString() });
  return run.id;
}

test.before(async () => {
  store = openScanStore(path.join(workDir, "aura.db"));
  const auth = createWebAuth({ store });
  server = http.createServer(createRequestHandler({ store, auth, bindHost: "127.0.0.1" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "locu", password: "locu" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];
  runId = seedRun();
});

test.after(() => {
  server.close();
  store.close();
});

test("domains endpoint returns every discovered host", async () => {
  const { json } = await api(`/api/recon-runs/${runId}/domains`);
  const names = json.domains.map((item) => item.domain).sort();
  assert.deepEqual(names, ["acme.example", "api.acme.example", "shop.acme.example"]);
});

test("http services carry status, title and technologies", async () => {
  const { json } = await api(`/api/recon-runs/${runId}/http-services`);
  assert.equal(json.services.length, 3);
  const apiService = json.services.find((item) => item.host === "api.acme.example");
  assert.equal(apiService.statusCode, 401);
  assert.deepEqual(apiService.technologies.sort(), ["Express", "nginx"]);
});

test("technology summary aggregates counts and host counts the chart needs", async () => {
  const { json } = await api(`/api/recon-runs/${runId}/technologies`);
  const byName = Object.fromEntries(json.technologies.map((tech) => [tech.name, tech]));
  assert.equal(byName.nginx.count, 2);
  assert.equal(byName.React.count, 2);
  assert.ok(byName.React.hostCount >= 2);
  // Fields the Technologies table/chart binds to must exist.
  for (const tech of json.technologies) {
    assert.equal(typeof tech.name, "string");
    assert.equal(typeof tech.count, "number");
    assert.equal(typeof tech.hostCount, "number");
  }
});

test("counts summary matches seeded observations", async () => {
  const { json } = await api(`/api/recon-runs/${runId}/counts`);
  assert.equal(json.counts.domains, 3);
  assert.equal(json.counts.httpServices, 3);
  assert.equal(json.counts.urls, 2);
  assert.equal(json.counts.technologies, 4); // nginx, React, Express, Cloudflare
});

test("result tree builds nodes the topology graph renders", async () => {
  const { json } = await api(`/api/recon-runs/${runId}/result-tree`);
  assert.ok(json.tree);
  const tree = buildResultTree({
    run: store.getRun(runId),
    target: store.getTarget("acme"),
    counts: store.getRunObservationCounts(runId),
    domains: store.listDomains({ runId }),
    httpServices: store.listHttpServices({ runId }),
    urls: store.listUrls({ runId }),
    screenshots: [],
    assetLeads: [],
    delta: null
  });
  assert.ok(JSON.stringify(tree).includes("acme.example"));
});

test("JSON export contains the full snapshot", async () => {
  const { json, headers } = await api(`/api/recon-runs/${runId}/export?format=json`);
  assert.match(headers.get("content-disposition"), /aura-run-\d+\.json/);
  assert.equal(json.domains.length, 3);
  assert.equal(json.httpServices.length, 3);
  assert.equal(json.technologies.length, 4);
});

test("CSV export lists domains, services, technologies and URLs", async () => {
  const { text, headers } = await api(`/api/recon-runs/${runId}/export?format=csv`);
  assert.match(headers.get("content-type"), /text\/csv/);
  assert.match(text, /^"type","value"/);
  assert.match(text, /"domain","api\.acme\.example"/);
  assert.match(text, /"http_service","https:\/\/acme\.example"/);
  assert.match(text, /"technology","nginx"/);
  assert.match(text, /"url","https:\/\/acme\.example\/login/);
});

test("Markdown export summarizes counts", async () => {
  const { text } = await api(`/api/recon-runs/${runId}/export/markdown`);
  assert.match(text, /# A\.U\.R\.A Run/);
  assert.match(text, /- Domains: 3/);
  assert.match(text, /- Technologies: 4/);
});

test("diagnostics export is produced with observations", async () => {
  const { json, headers } = await api(`/api/recon-runs/${runId}/diagnostics`);
  assert.match(headers.get("content-disposition"), /diagnostics/);
  assert.equal(json.format, "aura-run-diagnostics-v1");
  assert.equal(json.observations.domains.length, 3);
});

