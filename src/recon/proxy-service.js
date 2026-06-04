"use strict";

const ProxyStore = require("../db/proxy-store");

class ProxyService {
  constructor({ store = new ProxyStore() } = {}) {
    this.store = store;
  }

  async getNextProxy(lastFailedProxy = null, context = {}) {
    const { avoidFailed = true, strategy = "performance" } = context;
    let proxies = await this.store.getActiveProxies();
    if (avoidFailed && lastFailedProxy) {
      proxies = proxies.filter((proxy) => (
        proxy.address !== lastFailedProxy.address ||
        proxy.port !== lastFailedProxy.port ||
        proxy.type !== lastFailedProxy.type
      ));
    }
    if (proxies.length === 0) return null;
    if (strategy === "random") return proxies[Math.floor(Math.random() * proxies.length)];
    return proxies[0];
  }

  async getOrCreateProxyId(proxy) {
    const existing = await this.findProxy(proxy);
    if (existing) return existing.id;
    return this.store.addProxy(proxy.address, proxy.port, proxy.type, {
      country: proxy.country,
      username: proxy.username,
      password: proxy.password,
      status: proxy.status || "unknown"
    });
  }

  async findProxy(proxy) {
    return this.store.findProxyByCoords(proxy.address, proxy.port, proxy.type);
  }

  async storeProxyMetrics(proxyId, metrics) {
    await this.store.updateProxyStatus(
      proxyId,
      metrics.success ? "active" : "failed",
      {
        latency_ms: metrics.latency,
        success_rate: metrics.success ? 1 : 0,
        failures_count: metrics.success ? 0 : 1,
        total_tests: 1,
        successful_tests: metrics.success ? 1 : 0,
        avg_response_time: metrics.latency
      }
    );
  }

  getProxyEnvVars(proxy) {
    if (!proxy) return {};
    const proxyUrl = this.formatProxyUrl(proxy);
    return {
      HTTP_PROXY: proxyUrl,
      HTTPS_PROXY: proxyUrl,
      ALL_PROXY: proxyUrl,
      http_proxy: proxyUrl,
      https_proxy: proxyUrl,
      all_proxy: proxyUrl
    };
  }

  formatProxyUrl(proxy) {
    const auth = proxy.username && proxy.password
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
      : "";
    return `${proxy.type}://${auth}${proxy.address}:${proxy.port}`;
  }

  close() {
    this.store.close();
  }
}

module.exports = ProxyService;
