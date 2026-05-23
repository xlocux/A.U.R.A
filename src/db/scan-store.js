"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

function nowIso() {
  return new Date().toISOString();
}

function openScanStore(databasePath = path.resolve("data", "aura.db")) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  initScanStore(db);
  return new ScanStore(db);
}

function initScanStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      target_name TEXT PRIMARY KEY,
      asset_type TEXT,
      program_url TEXT,
      source_path TEXT,
      config_path TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_name TEXT NOT NULL,
      run_type TEXT NOT NULL DEFAULT 'recon',
      status TEXT NOT NULL,
      mode TEXT,
      provider_profile TEXT,
      active_phase TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      checkpoint_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS scan_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      phase TEXT,
      severity TEXT NOT NULL DEFAULT 'info',
      source TEXT,
      message TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recon_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      domain TEXT NOT NULL,
      root_domain TEXT,
      kind TEXT NOT NULL DEFAULT 'subdomain',
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'discovered',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE (target_name, domain, source),
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS recon_tool_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      command_display TEXT,
      status TEXT NOT NULL,
      exit_code INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      stdout_path TEXT,
      stderr_path TEXT,
      error_message TEXT,
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recon_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      phase TEXT NOT NULL,
      type TEXT NOT NULL,
      tool_id TEXT,
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      payload_json TEXT NOT NULL DEFAULT '{}',
      checkpoint_json TEXT NOT NULL DEFAULT '{}',
      rate_limit_profile TEXT,
      timeout_ms INTEGER,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      concurrency_group TEXT,
      locked_by TEXT,
      locked_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS recon_urls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      url TEXT NOT NULL,
      host TEXT,
      path TEXT,
      query TEXT,
      params_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE (target_name, url, source),
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS recon_http_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      url TEXT NOT NULL,
      host TEXT,
      scheme TEXT,
      port INTEGER,
      status_code INTEGER,
      title TEXT,
      webserver TEXT,
      technologies_json TEXT NOT NULL DEFAULT '[]',
      final_url TEXT,
      content_length INTEGER,
      source TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE (target_name, url, source),
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS recon_screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      target_name TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      output_dir TEXT NOT NULL,
      report_path TEXT,
      captured_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS asset_discovery_queries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      target_name TEXT NOT NULL,
      provider TEXT NOT NULL,
      query_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      include_terms_json TEXT NOT NULL DEFAULT '[]',
      exclude_terms_json TEXT NOT NULL DEFAULT '[]',
      result_count INTEGER NOT NULL DEFAULT 0,
      next_page_token TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      raw_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS asset_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      target_name TEXT NOT NULL,
      lead_type TEXT NOT NULL DEFAULT 'domain',
      value TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL DEFAULT 'candidate',
      match_terms_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'new',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE (target_name, lead_type, value, source),
      FOREIGN KEY (run_id) REFERENCES scan_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (target_name) REFERENCES targets(target_name)
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      label TEXT NOT NULL,
      api_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      monthly_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      UNIQUE (provider, label)
    );

    CREATE TABLE IF NOT EXISTS web_users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      iterations INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wordlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_scan_events_run_id ON scan_events(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_recon_jobs_status ON recon_jobs(status, priority, id);
    CREATE INDEX IF NOT EXISTS idx_recon_jobs_run ON recon_jobs(run_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_recon_domains_target ON recon_domains(target_name, domain);
    CREATE INDEX IF NOT EXISTS idx_recon_domains_run ON recon_domains(run_id, domain);
    CREATE INDEX IF NOT EXISTS idx_recon_urls_run ON recon_urls(run_id, host);
    CREATE INDEX IF NOT EXISTS idx_recon_http_services_run ON recon_http_services(run_id, host);
    CREATE INDEX IF NOT EXISTS idx_asset_leads_target ON asset_leads(target_name, value);
    CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider, status);
    CREATE INDEX IF NOT EXISTS idx_wordlists_category ON wordlists(category, status);
    CREATE INDEX IF NOT EXISTS idx_web_users_status ON web_users(status);
  `);
}

class ScanStore {
  constructor(db) {
    this.db = db;
  }

  close() {
    this.db.close();
  }

  upsertTarget(configPath, config) {
    const updatedAt = nowIso();
    this.db.prepare(`
      INSERT INTO targets (
        target_name, asset_type, program_url, source_path, config_path, scope_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name) DO UPDATE SET
        asset_type = excluded.asset_type,
        program_url = excluded.program_url,
        source_path = excluded.source_path,
        config_path = excluded.config_path,
        scope_json = excluded.scope_json,
        updated_at = excluded.updated_at
    `).run(
      config.target_name,
      config.asset_type || null,
      config.program_url || null,
      config.source_path || null,
      configPath,
      JSON.stringify(config.scope || {}),
      updatedAt
    );
    return this.getTarget(config.target_name);
  }

  getTarget(targetName) {
    const row = this.db.prepare("SELECT * FROM targets WHERE target_name = ?").get(targetName);
    return row ? hydrateTarget(row) : null;
  }

  listTargets() {
    return this.db.prepare("SELECT * FROM targets ORDER BY target_name").all().map(hydrateTarget);
  }

  deleteTarget(targetName) {
    const existing = this.getTarget(targetName);
    if (!existing) return { deleted: false, runIds: [] };
    const runIds = this.db.prepare("SELECT id FROM scan_runs WHERE target_name = ?").all(targetName).map((row) => row.id);
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM asset_discovery_queries WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM asset_leads WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM recon_screenshots WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM recon_http_services WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM recon_urls WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM recon_domains WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM recon_jobs WHERE target_name = ?").run(targetName);
      this.db.prepare("DELETE FROM scan_runs WHERE target_name = ?").run(targetName);
      const result = this.db.prepare("DELETE FROM targets WHERE target_name = ?").run(targetName);
      this.db.exec("COMMIT");
      return { deleted: result.changes > 0, runIds };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createRun({ targetName, runType = "recon", mode = "blackbox", providerProfile = "wsl-kali", checkpoint = {} }) {
    const result = this.db.prepare(`
      INSERT INTO scan_runs (
        target_name, run_type, status, mode, provider_profile, active_phase, started_at, checkpoint_json
      ) VALUES (?, ?, 'queued', ?, ?, 'queued', ?, ?)
    `).run(targetName, runType, mode, providerProfile, nowIso(), JSON.stringify(checkpoint));
    return this.getRun(Number(result.lastInsertRowid));
  }

  updateRun(id, patch) {
    const current = this.getRun(id);
    if (!current) return null;
    const next = {
      status: patch.status ?? current.status,
      active_phase: patch.activePhase ?? current.active_phase,
      finished_at: patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
      checkpoint_json: patch.checkpoint === undefined ? current.checkpoint_json : JSON.stringify(patch.checkpoint),
      error_message: patch.errorMessage === undefined ? current.error_message : patch.errorMessage
    };
    this.db.prepare(`
      UPDATE scan_runs
      SET status = ?, active_phase = ?, finished_at = ?, checkpoint_json = ?, error_message = ?
      WHERE id = ?
    `).run(next.status, next.active_phase, next.finished_at, next.checkpoint_json, next.error_message, id);
    return this.getRun(id);
  }

  getRun(id) {
    const row = this.db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(id);
    return row ? hydrateRun(row) : null;
  }

  listRuns(limit = 50) {
    return this.db.prepare(`
      SELECT * FROM scan_runs ORDER BY id DESC LIMIT ?
    `).all(limit).map(hydrateRun);
  }

  getLatestRunForTarget(targetName) {
    const row = this.db.prepare(`
      SELECT * FROM scan_runs
      WHERE target_name = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(targetName);
    return row ? hydrateRun(row) : null;
  }

  appendEvent(runId, { phase = null, severity = "info", source = null, message, payload = {} }) {
    const result = this.db.prepare(`
      INSERT INTO scan_events (run_id, created_at, phase, severity, source, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(runId, nowIso(), phase, severity, source, message, JSON.stringify(payload || {}));
    return this.db.prepare("SELECT * FROM scan_events WHERE id = ?").get(Number(result.lastInsertRowid));
  }

  listEvents(runId, afterId = 0, limit = 200) {
    return this.db.prepare(`
      SELECT * FROM scan_events
      WHERE run_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT ?
    `).all(runId, afterId, limit).map(hydrateEvent);
  }

  createJob({
    runId,
    targetName,
    phase,
    type,
    toolId = null,
    priority = 100,
    payload = {},
    checkpoint = {},
    rateLimitProfile = null,
    timeoutMs = null,
    maxAttempts = 1,
    concurrencyGroup = null
  }) {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      INSERT INTO recon_jobs (
        run_id, target_name, phase, type, tool_id, status, priority,
        payload_json, checkpoint_json, rate_limit_profile, timeout_ms,
        max_attempts, concurrency_group, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      targetName,
      phase,
      type,
      toolId,
      priority,
      JSON.stringify(payload || {}),
      JSON.stringify(checkpoint || {}),
      rateLimitProfile,
      timeoutMs,
      maxAttempts,
      concurrencyGroup,
      timestamp,
      timestamp
    );
    return this.getJob(Number(result.lastInsertRowid));
  }

  getJob(id) {
    const row = this.db.prepare("SELECT * FROM recon_jobs WHERE id = ?").get(id);
    return row ? hydrateJob(row) : null;
  }

  listJobs({ runId = null, status = null, limit = 200 } = {}) {
    if (runId !== null && status !== null) {
      return this.db.prepare(`
        SELECT * FROM recon_jobs
        WHERE run_id = ? AND status = ?
        ORDER BY priority ASC, id ASC
        LIMIT ?
      `).all(runId, status, limit).map(hydrateJob);
    }
    if (runId !== null) {
      return this.db.prepare(`
        SELECT * FROM recon_jobs
        WHERE run_id = ?
        ORDER BY priority ASC, id ASC
        LIMIT ?
      `).all(runId, limit).map(hydrateJob);
    }
    if (status !== null) {
      return this.db.prepare(`
        SELECT * FROM recon_jobs
        WHERE status = ?
        ORDER BY priority ASC, id ASC
        LIMIT ?
      `).all(status, limit).map(hydrateJob);
    }
    return this.db.prepare(`
      SELECT * FROM recon_jobs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit).map(hydrateJob);
  }

  claimNextJob({ workerId, statuses = ["queued"], now = nowIso() }) {
    const placeholders = statuses.map(() => "?").join(", ");
    const candidate = this.db.prepare(`
      SELECT id FROM recon_jobs
      WHERE status IN (${placeholders})
      ORDER BY priority ASC, id ASC
      LIMIT 1
    `).get(...statuses);
    if (!candidate) return null;

    const result = this.db.prepare(`
      UPDATE recon_jobs
      SET status = 'running',
          locked_by = ?,
          locked_at = ?,
          started_at = COALESCE(started_at, ?),
          attempts = attempts + 1,
          updated_at = ?
      WHERE id = ? AND status IN (${placeholders})
    `).run(workerId, now, now, now, candidate.id, ...statuses);
    return result.changes === 1 ? this.getJob(candidate.id) : null;
  }

  updateJob(id, patch) {
    const current = this.getJob(id);
    if (!current) return null;
    const next = {
      status: patch.status ?? current.status,
      checkpoint_json: patch.checkpoint === undefined ? current.checkpoint_json : JSON.stringify(patch.checkpoint || {}),
      finished_at: patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
      error_message: patch.errorMessage === undefined ? current.error_message : patch.errorMessage,
      updated_at: nowIso()
    };
    this.db.prepare(`
      UPDATE recon_jobs
      SET status = ?,
          checkpoint_json = ?,
          finished_at = ?,
          error_message = ?,
          updated_at = ?
      WHERE id = ?
    `).run(next.status, next.checkpoint_json, next.finished_at, next.error_message, next.updated_at, id);
    return this.getJob(id);
  }

  saveDomains(runId, targetName, domains) {
    const insert = this.db.prepare(`
      INSERT INTO recon_domains (
        run_id, target_name, domain, root_domain, kind, source, status,
        first_seen_at, last_seen_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name, domain, source) DO UPDATE SET
        run_id = excluded.run_id,
        root_domain = excluded.root_domain,
        kind = excluded.kind,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        metadata_json = excluded.metadata_json
    `);
    const timestamp = nowIso();
    let saved = 0;
    this.db.exec("BEGIN");
    try {
      for (const item of uniqueBy(domains, (domain) => `${String(domain.domain || "").toLowerCase()}|${domain.source || ""}`)) {
        insert.run(
          runId,
          targetName,
          item.domain,
          item.rootDomain || null,
          item.kind || "subdomain",
          item.source,
          item.status || "discovered",
          timestamp,
          timestamp,
          JSON.stringify(item.metadata || {})
        );
        saved += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return saved;
  }

  listDomains({ runId = null, targetName = null, limit = 1000 } = {}) {
    if (runId !== null) {
      return this.db.prepare(`
        SELECT
          MIN(id) AS id,
          MAX(run_id) AS run_id,
          target_name,
          MIN(domain) AS domain,
          COALESCE(MAX(root_domain), '') AS root_domain,
          COALESCE(MAX(kind), 'subdomain') AS kind,
          group_concat(DISTINCT source) AS source,
          COALESCE(MAX(status), 'discovered') AS status,
          MIN(first_seen_at) AS first_seen_at,
          MAX(last_seen_at) AS last_seen_at,
          '{}' AS metadata_json
        FROM recon_domains
        WHERE run_id = ?
        GROUP BY target_name, lower(domain)
        ORDER BY domain
        LIMIT ?
      `).all(runId, limit).map(hydrateDomain);
    }
    if (targetName !== null) {
      return this.db.prepare(`
        SELECT
          MIN(id) AS id,
          MAX(run_id) AS run_id,
          target_name,
          MIN(domain) AS domain,
          COALESCE(MAX(root_domain), '') AS root_domain,
          COALESCE(MAX(kind), 'subdomain') AS kind,
          group_concat(DISTINCT source) AS source,
          COALESCE(MAX(status), 'discovered') AS status,
          MIN(first_seen_at) AS first_seen_at,
          MAX(last_seen_at) AS last_seen_at,
          '{}' AS metadata_json
        FROM recon_domains
        WHERE target_name = ?
        GROUP BY target_name, lower(domain)
        ORDER BY domain
        LIMIT ?
      `).all(targetName, limit).map(hydrateDomain);
    }
    return this.db.prepare(`
      SELECT
        MIN(id) AS id,
        MAX(run_id) AS run_id,
        target_name,
        MIN(domain) AS domain,
        COALESCE(MAX(root_domain), '') AS root_domain,
        COALESCE(MAX(kind), 'subdomain') AS kind,
        group_concat(DISTINCT source) AS source,
        COALESCE(MAX(status), 'discovered') AS status,
        MIN(first_seen_at) AS first_seen_at,
        MAX(last_seen_at) AS last_seen_at,
        '{}' AS metadata_json
      FROM recon_domains
      GROUP BY target_name, lower(domain)
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(limit).map(hydrateDomain);
  }

  saveUrls(runId, targetName, urls, source = "gau") {
    const insert = this.db.prepare(`
      INSERT INTO recon_urls (
        run_id, target_name, url, host, path, query, params_json, source,
        first_seen_at, last_seen_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name, url, source) DO UPDATE SET
        run_id = excluded.run_id,
        host = excluded.host,
        path = excluded.path,
        query = excluded.query,
        params_json = excluded.params_json,
        last_seen_at = excluded.last_seen_at,
        metadata_json = excluded.metadata_json
    `);
    const timestamp = nowIso();
    let saved = 0;
    this.db.exec("BEGIN");
    try {
      for (const item of uniqueBy(urls, (url) => `${String(url.url || "").toLowerCase()}|${source}`)) {
        insert.run(
          runId,
          targetName,
          item.url,
          item.host || null,
          item.path || null,
          item.query || null,
          JSON.stringify(item.params || []),
          source,
          timestamp,
          timestamp,
          JSON.stringify(item.metadata || {})
        );
        saved += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return saved;
  }

  listUrls({ runId, limit = 1000 }) {
    return this.db.prepare(`
      SELECT
        MIN(id) AS id,
        MAX(run_id) AS run_id,
        target_name,
        MIN(url) AS url,
        COALESCE(MAX(host), '') AS host,
        COALESCE(MAX(path), '') AS path,
        COALESCE(MAX(query), '') AS query,
        COALESCE(MAX(params_json), '[]') AS params_json,
        group_concat(DISTINCT source) AS source,
        MIN(first_seen_at) AS first_seen_at,
        MAX(last_seen_at) AS last_seen_at,
        '{}' AS metadata_json
      FROM recon_urls
      WHERE run_id = ?
      GROUP BY target_name, lower(url)
      ORDER BY host, path
      LIMIT ?
    `).all(runId, limit).map(hydrateUrl);
  }

  saveHttpServices(runId, targetName, services, source = "httpx") {
    const insert = this.db.prepare(`
      INSERT INTO recon_http_services (
        run_id, target_name, url, host, scheme, port, status_code, title, webserver,
        technologies_json, final_url, content_length, source, observed_at, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name, url, source) DO UPDATE SET
        run_id = excluded.run_id,
        host = excluded.host,
        scheme = excluded.scheme,
        port = excluded.port,
        status_code = excluded.status_code,
        title = excluded.title,
        webserver = excluded.webserver,
        technologies_json = excluded.technologies_json,
        final_url = excluded.final_url,
        content_length = excluded.content_length,
        observed_at = excluded.observed_at,
        raw_json = excluded.raw_json
    `);
    const observedAt = nowIso();
    let saved = 0;
    this.db.exec("BEGIN");
    try {
      for (const item of uniqueBy(services, (service) => `${String(service.url || "").toLowerCase()}|${source}`)) {
        insert.run(
          runId,
          targetName,
          item.url,
          item.host || null,
          item.scheme || null,
          item.port || null,
          item.statusCode ?? null,
          item.title || null,
          item.webserver || null,
          JSON.stringify(item.technologies || []),
          item.finalUrl || null,
          item.contentLength ?? null,
          source,
          observedAt,
          JSON.stringify(item.raw || {})
        );
        saved += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return saved;
  }

  listHttpServices({ runId, limit = 1000 }) {
    return this.db.prepare(`
      SELECT
        MIN(id) AS id,
        MAX(run_id) AS run_id,
        target_name,
        MIN(url) AS url,
        COALESCE(MAX(host), '') AS host,
        COALESCE(MAX(scheme), '') AS scheme,
        MAX(port) AS port,
        MAX(status_code) AS status_code,
        COALESCE(MAX(title), '') AS title,
        COALESCE(MAX(webserver), '') AS webserver,
        COALESCE(MAX(technologies_json), '[]') AS technologies_json,
        COALESCE(MAX(final_url), '') AS final_url,
        MAX(content_length) AS content_length,
        group_concat(DISTINCT source) AS source,
        MAX(observed_at) AS observed_at,
        '{}' AS raw_json
      FROM recon_http_services
      WHERE run_id = ?
      GROUP BY target_name, lower(url)
      ORDER BY host, port
      LIMIT ?
    `).all(runId, limit).map(hydrateHttpService);
  }

  saveScreenshotRun(runId, targetName, screenshot) {
    this.db.prepare(`
      INSERT INTO recon_screenshots (
        run_id, target_name, tool_name, output_dir, report_path, captured_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      targetName,
      screenshot.toolName,
      screenshot.outputDir,
      screenshot.reportPath || null,
      nowIso(),
      JSON.stringify(screenshot.metadata || {})
    );
  }

  listScreenshots({ runId }) {
    return this.db.prepare(`
      SELECT * FROM recon_screenshots WHERE run_id = ? ORDER BY id DESC
    `).all(runId).map(hydrateScreenshot);
  }

  recordAssetDiscoveryQuery(targetName, query) {
    const result = this.db.prepare(`
      INSERT INTO asset_discovery_queries (
        run_id, target_name, provider, query_type, mode, include_terms_json,
        exclude_terms_json, result_count, next_page_token, status, created_at,
        raw_json, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      query.runId || null,
      targetName,
      query.provider,
      query.queryType,
      query.mode,
      JSON.stringify(query.includeTerms || []),
      JSON.stringify(query.excludeTerms || []),
      query.resultCount || 0,
      query.nextPageToken || null,
      query.status,
      nowIso(),
      JSON.stringify(query.raw || {}),
      query.errorMessage || null
    );
    return Number(result.lastInsertRowid);
  }

  saveAssetLeads(runId, targetName, leads) {
    const insert = this.db.prepare(`
      INSERT INTO asset_leads (
        run_id, target_name, lead_type, value, source, confidence, match_terms_json,
        status, first_seen_at, last_seen_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name, lead_type, value, source) DO UPDATE SET
        run_id = excluded.run_id,
        confidence = excluded.confidence,
        match_terms_json = excluded.match_terms_json,
        last_seen_at = excluded.last_seen_at,
        metadata_json = excluded.metadata_json
    `);
    const timestamp = nowIso();
    let saved = 0;
    this.db.exec("BEGIN");
    try {
      for (const lead of leads) {
        insert.run(
          runId || null,
          targetName,
          lead.leadType || "domain",
          lead.value || lead.domain,
          lead.source,
          lead.confidence || "candidate",
          JSON.stringify(lead.matchTerms || []),
          lead.status || "new",
          timestamp,
          timestamp,
          JSON.stringify(lead.metadata || {})
        );
        saved += 1;
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return saved;
  }

  listAssetLeads({ targetName, limit = 1000 } = {}) {
    if (targetName) {
      return this.db.prepare(`
        SELECT * FROM asset_leads WHERE target_name = ? ORDER BY last_seen_at DESC, value LIMIT ?
      `).all(targetName, limit).map(hydrateAssetLead);
    }
    return this.db.prepare(`
      SELECT * FROM asset_leads ORDER BY last_seen_at DESC, value LIMIT ?
    `).all(limit).map(hydrateAssetLead);
  }

  listAssetDiscoveryQueries({ targetName, limit = 50 } = {}) {
    if (targetName) {
      return this.db.prepare(`
        SELECT * FROM asset_discovery_queries WHERE target_name = ? ORDER BY id DESC LIMIT ?
      `).all(targetName, limit).map(hydrateAssetDiscoveryQuery);
    }
    return this.db.prepare(`
      SELECT * FROM asset_discovery_queries ORDER BY id DESC LIMIT ?
    `).all(limit).map(hydrateAssetDiscoveryQuery);
  }

  searchAll({ query, targetName = null, limit = 200 } = {}) {
    const text = String(query || "").trim();
    if (!text) return [];
    const pattern = `%${text.toLowerCase()}%`;
    const targetFilter = targetName ? "AND target_name = ?" : "";
    const params = targetName ? [pattern, targetName, limit] : [pattern, limit];
    const allParams = targetName ? [pattern, pattern, pattern, targetName, limit] : [pattern, pattern, pattern, limit];

    const domains = this.db.prepare(`
      SELECT 'domain' AS result_type, target_name, run_id, domain AS value, source,
        kind AS detail, last_seen_at AS seen_at
      FROM recon_domains
      WHERE lower(domain) LIKE ? ${targetFilter}
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(...params);

    const services = this.db.prepare(`
      SELECT 'http_service' AS result_type, target_name, run_id, url AS value, source,
        COALESCE(title, webserver, technologies_json) AS detail, observed_at AS seen_at
      FROM recon_http_services
      WHERE (lower(url) LIKE ? OR lower(title) LIKE ? OR lower(technologies_json) LIKE ?) ${targetFilter}
      ORDER BY observed_at DESC
      LIMIT ?
    `).all(...allParams);

    const urls = this.db.prepare(`
      SELECT 'url' AS result_type, target_name, run_id, url AS value, source,
        COALESCE(path, query, params_json) AS detail, last_seen_at AS seen_at
      FROM recon_urls
      WHERE (lower(url) LIKE ? OR lower(path) LIKE ? OR lower(params_json) LIKE ?) ${targetFilter}
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(...allParams);

    const leads = this.db.prepare(`
      SELECT 'asset_lead' AS result_type, target_name, run_id, value, source,
        confidence AS detail, last_seen_at AS seen_at
      FROM asset_leads
      WHERE lower(value) LIKE ? ${targetFilter}
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(...params);

    return domains.concat(services, urls, leads)
      .sort((a, b) => String(b.seen_at || "").localeCompare(String(a.seen_at || "")))
      .slice(0, limit);
  }

  addApiKey({ provider, label, apiKey, status = "active", monthlyLimit = null, notes = null }) {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      INSERT INTO api_keys (
        provider, label, api_key, status, monthly_limit, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, label) DO UPDATE SET
        api_key = excluded.api_key,
        status = excluded.status,
        monthly_limit = excluded.monthly_limit,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(provider, label, apiKey, status, monthlyLimit, notes, timestamp, timestamp);
    return this.getApiKey(Number(result.lastInsertRowid)) || this.getApiKeyByLabel(provider, label);
  }

  getApiKey(id) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE id = ?").get(id);
    return row ? hydrateApiKey(row) : null;
  }

  getApiKeyByLabel(provider, label) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE provider = ? AND label = ?").get(provider, label);
    return row ? hydrateApiKey(row) : null;
  }

  listApiKeys({ provider = null, includeSecret = false } = {}) {
    const rows = provider
      ? this.db.prepare("SELECT * FROM api_keys WHERE provider = ? ORDER BY status, label").all(provider)
      : this.db.prepare("SELECT * FROM api_keys ORDER BY provider, status, label").all();
    return rows.map((row) => hydrateApiKey(row, includeSecret));
  }

  getAiSettings() {
    const row = this.db.prepare("SELECT value_json FROM ai_settings WHERE key = 'default'").get();
    return row ? JSON.parse(row.value_json || "{}") : defaultAiSettings();
  }

  saveAiSettings(settings) {
    const next = { ...defaultAiSettings(), ...(settings || {}) };
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO ai_settings (key, value_json, updated_at)
      VALUES ('default', ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value_json = excluded.value_json,
        updated_at = excluded.updated_at
    `).run(JSON.stringify(next), timestamp);
    return next;
  }

  getActiveApiKey(provider) {
    const row = this.db.prepare(`
      SELECT * FROM api_keys
      WHERE provider = ? AND status = 'active'
        AND (monthly_limit IS NULL OR used_count < monthly_limit)
      ORDER BY used_count ASC, last_used_at IS NULL DESC, last_used_at ASC, id ASC
      LIMIT 1
    `).get(provider);
    return row ? hydrateApiKey(row, true) : null;
  }

  markApiKeyUsed(id) {
    this.db.prepare(`
      UPDATE api_keys
      SET used_count = used_count + 1, last_used_at = ?, updated_at = ?
      WHERE id = ?
    `).run(nowIso(), nowIso(), id);
  }

  updateApiKeyStatus(id, status) {
    this.db.prepare("UPDATE api_keys SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
    return this.getApiKey(id);
  }

  deleteApiKey(id) {
    return this.db.prepare("DELETE FROM api_keys WHERE id = ?").run(id).changes;
  }

  ensureDefaultWebUser(user) {
    const existing = this.db.prepare("SELECT username FROM web_users LIMIT 1").get();
    if (existing) return this.getWebUser(user.username) || this.getWebUser(existing.username);
    return this.upsertWebUser(user);
  }

  upsertWebUser({ username, passwordHash, salt, iterations, status = "active" }) {
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO web_users (username, password_hash, salt, iterations, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        iterations = excluded.iterations,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(username, passwordHash, salt, iterations, status, timestamp, timestamp);
    return this.getWebUser(username);
  }

  getWebUser(username) {
    const row = this.db.prepare("SELECT * FROM web_users WHERE username = ?").get(username);
    return row ? hydrateWebUser(row) : null;
  }

  recordWebUserLogin(username) {
    this.db.prepare("UPDATE web_users SET last_login_at = ?, updated_at = ? WHERE username = ?")
      .run(nowIso(), nowIso(), username);
    return this.getWebUser(username);
  }

  addWordlist({ name, category, path: filePath, status = "active", notes = null }) {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      INSERT INTO wordlists (name, category, path, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        category = excluded.category,
        path = excluded.path,
        status = excluded.status,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(name, category, filePath, status, notes, timestamp, timestamp);
    return this.getWordlist(Number(result.lastInsertRowid)) || this.getWordlistByName(name);
  }

  getWordlist(id) {
    const row = this.db.prepare("SELECT * FROM wordlists WHERE id = ?").get(id);
    return row || null;
  }

  getWordlistByName(name) {
    const row = this.db.prepare("SELECT * FROM wordlists WHERE name = ?").get(name);
    return row || null;
  }

  getActiveWordlist(category) {
    const row = this.db.prepare(`
      SELECT * FROM wordlists
      WHERE category = ? AND status = 'active'
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).get(category);
    return row || null;
  }

  listWordlists({ category = null } = {}) {
    if (category) {
      return this.db.prepare("SELECT * FROM wordlists WHERE category = ? ORDER BY name").all(category);
    }
    return this.db.prepare("SELECT * FROM wordlists ORDER BY category, name").all();
  }

  recordToolResult(runId, result) {
    this.db.prepare(`
      INSERT INTO recon_tool_results (
        run_id, tool_name, command_display, status, exit_code, started_at,
        finished_at, stdout_path, stderr_path, error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      result.toolName,
      result.commandDisplay || null,
      result.status,
      result.exitCode ?? null,
      result.startedAt,
      result.finishedAt || null,
      result.stdoutPath || null,
      result.stderrPath || null,
      result.errorMessage || null
    );
  }

  listToolResults({ runId, limit = 200 } = {}) {
    return this.db.prepare(`
      SELECT * FROM recon_tool_results
      WHERE run_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(runId, limit).map(hydrateToolResult);
  }
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const unique = [];
  for (const item of items || []) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function hydrateTarget(row) {
  return {
    ...row,
    scope: JSON.parse(row.scope_json || "{}")
  };
}

function hydrateRun(row) {
  return {
    ...row,
    checkpoint: JSON.parse(row.checkpoint_json || "{}")
  };
}

function hydrateJob(row) {
  return {
    ...row,
    payload: JSON.parse(row.payload_json || "{}"),
    checkpoint: JSON.parse(row.checkpoint_json || "{}")
  };
}

function hydrateEvent(row) {
  return {
    ...row,
    payload: JSON.parse(row.payload_json || "{}")
  };
}

function hydrateDomain(row) {
  return {
    ...row,
    metadata: JSON.parse(row.metadata_json || "{}")
  };
}

function hydrateUrl(row) {
  return {
    ...row,
    params: JSON.parse(row.params_json || "[]"),
    metadata: JSON.parse(row.metadata_json || "{}")
  };
}

function hydrateHttpService(row) {
  return {
    ...row,
    statusCode: row.status_code,
    technologies: JSON.parse(row.technologies_json || "[]"),
    raw: JSON.parse(row.raw_json || "{}")
  };
}

function hydrateScreenshot(row) {
  return {
    ...row,
    metadata: JSON.parse(row.metadata_json || "{}")
  };
}

function hydrateToolResult(row) {
  return {
    ...row,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stdoutPath: row.stdout_path,
    stderrPath: row.stderr_path,
    errorMessage: row.error_message,
    commandDisplay: row.command_display,
    toolName: row.tool_name,
    exitCode: row.exit_code
  };
}

function hydrateAssetLead(row) {
  return {
    ...row,
    matchTerms: JSON.parse(row.match_terms_json || "[]"),
    metadata: JSON.parse(row.metadata_json || "{}")
  };
}

function hydrateAssetDiscoveryQuery(row) {
  return {
    ...row,
    includeTerms: JSON.parse(row.include_terms_json || "[]"),
    excludeTerms: JSON.parse(row.exclude_terms_json || "[]"),
    raw: JSON.parse(row.raw_json || "{}")
  };
}

function maskSecret(value) {
  const text = String(value || "");
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function defaultAiSettings() {
  return {
    provider: "opencode",
    planningModel: "qwen/qwen3-coder:free",
    executionModel: "qwen/qwen3-coder:free",
    localEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
    localModel: "llama3.1",
    autonomyLevel: 1
  };
}

function hydrateApiKey(row, includeSecret = false) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    status: row.status,
    monthly_limit: row.monthly_limit,
    used_count: row.used_count,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
    key_preview: maskSecret(row.api_key),
    ...(includeSecret ? { api_key: row.api_key } : {})
  };
}

function hydrateWebUser(row) {
  return {
    username: row.username,
    passwordHash: row.password_hash,
    salt: row.salt,
    iterations: row.iterations,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at
  };
}

module.exports = {
  ScanStore,
  initScanStore,
  openScanStore
};
