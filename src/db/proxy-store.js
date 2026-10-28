// Proxy Store - SQLite persistence layer for proxy management
// Handles storage and retrieval of proxy information and metrics

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { nowIso, transaction } = require("./store/helpers");

class ProxyStore {
  constructor(dbPath = process.env.AURA_PROXY_DB || path.join(__dirname, "../../data/proxies.db")) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this._initTables();
  }

  _initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS proxies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        port INTEGER NOT NULL,
        type TEXT NOT NULL, -- http, https, socks4, socks5
        country TEXT,
        status TEXT DEFAULT 'unknown', -- active, inactive, testing, failed
        username TEXT,
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(address, port, type)
      );

      CREATE TABLE IF NOT EXISTS proxy_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proxy_id INTEGER NOT NULL,
        tool_id TEXT,
        latency_ms INTEGER,
        success_rate REAL DEFAULT 0.0,
        last_tested DATETIME,
        failures_count INTEGER DEFAULT 0,
        total_tests INTEGER DEFAULT 0,
        successful_tests INTEGER DEFAULT 0,
        avg_response_time REAL,
        FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS proxy_test_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        proxy_id INTEGER NOT NULL,
        target_url TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        success BOOLEAN,
        latency_ms INTEGER,
        error_message TEXT,
        http_status INTEGER,
        FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status);
      CREATE INDEX IF NOT EXISTS idx_proxy_metrics_proxy_id ON proxy_metrics(proxy_id);
      CREATE INDEX IF NOT EXISTS idx_proxy_metrics_last_tested ON proxy_metrics(last_tested);
      CREATE INDEX IF NOT EXISTS idx_proxy_test_runs_run_id ON proxy_test_runs(run_id);
      CREATE INDEX IF NOT EXISTS idx_proxy_test_runs_proxy_id ON proxy_test_runs(proxy_id);
    `);
  }

  // Re-importing an existing proxy keeps stored credentials/country unless new values are supplied,
  // and only changes status when the caller passes one explicitly.
  async addProxy(address, port, type, metadata = {}) {
    const { country = null, username = null, password = null, status } = metadata;
    address = String(address).trim().toLowerCase(); // hostnames are case-insensitive: "Proxy.X.com" and "proxy.x.com" are one proxy
    const existing = this.db.prepare("SELECT id FROM proxies WHERE lower(address) = ? AND port = ? AND type = ?").get(address, port, type);
    const timestamp = nowIso();
    if (existing) {
      this.db.prepare(`
        UPDATE proxies
        SET country = COALESCE(?, country), username = COALESCE(?, username), password = COALESCE(?, password),
            status = COALESCE(?, status), updated_at = ?
        WHERE id = ?
      `).run(country, username, password, status ?? null, timestamp, existing.id);
      return existing.id;
    }
    const result = this.db.prepare(`
      INSERT INTO proxies (address, port, type, country, username, password, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(address, port, type, country, username, password, status || "unknown", timestamp, timestamp);
    return Number(result.lastInsertRowid);
  }

  // Sets status and overwrites metric columns with the supplied values.
  async updateProxyStatus(proxyId, status, metrics = {}) {
    const {
      latency_ms = null,
      success_rate = null,
      failures_count = null,
      total_tests = null,
      successful_tests = null,
      avg_response_time = null
    } = metrics;
    const timestamp = nowIso();
    this.transaction(() => {
      this.db.prepare("UPDATE proxies SET status = ?, updated_at = ? WHERE id = ?").run(status, timestamp, proxyId);
      if (latency_ms === null && success_rate === null) return;
      const current = this.db.prepare("SELECT * FROM proxy_metrics WHERE proxy_id = ?").get(proxyId);
      if (current) {
        this.db.prepare(`
          UPDATE proxy_metrics
          SET latency_ms = ?, success_rate = ?, failures_count = ?, total_tests = ?,
              successful_tests = ?, avg_response_time = ?, last_tested = ?
          WHERE proxy_id = ?
        `).run(
          latency_ms ?? current.latency_ms,
          success_rate ?? current.success_rate,
          failures_count ?? current.failures_count,
          total_tests ?? current.total_tests,
          successful_tests ?? current.successful_tests,
          avg_response_time ?? current.avg_response_time,
          timestamp,
          proxyId
        );
      } else {
        this.db.prepare(`
          INSERT INTO proxy_metrics
            (proxy_id, latency_ms, success_rate, failures_count, total_tests, successful_tests, avg_response_time, last_tested)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(proxyId, latency_ms, success_rate, failures_count ?? 0, total_tests ?? 0, successful_tests ?? 0, avg_response_time, timestamp);
      }
    });
    return { proxyId, status, metrics };
  }

  // Accumulates one test outcome so success rate and average latency reflect the proxy's history.
  async recordProxyTest(proxyId, { success, latencyMs = null }) {
    const timestamp = nowIso();
    const latency = Number.isFinite(Number(latencyMs)) ? Number(latencyMs) : null;
    return this.transaction(() => {
      this.db.prepare("UPDATE proxies SET status = ?, updated_at = ? WHERE id = ?").run(success ? "active" : "failed", timestamp, proxyId);
      const current = this.db.prepare("SELECT * FROM proxy_metrics WHERE proxy_id = ?").get(proxyId);
      const total = Number(current?.total_tests || 0) + 1;
      const successful = Number(current?.successful_tests || 0) + (success ? 1 : 0);
      const failures = Number(current?.failures_count || 0) + (success ? 0 : 1);
      const previousAvg = current?.avg_response_time;
      const avg = latency === null ? previousAvg ?? null
        : previousAvg === null || previousAvg === undefined ? latency
          : Math.round((Number(previousAvg) * (total - 1) + latency) / total);
      const values = [latency ?? current?.latency_ms ?? null, successful / total, failures, total, successful, avg, timestamp, proxyId];
      if (current) {
        this.db.prepare(`
          UPDATE proxy_metrics SET latency_ms = ?, success_rate = ?, failures_count = ?, total_tests = ?,
            successful_tests = ?, avg_response_time = ?, last_tested = ? WHERE proxy_id = ?
        `).run(...values);
      } else {
        this.db.prepare(`
          INSERT INTO proxy_metrics (latency_ms, success_rate, failures_count, total_tests, successful_tests, avg_response_time, last_tested, proxy_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(...values);
      }
      return { proxyId, successRate: successful / total, totalTests: total };
    });
  }

  transaction(fn) {
    return transaction(this.db, fn);
  }

  async getActiveProxies() {
    return this.getProxies({ status: "active" });
  }

  async getProxies(filters = {}) {
    const {
      status = null,
      type = null,
      country = null,
      minSuccessRate = null,
      maxLatency = null
    } = filters;
    let query = `
      SELECT p.*, pm.latency_ms, pm.success_rate, pm.last_tested
      FROM proxies p
      LEFT JOIN proxy_metrics pm ON p.id = pm.proxy_id
      WHERE 1 = 1
    `;
    const params = [];
    if (status && status !== "all") {
      query += " AND p.status = ?";
      params.push(status);
    }
    if (type) {
      query += " AND p.type = ?";
      params.push(type);
    }
    if (country) {
      query += " AND p.country = ?";
      params.push(String(country).toUpperCase());
    }
    if (Number.isFinite(minSuccessRate)) {
      query += " AND COALESCE(pm.success_rate, 0) >= ?";
      params.push(minSuccessRate);
    }
    if (Number.isInteger(maxLatency)) {
      query += " AND pm.latency_ms <= ?";
      params.push(maxLatency);
    }
    query += " ORDER BY pm.success_rate DESC, pm.latency_ms ASC, p.updated_at DESC";
    return this.db.prepare(query).all(...params);
  }

  async getProxyMetrics(proxyId) {
    return this.db.prepare("SELECT * FROM proxy_metrics WHERE proxy_id = ?").get(proxyId);
  }

  async recordTestRun(runId, proxyId, targetUrl, success, latencyMs, errorMessage = null, httpStatus = null) {
    const result = this.db.prepare(`
      INSERT INTO proxy_test_runs
        (run_id, proxy_id, target_url, success, latency_ms, error_message, http_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, proxyId, targetUrl, success ? 1 : 0, latencyMs, errorMessage, httpStatus);
    return Number(result.lastInsertRowid);
  }

  async deleteProxy(proxyId) {
    const result = this.db.prepare("DELETE FROM proxies WHERE id = ?").run(proxyId);
    return result.changes > 0;
  }

  async deleteProxiesByIds(proxyIds) {
    const ids = [...new Set((proxyIds || []).map((id) => Number.parseInt(id, 10)).filter(Number.isInteger))];
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(", ");
    const result = this.db.prepare(`DELETE FROM proxies WHERE id IN (${placeholders})`).run(...ids);
    return result.changes;
  }

  async getProxy(proxyId) {
    return this.db.prepare("SELECT * FROM proxies WHERE id = ?").get(proxyId);
  }

  async findProxyByCoords(address, port, type) {
    return this.db.prepare(
      "SELECT * FROM proxies WHERE lower(address) = ? AND port = ? AND type = ?"
    ).get(String(address).trim().toLowerCase(), port, type);
  }

  async updateProxy(proxyId, proxy) {
    this.db.prepare(`
      UPDATE proxies
      SET address = ?, port = ?, type = ?, country = ?, username = ?, password = ?,
          status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      proxy.address,
      proxy.port,
      proxy.type,
      proxy.country,
      proxy.username,
      proxy.password,
      proxy.status,
      nowIso(),
      proxyId
    );
  }

  async countProxies() {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM proxies").get();
    return row.count;
  }

  async listStatusCounts() {
    return this.db.prepare("SELECT status, COUNT(*) as count FROM proxies GROUP BY status").all();
  }

  async getAverages() {
    return this.db.prepare(`
      SELECT AVG(success_rate) as avg_success_rate,
             AVG(latency_ms) as avg_latency,
             COUNT(*) as total_with_metrics
      FROM proxy_metrics
    `).get();
  }

  async getRecentTests() {
    return this.db.prepare(`
      SELECT DATE(timestamp) as date,
             COUNT(*) as total_tests,
             SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_tests
      FROM proxy_test_runs
      WHERE timestamp >= datetime('now', '-7 days')
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `).all();
  }

  close() {
    this.db.close();
  }
}

module.exports = ProxyStore;
