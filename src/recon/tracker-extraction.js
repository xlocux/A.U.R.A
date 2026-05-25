"use strict";

const TRACKER_PATTERNS = [
  { vendor: "Google Analytics", pattern: /\bUA-\d{4,10}-\d+\b/g },
  { vendor: "Google Analytics 4", pattern: /\bG-[A-Z0-9]{6,12}\b/g },
  { vendor: "Google Tag Manager", pattern: /\bGTM-[A-Z0-9]{4,12}\b/g },
  { vendor: "Meta Pixel", pattern: /(?:fbq\([^)]*init[^0-9]*|facebook\.com\/tr\?id=)(\d{8,20})/gi },
  { vendor: "Hotjar", pattern: /(?:hjid\s*[:=]\s*|hotjar-(\d+)|h._hjSettings\s*=\s*\{[^}]*hjid\s*:\s*)(\d{5,12})/gi },
  { vendor: "Segment", pattern: /analytics\.load\(["']([A-Za-z0-9]{20,40})["']\)/g },
  { vendor: "Plausible", pattern: /plausible\.io\/js\/script(?:\.[^"']*)?\.js/gi }
];

async function extractTrackersFromServices({ services, fetchText = fetch, limit = 100, timeoutMs = 12000 } = {}) {
  const findings = [];
  for (const service of (services || []).filter((item) => item?.url).slice(0, limit)) {
    let html = "";
    try {
      html = await fetchPage(service.url, { fetchText, timeoutMs });
    } catch (error) {
      findings.push({ url: service.url, host: service.host, vendor: "tracker-fetch", id: "failed", error: error.message });
      continue;
    }
    findings.push(...extractTrackersFromText(html).map((finding) => ({
      ...finding,
      url: service.url,
      host: service.host
    })));
  }
  return dedupeFindings(findings);
}

function extractTrackersFromText(text) {
  const findings = [];
  const body = String(text || "");
  for (const { vendor, pattern } of TRACKER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(body)) !== null) {
      const id = match.slice(1).find(Boolean) || match[0];
      findings.push({ vendor, id: String(id).slice(0, 120) });
    }
  }
  return dedupeFindings(findings);
}

async function fetchPage(url, { fetchText = fetch, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchText(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AURA-Recon/0.1)" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function dedupeFindings(findings) {
  const seen = new Set();
  return (findings || []).filter((finding) => {
    const key = `${finding.url || ""}|${finding.host || ""}|${finding.vendor}|${finding.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = {
  extractTrackersFromServices,
  extractTrackersFromText
};
