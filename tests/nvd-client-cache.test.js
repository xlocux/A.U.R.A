"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { lookupCves, CACHE_DIR } = require("../src/web/services/nvd-client");

test("an NVD 503 is not cached as 'no CVEs'; the next call fetches again", async () => {
  const product = `aura-test-${process.pid}-${Date.now()}`;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 503, text: async () => "" };
    return { ok: true, status: 200, text: async () => JSON.stringify({ vulnerabilities: [{ cve: { id: "CVE-2000-0001", descriptions: [{ lang: "en", value: "x" }], metrics: {} } }] }) };
  };
  try {
    const first = await lookupCves({ product, version: "1.0", apiKey: "k", fetchImpl });
    assert.equal(first.length, 0);
    assert.equal(first.failed, true);
    const second = await lookupCves({ product, version: "1.0", apiKey: "k", fetchImpl });
    assert.equal(calls, 2);
    assert.equal(second[0].id, "CVE-2000-0001");
  } finally {
    for (const f of fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR) : []) {
      try { if (JSON.parse(fs.readFileSync(`${CACHE_DIR}/${f}`, "utf8")).product === product) fs.rmSync(`${CACHE_DIR}/${f}`); } catch { /* ignore */ }
    }
  }
});
