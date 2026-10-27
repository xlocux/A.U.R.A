"use strict";

// AURI's local voice engine (opt-in, Settings > AURI Character > Voice). Nothing ships with A.U.R.A: on request it
// installs a small runtime (onnxruntime-node + the eSpeak NG phonemizer, via npm) and downloads voice packs from
// Hugging Face into data/voice/. Speech is generated here, on this PC, by a child process (voice-worker.js) so the
// web server never blocks. Packs are pinned to a commit and the big model files are checked against their SHA-256.
//   piper-*  : Piper voices (MIT runtime, public-domain datasets), ~63 MB each, several times faster than real time.
//   kokoro   : Kokoro-82M (Apache-2.0) fp32, ~330 MB, the most expressive; fp32 because the int8 model is slower on CPU.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork, spawn } = require("node:child_process");

const RUNTIME_DEPS = { "onnxruntime-node": "1.21.0", phonemizer: "1.2.1" };
const KOKORO_VOICES = ["af_heart", "af_bella", "af_nicole", "af_sky", "af_sarah", "bf_emma", "bf_isabella"];
const KOKORO_BASE = "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/";
const PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/";
const RUNTIME_BYTES = 40e6;

const PACKS = {
  "piper-linda": {
    engine: "piper", label: "Piper - Linda (US)", note: "very fast", bytes: 63.5e6,
    files: [
      { url: `${PIPER_BASE}en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`, to: "model.onnx", sha256: "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22" },
      { url: `${PIPER_BASE}en_US/ljspeech/medium/en_US-ljspeech-medium.onnx.json`, to: "model.onnx.json" }
    ]
  },
  "piper-cori": {
    engine: "piper", label: "Piper - Cori (UK)", note: "very fast", bytes: 63.5e6,
    files: [
      { url: `${PIPER_BASE}en_GB/cori/medium/en_GB-cori-medium.onnx`, to: "model.onnx", sha256: "1899f98e5fb8310154f3c2973f4b8a929ba7245e722b3d3a85680b833d95f10d" },
      { url: `${PIPER_BASE}en_GB/cori/medium/en_GB-cori-medium.onnx.json`, to: "model.onnx.json" }
    ]
  },
  kokoro: {
    engine: "kokoro", label: "Kokoro - 7 voices", note: "most expressive", bytes: 330e6,
    files: [
      { url: `${KOKORO_BASE}onnx/model.onnx`, to: "model.onnx", sha256: "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb" },
      { url: `${KOKORO_BASE}tokenizer.json`, to: "tokenizer.json" },
      ...[...KOKORO_VOICES, "jf_alpha"].map((v) => ({ url: `${KOKORO_BASE}voices/${v}.bin`, to: `voices/${v}.bin` })) // jf_alpha: Japanese battle cries
    ]
  }
};

const cleanText = (text) => String(text || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 400);
const clampSpeed = (value) => (Number.isFinite(Number(value)) ? Math.max(0.5, Math.min(2, Number(value))) : 1);
// Leave half the cores to the scans; past ~8 threads the small model only gets slower on laptop CPUs.
const workerThreads = () => Math.max(2, Math.min(8, Math.floor((os.availableParallelism?.() || os.cpus().length) / 2)));

// packs and fetchImpl can be replaced (tests).
function createVoiceEngine({ root = path.resolve("data", "voice"), fetchImpl = globalThis.fetch, packs = PACKS } = {}) {
  const runtimeDir = path.join(root, "runtime");
  const packDir = (id) => path.join(root, "packs", id);
  const runtimeReady = () => Object.keys(RUNTIME_DEPS).every((dep) => fs.existsSync(path.join(runtimeDir, "node_modules", dep, "package.json")));
  const packReady = (id) => fs.existsSync(path.join(packDir(id), ".complete"));

  let job = null; // { pack, phase: "runtime" | "download", progress, error, done }
  let worker = null, workerState = "stopped", workerError = "", failedAt = 0, idleTimer = null, seq = 0;
  const waiting = new Map();
  let busy = null, pending = null; // one line generating, at most one (the newest) waiting

  function status() {
    return {
      runtime: { installed: runtimeReady(), bytes: RUNTIME_BYTES },
      packs: Object.entries(packs).map(([id, p]) => ({ id, engine: p.engine, label: p.label, note: p.note, bytes: p.bytes, installed: packReady(id) })),
      job: job ? { ...job } : null,
      worker: { state: workerState, error: workerError, threads: workerThreads() },
      kokoroVoices: KOKORO_VOICES
    };
  }

  // ── install ──
  function npmCommand() {
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (fs.existsSync(cli)) return { cmd: process.execPath, args: [cli], shell: false };
    return { cmd: process.platform === "win32" ? "npm.cmd" : "npm", args: [], shell: process.platform === "win32" };
  }
  function installRuntime() {
    fs.mkdirSync(runtimeDir, { recursive: true });
    fs.writeFileSync(path.join(runtimeDir, "package.json"), JSON.stringify({ name: "aura-voice-runtime", private: true, dependencies: RUNTIME_DEPS }, null, 2));
    const { cmd, args, shell } = npmCommand();
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, [...args, "install", "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error"], { cwd: runtimeDir, shell, windowsHide: true });
      let log = "";
      const keep = (chunk) => { log = (log + chunk).slice(-2000); };
      child.stdout.on("data", keep);
      child.stderr.on("data", keep);
      child.on("error", (error) => reject(new Error(`npm could not start: ${error.message}`)));
      child.on("close", (code) => (code === 0 && runtimeReady() ? resolve() : reject(new Error(`npm install failed (${code}): ${log.trim().split("\n").pop() || "no output"}`))));
    }).then(() => pruneRuntime());
  }
  // onnxruntime-node ships the binaries of every OS; only this one is ever loaded.
  function pruneRuntime() {
    const bin = path.join(runtimeDir, "node_modules", "onnxruntime-node", "bin", "napi-v3");
    for (const platform of safeList(bin)) {
      if (platform !== process.platform) { fs.rmSync(path.join(bin, platform), { recursive: true, force: true }); continue; }
      for (const arch of safeList(path.join(bin, platform))) {
        if (arch !== process.arch) fs.rmSync(path.join(bin, platform, arch), { recursive: true, force: true });
      }
    }
  }

  async function download(file, target, onBytes) {
    const response = await fetchImpl(file.url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`download failed (${response.status}) for ${path.basename(file.to)}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const part = `${target}.part`;
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(part);
    try {
      for await (const chunk of response.body) {
        hash.update(chunk);
        onBytes(chunk.length);
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
      }
      await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
    } catch (error) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw error;
    }
    if (file.sha256 && hash.digest("hex") !== file.sha256) {
      fs.rmSync(part, { force: true });
      throw new Error(`${path.basename(file.to)} is corrupted (checksum mismatch); try again`);
    }
    fs.renameSync(part, target);
  }

  async function runInstall(id) {
    const pack = packs[id];
    try {
      if (!runtimeReady()) { job.phase = "runtime"; await installRuntime(); }
      job.phase = "download";
      const dir = packDir(id);
      fs.rmSync(dir, { recursive: true, force: true });
      let got = 0;
      for (const file of pack.files) {
        await download(file, path.join(dir, file.to), (n) => { got += n; job.progress = Math.min(99, Math.round((got / pack.bytes) * 100)); });
      }
      fs.writeFileSync(path.join(dir, ".complete"), new Date().toISOString());
      job = { ...job, progress: 100, done: true };
    } catch (error) {
      fs.rmSync(packDir(id), { recursive: true, force: true }); // no half-downloaded packs
      job = { ...job, error: error.message, done: true };
    }
  }
  function install(id) {
    if (!packs[id]) throw Object.assign(new Error("Unknown voice pack"), { statusCode: 400 });
    if (job && !job.done) throw Object.assign(new Error("Another voice download is running"), { statusCode: 409 });
    job = { pack: id, phase: runtimeReady() ? "download" : "runtime", progress: 0, error: "", done: false };
    runInstall(id);
    return status();
  }
  function remove(id) {
    if (!packs[id]) throw Object.assign(new Error("Unknown voice pack"), { statusCode: 400 });
    if (job && !job.done && job.pack === id) throw Object.assign(new Error("This pack is downloading"), { statusCode: 409 });
    stopWorker();
    fs.rmSync(packDir(id), { recursive: true, force: true });
    // the runtime is only worth keeping while at least one pack uses it
    if (!Object.keys(packs).some(packReady) && !(job && !job.done)) fs.rmSync(runtimeDir, { recursive: true, force: true });
    return status();
  }

  // ── speech ──
  function startWorker() {
    if (worker) return worker;
    workerState = "starting"; workerError = "";
    const w = fork(path.join(__dirname, "voice-worker.js"), [runtimeDir, path.join(root, "packs"), String(workerThreads())], { serialization: "advanced", windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    worker = w;
    let stderr = "";
    w.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1500); });
    w.on("message", (m) => {
      if (m.type === "ready") { workerState = "ready"; return; }
      const done = waiting.get(m.id);
      if (!done) return;
      waiting.delete(m.id);
      done(m.type === "audio" ? m : { error: m.message || "generation failed" });
    });
    w.on("exit", (code) => {
      if (worker !== w) return; // an old worker that was stopped on purpose
      worker = null;
      workerState = code ? "failed" : "stopped";
      workerError = code ? (stderr.trim().split("\n").pop() || `voice worker exited (${code})`) : "";
      if (code) failedAt = Date.now();
      failWaiting("voice worker stopped");
    });
    return w;
  }
  function failWaiting(message) {
    for (const done of waiting.values()) done({ error: message });
    waiting.clear();
  }
  function stopWorker() {
    clearTimeout(idleTimer);
    if (!worker) return;
    const w = worker;
    worker = null;
    workerState = "stopped";
    w.kill();
    failWaiting("voice worker stopped");
  }
  // Free the memory (the Kokoro model alone takes several hundred MB) when she has been quiet for a while.
  const touch = () => { clearTimeout(idleTimer); idleTimer = setTimeout(stopWorker, 10 * 60 * 1000); idleTimer.unref?.(); };

  function generate(req) {
    // a worker that just crashed is not restarted for every bubble
    if (workerState === "failed" && Date.now() - failedAt < 30000) return Promise.resolve({ error: workerError || "voice worker failed" });
    return new Promise((resolve) => {
      const id = ++seq;
      waiting.set(id, resolve);
      startWorker().send({ type: "speak", id, ...req });
      setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve({ error: "voice generation timed out" }); } }, 45000).unref?.();
    });
  }
  async function pump() {
    if (busy || !pending) return;
    const item = pending;
    pending = null;
    busy = item;
    const t0 = Date.now();
    const result = await generate(item.req);
    busy = null;
    item.resolve(result.error ? result : { data: result.data, rate: result.rate, ms: Date.now() - t0 });
    pump();
  }
  // Latest wins: a line still waiting when a newer one arrives is skipped (the bubble it belonged to is gone).
  function speak({ pack, voice, speed, text, lang = "", low = false }) {
    if (!packs[pack]) throw Object.assign(new Error("Unknown voice pack"), { statusCode: 400 });
    if (!runtimeReady() || !packReady(pack)) throw Object.assign(new Error("Voice pack not installed"), { statusCode: 409 });
    const line = cleanText(text);
    if (!line) return Promise.resolve({ skipped: true });
    const kokoroVoice = KOKORO_VOICES.includes(voice) ? voice : KOKORO_VOICES[0];
    const req = { engine: packs[pack].engine, pack, voice: kokoroVoice, speed: clampSpeed(speed), text: line, lang: lang === "ja" ? "ja" : "" };
    touch();
    return new Promise((resolve) => {
      if ((busy || pending) && low) { resolve({ skipped: true }); return; }
      if (pending) pending.resolve({ skipped: true });
      pending = { req, resolve };
      pump();
    });
  }

  return { status, install, remove, speak, stop: stopWorker, packs };
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

let shared = null;
const voiceEngine = () => (shared = shared || createVoiceEngine());

module.exports = { createVoiceEngine, voiceEngine, cleanText, clampSpeed, PACKS, KOKORO_VOICES };
