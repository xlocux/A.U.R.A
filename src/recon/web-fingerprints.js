"use strict";

const crypto = require("node:crypto");

const DEFAULT_FAVICON_PATHS = [
  "/favicon.ico",
  "/favicon.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/assets/favicon.ico",
  "/static/favicon.ico"
];

async function extractFaviconsFromServices({ services, fetchImpl = fetch, limit = 100, timeoutMs = 12000 } = {}) {
  const findings = [];
  for (const service of (services || []).filter((item) => item?.url).slice(0, limit)) {
    const candidates = await faviconCandidates(service.url, { fetchImpl, timeoutMs });
    for (const iconUrl of candidates) {
      try {
        const icon = await fetchBytes(iconUrl, { fetchImpl, timeoutMs });
        if (!icon.bytes.length || !looksLikeIcon(icon)) continue;
        findings.push({
          url: service.url,
          host: service.host || hostFromUrl(service.url),
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
  let finalPageUrl = pageUrl;
  try {
    const htmlResponse = await fetchText(pageUrl, { fetchImpl, timeoutMs });
    finalPageUrl = htmlResponse.url || pageUrl;
    for (const href of extractIconHrefs(htmlResponse.text)) {
      candidates.push(new URL(href, finalPageUrl).toString());
    }
  } catch {
    // Fallback to conventional favicon paths below.
  }
  for (const iconPath of DEFAULT_FAVICON_PATHS) {
    try {
      candidates.push(new URL(iconPath, finalPageUrl || pageUrl).toString());
    } catch {
      // Invalid service URL; return whatever was already parsed.
    }
  }
  return [...new Set(candidates)];
}

function extractIconHrefs(html) {
  const hrefs = [];
  const linkPattern = /<link\b[^>]*>/gi;
  const relPattern = /\brel\s*=\s*(["'])(.*?)\1/i;
  const hrefPattern = /\bhref\s*=\s*(["'])(.*?)\1/i;
  let match;
  while ((match = linkPattern.exec(String(html || ""))) !== null) {
    const tag = match[0];
    const rel = relPattern.exec(tag)?.[2] || "";
    if (!rel.split(/\s+/).some((part) => /^(icon|shortcut|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)$/i.test(part))) continue;
    const href = hrefPattern.exec(tag)?.[2];
    if (href) hrefs.push(href);
  }
  return hrefs;
}

async function fetchText(url, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const response = await fetchWithTimeout(url, { fetchImpl, timeoutMs, accept: "text/html,application/xhtml+xml" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { text: await response.text(), url: response.url || url };
}

async function fetchBytes(url, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const response = await fetchWithTimeout(url, { fetchImpl, timeoutMs, accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { bytes: buffer, contentType: response.headers.get("content-type") || "", url: response.url || url };
}

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = 12000, accept = "*/*" } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      redirect: "follow",
      headers: {
        "Accept": accept,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 AURA-Recon/0.1"
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeIcon(icon) {
  const contentType = String(icon.contentType || "").toLowerCase();
  if (contentType.startsWith("image/") || contentType.includes("icon") || contentType.includes("octet-stream")) return true;
  const header = icon.bytes.subarray(0, 16).toString("hex");
  return header.startsWith("00000100") || header.startsWith("89504e47") || header.startsWith("ffd8ff") || header.startsWith("47494638") || icon.bytes.subarray(0, 5).toString("utf8").toLowerCase() === "<svg ";
}

function hostFromUrl(value) {
  try {
    return new URL(value).host;
  } catch {
    return null;
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
