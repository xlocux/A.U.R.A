"use strict";

const net = require("node:net");
const tls = require("node:tls");
const ProxyService = require("./proxy-service");

const DEFAULT_CONCURRENCY = 50;
const MAX_CONCURRENCY = 100;
const DEFAULT_TIMEOUT_MS = 3500;
const DEFAULT_TCP_TIMEOUT_MS = 1200;

class ProxyPreflight {
  constructor({ proxyService = new ProxyService() } = {}) {
    this.proxyService = proxyService;
  }

  async testProxy(proxy, options = {}) {
    const timeout = clampInteger(options.timeout, DEFAULT_TIMEOUT_MS, 500, 30000);
    const tcpTimeout = clampInteger(options.tcpTimeout || Math.min(timeout, DEFAULT_TCP_TIMEOUT_MS), DEFAULT_TCP_TIMEOUT_MS, 250, timeout);
    const runId = options.runId || `proxy_preflight_${Date.now()}`;
    const protocolCheck = options.protocolCheck !== false;
    const testHost = options.testHost || "example.com";
    const testPort = Number.parseInt(options.testPort || 443, 10);
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
      const tcpResult = await testTcp(proxy.address, proxy.port, tcpTimeout);
      result.reachability.tcp = tcpResult;
      if (!tcpResult.success) {
        result.errors.push(tcpResult.error || "TCP connection failed");
      } else if (protocolCheck) {
        const protocolResult = await testProxyProtocol(proxy, { timeout, testHost, testPort });
        result.reachability.protocol = protocolResult;
        if (!protocolResult.success) result.errors.push(protocolResult.error || "Proxy protocol check failed");
      }
    } catch (error) {
      result.errors.push(error.message);
    }

    result.success = result.errors.length === 0 && Boolean(result.reachability.tcp?.success) && (!protocolCheck || Boolean(result.reachability.protocol?.success));
    result.latency = Date.now() - startedAt;

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
    const concurrency = clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, MAX_CONCURRENCY);
    const runId = options.runId || `proxy_batch_${Date.now()}`;
    const results = new Array(proxies.length);
    let index = 0;
    let completed = 0;

    const worker = async () => {
      while (index < proxies.length) {
        const currentIndex = index;
        index += 1;
        const proxy = proxies[currentIndex];
        const result = await this.testProxy(proxy, { ...options, runId });
        results[currentIndex] = result;
        completed += 1;
        if (typeof options.onProgress === "function") {
          options.onProgress({ completed, total: proxies.length, proxy: redactProxy(proxy), result });
        }
      }
    };

    const workerCount = Math.min(concurrency, proxies.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results.filter(Boolean).sort((left, right) => {
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
    socket.once("timeout", () => finish({ success: false, error: "TCP connection timed out" }));
    socket.once("error", (error) => finish({ success: false, error: error.message, code: error.code }));
    socket.connect(port, host);
  });
}

function testProxyProtocol(proxy, { timeout, testHost, testPort }) {
  const type = String(proxy.type || "http").toLowerCase();
  if (type === "http") return testHttpConnectProxy(proxy, { timeout, testHost, testPort, useTls: false });
  if (type === "https") return testHttpConnectProxy(proxy, { timeout, testHost, testPort, useTls: true });
  if (type === "socks5") return testSocks5Proxy(proxy, { timeout, testHost, testPort });
  if (type === "socks4") return testSocks4Proxy(proxy, { timeout, testHost, testPort });
  return Promise.resolve({ success: false, error: `Unsupported proxy protocol: ${type}` });
}

function testHttpConnectProxy(proxy, { timeout, testHost, testPort, useTls }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = useTls
      ? tls.connect({ host: proxy.address, port: proxy.port, servername: proxy.address, rejectUnauthorized: false })
      : net.createConnection({ host: proxy.address, port: proxy.port });
    const chunks = [];
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ latency: Date.now() - startedAt, protocol: useTls ? "https-connect" : "http-connect", ...payload });
    };
    const writeConnect = () => {
      const authHeader = httpProxyAuthHeader(proxy);
      socket.write([
        `CONNECT ${testHost}:${testPort} HTTP/1.1`,
        `Host: ${testHost}:${testPort}`,
        "User-Agent: AURA-Proxy-Preflight/1.0",
        authHeader,
        "Connection: close",
        "",
        ""
      ].filter((line) => line !== null).join("\r\n"));
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => { if (!useTls) writeConnect(); });
    socket.once("secureConnect", writeConnect);
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.includes("\r\n\r\n")) return;
      const match = text.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/i);
      const statusCode = match ? Number(match[1]) : null;
      finish(statusCode && statusCode >= 200 && statusCode < 300
        ? { success: true, statusCode }
        : { success: false, statusCode, error: statusCode ? `CONNECT returned HTTP ${statusCode}` : "Invalid HTTP proxy response" });
    });
    socket.once("timeout", () => finish({ success: false, error: "Proxy protocol check timed out" }));
    socket.once("error", (error) => finish({ success: false, error: error.message, code: error.code }));
    socket.once("close", () => finish({ success: false, error: "Proxy connection closed before CONNECT response" }));
  });
}

function httpProxyAuthHeader(proxy) {
  if (!proxy.username || !proxy.password) return null;
  const token = Buffer.from(`${proxy.username}:${proxy.password}`).toString("base64");
  return `Proxy-Authorization: Basic ${token}`;
}

function testSocks5Proxy(proxy, { timeout, testHost, testPort }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host: proxy.address, port: proxy.port });
    const chunks = [];
    let stage = "greeting";
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ latency: Date.now() - startedAt, protocol: "socks5-connect", ...payload });
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => {
      socket.write(proxy.username && proxy.password ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]));
    });
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (stage === "greeting") {
        if (data.length < 2) return;
        chunks.length = 0;
        if (data[0] !== 0x05) return finish({ success: false, error: "Invalid SOCKS5 greeting response" });
        if (data[1] === 0x00) {
          stage = "connect";
          socket.write(socks5ConnectRequest(testHost, testPort));
          return;
        }
        if (data[1] === 0x02 && proxy.username && proxy.password) {
          stage = "auth";
          socket.write(socks5AuthRequest(proxy.username, proxy.password));
          return;
        }
        finish({ success: false, error: `SOCKS5 authentication method rejected (${data[1]})` });
        return;
      }
      if (stage === "auth") {
        if (data.length < 2) return;
        chunks.length = 0;
        if (data[1] !== 0x00) return finish({ success: false, error: "SOCKS5 username/password authentication failed" });
        stage = "connect";
        socket.write(socks5ConnectRequest(testHost, testPort));
        return;
      }
      if (stage === "connect") {
        if (data.length < 5) return;
        if (data[0] !== 0x05) return finish({ success: false, error: "Invalid SOCKS5 connect response" });
        finish(data[1] === 0x00 ? { success: true } : { success: false, error: `SOCKS5 connect failed with code ${data[1]}` });
      }
    });
    socket.once("timeout", () => finish({ success: false, error: "Proxy protocol check timed out" }));
    socket.once("error", (error) => finish({ success: false, error: error.message, code: error.code }));
    socket.once("close", () => finish({ success: false, error: "Proxy connection closed before SOCKS5 response" }));
  });
}

function socks5AuthRequest(username, password) {
  const user = Buffer.from(String(username));
  const pass = Buffer.from(String(password));
  return Buffer.concat([Buffer.from([0x01, Math.min(user.length, 255)]), user.subarray(0, 255), Buffer.from([Math.min(pass.length, 255)]), pass.subarray(0, 255)]);
}

function socks5ConnectRequest(host, port) {
  const hostBuffer = Buffer.from(String(host));
  return Buffer.concat([
    Buffer.from([0x05, 0x01, 0x00, 0x03, Math.min(hostBuffer.length, 255)]),
    hostBuffer.subarray(0, 255),
    Buffer.from([(port >> 8) & 0xff, port & 0xff])
  ]);
}

function testSocks4Proxy(proxy, { timeout, testHost, testPort }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host: proxy.address, port: proxy.port });
    const chunks = [];
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ latency: Date.now() - startedAt, protocol: "socks4a-connect", ...payload });
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => socket.write(socks4aConnectRequest(testHost, testPort, proxy.username || "aura")));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const data = Buffer.concat(chunks);
      if (data.length < 8) return;
      finish(data[1] === 0x5a ? { success: true } : { success: false, error: `SOCKS4 connect failed with code ${data[1]}` });
    });
    socket.once("timeout", () => finish({ success: false, error: "Proxy protocol check timed out" }));
    socket.once("error", (error) => finish({ success: false, error: error.message, code: error.code }));
    socket.once("close", () => finish({ success: false, error: "Proxy connection closed before SOCKS4 response" }));
  });
}

function socks4aConnectRequest(host, port, userId) {
  const user = Buffer.from(String(userId || "aura"));
  const hostBuffer = Buffer.from(String(host));
  return Buffer.concat([
    Buffer.from([0x04, 0x01, (port >> 8) & 0xff, port & 0xff, 0x00, 0x00, 0x00, 0x01]),
    user,
    Buffer.from([0x00]),
    hostBuffer,
    Buffer.from([0x00])
  ]);
}

function redactProxy(proxy) {
  return { ...proxy, username: proxy.username ? "****" : null, password: proxy.password ? "****" : null };
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

module.exports = ProxyPreflight;
