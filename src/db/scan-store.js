"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { initScanStore } = require("./store/schema");

// ScanStore is the local SQLite control database. Its methods are grouped by domain in ./store/*.
class ScanStore {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }
}

Object.assign(
  ScanStore.prototype,
  require("./store/targets-runs"),
  require("./store/observations"),
  require("./store/leads-search"),
  require("./store/credentials")
);

function openScanStore(databasePath = path.resolve("data", "aura.db")) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  initScanStore(db);
  return new ScanStore(db);
}

module.exports = { ScanStore, initScanStore, openScanStore };
