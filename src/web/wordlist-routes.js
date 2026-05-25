"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { sendJson } = require("./http-utils");

async function handleWordlistRequest({ request, response, url, store }) {
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
