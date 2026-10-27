"use strict";

// Experimental DeepSeek web login capture: opens a real (non-headless) browser at chat.deepseek.com,
// lets the user log in, then reads the `userToken` from the page's localStorage over CDP and saves it
// into AI settings. Nothing is scraped beyond the one token the browser already holds for the user.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { reloadWasm, createHasher } = require("./deepseek-pow");
const { ensureDeviceId, deepSeekValidateToken } = require("./deepseek-web");

const LOGIN_URL = "https://chat.deepseek.com/";
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

const STATIC_BASE = "https://fe-static.deepseek.com/chat/static/";
const WASM_OUT = path.resolve("data", "deepseek_sha3.wasm");
// Ground-truth vector from a captured challenge: proves a freshly downloaded wasm is still compatible.
const WASM_VECTOR = {
  salt: "735d40e5adb8d0d03a1c",
  expire_at: 1792917239407,
  answer: 47450,
  challenge: "957f078efa8c32b4675cb75e4f80e8b9a5aecbedc0ff07cf5637c6e75f819e48"
};

// One capture at a time; the frontend polls `state`.
let state = { status: "idle", message: "", startedAt: 0 };
let child = null;

function windowsBrowserCandidates() {
  const pf = process.env["ProgramFiles"] || "C:/Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:/Program Files (x86)";
  const local = process.env["LOCALAPPDATA"] || path.join(os.homedir(), "AppData/Local");
  return [
    path.join(pf, "Google/Chrome/Application/chrome.exe"),
    path.join(pf86, "Google/Chrome/Application/chrome.exe"),
    path.join(local, "Google/Chrome/Application/chrome.exe"),
    path.join(pf86, "Microsoft/Edge/Application/msedge.exe"),
    path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
    path.join(pf, "BraveSoftware/Brave-Browser/Application/brave.exe"),
    path.join(pf86, "BraveSoftware/Brave-Browser/Application/brave.exe")
  ];
}

function findBrowser() {
  const candidates = process.platform === "win32"
    ? windowsBrowserCandidates()
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/brave-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  return candidates.find((candidate) => { try { return fs.statSync(candidate).isFile(); } catch { return false; } }) || null;
}

function cdpVersion(port, attemptsLeft) {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      http.get({ host: "127.0.0.1", port, path: "/json/version" }, (res) => {
        let body = ""; res.on("data", (c) => (body += c)); res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      }).on("error", (err) => (left <= 0 ? reject(err) : setTimeout(() => tryOnce(left - 1), 300)));
    };
    tryOnce(attemptsLeft);
  });
}

// Minimal CDP client: evaluate one expression and return its value.
function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const ready = new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(typeof event.data === "string" ? event.data : Buffer.from(event.data).toString());
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => { id += 1; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
  return { ws, ready, send };
}

function cleanup() {
  try { child?.kill(); } catch { /* ignore */ }
  child = null;
}

// --- Token extraction -------------------------------------------------------
// DeepSeek has stored the session token under different shapes over time: a plain string in
// localStorage.userToken, a JSON wrapper like {"value":"…"} (redux-persist), or inside another key.
// We dump the whole localStorage (+ cookies) and look for it broadly instead of one fixed key.

function looksLikeJwt(s) { return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s); }

function firstJwt(s) {
  if (typeof s !== "string") return "";
  const m = s.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  return m ? m[0] : "";
}

// Pull a token out of a single stored value: the raw string, or a JSON wrapper's value/token field.
function tokenFromValue(value, keyedAsToken) {
  if (typeof value !== "string" || !value) return "";
  const s = value.trim();
  if (looksLikeJwt(s)) return s;
  // A JSON wrapper (redux-persist stores userToken as {"value":<token|null>,"__version":…}) is NEVER
  // itself the token: return only its inner value, or "" when logged out (value:null).
  if (s.startsWith("{") || s.startsWith("[")) {
    try {
      const o = JSON.parse(s);
      const cand = o?.value ?? o?.token ?? o?.access_token ?? o?.value?.token ?? o?.data?.token;
      if (typeof cand === "string" && cand.trim() && (looksLikeJwt(cand) || (keyedAsToken && cand.trim().length > 20))) return cand.trim();
    } catch { /* not JSON */ }
    return "";
  }
  // For a key that already says "token", accept a long opaque string (DeepSeek's token isn't a JWT).
  if (keyedAsToken && s.length > 20 && !/\s/.test(s)) return s;
  return firstJwt(s);
}

function extractToken(localStore, cookie) {
  const entries = Object.entries(localStore || {});
  // 1. Prefer the historical exact key.
  if (localStore.userToken) { const t = tokenFromValue(localStore.userToken, true); if (t) return t; }
  // 2. Any key that mentions token.
  for (const [k, v] of entries) {
    if (/token/i.test(k)) { const t = tokenFromValue(v, true); if (t) return t; }
  }
  // 3. Any JWT-looking value anywhere in localStorage.
  for (const [, v] of entries) { const t = tokenFromValue(v, false); if (t) return t; }
  // 4. Cookies (userToken=… or any eyJ… value).
  if (typeof cookie === "string" && cookie) {
    const m = cookie.match(/(?:userToken|token)=([^;]+)/i);
    if (m) { const t = tokenFromValue(decodeURIComponent(m[1]), true); if (t) return t; }
    const j = firstJwt(cookie); if (j) return j;
  }
  return "";
}

// Runs the downloaded wasm against the known vector to confirm the hash algorithm is unchanged.
function wasmMatchesVector(buffer) {
  try {
    const ex = new WebAssembly.Instance(new WebAssembly.Module(buffer), {}).exports;
    return createHasher(ex)(`${WASM_VECTOR.salt}_${WASM_VECTOR.expire_at}_${WASM_VECTOR.answer}`) === WASM_VECTOR.challenge;
  } catch { return false; }
}

// Best-effort: while the real (bot-protected) page is open, read its script URLs over CDP, find the
// current sha3_wasm_bg.<hash>.wasm, download it from the CDN, validate it, and cache it under data/.
// Never throws — a failed refresh must not break the token capture.
async function refreshWasm(client) {
  try {
    const res = await client.send("Runtime.evaluate", {
      expression: "JSON.stringify(Array.from(document.scripts).map(s=>s.src).filter(Boolean))",
      returnByValue: true
    });
    const scripts = JSON.parse(String(res?.result?.result?.value || "[]"));
    const ordered = scripts.sort((a, b) => (b.includes("main") ? 1 : 0) - (a.includes("main") ? 1 : 0));
    let wasmUrl = null;
    for (const url of ordered.slice(0, 20)) {
      try {
        const js = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } }).then((r) => (r.ok ? r.text() : ""));
        const m = js.match(/sha3_wasm_bg\.[a-f0-9]+\.wasm/);
        if (m) { wasmUrl = STATIC_BASE + m[0]; break; }
      } catch { /* try next chunk */ }
    }
    if (!wasmUrl) return;
    const dl = await fetch(wasmUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!dl.ok) return;
    const buffer = Buffer.from(await dl.arrayBuffer());
    if (!wasmMatchesVector(buffer)) return; // algorithm changed — keep the bundled wasm, don't ship a mismatch
    fs.mkdirSync(path.dirname(WASM_OUT), { recursive: true });
    fs.writeFileSync(WASM_OUT, buffer);
    reloadWasm();
  } catch { /* best-effort refresh */ }
}

async function runCapture(store) {
  const browser = findBrowser();
  if (!browser) {
    state = { status: "failed", message: "No Chrome/Edge/Brave browser found to open the DeepSeek login.", startedAt: Date.now() };
    return;
  }
  const deviceId = ensureDeviceId(store); // stable id reused for the validation call + later chat

  // Persistent dedicated profile: log in once, then the session is remembered on later captures
  // (kept under data/, which is git-ignored). We cannot reuse the user's main running browser —
  // Chrome locks the default profile and same-origin rules block reading the DeepSeek tab's storage.
  const userDir = path.resolve("data", "deepseek-profile");
  fs.mkdirSync(userDir, { recursive: true });
  const port = 9412 + Math.floor(Math.random() * 400);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    "--remote-allow-origins=*",      // Chrome 111+ rejects CDP websockets without this
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--new-window",
    LOGIN_URL
  ];
  child = spawn(browser, args, { stdio: "ignore", detached: false });
  child.on("error", () => { state = { status: "failed", message: "Could not launch the browser. Close any window using the A.U.R.A DeepSeek profile and retry.", startedAt: Date.now() }; });
  child.on("exit", (code) => {
    // If the window closed before we captured anything, say so instead of hanging until timeout.
    // (A successful/cancelled run has already moved state away from "waiting", so this won't clobber it.)
    if (state.status === "waiting") {
      state = { status: "failed", message: `The browser closed before the token was captured (exit ${code}). If a window flashed open and shut, another Chrome/Edge is holding this profile — close it and try again.`, startedAt: state.startedAt };
    }
  });

  let client;
  try {
    await cdpVersion(port, 50);
    // Attach to the DeepSeek tab.
    const targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json());
    const target = targets.find((t) => t.type === "page" && String(t.url).includes("deepseek.com")) || targets.find((t) => t.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error("No debuggable DeepSeek tab.");
    client = cdpClient(target.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Runtime.enable");

    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (state.status !== "waiting") break; // cancelled
      const result = await client.send("Runtime.evaluate", {
        expression: "(function(){try{var ls={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);ls[k]=localStorage.getItem(k);}return JSON.stringify({ls:ls,cookie:document.cookie});}catch(e){return JSON.stringify({ls:{},cookie:''});}})()",
        returnByValue: true
      });
      let dump = { ls: {}, cookie: "" };
      try { dump = JSON.parse(String(result?.result?.result?.value || "{}")); } catch { /* keep default */ }
      const token = extractToken(dump.ls, dump.cookie);
      if (token) {
        // Verify it's a REAL, usable token (not a logged-out placeholder) before saving.
        let verdict;
        try { verdict = await deepSeekValidateToken({ token, deviceId }); }
        catch { verdict = { ok: false, networkError: true }; }
        if (verdict.authFailed) {
          // Token present but rejected (e.g. stale value in storage) — keep waiting for a real login.
          await new Promise((r) => setTimeout(r, POLL_MS));
          continue;
        }
        store.saveAiSettings({ ...store.getAiSettings(), deepseekToken: token, provider: "deepseek-web" });
        state = {
          status: "captured",
          message: verdict.ok
            ? "DeepSeek token captured and verified — chat is ready."
            : "DeepSeek token captured and saved (could not verify live right now).",
          startedAt: state.startedAt
        };
        await refreshWasm(client); // opportunistically refresh the PoW wasm while the real page is open
        client.ws.close();
        cleanup();
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    if (state.status === "waiting") state = { status: "failed", message: "Timed out waiting for login.", startedAt: state.startedAt };
  } catch (error) {
    state = { status: "failed", message: `Login capture failed: ${error.message}`, startedAt: Date.now() };
  } finally {
    try { client?.ws.close(); } catch { /* ignore */ }
    cleanup();
  }
}

function startDeepSeekLogin(store) {
  if (state.status === "waiting") return { status: "waiting", message: "A login capture is already running." };
  state = { status: "waiting", message: "Opening the browser — log in to DeepSeek; the token is captured automatically.", startedAt: Date.now() };
  runCapture(store).catch((error) => { state = { status: "failed", message: error.message, startedAt: Date.now() }; });
  return state;
}

function deepSeekLoginStatus() {
  return state;
}

function cancelDeepSeekLogin() {
  if (state.status === "waiting") state = { status: "idle", message: "Login cancelled.", startedAt: 0 };
  cleanup();
  return state;
}

module.exports = { startDeepSeekLogin, deepSeekLoginStatus, cancelDeepSeekLogin };
