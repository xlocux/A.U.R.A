"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { Writable } = require("node:stream");

process.env.AURA_PROXY_DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aura-proxy-route-")), "proxy.db");

const ProxyDetection = require("../src/recon/proxy-detection");
const ProxyPreflight = require("../src/recon/proxy-preflight");
const ProxyService = require("../src/recon/proxy-service");
const ProxySources = require("../src/recon/proxy-sources");
const ProxyStore = require("../src/db/proxy-store");
const proxyRoutes = require("../src/web/proxy-routes");
const { retireArgsForPath } = require("../src/recon/technology-detectors");
const { commandDisplay } = require("../src/recon/linux-tools");
const { shouldRetryToolResult } = require("../src/recon/recon-engine");
const { buildProxyAwareInvocation, getToolProxyPolicy } = require("../src/recon/tool-proxy-policy");

test("proxy sources parse supported manual formats", () => {
  const sources = new ProxySources();
  const parsed = sources.parseTxtFile("http://127.0.0.1:8080\nuser:pass@proxy.local:1080:socks5\nproxy.example:4145");
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].address, "127.0.0.1");
  assert.equal(parsed[0].port, 8080);
  assert.equal(parsed[0].type, "http");
  assert.equal(typeof parsed[0].lastChecked, "string");
  assert.equal(parsed[1].address, "proxy.local");
  assert.equal(parsed[1].port, 1080);
  assert.equal(parsed[1].type, "socks5");
  assert.equal(parsed[1].username, "user");
  assert.equal(parsed[1].password, "pass");
  assert.equal(parsed[2].address, "proxy.example");
  assert.equal(parsed[2].type, "socks5");

  assert.equal(sources.parseJsonFile(JSON.stringify([{ address: "10.0.0.1", port: 3128, type: "http" }]))[0].address, "10.0.0.1");
  assert.equal(sources.parseCsvFile("address,port,type\n10.0.0.2,1080,socks5")[0].type, "socks5");
});

test("proxy store persists proxies and metrics", async () => {
  const store = makeStore();
  try {
    const id = await store.addProxy("127.0.0.1", 8080, "http", { status: "active" });
    await store.updateProxyStatus(id, "active", { latency_ms: 12, success_rate: 1, total_tests: 1, successful_tests: 1 });
    const proxy = await store.getProxy(id);
    const metrics = await store.getProxyMetrics(id);
    assert.equal(proxy.address, "127.0.0.1");
    assert.equal(metrics.latency_ms, 12);
    assert.equal((await store.countProxies()), 1);
  } finally {
    store.close();
  }
});

test("proxy preflight checks proxy protocol reachability and records results", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  const preflight = new ProxyPreflight({ proxyService: service });
  const server = net.createServer((socket) => {
    socket.once("data", () => socket.end("HTTP/1.1 200 Connection Established\r\n\r\n"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await preflight.testProxy({ address: "127.0.0.1", port, type: "http" }, { timeout: 1000, testHost: "example.com" });
    assert.equal(result.success, true);
    assert.equal(result.reachability.protocol.protocol, "http-connect");
    assert.equal((await store.countProxies()), 1);
  } finally {
    server.close();
    store.close();
  }
});

test("proxy preflight rejects tcp-only listeners that are not valid proxies", async () => {
  const store = makeStore();
  const service = new ProxyService({ store });
  const preflight = new ProxyPreflight({ proxyService: service });
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await preflight.testProxy({ address: "127.0.0.1", port, type: "http" }, { timeout: 1000 });
    assert.equal(result.success, false);
    assert.equal(result.reachability.tcp.success, true);
    assert.equal(result.reachability.protocol.success, false);
  } finally {
    server.close();
    store.close();
  }
});


test("tool proxy policy keeps DNS resolver tools direct and routes httpx natively", () => {
  const dnsx = buildProxyAwareInvocation({ toolName: "dnsx", args: ["-l", "hosts.txt"], proxyUrl: "socks5://127.0.0.1:1080" });
  assert.equal(dnsx.bypassed, true);
  assert.equal(dnsx.envProxyUrl, null);
  assert.deepEqual(dnsx.args, ["-l", "hosts.txt"]);
  assert.equal(getToolProxyPolicy("dnsx").mode, "direct");

  const httpx = buildProxyAwareInvocation({ toolName: "httpx", args: ["-l", "hosts.txt"], proxyUrl: "socks5://127.0.0.1:1080" });
  assert.equal(httpx.mode, "native");
  assert.equal(httpx.envProxyUrl, null);
  assert.deepEqual(httpx.args, ["-l", "hosts.txt", "-proxy", "socks5://127.0.0.1:1080"]);
});

test("command display redacts proxy credentials", () => {
  assert.equal(
    commandDisplay("linux", "httpx", ["-proxy", "http://user:pass@127.0.0.1:8080", "-l", "hosts.txt"]),
    "httpx -proxy http://****:****@127.0.0.1:8080/ -l hosts.txt"
  );
});

test("proxy detection recommends conservative operator actions", () => {
  const detector = new ProxyDetection();
  const result = detector.detectBlockage({ statusCode: 429, headers: { "retry-after": "60" } }, "too many requests");
  assert.equal(result.isBlocked, true);
  assert.equal(result.type, "rate_limit");
  assert.equal(result.suggestedActions.some((action) => action.action === "reduce_rate"), true);
  assert.equal(result.suggestedActions.some((action) => action.action === "rotate_proxy"), false);
});

test("proxy routes are mounted in the custom api style", async () => {
  const response = createMockResponse();
  const handled = await proxyRoutes.handleApiRequest({
    request: { method: "GET" },
    response,
    url: new URL("http://localhost/api/proxies/health")
  });
  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).database, "connected");
});

test("retire path args avoid unsupported url and js flags", () => {
  const args = retireArgsForPath("/tmp/aura-retire");
  assert.deepEqual(args, ["--path", "/tmp/aura-retire", "--outputformat", "json", "--exitwith", "0"]);
  assert.equal(args.includes("--js"), false);
  assert.equal(args.includes("--url"), false);
});

test("tool recovery retries only transient runner failures", () => {
  assert.match(shouldRetryToolResult({ status: "timeout", errorMessage: "Timed out after 1000ms" }), /Timed out/);
  assert.match(shouldRetryToolResult({ status: "error", errorMessage: "spawn failed" }), /spawn failed/);
  assert.match(shouldRetryToolResult({ status: "failed", stderr: "connection reset by peer" }), /connection reset/);
  assert.equal(shouldRetryToolResult({ status: "failed", stderr: "unknown option --bad-flag" }), "");
  assert.equal(shouldRetryToolResult({ status: "completed", stderr: "" }), "");
});

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-proxy-test-"));
  return new ProxyStore(path.join(dir, "proxy.db"));
}

function createMockResponse() {
  const response = new Writable({
    write(chunk, encoding, callback) {
      response.body += chunk.toString();
      callback();
    }
  });
  response.body = "";
  response.statusCode = null;
  response.headers = null;
  response.writeHead = (statusCode, headers) => {
    response.statusCode = statusCode;
    response.headers = headers;
  };
  return response;
}
