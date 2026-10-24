"use strict";

const DEFAULT_PASSIVE_SOURCES = ["crtsh", "wayback"];
const DEFAULT_LINUX_TOOLS = ["subfinder", "dnsx", "gau", "httpx"];
const DEFAULT_SCREENSHOT_TOOLS = ["gowitness"];
const SUPPORTED_SCREENSHOT_TOOLS = new Set(["gowitness", "eyewitness"]);
const DEPRECATED_SCREENSHOT_TOOLS = new Set(["aquatone"]);

const HTTPX_PORT_PRESETS = {
  small: [80, 443, 8080, 8443],
  medium: [80, 443, 8009, 8080, 8081, 8090, 8180, 8443, 27000, 27001, 5000, 5001, 9001, 81, 9443, 25, 23],
  large: [21, 22, 23, 25, 53, 80, 81, 110, 143, 443, 465, 587, 993, 995, 3000, 3001, 4000, 5000, 5001, 5601, 7000, 7001, 8000, 8001, 8008, 8009, 8080, 8081, 8082, 8088, 8090, 8180, 8443, 8888, 9000, 9001, 9090, 9200, 9443, 10000, 27000, 27001]
};
const DEFAULT_HTTPX_PORTS = HTTPX_PORT_PRESETS.medium;

const API_PASSIVE_PROVIDERS = [
  "rapid7", "censys", "hunterio", "binaryedge", "certspotter", "passivetotal", "securitytrails",
  "shodan", "urlscan", "virustotal", "zoomeye", "spyse", "intelx", "whoisxmlapi", "whoisfreaks"
];

const DEFAULT_TOOL_RECOVERY_ATTEMPTS = 2;
const TOOL_RECOVERY_PATTERNS = [
  /timed?\s*out|timeout/i,
  /econn(refused|reset|aborted)/i,
  /etimedout/i,
  /connection\s*(refused|reset|closed|aborted)/i,
  /network\s*(is\s*)?unreachable/i,
  /tls\s*handshake/i,
  /context\s*deadline\s*exceeded/i,
  /temporary\s*failure/i
];

// Statuses meaning "the tool ran"; completed_no_output comes from adaptive httpx batching.
const TOOL_RAN_STATUSES = new Set(["completed", "completed_no_output"]);

module.exports = {
  API_PASSIVE_PROVIDERS,
  DEFAULT_HTTPX_PORTS,
  DEFAULT_LINUX_TOOLS,
  DEFAULT_PASSIVE_SOURCES,
  DEFAULT_SCREENSHOT_TOOLS,
  DEFAULT_TOOL_RECOVERY_ATTEMPTS,
  DEPRECATED_SCREENSHOT_TOOLS,
  HTTPX_PORT_PRESETS,
  SUPPORTED_SCREENSHOT_TOOLS,
  TOOL_RAN_STATUSES,
  TOOL_RECOVERY_PATTERNS
};
