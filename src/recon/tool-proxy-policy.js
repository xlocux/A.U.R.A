"use strict";

const DIRECT_DNS_TOOLS = new Set([
  "dnsx",
  "puredns",
  "shuffle-dns"
]);

const NATIVE_PROXY_TOOLS = new Map([
  ["httpx", {
    flag: "-proxy",
    reason: "httpx has a native proxy flag; using it avoids ambiguous environment-only routing."
  }]
]);

const ENV_PROXY_REASON = "Tool does not have a dedicated A.U.R.A proxy adapter; standard proxy environment variables will be exported.";
const DIRECT_DNS_REASON = "DNS resolver tools do not reliably honor HTTP/SOCKS proxy environment variables and can stall when forced through generic proxies.";

function getToolProxyPolicy(toolName) {
  const name = normalizeToolName(toolName);
  if (DIRECT_DNS_TOOLS.has(name)) {
    return {
      toolName: name,
      mode: "direct",
      proxied: false,
      reason: DIRECT_DNS_REASON
    };
  }

  const native = NATIVE_PROXY_TOOLS.get(name);
  if (native) {
    return {
      toolName: name,
      mode: "native",
      proxied: true,
      flag: native.flag,
      reason: native.reason
    };
  }

  return {
    toolName: name,
    mode: "env",
    proxied: true,
    reason: ENV_PROXY_REASON
  };
}

function buildProxyAwareInvocation({ toolName, args = [], proxyUrl = null } = {}) {
  const normalizedArgs = Array.isArray(args) ? [...args] : [];
  const policy = getToolProxyPolicy(toolName);
  if (!proxyUrl) {
    return {
      args: normalizedArgs,
      envProxyUrl: null,
      proxyUrl: null,
      policy,
      proxied: false,
      bypassed: false,
      mode: "none",
      reason: "No proxy route was configured."
    };
  }

  if (policy.mode === "direct") {
    return {
      args: normalizedArgs,
      envProxyUrl: null,
      proxyUrl,
      policy,
      proxied: false,
      bypassed: true,
      mode: "direct",
      reason: policy.reason
    };
  }

  if (policy.mode === "native") {
    return {
      args: argsWithNativeProxy(normalizedArgs, policy.flag, proxyUrl),
      envProxyUrl: null,
      proxyUrl,
      policy,
      proxied: true,
      bypassed: false,
      mode: "native",
      reason: policy.reason
    };
  }

  return {
    args: normalizedArgs,
    envProxyUrl: proxyUrl,
    proxyUrl,
    policy,
    proxied: true,
    bypassed: false,
    mode: "env",
    reason: policy.reason
  };
}

function toolUsesProxyRoute(toolName) {
  return getToolProxyPolicy(toolName).proxied;
}

function argsWithNativeProxy(args, flag, proxyUrl) {
  if (hasProxyFlag(args)) return args;
  return [...args, flag, proxyUrl];
}

function hasProxyFlag(args) {
  const proxyFlags = new Set(["-proxy", "--proxy", "-http-proxy", "--http-proxy"]);
  return args.some((arg) => proxyFlags.has(String(arg)));
}

function normalizeToolName(toolName) {
  return String(toolName || "").trim().toLowerCase();
}

module.exports = {
  DIRECT_DNS_REASON,
  ENV_PROXY_REASON,
  buildProxyAwareInvocation,
  getToolProxyPolicy,
  toolUsesProxyRoute
};
