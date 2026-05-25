"use strict";

const crypto = require("node:crypto");
const { readBody, sendJson } = require("./http-utils");

const SESSION_COOKIE = "aura_session";
const SESSION_HEADER = "x-aura-session";
const DEFAULT_USERNAME = "locu";
const DEFAULT_PASSWORD = "locu";
const PASSWORD_ITERATIONS = 120000;
const SESSION_DAYS = 30;

function createWebAuth({ store } = {}) {
  if (!store) throw new Error("Web auth requires a store");
  ensureSessionTable(store);
  const sessions = new Map();
  store.ensureDefaultWebUser(hashWebUserPassword({
    username: DEFAULT_USERNAME,
    password: process.env.AURA_WEB_PASSWORD || DEFAULT_PASSWORD
  }));

  function sessionUsername(request) {
    const sessionKey = sessionFromRequest(request);
    if (!sessionKey) return null;
    if (sessions.has(sessionKey)) return sessions.get(sessionKey);
    const stored = lookupStoredSession(store, sessionKey);
    if (!stored) return null;
    sessions.set(sessionKey, stored.username);
    return stored.username;
  }

  function isAuthenticated(request) {
    return Boolean(sessionUsername(request));
  }

  async function handleAuthRequest(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/auth/status") {
      sendJson(response, { authenticated: isAuthenticated(request), username: sessionUsername(request) });
      return true;
    }
    if (request.method === "GET" && url.pathname === "/api/auth/user") {
      const username = sessionUsername(request);
      if (!username) {
        sendJson(response, { error: "Authentication required" }, 401);
        return true;
      }
      const user = store.getWebUser(username);
      sendJson(response, { username, status: user?.status || "unknown", lastLoginAt: user?.last_login_at || null, updatedAt: user?.updated_at || null });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readBody(request);
      const username = String(body.username || "").trim();
      const user = username ? store.getWebUser(username) : null;
      if (!user || user.status !== "active" || !verifyWebUserPassword(user, String(body.password || ""))) {
        sendJson(response, { error: "Invalid password" }, 401);
        return true;
      }
      const sessionKey = crypto.randomBytes(32).toString("base64url");
      sessions.set(sessionKey, user.username);
      saveStoredSession(store, sessionKey, user.username);
      store.recordWebUserLogin(user.username);
      response.setHeader("Set-Cookie", cookieValue(sessionKey));
      sendJson(response, { authenticated: true, username: user.username });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/credentials") {
      const currentSessionUsername = sessionUsername(request);
      if (!currentSessionUsername) {
        sendJson(response, { error: "Authentication required" }, 401);
        return true;
      }
      const body = await readBody(request);
      const currentUser = store.getWebUser(currentSessionUsername);
      if (!currentUser || !verifyWebUserPassword(currentUser, String(body.currentPassword || ""))) {
        sendJson(response, { error: "Current password is incorrect" }, 401);
        return true;
      }
      const nextUsername = normalizeUsername(body.username || currentSessionUsername);
      const nextPassword = String(body.newPassword || "");
      if (!nextUsername) {
        sendJson(response, { error: "Username is required" }, 400);
        return true;
      }
      if (nextUsername !== currentSessionUsername && store.getWebUser(nextUsername)) {
        sendJson(response, { error: "Username already exists" }, 409);
        return true;
      }
      if (nextPassword && nextPassword.length < 8) {
        sendJson(response, { error: "New password must be at least 8 characters" }, 400);
        return true;
      }
      const passwordForHash = nextPassword || String(body.currentPassword || "");
      const updatedUser = store.upsertWebUser(hashWebUserPassword({ username: nextUsername, password: passwordForHash }));
      const sessionKey = sessionFromRequest(request);
      if (sessionKey) {
        sessions.set(sessionKey, nextUsername);
        saveStoredSession(store, sessionKey, nextUsername);
      }
      sendJson(response, { ok: true, username: updatedUser.username, status: updatedUser.status, updatedAt: updatedUser.updated_at });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const sessionKey = sessionFromRequest(request);
      if (sessionKey) {
        sessions.delete(sessionKey);
        deleteStoredSession(store, sessionKey);
      }
      response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      sendJson(response, { authenticated: false });
      return true;
    }
    return false;
  }

  return { handleAuthRequest, isAuthenticated };
}

function ensureSessionTable(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS web_sessions (
      session_hash TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_web_sessions_expires ON web_sessions(expires_at);
  `);
  store.db.prepare("DELETE FROM web_sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

function saveStoredSession(store, sessionKey, username) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  store.db.prepare(`
    INSERT INTO web_sessions (session_hash, username, created_at, expires_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(session_hash) DO UPDATE SET username = excluded.username, expires_at = excluded.expires_at, last_seen_at = excluded.last_seen_at
  `).run(hashSession(sessionKey), username, now.toISOString(), expiresAt, now.toISOString());
}

function lookupStoredSession(store, sessionKey) {
  const now = new Date().toISOString();
  const row = store.db.prepare("SELECT username, session_hash FROM web_sessions WHERE session_hash = ? AND expires_at > ?").get(hashSession(sessionKey), now);
  if (!row) return null;
  const user = store.getWebUser(row.username);
  if (!user || user.status !== "active") return null;
  store.db.prepare("UPDATE web_sessions SET last_seen_at = ? WHERE session_hash = ?").run(now, row.session_hash);
  return { username: row.username };
}

function deleteStoredSession(store, sessionKey) {
  store.db.prepare("DELETE FROM web_sessions WHERE session_hash = ?").run(hashSession(sessionKey));
}

function sessionFromRequest(request) {
  return String(request.headers[SESSION_HEADER] || "").trim() || parseCookies(request.headers.cookie || "")[SESSION_COOKIE] || "";
}

function hashSession(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url");
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
}

function hashWebUserPassword({ username, password, iterations = PASSWORD_ITERATIONS }) {
  const salt = crypto.randomBytes(16).toString("base64url");
  return { username, passwordHash: derivePasswordHash(password, salt, iterations), salt, iterations, status: "active" };
}

function verifyWebUserPassword(user, password) {
  const expected = Buffer.from(user.passwordHash, "base64url");
  const actual = Buffer.from(derivePasswordHash(password, user.salt, user.iterations), "base64url");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function derivePasswordHash(password, salt, iterations) {
  return crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("base64url");
}

function cookieValue(sessionKey) {
  return `${SESSION_COOKIE}=${sessionKey}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 24 * 60 * 60}`;
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(String(cookieHeader || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return [part, ""];
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

module.exports = { createWebAuth, hashWebUserPassword, parseCookies };
