"use strict";

const { extractDomains, normalizeDomain } = require("../domain-utils");

function parseRapidDnsExport(text, rootDomain) {
  const root = normalizeDomain(rootDomain);
  if (!root) return [];
  return extractDomains(String(text || ""), [root]);
}

async function queryRapidDns({ rootDomain, fetchText }) {
  const root = normalizeDomain(rootDomain);
  if (!root) return { domains: [], metadata: { mode: "invalid-root" } };
  const url = `https://rapiddns.io/subdomain/${encodeURIComponent(root)}?full=1&down=1`;
  const body = await fetchText(url, 30000);
  return {
    domains: parseRapidDnsExport(body, root),
    metadata: {
      mode: "rapiddns-export",
      url
    }
  };
}

module.exports = {
  parseRapidDnsExport,
  queryRapidDns
};
