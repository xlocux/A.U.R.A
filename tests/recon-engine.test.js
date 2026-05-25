"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_HTTPX_PORTS,
  HTTPX_PORT_PRESETS,
  buildRecoveryActions,
  httpxArgsForInput,
  parsePortList,
  parseToolSpec,
  uniquePorts
} = require("../src/recon/recon-engine");

test("default httpx ports include common web and service ports", () => {
  for (const port of [80, 443, 8009, 8080, 8081, 8090, 8180, 8443, 27000, 27001, 5000, 5001, 9001, 81, 9443, 25, 23]) {
    assert.ok(DEFAULT_HTTPX_PORTS.includes(port), `${port} should be in the default httpx probe list`);
  }
});

test("httpxArgsForInput passes the selected port set to httpx", () => {
  const args = httpxArgsForInput("/tmp/hosts.txt", HTTPX_PORT_PRESETS.small);
  const portsIndex = args.indexOf("-ports");
  assert.notEqual(portsIndex, -1);
  assert.equal(args[portsIndex + 1], HTTPX_PORT_PRESETS.small.join(","));
});

test("uniquePorts removes invalid, duplicate, and zero ports", () => {
  assert.deepEqual(uniquePorts([0, 80, "80", 443, 70000, "abc", 23]), [80, 443, 23]);
});

test("parsePortList accepts comma, space, and newline separated custom ports", () => {
  assert.deepEqual(parsePortList("80,443 8080\n8443"), [80, 443, 8080, 8443]);
});

test("parseToolSpec resolves httpx presets and custom port strings", () => {
  assert.deepEqual(parseToolSpec({ name: "httpx", preset: "small" }), { name: "httpx", ports: HTTPX_PORT_PRESETS.small });
  assert.deepEqual(parseToolSpec({ name: "httpx", customPorts: "80,443,9001" }), { name: "httpx", ports: [80, 443, 9001] });
});

test("parseToolSpec supports nmap with the same port selection model", () => {
  assert.deepEqual(parseToolSpec({ name: "nmap", preset: "large" }), { name: "nmap", ports: HTTPX_PORT_PRESETS.large });
});

test("recovery action pool includes failed tool actions", () => {
  const actions = buildRecoveryActions({
    roots: ["example.com"],
    wslTools: ["gau"],
    useWsl: true,
    screenshotTools: ["gowitness"],
    artifactsDir: "missing-artifacts",
    context: {
      urls: [],
      httpServices: [{ url: "https://app.example.com", host: "app.example.com" }],
      recoveryQueue: [
        { id: "retry-httpx-example", phase: "wsl-tool", toolName: "httpx", root: "example.com", reason: "httpx timeout" }
      ]
    }
  });

  assert.ok(actions.some((action) => action.id === "retry-httpx-example"));
  assert.ok(actions.some((action) => action.id === "retry-url-params"));
  assert.ok(actions.some((action) => action.id === "retry-screenshots"));
});
