"use strict";

const { hydrate, nowIso, toJson, transaction } = require("./helpers");

const TARGET_SCOPED_TABLES = ["asset_discovery_queries", "asset_leads", "recon_screenshots", "recon_http_services", "recon_urls", "recon_domains", "recon_jobs"];
const RUN_SCOPED_TABLES = ["scan_events", "recon_tool_results"];

module.exports = {
  upsertTarget(configPath, config) {
    this.db.prepare(`INSERT INTO targets (target_name, asset_type, program_url, source_path, config_path, scope_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name) DO UPDATE SET asset_type=excluded.asset_type, program_url=excluded.program_url,
        source_path=excluded.source_path, config_path=excluded.config_path, scope_json=excluded.scope_json, updated_at=excluded.updated_at`)
      .run(config.target_name, config.asset_type || null, config.program_url || null, config.source_path || null, configPath, toJson(config.scope || {}), nowIso());
    return this.getTarget(config.target_name);
  },

  getTarget(name) {
    const row = this.db.prepare("SELECT * FROM targets WHERE target_name = ?").get(name);
    return row ? hydrate.target(row) : null;
  },

  listTargets() {
    return this.db.prepare("SELECT * FROM targets ORDER BY target_name").all().map(hydrate.target);
  },

  deleteTarget(name) {
    return transaction(this.db, () => {
      const runIds = this.db.prepare("SELECT id FROM scan_runs WHERE target_name = ?").all(name).map((row) => row.id);
      for (const table of RUN_SCOPED_TABLES) {
        this.db.prepare(`DELETE FROM ${table} WHERE run_id IN (SELECT id FROM scan_runs WHERE target_name = ?)`).run(name);
      }
      for (const table of [...TARGET_SCOPED_TABLES, "scan_runs", "targets"]) {
        this.db.prepare(`DELETE FROM ${table} WHERE target_name = ?`).run(name);
      }
      return { deleted: true, runIds };
    });
  },

  createRun({ targetName, runType = "recon", mode = "blackbox", providerProfile = "linux-local", checkpoint = {} }) {
    const result = this.db.prepare(`INSERT INTO scan_runs (target_name, run_type, status, mode, provider_profile, active_phase, started_at, checkpoint_json)
      VALUES (?, ?, 'queued', ?, ?, 'queued', ?, ?)`).run(targetName, runType, mode, providerProfile, nowIso(), toJson(checkpoint));
    return this.getRun(Number(result.lastInsertRowid));
  },

  updateRun(id, patch) {
    const current = this.getRun(id);
    if (!current) return null;
    this.db.prepare("UPDATE scan_runs SET status = ?, active_phase = ?, finished_at = ?, checkpoint_json = ?, error_message = ? WHERE id = ?").run(
      patch.status ?? current.status,
      patch.activePhase ?? current.active_phase,
      patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
      patch.checkpoint === undefined ? current.checkpoint_json : toJson(patch.checkpoint),
      patch.errorMessage === undefined ? current.error_message : patch.errorMessage,
      Number(id)
    );
    return this.getRun(id);
  },

  getRun(id) {
    const row = this.db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(Number(id));
    return row ? hydrate.run(row) : null;
  },

  // Accepts a numeric limit (legacy) or { limit, targetName }.
  listRuns(options = 50) {
    const { limit = 50, targetName = null } = typeof options === "number" ? { limit: options } : options || {};
    const rows = targetName
      ? this.db.prepare("SELECT * FROM scan_runs WHERE target_name = ? ORDER BY id DESC LIMIT ?").all(targetName, limit)
      : this.db.prepare("SELECT * FROM scan_runs ORDER BY id DESC LIMIT ?").all(limit);
    return rows.map(hydrate.run);
  },

  getLatestRunForTarget(name) {
    const row = this.db.prepare("SELECT * FROM scan_runs WHERE target_name = ? ORDER BY id DESC LIMIT 1").get(name);
    return row ? hydrate.run(row) : null;
  },

  // Only completed recon-like runs are comparable; a discovery run would make every domain look "added".
  getPreviousRunForTarget(name, before) {
    const row = this.db.prepare(`SELECT * FROM scan_runs WHERE target_name = ? AND id < ? AND status = 'completed'
      AND run_type IN ('recon','full-recon','target-bootstrap') ORDER BY id DESC LIMIT 1`).get(name, Number(before));
    return row ? hydrate.run(row) : null;
  },

  // Called once at server start: nothing can still be running in a fresh process.
  failInterruptedRuns() {
    return Number(this.db.prepare(`UPDATE scan_runs SET status='failed', active_phase='interrupted', finished_at=?, error_message='Server stopped during the run'
      WHERE status IN ('queued','running','paused')`).run(nowIso()).changes);
  },

  appendEvent(runId, { phase = null, severity = "info", source = null, message, payload = {} }) {
    const result = this.db.prepare("INSERT INTO scan_events (run_id, created_at, phase, severity, source, message, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(Number(runId), nowIso(), phase, severity, source, String(message ?? ""), toJson(payload));
    return hydrate.event(this.db.prepare("SELECT * FROM scan_events WHERE id = ?").get(Number(result.lastInsertRowid)));
  },

  listEvents(runId, afterId = 0, limit = 200) {
    return this.db.prepare("SELECT * FROM scan_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?")
      .all(Number(runId), Number(afterId) || 0, limit).map(hydrate.event);
  },

  // Last `limit` events (optionally only phases matching a LIKE pattern), returned in ascending order.
  listLatestEvents(runId, limit = 200, phaseLike = null) {
    const rows = phaseLike
      ? this.db.prepare("SELECT * FROM scan_events WHERE run_id = ? AND phase LIKE ? ORDER BY id DESC LIMIT ?").all(Number(runId), phaseLike, limit)
      : this.db.prepare("SELECT * FROM scan_events WHERE run_id = ? ORDER BY id DESC LIMIT ?").all(Number(runId), limit);
    return rows.reverse().map(hydrate.event);
  },

  createJob(job) {
    const t = nowIso();
    const result = this.db.prepare(`INSERT INTO recon_jobs (run_id, target_name, phase, type, tool_id, status, priority, payload_json, checkpoint_json,
        rate_limit_profile, timeout_ms, max_attempts, concurrency_group, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      job.runId, job.targetName, job.phase, job.type, job.toolId || null, job.priority || 100, toJson(job.payload || {}),
      toJson(job.checkpoint || {}), job.rateLimitProfile || null, job.timeoutMs || null, job.maxAttempts || 1, job.concurrencyGroup || null, t, t
    );
    return this.getJob(Number(result.lastInsertRowid));
  },

  getJob(id) {
    const row = this.db.prepare("SELECT * FROM recon_jobs WHERE id = ?").get(Number(id));
    return row ? hydrate.job(row) : null;
  },

  listJobs({ runId = null, status = null, limit = 200 } = {}) {
    const where = [];
    const params = [];
    if (runId !== null) { where.push("run_id = ?"); params.push(runId); }
    if (status !== null) { where.push("status = ?"); params.push(status); }
    const order = where.length ? "ORDER BY priority, id" : "ORDER BY id DESC";
    const sql = `SELECT * FROM recon_jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${order} LIMIT ?`;
    return this.db.prepare(sql).all(...params, limit).map(hydrate.job);
  },

  claimNextJob({ workerId, statuses = ["queued"], now = nowIso() }) {
    const placeholders = statuses.map(() => "?").join(",");
    return transaction(this.db, () => {
      const candidate = this.db.prepare(`SELECT id FROM recon_jobs WHERE status IN (${placeholders}) ORDER BY priority, id LIMIT 1`).get(...statuses);
      if (!candidate) return null;
      const result = this.db.prepare(`UPDATE recon_jobs SET status='running', locked_by=?, locked_at=?, started_at=COALESCE(started_at, ?), attempts=attempts+1, updated_at=?
        WHERE id=? AND status IN (${placeholders})`).run(workerId, now, now, now, candidate.id, ...statuses);
      return result.changes ? this.getJob(candidate.id) : null;
    });
  },

  updateJob(id, patch) {
    const current = this.getJob(id);
    if (!current) return null;
    this.db.prepare("UPDATE recon_jobs SET status=?, checkpoint_json=?, finished_at=?, error_message=?, updated_at=? WHERE id=?").run(
      patch.status ?? current.status,
      patch.checkpoint === undefined ? current.checkpoint_json : toJson(patch.checkpoint),
      patch.finishedAt === undefined ? current.finished_at : patch.finishedAt,
      patch.errorMessage === undefined ? current.error_message : patch.errorMessage,
      nowIso(),
      Number(id)
    );
    return this.getJob(id);
  }
};
