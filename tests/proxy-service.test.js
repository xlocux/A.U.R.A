"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ProxyStore = require("../src/db/proxy-store");
const ProxyService = require("../src/recon/proxy-service");

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-proxy-service-test-"));
  return new ProxyStore(path.join(dir, "proxy.db"));
}

test("proxy service: findProxy uses ProxyStore.findProxyByCoords interface", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  try {
    const id = await store.addProxy("192.168.1.100", 3128, "http", { status: "active", country: "US" });
    const found = await service.findProxy({ address: "192.168.1.100", port: 3128, type: "http" });

    assert.ok(found);
    assert.equal(found.id, id);
    assert.equal(found.address, "192.168.1.100");
    assert.equal(found.port, 3128);
    assert.equal(found.type, "http");
    assert.equal(found.country, "US");
  } finally {
    service.close();
  }
});

test("proxy service: findProxy returns undefined for non-existent proxy", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  try {
    const found = await service.findProxy({ address: "10.0.0.1", port: 9999, type: "socks5" });
    assert.equal(found, undefined);
  } finally {
    service.close();
  }
});

test("proxy service: getOrCreateProxyId returns existing id", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  try {
    const existingId = await store.addProxy("10.0.0.1", 8080, "http", { status: "active" });
    const proxy = { address: "10.0.0.1", port: 8080, type: "http", status: "active" };

    const id = await service.getOrCreateProxyId(proxy);
    assert.equal(id, existingId);

    const count = await store.countProxies();
    assert.equal(count, 1);
  } finally {
    service.close();
  }
});

test("proxy service: getOrCreateProxyId creates new proxy if not found", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  try {
    const proxy = { address: "10.0.0.1", port: 8080, type: "http", status: "active" };
    const id = await service.getOrCreateProxyId(proxy);

    assert.ok(Number.isInteger(id));

    const found = await store.getProxy(id);
    assert.ok(found);
    assert.equal(found.address, "10.0.0.1");
    assert.equal(found.port, 8080);
    assert.equal(found.type, "http");
  } finally {
    service.close();
  }
});

test("proxy service: getNextProxy returns active proxy", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  try {
    await store.addProxy("10.0.0.1", 8080, "http", { status: "active" });
    await store.addProxy("10.0.0.2", 9090, "http", { status: "inactive" });

    const next = await service.getNextProxy();
    assert.ok(next);
    assert.equal(next.status, "active");
  } finally {
    service.close();
  }
});

test("proxy service: getNextProxy avoids failed proxy", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  try {
    await store.addProxy("10.0.0.1", 8080, "http", { status: "active" });
    await store.addProxy("10.0.0.2", 9090, "http", { status: "active" });

    const failedProxy = { address: "10.0.0.1", port: 8080, type: "http" };
    const next = await service.getNextProxy(failedProxy, { avoidFailed: true });

    assert.ok(next);
    assert.notEqual(next.address, "10.0.0.1");
    assert.equal(next.address, "10.0.0.2");
  } finally {
    service.close();
  }
});
