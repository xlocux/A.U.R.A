"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildWhoisFreaksUrl, parseWhoisFreaksHistoricalResponse } = require("../src/recon/providers/whoisfreaks");

test("buildWhoisFreaksUrl selects historical WHOIS mode", () => {
  const url = new URL(buildWhoisFreaksUrl({ apiKey: "secret", domainName: "example.com" }));
  assert.equal(url.searchParams.get("whois"), "historical");
  assert.equal(url.searchParams.get("domainName"), "example.com");
  assert.equal(url.searchParams.get("apiKey"), "secret");
});

test("parseWhoisFreaksHistoricalResponse extracts target-related historical terms", () => {
  const parsed = parseWhoisFreaksHistoricalResponse({
    whois_domains_historical: [
      {
        domain_name: "acme.com",
        registrant_contact: {
          company: "Acme Security Ltd",
          email_address: "admin@acme.com"
        },
        administrative_contact: {
          company: "Domains By Proxy"
        }
      }
    ]
  }, ["acme.com"]);

  assert.deepEqual(parsed.includeTerms, ["Acme Security Ltd", "acme.com"]);
  assert.equal(parsed.totalRecords, 1);
});
