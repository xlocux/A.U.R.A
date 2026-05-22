"use strict";

const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

function normalizeDomain(value) {
  if (!value) return null;
  let domain = String(value).trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, "");
  domain = domain.replace(/\/.*$/, "");
  domain = domain.replace(/^\*\./, "");
  domain = domain.replace(/\.$/, "");
  if (!DOMAIN_RE.test(domain)) return null;
  return domain;
}

function extractDomains(text, rootDomains = []) {
  const roots = rootDomains.map(normalizeDomain).filter(Boolean);
  const found = new Set();
  const pattern = /(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}/gi;
  for (const match of String(text || "").matchAll(pattern)) {
    const domain = normalizeDomain(match[0]);
    if (!domain) continue;
    if (roots.length > 0 && !roots.some((root) => domain === root || domain.endsWith(`.${root}`))) {
      continue;
    }
    found.add(domain);
  }
  return [...found].sort();
}

function rootForDomain(domain, rootDomains = []) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const roots = rootDomains.map(normalizeDomain).filter(Boolean);
  return roots.find((root) => normalized === root || normalized.endsWith(`.${root}`)) || null;
}

module.exports = {
  extractDomains,
  normalizeDomain,
  rootForDomain
};
