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

test("bypass403Args builds a single-URL invocation with output dir", () => {
  const { bypass403Args } = require("../src/recon/engine/cloud-dirs");
  const args = bypass403Args("https://acme.example/admin", "/tmp/out");
  assert.equal(args[args.indexOf("-u") + 1], "https://acme.example/admin");
  assert.ok(args.includes("-o"));
});

test("parseBypass403Db reads the scan_results sqlite and keeps successful bypasses", () => {
  const { parseBypass403Db } = require("../src/recon/engine/cloud-dirs");
  const { DatabaseSync } = require("node:sqlite");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-bypass-"));
  const db = new DatabaseSync(path.join(dir, "gobypass403.db"));
  db.exec("CREATE TABLE scan_results (bypass_module TEXT, curl_cmd TEXT, status_code INTEGER, content_length INTEGER, url TEXT)");
  db.prepare("INSERT INTO scan_results VALUES (?,?,?,?,?)").run("header", "curl https://acme.example/admin", 200, 1200, "https://acme.example/admin");
  db.prepare("INSERT INTO scan_results VALUES (?,?,?,?,?)").run("path", "curl https://acme.example/admin", 403, 12, "https://acme.example/admin");
  db.prepare("INSERT INTO scan_results VALUES (?,?,?,?,?)").run("verb", "curl https://acme.example/secret", 301, 0, null);
  db.close();
  const findings = parseBypass403Db(dir);
  assert.equal(findings.length, 2, "only the 200 and 301 rows are kept");
  assert.ok(findings.some((f) => f.status === 200 && f.target === "https://acme.example/admin"));
  assert.ok(findings.some((f) => f.status === 301 && f.target === "https://acme.example/secret"), "url recovered from curl_cmd when column is null");
});

test("parseJsUrls extracts http(s) script URLs one per line", () => {
  const { parseJsUrls } = require("../src/recon/engine/cloud-dirs");
  const out = parseJsUrls("https://acme.example/app.js\n/relative/skip.js\nhttps://cdn.acme.example/vendor.js\n");
  assert.deepEqual(out, ["https://acme.example/app.js", "https://cdn.acme.example/vendor.js"]);
});
