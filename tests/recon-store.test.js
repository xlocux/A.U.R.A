"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openScanStore } = require("../src/db/scan-store");
const { extractDomains, normalizeDomain } = require("../src/recon/domain-utils");
const { parseGauUrls, parseHttpxJsonLines } = require("../src/recon/parsers");
const { generateWordlistFromDb } = require("../src/recon/wordlist-generator");
const { LocalArtifactStore } = require("../src/recon/artifact-store");
const { FunctionToolRunner, runOneJob } = require("../src/recon/local-worker");
const { loadToolRegistry, validateToolManifest } = require("../src/recon/tool-registry");
const { suggestReverseWhoisTermsFromRdapRecords } = require("../src/recon/providers/rdap-suggestions");
const { buildReverseWhoisRequest, parseReverseWhoisResponse } = require("../src/recon/providers/whoisxmlapi");
const { createEnvironmentRunner, setupToolIds } = require("../src/recon/environment-setup");
const { createDefaultTargetConfig, validateTargetConfig } = require("../src/core/target-config");
const { buildTargetConfigFromRequest, extractBrandTerms, filterScopeDomains, generateAlternateTldLeads } = require("../src/web/api-routes");
const { hashWebUserPassword, parseCookies } = require("../src/web/auth");

function tempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-"));
  return path.join(dir, name);
}

test("target config validates default targets", () => {
  assert.deepEqual(validateTargetConfig(createDefaultTargetConfig("demo")), []);
});

test("web auth parses session cookies", () => {
  assert.deepEqual(parseCookies("aura_session=abc; theme=dark"), {
    aura_session: "abc",
    theme: "dark"
  });
});

test("scan store persists local web users", () => {
  const store = openScanStore(tempDb("users.db"));
  const user = store.ensureDefaultWebUser(hashWebUserPassword({ username: "locu", password: "locu" }));
  assert.equal(user.username, "locu");
  assert.equal(user.status, "active");
  assert.notEqual(user.passwordHash, "locu");
  assert.equal(store.ensureDefaultWebUser(hashWebUserPassword({ username: "other", password: "pass" })).username, "locu");
  store.close();
});

test("web target creation builds valid target configs", () => {
  const built = buildTargetConfigFromRequest({
    targetName: "acme",
    programUrl: "https://hackerone.com/acme",
    inScope: ["example.com", "*.example.com"],
    outOfScope: ["dev.example.com"]
  });
  assert.equal(built.error, undefined);
  assert.deepEqual(validateTargetConfig(built.config), []);
  assert.equal(built.config.target_name, "acme");
  assert.deepEqual(built.config.scope.in_scope, ["example.com", "*.example.com"]);
  assert.deepEqual(built.config.scope.out_of_scope, ["dev.example.com"]);

  const invalid = buildTargetConfigFromRequest({ targetName: "../bad", inScope: ["example.com"] });
  assert.match(invalid.error, /targetName is required/);
});

test("bootstrap scope filtering removes excluded domains", () => {
  const domains = filterScopeDomains({
    domains: ["example.com", "api.example.com", "dev.example.com", "nested.dev.example.com"],
    rootDomains: ["example.com"],
    config: {
      scope: {
        out_of_scope: ["dev.example.com"]
      }
    }
  });
  assert.deepEqual(domains, ["example.com", "api.example.com"]);
});

test("alternate TLD discovery creates bounded review leads", () => {
  const leads = generateAlternateTldLeads({
    rootDomains: ["acme.example"],
    config: { scope: { out_of_scope: ["acme.net"] } }
  });
  assert.ok(leads.some((lead) => lead.value === "acme.com"));
  assert.ok(!leads.some((lead) => lead.value === "acme.example"));
  assert.ok(!leads.some((lead) => lead.value === "acme.net"));
  assert.equal(leads[0].leadType, "domain_candidate");
});

test("brand term extraction supports wildcard domain intel pivots", () => {
  assert.deepEqual(extractBrandTerms(["*.google.com", "https://admin.acme.co.uk"]), ["google", "acme"]);
});

test("scan store records recon data and generated wordlists", () => {
  const store = openScanStore(tempDb("scan.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), {
    target_name: "demo",
    program_url: "https://example.com",
    logs_dir: "./logs",
    intelligence_dir: "./intelligence",
    scope: { in_scope: ["example.com"], out_of_scope: [] }
  });
  const run = store.createRun({ targetName: target.target_name });
  store.appendEvent(run.id, { phase: "recon", message: "started" });
  store.saveDomains(run.id, "demo", [
    { domain: "www.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" }
  ]);
  store.saveUrls(run.id, "demo", [
    { url: "https://www.example.com/login?next=/admin", host: "www.example.com", path: "/login", query: "next=/admin", params: ["next"] }
  ]);
  store.saveHttpServices(run.id, "demo", [
    { url: "https://www.example.com", host: "www.example.com", scheme: "https", port: 443, statusCode: 200, title: "Example", technologies: ["nginx"], raw: {} }
  ]);
  const generated = generateWordlistFromDb(store, {
    targetName: "demo",
    category: "params",
    name: "demo-params",
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), "aura-wordlists-"))
  });
  assert.equal(generated.count, 1);
  assert.match(fs.readFileSync(generated.path, "utf8"), /next/);
  const results = store.searchAll({ query: "nginx", targetName: "demo" });
  assert.equal(results[0].result_type, "http_service");
  assert.equal(results[0].target_name, "demo");
  store.close();
});

test("scan store returns the latest run for a target", () => {
  const store = openScanStore(tempDb("latest-run.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const first = store.createRun({ targetName: target.target_name });
  const second = store.createRun({ targetName: target.target_name, runType: "target-bootstrap" });
  assert.equal(store.getLatestRunForTarget(target.target_name).id, second.id);
  assert.notEqual(store.getLatestRunForTarget(target.target_name).id, first.id);
  assert.equal(store.getLatestRunForTarget("missing"), null);
  store.close();
});

test("scan store deletes targets with local recon data", () => {
  const store = openScanStore(tempDb("delete-target.db"));
  const target = store.upsertTarget(path.resolve("targets/delete-me/target.json"), {
    target_name: "delete-me",
    program_url: "https://example.com",
    scope: { in_scope: ["example.com"], out_of_scope: [] }
  });
  const run = store.createRun({ targetName: target.target_name });
  store.saveDomains(run.id, target.target_name, [
    { domain: "www.example.com", rootDomain: "example.com", kind: "subdomain", source: "test" }
  ]);
  store.saveAssetLeads(run.id, target.target_name, [
    { value: "related.example.com", source: "test", confidence: "candidate" }
  ]);
  const deleted = store.deleteTarget(target.target_name);
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.runIds, [run.id]);
  assert.equal(store.getTarget(target.target_name), null);
  assert.equal(store.listDomains({ targetName: target.target_name }).length, 0);
  assert.equal(store.listAssetLeads({ targetName: target.target_name }).length, 0);
  store.close();
});

test("scan store queues and claims recon jobs", () => {
  const store = openScanStore(tempDb("jobs.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const run = store.createRun({ targetName: target.target_name });
  const job = store.createJob({
    runId: run.id,
    targetName: target.target_name,
    phase: "http_probing",
    type: "tool",
    toolId: "httpx",
    payload: { input: ["example.com"] },
    rateLimitProfile: "default_active_light",
    timeoutMs: 120000,
    maxAttempts: 2
  });
  assert.equal(job.status, "queued");
  assert.equal(job.payload.input[0], "example.com");

  const claimed = store.claimNextJob({ workerId: "local-test" });
  assert.equal(claimed.id, job.id);
  assert.equal(claimed.status, "running");
  assert.equal(claimed.locked_by, "local-test");
  assert.equal(claimed.attempts, 1);

  const completed = store.updateJob(job.id, {
    status: "succeeded",
    checkpoint: { artifact: "stdout.txt" },
    finishedAt: new Date().toISOString()
  });
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.checkpoint.artifact, "stdout.txt");
  store.close();
});

test("recon parsers normalize domains, archived URLs, and httpx tech", () => {
  assert.equal(normalizeDomain("https://*.App.Example.COM/path"), "app.example.com");
  assert.deepEqual(extractDomains("a.example.com b.other.test", ["example.com"]), ["a.example.com"]);
  assert.deepEqual(parseGauUrls("https://app.example.com/login?debug=true", ["example.com"])[0].params, ["debug"]);
  assert.equal(parseHttpxJsonLines('{"url":"https://app.example.com","status_code":200,"tech":["React"]}')[0].statusCode, 200);
});

test("reverse whois helpers build bounded requests and parse domain leads", () => {
  const request = buildReverseWhoisRequest({
    apiKey: "secret",
    include: ["Yahoo Assets LLC", "yahoo", "extra1", "extra2", "extra3"],
    exclude: ["privacy"],
    mode: "preview",
    searchType: "current"
  });
  assert.equal(request.basicSearchTerms.include.length, 4);
  const parsed = parseReverseWhoisResponse({
    domainsCount: 1,
    domainsList: [{ domainName: "yahoo-example.com" }]
  }, request);
  assert.equal(parsed.leads[0].domain, "yahoo-example.com");
});

test("rdap suggestions prefer target-related org terms and skip private records", () => {
  const suggested = suggestReverseWhoisTermsFromRdapRecords([
    {
      domain: "acme.com",
      status: "completed",
      raw: {
        entities: [
          {
            roles: ["registrant"],
            vcardArray: ["vcard", [
              ["fn", {}, "text", "Acme Security Team"],
              ["org", {}, "text", "Acme Assets LLC"]
            ]]
          },
          {
            roles: ["technical"],
            vcardArray: ["vcard", [
              ["email", {}, "text", "dns@ns1.acme.com"]
            ]]
          },
          {
            roles: ["registrar"],
            vcardArray: ["vcard", [
              ["org", {}, "text", "Domains By Proxy LLC"]
            ]]
          }
        ],
        nameservers: [{ ldhName: "ns1.acme.com" }]
      }
    }
  ], ["acme.com"]);
  assert.deepEqual(suggested.includeTerms.slice(0, 2), ["Acme Assets LLC", "Acme Security Team"]);
  assert.ok(suggested.associatedDomains.includes("ns1.acme.com"));
  assert.ok(suggested.skippedPrivate.includes("Domains By Proxy LLC"));
  assert.ok(suggested.excludeTerms.includes("privacy"));
});

test("rdap suggestions reject reserved registry data for example domains", () => {
  const suggested = suggestReverseWhoisTermsFromRdapRecords([
    {
      domain: "example.com",
      status: "completed",
      raw: {
        entities: [
          {
            roles: ["registrant"],
            vcardArray: ["vcard", [
              ["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"],
              ["org", {}, "text", "Internet Assigned Numbers Authority"]
            ]]
          }
        ]
      }
    }
  ], ["example.com"]);
  assert.deepEqual(suggested.includeTerms, []);
  assert.ok(suggested.skippedPrivate.includes("Internet Assigned Numbers Authority"));
});

test("tool registry loads built-in manifests and validates required fields", () => {
  const registry = loadToolRegistry();
  assert.equal(registry.require("subfinder").parser, "domain_lines");
  assert.equal(registry.require("httpx").output_format, "jsonl");
  assert.equal(registry.list({ tag: "subdomain" })[0].tool_id, "subfinder");
  assert.ok(setupToolIds(registry).includes("nuclei"));

  const validation = validateToolManifest({ tool_id: "broken" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes("type is required"));
});

test("environment runner selects a valid local mode", () => {
  assert.ok(["native", "wsl"].includes(createEnvironmentRunner({ distro: "kali-linux" }).mode));
});

test("local artifact store writes safe run artifacts", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-artifacts-"));
  const artifacts = new LocalArtifactStore({ rootDir });
  const artifact = artifacts.writeText(7, "httpx/example.com stdout.txt", "hello");
  assert.match(artifact.path, /httpx_example\.com_stdout\.txt$/);
  assert.equal(fs.readFileSync(artifact.path, "utf8"), "hello");
});

test("local worker runs a claimed tool job and records artifacts", async () => {
  const store = openScanStore(tempDb("worker.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const run = store.createRun({ targetName: target.target_name });
  const artifactStore = new LocalArtifactStore({ rootDir: fs.mkdtempSync(path.join(os.tmpdir(), "aura-worker-artifacts-")) });
  store.createJob({
    runId: run.id,
    targetName: target.target_name,
    phase: "passive_subdomain_discovery",
    type: "tool",
    toolId: "subfinder",
    payload: { args: ["-d", "example.com", "-silent"] }
  });

  const runner = new FunctionToolRunner(async ({ tool, args }) => ({
    status: "completed",
    exitCode: 0,
    stdout: "www.example.com\n",
    stderr: "",
    commandDisplay: `${tool.binary} ${args.join(" ")}`,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  }));
  const completed = await runOneJob({ store, artifactStore, toolRunner: runner, workerId: "test-worker" });

  assert.equal(completed.status, "succeeded");
  assert.match(fs.readFileSync(completed.checkpoint.stdoutPath, "utf8"), /www\.example\.com/);
  assert.equal(store.listJobs({ runId: run.id })[0].locked_by, "test-worker");
  store.close();
});

test("local worker fails unsupported tool jobs with structured error", async () => {
  const store = openScanStore(tempDb("worker-failure.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const run = store.createRun({ targetName: target.target_name });
  store.createJob({
    runId: run.id,
    targetName: target.target_name,
    phase: "custom",
    type: "tool",
    toolId: "missing-tool"
  });

  const runner = new FunctionToolRunner(async () => {
    throw new Error("should not run");
  });
  const failed = await runOneJob({ store, toolRunner: runner, workerId: "test-worker" });

  assert.equal(failed.status, "failed");
  assert.match(failed.error_message, /Unknown tool/);
  store.close();
});
