"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { parseRapidDnsExport, queryRapidDns } = require("../src/recon/providers/rapiddns");

test("rapiddns parser extracts in-scope domains and urls", () => {
  const exportText = [
    "https://www.base.be",
    "https://api.base.be/login",
    "https://not-base.example",
    "cdn.assets.base.be"
  ].join("\n");
  assert.deepEqual(parseRapidDnsExport(exportText, "base.be").sort(), [
    "api.base.be",
    "cdn.assets.base.be",
    "www.base.be",
  ]);
});

test("rapiddns query uses the down export endpoint", async () => {
  const calls = [];
  const result = await queryRapidDns({
    rootDomain: "base.be",
    fetchText: async (url) => {
      calls.push(url);
      return "https://www.base.be\n";
    }
  });
  assert.equal(calls[0], "https://rapiddns.io/subdomain/base.be?full=1&down=1");
  assert.deepEqual(result.domains, ["www.base.be"]);
  assert.equal(result.metadata.mode, "rapiddns-export");
});
