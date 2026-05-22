"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDomain } = require("../recon/domain-utils");
const { readJson } = require("../core/io");

function discoverTargets(store) {
  const targetsDir = path.resolve("targets");
  if (!fs.existsSync(targetsDir)) return [];
  const targets = [];
  for (const entry of fs.readdirSync(targetsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(targetsDir, entry.name, "target.json");
    if (!fs.existsSync(configPath)) continue;
    try {
      targets.push(store.upsertTarget(configPath, readJson(configPath)));
    } catch {
      // Broken target config should not take down the dashboard.
    }
  }
  return targets;
}

function inferRootDomains(target) {
  const scope = target?.scope || {};
  const values = [...(scope.in_scope || []), target?.program_url || ""];
  const domains = values
    .flatMap((value) => String(value).split(/[\s,]+/))
    .map(normalizeDomain)
    .filter(Boolean);
  return [...new Set(domains)];
}

module.exports = {
  discoverTargets,
  inferRootDomains
};
