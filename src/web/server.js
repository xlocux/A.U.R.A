"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { openScanStore } = require("../db/scan-store");
const { handleApiRequest } = require("./api-routes");
const { handleApiKeyRequest } = require("./api-key-routes");
const { handleWordlistRequest } = require("./wordlist-routes");
const { handleDiagnosticRequest } = require("./diagnostic-routes");
const { handleApiRequest: handleTargetRequest } = require("./target-routes");
const { handleApiRequest: handleReconRequest } = require("./recon-routes");
const { handleApiRequest: handleAiRequest } = require("./ai-routes");
const { handleApiRequest: handleExportRequest } = require("./export-routes");
const { createWebAuth } = require("./auth");
const { discoverTargets } = require("./target-service");
const { safeResolveStatic, sendFile, sendJson, sendNotFound } = require("./http-utils");

function parseArgs(argv) {
  const parsed = {
    port: 31338,
    host: "127.0.0.1",
    db: path.resolve("data", "aura.db"),
    open: false
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--port") parsed.port = Number(argv[++index]);
    else if (value.startsWith("--port=")) parsed.port = Number(value.split("=")[1]);
    else if (value === "--host") parsed.host = String(argv[++index]);
    else if (value.startsWith("--host=")) parsed.host = String(value.split("=")[1]);
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
  const auth = createWebAuth({ store });
  discoverTargets(store);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith("/api/auth/")) {
        const handled = await auth.handleAuthRequest(request, response, url);
        if (!handled) sendNotFound(response);
        return;
      }
      if (!auth.isAuthenticated(request) && !isPublicPath(url.pathname)) {
        if (url.pathname.startsWith("/api/")) {
          sendJson(response, { error: "Authentication required" }, 401);
          return;
        }
        serveStatic(response, staticRoot, "/login.html");
        return;
      }
      if (url.pathname.startsWith("/api/recon-runs/") && url.pathname.includes("/diagnostics")) {
        const handled = await handleDiagnosticRequest({ request, response, url, store });
        if (handled) return;
      }
      if (url.pathname.startsWith("/api/api-keys/")) {
        const handled = await handleApiKeyRequest({ request, response, url, store });
        if (handled) return;
      }
      if (url.pathname.startsWith("/api/wordlists/")) {
        const handled = await handleWordlistRequest({ request, response, url, store });
        if (handled) return;
      }
      if (url.pathname.startsWith("/api/targets")) {
        const handled = await handleTargetRequest({ request, response, url, store });
        if (handled) return;
      }
      if (url.pathname.startsWith("/api/recon-runs")) {
        const handled = await handleReconRequest({ request, response, url, store });
        if (handled) return;
      }
      if (url.pathname.startsWith("/api/ai-") || url.pathname.startsWith("/api/agent/")) {
        const handled = await handleAiRequest({ request, response, url, store });
        if (handled) return;
      }
      if (url.pathname.includes("/export") && url.pathname.startsWith("/api/recon-runs/")) {
        const handled = await handleExportRequest({ request, response, url, store });
        if (handled) return;
      }
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

  server.listen(args.port, args.host, () => {
    const url = `http://${args.host}:${args.port}`;
    process.stdout.write(`A.U.R.A web UI listening on ${url}\n`);
    process.stdout.write("Default login is locu:locu until changed. Set AURA_WEB_PASSWORD before first start to override the initial password.\n");
    if (args.open) openBrowser(url);
  });

  return server;
}

function openBrowser(url) {
  const child = spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore"
  });
  child.on("error", () => {});
  child.unref();
}

function isPublicPath(requestPath) {
  return requestPath === "/login.html" ||
    requestPath.startsWith("/assets/") ||
    requestPath === "/app.css" ||
    requestPath === "/login.css" ||
    requestPath === "/wave-background.js" ||
    requestPath === "/login-cookie.js" ||
    requestPath === "/favicon.ico";
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
