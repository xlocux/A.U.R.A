"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ProxyStore = require("../src/db/proxy-store");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-proxy-store-test-"));
  return new ProxyStore(path.join(dir, "proxy.db"));
}

test("proxy store: findProxyByCoords returns proxy by address/port/type", async () => {
  const store = makeStore();
  try {
    const id = await store.addProxy("192.168.1.1", 3128, "http", { status: "active" });
    const found = await store.findProxyByCoords("192.168.1.1", 3128, "http");
    assert.ok(found);
    assert.equal(found.id, id);
    assert.equal(found.address, "192.168.1.1");
    assert.equal(found.port, 3128);
    assert.equal(found.type, "http");
  } finally {
    store.close();
  }
});

test("proxy store: findProxyByCoords returns undefined for non-existent proxy", async () => {
  const store = makeStore();
  try {
    const found = await store.findProxyByCoords("10.0.0.1", 9999, "socks5");
    assert.equal(found, undefined);
  } finally {
    store.close();
  }
});

test("proxy store: findProxyByCoords distinguishes proxies by all three coordinates", async () => {
  const store = makeStore();
  try {
    const id1 = await store.addProxy("10.0.0.1", 8080, "http", { status: "active" });
    const id2 = await store.addProxy("10.0.0.1", 8080, "https", { status: "active" });
    const id3 = await store.addProxy("10.0.0.1", 9090, "http", { status: "active" });

    const found1 = await store.findProxyByCoords("10.0.0.1", 8080, "http");
    const found2 = await store.findProxyByCoords("10.0.0.1", 8080, "https");
    const found3 = await store.findProxyByCoords("10.0.0.1", 9090, "http");
    const notFound = await store.findProxyByCoords("10.0.0.1", 8080, "socks5");

    assert.equal(found1.id, id1);
    assert.equal(found2.id, id2);
    assert.equal(found3.id, id3);
    assert.equal(notFound, undefined);
  } finally {
    store.close();
  }
});

test("proxy store: addProxy and getActiveProxies", async () => {
  const store = makeStore();
  try {
    const id1 = await store.addProxy("10.0.0.1", 8080, "http", { status: "active" });
    const id2 = await store.addProxy("10.0.0.2", 9090, "http", { status: "inactive" });
    const id3 = await store.addProxy("10.0.0.3", 8080, "http", { status: "active" });

    const active = await store.getActiveProxies();
    assert.equal(active.length, 2);
    assert.ok(active.some((p) => p.id === id1));
    assert.ok(active.some((p) => p.id === id3));
    assert.ok(!active.some((p) => p.id === id2));
  } finally {
    store.close();
  }
});

test("proxy store: updateProxyStatus records metrics", async () => {
  const store = makeStore();
  try {
    const id = await store.addProxy("10.0.0.1", 8080, "http", { status: "unknown" });
    await store.updateProxyStatus(id, "active", {
      latency_ms: 150,
      success_rate: 0.95,
      total_tests: 20,
      successful_tests: 19
    });

    const proxy = await store.getProxy(id);
    assert.equal(proxy.status, "active");

    const metrics = await store.getProxyMetrics(id);
    assert.equal(metrics.latency_ms, 150);
    assert.equal(metrics.success_rate, 0.95);
    assert.equal(metrics.total_tests, 20);
    assert.equal(metrics.successful_tests, 19);
  } finally {
    store.close();
  }
});

test("proxy store: deleteProxy removes proxy", async () => {
  const store = makeStore();
  try {
    const id = await store.addProxy("10.0.0.1", 8080, "http", { status: "active" });
    const deleted = await store.deleteProxy(id);
    assert.equal(deleted, true);

    const found = await store.getProxy(id);
    assert.equal(found, undefined);
  } finally {
    store.close();
  }
});

test("proxy store: getProxies with filters", async () => {
  const store = makeStore();
  try {
    await store.addProxy("10.0.0.1", 8080, "http", { status: "active", country: "US" });
    await store.addProxy("10.0.0.2", 9090, "socks5", { status: "active", country: "GB" });
    await store.addProxy("10.0.0.3", 8080, "http", { status: "inactive", country: "US" });

    const httpProxies = await store.getProxies({ type: "http" });
    assert.equal(httpProxies.length, 2);
    assert.ok(httpProxies.every((p) => p.type === "http"));

    const usProxies = await store.getProxies({ country: "us" });
    assert.equal(usProxies.length, 2);

    const activeProxies = await store.getProxies({ status: "active" });
    assert.equal(activeProxies.length, 2);
  } finally {
    store.close();
  }
});
