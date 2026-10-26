"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { normalizeDomain } = require("../domain-utils");
const { DEFAULT_HTTPX_PORTS, HTTPX_PORT_PRESETS, NMAP_PORT_PRESETS, DEFAULT_NMAP_PRESET } = require("./constants");

// Tools run through `sh` on the same host, so a forward-slash absolute path works for both
// Linux and Git Bash on Windows (C:/...).
function toToolPath(localPath) {
  const value = String(localPath);
  if (value.startsWith("/")) return value;
  return path.resolve(value).replaceAll("\\", "/");
}

function uniquePorts(ports) {
  return [...new Set((ports || []).map((port) => Number.parseInt(port, 10)).filter((port) => Number.isInteger(port) && port > 0 && port <= 65535))];
}

function parsePortList(value) {
  return uniquePorts(String(value || "").split(/[^0-9]+/).filter(Boolean));
}

function resolveHttpPorts({ preset = "medium", customPorts = "", ports = null } = {}) {
  if (Array.isArray(ports)) return uniquePorts(ports).length ? uniquePorts(ports) : DEFAULT_HTTPX_PORTS;
  const custom = parsePortList(customPorts);
  if (custom.length) return custom;
  return HTTPX_PORT_PRESETS[preset] || DEFAULT_HTTPX_PORTS;
}

function parseToolSpec(value) {
  if (typeof value === "object" && value) {
    const name = String(value.name || value.tool || "");
    // nmap has its own port model (preset / custom / full / top1000), kept separate from httpx ports.
    if (name === "nmap") {
      return { name, nmapPreset: value.nmapPreset, nmapPorts: value.nmapPorts, ports: Array.isArray(value.ports) ? value.ports : null };
    }
    return { name, ports: resolveHttpPorts(value) };
  }
  const [name, encoded] = String(value || "").split(":", 2);
  if (name === "nmap") return { name, nmapPorts: encoded || "" };
  return { name, ports: encoded ? resolveHttpPorts({ customPorts: encoded }) : DEFAULT_HTTPX_PORTS };
}

// Resolves nmap port arguments: explicit custom ports win, then a named preset, then the default.
// Returns the args fragment to splice into the nmap command (handles --top-ports and -p- for full).
function resolveNmapPorts(spec = {}) {
  const customList = parsePortList(spec.nmapPorts);
  if (customList.length) return ["-p", customList.join(",")];
  const preset = spec.nmapPreset && NMAP_PORT_PRESETS[spec.nmapPreset] !== undefined ? spec.nmapPreset : DEFAULT_NMAP_PRESET;
  const value = NMAP_PORT_PRESETS[preset];
  if (value === "top1000") return ["--top-ports", "1000"];
  if (value === "1-65535") return ["-p-"];
  if (Array.isArray(value) && value.length) return ["-p", uniquePorts(value).join(",")];
  if (Array.isArray(spec.ports) && spec.ports.length) return ["-p", uniquePorts(spec.ports).join(",")];
  return ["-p", uniquePorts(NMAP_PORT_PRESETS[DEFAULT_NMAP_PRESET]).join(",")];
}

function httpxArgsForInput(inputPath, ports = DEFAULT_HTTPX_PORTS) {
  return ["-l", toToolPath(inputPath), "-ports", uniquePorts(ports).join(","), "-json", "-silent", "-status-code", "-title", "-tech-detect", "-follow-host-redirects"];
}

function writeInputFile(artifactsDir, name, values) {
  const inputPath = path.join(artifactsDir, name);
  fs.writeFileSync(inputPath, [...values].sort().join("\n"), "utf8");
  return inputPath;
}

// Builds CLI args for a discovery tool; returns null when the tool cannot run with the given inputs.
function argsForTool(toolSpec, root, artifactsDir, discovered, subdomainWordlistPath = null) {
  const spec = typeof toolSpec === "string" ? parseToolSpec(toolSpec) : toolSpec;
  switch (spec.name) {
    case "subfinder":
      return ["-d", root, "-silent", "-all"];
    case "amass":
      return ["enum", "-passive", "-d", root];
    case "dnsx":
      return ["-l", toToolPath(writeInputFile(artifactsDir, `dnsx-${root}.input.txt`, discovered)), "-silent", "-a", "-aaaa", "-cname"];
    case "puredns":
      return ["resolve", toToolPath(writeInputFile(artifactsDir, `puredns-${root}.input.txt`, discovered)), "--write", "-"];
    case "shuffle-dns":
      return subdomainWordlistPath ? ["-d", root, "-w", toToolPath(subdomainWordlistPath), "-silent"] : null;
    case "gau":
      return [root];
    case "httpx":
      return httpxArgsForInput(writeInputFile(artifactsDir, `httpx-${root}.input.txt`, discovered), spec.ports);
    case "nmap": {
      const inputPath = writeInputFile(artifactsDir, `nmap-${root}.input.txt`, discovered);
      return ["-iL", toToolPath(inputPath), ...resolveNmapPorts(spec), "-sV", "--open", "-T3", "-oA", toToolPath(path.join(artifactsDir, `nmap-${root}`))];
    }
    default:
      return null;
  }
}

function screenshotArgsForTool(toolName, inputPath, outputDir) {
  if (toolName === "gowitness") return ["scan", "file", "-f", toToolPath(inputPath), "--screenshot-path", toToolPath(outputDir), "--write-jsonl"];
  if (toolName === "eyewitness") return ["--web", "-f", toToolPath(inputPath), "-d", toToolPath(outputDir), "--no-prompt"];
  return null;
}

// Approximates registrable roots from hostnames (last two labels; good enough for grouping follow-ups).
function inferRoots(domains) {
  const roots = new Set();
  for (const value of domains || []) {
    const domain = normalizeDomain(value?.domain || value?.host || value);
    if (!domain) continue;
    const parts = domain.split(".");
    roots.add(parts.length > 2 ? parts.slice(-2).join(".") : domain);
  }
  return [...roots].sort();
}

function normalizeHosts(values) {
  return [...new Set((values || []).map((item) => normalizeDomain(item?.domain || item?.host || item)).filter(Boolean))].sort();
}

module.exports = {
  argsForTool,
  httpxArgsForInput,
  inferRoots,
  normalizeHosts,
  parsePortList,
  parseToolSpec,
  resolveHttpPorts,
  resolveNmapPorts,
  screenshotArgsForTool,
  toToolPath,
  uniquePorts,
  writeInputFile
};
