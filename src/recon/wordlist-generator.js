"use strict";

const fs = require("node:fs");
const path = require("node:path");

const GENERATED_DIR = path.resolve("data", "wordlists", "generated");

function generateWordlistFromDb(store, { targetName, category, name, outputDir = GENERATED_DIR }) {
  const entries = entriesForCategory(store, targetName, category);
  const unique = [...new Set(entries.map(cleanEntry).filter(Boolean))].sort();
  fs.mkdirSync(outputDir, { recursive: true });
  const safeName = safeFileName(name || `${targetName || "global"}-${category}`);
  const filePath = path.join(outputDir, `${safeName}.txt`);
  fs.writeFileSync(filePath, `${unique.join("\n")}${unique.length ? "\n" : ""}`, "utf8");
  return {
    name: safeName,
    category,
    path: filePath,
    count: unique.length
  };
}

function entriesForCategory(store, targetName, category) {
  if (category === "domains") return domainLabels(store, targetName);
  if (category === "smart-domains") return smartDomainLabels(store, targetName);
  if (category === "params") return params(store, targetName);
  if (category === "paths") return paths(store, targetName);
  if (category === "technologies") return technologies(store, targetName);
  return [];
}

function domainLabels(store, targetName) {
  const rows = store.listDomains({ targetName, limit: 100000 });
  const labels = [];
  for (const row of rows) {
    const root = row.root_domain || "";
    const domain = row.domain || "";
    if (!domain || domain === root) continue;
    const suffix = root ? `.${root}` : "";
    const relative = suffix && domain.endsWith(suffix)
      ? domain.slice(0, -suffix.length)
      : domain;
    labels.push(...relative.split("."));
  }
  return labels;
}

function smartDomainLabels(store, targetName) {
  const observed = [...new Set(domainLabels(store, targetName).map(cleanEntry).filter(Boolean))];
  const tokens = new Set();
  for (const label of observed) {
    tokens.add(label);
    for (const token of label.split(/[-_.]+/).map(cleanEntry).filter(Boolean)) {
      tokens.add(token);
    }
  }
  const coreTokens = [...tokens]
    .filter((token) => token.length >= 3 && token.length <= 24)
    .filter((token) => !COMMON_ENV_TOKENS.has(token))
    .slice(0, 250);
  const generated = new Set([...observed, ...COMMON_ENV_TOKENS]);

  for (const token of coreTokens) {
    for (const env of COMMON_ENV_TOKENS) {
      generated.add(`${env}-${token}`);
      generated.add(`${token}-${env}`);
      generated.add(`${env}${token}`);
      generated.add(`${token}${env}`);
    }
    for (const region of COMMON_REGION_TOKENS) {
      generated.add(`${token}-${region}`);
      generated.add(`${region}-${token}`);
    }
  }

  for (const env of COMMON_ENV_TOKENS) {
    for (const region of COMMON_REGION_TOKENS) {
      generated.add(`${env}-${region}`);
      generated.add(`${region}-${env}`);
    }
  }

  return [...generated].filter(validDnsLabel).slice(0, 5000);
}

const COMMON_ENV_TOKENS = new Set([
  "api",
  "admin",
  "app",
  "auth",
  "beta",
  "cdn",
  "cloud",
  "corp",
  "dashboard",
  "dev",
  "edge",
  "internal",
  "login",
  "m",
  "mobile",
  "portal",
  "preprod",
  "prod",
  "qa",
  "sso",
  "stage",
  "staging",
  "static",
  "support",
  "test",
  "uat",
  "web",
  "www"
]);

const COMMON_REGION_TOKENS = new Set([
  "ap",
  "apac",
  "asia",
  "au",
  "br",
  "ca",
  "de",
  "eu",
  "fr",
  "in",
  "jp",
  "latam",
  "na",
  "uk",
  "us",
  "us-east",
  "us-west"
]);

function params(store, targetName) {
  const rows = queryRows(store, `
    SELECT params_json FROM recon_urls
    WHERE (? IS NULL OR target_name = ?)
  `, targetName);
  return rows.flatMap((row) => JSON.parse(row.params_json || "[]"));
}

function paths(store, targetName) {
  const rows = queryRows(store, `
    SELECT path FROM recon_urls
    WHERE (? IS NULL OR target_name = ?)
  `, targetName);
  return rows.flatMap((row) => pathSegments(row.path));
}

function technologies(store, targetName) {
  const rows = queryRows(store, `
    SELECT technologies_json FROM recon_http_services
    WHERE (? IS NULL OR target_name = ?)
  `, targetName);
  return rows.flatMap((row) => JSON.parse(row.technologies_json || "[]"));
}

function queryRows(store, sql, targetName) {
  return store.db.prepare(sql).all(targetName || null, targetName || null);
}

function pathSegments(value) {
  return String(value || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !segment.includes("."));
}

function cleanEntry(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text.length > 120) return null;
  if (/[\s<>:"'`\\|]/.test(text)) return null;
  return text;
}

function validDnsLabel(value) {
  const text = cleanEntry(value);
  return Boolean(text && text.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(text));
}

function safeFileName(value) {
  return String(value || "wordlist")
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "wordlist";
}

module.exports = {
  GENERATED_DIR,
  generateWordlistFromDb
};
