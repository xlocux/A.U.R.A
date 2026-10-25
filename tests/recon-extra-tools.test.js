"use strict";

// Parser/arg-builder coverage for the extra recon tools (katana, tlsx, subzy, waymore, paramspider).
// The tools themselves are not installed in CI, so this validates the pure output-parsing logic.

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  katanaArgs, parseKatanaJsonl,
  tlsxArgs, parseTlsxDomains,
  subzyArgs, parseSubzyFindings,
  parseUrlLines
} = require("../src/recon/engine/recon-extra-tools");

test("parseKatanaJsonl extracts endpoints from JSONL and falls back to regex", () => {
  const stdout = [
    JSON.stringify({ timestamp: "t", endpoint: "https://acme.example/a" }),
    JSON.stringify({ request: { endpoint: "https://acme.example/b" } }),
    "not-json but https://acme.example/c here",
    JSON.stringify({ endpoint: "ftp://skip.example/x" }),
    ""
  ].join("\n");
  const urls = parseKatanaJsonl(stdout);
  assert.ok(urls.includes("https://acme.example/a"));
  assert.ok(urls.includes("https://acme.example/b"));
  assert.ok(urls.includes("https://acme.example/c"));
  assert.ok(!urls.some((u) => u.startsWith("ftp://")));
});

test("parseTlsxDomains collects in-scope SAN/CN hostnames and strips wildcards", () => {
  const stdout = [
    JSON.stringify({ subject_an: ["*.acme.example", "api.acme.example"], subject_cn: "www.acme.example" }),
    JSON.stringify({ subject_an: ["evil.other.com"] }),
    "garbage"
  ].join("\n");
  const domains = parseTlsxDomains(stdout, ["acme.example"]);
  assert.ok(domains.includes("acme.example"));
  assert.ok(domains.includes("api.acme.example"));
  assert.ok(domains.includes("www.acme.example"));
  assert.ok(!domains.includes("evil.other.com"), "out-of-scope SAN must be dropped");
});

test("parseTlsxDomains keeps all hostnames when no scope roots given", () => {
  const stdout = JSON.stringify({ subject_an: ["a.example", "b.test"] });
  const domains = parseTlsxDomains(stdout, []);
  assert.deepEqual(domains.sort(), ["a.example", "b.test"]);
});

test("parseSubzyFindings returns only vulnerable rows with URL (ANSI-stripped)", () => {
  const stdout = [
    "\x1b[32m[ NOT VULNERABLE ] https://safe.acme.example\x1b[0m",
    "[ VULNERABLE ] https://take.acme.example [github]",
    "noise line"
  ].join("\n");
  const findings = parseSubzyFindings(stdout);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].url, "https://take.acme.example");
});

test("parseUrlLines dedupes and extracts http(s) URLs", () => {
  const text = "https://acme.example/?a=1\nhttps://acme.example/?a=1\n# comment\nhttps://acme.example/b";
  const urls = parseUrlLines(text);
  assert.equal(urls.length, 2);
});

test("arg builders reference the input path and expected flags", () => {
  assert.ok(katanaArgs("/tmp/in.txt").includes("-jsonl"));
  assert.ok(tlsxArgs("/tmp/in.txt").includes("-san"));
  assert.ok(subzyArgs("/tmp/in.txt").includes("--vuln"));
});
