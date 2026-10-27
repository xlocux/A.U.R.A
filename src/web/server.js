"use strict";

const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { openScanStore } = require("../db/scan-store");
const { createWebAuth } = require("./auth");
const { HttpError, isExistingFile, safeResolveStatic, sendFile, sendJson, sendNotFound } = require("./http-utils");
const { createRouter } = require("./router");
const { discoverTargets } = require("./target-service");

const STATIC_ROOT = path.resolve(__dirname, "..", "..", "public", "web");
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Assets the login page needs before authentication. These are static files with no scan data.
const PUBLIC_PATHS = new Set([
  "/login.html",
  "/app.css",
  "/login.css",
  "/wave-background.js",
  "/login-cookie.js",
  "/favicon.ico"
]);

const apiRouter = createRouter([
  require("./routes/target-routes"),
  require("./routes/recon-run-routes"),
  require("./routes/run-data-routes"),
  require("./routes/artifact-routes"),
  require("./routes/intel-routes"),
  require("./routes/api-key-routes"),
  require("./routes/ai-routes"),
  require("./routes/wordlist-routes"),
  require("./routes/environment-routes"),
  require("./routes/proxy-routes"),
  require("./routes/storage-routes"),
  require("./routes/voice-routes")
]);

function parseArgs(argv) {
  const parsed = { port: 31338, host: "127.0.0.1", db: path.resolve("data", "aura.db"), open: false };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    const [flag, inline] = value.split(/=(.*)/s);
    const next = () => (inline !== undefined ? inline : argv[++index]);
    if (flag === "--port") parsed.port = Number(next());
    else if (flag === "--host") parsed.host = String(next());
    else if (flag === "--db") parsed.db = path.resolve(next());
    else if (flag === "--open") parsed.open = true;
  }
  if (!Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port > 65535) parsed.port = 31338;
  return parsed;
}

function hostnameOf(hostHeader) {
  const value = String(hostHeader || "").trim().toLowerCase();
  if (value.startsWith("[")) return value.slice(0, value.indexOf("]") + 1);
  return value.split(":")[0];
}

// A loopback-bound server only answers to loopback Host names, which blocks DNS-rebinding pages
// from talking to it (and logging in with the default credentials).
function isAllowedHost(request, bindHost) {
  if (!LOOPBACK_HOSTS.has(bindHost)) return true;
  return LOOPBACK_HOSTS.has(hostnameOf(request.headers.host));
}

// State-changing requests must come from this origin: other local apps on other ports are
// "same-site" for SameSite=Lax cookies, so the cookie alone is not enough.
function isSameOriginWrite(request) {
  if (SAFE_METHODS.has(request.method)) return true;
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;
  const origin = request.headers.origin;
  if (!origin || origin === "null") return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  try {
    return new URL(origin).host === String(request.headers.host || "");
  } catch {
    return false;
  }
}

function isPublicPath(requestPath) {
  return PUBLIC_PATHS.has(requestPath) || requestPath.startsWith("/assets/");
}

function serveStatic(response, requestPath) {
  const filePath = safeResolveStatic(STATIC_ROOT, requestPath);
  if (!isExistingFile(filePath)) {
    sendNotFound(response);
    return;
  }
  sendFile(response, filePath, { "Cache-Control": "no-cache" });
}

function sendError(response, error) {
  if (response.headersSent) {
    console.error("[server] error after headers were sent:", error);
    response.destroy();
    return;
  }
  const statusCode = error instanceof HttpError || Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (statusCode >= 500) console.error("[server] request failed:", error);
  sendJson(response, { error: error?.message || "Internal Server Error", ...(error?.details || {}) }, statusCode);
}

function createRequestHandler({ store, auth, bindHost }) {
  return async function handleRequest(request, response) {
    try {
      if (!isAllowedHost(request, bindHost)) throw new HttpError(421, "Unexpected Host header");
      const url = new URL(request.url, "http://localhost");
      if (url.pathname.startsWith("/api/") && !isSameOriginWrite(request)) {
        throw new HttpError(403, "Cross-origin request rejected");
      }
      if (url.pathname.startsWith("/api/auth/")) {
        if (!(await auth.handleAuthRequest(request, response, url))) sendNotFound(response);
        return;
      }
      if (!auth.isAuthenticated(request) && !isPublicPath(url.pathname)) {
        if (url.pathname.startsWith("/api/")) throw new HttpError(401, "Authentication required");
        serveStatic(response, "/login.html");
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        if (!(await apiRouter({ request, response, url, store }))) sendNotFound(response);
        return;
      }
      serveStatic(response, url.pathname);
    } catch (error) {
      sendError(response, error);
    }
  };
}

function openBrowser(url) {
  const [command, args] = process.platform === "win32"
    ? ["cmd", ["/c", "start", "", url]]
    : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
}

async function startWebServer(argv = process.argv) {
  const args = parseArgs(argv);
  const store = openScanStore(args.db);
  const auth = createWebAuth({ store });
  discoverTargets(store);

  const server = http.createServer(createRequestHandler({ store, auth, bindHost: args.host }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, args.host, resolve);
  });
  // After listen succeeded: a second instance failing with EADDRINUSE must not touch the first one's live runs.
  store.failInterruptedRuns();
  const url = `http://${args.host}:${args.port}`;
  process.stdout.write(`A.U.R.A web UI listening on ${url}\n`);
  if (auth.usingDefaultPassword()) {
    process.stdout.write("Default login is locu:locu until changed. Set AURA_WEB_PASSWORD before first start to override the initial password.\n");
  }
  if (args.open) openBrowser(url);
  return server;
}

module.exports = {
  createRequestHandler,
  isAllowedHost,
  isSameOriginWrite,
  parseArgs,
  startWebServer
};
