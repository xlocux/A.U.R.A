"use strict";

// AURI's local voice engine: pack status, input validation, verified downloads (no network, no npm: the runtime is
// faked and fetch is injected) and the /api/voice routes behind login.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-voice-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

const { createVoiceEngine, cleanText, clampSpeed, PACKS } = require("../src/web/services/voice-engine");

function fakeRuntime(root) {
  for (const dep of ["onnxruntime-node", "phonemizer"]) {
    const dir = path.join(root, "runtime", "node_modules", dep);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), "{}");
  }
}
const fakeFetch = (bodies) => async (url) => {
  const body = bodies[url];
  if (!body) return { ok: false, status: 404, body: null };
  return { ok: true, status: 200, body: (async function* chunks() { yield body.subarray(0, 3); yield body.subarray(3); })() };
};
async function finished(engine) {
  for (let i = 0; i < 100; i += 1) {
    const { job } = engine.status();
    if (job && job.done) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("install did not finish");
}

test("text and speed are sanitised", () => {
  assert.equal(cleanText("  hi\u0000\nthere  "), "hi there");
  assert.equal(cleanText("x".repeat(900)).length, 400);
  assert.equal(clampSpeed(9), 2);
  assert.equal(clampSpeed("nope"), 1);
  assert.equal(clampSpeed(0.1), 0.5);
});

test("a fresh engine reports nothing installed and rejects unknown or missing packs", async () => {
  const engine = createVoiceEngine({ root: path.join(workDir, "fresh") });
  const st = engine.status();
  assert.equal(st.runtime.installed, false);
  assert.deepEqual(st.packs.map((p) => p.id).sort(), Object.keys(PACKS).sort());
  assert.ok(st.packs.every((p) => !p.installed));
  assert.equal(st.job, null);
  assert.throws(() => engine.install("../../etc"), /Unknown voice pack/);
  assert.throws(() => engine.speak({ pack: "kokoro", text: "hi" }), (error) => error.statusCode === 409);
  assert.throws(() => engine.remove("nope"), (error) => error.statusCode === 400);
});

test("a pack is downloaded, verified and removed; a corrupted file is rejected", async () => {
  const root = path.join(workDir, "packs-ok");
  fakeRuntime(root);
  const model = Buffer.from("fake-model-bytes");
  const config = Buffer.from("{}");
  const packs = {
    "piper-test": {
      engine: "piper", label: "Piper - Test", note: "test", bytes: model.length + config.length,
      files: [
        { url: "https://example.test/model.onnx", to: "model.onnx", sha256: crypto.createHash("sha256").update(model).digest("hex") },
        { url: "https://example.test/model.onnx.json", to: "model.onnx.json" }
      ]
    },
    "piper-bad": {
      engine: "piper", label: "Piper - Bad", note: "test", bytes: model.length,
      files: [{ url: "https://example.test/model.onnx", to: "model.onnx", sha256: "0".repeat(64) }]
    }
  };
  const engine = createVoiceEngine({ root, packs, fetchImpl: fakeFetch({ "https://example.test/model.onnx": model, "https://example.test/model.onnx.json": config }) });

  engine.install("piper-test");
  assert.throws(() => engine.install("piper-bad"), (error) => error.statusCode === 409);
  const ok = await finished(engine);
  assert.equal(ok.error, "");
  assert.equal(ok.progress, 100);
  assert.equal(fs.readFileSync(path.join(root, "packs", "piper-test", "model.onnx"), "utf8"), "fake-model-bytes");
  assert.ok(engine.status().packs.find((p) => p.id === "piper-test").installed);

  engine.install("piper-bad");
  const bad = await finished(engine);
  assert.match(bad.error, /checksum mismatch/);
  assert.equal(fs.existsSync(path.join(root, "packs", "piper-bad", "model.onnx")), false);
  assert.equal(fs.existsSync(path.join(root, "packs", "piper-bad", "model.onnx.part")), false);

  // removing the last pack also removes the runtime
  engine.remove("piper-test");
  assert.equal(engine.status().packs.some((p) => p.installed), false);
  assert.equal(engine.status().runtime.installed, false);
});

test("the voice routes need a login and report status", async () => {
  const { openScanStore } = require("../src/db/scan-store");
  const { createWebAuth } = require("../src/web/auth");
  const { createRequestHandler } = require("../src/web/server");
  const store = openScanStore(path.join(workDir, "aura.db"));
  const auth = createWebAuth({ store });
  const server = http.createServer(createRequestHandler({ store, auth, bindHost: "127.0.0.1" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/voice/status`)).status, 401);
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "locu", password: "locu" }) });
    const cookie = login.headers.get("set-cookie").split(";")[0];
    const status = await (await fetch(`${base}/api/voice/status`, { headers: { Cookie: cookie } })).json();
    assert.equal(status.runtime.installed, false);
    assert.ok(status.packs.some((p) => p.id === "kokoro"));
    const speak = await fetch(`${base}/api/voice/speak`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ pack: "piper-linda", text: "hello" }) });
    assert.equal(speak.status, 409);
    const unknown = await fetch(`${base}/api/voice/install`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ pack: "nope" }) });
    assert.equal(unknown.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close?.();
  }
});
