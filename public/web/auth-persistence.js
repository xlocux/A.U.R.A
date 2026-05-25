"use strict";

(function initAuraAuthPersistence() {
  try { localStorage.removeItem("aura.authToken"); } catch {}
  window.AuraAuth = {
    getToken() { return ""; },
    setToken() {},
    clearToken() { try { localStorage.removeItem("aura.authToken"); } catch {} },
    authHeaders(headers = {}) { return headers; }
  };
})();
