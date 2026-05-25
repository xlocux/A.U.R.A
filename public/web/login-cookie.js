"use strict";

(function initAuraCookieLogin() {
  const status = document.getElementById("loginStatus");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const button = document.getElementById("login");
  try { localStorage.removeItem("aura.authToken"); } catch {}

  async function existing() {
    try {
      const response = await fetch("/api/auth/status");
      const data = await response.json();
      if (response.ok && data.authenticated) location.href = "/";
    } catch {}
  }

  async function submit() {
    status.textContent = "Signing in...";
    status.className = "notice muted";
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    const data = await response.json();
    if (!response.ok) {
      status.textContent = data.error || "Login failed";
      status.className = "notice error";
      return;
    }
    location.href = "/";
  }

  button?.addEventListener("click", submit);
  password?.addEventListener("keydown", (event) => { if (event.key === "Enter") submit(); });
  existing();
})();
