"use strict";

const fs = require("node:fs");
const path = require("node:path");

class LocalArtifactStore {
  constructor({ rootDir = path.resolve("data", "recon-runs") } = {}) {
    this.rootDir = rootDir;
  }

  runDir(runId) {
    return path.join(this.rootDir, String(runId));
  }

  ensureRunDir(runId) {
    const dir = this.runDir(runId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  writeText(runId, name, content = "") {
    const dir = this.ensureRunDir(runId);
    const artifactPath = path.join(dir, safeArtifactName(name));
    fs.writeFileSync(artifactPath, content || "", "utf8");
    return {
      path: artifactPath,
      size: fs.statSync(artifactPath).size,
      sha256: null
    };
  }

  writeJson(runId, name, value) {
    return this.writeText(runId, name, `${JSON.stringify(value, null, 2)}\n`);
  }
}

function safeArtifactName(name) {
  return String(name || "artifact.txt").replaceAll(/[^a-z0-9_.-]/gi, "_");
}

module.exports = {
  LocalArtifactStore,
  safeArtifactName
};
