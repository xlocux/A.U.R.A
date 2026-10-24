"use strict";

const ProxyDetection = require("./proxy-detection");
const ProxyPreflight = require("./proxy-preflight");
const ProxyService = require("./proxy-service");
const { redactProxyUrl, runLinuxTool } = require("./linux-tools");
const { buildProxyAwareInvocation } = require("./tool-proxy-policy");

const DEFAULT_MAX_CANDIDATES = 25;
const DEFAULT_MAX_RETRIES = 2;
const ROTATION_ERROR_PATTERNS = [
  /proxy\s*(connect|error|failed|refused|timeout)/i,
  /connection\s*(refused|reset|timed\s*out|timeout)/i,
  /econn(refused|reset|aborted)/i,
  /etimedout/i,
  /no\s*route\s*to\s*host/i,
  /network\s*is\s*unreachable/i,
  /socks\s*(error|failed|timeout|refused)/i,
  /tls\s*handshake\s*timeout/i,
  /context\s*deadline\s*exceeded/i
];

class ProxyRotationController {
  constructor({ store, runId, preferredProxyUrl = null, usePool = false, proxyService = null, maxRetries = DEFAULT_MAX_RETRIES, maxCandidates = DEFAULT_MAX_CANDIDATES, preflight = true, preflightTimeout = 3500, preflightConcurrency = 5 } = {}) {
    this.store = store;
    this.runId = runId;
    this.preferredProxyUrl = preferredProxyUrl;
    this.maxRetries = Math.max(0, Number.parseInt(maxRetries, 10) || 0);
    this.maxCandidates = Math.max(1, Number.parseInt(maxCandidates, 10) || DEFAULT_MAX_CANDIDATES);
    this.preflight = preflight !== false;
    this.preflightTimeout = Math.max(1000, Number.parseInt(preflightTimeout, 10) || 3500);
    this.preflightConcurrency = Math.max(1, Number.parseInt(preflightConcurrency, 10) || 5);
    // The shared proxy pool is opt-in: by default only the operator's own proxy URL is used.
    this.usePool = Boolean(usePool);
    this.ownsProxyService = !proxyService;
    this.proxyService = proxyService || new ProxyService();
    this.proxyPreflight = new ProxyPreflight({ proxyService: this.proxyService });
    this.proxyDetection = new ProxyDetection();
    this.pool = [];
    this.cursor = 0;
  }

  static async create(options = {}) {
    const controller = new ProxyRotationController(options);
    await controller.initialize();
    return controller;
  }

  async initialize() {
    const candidates = await this.loadCandidates();
    if (candidates.length === 0) return this;
    let usable = candidates;
    if (this.preflight) {
      this.appendEvent({ phase: "proxy-preflight", severity: "ok", source: "proxy-preflight", message: `Testing ${candidates.length} proxy candidates before building the quality-ranked rotation pool.` });
      const results = await this.proxyPreflight.batchTest(candidates, { concurrency: this.preflightConcurrency, timeout: this.preflightTimeout, runId: `recon_${this.runId}_proxy_preflight` });
      usable = results
        .filter((result) => result.success)
        // result.proxy is redacted by preflight, so rebuild each pool entry from the original candidate.
        .map((result) => ({ ...candidates.find((item) => sameProxy(item, result.proxy)), status: "active", latency_ms: Number(result.latency || result.latencyMs || result.responseTime || Number.MAX_SAFE_INTEGER), success_rate: 1 }))
        .sort(compareProxyQuality);
      const failed = results.length - usable.length;
      if (usable.length > 0) {
        this.appendEvent({ phase: "proxy-preflight", severity: failed ? "warn" : "ok", source: "proxy-preflight", message: `Built quality-ranked proxy pool with ${usable.length} usable route(s), best=${redactProxy(usable[0])}, failed=${failed}.`, payload: { usable: usable.length, failed, best: redactProxy(usable[0]), poolSize: Math.min(usable.length, this.maxCandidates) } });
      } else {
        this.appendEvent({ phase: "proxy-preflight", severity: "warn", source: "proxy-preflight", message: `No usable proxies passed preflight (${failed} failed). Continuing without automatic proxy rotation.` });
      }
    } else {
      usable = usable.sort(compareProxyQuality);
    }
    const preferred = candidates.find((item) => item.preferred);
    if (preferred && !usable.some((item) => sameProxy(item, preferred))) {
      // Fail closed: never silently fall back to a direct connection when the operator asked for a proxy.
      this.appendEvent({ phase: "proxy-preflight", severity: "warn", source: "proxy-preflight", message: `Configured proxy ${redactProxy(preferred)} failed preflight; it stays first in the pool so tools fail instead of bypassing it.` });
      usable = [preferred, ...usable];
    }
    this.pool = usable.slice(0, this.maxCandidates);
    return this;
  }

  async loadCandidates() {
    const byKey = new Map();
    if (this.preferredProxyUrl) {
      try {
        const preferred = parseProxyUrl(this.preferredProxyUrl, { status: "active", preferred: true });
        if (preferred) byKey.set(proxyKey(preferred), preferred);
      } catch (error) {
        this.appendEvent({ phase: "proxy-preflight", severity: "warn", source: "proxy-preflight", message: `Configured proxy ignored: ${error.message}` });
      }
    }
    const records = this.usePool ? await this.proxyService.store.getProxies({ status: "all" }) : [];
    for (const record of records.sort(compareProxyQuality)) {
      if (["inactive", "failed"].includes(record.status)) continue;
      const normalized = normalizeProxyRecord(record);
      if (normalized) byKey.set(proxyKey(normalized), normalized);
    }
    return [...byKey.values()].sort(compareProxyQuality).slice(0, this.maxCandidates);
  }

  hasPool() { return this.pool.length > 0; }
  bestProxyUrl() { return this.hasPool() ? this.proxyService.formatProxyUrl(this.pool[0]) : null; }

  async runTool({ runtime, toolName, args, timeoutMs, input = null }) {
    if (!this.hasPool()) return runLinuxTool({ runtime, toolName, args, timeoutMs, input });
    let lastResult = null;
    let previousProxy = null;
    const attempts = Math.min(this.pool.length, this.maxRetries + 1);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const selection = this.nextProxy({ skipCurrent: attempt > 0 });
      const invocation = buildProxyAwareInvocation({ toolName, args, proxyUrl: selection.proxyUrl });
      const started = Date.now();

      if (invocation.bypassed) {
        this.appendEvent({
          phase: "proxy-rotation",
          severity: "info",
          source: "ai-proxy-policy",
          message: `Running ${toolName} without proxy rotation: ${invocation.reason}`,
          payload: { toolName, proxyPolicy: invocation.mode, reason: invocation.reason }
        });
        const result = await runLinuxTool({ runtime, toolName, args: invocation.args, timeoutMs, input });
        result.proxyRotation = { enabled: false, bypassed: true, mode: invocation.mode, reason: invocation.reason, poolSize: selection.size };
        return result;
      }

      this.appendEvent({
        phase: "proxy-rotation",
        severity: attempt === 0 ? "ok" : "warn",
        source: "ai-proxy-policy",
        message: attempt === 0
          ? `Using best-ranked proxy ${redactProxyUrl(selection.proxyUrl)} for ${toolName} (${invocation.mode} proxy mode, pool ${selection.index + 1}/${selection.size}).`
          : `Rotated ${toolName} from ${previousProxy ? redactProxy(previousProxy) : "previous proxy"} to ${redactProxyUrl(selection.proxyUrl)} after a proxy/network failure.`
      });
      const result = await runLinuxTool({ runtime, toolName, args: invocation.args, timeoutMs, input, proxyUrl: invocation.envProxyUrl });
      result.proxyUrl = selection.proxyUrl;
      result.proxyRotation = { enabled: true, attempt: attempt + 1, maxAttempts: attempts, selectedProxy: redactProxy(selection.proxy), poolSize: selection.size, mode: invocation.mode };
      const decision = this.shouldRotate(result, { toolName });
      await this.recordAttempt(selection.proxy, result, decision, Date.now() - started);
      lastResult = result;
      if (!decision.rotate || attempt === attempts - 1) {
        if (decision.observeOnly) this.appendObservation(toolName, decision.reason);
        if (attempt > 0 && result.status === "completed" && !decision.rotate) {
          this.appendRecoveryEvent({ stage: "recovered", toolName, attempt: attempt + 1, maxAttempts: attempts, reason: decision.reason });
        } else if (decision.rotate && attempt === attempts - 1) {
          this.appendRecoveryEvent({ stage: "exhausted", toolName, attempt: attempt + 1, maxAttempts: attempts, reason: decision.reason });
        }
        return result;
      }
      previousProxy = selection.proxy;
      this.appendEvent({ phase: "proxy-rotation", severity: "warn", source: "ai-proxy-policy", message: `Detected proxy/network failure for ${toolName}: ${decision.reason}. Retrying with the next preflight-approved proxy from the quality-ranked pool.` });
      this.appendRecoveryEvent({ stage: "retrying", toolName, attempt: attempt + 1, maxAttempts: attempts, reason: decision.reason });
    }
    return lastResult;
  }

  nextProxy({ skipCurrent = false } = {}) {
    if (!this.hasPool()) return null;
    if (skipCurrent) this.cursor = (this.cursor + 1) % this.pool.length;
    const proxy = this.pool[this.cursor % this.pool.length];
    return { proxy, proxyUrl: this.proxyService.formatProxyUrl(proxy), index: this.cursor % this.pool.length, size: this.pool.length };
  }

  shouldRotate(result, { toolName } = {}) {
    const combined = [result.stderr, result.errorMessage, result.stdout].filter(Boolean).join("\n").slice(0, 20000);
    if (result.status === "timeout") return { rotate: true, reason: "tool timeout through current proxy" };
    if (result.status === "error") return { rotate: true, reason: "tool runner error through current proxy" };
    if (ROTATION_ERROR_PATTERNS.some((pattern) => pattern.test(combined))) return { rotate: true, reason: firstMatchingReason(combined) };
    const detection = this.proxyDetection.detectBlockage(inferHttpResponse(result, toolName), combined, { sensitivity: "medium", checkHeaders: false, checkContent: true, checkStatus: true });
    if (detection.isBlocked) return { rotate: false, observeOnly: true, reason: `${detection.message || detection.type}; pause, review authorization/scope, or reduce rate instead of rotating.` };
    return { rotate: false, reason: "no rotation signal" };
  }

  appendObservation(toolName, reason) {
    this.appendEvent({ phase: "proxy-rotation", severity: "warn", source: "ai-proxy-policy", message: `Observed possible application-side blocking for ${toolName}: ${reason}` });
  }

  appendRecoveryEvent({ stage, toolName, attempt, maxAttempts, reason }) {
    const messages = {
      retrying: `${toolName} hit a proxy/network failure. I am retrying it with another preflight-approved route (${attempt + 1}/${maxAttempts}).`,
      recovered: `${toolName} recovered after a retry (${attempt}/${maxAttempts}). I will keep the recovered output and continue.`,
      exhausted: `${toolName} still failed after ${attempt}/${maxAttempts} proxy-aware attempts. I will keep partial artifacts and continue with non-blocking work.`
    };
    this.appendEvent({
      phase: "ai-tool-recovery",
      severity: stage === "recovered" ? "ok" : "warn",
      source: "ai-tool-recovery",
      message: messages[stage] || `${toolName} recovery update: ${stage}`,
      payload: { stage, toolName, attempt, maxAttempts, reason, proxyAware: true }
    });
  }

  async recordAttempt(proxy, result, decision, latencyMs) {
    try {
      const proxyId = await this.proxyService.getOrCreateProxyId(proxy);
      const success = result.status === "completed" && !decision.rotate;
      await this.proxyService.store.recordProxyTest(proxyId, { success, latencyMs });
      await this.proxyService.store.recordTestRun(String(this.runId || "recon"), proxyId, result.toolName || "linux-tool", success, latencyMs, success ? null : decision.reason, null);
    } catch (error) {
      this.appendEvent({ phase: "proxy-rotation", severity: "warn", source: "proxy-store", message: `Could not store proxy rotation metrics: ${error.message}` });
    }
  }

  close() {
    if (this.ownsProxyService) this.proxyService.close();
  }

  appendEvent(event) {
    if (!this.store || !this.runId || typeof this.store.appendEvent !== "function") return;
    this.store.appendEvent(this.runId, event);
  }
}

function parseProxyUrl(value, metadata = {}) {
  const parsed = new URL(String(value || "").trim());
  const type = parsed.protocol.replace(":", "").toLowerCase();
  if (!["http", "https", "socks4", "socks5"].includes(type)) throw new Error("Proxy URL must use http, https, socks4, or socks5");
  const proxy = normalizeProxyRecord({ address: parsed.hostname, port: parsed.port || defaultPortFor(type), type, username: parsed.username ? decodeURIComponent(parsed.username) : null, password: parsed.password ? decodeURIComponent(parsed.password) : null, ...metadata });
  if (!proxy) throw new Error("Proxy URL must include a valid host and port");
  return proxy;
}

function defaultPortFor(type) {
  if (type === "http") return 8080;
  if (type === "https") return 8443;
  if (type === "socks4" || type === "socks5") return 1080;
  return null;
}

function normalizeProxyRecord(input) {
  const address = String(input.address || input.host || input.ip || "").trim();
  const port = Number.parseInt(input.port, 10);
  const type = String(input.type || "http").toLowerCase();
  if (!address || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  if (!["http", "https", "socks4", "socks5"].includes(type)) return null;
  return { address, port, type, country: input.country ? String(input.country).toUpperCase() : null, username: input.username || null, password: input.password || null, status: input.status || "unknown", latency_ms: Number(input.latency_ms || input.avg_response_time || input.latency || Number.MAX_SAFE_INTEGER), success_rate: Number(input.success_rate || 0), preferred: Boolean(input.preferred) };
}

function inferHttpResponse(result, toolName) {
  if (toolName !== "httpx") return {};
  const statusMatch = String(result.stdout || "").match(/"status_code"\s*:\s*(\d{3})/);
  return statusMatch ? { statusCode: Number(statusMatch[1]) } : {};
}

function firstMatchingReason(text) {
  const line = String(text || "").split(/\r?\n/).map((value) => value.trim()).find((value) => ROTATION_ERROR_PATTERNS.some((pattern) => pattern.test(value)));
  return line ? line.slice(0, 160) : "network/proxy failure signal";
}

function compareProxyQuality(left, right) {
  const leftPreferred = left.preferred ? 1 : 0;
  const rightPreferred = right.preferred ? 1 : 0;
  if (rightPreferred !== leftPreferred) return rightPreferred - leftPreferred;
  const leftSuccess = Number(left.success_rate || 0);
  const rightSuccess = Number(right.success_rate || 0);
  if (rightSuccess !== leftSuccess) return rightSuccess - leftSuccess;
  return Number(left.latency_ms || Number.MAX_SAFE_INTEGER) - Number(right.latency_ms || Number.MAX_SAFE_INTEGER);
}

function proxyKey(proxy) { return `${proxy.type}://${proxy.address}:${proxy.port}`; }
function sameProxy(left, right) { return left && right && left.address === right.address && Number(left.port) === Number(right.port) && left.type === right.type; }
function redactProxy(proxy) { return proxy ? `${proxy.type}://${proxy.username ? "****:****@" : ""}${proxy.address}:${proxy.port}` : null; }

module.exports = ProxyRotationController;
