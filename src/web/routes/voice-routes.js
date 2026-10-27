"use strict";

const { readBody, sendJson } = require("../http-utils");
const { voiceEngine } = require("../services/voice-engine");

// AURI's local voice engine: pack status, opt-in install/remove, and speech as raw PCM.
function getVoiceStatus({ response }) {
  sendJson(response, voiceEngine().status());
}

async function installVoicePack({ request, response }) {
  const body = await readBody(request);
  sendJson(response, voiceEngine().install(String(body.pack || "")));
}

async function removeVoicePack({ request, response }) {
  const body = await readBody(request);
  sendJson(response, voiceEngine().remove(String(body.pack || "")));
}

// 200: mono float32 little-endian samples (X-Sample-Rate, X-Gen-Ms). 204: skipped because a newer line arrived.
async function speakVoice({ request, response }) {
  const body = await readBody(request);
  const result = await voiceEngine().speak({ pack: String(body.pack || ""), voice: String(body.voice || ""), speed: body.speed, text: body.text, low: body.low === true });
  if (result.skipped) { response.writeHead(204, { "Cache-Control": "no-store" }); response.end(); return; }
  if (result.error) { sendJson(response, { error: result.error }, 503); return; }
  const pcm = Buffer.from(result.data.buffer, result.data.byteOffset, result.data.byteLength);
  response.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Content-Length": pcm.length,
    "X-Sample-Rate": String(result.rate),
    "X-Gen-Ms": String(result.ms),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(pcm);
}

module.exports = [
  { method: "GET", path: "/api/voice/status", handler: getVoiceStatus },
  { method: "POST", path: "/api/voice/install", handler: installVoicePack },
  { method: "POST", path: "/api/voice/remove", handler: removeVoicePack },
  { method: "POST", path: "/api/voice/speak", handler: speakVoice }
];
