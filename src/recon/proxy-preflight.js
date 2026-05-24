"use strict";

const net = require("node:net");
const ProxyService = require("./proxy-service");

class ProxyPreflight {
  constructor({ proxyService = new ProxyService() } = {}) {
    this.proxyService = proxyService;
  }

  async testProxy(proxy, options = {}) {
    const timeout = Number.isInteger(options.timeout) ? options.timeout : 5000;
    const runId = options.runId || `proxy_preflight_${Date.now()}`;
    const startedAt = Date.now();
    const result = {
      proxyId: null,
      proxy: redactProxy(proxy),
      success: false,
      latency: null,
      reachability: {},
      errors: [],
      warnings: [],
      timestamp: new Date().toISOString(),
      runId
    };

    try {
      const tcpResult = await testTcp(proxy.address, proxy.port, timeout);
      result.success = tcpResult.success;
      result.latency = tcpResult.latency;
      result.reachability.tcp = tcpResult;
      if (!tcpResult.success) result.errors.push(tcpResult.error || "TCP connection failed");
    } catch (error) {
      result.errors.push(error.message);
    }

    result.latency = result.latency ?? Date.now() - startedAt;

    try {
      result.proxyId = await this.proxyService.getOrCreateProxyId(proxy);
      await this.proxyService.storeProxyMetrics(result.proxyId, result);
      await this.proxyService.store.recordTestRun(
        runId,
        result.proxyId,
        `${proxy.type}://${proxy.address}:${proxy.port}`,
        result.success,
        result.latency,
        result.errors.length ? result.errors.join("; ") : null,
        null
      );
    } catch (error) {
      result.warnings.push(`Database storage warning: ${error.message}`);
    }

    return result;
  }

  async batchTest(proxies, options = {}) {
    const concurrency = Math.max(1, Number.parseInt(options.concurrency || 5, 10));
    const runId = options.runId || `proxy_batch_${Date.now()}`;
    const results = [];
    let index = 0;

    const worker = async () => {
      while (index < proxies.length) {
        const proxy = proxies[index++];
        results.push(await this.testProxy(proxy, { ...options, runId }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, proxies.length) }, worker));
    return results.sort((left, right) => {
      if (left.success !== right.success) return Number(right.success) - Number(left.success);
      return (left.latency || Number.MAX_SAFE_INTEGER) - (right.latency || Number.MAX_SAFE_INTEGER);
    });
  }
}

function testTcp(host, port, timeout) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ latency: Date.now() - startedAt, ...payload });
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => finish({ success: true }));
    socket.once("timeout", () => finish({ success: false, error: "Connection timed out" }));
    socket.once("error", (error) => finish({ success: false, error: error.message, code: error.code }));
    socket.connect(port, host);
  });
}

function redactProxy(proxy) {
  return {
    address: proxy.address,
    port: proxy.port,
    type: proxy.type,
    country: proxy.country || null,
    username: proxy.username || null,
    password: proxy.password ? "****" : null
  };
}

module.exports = ProxyPreflight;
