"use strict";

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function mask(value) {
  const text = String(value || "");
  return text.length <= 8 ? "*".repeat(text.length) : `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function uniqueBy(items, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// Runs fn inside a transaction; nested calls join the outer transaction.
// Bulk upserts without this run one fsync'd autocommit per row and can freeze the server for minutes.
function transaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

const hydrate = {
  target: (r) => ({ ...r, scope: parseJson(r.scope_json, {}) }),
  run: (r) => ({ ...r, checkpoint: parseJson(r.checkpoint_json, {}) }),
  job: (r) => ({ ...r, payload: parseJson(r.payload_json, {}), checkpoint: parseJson(r.checkpoint_json, {}) }),
  event: (r) => ({ ...r, payload: parseJson(r.payload_json, {}) }),
  domain: (r) => ({ ...r, metadata: parseJson(r.metadata_json, {}) }),
  url: (r) => ({ ...r, params: parseJson(r.params_json, []), metadata: parseJson(r.metadata_json, {}) }),
  httpService: (r) => ({ ...r, statusCode: r.status_code, technologies: parseJson(r.technologies_json, []), raw: parseJson(r.raw_json, {}) }),
  screenshot: (r) => ({ ...r, metadata: parseJson(r.metadata_json, {}) }),
  assetLead: (r) => ({ ...r, matchTerms: parseJson(r.match_terms_json, []), metadata: parseJson(r.metadata_json, {}) }),
  apiKey: (r, includeSecret = false) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    status: r.status,
    monthly_limit: r.monthly_limit,
    used_count: r.used_count,
    notes: r.notes,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_used_at: r.last_used_at,
    key_preview: mask(r.api_key),
    ...(includeSecret ? { api_key: r.api_key } : {})
  }),
  webUser: (r) => ({
    username: r.username,
    passwordHash: r.password_hash,
    salt: r.salt,
    iterations: r.iterations,
    status: r.status,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_login_at: r.last_login_at
  }),
  toolResult: (r) => ({
    ...r,
    toolName: r.tool_name,
    commandDisplay: r.command_display,
    exitCode: r.exit_code,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    stdoutPath: r.stdout_path,
    stderrPath: r.stderr_path,
    errorMessage: r.error_message
  })
};

module.exports = {
  hydrate,
  mask,
  nowIso,
  parseJson,
  toJson,
  transaction,
  uniqueBy
};
