"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { collectWhoisXmlDrsDomains } = require("../src/recon/providers/whoisxmlapi");

test("collectWhoisXmlDrsDomains merges DRS WHOIS, Domain Info, and subdomain data", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "www.whoisxmlapi.com") {
      return jsonResponse({
        WhoisRecord: {
          registrant: { organization: "Acme Security" },
          nameServers: { hostNames: ["ns1.acme.com"] }
        }
      });
    }
    if (parsed.hostname === "domain-info.whoisxmlapi.com") {
      return jsonResponse({ domainName: "acme.com", registrant: { email: "admin@acme.com" } });
    }
    return jsonResponse({ result: { records: [{ domain: "portal.acme.com" }] } });
  };

  const result = await collectWhoisXmlDrsDomains({ apiKey: "key", rootDomain: "acme.com", fetchImpl });
  assert.ok(result.domains.includes("portal.acme.com"));
  assert.ok(result.metadata.products.includes("whois"));
  assert.ok(result.metadata.products.includes("domain-info"));
  assert.ok(result.metadata.products.includes("subdomains"));
  assert.ok(result.metadata.pivots.some((pivot) => pivot.type === "registrant-organization"));
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  };
}
