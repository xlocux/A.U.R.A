"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { domainsFromFdnsLine } = require("../src/recon/providers/rapid7-opendata");
const { runPassiveSource } = require("../src/recon/passive-sources");

test("rapid7 fdns parser extracts in-scope names from json lines", () => {
  const line = JSON.stringify({
    name: "cdn.assets.example.com",
    type: "cname",
    value: "edge.example.com"
  });
  assert.deepEqual(domainsFromFdnsLine(line, "example.com"), ["cdn.assets.example.com", "edge.example.com"]);
});

test("rapid7 passive source degrades to metadata-only without local fdns extract", async () => {
  const result = await runPassiveSource("rapid7", "example.com", { apiKeys: {} });
  assert.deepEqual(result.domains, []);
  assert.equal(result.metadata.mode, "metadata-only");
  assert.match(result.metadata.reason, /AURA_RAPID7_FDNS_PATH/);
});
