"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sendJson } = require("./http-utils");
const apiRoutes = require("./api-routes");

async function handleWordlistRequest({ request, response, url, store }) {
  // GET /api/wordlists
  if (request.method === "GET" && url.pathname === "/api/wordlists") {
    return apiRoutes._internal.listWordlists(response, store);
  }

  // POST /api/wordlists
  if (request.method === "POST" && url.pathname === "/api/wordlists") {
    return await apiRoutes._internal.createWordlist(request, response, store);
  }

  // POST /api/wordlists/generate
  if (request.method === "POST" && url.pathname === "/api/wordlists/generate") {
    return await apiRoutes._internal.generateWordlist(request, response, store);
  }

  // GET /api/wordlists/:id
  const idMatch = url.pathname.match(/^\/api\/wordlists\/(\d+)$/);
  if (idMatch && request.method === "GET") {
    return apiRoutes._internal.getWordlist(response, store, Number(idMatch[1]));
  }

  // GET /api/wordlists/:id/download (or read)
  const downloadMatch = url.pathname.match(/^\/api\/wordlists\/(\d+)\/(download|read)$/);
  if (downloadMatch && request.method === "GET") {
    return apiRoutes._internal.serveWordlistArtifact(response, store, Number(downloadMatch[1]), downloadMatch[2]);
  }

  // DELETE /api/wordlists/:id
  const deleteMatch = url.pathname.match(/^\/api\/wordlists\/(\d+)$/);
  if (deleteMatch && request.method === "DELETE") {
    return apiRoutes._internal.deleteWordlist(response, store, Number(deleteMatch[1]));
  }

  const metadataMatch = url.pathname.match(/^\/api\/wordlists\/(\d+)\/metadata$/);
  if (!metadataMatch || request.method !== "GET") return false;
  sendWordlistMetadata(response, store, Number(metadataMatch[1]));
  return true;
}

function sendWordlistMetadata(response, store, id) {
  const wordlist = store.getWordlist(id);
  if (!wordlist) {
    sendJson(response, { error: "Wordlist not found" }, 404);
    return;
  }
  const metadata = buildWordlistMetadata(wordlist);
  sendJson(response, { wordlist, metadata });
}

function buildWordlistMetadata(wordlist) {
  const filePath = resolveWordlistFile(wordlist.path);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return {
      available: false,
      sizeBytes: null,
      lineCount: null,
      error: "Wordlist file is not available on disk"
    };
  }
  const stat = fs.statSync(filePath);
  return {
    available: true,
    sizeBytes: stat.size,
    lineCount: countFileLines(filePath, stat.size),
    updatedAt: stat.mtime.toISOString()
  };
}

function countFileLines(filePath, sizeBytes) {
  if (sizeBytes === 0) return 0;
  const bufferSize = 1024 * 1024;
  const buffer = Buffer.alloc(bufferSize);
  const fd = fs.openSync(filePath, "r");
  let position = 0;
  let bytesRead = 0;
  let lines = 0;
  let lastByte = null;
  try {
    do {
      bytesRead = fs.readSync(fd, buffer, 0, bufferSize, position);
      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 10) lines += 1;
        lastByte = buffer[index];
      }
      position += bytesRead;
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return lastByte === 10 ? lines : lines + 1;
}

function resolveWordlistFile(value) {
  if (!value) return null;
  return path.resolve(String(value));
}

module.exports = {
  buildWordlistMetadata,
  handleWordlistRequest
};
