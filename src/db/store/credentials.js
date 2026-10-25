"use strict";

const { hydrate, nowIso, parseJson, toJson, transaction } = require("./helpers");

function defaultAiSettings() {
  return {
    provider: "opencode",
    planningModel: "qwen/qwen3-coder:free",
    executionModel: "qwen/qwen3-coder:free",
    localEndpoint: "http://127.0.0.1:11434/v1/chat/completions",
    localModel: "llama3.1",
    autonomyLevel: 3,
    deepseekToken: "",
    deepseekDeviceId: ""
  };
}

module.exports = {
  // API keys -----------------------------------------------------------------------------------
  addApiKey({ provider, label, apiKey, status = "active", monthlyLimit = null, notes = null }) {
    const t = nowIso();
    this.db.prepare(`INSERT INTO api_keys (provider, label, api_key, status, monthly_limit, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, label) DO UPDATE SET api_key=excluded.api_key, status=excluded.status, monthly_limit=excluded.monthly_limit,
        notes=excluded.notes, updated_at=excluded.updated_at`).run(provider, label, apiKey, status, monthlyLimit, notes, t, t);
    // lastInsertRowid is stale on the upsert path, so always look the row up by its natural key.
    return this.getApiKeyByLabel(provider, label);
  },

  getApiKey(id) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(Number(id));
    return row ? hydrate.apiKey(row) : null;
  },

  getApiKeySecret(id) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE id=?").get(Number(id));
    return row ? hydrate.apiKey(row, true) : null;
  },

  getApiKeyByLabel(provider, label) {
    const row = this.db.prepare("SELECT * FROM api_keys WHERE provider=? AND label=?").get(provider, label);
    return row ? hydrate.apiKey(row) : null;
  },

  listApiKeys({ provider = null, includeSecret = false } = {}) {
    const rows = provider
      ? this.db.prepare("SELECT * FROM api_keys WHERE provider=? ORDER BY lower(provider), lower(label), status").all(provider)
      : this.db.prepare("SELECT * FROM api_keys ORDER BY lower(provider), lower(label), status").all();
    return rows.map((row) => hydrate.apiKey(row, includeSecret));
  },

  getActiveApiKey(provider) {
    const row = this.db.prepare(`SELECT * FROM api_keys WHERE provider=? AND status='active' AND (monthly_limit IS NULL OR used_count < monthly_limit)
      ORDER BY used_count ASC, last_used_at IS NULL DESC, last_used_at ASC, id ASC LIMIT 1`).get(provider);
    return row ? hydrate.apiKey(row, true) : null;
  },

  markApiKeyUsed(id) {
    const t = nowIso();
    this.db.prepare("UPDATE api_keys SET used_count=used_count+1, last_used_at=?, updated_at=? WHERE id=?").run(t, t, Number(id));
  },

  updateApiKeyStatus(id, status) {
    this.db.prepare("UPDATE api_keys SET status=?, updated_at=? WHERE id=?").run(status, nowIso(), Number(id));
    return this.getApiKey(id);
  },

  deleteApiKey(id) {
    return this.db.prepare("DELETE FROM api_keys WHERE id=?").run(Number(id)).changes > 0;
  },

  // AI settings --------------------------------------------------------------------------------
  getAiSettings() {
    const row = this.db.prepare("SELECT value_json FROM ai_settings WHERE key='default'").get();
    return row ? { ...defaultAiSettings(), ...parseJson(row.value_json, {}) } : defaultAiSettings();
  },

  saveAiSettings(settings) {
    const next = { ...defaultAiSettings(), ...(settings || {}) };
    this.db.prepare("INSERT INTO ai_settings (key, value_json, updated_at) VALUES ('default', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at")
      .run(toJson(next), nowIso());
    return next;
  },

  // Web users and sessions -----------------------------------------------------------------------
  ensureDefaultWebUser(user) {
    const existing = this.db.prepare("SELECT username FROM web_users LIMIT 1").get();
    return existing ? this.getWebUser(existing.username) : this.upsertWebUser(user);
  },

  upsertWebUser({ username, passwordHash, salt, iterations, status = "active" }) {
    const t = nowIso();
    this.db.prepare(`INSERT INTO web_users (username, password_hash, salt, iterations, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash, salt=excluded.salt, iterations=excluded.iterations,
        status=excluded.status, updated_at=excluded.updated_at`).run(username, passwordHash, salt, iterations, status, t, t);
    return this.getWebUser(username);
  },

  // Renames and/or re-keys a user in place, so the old username can no longer log in,
  // and revokes every session except the one performing the change.
  updateWebUserCredentials(currentUsername, { username, passwordHash, salt, iterations }, keepSessionHash = null) {
    return transaction(this.db, () => {
      this.db.prepare("UPDATE web_users SET username=?, password_hash=?, salt=?, iterations=?, updated_at=? WHERE username=?")
        .run(username, passwordHash, salt, iterations, nowIso(), currentUsername);
      this.db.prepare("DELETE FROM web_sessions WHERE username=? AND session_hash IS NOT ?").run(currentUsername, keepSessionHash);
      this.db.prepare("UPDATE web_sessions SET username=? WHERE username=?").run(username, currentUsername);
      return this.getWebUser(username);
    });
  },

  getWebUser(username) {
    const row = this.db.prepare("SELECT * FROM web_users WHERE username=?").get(username);
    return row ? hydrate.webUser(row) : null;
  },


  recordWebUserLogin(username) {
    const t = nowIso();
    this.db.prepare("UPDATE web_users SET last_login_at=?, updated_at=? WHERE username=?").run(t, t, username);
    return this.getWebUser(username);
  },

  saveWebSession(sessionHash, username, expiresAt) {
    const t = nowIso();
    this.db.prepare(`INSERT INTO web_sessions (session_hash, username, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_hash) DO UPDATE SET username=excluded.username, expires_at=excluded.expires_at, last_seen_at=excluded.last_seen_at`)
      .run(sessionHash, username, t, expiresAt, t);
  },

  getWebSession(sessionHash) {
    return this.db.prepare("SELECT session_hash, username, expires_at FROM web_sessions WHERE session_hash=? AND expires_at > ?").get(sessionHash, nowIso()) || null;
  },

  touchWebSession(sessionHash) {
    this.db.prepare("UPDATE web_sessions SET last_seen_at=? WHERE session_hash=?").run(nowIso(), sessionHash);
  },

  deleteWebSession(sessionHash) {
    this.db.prepare("DELETE FROM web_sessions WHERE session_hash=?").run(sessionHash);
  },

  // Wordlists ------------------------------------------------------------------------------------
  addWordlist({ name, category, path: filePath, status = "active", notes = null }) {
    const t = nowIso();
    this.db.prepare(`INSERT INTO wordlists (name, category, path, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET category=excluded.category, path=excluded.path, status=excluded.status, notes=excluded.notes, updated_at=excluded.updated_at`)
      .run(name, category, filePath, status, notes, t, t);
    return this.getWordlistByName(name);
  },

  getWordlist(id) {
    return this.db.prepare("SELECT * FROM wordlists WHERE id=?").get(Number(id)) || null;
  },

  getWordlistByName(name) {
    return this.db.prepare("SELECT * FROM wordlists WHERE name=?").get(name) || null;
  },

  getActiveWordlist(category) {
    return this.db.prepare("SELECT * FROM wordlists WHERE category=? AND status='active' ORDER BY updated_at DESC, id DESC LIMIT 1").get(category) || null;
  },

  listWordlists({ category = null } = {}) {
    return category
      ? this.db.prepare("SELECT * FROM wordlists WHERE category=? ORDER BY name").all(category)
      : this.db.prepare("SELECT * FROM wordlists ORDER BY category, name").all();
  },

  deleteWordlist(id) {
    return this.db.prepare("DELETE FROM wordlists WHERE id=?").run(Number(id)).changes > 0;
  }
};
