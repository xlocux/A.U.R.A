"use strict";

// Experimental DeepSeek web login capture: opens a real (non-headless) browser at chat.deepseek.com,
// lets the user log in, then reads the `userToken` from the page's localStorage over CDP and saves it
// into AI settings. Nothing is scraped beyond the one token the browser already holds for the user.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const LOGIN_URL = "https://chat.deepseek.com/";
const POLL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000;

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

async function runCapture(store) {
  const browser = findBrowser();
  if (!browser) {
    state = { status: "failed", message: "No Chrome/Edge/Brave browser found to open the DeepSeek login.", startedAt: Date.now() };
    return;
  }
  // Persistent dedicated profile: log in once, then the session is remembered on later captures
  // (kept under data/, which is git-ignored). We cannot reuse the user's main running browser —
  // Chrome locks the default profile and same-origin rules block reading the DeepSeek tab's storage.
  const userDir = path.resolve("data", "deepseek-profile");
  fs.mkdirSync(userDir, { recursive: true });
  const port = 9412 + Math.floor(Math.random() * 400);
  child = spawn(browser, [`--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, "--new-window", LOGIN_URL], { stdio: "ignore", detached: false });
  child.on("error", () => { state = { status: "failed", message: "Could not launch the browser.", startedAt: Date.now() }; });

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
        expression: "(function(){try{return localStorage.getItem('userToken')||''}catch(e){return ''}})()",
        returnByValue: true
      });
      const token = String(result?.result?.result?.value || "").trim();
      if (token) {
        store.saveAiSettings({ ...store.getAiSettings(), deepseekToken: token, provider: "deepseek-web" });
        state = { status: "captured", message: "DeepSeek session token captured and saved.", startedAt: state.startedAt };
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
