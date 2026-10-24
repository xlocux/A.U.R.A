"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  cloudEnumArgs,
  deriveCloudKeywords,
  ffufArgsForUrl,
  parseCloudEnumJson,
  parseFfufJson
} = require("../src/recon/engine/cloud-dirs");

test("ffufArgsForUrl builds a FUZZ url with json output and the wordlist", () => {
  const args = ffufArgsForUrl("https://acme.example/", "/tmp/paths.txt", "/tmp/out.json");
  assert.ok(args.includes("-u"));
  assert.equal(args[args.indexOf("-u") + 1], "https://acme.example/FUZZ");
  assert.equal(args[args.indexOf("-of") + 1], "json");
  assert.ok(args.includes("-w"));
});

test("parseFfufJson extracts discovered paths from ffuf json output", () => {
  const content = JSON.stringify({
    results: [
      { url: "https://acme.example/admin", status: 200, length: 1024, input: { FUZZ: "admin" } },
      { url: "https://acme.example/backup", status: 403, length: 12, input: { FUZZ: "backup" } }
    ]
  });
  const hits = parseFfufJson(content);
  assert.equal(hits.length, 2);
  assert.equal(hits[0].url, "https://acme.example/admin");
  assert.equal(hits[0].statusCode, 200);
  assert.equal(hits[0].path, "/admin");
  assert.equal(hits[1].statusCode, 403);
});

test("parseFfufJson returns empty on malformed input", () => {
  assert.deepEqual(parseFfufJson("not json"), []);
  assert.deepEqual(parseFfufJson(""), []);
});

test("deriveCloudKeywords derives brand labels and url tokens, skipping noise", () => {
  const keywords = deriveCloudKeywords({
    domains: [{ domain: "acme.co.uk" }, { domain: "internal.acme.co.uk" }, "www.acme.com"],
    urls: [{ url: "https://acme.com/backups/report" }, { url: "https://acme.com/assets/app.js" }]
  });
  assert.ok(keywords.includes("acme"), "brand label");
  assert.ok(keywords.includes("internal"), "distinctive subdomain");
  assert.ok(keywords.includes("backups"), "url path token");
  assert.ok(!keywords.includes("www"), "reserved label dropped");
  assert.ok(!keywords.includes("assets"), "static/reserved token dropped");
});

test("cloudEnumArgs passes repeated -k keywords, json log and quickscan", () => {
  const args = cloudEnumArgs({ keywords: ["acme", "acme-io"], outputPath: "/tmp/cloud.json" });
  const kFlags = args.filter((arg) => arg === "-k");
  assert.equal(kFlags.length, 2);
  assert.equal(args[args.indexOf("-f") + 1], "json");
  assert.ok(args.includes("-qs"));
});

test("parseCloudEnumJson reads ndjson and a json array of findings", () => {
  const ndjson = [
    JSON.stringify({ platform: "aws", target: "https://acme.s3.amazonaws.com", access: "public" }),
    "not-json-log-line",
    JSON.stringify({ platform: "gcp", target: "https://storage.googleapis.com/acme-backups" })
  ].join("\n");
  const findings = parseCloudEnumJson(ndjson);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].platform, "aws");
  assert.equal(findings[1].platform, "gcp");

  const array = JSON.stringify([{ target: "https://acme.blob.core.windows.net" }]);
  const fromArray = parseCloudEnumJson(array);
  assert.equal(fromArray.length, 1);
  assert.equal(fromArray[0].platform, "azure");
});

test("parseCloudEnumJson dedupes repeated resources", () => {
  const content = [
    JSON.stringify({ platform: "aws", target: "https://dup.s3.amazonaws.com" }),
    JSON.stringify({ platform: "aws", target: "https://dup.s3.amazonaws.com" })
  ].join("\n");
  assert.equal(parseCloudEnumJson(content).length, 1);
});
