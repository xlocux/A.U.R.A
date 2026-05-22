"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { openScanStore } = require("../db/scan-store");
const { handleApiRequest } = require("./api-routes");
const { discoverTargets } = require("./target-service");
const { safeResolveStatic, sendFile, sendJson, sendNotFound } = require("./http-utils");

function parseArgs(argv) {
  const parsed = {
    port: 31338,
    db: path.resolve("data", "aura.db"),
    open: false
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--port") parsed.port = Number(argv[++index]);
    else if (value.startsWith("--port=")) parsed.port = Number(value.split("=")[1]);
    else if (value === "--db") parsed.db = path.resolve(argv[++index]);
    else if (value.startsWith("--db=")) parsed.db = path.resolve(value.split("=")[1]);
    else if (value === "--open") parsed.open = true;
  }
  return parsed;
}

async function startWebServer(argv = process.argv) {
  const args = parseArgs(argv);
  const store = openScanStore(args.db);
  const staticRoot = path.resolve(__dirname, "..", "..", "public", "web");
  discoverTargets(store);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApiRequest({ request, response, url, store });
        if (!handled) sendNotFound(response);
        return;
      }
      serveStatic(response, staticRoot, url.pathname);
    } catch (error) {
      sendJson(response, { error: error.message }, 500);
    }
  });

  server.listen(args.port, () => {
    const url = `http://127.0.0.1:${args.port}`;
    process.stdout.write(`A.U.R.A web UI listening on ${url}\n`);
    if (args.open) {
      spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], {
        windowsHide: true,
        detached: true,
        stdio: "ignore"
      }).unref();
    }
  });

  return server;
}

function serveStatic(response, staticRoot, requestPath) {
  const filePath = safeResolveStatic(staticRoot, requestPath);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendNotFound(response);
    return;
  }
  sendFile(response, filePath);
}

module.exports = {
  parseArgs,
  startWebServer
};
