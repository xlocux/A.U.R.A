"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractProductVersions,
  nucleiArgs,
  parseNucleiJsonl,
  parseTechToken
} = require("../src/recon/engine/vuln-assessment");
const { buildRequestUrl, parseNvdResponse } = require("../src/web/services/nvd-client");

// ── nuclei JSONL parser ─────────────────────────────────────────────────────────
test("nucleiArgs builds a jsonl, silent, severity-filtered, rate-limited invocation", () => {
  const args = nucleiArgs("/tmp/nuclei-input.txt");
  assert.ok(args.includes("-l"));
  assert.ok(args.includes("-jsonl"));
  assert.ok(args.includes("-silent"));
  assert.equal(args[args.indexOf("-severity") + 1], "low,medium,high,critical");
  assert.equal(args[args.indexOf("-rate-limit") + 1], "50");
});

test("parseNucleiJsonl reads hyphenated keys, skips non-json, and dedupes", () => {
  const lines = [
    JSON.stringify({
      "template-id": "CVE-2021-44228",
      info: { name: "Log4j RCE", severity: "Critical", description: "log4shell", reference: ["https://ref/1"] },
      "matched-at": "https://acme.example"
    }),
    "[INF] progress log line that is not json",
    JSON.stringify({
      "template-id": "tech-detect",
      info: { name: "Nginx detected", severity: "info" },
      host: "https://acme.example"
    }),
    // duplicate of the first finding (same template + matched-at) is dropped
    JSON.stringify({
      "template-id": "CVE-2021-44228",
      info: { name: "Log4j RCE", severity: "critical" },
      "matched-at": "https://acme.example"
    })
  ].join("\n");
  const findings = parseNucleiJsonl(lines);
  assert.equal(findings.length, 2);
  assert.equal(findings[0].templateId, "CVE-2021-44228");
  assert.equal(findings[0].severity, "critical", "severity is lowercased");
  assert.equal(findings[0].matchedAt, "https://acme.example");
  assert.deepEqual(findings[0].reference, ["https://ref/1"]);
  assert.equal(findings[1].matchedAt, "https://acme.example", "host used when matched-at absent");
});

test("parseNucleiJsonl returns empty on blank or malformed input", () => {
  assert.deepEqual(parseNucleiJsonl(""), []);
  assert.deepEqual(parseNucleiJsonl("not json\nalso not json"), []);
});

// ── product:version extraction & dedup ──────────────────────────────────────────
test("parseTechToken splits product and version across common separators", () => {
  assert.deepEqual(parseTechToken("nginx/1.18.0"), { product: "nginx", version: "1.18.0" });
  assert.deepEqual(parseTechToken("WordPress:5.8"), { product: "WordPress", version: "5.8" });
  assert.deepEqual(parseTechToken("jQuery 3.4.1"), { product: "jQuery", version: "3.4.1" });
  assert.equal(parseTechToken("nginx"), null, "no version token -> null");
  assert.equal(parseTechToken(""), null);
});

test("extractProductVersions merges technologies (objects+strings) and service tech, deduped", () => {
  const pairs = extractProductVersions({
    technologies: [
      { name: "Apache", version: "2.4.49" },
      "PHP/7.4.3",
      { name: "nginx/1.18.0" }, // object with no version, parse from name
      { name: "SomeTool" } // no version at all -> ignored
    ],
    services: [
      { technologies: ["WordPress:5.8", "nginx/1.18.0"] }, // nginx duplicate dropped
      { tech: ["jQuery 3.4.1"], webserver: "Apache/2.4.49" } // Apache duplicate dropped
    ]
  });
  const keys = pairs.map((p) => `${p.product.toLowerCase()}@${p.version}`);
  assert.ok(keys.includes("apache@2.4.49"));
  assert.ok(keys.includes("php@7.4.3"));
  assert.ok(keys.includes("nginx@1.18.0"));
  assert.ok(keys.includes("wordpress@5.8"));
  assert.ok(keys.includes("jquery@3.4.1"));
  // no duplicates
  assert.equal(new Set(keys).size, keys.length);
  // "SomeTool" without a version is excluded
  assert.ok(!keys.some((k) => k.startsWith("sometool@")));
});

test("extractProductVersions caps results to stay polite with NVD", () => {
  const technologies = [];
  for (let i = 0; i < 60; i += 1) technologies.push(`product${i}/1.0.${i}`);
  const pairs = extractProductVersions({ technologies });
  assert.ok(pairs.length <= 25, `expected <=25, got ${pairs.length}`);
});

// ── NVD response parser ─────────────────────────────────────────────────────────
test("buildRequestUrl uses keywordSearch, exact match, and capped resultsPerPage", () => {
  const url = new URL(buildRequestUrl("nginx", "1.18.0"));
  assert.equal(url.searchParams.get("keywordSearch"), "nginx 1.18.0");
  assert.ok(url.searchParams.has("keywordExactMatch"));
  assert.equal(url.searchParams.get("resultsPerPage"), "20");
});

test("parseNvdResponse maps a sample NVD 2.0 object to {id,cvss,severity,summary,url}", () => {
  const sample = {
    vulnerabilities: [
      {
        cve: {
          id: "CVE-2021-23017",
          descriptions: [
            { lang: "es", value: "descripcion" },
            { lang: "en", value: "  A resolver off-by-one heap write in nginx.  " }
          ],
          metrics: {
            cvssMetricV31: [{ cvssData: { baseScore: 9.4, baseSeverity: "CRITICAL" }, baseSeverity: "CRITICAL" }],
            cvssMetricV2: [{ cvssData: { baseScore: 6.8 }, baseSeverity: "MEDIUM" }]
          }
        }
      }
    ]
  };
  const findings = parseNvdResponse(sample);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    id: "CVE-2021-23017",
    cvss: 9.4,
    severity: "critical",
    summary: "A resolver off-by-one heap write in nginx.",
    url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23017"
  });
});

test("parseNvdResponse prefers v3.0 over v2 and derives severity from score when missing", () => {
  const findings = parseNvdResponse({
    vulnerabilities: [
      {
        cve: {
          id: "CVE-2020-0001",
          descriptions: [{ lang: "en", value: "demo" }],
          metrics: {
            cvssMetricV30: [{ cvssData: { baseScore: 5.5 } }], // no baseSeverity -> derived "medium"
            cvssMetricV2: [{ cvssData: { baseScore: 2.1 }, baseSeverity: "LOW" }]
          }
        }
      }
    ]
  });
  assert.equal(findings[0].cvss, 5.5);
  assert.equal(findings[0].severity, "medium");
});

test("parseNvdResponse handles empty/missing metrics and dedupes by id", () => {
  const findings = parseNvdResponse({
    vulnerabilities: [
      { cve: { id: "CVE-1", descriptions: [], metrics: {} } },
      { cve: { id: "CVE-1", descriptions: [{ lang: "en", value: "dup" }], metrics: {} } }
    ]
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].cvss, null);
  assert.equal(findings[0].severity, null);
  assert.equal(findings[0].summary, "");
});

test("parseNvdResponse returns empty array for non-object or empty input", () => {
  assert.deepEqual(parseNvdResponse(null), []);
  assert.deepEqual(parseNvdResponse({}), []);
  assert.deepEqual(parseNvdResponse({ vulnerabilities: [] }), []);
});
