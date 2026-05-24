"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { DEFAULT_HTTPX_PORTS, httpxArgsForInput, uniquePorts } = require("../src/recon/recon-engine");

test("default httpx ports include common web and service ports", () => {
  for (const port of [80, 443, 8009, 8080, 8081, 8090, 8180, 8443, 27000, 27001, 5000, 5001, 9001, 81, 9443, 25, 23]) {
    assert.ok(DEFAULT_HTTPX_PORTS.includes(port), `${port} should be in the default httpx probe list`);
  }
});

test("httpxArgsForInput passes the expanded port set to httpx", () => {
  const args = httpxArgsForInput("/tmp/hosts.txt");
  const portsIndex = args.indexOf("-ports");
  assert.notEqual(portsIndex, -1);
  assert.equal(args[portsIndex + 1], DEFAULT_HTTPX_PORTS.join(","));
});

test("uniquePorts removes invalid, duplicate, and zero ports", () => {
  assert.deepEqual(uniquePorts([0, 80, "80", 443, 70000, "abc", 23]), [80, 443, 23]);
});
