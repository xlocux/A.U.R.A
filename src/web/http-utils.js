"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_BODY_BYTES = 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(payload));
}

function sendFile(response, filePath, extraHeaders = {}) {
  response.writeHead(200, {
    "Content-Type": contentType(filePath),
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  const stream = fs.createReadStream(filePath);
  stream.on("error", () => response.destroy());
  stream.pipe(response);
}

function sendDownload(response, { contentType: type, filename, body }) {
  response.writeHead(200, exportHeaders(type, filename));
  response.end(body);
}

function sendNotFound(response) {
  sendJson(response, { error: "Not Found" }, 404);
}

function exportHeaders(type, filename) {
  return {
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${safeDownloadName(filename, "download")}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}

function safeDownloadName(value, fallback = "download") {
  return String(value || "").replaceAll(/[^a-z0-9_.-]+/gi, "-").replace(/^-+|-+$/g, "") || fallback;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(new HttpError(413, "Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      const body = Buffer.concat(chunks).toString("utf8");
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new HttpError(400, "Request body must be valid JSON"));
      }
    });
    request.on("error", (error) => {
      if (!rejected) reject(error);
    });
  });
}

function safeResolveStatic(rootDir, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  const normalized = decoded === "/" ? "/index.html" : decoded;
  const absolute = path.resolve(rootDir, `.${normalized}`);
  return isInsidePath(absolute, rootDir) ? absolute : null;
}

function isInsidePath(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isExistingFile(filePath) {
  try {
    return Boolean(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function contentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

module.exports = {
  HttpError,
  contentType,
  exportHeaders,
  isExistingFile,
  isInsidePath,
  readBody,
  safeDownloadName,
  safeResolveStatic,
  sendDownload,
  sendFile,
  sendJson,
  sendNotFound
};
