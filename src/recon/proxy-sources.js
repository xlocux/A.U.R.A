"use strict";

class ProxySources {
  async fetchFromGitHub(rawUrl) {
    if (!rawUrl) throw new Error("GitHub raw URL is required");
    const url = normalizeGithubRawUrl(rawUrl);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Failed to fetch proxy list: HTTP ${response.status}`);
    return this.parseTxtFile(await response.text());
  }

  parseTxtFile(content) {
    return parseProxyText(content);
  }

  parseJsonFile(content) {
    const data = JSON.parse(content || "[]");
    const items = Array.isArray(data) ? data : Array.isArray(data.proxies) ? data.proxies : [];
    return items.map((item) => {
      if (typeof item === "string") return parseProxyString(item);
      if (item && typeof item === "object") return normalizeProxyObject(item);
      return null;
    }).filter(Boolean);
  }

  parseCsvFile(content) {
    const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return [];
    const first = lines[0].toLowerCase();
    const hasHeader = ["address", "host", "ip", "port"].some((token) => first.includes(token));
    return lines.slice(hasHeader ? 1 : 0).map((line) => {
      const values = splitCsvLine(line);
      return normalizeProxyObject({
        address: values[0],
        port: values[1],
        type: values[2] || "http",
        country: values[3] || null,
        username: values[4] || null,
        password: values[5] || null
      });
    }).filter(Boolean);
  }
}

function parseProxyText(content) {
  return String(content || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(parseProxyString)
    .filter(Boolean);
}

function parseProxyString(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
      const parsed = new URL(text);
      return normalizeProxyObject({
        address: parsed.hostname,
        port: parsed.port,
        type: parsed.protocol.replace(":", ""),
        username: parsed.username ? decodeURIComponent(parsed.username) : null,
        password: parsed.password ? decodeURIComponent(parsed.password) : null
      });
    }
  } catch {
    return null;
  }

  const authMatch = text.match(/^([^:@]+):([^:@]+)@(.+)$/);
  const clean = authMatch ? authMatch[3] : text;
  const parts = clean.split(":");
  return normalizeProxyObject({
    address: parts[0],
    port: parts[1],
    type: parts[2] || "http",
    username: authMatch ? authMatch[1] : null,
    password: authMatch ? authMatch[2] : null
  });
}

function normalizeProxyObject(input) {
  const address = String(input.address || input.host || input.ip || "").trim();
  const port = Number.parseInt(input.port, 10);
  const type = String(input.type || "http").toLowerCase();
  if (!address || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!["http", "https", "socks4", "socks5"].includes(type)) return null;
  return {
    address,
    port,
    type,
    country: input.country ? String(input.country).toUpperCase() : null,
    username: input.username || null,
    password: input.password || null,
    source: input.source || "manual",
    lastChecked: new Date().toISOString()
  };
}

function normalizeGithubRawUrl(value) {
  const text = String(value || "").trim();
  if (text.includes("raw.githubusercontent.com")) return text;
  const match = text.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  if (match) {
    const [, owner, repo, branch, filePath] = match;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }
  return text;
}

function splitCsvLine(line) {
  return String(line).split(",").map((value) => value.replace(/^["']|["']$/g, "").trim());
}

module.exports = ProxySources;
