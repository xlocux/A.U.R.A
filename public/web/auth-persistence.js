"use strict";

(function initAuraAuthPersistence() {
  const STORAGE_KEY = "aura.authToken";
  const originalFetch = window.fetch.bind(window);

  window.AuraAuth = {
    getToken() {
      return localStorage.getItem(STORAGE_KEY) || "";
    },
    setToken(value) {
      if (value) localStorage.setItem(STORAGE_KEY, value);
    },
    clearToken() {
      localStorage.removeItem(STORAGE_KEY);
    },
    authHeaders(headers = {}) {
      const token = this.getToken();
      return token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
    }
  };

  window.fetch = function auraFetch(input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || "";
    const sameOriginApi = String(url).startsWith("/api/") || String(url).startsWith(`${location.origin}/api/`);
    if (!sameOriginApi) return originalFetch(input, init);
    return originalFetch(input, {
      ...init,
      headers: window.AuraAuth.authHeaders(init.headers || {})
    });
  };
})();
