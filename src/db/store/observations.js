"use strict";

const { hydrate, nowIso, parseJson, toJson, transaction, uniqueBy } = require("./helpers");

const DOMAIN_COLUMNS = "MIN(id) id, MAX(run_id) run_id, target_name, MIN(domain) domain, COALESCE(MAX(root_domain),'') root_domain, COALESCE(MAX(kind),'subdomain') kind, group_concat(DISTINCT source) source, COALESCE(MAX(status),'discovered') status, MIN(first_seen_at) first_seen_at, MAX(last_seen_at) last_seen_at, '{}' metadata_json";
const URL_COLUMNS = "MIN(id) id, MAX(run_id) run_id, target_name, MIN(url) url, COALESCE(MAX(host),'') host, COALESCE(MAX(path),'') path, COALESCE(MAX(query),'') query, COALESCE(MAX(params_json),'[]') params_json, group_concat(DISTINCT source) source, MIN(first_seen_at) first_seen_at, MAX(last_seen_at) last_seen_at, '{}' metadata_json";
// Whole newest row per URL (never columns mixed from different rows); technologies and sources are merged in JS.
const SERVICE_COLUMNS = "id, run_id, target_name, url, COALESCE(host,'') host, COALESCE(scheme,'') scheme, port, status_code, COALESCE(title,'') title, COALESCE(webserver,'') webserver, technologies_json, COALESCE(final_url,'') final_url, content_length, source, observed_at, '{}' raw_json";

function countDistinct(db, table, column, runId) {
  return db.prepare(`SELECT COUNT(*) count FROM (SELECT 1 FROM ${table} WHERE run_id=? GROUP BY lower(${column}))`).get(Number(runId)).count;
}

function countRows(db, table, runId) {
  return db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE run_id=?`).get(Number(runId)).count;
}

function summarizeTechnologies(rows) {
  const byName = new Map();
  for (const row of rows) {
    for (const name of parseJson(row.technologies_json, [])) {
      const label = String(name || "").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      const entry = byName.get(key) || { name: label, count: 0, hosts: new Set(), urls: [], urlKeys: new Set(), sources: new Set(), lastSeenAt: null };
      // Count distinct services (URLs), not detector rows.
      if (row.url) entry.urlKeys.add(String(row.url).toLowerCase());
      entry.count = row.url ? entry.urlKeys.size : entry.count + 1;
      if (row.host) entry.hosts.add(row.host);
      if (row.url && entry.urls.length < 12 && !entry.urls.includes(row.url)) entry.urls.push(row.url);
      if (row.source) entry.sources.add(row.source);
      if (row.observed_at && (!entry.lastSeenAt || row.observed_at > entry.lastSeenAt)) entry.lastSeenAt = row.observed_at;
      byName.set(key, entry);
    }
  }
  return [...byName.values()]
    .map((entry) => ({
      name: entry.name,
      count: entry.count,
      hostCount: entry.hosts.size,
      sampleUrls: entry.urls,
      source: [...entry.sources].sort().join(","),
      lastSeenAt: entry.lastSeenAt
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

module.exports = {
  saveDomains(runId, targetName, domains) {
    const t = nowIso();
    const statement = this.db.prepare(`INSERT INTO recon_domains (run_id, target_name, domain, root_domain, kind, source, status, first_seen_at, last_seen_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, target_name, domain, source) DO UPDATE SET root_domain=excluded.root_domain, kind=excluded.kind,
        status=excluded.status, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json`);
    const rows = uniqueBy(domains, (item) => item?.domain && `${String(item.domain).toLowerCase()}|${item.source || ""}`);
    return transaction(this.db, () => {
      for (const item of rows) {
        statement.run(runId, targetName, item.domain, item.rootDomain || null, item.kind || "subdomain", item.source || "unknown",
          item.status || "discovered", t, t, toJson(item.metadata || {}));
      }
      return rows.length;
    });
  },

  listDomains({ runId = null, targetName = null, limit = 1000 } = {}) {
    if (runId !== null) {
      return this.db.prepare(`SELECT ${DOMAIN_COLUMNS} FROM recon_domains WHERE run_id=? GROUP BY target_name, lower(domain) ORDER BY domain LIMIT ?`)
        .all(Number(runId), limit).map(hydrate.domain);
    }
    if (targetName !== null) {
      return this.db.prepare(`SELECT ${DOMAIN_COLUMNS} FROM recon_domains WHERE target_name=? GROUP BY target_name, lower(domain) ORDER BY domain LIMIT ?`)
        .all(targetName, limit).map(hydrate.domain);
    }
    return this.db.prepare(`SELECT ${DOMAIN_COLUMNS} FROM recon_domains GROUP BY target_name, lower(domain) ORDER BY last_seen_at DESC LIMIT ?`)
      .all(limit).map(hydrate.domain);
  },

  saveUrls(runId, targetName, urls, source = "gau") {
    const t = nowIso();
    const statement = this.db.prepare(`INSERT INTO recon_urls (run_id, target_name, url, host, path, query, params_json, source, first_seen_at, last_seen_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, target_name, url, source) DO UPDATE SET host=excluded.host, path=excluded.path, query=excluded.query,
        params_json=excluded.params_json, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json`);
    const rows = uniqueBy(urls, (item) => item?.url && String(item.url).toLowerCase());
    return transaction(this.db, () => {
      for (const item of rows) {
        statement.run(runId, targetName, item.url, item.host || null, item.path || null, item.query || null, toJson(item.params || []),
          source, t, t, toJson(item.metadata || {}));
      }
      return rows.length;
    });
  },

  listUrls({ runId, limit = 1000 }) {
    return this.db.prepare(`SELECT ${URL_COLUMNS} FROM recon_urls WHERE run_id=? GROUP BY target_name, lower(url) ORDER BY host, path LIMIT ?`)
      .all(Number(runId), limit).map(hydrate.url);
  },

  saveHttpServices(runId, targetName, services, source = "httpx") {
    const t = nowIso();
    const statement = this.db.prepare(`INSERT INTO recon_http_services (run_id, target_name, url, host, scheme, port, status_code, title, webserver,
        technologies_json, final_url, content_length, source, observed_at, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, target_name, url, source) DO UPDATE SET host=excluded.host, scheme=excluded.scheme, port=excluded.port,
        status_code=excluded.status_code, title=excluded.title, webserver=excluded.webserver, technologies_json=excluded.technologies_json,
        final_url=excluded.final_url, content_length=excluded.content_length, observed_at=excluded.observed_at, raw_json=excluded.raw_json`);
    const rows = uniqueBy(services, (item) => item?.url && String(item.url).toLowerCase());
    return transaction(this.db, () => {
      for (const item of rows) {
        statement.run(runId, targetName, item.url, item.host || null, item.scheme || null, item.port || null,
          item.statusCode ?? item.status_code ?? null, item.title || null, item.webserver || null, toJson(item.technologies || []),
          item.finalUrl || item.final_url || null, item.contentLength ?? item.content_length ?? null, source, t, toJson(item.raw || {}));
      }
      return rows.length;
    });
  },

  listHttpServices({ runId, limit = 1000 }) {
    const id = Number(runId);
    const rows = this.db.prepare(`SELECT ${SERVICE_COLUMNS} FROM recon_http_services WHERE run_id=? AND id IN (SELECT MAX(id) FROM recon_http_services WHERE run_id=? GROUP BY target_name, lower(url)) ORDER BY host, port LIMIT ?`)
      .all(id, id, limit);
    if (!rows.length) return [];
    const merged = new Map();
    for (const row of this.db.prepare("SELECT target_name, url, technologies_json, source FROM recon_http_services WHERE run_id=? ORDER BY id").all(id)) {
      const key = `${row.target_name}|${String(row.url).toLowerCase()}`;
      const entry = merged.get(key) || { techs: new Map(), sources: new Set() };
      for (const name of parseJson(row.technologies_json, [])) {
        const label = String(name || "").trim();
        if (label && !entry.techs.has(label.toLowerCase())) entry.techs.set(label.toLowerCase(), label);
      }
      if (row.source) entry.sources.add(row.source);
      merged.set(key, entry);
    }
    return rows.map((row) => {
      const entry = merged.get(`${row.target_name}|${String(row.url).toLowerCase()}`);
      return hydrate.httpService({ ...row, technologies_json: toJson([...entry.techs.values()]), source: [...entry.sources].join(",") });
    });
  },

  listTechnologySummary({ runId, limit = 100 } = {}) {
    const rows = this.db.prepare("SELECT url, host, technologies_json, source, observed_at FROM recon_http_services WHERE run_id=? ORDER BY observed_at DESC").all(Number(runId));
    return summarizeTechnologies(rows).slice(0, limit);
  },

  getRunObservationCounts(runId) {
    const technologyRows = this.db.prepare("SELECT technologies_json FROM recon_http_services WHERE run_id=?").all(Number(runId));
    return {
      domains: countDistinct(this.db, "recon_domains", "domain", runId),
      urls: countDistinct(this.db, "recon_urls", "url", runId),
      httpServices: countDistinct(this.db, "recon_http_services", "url", runId),
      technologies: summarizeTechnologies(technologyRows).length,
      screenshots: countRows(this.db, "recon_screenshots", runId),
      events: countRows(this.db, "scan_events", runId),
      toolResults: countRows(this.db, "recon_tool_results", runId)
    };
  },

  saveScreenshotRun(runId, targetName, shot) {
    this.db.prepare("INSERT INTO recon_screenshots (run_id, target_name, tool_name, output_dir, report_path, captured_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(runId, targetName, shot.toolName, shot.outputDir, shot.reportPath || null, nowIso(), toJson(shot.metadata || {}));
  },

  listScreenshots({ runId }) {
    return this.db.prepare("SELECT * FROM recon_screenshots WHERE run_id=? ORDER BY id DESC").all(Number(runId)).map(hydrate.screenshot);
  },

  getScreenshot(id) {
    const row = this.db.prepare("SELECT * FROM recon_screenshots WHERE id=?").get(Number(id));
    return row ? hydrate.screenshot(row) : null;
  },

  recordToolResult(runId, result) {
    this.db.prepare(`INSERT INTO recon_tool_results (run_id, tool_name, command_display, status, exit_code, started_at, finished_at, stdout_path, stderr_path, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(runId, result.toolName, result.commandDisplay || null, result.status, result.exitCode ?? null,
      result.startedAt || nowIso(), result.finishedAt || null, result.stdoutPath || null, result.stderrPath || null, result.errorMessage || null);
  },

  listToolResults({ runId, limit = 200 } = {}) {
    return this.db.prepare("SELECT * FROM recon_tool_results WHERE run_id=? ORDER BY id DESC LIMIT ?").all(Number(runId), limit).map(hydrate.toolResult);
  },

  getToolResult(id) {
    const row = this.db.prepare("SELECT * FROM recon_tool_results WHERE id=?").get(Number(id));
    return row ? hydrate.toolResult(row) : null;
  }
};
