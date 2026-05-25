"use strict";

const crypto = require("node:crypto");

async function extractFaviconsFromServices({ services, fetchImpl = fetch, limit = 100, timeoutMs = 12000 } = {}) {
  const findings = [];
  for (const service of (services || []).filter((item) => item?.url).slice(0, limit)) {
    const candidates = await faviconCandidates(service.url, { fetchImpl, timeoutMs });
    for (const iconUrl of candidates) {
      try {
        const icon = await fetchBytes(iconUrl, { fetchImpl, timeoutMs });
        if (!icon.bytes.length) continue;
        findings.push({
          url: service.url,
          host: service.host,
          faviconUrl: iconUrl,
          sha256: crypto.createHash("sha256").update(icon.bytes).digest("hex"),
          byteLength: icon.bytes.length,
          contentType: icon.contentType
        });
        break;
      } catch {
        // Try the next discovered/default favicon candidate.
      }
    }
  }
  return dedupeFindings(findings);
}

async function faviconCandidates(pageUrl, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const candidates = [];
  try {
    const html = await fetchText(pageUrl, { fetchImpl, timeoutMs });
    for (const href of extractIconHrefs(html)) {
      candidates.push(new URL(href, pageUrl).toString());
    }
  } catch {
    // Fallback to the conventional favicon path below.
  }
  try {
    candidates.push(new URL("/favicon.ico", pageUrl).toString());
  } catch {
    // Invalid service URL; return whatever was already parsed.
  }
  return [...new Set(candidates)];
}

function extractIconHrefs(html) {
  const hrefs = [];
  const linkPattern = /<link\b[^>]*>/gi;
  const relPattern = /\brel=["']([^"']+)["']/i;
  const hrefPattern = /\bhref=["']([^"']+)["']/i;
  let match;
  while ((match = linkPattern.exec(String(html || ""))) !== null) {
    const rel = relPattern.exec(match[0])?.[1] || "";
    if (!/\b(?:icon|shortcut icon|apple-touch-icon)\b/i.test(rel)) continue;
    const href = hrefPattern.exec(match[0])?.[1];
    if (href) hrefs.push(href);
  }
  return hrefs;
}

async function fetchText(url, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const response = await fetchWithTimeout(url, { fetchImpl, timeoutMs });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function fetchBytes(url, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const response = await fetchWithTimeout(url, { fetchImpl, timeoutMs });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { bytes: buffer, contentType: response.headers.get("content-type") || "" };
}

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AURA-Recon/0.1)" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function dedupeFindings(findings) {
  const seen = new Set();
  return (findings || []).filter((finding) => {
    const key = `${finding.host || ""}|${finding.faviconUrl}|${finding.sha256}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  extractFaviconsFromServices,
  extractIconHrefs
};
