"use strict";

const { hydrate, nowIso, toJson, transaction } = require("./helpers");

// Each search source returns rows shaped { result_type, target_name, run_id, value, source, detail, seen_at }.
const SEARCH_SOURCES = [
  {
    sql: "SELECT 'domain' result_type, target_name, run_id, domain value, source, kind detail, last_seen_at seen_at FROM recon_domains WHERE lower(domain) LIKE ?",
    terms: 1,
    order: "last_seen_at"
  },
  {
    sql: "SELECT 'http_service' result_type, target_name, run_id, url value, source, COALESCE(title, webserver, technologies_json) detail, observed_at seen_at FROM recon_http_services WHERE (lower(url) LIKE ? OR lower(title) LIKE ? OR lower(technologies_json) LIKE ?)",
    terms: 3,
    order: "observed_at"
  },
  {
    sql: "SELECT 'url' result_type, target_name, run_id, url value, source, COALESCE(path, query, params_json) detail, last_seen_at seen_at FROM recon_urls WHERE (lower(url) LIKE ? OR lower(path) LIKE ? OR lower(params_json) LIKE ?)",
    terms: 3,
    order: "last_seen_at"
  },
  {
    sql: "SELECT 'asset_lead' result_type, target_name, run_id, value, source, confidence detail, last_seen_at seen_at FROM asset_leads WHERE lower(value) LIKE ?",
    terms: 1,
    order: "last_seen_at"
  }
];

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

module.exports = {
  recordAssetDiscoveryQuery(targetName, query) {
    const result = this.db.prepare(`INSERT INTO asset_discovery_queries (run_id, target_name, provider, query_type, mode, include_terms_json, exclude_terms_json,
        result_count, next_page_token, status, created_at, raw_json, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      query.runId || null, targetName, query.provider, query.queryType, query.mode, toJson(query.includeTerms || []),
      toJson(query.excludeTerms || []), query.resultCount || 0, query.nextPageToken || null, query.status, nowIso(),
      toJson(query.raw || {}), query.errorMessage || null
    );
    return Number(result.lastInsertRowid);
  },

  saveAssetLeads(runId, targetName, leads) {
    const t = nowIso();
    const statement = this.db.prepare(`INSERT INTO asset_leads (run_id, target_name, lead_type, value, source, confidence, match_terms_json, status,
        first_seen_at, last_seen_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_name, lead_type, value, source) DO UPDATE SET run_id=excluded.run_id, confidence=excluded.confidence,
        match_terms_json=excluded.match_terms_json, status=excluded.status, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json`);
    const rows = (leads || []).filter((lead) => lead && (lead.value || lead.domain));
    return transaction(this.db, () => {
      for (const lead of rows) {
        statement.run(runId || null, targetName, lead.leadType || "domain", lead.value || lead.domain, lead.source || "unknown",
          String(lead.confidence ?? "candidate"), toJson(lead.matchTerms || []), lead.status || "new", t, t, toJson(lead.metadata || {}));
      }
      return rows.length;
    });
  },

  listAssetLeads({ targetName, limit = 1000 } = {}) {
    const rows = targetName
      ? this.db.prepare("SELECT * FROM asset_leads WHERE target_name=? ORDER BY last_seen_at DESC, value LIMIT ?").all(targetName, limit)
      : this.db.prepare("SELECT * FROM asset_leads ORDER BY last_seen_at DESC, value LIMIT ?").all(limit);
    return rows.map(hydrate.assetLead);
  },

  // Case-insensitive substring search across observations; the newest sighting of each value wins.
  searchAll({ query, targetName = null, limit = 200 } = {}) {
    const term = String(query || "").toLowerCase().trim();
    if (!term) return [];
    const pattern = `%${escapeLike(term)}%`;
    const rows = [];
    for (const source of SEARCH_SOURCES) {
      const sql = `${source.sql.replaceAll("LIKE ?", "LIKE ? ESCAPE '\\'")} ${targetName ? "AND target_name=?" : ""} ORDER BY ${source.order} DESC LIMIT ?`;
      const params = [...Array(source.terms).fill(pattern), ...(targetName ? [targetName] : []), limit * 4];
      rows.push(...this.db.prepare(sql).all(...params));
    }
    const seen = new Set();
    return rows
      .sort((left, right) => String(right.seen_at || "").localeCompare(String(left.seen_at || "")))
      .filter((row) => {
        const key = `${row.result_type}|${row.target_name}|${String(row.value).toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit);
  }
};
