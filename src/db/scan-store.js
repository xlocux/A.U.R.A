"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function nowIso() { return new Date().toISOString(); }
function j(value, fallback) { try { return JSON.parse(value ?? JSON.stringify(fallback)); } catch { return fallback; } }
function s(value) { return JSON.stringify(value ?? {}); }
function mask(value) { const text = String(value || ""); return text.length <= 8 ? "*".repeat(text.length) : `${text.slice(0, 4)}...${text.slice(-4)}`; }
function uniqueBy(items, fn) { const seen = new Set(); const out = []; for (const item of items || []) { const key = fn(item); if (!key || seen.has(key)) continue; seen.add(key); out.push(item); } return out; }

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
    CREATE TABLE IF NOT EXISTS targets (target_name TEXT PRIMARY KEY, asset_type TEXT, program_url TEXT, source_path TEXT, config_path TEXT NOT NULL, scope_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS scan_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, target_name TEXT NOT NULL, run_type TEXT NOT NULL DEFAULT 'recon', status TEXT NOT NULL, mode TEXT, provider_profile TEXT, active_phase TEXT, started_at TEXT NOT NULL, finished_at TEXT, checkpoint_json TEXT NOT NULL DEFAULT '{}', error_message TEXT);
    CREATE TABLE IF NOT EXISTS scan_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, created_at TEXT NOT NULL, phase TEXT, severity TEXT NOT NULL DEFAULT 'info', source TEXT, message TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS recon_domains (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, domain TEXT NOT NULL, root_domain TEXT, kind TEXT NOT NULL DEFAULT 'subdomain', source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovered', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(target_name, domain, source));
    CREATE TABLE IF NOT EXISTS recon_tool_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, tool_name TEXT NOT NULL, command_display TEXT, status TEXT NOT NULL, exit_code INTEGER, started_at TEXT NOT NULL, finished_at TEXT, stdout_path TEXT, stderr_path TEXT, error_message TEXT);
    CREATE TABLE IF NOT EXISTS recon_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, phase TEXT NOT NULL, type TEXT NOT NULL, tool_id TEXT, status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 100, payload_json TEXT NOT NULL DEFAULT '{}', checkpoint_json TEXT NOT NULL DEFAULT '{}', rate_limit_profile TEXT, timeout_ms INTEGER, max_attempts INTEGER NOT NULL DEFAULT 1, attempts INTEGER NOT NULL DEFAULT 0, concurrency_group TEXT, locked_by TEXT, locked_at TEXT, started_at TEXT, finished_at TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recon_urls (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, url TEXT NOT NULL, host TEXT, path TEXT, query TEXT, params_json TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(target_name, url, source));
    CREATE TABLE IF NOT EXISTS recon_http_services (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, url TEXT NOT NULL, host TEXT, scheme TEXT, port INTEGER, status_code INTEGER, title TEXT, webserver TEXT, technologies_json TEXT NOT NULL DEFAULT '[]', final_url TEXT, content_length INTEGER, source TEXT NOT NULL, observed_at TEXT NOT NULL, raw_json TEXT NOT NULL DEFAULT '{}', UNIQUE(target_name, url, source));
    CREATE TABLE IF NOT EXISTS recon_screenshots (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL, target_name TEXT NOT NULL, tool_name TEXT NOT NULL, output_dir TEXT NOT NULL, report_path TEXT, captured_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS asset_discovery_queries (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, target_name TEXT NOT NULL, provider TEXT NOT NULL, query_type TEXT NOT NULL, mode TEXT NOT NULL, include_terms_json TEXT NOT NULL DEFAULT '[]', exclude_terms_json TEXT NOT NULL DEFAULT '[]', result_count INTEGER NOT NULL DEFAULT 0, next_page_token TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, raw_json TEXT NOT NULL DEFAULT '{}', error_message TEXT);
    CREATE TABLE IF NOT EXISTS asset_leads (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, target_name TEXT NOT NULL, lead_type TEXT NOT NULL DEFAULT 'domain', value TEXT NOT NULL, source TEXT NOT NULL, confidence TEXT NOT NULL DEFAULT 'candidate', match_terms_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(target_name, lead_type, value, source));
    CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL, label TEXT NOT NULL, api_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', monthly_limit INTEGER, used_count INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_used_at TEXT, UNIQUE(provider, label));
    CREATE TABLE IF NOT EXISTS web_users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, salt TEXT NOT NULL, iterations INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login_at TEXT);
    CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS wordlists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, category TEXT NOT NULL, path TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_scan_events_run_id ON scan_events(run_id, id);
    CREATE INDEX IF NOT EXISTS idx_recon_domains_run ON recon_domains(run_id, domain);
    CREATE INDEX IF NOT EXISTS idx_recon_urls_run ON recon_urls(run_id, host);
    CREATE INDEX IF NOT EXISTS idx_recon_http_services_run ON recon_http_services(run_id, host);
    CREATE INDEX IF NOT EXISTS idx_asset_leads_target ON asset_leads(target_name, value);
    CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider, status);
    CREATE INDEX IF NOT EXISTS idx_wordlists_category ON wordlists(category, status);
  `);
}

class ScanStore {
  constructor(db) { this.db = db; }
  close() { this.db.close(); }

  upsertTarget(configPath, config) {
    const t = nowIso();
    this.db.prepare("INSERT INTO targets (target_name, asset_type, program_url, source_path, config_path, scope_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(target_name) DO UPDATE SET asset_type=excluded.asset_type, program_url=excluded.program_url, source_path=excluded.source_path, config_path=excluded.config_path, scope_json=excluded.scope_json, updated_at=excluded.updated_at")
      .run(config.target_name, config.asset_type || null, config.program_url || null, config.source_path || null, configPath, s(config.scope || {}), t);
    return this.getTarget(config.target_name);
  }
  getTarget(name) { const r = this.db.prepare("SELECT * FROM targets WHERE target_name = ?").get(name); return r ? hydrateTarget(r) : null; }
  listTargets() { return this.db.prepare("SELECT * FROM targets ORDER BY target_name").all().map(hydrateTarget); }
  deleteTarget(name) {
    const runIds = this.db.prepare("SELECT id FROM scan_runs WHERE target_name = ?").all(name).map((r) => r.id);
    for (const table of ["asset_discovery_queries", "asset_leads", "recon_screenshots", "recon_http_services", "recon_urls", "recon_domains", "recon_jobs", "scan_runs", "targets"]) this.db.prepare(`DELETE FROM ${table} WHERE target_name = ?`).run(name);
    return { deleted: true, runIds };
  }

  createRun({ targetName, runType = "recon", mode = "blackbox", providerProfile = "wsl-kali", checkpoint = {} }) {
    const res = this.db.prepare("INSERT INTO scan_runs (target_name, run_type, status, mode, provider_profile, active_phase, started_at, checkpoint_json) VALUES (?, ?, 'queued', ?, ?, 'queued', ?, ?)").run(targetName, runType, mode, providerProfile, nowIso(), s(checkpoint));
    return this.getRun(Number(res.lastInsertRowid));
  }
  updateRun(id, patch) {
    const cur = this.getRun(id); if (!cur) return null;
    this.db.prepare("UPDATE scan_runs SET status = ?, active_phase = ?, finished_at = ?, checkpoint_json = ?, error_message = ? WHERE id = ?")
      .run(patch.status ?? cur.status, patch.activePhase ?? cur.active_phase, patch.finishedAt === undefined ? cur.finished_at : patch.finishedAt, patch.checkpoint === undefined ? cur.checkpoint_json : s(patch.checkpoint), patch.errorMessage === undefined ? cur.error_message : patch.errorMessage, id);
    return this.getRun(id);
  }
  getRun(id) { const r = this.db.prepare("SELECT * FROM scan_runs WHERE id = ?").get(Number(id)); return r ? hydrateRun(r) : null; }
  listRuns(limit = 50) { return this.db.prepare("SELECT * FROM scan_runs ORDER BY id DESC LIMIT ?").all(limit).map(hydrateRun); }
  getLatestRunForTarget(name) { const r = this.db.prepare("SELECT * FROM scan_runs WHERE target_name = ? ORDER BY id DESC LIMIT 1").get(name); return r ? hydrateRun(r) : null; }
  getPreviousRunForTarget(name, before) { const r = this.db.prepare("SELECT * FROM scan_runs WHERE target_name = ? AND id < ? ORDER BY id DESC LIMIT 1").get(name, before); return r ? hydrateRun(r) : null; }

  appendEvent(runId, { phase = null, severity = "info", source = null, message, payload = {} }) {
    const res = this.db.prepare("INSERT INTO scan_events (run_id, created_at, phase, severity, source, message, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)").run(runId, nowIso(), phase, severity, source, message, s(payload));
    return hydrateEvent(this.db.prepare("SELECT * FROM scan_events WHERE id = ?").get(Number(res.lastInsertRowid)));
  }
  listEvents(runId, afterId = 0, limit = 200) { return this.db.prepare("SELECT * FROM scan_events WHERE run_id = ? AND id > ? ORDER BY id ASC LIMIT ?").all(runId, afterId, limit).map(hydrateEvent); }

  createJob(job) {
    const t = nowIso();
    const res = this.db.prepare("INSERT INTO recon_jobs (run_id,target_name,phase,type,tool_id,status,priority,payload_json,checkpoint_json,rate_limit_profile,timeout_ms,max_attempts,concurrency_group,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?,?,?,?,?,?,?,?)")
      .run(job.runId, job.targetName, job.phase, job.type, job.toolId || null, job.priority || 100, s(job.payload || {}), s(job.checkpoint || {}), job.rateLimitProfile || null, job.timeoutMs || null, job.maxAttempts || 1, job.concurrencyGroup || null, t, t);
    return this.getJob(Number(res.lastInsertRowid));
  }
  getJob(id) { const r = this.db.prepare("SELECT * FROM recon_jobs WHERE id = ?").get(Number(id)); return r ? hydrateJob(r) : null; }
  listJobs({ runId = null, status = null, limit = 200 } = {}) {
    if (runId !== null && status !== null) return this.db.prepare("SELECT * FROM recon_jobs WHERE run_id=? AND status=? ORDER BY priority,id LIMIT ?").all(runId, status, limit).map(hydrateJob);
    if (runId !== null) return this.db.prepare("SELECT * FROM recon_jobs WHERE run_id=? ORDER BY priority,id LIMIT ?").all(runId, limit).map(hydrateJob);
    if (status !== null) return this.db.prepare("SELECT * FROM recon_jobs WHERE status=? ORDER BY priority,id LIMIT ?").all(status, limit).map(hydrateJob);
    return this.db.prepare("SELECT * FROM recon_jobs ORDER BY id DESC LIMIT ?").all(limit).map(hydrateJob);
  }
  claimNextJob({ workerId, statuses = ["queued"], now = nowIso() }) {
    const ph = statuses.map(() => "?").join(",");
    const c = this.db.prepare(`SELECT id FROM recon_jobs WHERE status IN (${ph}) ORDER BY priority,id LIMIT 1`).get(...statuses);
    if (!c) return null;
    const res = this.db.prepare(`UPDATE recon_jobs SET status='running', locked_by=?, locked_at=?, started_at=COALESCE(started_at,?), attempts=attempts+1, updated_at=? WHERE id=? AND status IN (${ph})`).run(workerId, now, now, now, c.id, ...statuses);
    return res.changes ? this.getJob(c.id) : null;
  }
  updateJob(id, patch) {
    const cur = this.getJob(id); if (!cur) return null;
    this.db.prepare("UPDATE recon_jobs SET status=?, checkpoint_json=?, finished_at=?, error_message=?, updated_at=? WHERE id=?")
      .run(patch.status ?? cur.status, patch.checkpoint === undefined ? cur.checkpoint_json : s(patch.checkpoint), patch.finishedAt === undefined ? cur.finished_at : patch.finishedAt, patch.errorMessage === undefined ? cur.error_message : patch.errorMessage, nowIso(), id);
    return this.getJob(id);
  }

  saveDomains(runId, targetName, domains) {
    const t = nowIso(); const st = this.db.prepare("INSERT INTO recon_domains (run_id,target_name,domain,root_domain,kind,source,status,first_seen_at,last_seen_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(target_name,domain,source) DO UPDATE SET run_id=excluded.run_id, root_domain=excluded.root_domain, kind=excluded.kind, status=excluded.status, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json"); let n = 0;
    for (const item of uniqueBy(domains, (d) => `${String(d.domain || "").toLowerCase()}|${d.source || ""}`)) { st.run(runId, targetName, item.domain, item.rootDomain || null, item.kind || "subdomain", item.source || "unknown", item.status || "discovered", t, t, s(item.metadata || {})); n++; }
    return n;
  }
  listDomains({ runId = null, targetName = null, limit = 1000 } = {}) {
    const select = "MIN(id) id, MAX(run_id) run_id, target_name, MIN(domain) domain, COALESCE(MAX(root_domain),'') root_domain, COALESCE(MAX(kind),'subdomain') kind, group_concat(DISTINCT source) source, COALESCE(MAX(status),'discovered') status, MIN(first_seen_at) first_seen_at, MAX(last_seen_at) last_seen_at, '{}' metadata_json";
    if (runId !== null) return this.db.prepare(`SELECT ${select} FROM recon_domains WHERE run_id=? GROUP BY target_name, lower(domain) ORDER BY domain LIMIT ?`).all(runId, limit).map(hydrateDomain);
    if (targetName !== null) return this.db.prepare(`SELECT ${select} FROM recon_domains WHERE target_name=? GROUP BY target_name, lower(domain) ORDER BY domain LIMIT ?`).all(targetName, limit).map(hydrateDomain);
    return this.db.prepare(`SELECT ${select} FROM recon_domains GROUP BY target_name, lower(domain) ORDER BY last_seen_at DESC LIMIT ?`).all(limit).map(hydrateDomain);
  }
  getRunObservationCounts(runId) { return { domains: countDistinct(this.db,"recon_domains","domain",runId), urls: countDistinct(this.db,"recon_urls","url",runId), httpServices: countDistinct(this.db,"recon_http_services","url",runId), technologies: this.listTechnologySummary({ runId, limit: 100000 }).length, screenshots: countRows(this.db,"recon_screenshots",runId), events: countRows(this.db,"scan_events",runId), toolResults: countRows(this.db,"recon_tool_results",runId) }; }

  saveUrls(runId, targetName, urls, source = "gau") { const t = nowIso(); const st = this.db.prepare("INSERT INTO recon_urls (run_id,target_name,url,host,path,query,params_json,source,first_seen_at,last_seen_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(target_name,url,source) DO UPDATE SET run_id=excluded.run_id, host=excluded.host, path=excluded.path, query=excluded.query, params_json=excluded.params_json, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json"); let n=0; for (const item of uniqueBy(urls, (u)=>`${String(u.url||"").toLowerCase()}|${source}`)) { st.run(runId,targetName,item.url,item.host||null,item.path||null,item.query||null,s(item.params||[]),source,t,t,s(item.metadata||{})); n++; } return n; }
  listUrls({ runId, limit = 1000 }) { return this.db.prepare("SELECT MIN(id) id, MAX(run_id) run_id, target_name, MIN(url) url, COALESCE(MAX(host),'') host, COALESCE(MAX(path),'') path, COALESCE(MAX(query),'') query, COALESCE(MAX(params_json),'[]') params_json, group_concat(DISTINCT source) source, MIN(first_seen_at) first_seen_at, MAX(last_seen_at) last_seen_at, '{}' metadata_json FROM recon_urls WHERE run_id=? GROUP BY target_name, lower(url) ORDER BY host,path LIMIT ?").all(runId, limit).map(hydrateUrl); }
  saveHttpServices(runId, targetName, services, source = "httpx") { const t=nowIso(); const st=this.db.prepare("INSERT INTO recon_http_services (run_id,target_name,url,host,scheme,port,status_code,title,webserver,technologies_json,final_url,content_length,source,observed_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(target_name,url,source) DO UPDATE SET run_id=excluded.run_id, host=excluded.host, scheme=excluded.scheme, port=excluded.port, status_code=excluded.status_code, title=excluded.title, webserver=excluded.webserver, technologies_json=excluded.technologies_json, final_url=excluded.final_url, content_length=excluded.content_length, observed_at=excluded.observed_at, raw_json=excluded.raw_json"); let n=0; for (const item of uniqueBy(services,(x)=>`${String(x.url||"").toLowerCase()}|${source}`)) { st.run(runId,targetName,item.url,item.host||null,item.scheme||null,item.port||null,item.statusCode??item.status_code??null,item.title||null,item.webserver||null,s(item.technologies||[]),item.finalUrl||item.final_url||null,item.contentLength??item.content_length??null,source,t,s(item.raw||{})); n++; } return n; }
  listHttpServices({ runId, limit = 1000 }) { return this.db.prepare("SELECT MIN(id) id, MAX(run_id) run_id, target_name, MIN(url) url, COALESCE(MAX(host),'') host, COALESCE(MAX(scheme),'') scheme, MAX(port) port, MAX(status_code) status_code, COALESCE(MAX(title),'') title, COALESCE(MAX(webserver),'') webserver, COALESCE(MAX(technologies_json),'[]') technologies_json, COALESCE(MAX(final_url),'') final_url, MAX(content_length) content_length, group_concat(DISTINCT source) source, MAX(observed_at) observed_at, '{}' raw_json FROM recon_http_services WHERE run_id=? GROUP BY target_name, lower(url) ORDER BY host,port LIMIT ?").all(runId, limit).map(hydrateHttpService); }
  listTechnologySummary({ runId, limit = 100 } = {}) { const rows=this.db.prepare("SELECT url,host,technologies_json,source,observed_at FROM recon_http_services WHERE run_id=? ORDER BY observed_at DESC").all(runId); const m=new Map(); for (const r of rows) for (const name of j(r.technologies_json, [])) { const k=String(name||"").trim(); if(!k) continue; const id=k.toLowerCase(); const c=m.get(id)||{name:k,count:0,hosts:new Set(),urls:[],sources:new Set(),lastSeenAt:r.observed_at}; c.count++; if(r.host)c.hosts.add(r.host); if(r.url&&c.urls.length<12)c.urls.push(r.url); if(r.source)c.sources.add(r.source); c.lastSeenAt=[c.lastSeenAt,r.observed_at].filter(Boolean).sort().at(-1)||null; m.set(id,c); } return [...m.values()].map((x)=>({name:x.name,count:x.count,hostCount:x.hosts.size,sampleUrls:x.urls,source:[...x.sources].sort().join(","),lastSeenAt:x.lastSeenAt})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name)).slice(0,limit); }

  saveScreenshotRun(runId, targetName, shot) { this.db.prepare("INSERT INTO recon_screenshots (run_id,target_name,tool_name,output_dir,report_path,captured_at,metadata_json) VALUES (?,?,?,?,?,?,?)").run(runId,targetName,shot.toolName,shot.outputDir,shot.reportPath||null,nowIso(),s(shot.metadata||{})); }
  listScreenshots({ runId }) { return this.db.prepare("SELECT * FROM recon_screenshots WHERE run_id=? ORDER BY id DESC").all(runId).map(hydrateScreenshot); }
  getScreenshot(id) { const r=this.db.prepare("SELECT * FROM recon_screenshots WHERE id=?").get(Number(id)); return r?hydrateScreenshot(r):null; }

  recordAssetDiscoveryQuery(targetName, q) { const r=this.db.prepare("INSERT INTO asset_discovery_queries (run_id,target_name,provider,query_type,mode,include_terms_json,exclude_terms_json,result_count,next_page_token,status,created_at,raw_json,error_message) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(q.runId||null,targetName,q.provider,q.queryType,q.mode,s(q.includeTerms||[]),s(q.excludeTerms||[]),q.resultCount||0,q.nextPageToken||null,q.status,nowIso(),s(q.raw||{}),q.errorMessage||null); return Number(r.lastInsertRowid); }
  saveAssetLeads(runId, targetName, leads) { const t=nowIso(); const st=this.db.prepare("INSERT INTO asset_leads (run_id,target_name,lead_type,value,source,confidence,match_terms_json,status,first_seen_at,last_seen_at,metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(target_name,lead_type,value,source) DO UPDATE SET run_id=excluded.run_id, confidence=excluded.confidence, match_terms_json=excluded.match_terms_json, status=excluded.status, last_seen_at=excluded.last_seen_at, metadata_json=excluded.metadata_json"); let n=0; for(const lead of leads||[]){st.run(runId||null,targetName,lead.leadType||"domain",lead.value||lead.domain,lead.source||"unknown",lead.confidence||"candidate",s(lead.matchTerms||[]),lead.status||"new",t,t,s(lead.metadata||{})); n++;} return n; }
  listAssetLeads({ targetName, limit = 1000 } = {}) { return (targetName ? this.db.prepare("SELECT * FROM asset_leads WHERE target_name=? ORDER BY last_seen_at DESC,value LIMIT ?").all(targetName,limit) : this.db.prepare("SELECT * FROM asset_leads ORDER BY last_seen_at DESC,value LIMIT ?").all(limit)).map(hydrateAssetLead); }
  listAssetDiscoveryQueries({ targetName, limit = 50 } = {}) { return (targetName ? this.db.prepare("SELECT * FROM asset_discovery_queries WHERE target_name=? ORDER BY id DESC LIMIT ?").all(targetName,limit) : this.db.prepare("SELECT * FROM asset_discovery_queries ORDER BY id DESC LIMIT ?").all(limit)).map(hydrateDiscoveryQuery); }

  searchAll({ query, targetName = null, limit = 200 } = {}) { const q=String(query||"").toLowerCase().trim(); if(!q) return []; const p=`%${q}%`; const filt=targetName?"AND target_name=?":""; const pp=targetName?[p,targetName,limit]:[p,limit]; const ppp=targetName?[p,p,p,targetName,limit]:[p,p,p,limit]; const d=this.db.prepare(`SELECT 'domain' result_type,target_name,run_id,domain value,source,kind detail,last_seen_at seen_at FROM recon_domains WHERE lower(domain) LIKE ? ${filt} ORDER BY last_seen_at DESC LIMIT ?`).all(...pp); const h=this.db.prepare(`SELECT 'http_service' result_type,target_name,run_id,url value,source,COALESCE(title,webserver,technologies_json) detail,observed_at seen_at FROM recon_http_services WHERE (lower(url) LIKE ? OR lower(title) LIKE ? OR lower(technologies_json) LIKE ?) ${filt} ORDER BY observed_at DESC LIMIT ?`).all(...ppp); const u=this.db.prepare(`SELECT 'url' result_type,target_name,run_id,url value,source,COALESCE(path,query,params_json) detail,last_seen_at seen_at FROM recon_urls WHERE (lower(url) LIKE ? OR lower(path) LIKE ? OR lower(params_json) LIKE ?) ${filt} ORDER BY last_seen_at DESC LIMIT ?`).all(...ppp); const l=this.db.prepare(`SELECT 'asset_lead' result_type,target_name,run_id,value,source,confidence detail,last_seen_at seen_at FROM asset_leads WHERE lower(value) LIKE ? ${filt} ORDER BY last_seen_at DESC LIMIT ?`).all(...pp); return d.concat(h,u,l).sort((a,b)=>String(b.seen_at||"").localeCompare(String(a.seen_at||""))).slice(0,limit); }

  addApiKey({ provider, label, apiKey, status = "active", monthlyLimit = null, notes = null }) { const t=nowIso(); const res=this.db.prepare("INSERT INTO api_keys (provider,label,api_key,status,monthly_limit,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(provider,label) DO UPDATE SET api_key=excluded.api_key,status=excluded.status,monthly_limit=excluded.monthly_limit,notes=excluded.notes,updated_at=excluded.updated_at").run(provider,label,apiKey,status,monthlyLimit,notes,t,t); return this.getApiKey(Number(res.lastInsertRowid)) || this.getApiKeyByLabel(provider,label); }
  getApiKey(id) { const r=this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(Number(id)); return r?hydrateApiKey(r):null; }
  getApiKeySecret(id) { const r=this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(Number(id)); return r?hydrateApiKey(r,true):null; }
  getApiKeyByLabel(provider,label) { const r=this.db.prepare("SELECT * FROM api_keys WHERE provider=? AND label=?").get(provider,label); return r?hydrateApiKey(r):null; }
  listApiKeys({ provider=null, includeSecret=false }={}) { const rows=provider?this.db.prepare("SELECT * FROM api_keys WHERE provider=? ORDER BY lower(provider),lower(label),status").all(provider):this.db.prepare("SELECT * FROM api_keys ORDER BY lower(provider),lower(label),status").all(); return rows.map((r)=>hydrateApiKey(r,includeSecret)); }
  getActiveApiKey(provider) { const r=this.db.prepare("SELECT * FROM api_keys WHERE provider=? AND status='active' AND (monthly_limit IS NULL OR used_count < monthly_limit) ORDER BY used_count ASC, last_used_at IS NULL DESC, last_used_at ASC, id ASC LIMIT 1").get(provider); return r?hydrateApiKey(r,true):null; }
  markApiKeyUsed(id) { this.db.prepare("UPDATE api_keys SET used_count=used_count+1,last_used_at=?,updated_at=? WHERE id=?").run(nowIso(),nowIso(),id); }
  updateApiKeyStatus(id,status) { this.db.prepare("UPDATE api_keys SET status=?,updated_at=? WHERE id=?").run(status,nowIso(),Number(id)); return this.getApiKey(id); }
  deleteApiKey(id) { return this.db.prepare("DELETE FROM api_keys WHERE id=?").run(Number(id)).changes; }

  getAiSettings() { const r=this.db.prepare("SELECT value_json FROM ai_settings WHERE key='default'").get(); return r?j(r.value_json,{}):defaultAiSettings(); }
  saveAiSettings(settings) { const next={...defaultAiSettings(),...(settings||{})}; this.db.prepare("INSERT INTO ai_settings (key,value_json,updated_at) VALUES ('default',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at").run(s(next),nowIso()); return next; }
  ensureDefaultWebUser(user) { const existing=this.db.prepare("SELECT username FROM web_users LIMIT 1").get(); if(existing) return this.getWebUser(existing.username); return this.upsertWebUser(user); }
  upsertWebUser({ username, passwordHash, salt, iterations, status = "active" }) { const t=nowIso(); this.db.prepare("INSERT INTO web_users (username,password_hash,salt,iterations,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,iterations=excluded.iterations,status=excluded.status,updated_at=excluded.updated_at").run(username,passwordHash,salt,iterations,status,t,t); return this.getWebUser(username); }
  getWebUser(username) { const r=this.db.prepare("SELECT * FROM web_users WHERE username=?").get(username); return r?hydrateWebUser(r):null; }
  recordWebUserLogin(username) { this.db.prepare("UPDATE web_users SET last_login_at=?,updated_at=? WHERE username=?").run(nowIso(),nowIso(),username); return this.getWebUser(username); }

  addWordlist({ name, category, path: filePath, status = "active", notes = null }) { const t=nowIso(); const res=this.db.prepare("INSERT INTO wordlists (name,category,path,status,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(name) DO UPDATE SET category=excluded.category,path=excluded.path,status=excluded.status,notes=excluded.notes,updated_at=excluded.updated_at").run(name,category,filePath,status,notes,t,t); return this.getWordlist(Number(res.lastInsertRowid)) || this.getWordlistByName(name); }
  getWordlist(id) { return this.db.prepare("SELECT * FROM wordlists WHERE id=?").get(Number(id)) || null; }
  getWordlistByName(name) { return this.db.prepare("SELECT * FROM wordlists WHERE name=?").get(name) || null; }
  getActiveWordlist(category) { return this.db.prepare("SELECT * FROM wordlists WHERE category=? AND status='active' ORDER BY updated_at DESC,id DESC LIMIT 1").get(category) || null; }
  listWordlists({ category=null }={}) { return category?this.db.prepare("SELECT * FROM wordlists WHERE category=? ORDER BY name").all(category):this.db.prepare("SELECT * FROM wordlists ORDER BY category,name").all(); }
  deleteWordlist(id) { return this.db.prepare("DELETE FROM wordlists WHERE id=?").run(Number(id)).changes > 0; }
  recordToolResult(runId, r) { this.db.prepare("INSERT INTO recon_tool_results (run_id,tool_name,command_display,status,exit_code,started_at,finished_at,stdout_path,stderr_path,error_message) VALUES (?,?,?,?,?,?,?,?,?,?)").run(runId,r.toolName,r.commandDisplay||null,r.status,r.exitCode??null,r.startedAt,r.finishedAt||null,r.stdoutPath||null,r.stderrPath||null,r.errorMessage||null); }
  listToolResults({ runId, limit = 200 } = {}) { return this.db.prepare("SELECT * FROM recon_tool_results WHERE run_id=? ORDER BY id DESC LIMIT ?").all(runId,limit).map(hydrateToolResult); }
  getToolResult(id) { const r=this.db.prepare("SELECT * FROM recon_tool_results WHERE id=?").get(Number(id)); return r?hydrateToolResult(r):null; }
}

function countDistinct(db, table, col, runId) { return db.prepare(`SELECT COUNT(*) count FROM (SELECT 1 FROM ${table} WHERE run_id=? GROUP BY lower(${col}))`).get(runId).count; }
function countRows(db, table, runId) { return db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE run_id=?`).get(runId).count; }
function defaultAiSettings() { return { provider:"opencode", planningModel:"qwen/qwen3-coder:free", executionModel:"qwen/qwen3-coder:free", localEndpoint:"http://127.0.0.1:11434/v1/chat/completions", localModel:"llama3.1", autonomyLevel:1 }; }
function hydrateTarget(r) { return { ...r, scope: j(r.scope_json,{}) }; }
function hydrateRun(r) { return { ...r, checkpoint: j(r.checkpoint_json, {}) }; }
function hydrateJob(r) { return { ...r, payload: j(r.payload_json,{}), checkpoint: j(r.checkpoint_json,{}) }; }
function hydrateEvent(r) { return { ...r, payload: j(r.payload_json,{}) }; }
function hydrateDomain(r) { return { ...r, metadata: j(r.metadata_json,{}) }; }
function hydrateUrl(r) { return { ...r, params: j(r.params_json,[]), metadata: j(r.metadata_json,{}) }; }
function hydrateHttpService(r) { return { ...r, statusCode: r.status_code, technologies: j(r.technologies_json,[]), raw: j(r.raw_json,{}) }; }
function hydrateScreenshot(r) { return { ...r, metadata: j(r.metadata_json,{}) }; }
function hydrateAssetLead(r) { return { ...r, matchTerms: j(r.match_terms_json,[]), metadata: j(r.metadata_json,{}) }; }
function hydrateDiscoveryQuery(r) { return { ...r, includeTerms: j(r.include_terms_json,[]), excludeTerms: j(r.exclude_terms_json,[]), raw: j(r.raw_json,{}) }; }
function hydrateApiKey(r, includeSecret=false) { return { id:r.id, provider:r.provider, label:r.label, status:r.status, monthly_limit:r.monthly_limit, used_count:r.used_count, notes:r.notes, created_at:r.created_at, updated_at:r.updated_at, last_used_at:r.last_used_at, key_preview:mask(r.api_key), ...(includeSecret?{api_key:r.api_key}:{}) }; }
function hydrateWebUser(r) { return { username:r.username, passwordHash:r.password_hash, salt:r.salt, iterations:r.iterations, status:r.status, created_at:r.created_at, updated_at:r.updated_at, last_login_at:r.last_login_at }; }
function hydrateToolResult(r) { return { ...r, toolName:r.tool_name, commandDisplay:r.command_display, exitCode:r.exit_code, startedAt:r.started_at, finishedAt:r.finished_at, stdoutPath:r.stdout_path, stderrPath:r.stderr_path, errorMessage:r.error_message }; }

module.exports = { ScanStore, initScanStore, openScanStore };
