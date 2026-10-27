"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { GENERATED_DIR } = require("../../recon/wordlist-generator");
const { isExistingFile, isInsidePath } = require("../http-utils");

const PREVIEW_MAX_BYTES = 256 * 1024;

const DEFAULT_WORDLISTS = [
  {
    name: "SecLists DNS Top 5K",
    category: "domains",
    path: "/usr/share/seclists/Discovery/DNS/subdomains-top1million-5000.txt",
    notes: "Default Linux/SecLists DNS discovery wordlist"
  },
  {
    name: "SecLists Web Common",
    category: "paths",
    path: "/usr/share/seclists/Discovery/Web-Content/common.txt",
    notes: "Default Linux/SecLists web content wordlist"
  },
  {
    name: "SecLists RAFT Small Words",
    category: "paths",
    path: "/usr/share/seclists/Discovery/Web-Content/raft-small-words.txt",
    notes: "Default Linux/SecLists compact content discovery wordlist"
  }
];

function ensureDefaultWordlists(store) {
  // Insert only missing defaults: an upsert would re-activate/re-stamp them and beat the operator's lists.
  return DEFAULT_WORDLISTS.map((wordlist) => store.getWordlistByName(wordlist.name) || store.addWordlist({ ...wordlist, status: "active" }));
}

function resolveWordlistFile(value) {
  return value ? path.resolve(String(value)) : null;
}

function isGeneratedWordlistPath(filePath) {
  return Boolean(filePath) && isInsidePath(filePath, GENERATED_DIR);
}

function readWordlistPreview(filePath) {
  const stat = fs.statSync(filePath);
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(Math.min(PREVIEW_MAX_BYTES, stat.size));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    return { sizeBytes: stat.size, truncated: stat.size > PREVIEW_MAX_BYTES, content: buffer.toString("utf8") };
  } finally {
    fs.closeSync(handle);
  }
}

function buildWordlistMetadata(wordlist) {
  const filePath = resolveWordlistFile(wordlist.path);
  if (!isExistingFile(filePath)) {
    return { available: false, sizeBytes: null, lineCount: null, error: "Wordlist file is not available on disk" };
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
      }
      if (bytesRead > 0) lastByte = buffer[bytesRead - 1];
      position += bytesRead;
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return lastByte === 10 ? lines : lines + 1;
}

module.exports = {
  DEFAULT_WORDLISTS,
  buildWordlistMetadata,
  ensureDefaultWordlists,
  isGeneratedWordlistPath,
  readWordlistPreview,
  resolveWordlistFile
};
