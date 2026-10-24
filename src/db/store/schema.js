"use strict";

const { nowIso, transaction } = require("./helpers");

// Observations are unique per run: a later run (or an HTTP follow-up) that sees the same domain must
// add its own row instead of moving the earlier run's row, otherwise older runs lose their results.
const OBSERVATION_TABLES = {
  recon_domains: `CREATE TABLE recon_domains (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, domain TEXT NOT NULL, root_domain TEXT, kind TEXT NOT NULL DEFAULT 'subdomain', source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovered', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(run_id, target_name, domain, source))`,
  recon_urls: `CREATE TABLE recon_urls (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, url TEXT NOT NULL, host TEXT, path TEXT, query TEXT, params_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(run_id, target_name, url, source))`,
  recon_http_services: `CREATE TABLE recon_http_services (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, url TEXT NOT NULL, host TEXT, scheme TEXT, port INTEGER, status_code INTEGER, title TEXT, webserver TEXT, technologies_json TEXT NOT NULL DEFAULT '[]', final_url TEXT, content_length INTEGER, source TEXT NOT NULL, observed_at TEXT NOT NULL, raw_json TEXT NOT NULL DEFAULT '{}', UNIQUE(run_id, target_name, url, source))`
};

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS targets (target_name TEXT PRIMARY KEY, asset_type TEXT, program_url TEXT, source_path TEXT, config_path TEXT NOT NULL, scope_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS scan_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, target_name TEXT NOT NULL, run_type TEXT NOT NULL DEFAULT 'recon', status TEXT NOT NULL, mode TEXT, provider_profile TEXT, active_phase TEXT, started_at TEXT NOT NULL, finished_at TEXT, checkpoint_json TEXT NOT NULL DEFAULT '{}', error_message TEXT);
  CREATE TABLE IF NOT EXISTS scan_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, created_at TEXT NOT NULL, phase TEXT, severity TEXT NOT NULL DEFAULT 'info', source TEXT, message TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS recon_tool_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, tool_name TEXT NOT NULL, command_display TEXT, status TEXT NOT NULL, exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT, stdout_path TEXT, stderr_path TEXT, error_message TEXT);
  CREATE TABLE IF NOT EXISTS recon_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, phase TEXT NOT NULL, type TEXT NOT NULL, tool_id TEXT, status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 100, payload_json TEXT NOT NULL DEFAULT '{}', checkpoint_json TEXT NOT NULL DEFAULT '{}', rate_limit_profile TEXT, timeout_ms INTEGER, max_attempts INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, concurrency_group TEXT, locked_by TEXT, locked_at TEXT, started_at TEXT, finished_at TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS recon_screenshots (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, tool_name TEXT NOT NULL, output_dir TEXT NOT NULL, report_path TEXT, captured_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
  CREATE TABLE IF NOT EXISTS asset_discovery_queries (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, target_name TEXT NOT NULL, provider TEXT NOT NULL, query_type TEXT NOT NULL, mode TEXT NOT NULL, include_terms_json TEXT NOT NULL DEFAULT '[]', exclude_terms_json TEXT NOT NULL DEFAULT '[]', result_count INTEGER NOT NULL DEFAULT 0, next_page_token TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, raw_json TEXT NOT NULL DEFAULT '{}', error_message TEXT);
  CREATE TABLE IF NOT EXISTS asset_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, target_name TEXT NOT NULL, lead_type TEXT NOT NULL DEFAULT 'domain', value TEXT NOT NULL, source TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'candidate', match_terms_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(target_name, lead_type, value, source));
  CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, label TEXT NOT NULL, api_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', monthly_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT, UNIQUE(provider, label));
  CREATE TABLE IF NOT EXISTS web_users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT);
  CREATE TABLE IF NOT EXISTS web_sessions (session_hash TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wordlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`;

const INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_scan_runs_target ON scan_runs(target_name, id);
  CREATE INDEX IF NOT EXISTS idx_scan_events_run_id ON scan_events(run_id, id);
  CREATE INDEX IF NOT EXISTS idx_recon_tool_results_run ON recon_tool_results(run_id, id);
  CREATE INDEX IF NOT EXISTS idx_recon_domains_run ON recon_domains(run_id, domain);
  CREATE INDEX IF NOT EXISTS idx_recon_domains_target ON recon_domains(target_name, domain);
  CREATE INDEX IF NOT EXISTS idx_recon_urls_run ON recon_urls(run_id, host);
  CREATE INDEX IF NOT EXISTS idx_recon_http_services_run ON recon_http_services(run_id, host);
  CREATE INDEX IF NOT EXISTS idx_recon_screenshots_run ON recon_screenshots(run_id, id);
  CREATE INDEX IF NOT EXISTS idx_asset_leads_target ON asset_leads(target_name, value);
  CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider, status);
  CREATE INDEX IF NOT EXISTS idx_wordlists_category ON wordlists(category, status);
  CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
`;

function tableSql(db, table) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || null;
}

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
}

// Rebuilds legacy observation tables whose unique key did not include run_id.
function migrateObservationTables(db) {
  for (const [table, createSql] of Object.entries(OBSERVATION_TABLES)) {
    const existing = tableSql(db, table);
    if (!existing) {
      db.exec(createSql);
      continue;
    }
    if (/UNIQUE\s*\(\s*run_id/i.test(existing)) continue;
    transaction(db, () => {
      const legacy = `${table}_legacy_${Date.now()}`;
      db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
      db.exec(createSql);
      const columns = columnsOf(db, legacy).filter((column) => columnsOf(db, table).includes(column)).join(", ");
      db.exec(`INSERT OR IGNORE INTO ${table} (${columns}) SELECT ${columns} FROM ${legacy}`);
      db.exec(`DROP TABLE ${legacy}`);
    });
  }
}

function initScanStore(db) {
  db.exec(BASE_SCHEMA);
  migrateObservationTables(db);
  db.exec(INDEXES);
  db.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").run(nowIso());
}

module.exports = {
  initScanStore
};
