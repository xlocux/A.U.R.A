"use strict";

const PROXIFLY_ALL_URL = "https://github.com/proxifly/free-proxy-list/blob/main/proxies/all/data.txt";
const RAW_GITHUB_HOST = "raw.githubusercontent.com";
const MAX_LIST_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15000;

class ProxySources {
  async fetchFromGitHub(rawUrl) {
    if (!rawUrl) throw new Error("GitHub raw URL is required");
    const url = normalizeGithubRawUrl(rawUrl);
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: "error" });
    if (!response.ok) throw new Error(`Failed to fetch proxy list: HTTP ${response.status}`);
    const text = await readLimitedText(response, MAX_LIST_BYTES);
    return this.parseTxtFile(text, { source: url.includes("/proxifly/free-proxy-list/") ? "proxifly" : "github" });
  }

  async fetchFromProxifly() {
    return this.fetchFromGitHub(PROXIFLY_ALL_URL);
  }

  parseTxtFile(content, metadata = {}) {
    return parseProxyText(content, metadata);
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
        type: values[2] || inferProxyTypeFromPort(values[1]),
        country: values[3] || null,
        username: values[4] || null,
        password: values[5] || null,
        source: "csv"
      });
    }).filter(Boolean);
  }
}

function parseProxyText(content, metadata = {}) {
  return String(content || "").split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => parseProxyString(line, metadata))
    .filter(Boolean);
}

function parseProxyString(value, metadata = {}) {
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
        password: parsed.password ? decodeURIComponent(parsed.password) : null,
        source: metadata.source || "text"
      });
    }
  } catch {
    return null;
  }

  const authMatch = text.match(/^([^:@]+):([^:@]+)@(.+)$/);
  const clean = authMatch ? authMatch[3] : text;
  const parsed = parseHostPortType(clean);
  if (!parsed) return null;
  return normalizeProxyObject({
    address: parsed.address,
    port: parsed.port,
    type: parsed.type || inferProxyTypeFromPort(parsed.port),
    username: authMatch ? authMatch[1] : null,
    password: authMatch ? authMatch[2] : null,
    source: metadata.source || "text"
  });
}

function parseHostPortType(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const bracketMatch = text.match(/^\[([^\]]+)]:(\d+)(?::([a-z0-9]+))?$/i);
  if (bracketMatch) return { address: bracketMatch[1], port: bracketMatch[2], type: normalizeProxyType(bracketMatch[3]) };
  const parts = text.split(":");
  if (parts.length < 2) return null;
  const maybeType = normalizeProxyType(parts.at(-1));
  const hasTypeSuffix = Boolean(maybeType) && parts.length >= 3;
  const port = hasTypeSuffix ? parts.at(-2) : parts.at(-1);
  const address = parts.slice(0, hasTypeSuffix ? -2 : -1).join(":");
  return { address, port, type: maybeType };
}

function normalizeProxyObject(input) {
  const address = String(input.address || input.host || input.ip || "").trim();
  const port = Number.parseInt(input.port, 10);
  const type = normalizeProxyType(input.type) || inferProxyTypeFromPort(port);
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

function inferProxyTypeFromPort(portValue) {
  const port = Number.parseInt(portValue, 10);
  if ([1080, 1081, 1085, 1088, 4145, 9050, 9150].includes(port)) return "socks5";
  if ([8080, 8000, 3128, 8888, 8118, 80].includes(port)) return "http";
  if ([443, 8443].includes(port)) return "https";
  return "http";
}

function normalizeProxyType(value) {
  const type = String(value || "").trim().toLowerCase();
  if (type === "socks") return "socks5";
  return ["http", "https", "socks4", "socks5"].includes(type) ? type : null;
}

// Only public GitHub raw files may be fetched; anything else (internal hosts, metadata endpoints,
// other schemes) is rejected before a request is made.
function normalizeGithubRawUrl(value) {
  const text = String(value || "").trim();
  const blob = text.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/);
  const candidate = blob ? `https://${RAW_GITHUB_HOST}/${blob[1]}/${blob[2]}/${blob[3]}/${blob[4]}` : text;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Proxy list URL must be a valid https://raw.githubusercontent.com URL");
  }
  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== RAW_GITHUB_HOST || parsed.username || parsed.password || parsed.port) {
    throw new Error("Proxy list URL must be a https://raw.githubusercontent.com (or github.com/.../blob/...) URL");
  }
  return parsed.toString();
}

async function readLimitedText(response, maxBytes, label = "Proxy list") {
  return (await readLimitedBuffer(response, maxBytes, label)).toString("utf8");
}

async function readLimitedBuffer(response, maxBytes, label = "Proxy list") {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error(`${label} is larger than ${maxBytes} bytes`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`${label} is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function splitCsvLine(line) {
  return String(line).split(",").map((value) => value.replace(/^["']|["']$/g, "").trim());
}

module.exports = ProxySources;
module.exports.PROXIFLY_ALL_URL = PROXIFLY_ALL_URL;
module.exports.readLimitedText = readLimitedText;
module.exports.readLimitedBuffer = readLimitedBuffer;
