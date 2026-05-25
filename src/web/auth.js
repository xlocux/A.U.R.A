"use strict";

const crypto = require("node:crypto");
const { readBody, sendJson } = require("./http-utils");

const SESSION_COOKIE = "aura_session";
const DEFAULT_USERNAME = "locu";
const DEFAULT_PASSWORD = "locu";
const PASSWORD_ITERATIONS = 120000;

function createWebAuth({ store } = {}) {
  if (!store) throw new Error("Web auth requires a store");
  const sessions = new Map();
  store.ensureDefaultWebUser(hashWebUserPassword({
    username: DEFAULT_USERNAME,
    password: process.env.AURA_WEB_PASSWORD || DEFAULT_PASSWORD
  }));

  function sessionUsername(request) {
    const token = parseCookies(request.headers.cookie || "")[SESSION_COOKIE];
    return token && sessions.has(token) ? sessions.get(token) : null;
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
      const token = crypto.randomBytes(32).toString("base64url");
      sessions.set(token, user.username);
      store.recordWebUserLogin(user.username);
      response.setHeader("Set-Cookie", cookieValue(token));
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
      const token = parseCookies(request.headers.cookie || "")[SESSION_COOKIE];
      if (token) sessions.set(token, nextUsername);
      sendJson(response, { ok: true, username: updatedUser.username, status: updatedUser.status, updatedAt: updatedUser.updated_at });
      return true;
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const token = parseCookies(request.headers.cookie || "")[SESSION_COOKIE];
      if (token) sessions.delete(token);
      response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
      sendJson(response, { authenticated: false });
      return true;
    }
    return false;
  }

  return {
    handleAuthRequest,
    isAuthenticated
  };
}

function normalizeUsername(value) {
  return String(value || "").trim().replace(/\s+/g, "_").slice(0, 64);
}

function hashWebUserPassword({ username, password, iterations = PASSWORD_ITERATIONS }) {
  const salt = crypto.randomBytes(16).toString("base64url");
  return {
    username,
    passwordHash: derivePasswordHash(password, salt, iterations),
    salt,
    iterations,
    status: "active"
  };
}

function verifyWebUserPassword(user, password) {
  const expected = Buffer.from(user.passwordHash, "base64url");
  const actual = Buffer.from(derivePasswordHash(password, user.salt, user.iterations), "base64url");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function derivePasswordHash(password, salt, iterations) {
  return crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("base64url");
}

function cookieValue(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`;
}

function parseCookies(cookieHeader) {
  return Object.fromEntries(String(cookieHeader || "").split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index === -1) return [part, ""];
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}

module.exports = {
  createWebAuth,
  hashWebUserPassword,
  parseCookies
};
