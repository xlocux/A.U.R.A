"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { preflightCheckToolAvailability, checkToolBinary } = require("../src/recon/tool-preflight-check");
const { loadToolRegistry } = require("../src/recon/tool-registry");

test("tool preflight check: detects missing tools", async () => {
  // Request tools that definitely don't exist
  const result = await preflightCheckToolAvailability({ toolIds: ["nonexistent-tool-xyz"] });
  assert.strictEqual(result.available, false);
  assert.ok(result.missing.includes("nonexistent-tool-xyz"));
});

test("tool preflight check: validates tool registry structure", async () => {
  const registry = loadToolRegistry();
  const tools = registry.list();
  assert.ok(tools.length > 0, "Tool registry should have at least one tool");

  // Verify each tool has required fields
  for (const tool of tools) {
    assert.ok(tool.tool_id, `Tool should have tool_id: ${JSON.stringify(tool)}`);
    assert.ok(tool.binary, `Tool ${tool.tool_id} should have binary field`);
    assert.ok(tool.version_check || tool.capability_check, `Tool ${tool.tool_id} should have version or capability check`);
  }
});

test("tool preflight check: returns structured result", async () => {
  const result = await preflightCheckToolAvailability({ toolIds: [] });
  assert.ok(typeof result === "object");
  assert.ok("available" in result);
  assert.ok("missing" in result);
  assert.ok("wrongCapability" in result);
  assert.ok("details" in result);
  assert.ok(Array.isArray(result.details));
});

test("tool preflight check: tool not in registry", async () => {
  const result = await preflightCheckToolAvailability({ toolIds: ["totally-invalid-tool-id-12345"] });
  assert.strictEqual(result.available, false);
  assert.ok(result.missing.includes("totally-invalid-tool-id-12345"));
  const detail = result.details.find(d => d.tool_id === "totally-invalid-tool-id-12345");
  assert.ok(detail);
  assert.strictEqual(detail.status, "unknown");
});
