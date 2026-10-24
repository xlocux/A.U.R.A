"use strict";

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { HttpError, readBody, sendJson } = require("./http-utils");

const pbkdf2 = promisify(crypto.pbkdf2);

const SESSION_COOKIE = "aura_session";
const SESSION_HEADER = "x-aura-session";
const DEFAULT_USERNAME = "locu";
const DEFAULT_PASSWORD = "locu";
const PASSWORD_ITERATIONS = 120000;
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const SESSION_CACHE_MS = 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const MIN_PASSWORD_LENGTH = 8;

function hashSession(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url");
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "_").replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64);
}

function derivePasswordHashSync(password, salt, iterations) {
  return crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("base64url");
}

async function derivePasswordHash(password, salt, iterations) {
  return (await pbkdf2(String(password), salt, iterations, 32, "sha256")).toString("base64url");
}

function hashWebUserPassword({ username, password, iterations = PASSWORD_ITERATIONS }) {
  const salt = crypto.randomBytes(16).toString("base64url");
  return { username, passwordHash: derivePasswordHashSync(password, salt, iterations), salt, iterations, status: "active" };
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left), "base64url");
  const b = Buffer.from(String(right), "base64url");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function verifyWebUserPassword(user, password) {
  return safeEqual(user.passwordHash, await derivePasswordHash(password, user.salt, user.iterations));
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(String(cookieHeader || "").split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return [part, ""];
    let value = part.slice(index + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      // Keep the raw value when a foreign cookie is not valid percent-encoding.
    }
    return [part.slice(0, index), value];
  }));
}

function sessionFromRequest(request) {
  return String(request.headers[SESSION_HEADER] || "").trim() || parseCookies(request.headers.cookie || "")[SESSION_COOKIE] || "";
}

function cookieValue(sessionKey, maxAgeSeconds) {
  return `${SESSION_COOKIE}=${sessionKey}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

// Tracks failed logins per client address; a dummy hash keeps unknown usernames as slow as real ones.
function createLoginThrottle() {
  const failures = new Map();
  return {
    isBlocked(key) {
      const entry = failures.get(key);
      if (!entry) return false;
      if (Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
        failures.delete(key);
        return false;
      }
      return entry.count >= LOGIN_MAX_FAILURES;
    },
    fail(key) {
      const entry = failures.get(key);
      if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) failures.set(key, { count: 1, firstAt: Date.now() });
      else entry.count += 1;
    },
    reset(key) {
      failures.delete(key);
    }
  };
}

function createWebAuth({ store } = {}) {
  if (!store) throw new Error("Web auth requires a store");
  const sessions = new Map();
  const throttle = createLoginThrottle();
  const dummyUser = hashWebUserPassword({ username: "__dummy__", password: crypto.randomBytes(16).toString("hex") });
  store.ensureDefaultWebUser(hashWebUserPassword({
    username: DEFAULT_USERNAME,
    password: process.env.AURA_WEB_PASSWORD || DEFAULT_PASSWORD
  }));

  function sessionUsername(request) {
    const sessionKey = sessionFromRequest(request);
    if (!sessionKey) return null;
    const sessionHash = hashSession(sessionKey);
    const cached = sessions.get(sessionHash);
    if (cached && cached.checkedAt > Date.now() - SESSION_CACHE_MS) return cached.username;
    const stored = store.getWebSession(sessionHash);
    const user = stored ? store.getWebUser(stored.username) : null;
    if (!stored || !user || user.status !== "active") {
      sessions.delete(sessionHash);
      return null;
    }
    store.touchWebSession(sessionHash);
    sessions.set(sessionHash, { username: stored.username, checkedAt: Date.now() });
    return stored.username;
  }

  function startSession(response, username) {
    const sessionKey = crypto.randomBytes(32).toString("base64url");
    const sessionHash = hashSession(sessionKey);
    store.saveWebSession(sessionHash, username, new Date(Date.now() + SESSION_MS).toISOString());
    sessions.set(sessionHash, { username, checkedAt: Date.now() });
    response.setHeader("Set-Cookie", cookieValue(sessionKey, SESSION_MS / 1000));
  }

  async function login(request, response) {
    const clientKey = request.socket?.remoteAddress || "unknown";
    if (throttle.isBlocked(clientKey)) throw new HttpError(429, "Too many failed login attempts. Try again in a few minutes.");
    const body = await readBody(request);
    const username = String(body.username || "").trim();
    const user = username ? store.getWebUser(username) : null;
    const valid = await verifyWebUserPassword(user || dummyUser, String(body.password || ""));
    if (!user || user.status !== "active" || !valid) {
      throttle.fail(clientKey);
      throw new HttpError(401, "Invalid username or password");
    }
    throttle.reset(clientKey);
    startSession(response, user.username);
    store.recordWebUserLogin(user.username);
    sendJson(response, { authenticated: true, username: user.username });
  }

  async function updateCredentials(request, response) {
    const currentUsername = sessionUsername(request);
    if (!currentUsername) throw new HttpError(401, "Authentication required");
    const body = await readBody(request);
    const currentUser = store.getWebUser(currentUsername);
    if (!currentUser || !(await verifyWebUserPassword(currentUser, String(body.currentPassword || "")))) {
      throw new HttpError(401, "Current password is incorrect");
    }
    const nextUsername = normalizeUsername(body.username || currentUsername);
    const nextPassword = String(body.newPassword || "");
    if (!nextUsername) throw new HttpError(400, "Username is required");
    if (nextUsername !== currentUsername && store.getWebUser(nextUsername)) throw new HttpError(409, "Username already exists");
    if (nextPassword && nextPassword.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(400, `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    const hashed = hashWebUserPassword({ username: nextUsername, password: nextPassword || String(body.currentPassword || "") });
    const keepSessionHash = hashSession(sessionFromRequest(request));
    const updatedUser = store.updateWebUserCredentials(currentUsername, hashed, keepSessionHash);
    sessions.clear();
    sendJson(response, { ok: true, username: updatedUser.username, status: updatedUser.status, updatedAt: updatedUser.updated_at });
  }

  function logout(request, response) {
    const sessionKey = sessionFromRequest(request);
    if (sessionKey) {
      const sessionHash = hashSession(sessionKey);
      sessions.delete(sessionHash);
      store.deleteWebSession(sessionHash);
    }
    response.setHeader("Set-Cookie", cookieValue("", 0));
    sendJson(response, { authenticated: false });
  }

  async function handleAuthRequest(request, response, url) {
    const route = `${request.method} ${url.pathname}`;
    if (route === "GET /api/auth/status") {
      const username = sessionUsername(request);
      sendJson(response, { authenticated: Boolean(username), username });
      return true;
    }
    if (route === "GET /api/auth/user") {
      const username = sessionUsername(request);
      if (!username) throw new HttpError(401, "Authentication required");
      const user = store.getWebUser(username);
      sendJson(response, {
        username,
        status: user?.status || "unknown",
        lastLoginAt: user?.last_login_at || null,
        updatedAt: user?.updated_at || null,
        usingDefaultPassword: usingDefaultPassword()
      });
      return true;
    }
    if (route === "POST /api/auth/login") {
      await login(request, response);
      return true;
    }
    if (route === "POST /api/auth/credentials") {
      await updateCredentials(request, response);
      return true;
    }
    if (route === "POST /api/auth/logout") {
      logout(request, response);
      return true;
    }
    return false;
  }

  function usingDefaultPassword() {
    const user = store.getWebUser(DEFAULT_USERNAME);
    if (!user) return false;
    return safeEqual(user.passwordHash, derivePasswordHashSync(DEFAULT_PASSWORD, user.salt, user.iterations));
  }

  return {
    handleAuthRequest,
    isAuthenticated: (request) => Boolean(sessionUsername(request)),
    usingDefaultPassword
  };
}

module.exports = { createWebAuth, hashWebUserPassword, parseCookies };
