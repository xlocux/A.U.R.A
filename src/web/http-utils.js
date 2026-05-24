"use strict";

const fs = require("node:fs");
const path = require("node:path");

function sendJson(response, payload, statusCode = 200) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendFile(response, filePath) {
  const type = contentType(filePath);
  response.writeHead(200, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(response);
}

function sendNotFound(response) {
  sendJson(response, { error: "Not Found" }, 404);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function safeResolveStatic(rootDir, requestPath) {
  const normalized = requestPath === "/" ? "/index.html" : requestPath;
  const absolute = path.resolve(rootDir, `.${normalized}`);
  const relative = path.relative(rootDir, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "application/octet-stream";
}

module.exports = {
  readBody,
  safeResolveStatic,
  sendFile,
  sendJson,
  sendNotFound
};
