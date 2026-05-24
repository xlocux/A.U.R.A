// Proxy Store - SQLite persistence layer for proxy management
// Handles storage and retrieval of proxy information and metrics

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class ProxyStore {
  constructor(dbPath = path.join(__dirname, '../../data/proxies.db')) {
    this.db = new sqlite3.Database(dbPath);
    this._initTables();
  }

  _initTables() {
    // Proxies table
    this.db.run(`
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
      )
    `);

    // Proxy metrics table
    this.db.run(`
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
      )
    `);

    // Proxy test runs table
    this.db.run(`
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
      )
    `);

    // Create indices for better performance
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_proxies_status ON proxies(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_proxy_metrics_proxy_id ON proxy_metrics(proxy_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_proxy_metrics_last_tested ON proxy_metrics(last_tested)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_proxy_test_runs_run_id ON proxy_test_runs(run_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_proxy_test_runs_proxy_id ON proxy_test_runs(proxy_id)`);
  }

  // Add a new proxy or update if exists
  async addProxy(address, port, type, metadata = {}) {
    const {
      country = null,
      username = null,
      password = null,
      status = 'unknown'
    } = metadata;

    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT OR REPLACE INTO proxies 
         (address, port, type, country, username, password, status, updated_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [address, port, type, country, username, password, status],
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });
  }

  // Update proxy status and metrics
  async updateProxyStatus(proxyId, status, metrics = {}) {
    const {
      latency_ms = null,
      success_rate = null,
      failures_count = null,
      total_tests = null,
      successful_tests = null,
      avg_response_time = null
    } = metrics;

    return new Promise((resolve, reject) => {
      // Update proxies table
      this.db.run(
        `UPDATE proxies SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, proxyId],
        function(err) {
          if (err) return reject(err);
          
          // Update or insert metrics
          if (latency_ms !== null || success_rate !== null) {
            this.db.run(
              `INSERT OR REPLACE INTO proxy_metrics 
               (proxy_id, latency_ms, success_rate, failures_count, total_tests, 
                successful_tests, avg_response_time, last_tested) 
               VALUES (
                 ?, 
                 COALESCE(?, (SELECT latency_ms FROM proxy_metrics WHERE proxy_id = ?)),
                 COALESCE(?, (SELECT success_rate FROM proxy_metrics WHERE proxy_id = ?)),
                 COALESCE(?, (SELECT failures_count FROM proxy_metrics WHERE proxy_id = ?)),
                 COALESCE(?, (SELECT total_tests FROM proxy_metrics WHERE proxy_id = ?)),
                 COALESCE(?, (SELECT successful_tests FROM proxy_metrics WHERE proxy_id = ?)),
                 COALESCE(?, (SELECT avg_response_time FROM proxy_metrics WHERE proxy_id = ?)),
                 CURRENT_TIMESTAMP
               )`,
              [
                proxyId,
                latency_ms, proxyId,
                success_rate, proxyId,
                failures_count, proxyId,
                total_tests, proxyId,
                successful_tests, proxyId,
                avg_response_time, proxyId
              ],
              function(err2) {
                if (err2) return reject(err2);
                resolve({ proxyId, status, metrics });
              }
            );
          } else {
            resolve({ proxyId, status, metrics });
          }
        }
      );
    });
  }

  // Get active proxies
  async getActiveProxies() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT p.*, pm.latency_ms, pm.success_rate, pm.last_tested 
         FROM proxies p 
         LEFT JOIN proxy_metrics pm ON p.id = pm.proxy_id 
         WHERE p.status = 'active' 
         ORDER BY pm.success_rate DESC, pm.latency_ms ASC`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  // Get best proxies based on filters
  async getBestProxies(count = 10, filters = {}) {
    const {
      minSuccessRate = 0,
      maxLatency = null,
      proxyType = null,
      country = null,
      toolId = null
    } = filters;

    let query = `
      SELECT p.*, pm.latency_ms, pm.success_rate, pm.last_tested
      FROM proxies p
      LEFT JOIN proxy_metrics pm ON p.id = pm.proxy_id
      WHERE p.status = 'active'
    `;
    
    const params = [];

    if (minSuccessRate > 0) {
      query += ` AND pm.success_rate >= ?`;
      params.push(minSuccessRate);
    }
    
    if (maxLatency !== null) {
      query += ` AND pm.latency_ms <= ?`;
      params.push(maxLatency);
    }
    
    if (proxyType) {
      query += ` AND p.type = ?`;
      params.push(proxyType);
    }
    
    if (country) {
      query += ` AND p.country = ?`;
      params.push(country);
    }
    
    if (toolId) {
      query += ` AND (pm.tool_id IS NULL OR pm.tool_id = ?)`;
      params.push(toolId);
    }

    query += ` ORDER BY pm.success_rate DESC, pm.latency_ms ASC LIMIT ?`;
    params.push(count);

    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  // Get proxy metrics
  async getProxyMetrics(proxyId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM proxy_metrics WHERE proxy_id = ?`,
        [proxyId],
        (err, row) => {
          if (err) return reject(err);
          resolve(row);
        }
      );
    });
  }

  // Record a proxy test run
  async recordTestRun(runId, proxyId, targetUrl, success, latencyMs, errorMessage = null, httpStatus = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO proxy_test_runs 
         (run_id, proxy_id, target_url, success, latency_ms, error_message, http_status) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [runId, proxyId, targetUrl, success ? 1 : 0, latencyMs, errorMessage, httpStatus],
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });
  }

  // Get proxy test history
  async getProxyTestHistory(proxyId, limit = 50) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT * FROM proxy_test_runs 
         WHERE proxy_id = ? 
         ORDER BY timestamp DESC 
         LIMIT ?`,
        [proxyId, limit],
        (err, rows) => {
          if (err) return reject(err);
          resolve(rows);
        }
      );
    });
  }

  // Delete a proxy
  async deleteProxy(proxyId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `DELETE FROM proxies WHERE id = ?`,
        [proxyId],
        function(err) {
          if (err) return reject(err);
          resolve(this.changes > 0);
        }
      );
    });
  }

  // Close database connection
  close() {
    return new Promise((resolve, reject) => {
      this.db.close(err => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

module.exports = ProxyStore;