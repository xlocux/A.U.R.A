"use strict";

const fs = require("fs");
const path = require("path");
const { sendJson } = require("../http-utils");

// Sum the size of a file plus its SQLite sidecars (-wal / -shm), ignoring missing ones.
function dbSize(file) {
  let total = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try { total += fs.statSync(file + suffix).size; } catch { /* missing is fine */ }
  }
  return total;
}

// Recursively sum file sizes under a directory. Bounded by the on-disk tree; used on demand only.
function dirSize(dir) {
  let total = 0;
  let files = 0;
  let stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      try { total += fs.statSync(full).size; files += 1; } catch { /* skip */ }
    }
  }
  return { bytes: total, files };
}

function countEntries(dir, predicate) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(predicate).length;
  } catch {
    return 0;
  }
}

function diskInfo(target) {
  try {
    const stat = fs.statfsSync(target);
    const total = stat.blocks * stat.bsize;
    const free = stat.bavail * stat.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

async function getStorageUsage({ response }) {
  const dataDir = path.resolve("data");
  const runsRoot = path.join(dataDir, "recon-runs");
  const wordlistsDir = path.join(dataDir, "wordlists");
  const targetsDir = path.resolve("targets");

  const database = dbSize(path.join(dataDir, "aura.db"));
  const proxyDb = dbSize(path.join(dataDir, "proxies.db"));
  const artifacts = dirSize(runsRoot);
  const wordlists = dirSize(wordlistsDir);
  const targetsConfig = dirSize(targetsDir);
  const voice = dirSize(path.join(dataDir, "voice"));

  const categories = [
    { key: "database", label: "Results database", path: "data/aura.db", bytes: database },
    { key: "artifacts", label: "Run artifacts", path: "data/recon-runs/", bytes: artifacts.bytes, files: artifacts.files },
    { key: "proxies", label: "Proxy pool database", path: "data/proxies.db", bytes: proxyDb },
    { key: "wordlists", label: "Generated wordlists", path: "data/wordlists/", bytes: wordlists.bytes, files: wordlists.files },
    { key: "targets", label: "Target configs", path: "targets/", bytes: targetsConfig.bytes, files: targetsConfig.files },
    { key: "voice", label: "AURI voice packs", path: "data/voice/", bytes: voice.bytes, files: voice.files }
  ];
  const totalBytes = categories.reduce((sum, item) => sum + item.bytes, 0);

  sendJson(response, {
    storage: {
      totalBytes,
      categories,
      counts: {
        runs: countEntries(runsRoot, (entry) => entry.isDirectory()),
        targets: countEntries(targetsDir, (entry) => entry.isDirectory())
      },
      disk: diskInfo(dataDir)
    }
  });
}

// Release info for the sidebar footer: package version plus the short git commit when running from a checkout.
function getVersion({ response }) {
  let commit = "";
  try { commit = require("child_process").execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: path.join(__dirname, "..", "..", ".."), encoding: "utf8", timeout: 2000, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not a git checkout */ }
  sendJson(response, { version: require("../../../package.json").version, commit });
}

module.exports = [
  { method: "GET", path: "/api/version", handler: getVersion },
  { method: "GET", path: "/api/storage/usage", handler: getStorageUsage }
];
