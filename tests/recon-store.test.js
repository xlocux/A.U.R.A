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
const { buildReverseWhoisRequest, parseReverseWhoisResponse } = require("../src/recon/providers/whoisxmlapi");
const { createDefaultTargetConfig, validateTargetConfig } = require("../src/core/target-config");

function tempDb(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-"));
  return path.join(dir, name);
}

test("target config validates default targets", () => {
  assert.deepEqual(validateTargetConfig(createDefaultTargetConfig("demo")), []);
});

test("scan store records recon data and generated wordlists", () => {
  const store = openScanStore(tempDb("scan.db"));
  const target = store.upsertTarget(path.resolve("targets/demo/target.json"), {
    target_name: "demo",
    asset_type: "webapp",
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
