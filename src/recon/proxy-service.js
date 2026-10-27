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
    return this.store.recordProxyTest(proxyId, { success: Boolean(metrics.success), latencyMs: metrics.latency });
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
