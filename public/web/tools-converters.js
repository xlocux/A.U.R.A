"use strict";

// Tools tab: a grid of small, client-side converter utilities (no network). Each tile opens a modal
// with a live input -> output conversion. All transforms run locally in the browser.
(function initAuraTools() {
  const $ = (id) => document.getElementById(id);

  function esc(value) {
    return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }

  const textToHex = (text) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const hexToText = (hex) => {
    const clean = String(hex).replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
    if (clean.length % 2 !== 0) throw new Error("Hex length must be even.");
    const bytes = new Uint8Array(clean.match(/.{2}/g)?.map((h) => parseInt(h, 16)) || []);
    return new TextDecoder().decode(bytes);
  };
  const b64urlToB64 = (value) => value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const decodeJwt = (token) => {
    const parts = String(token).trim().split(".");
    if (parts.length < 2) throw new Error("A JWT has at least header.payload sections.");
    const part = (segment) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64urlToB64(segment)), (c) => c.charCodeAt(0))));
    const header = part(parts[0]);
    const payload = part(parts[1]);
    const expiryNote = payload.exp ? `\n\n// exp: ${new Date(payload.exp * 1000).toISOString()} (${payload.exp * 1000 < Date.now() ? "EXPIRED" : "valid"})` : "";
    return `// header\n${JSON.stringify(header, null, 2)}\n\n// payload\n${JSON.stringify(payload, null, 2)}${expiryNote}`;
  };
  const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  const fromBase64 = (value) => new TextDecoder().decode(Uint8Array.from(atob(b64urlToB64(value.trim())), (c) => c.charCodeAt(0)));
  const htmlEntities = (text) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const htmlUnentities = (text) => { const el = document.createElement("textarea"); el.innerHTML = text; return el.value; };
  const timestamp = (input) => {
    const raw = input.trim();
    if (/^\d{10,13}$/.test(raw)) {
      const ms = raw.length === 13 ? Number(raw) : Number(raw) * 1000;
      return `ISO: ${new Date(ms).toISOString()}\nLocal: ${new Date(ms).toString()}`;
    }
    const parsed = Date.parse(raw);
    if (Number.isNaN(parsed)) throw new Error("Enter a unix timestamp (s/ms) or a parsable date.");
    return `Epoch (s): ${Math.floor(parsed / 1000)}\nEpoch (ms): ${parsed}`;
  };
  async function hashText(text, algo) {
    const digest = await crypto.subtle.digest(algo, new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  const TOOLS = [
    { id: "base64", title: "Base64", desc: "Encode / decode Base64 (and URL-safe).", modes: ["Encode", "Decode"], run: (v, m) => (m === "Encode" ? toBase64(v) : fromBase64(v)) },
    { id: "url", title: "URL encoding", desc: "Percent-encode or decode URL components.", modes: ["Encode", "Decode"], run: (v, m) => (m === "Encode" ? encodeURIComponent(v) : decodeURIComponent(v)) },
    { id: "hex", title: "Hex ↔ ASCII", desc: "Convert text to hex bytes and back.", modes: ["Text→Hex", "Hex→Text"], run: (v, m) => (m === "Text→Hex" ? textToHex(v) : hexToText(v)) },
    { id: "jwt", title: "JWT decoder", desc: "Decode a JWT header and payload (no verification).", modes: ["Decode"], run: (v) => decodeJwt(v) },
    { id: "html", title: "HTML entities", desc: "Encode or decode HTML entities.", modes: ["Encode", "Decode"], run: (v, m) => (m === "Encode" ? htmlEntities(v) : htmlUnentities(v)) },
    { id: "json", title: "JSON format", desc: "Pretty-print or minify JSON.", modes: ["Pretty", "Minify"], run: (v, m) => JSON.stringify(JSON.parse(v), null, m === "Pretty" ? 2 : 0) },
    { id: "timestamp", title: "Timestamp", desc: "Unix epoch ↔ date (auto-detects input).", modes: ["Convert"], run: (v) => timestamp(v) },
    { id: "unicode", title: "JSON string escape", desc: "Escape or unescape a JSON/JS string.", modes: ["Escape", "Unescape"], run: (v, m) => (m === "Escape" ? JSON.stringify(v).slice(1, -1) : JSON.parse(`"${v.replace(/"/g, '\\"')}"`)) },
    { id: "hash", title: "Hashes", desc: "SHA-1 / SHA-256 / SHA-512 of the input text.", modes: ["SHA-256", "SHA-1", "SHA-512"], run: (v, m) => hashText(v, m) }
  ];

  function ensureModal() {
    let modal = $("toolsConverterModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "toolsConverterModal";
    modal.className = "tools-modal hidden";
    modal.innerHTML = `
      <div class="tools-dialog" role="dialog" aria-modal="true" aria-labelledby="toolsModalTitle">
        <header class="tools-modal-head">
          <strong id="toolsModalTitle"></strong>
          <div class="tools-modes" id="toolsModes"></div>
          <button type="button" id="toolsModalClose" class="results-fullscreen-close">Close (Esc)</button>
        </header>
        <div class="tools-io">
          <label for="toolsInput">Input</label>
          <textarea id="toolsInput" spellcheck="false" placeholder="Paste input here"></textarea>
          <div class="tools-output-head"><label for="toolsOutput">Output</label><button type="button" id="toolsCopyOutput" class="row-action" title="Copy output">⧉</button></div>
          <textarea id="toolsOutput" spellcheck="false" readonly></textarea>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector("#toolsModalClose").addEventListener("click", close);
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !modal.classList.contains("hidden")) close(); });
    $("toolsInput").addEventListener("input", runActive);
    $("toolsCopyOutput").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText($("toolsOutput").value); } catch { /* ignore */ }
    });
    return modal;
  }

  let activeTool = null;
  let activeMode = null;

  async function runActive() {
    if (!activeTool) return;
    const input = $("toolsInput").value;
    const output = $("toolsOutput");
    if (!input) { output.value = ""; output.classList.remove("tools-error"); return; }
    try {
      output.value = await activeTool.run(input, activeMode);
      output.classList.remove("tools-error");
    } catch (error) {
      output.value = `Error: ${error.message}`;
      output.classList.add("tools-error");
    }
  }

  function open(tool) {
    const modal = ensureModal();
    activeTool = tool;
    activeMode = tool.modes[0];
    $("toolsModalTitle").textContent = tool.title;
    $("toolsModes").innerHTML = tool.modes.length > 1
      ? tool.modes.map((mode) => `<button type="button" class="tools-mode${mode === activeMode ? " active" : ""}" data-mode="${esc(mode)}">${esc(mode)}</button>`).join("")
      : "";
    $("toolsModes").querySelectorAll(".tools-mode").forEach((button) => button.addEventListener("click", () => {
      activeMode = button.dataset.mode;
      $("toolsModes").querySelectorAll(".tools-mode").forEach((b) => b.classList.toggle("active", b === button));
      runActive();
    }));
    $("toolsInput").value = "";
    $("toolsOutput").value = "";
    modal.classList.remove("hidden");
    $("toolsInput").focus();
  }

  function close() {
    $("toolsConverterModal")?.classList.add("hidden");
  }

  function renderTiles() {
    const grid = $("toolsGrid");
    if (!grid || grid.dataset.built === "true") return;
    grid.dataset.built = "true";
    grid.innerHTML = TOOLS.map((tool) => `
      <button type="button" class="tool-tile" data-tool-id="${esc(tool.id)}">
        <strong>${esc(tool.title)}</strong>
        <span>${esc(tool.desc)}</span>
      </button>`).join("");
    grid.querySelectorAll(".tool-tile").forEach((tile) => {
      tile.addEventListener("click", () => {
        const tool = TOOLS.find((item) => item.id === tile.dataset.toolId);
        if (tool) open(tool);
      });
    });
  }

  window.AuraTools = { renderTiles, open };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderTiles, { once: true });
  else renderTiles();
})();
