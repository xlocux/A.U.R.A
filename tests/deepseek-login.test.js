"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("cdp calls to a silent browser settle with an error instead of hanging", async () => {
  const net = require("node:net");
  // a TCP server that accepts and never answers the websocket handshake
  const server = net.createServer(() => {}).listen(0);
  await new Promise((r) => server.once("listening", r));
  const { cdpClient } = require("../src/web/services/deepseek-login");
  const client = cdpClient(`ws://127.0.0.1:${server.address().port}/x`);
  client.ready.catch(() => {});
  const started = Date.now();
  const res = await client.send("Runtime.enable", {}, 200).catch((e) => ({ error: e }));
  assert.ok(res.error);
  assert.ok(Date.now() - started < 3000);
  try { client.ws.close(); } catch { /* ignore */ }
  server.close();
});
