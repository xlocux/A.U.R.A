"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openScanStore } = require("../src/db/scan-store");
const { CORRELATION_TECHNIQUES, scoreCandidate } = require("../src/recon/candidate-correlation");
const { extractDomains, normalizeDomain } = require("../src/recon/domain-utils");
const { parseGauUrls, parseHttpxJsonLines } = require("../src/recon/parsers");
const { buildResultTree } = require("../src/recon/result-tree");
const { generateWordlistFromDb } = require("../src/recon/wordlist-generator");
const { LocalArtifactStore } = require("../src/recon/artifact-store");
const { FunctionToolRunner, runOneJob } = require("../src/recon/local-worker");
const { loadToolRegistry, validateToolManifest } = require("../src/recon/tool-registry");
const { suggestReverseWhoisTermsFromRdapRecords } = require("../src/recon/providers/rdap-suggestions");
const { buildReverseWhoisRequest, parseReverseWhoisResponse } = require("../src/recon/providers/whoisxmlapi");
const { createEnvironmentRunner, setupToolIds } = require("../src/recon/environment-setup");
const { httpxArgsForInput } = require("../src/recon/recon-engine");
const { parseBuiltWithTechnologies, parseRetireTechnologies, parseWpscanTechnologies } = require("../src/recon/technology-detectors");
const { calculateTLDConfidence, ipInCIDR, scopeEvaluateTldCandidate } = require("../src/recon/tld-correlation-engine");
const { ALLOWED_TOOLS, normalizeProxyUrl, redactProxyUrl } = require("../src/recon/linux-tools");
const { createDefaultTargetConfig, validateTargetConfig } = require("../src/core/target-config");
const { buildRunDelta, buildTargetConfigFromRequest, extractBrandTerms, filterScopeDomains, generateAlternateTldLeads } = require("../src/web/api-routes");
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
    domains: ["example.com", "api.example.com", "dev.example.com", "nested.dev.example.com", "example.net"],
    rootDomains: ["example.com"],
    config: {
      scope: {
        out_of_scope: ["dev.example.com"]
      }
    }
  });
  assert.deepEqual(domains, ["example.com", "api.example.com"]);
});

test("bootstrap scope filtering keeps alternate TLDs out of scan seeds", () => {
  const domains = filterScopeDomains({
    domains: ["acme.com", "api.acme.com", "acme.net", "acme.io"],
    rootDomains: ["acme.com"],
    config: {
      scope: {
        out_of_scope: []
      }
    }
  });
  assert.deepEqual(domains, ["acme.com", "api.acme.com"]);
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

test("candidate correlation scores review leads without promoting alternate TLDs", () => {
  assert.ok(CORRELATION_TECHNIQUES.some((technique) => technique.id === "whois_rdap_overlap"));
  const alternate = scoreCandidate({
    rootDomains: ["acme.com"],
    lead: {
      value: "acme.net",
      source: "alternate-tld-correlation",
      matchTerms: ["acme"],
      metadata: {}
    }
  });
  assert.equal(alternate.score, 30);
  assert.ok(alternate.techniques.includes("brand_string_matching"));

  const scoped = scoreCandidate({
    rootDomains: ["acme.com"],
    lead: {
      value: "api.acme.com",
      source: "whoisxmlapi",
      matchTerms: ["acme"],
      metadata: {}
    }
  });
  assert.equal(scoped.score, 100);
  assert.ok(scoped.rationale.some((item) => item.includes("authorized root")));
});

test("TLD correlation engine auto-promotes only 100 percent confidence candidates", () => {
  const result = calculateTLDConfidence({
    value: "acme.io",
    source_tools: ["crt_sh"],
    certificate_sans: ["api.acme.com"],
    has_dns_resolution: true,
    dns_records: { a_record: "10.20.30.40" },
    nameservers: ["ns1.acme.com"]
  }, [
    { id: "domain:api.acme.com", type: "domain", value: "api.acme.com" },
    { id: "ip:10.20.30.40", type: "ip_address", value: "10.20.30.40", registrable_label: "acme" },
    { id: "ns:acme", type: "dns_record", record_type: "NS", value: ["ns1.acme.com"], registrable_label: "acme" }
  ]);
  assert.equal(result.confidence_score, 100);
  assert.equal(result.promotion_eligible, true);
  assert.equal(scopeEvaluateTldCandidate({ correlation_engine_result: result }).scope_status, "in_scope");
});

test("TLD correlation engine keeps sub-100 candidates in review", () => {
  const result = calculateTLDConfidence({
    value: "acme.dev",
    source_tools: ["crt_sh"],
    has_dns_resolution: true,
    dns_records: { a_record: "203.0.113.10" }
  }, []);
  assert.equal(result.confidence_score, 80);
  assert.equal(result.promotion_eligible, false);
  const evaluated = scopeEvaluateTldCandidate({ correlation_engine_result: result });
  assert.equal(evaluated.scope_status, "unknown");
  assert.equal(evaluated.requires_review, true);
});

test("TLD correlation applies explicit exclusion penalty and CIDR overlap", () => {
  assert.equal(ipInCIDR("10.20.30.40", "10.20.30.0/24"), true);
  const result = calculateTLDConfidence({
    value: "acme.net",
    source_tools: ["crt_sh"],
    has_dns_resolution: true,
    dns_records: { a_record: "10.20.30.40" }
  }, [
    { id: "cidr:10.20.30.0/24", type: "cidr_block", value: "10.20.30.0/24" },
    { id: "out:acme.net", type: "domain", value: "acme.net", scope_status: "out_of_scope" }
  ]);
  assert.equal(result.confidence_score, 40);
  assert.equal(result.signals.some((signal) => signal.signal === "explicit_exclusion"), true);
});

test("HTTP follow-up uses ProjectDiscovery httpx list and tech flags", () => {
  const args = httpxArgsForInput("/tmp/aura-hosts.txt");
  assert.deepEqual(args.slice(0, 2), ["-l", "/tmp/aura-hosts.txt"]);
  assert.ok(args.includes("-tech-detect"));
  assert.ok(args.includes("-json"));
});

test("technology detector parsers normalize optional enrichment output", () => {
  assert.ok(parseRetireTechnologies(JSON.stringify({ data: [{ component: "jquery", version: "3.6.0" }] })).includes("jquery"));
  assert.ok(parseWpscanTechnologies(JSON.stringify({ version: { number: "6.4" }, plugins: { akismet: {} } })).includes("WordPress 6.4"));
  assert.ok(parseBuiltWithTechnologies(JSON.stringify({ Results: [{ Result: { Paths: [{ Technologies: [{ Name: "Cloudflare" }] }] } }] })).includes("Cloudflare"));
});

test("enabled optional technology detector CLIs are allowed by the Linux runner", () => {
  for (const toolName of ["retire", "wpscan", "cmseek"]) {
    assert.equal(ALLOWED_TOOLS.has(toolName), true);
  }
  assert.equal(ALLOWED_TOOLS.has("wappalyzer"), false);
  assert.equal(setupToolIds().includes("wappalyzer"), false);
});

test("proxy settings accept explicit interception proxies and redact credentials", () => {
  assert.equal(normalizeProxyUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(normalizeProxyUrl("socks5://127.0.0.1:9050"), "socks5://127.0.0.1:9050");
  assert.equal(redactProxyUrl("socks4://user:pass@proxy.local:1080"), "socks4://****:****@proxy.local:1080");
  assert.throws(() => normalizeProxyUrl("ftp://proxy.local:21"), /http, https, socks4, or socks5/);
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
    { domain: "www.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" },
    { domain: "api-prod.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" }
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
  const smart = generateWordlistFromDb(store, {
    targetName: "demo",
    category: "smart-domains",
    name: "demo-smart-domains",
    outputDir: fs.mkdtempSync(path.join(os.tmpdir(), "aura-wordlists-"))
  });
  const smartContent = fs.readFileSync(smart.path, "utf8");
  assert.match(smartContent, /api-prod/);
  assert.match(smartContent, /dev-api/);
  const results = store.searchAll({ query: "nginx", targetName: "demo" });
  assert.equal(results[0].result_type, "http_service");
  assert.equal(results[0].target_name, "demo");
  const technologies = store.listTechnologySummary({ runId: run.id });
  assert.equal(technologies[0].name, "nginx");
  assert.equal(technologies[0].count, 1);
  assert.equal(technologies[0].hostCount, 1);
  const tree = buildResultTree({
    run,
    target,
    counts: store.getRunObservationCounts(run.id),
    domains: store.listDomains({ runId: run.id }),
    httpServices: store.listHttpServices({ runId: run.id }),
    urls: store.listUrls({ runId: run.id }),
    screenshots: store.listScreenshots({ runId: run.id }),
    assetLeads: [],
    delta: null
  });
  assert.equal(tree.roots[0].domain, "example.com");
  assert.equal(tree.roots[0].summary.domains, 2);
  const www = tree.roots[0].children.find((node) => node.domain === "www.example.com");
  assert.equal(www.services.length, 1);
  assert.equal(www.urls.length, 1);
  assert.deepEqual(www.technologies, ["nginx"]);
  store.close();
});

test("scan store automatically compacts duplicate recon observations", () => {
  const store = openScanStore(tempDb("dedup.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const run = store.createRun({ targetName: target.target_name });
  store.saveDomains(run.id, target.target_name, [
    { domain: "www.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" },
    { domain: "www.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" },
    { domain: "WWW.EXAMPLE.COM", rootDomain: "example.com", kind: "subdomain", source: "wayback" }
  ]);
  store.saveUrls(run.id, target.target_name, [
    { url: "https://www.example.com/login", host: "www.example.com", path: "/login", params: [] },
    { url: "https://www.example.com/login", host: "www.example.com", path: "/login", params: [] }
  ], "gau");
  store.saveHttpServices(run.id, target.target_name, [
    { url: "https://www.example.com", host: "www.example.com", scheme: "https", port: 443, statusCode: 200, title: "Example", technologies: ["nginx"], raw: {} },
    { url: "https://www.example.com", host: "www.example.com", scheme: "https", port: 443, statusCode: 200, title: "Example", technologies: ["nginx"], raw: {} }
  ]);

  const domains = store.listDomains({ runId: run.id });
  assert.equal(domains.length, 1);
  assert.equal(domains[0].domain.toLowerCase(), "www.example.com");
  assert.match(domains[0].source, /crtsh/);
  assert.match(domains[0].source, /wayback/);
  assert.equal(store.listUrls({ runId: run.id }).length, 1);
  assert.equal(store.listHttpServices({ runId: run.id }).length, 1);
  assert.deepEqual(store.getRunObservationCounts(run.id), {
    domains: 1,
    urls: 1,
    httpServices: 1,
    technologies: 1,
    screenshots: 0,
    events: 0,
    toolResults: 0
  });
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

test("run delta compares discoveries with the previous target run", () => {
  const store = openScanStore(tempDb("run-delta.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const first = store.createRun({ targetName: target.target_name });
  store.saveDomains(first.id, target.target_name, [
    { domain: "old.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" },
    { domain: "shared.example.com", rootDomain: "example.com", kind: "subdomain", source: "crtsh" }
  ]);
  store.saveUrls(first.id, target.target_name, [
    { url: "https://shared.example.com/old", host: "shared.example.com", path: "/old", params: [] }
  ]);

  const second = store.createRun({ targetName: target.target_name });
  store.saveDomains(second.id, target.target_name, [
    { domain: "new.example.com", rootDomain: "example.com", kind: "subdomain", source: "subfinder" },
    { domain: "shared.example.com", rootDomain: "example.com", kind: "subdomain", source: "subfinder" }
  ]);
  store.saveUrls(second.id, target.target_name, [
    { url: "https://shared.example.com/new", host: "shared.example.com", path: "/new", params: [] }
  ]);
  store.saveHttpServices(second.id, target.target_name, [
    { url: "https://new.example.com", host: "new.example.com", scheme: "https", port: 443, statusCode: 200, title: "New", technologies: [], raw: {} }
  ]);

  const delta = buildRunDelta(store, second.id);
  assert.equal(delta.comparedToRunId, first.id);
  assert.equal(delta.domains.addedCount, 1);
  assert.equal(delta.domains.removedCount, 1);
  assert.equal(delta.domains.stableCount, 1);
  assert.equal(delta.domains.added[0].domain, "new.example.com");
  assert.equal(delta.domains.removed[0].domain, "old.example.com");
  assert.equal(delta.urls.addedCount, 1);
  assert.equal(delta.urls.removedCount, 1);
  assert.equal(delta.httpServices.addedCount, 1);
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

test("scan store refreshes asset lead correlation status", () => {
  const store = openScanStore(tempDb("asset-lead-status.db"));
  const target = store.upsertTarget(path.resolve("targets/leads/target.json"), createDefaultTargetConfig("leads"));
  const run = store.createRun({ targetName: target.target_name });
  store.saveAssetLeads(run.id, target.target_name, [
    { value: "acme.net", source: "alternate-tld-correlation", confidence: "candidate", status: "new" }
  ]);
  store.saveAssetLeads(run.id, target.target_name, [
    {
      value: "acme.net",
      source: "alternate-tld-correlation",
      confidence: "weak_candidate",
      status: "weak_lead",
      metadata: { correlationScore: 30 }
    }
  ]);
  const [lead] = store.listAssetLeads({ targetName: target.target_name });
  assert.equal(lead.status, "weak_lead");
  assert.equal(lead.confidence, "weak_candidate");
  assert.equal(lead.metadata.correlationScore, 30);
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

test("scan store lists recorded tool results for run exports", () => {
  const store = openScanStore(tempDb("tool-results.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const run = store.createRun({ targetName: target.target_name });
  store.recordToolResult(run.id, {
    toolName: "subfinder",
    commandDisplay: "subfinder -d example.com",
    status: "completed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString()
  });
  const results = store.listToolResults({ runId: run.id });
  assert.equal(results.length, 1);
  assert.equal(results[0].toolName, "subfinder");
  assert.equal(results[0].commandDisplay, "subfinder -d example.com");
  store.close();
});

test("scan store retrieves screenshot runs for image serving", () => {
  const store = openScanStore(tempDb("screenshots.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), createDefaultTargetConfig("demo"));
  const run = store.createRun({ targetName: target.target_name });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-shots-"));
  store.saveScreenshotRun(run.id, target.target_name, {
    toolName: "gowitness",
    outputDir,
    metadata: { status: "completed", screenshotCount: 1 }
  });
  const [shot] = store.listScreenshots({ runId: run.id });
  assert.equal(store.getScreenshot(shot.id).output_dir, outputDir);
  assert.equal(store.getScreenshot(shot.id).metadata.screenshotCount, 1);
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
  assert.equal(createEnvironmentRunner({ runtime: "linux" }).mode, "native");
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
