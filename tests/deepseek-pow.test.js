"use strict";

// Verifies the DeepSeekHashV1 proof-of-work solver against a real challenge/answer pair captured
// from chat.deepseek.com. This locks the reverse-engineered algorithm + bundled wasm hash.

const assert = require("node:assert/strict");
const test = require("node:test");
const { solveChallenge, powResponseHeader } = require("../src/web/services/deepseek-pow");

const KNOWN = {
  algorithm: "DeepSeekHashV1",
  challenge: "957f078efa8c32b4675cb75e4f80e8b9a5aecbedc0ff07cf5637c6e75f819e48",
  salt: "735d40e5adb8d0d03a1c",
  difficulty: 144000,
  expire_at: 1792917239407,
  signature: "e3ffcd562401eccafa6563c1b892c2e28fbfbeae205bd6d2a4a52829e86cab08",
  target_path: "/api/v0/chat/completion"
};

test("solveChallenge finds the known DeepSeek PoW answer", () => {
  assert.equal(solveChallenge(KNOWN), 47450);
});

test("powResponseHeader encodes the solved answer as base64 JSON", () => {
  const header = powResponseHeader(KNOWN);
  const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  assert.equal(decoded.answer, 47450);
  assert.equal(decoded.challenge, KNOWN.challenge);
  assert.equal(decoded.salt, KNOWN.salt);
  assert.equal(decoded.target_path, KNOWN.target_path);
});

test("rejects an unknown algorithm", () => {
  assert.throws(() => solveChallenge({ ...KNOWN, algorithm: "OtherV2" }), /Unsupported/);
});
