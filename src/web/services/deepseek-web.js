"use strict";

// Experimental chat.deepseek.com web client. Drives the user's logged-in session with their token,
// behaving like a single real browser user: stable device id + realistic headers, one chat session
// reused across messages, and exactly one completion request per message (the caller serializes).

const crypto = require("node:crypto");
const { powResponseHeader } = require("./deepseek-pow");

const BASE = "https://chat.deepseek.com/api/v0";
const COMPLETION_PATH = "/api/v0/chat/completion";
const UPLOAD_PATH = "/api/v0/file/upload_file";
const HTTP_TIMEOUT_MS = 60000;

// Reused per token so we don't create a new chat session on every message.
let session = { token: null, id: null, parentId: null };

function browserHeaders(token, deviceId) {
  return {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Authorization": `Bearer ${token}`,
    "Origin": "https://chat.deepseek.com",
    "Referer": "https://chat.deepseek.com/",
    "x-client-platform": "web",
    "x-client-version": "2.7.0",
    "x-client-locale": "en_US",
    "x-client-timezone-offset": String(new Date().getTimezoneOffset() * -1),
    "x-device-id": deviceId,
    "x-device-model": "",
    "sec-ch-ua": '"Chromium";v="133", "Not(A:Brand";v="24", "Google Chrome";v="133"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin"
  };
}

async function postJson(pathname, body, headers) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  if (res.status === 401 || res.status === 403) throw new Error("DeepSeek session token is invalid or expired — re-run Login to DeepSeek.");
  const data = await res.json().catch(() => ({}));
  if (data.code !== 0) throw new Error(`DeepSeek API error (${pathname}): ${data.msg || res.status}`);
  if (data.data?.biz_code !== 0 && data.data?.biz_code !== undefined) throw new Error(`DeepSeek: ${data.data.biz_msg || "request rejected"}`);
  return data.data?.biz_data;
}

async function ensureSession(token, headers) {
  if (session.token === token && session.id) return session.id;
  const biz = await postJson("/chat_session/create", {}, headers);
  const id = biz?.chat_session?.id;
  if (!id) throw new Error("DeepSeek: could not create a chat session.");
  session = { token, id, parentId: null };
  return id;
}

async function getPowHeader(headers, targetPath = COMPLETION_PATH) {
  const biz = await postJson("/chat/create_pow_challenge", { target_path: targetPath }, headers);
  const challenge = biz?.challenge;
  if (!challenge) throw new Error("DeepSeek: no PoW challenge returned.");
  try {
    return powResponseHeader(challenge);
  } catch (error) {
    // No solution / unsupported algorithm → DeepSeek likely rotated the hash/wasm. Re-running Login
    // refreshes the cached wasm from the live (bot-protected) page.
    throw new Error(`DeepSeek PoW failed (${error.message}). DeepSeek may have updated its challenge — re-run Login to DeepSeek to refresh the solver.`);
  }
}

// Upload a file (as the browser does: PoW for the upload path + multipart "file" field).
async function deepSeekUpload({ token, deviceId, buffer, fileName, contentType }) {
  const headers = browserHeaders(token, deviceId);
  const powHeader = await getPowHeader(headers, UPLOAD_PATH);
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: contentType || "application/octet-stream" }), fileName || "upload.bin");
  const res = await fetch(`${BASE}/file/upload_file`, {
    method: "POST",
    headers: { ...headers, "X-DS-PoW-Response": powHeader }, // do NOT set Content-Type — fetch adds the multipart boundary
    body: form,
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  if (res.status === 401 || res.status === 403) throw new Error("DeepSeek session token is invalid or expired — re-run Login to DeepSeek.");
  const data = await res.json().catch(() => ({}));
  const biz = data.data?.biz_data;
  if (data.code !== 0 || !biz?.id) throw new Error(`DeepSeek upload failed: ${data.data?.biz_msg || data.msg || res.status}`);
  return { id: biz.id, fileName: biz.file_name, isImage: biz.is_image, status: biz.status };
}

// Parse the SSE completion stream into the assistant's text (fragments + v/p/o patch deltas).
function parseCompletionSse(sse) {
  let text = "";
  let appendable = false;
  for (const line of sse.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    let obj;
    try { obj = JSON.parse(raw); } catch { continue; }
    if (obj.v && typeof obj.v === "object" && obj.v.response) {
      for (const frag of obj.v.response.fragments || []) {
        if (frag.type === "RESPONSE" && typeof frag.content === "string") text += frag.content;
      }
      appendable = true;
    } else if (typeof obj.p === "string") {
      appendable = /content$/.test(obj.p) || obj.p.includes("fragments");
      if (appendable && typeof obj.v === "string") text += obj.v;
    } else if (typeof obj.v === "string" && appendable) {
      text += obj.v;
    }
  }
  return text.trim();
}

async function deepSeekChat({ prompt, token, deviceId, fileIds = [] }) {
  const headers = browserHeaders(token, deviceId);
  const sessionId = await ensureSession(token, headers);
  const powHeader = await getPowHeader(headers);
  const res = await fetch(`${BASE}/chat/completion`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "X-DS-PoW-Response": powHeader },
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: session.parentId,
      model_type: "default",
      prompt,
      ref_file_ids: Array.isArray(fileIds) ? fileIds : [],
      thinking_enabled: false,
      search_enabled: false,
      action: null,
      preempt: false
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  if (res.status === 401 || res.status === 403) throw new Error("DeepSeek session token is invalid or expired — re-run Login to DeepSeek.");
  if (!res.ok) throw new Error(`DeepSeek completion failed: HTTP ${res.status}`);
  const sse = await res.text();
  // Track the response message id as the next parent so the session stays coherent.
  const ready = sse.match(/"response_message_id":(\d+)/);
  if (ready) session.parentId = Number(ready[1]);
  const text = parseCompletionSse(sse);
  return text || "DeepSeek returned an empty response.";
}

function resetDeepSeekSession() { session = { token: null, id: null, parentId: null }; }

module.exports = { deepSeekChat, deepSeekUpload, resetDeepSeekSession, ensureDeviceId };

// A stable device id per install, persisted in AI settings (a real browser keeps one).
function ensureDeviceId(store) {
  const settings = store.getAiSettings();
  if (settings.deepseekDeviceId) return settings.deepseekDeviceId;
  const id = crypto.randomUUID();
  store.saveAiSettings({ ...settings, deepseekDeviceId: id });
  return id;
}
