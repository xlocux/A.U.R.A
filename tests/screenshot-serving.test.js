"use strict";

// Validates the screenshot serve + render contract end to end (independent of gowitness capture):
// a screenshot run whose output dir contains a PNG must surface via the screenshots endpoint as
// images[].url, and that URL must stream the PNG bytes back.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "aura-shots-"));
process.chdir(workDir);
process.env.AURA_PROXY_DB = path.join(workDir, "proxies.db");

const { openScanStore } = require("../src/db/scan-store");
const { createWebAuth } = require("../src/web/auth");
const { createRequestHandler } = require("../src/web/server");
const { withScreenshotImages } = require("../src/web/services/screenshot-files");

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c489" + "0000000a49444154789c6360000002000154a24f5f0000000049454e44ae426082", "hex");

let server;
let baseUrl;
let store;
let cookie = "";
let runId;
let shotDir;

test.before(async () => {
  store = openScanStore(path.join(workDir, "aura.db"));
  const auth = createWebAuth({ store });
  server = http.createServer(createRequestHandler({ store, auth, bindHost: "127.0.0.1" }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "locu", password: "locu" }) });
  cookie = login.headers.get("set-cookie").split(";")[0];

  const run = store.createRun({ targetName: "acme", runType: "recon", mode: "list" });
  runId = run.id;
  shotDir = path.join(workDir, "data", "recon-runs", String(runId), "screenshots", "gowitness");
  fs.mkdirSync(shotDir, { recursive: true });
  fs.writeFileSync(path.join(shotDir, "https-acme-example.png"), PNG_BYTES);
  store.saveScreenshotRun(runId, "acme", { toolName: "gowitness", outputDir: shotDir, reportPath: null, metadata: { screenshotCount: 1, status: "completed" } });
});

test.after(() => {
  server.close();
  store.close();
});

test("withScreenshotImages discovers PNGs on disk and builds image URLs", () => {
  const [shot] = store.listScreenshots({ runId }).map(withScreenshotImages);
  assert.equal(shot.images.length, 1);
  assert.match(shot.images[0].url, /\/api\/recon-screenshots\/\d+\/image\?path=/);
  assert.equal(shot.images[0].name, "https-acme-example.png");
});

test("screenshots endpoint returns the images array the UI renders", async () => {
  const response = await fetch(`${baseUrl}/api/recon-runs/${runId}/screenshots`, { headers: { Cookie: cookie } });
  const data = await response.json();
  assert.equal(data.screenshots.length, 1);
  assert.equal(data.screenshots[0].images.length, 1);
  assert.equal(data.screenshots[0].metadata.screenshotCount, 1);
});

test("the image URL streams the PNG bytes back", async () => {
  const [shot] = store.listScreenshots({ runId }).map(withScreenshotImages);
  const response = await fetch(`${baseUrl}${shot.images[0].url}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /image\/png/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.length, PNG_BYTES.length);
});

test("a path outside the screenshot output dir is rejected", async () => {
  const [shot] = store.listScreenshots({ runId });
  const response = await fetch(`${baseUrl}/api/recon-screenshots/${shot.id}/image?path=${encodeURIComponent("../../../../aura.db")}`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 404);
});
