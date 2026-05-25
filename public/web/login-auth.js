"use strict";

(function initAuraLoginAuth() {
  const STORAGE_KEY = "aura.authToken";
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const status = document.getElementById("loginStatus");
  const button = document.getElementById("login");

  async function checkExistingSession() {
    const sessionKey = localStorage.getItem(STORAGE_KEY) || "";
    if (!sessionKey) return;
    try {
      const response = await fetch("/api/auth/status", { headers: { "x-aura-session": sessionKey } });
      const data = await response.json();
      if (response.ok && data.authenticated) {
        window.location.href = "/";
        return;
      }
    } catch {}
    localStorage.removeItem(STORAGE_KEY);
  }

  async function login() {
    if (!username || !password || !status) return;
    status.textContent = "Signing in...";
    status.className = "notice muted";
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    const data = await response.json();
    if (!response.ok) {
      localStorage.removeItem(STORAGE_KEY);
      status.textContent = data.error || "Login failed";
      status.className = "notice error";
      return;
    }
    if (data.sessionKey) localStorage.setItem(STORAGE_KEY, data.sessionKey);
    window.location.href = "/";
  }

  button?.addEventListener("click", login);
  password?.addEventListener("keydown", (event) => { if (event.key === "Enter") login(); });
  checkExistingSession();
})();
