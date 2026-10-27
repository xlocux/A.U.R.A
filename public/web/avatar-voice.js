"use strict";

// Auri's voice engine. Two engines, both free and local:
//  - "browser": the OS text-to-speech (instant, flat).
//  - "kokoro":  a neural voice (Apache-2.0). The user downloads it from Settings > AURI Character > Voice; the
//               browser caches it, it runs in a Web Worker (WebGPU when available, otherwise CPU/WASM).
// Kokoro has no emotion switch, so emotion is built around it: voice and speed per mood, WebAudio effects
// (pitch, low-pass, drive, echo, vibrato) and punctuation shaping.
// Sync with the bubbles: she finishes the sentence she is saying, then says the LATEST bubble (older pending lines
// are dropped), and the bubble stays up until she has finished it ("aura:speech" event).
(function initAvatarVoice() {
  const KEY = "aura.speech";
  const KOKORO_URL = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";
  const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
  const MODEL_FILES = { q8: "onnx/model_quantized.onnx", fp32: "onnx/model.onnx" };
  const MODEL_SIZE = { q8: "92 MB", fp32: "326 MB" };
  const synth = window.speechSynthesis;
  const defaults = { on: false, engine: "browser", voice: "auto", volume: 0.85, model: "q8" };
  // WebGPU counts only when a real adapter answers (the API can exist without a usable GPU).
  let gpuOk = false;
  const gpuCheck = (navigator.gpu ? navigator.gpu.requestAdapter().then((a) => { gpuOk = Boolean(a); }, () => {}) : Promise.resolve()).then(() => emit());
  let cfg = { ...defaults };
  try { cfg = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* first run */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage unavailable */ } };
  const level = () => Number(document.documentElement.dataset.avatarVoice ?? 2);
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(info()));

  // ── emotions ── speed = Kokoro speed, rate = playback rate (pitch + tempo), lp = low-pass Hz, drive = distortion,
  // echo = tail, vib = vibrato cents. Female voices only: Auri is a she.
  const EMOTIONS = {
    neutral: { voice: "af_heart", speed: 1.0, rate: 1.0, gain: 1 },
    happy: { voice: "af_bella", speed: 1.08, rate: 1.06, gain: 1.05 },
    hyped: { voice: "af_bella", speed: 1.22, rate: 1.1, gain: 1.15, vib: 14 },
    adrenaline: { voice: "af_nicole", speed: 1.32, rate: 1.12, gain: 1.2, drive: 0.15 },
    bored: { voice: "af_nicole", speed: 0.8, rate: 0.93, gain: 0.85, lp: 2600 },
    sulk: { voice: "af_sky", speed: 0.85, rate: 0.9, gain: 0.9, lp: 3200 },
    angry: { voice: "af_bella", speed: 1.15, rate: 0.9, gain: 1.2, drive: 0.45 },
    rage: { voice: "af_nicole", speed: 1.18, rate: 0.8, gain: 1.35, drive: 0.85, echo: 0.2 },
    creepy: { voice: "af_nicole", speed: 0.88, rate: 0.82, gain: 1, echo: 0.3, lp: 4200 },
    sing: { voice: "af_heart", speed: 0.92, rate: 1.1, gain: 1.05, vib: 45, echo: 0.15 },
    shout: { voice: "af_bella", speed: 1.0, rate: 1.05, gain: 1.5, drive: 0.35, echo: 0.45 } // anime battle cry
  };
  const VOICES = ["af_heart", "af_bella", "af_nicole", "af_sky", "af_sarah", "bf_emma", "bf_isabella"];

  function inferEmotion(text, opts) {
    if (opts.emotion) return opts.emotion;
    if (opts.loud) return "rage";
    const t = String(text);
    const letters = t.replace(/[^A-Za-z]/g, "");
    const shouting = letters.length > 6 && letters === letters.toUpperCase();
    if (/[♪♫♬]/.test(t)) return "sing";
    if (shouting && /!/.test(t)) return level() >= 4 ? "rage" : "angry";
    if (/#@|[#@%&*$]{2}|ow!|ouch|hands off|poke/i.test(t)) return "angry";
    if (/\.\.\.|yawn|zzz|boring|nothing|glacier|sleep/i.test(t) && !/!/.test(t)) return "bored";
    if (/sorry|okay\.|fine\.|lost my temper|i'm back|regret/i.test(t)) return "sulk";
    if (/yatta|sugoi|banzai|kita|jackpot|found it|adrenaline|power level|nailed|yes yes|got you/i.test(t)) return "hyped";
    if (/!/.test(t)) return level() >= 3 ? "hyped" : "happy";
    return level() >= 4 ? "creepy" : "neutral";
  }
  function clean(text) {
    return String(text || "")
      .replace(/[♪♫♬♩]/g, "")
      .replace(/(?:[#@%&*$]\w?){3,}|[#@%&*$!?]{3,}/g, " beep ")
      .replace(/\b\w*[#@%&*$]\w*[#@%&*$]\w*\b/g, " beep ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260);
  }
  function shape(text, emo) {
    let t = clean(String(text).split("\n").join(". "));
    if (emo === "bored") t = "Mmm... " + t.replace(/[.!]+$/, "") + "...";
    if (emo === "sulk") t = t.replace(/^\.+\s*/, "");
    if (emo === "rage" || emo === "angry" || emo === "shout") t = t.replace(/\b([A-Z]{3,})\b/g, (w) => w[0] + w.slice(1).toLowerCase());
    if (emo === "rage" || emo === "angry") t = t.replace(/!+/g, "!!");
    return t;
  }
  const pickVoice = (emo) => (cfg.voice && cfg.voice !== "auto" && VOICES.includes(cfg.voice) ? cfg.voice : (EMOTIONS[emo] || EMOTIONS.neutral).voice);

  // ── model download state ──
  // workerState: idle (not loaded) | loading | ready | failed. downloaded: the model is in the browser cache.
  let worker = null, workerState = "idle", progress = 0, downloaded = false, device = "", message = "", lastGen = null, seq = 0;
  let rtf = null, generating = 0; // rtf = generation time / speech time (moving average); > 1 means slower than real time
  const waiting = new Map();
  const modelUrl = (m) => `https://huggingface.co/${MODEL}/resolve/main/${MODEL_FILES[m]}`;
  async function checkDownloaded() {
    try { downloaded = Boolean(await (await caches.open("transformers-cache")).match(modelUrl(cfg.model))); } catch { downloaded = false; }
    emit();
    return downloaded;
  }

  // The worker keeps only the newest request waiting: stale lines are skipped instead of piling up.
  const WORKER_SRC = `
    import { KokoroTTS } from "${KOKORO_URL}";
    let tts = null, busy = false, next = null;
    const run = async (m) => {
      busy = true;
      try {
        const a = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
        const data = new Float32Array(a.audio);
        self.postMessage({ type: "audio", id: m.id, data, rate: a.sampling_rate }, [data.buffer]);
      } catch (err) { self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) }); }
      busy = false;
      if (next) { const n = next; next = null; run(n); }
    };
    self.onmessage = async (e) => {
      const m = e.data;
      if (m.type === "load") {
        const tryLoad = (device, dtype) => KokoroTTS.from_pretrained("${MODEL}", { dtype, device, progress_callback: (p) => self.postMessage({ type: "progress", p }) });
        try {
          try { tts = await tryLoad(m.device, m.dtype); self.postMessage({ type: "ready", device: m.device }); }
          catch (err) { if (m.device === "wasm") throw err; tts = await tryLoad("wasm", "q8"); self.postMessage({ type: "ready", device: "wasm" }); }
        } catch (err) { self.postMessage({ type: "error", message: String((err && err.message) || err) }); }
      } else if (m.type === "gen") {
        if (!busy) { run(m); return; }
        if (m.low && next) { self.postMessage({ type: "skipped", id: m.id }); return; }
        if (next) self.postMessage({ type: "skipped", id: next.id });
        next = m;
      }
    };`;
  function load() {
    if (worker || workerState === "loading") return;
    workerState = "loading"; progress = 0; message = ""; emit();
    try { worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: "text/javascript" })), { type: "module" }); }
    catch (err) { workerState = "failed"; message = err.message; emit(); return; }
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") { const p = m.p || {}; if (p.status === "progress" && Number.isFinite(p.progress) && /onnx/.test(p.file || "")) { progress = Math.round(p.progress); emit(); } }
      else if (m.type === "ready") { workerState = "ready"; device = m.device; downloaded = true; emit(); }
      else if (m.type === "audio" || m.type === "skipped") { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(m.type === "audio" ? m : null); } }
      else if (m.type === "error") {
        if (m.id) { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w(null); } }
        else { workerState = "failed"; message = m.message; worker.terminate(); worker = null; emit(); }
      }
    };
    worker.onerror = (e) => { workerState = "failed"; message = e.message || "worker error (offline?)"; worker = null; emit(); };
    const gpu = cfg.model === "fp32" && gpuOk;
    worker.postMessage({ type: "load", device: gpu ? "webgpu" : "wasm", dtype: gpu ? "fp32" : "q8" });
  }
  async function remove() {
    stop();
    if (worker) { worker.terminate(); worker = null; }
    workerState = "idle"; progress = 0;
    try { await caches.delete("transformers-cache"); } catch { /* nothing cached */ }
    cfg.engine = "browser"; save();
    await checkDownloaded();
  }

  const cache = new Map();
  function generate(text, emoName, low = false) {
    const emo = EMOTIONS[emoName] || EMOTIONS.neutral;
    const line = shape(text, emoName);
    const voice = pickVoice(emoName);
    const key = `${voice}|${emo.speed}|${line}`;
    if (!line) return Promise.resolve(null);
    if (cache.has(key)) return Promise.resolve({ ...cache.get(key), emo });
    if (workerState !== "ready") return Promise.resolve(null);
    const id = ++seq, t0 = performance.now();
    generating += 1; emit();
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({ type: "gen", id, text: line, voice, speed: emo.speed, low });
      setTimeout(() => { if (waiting.has(id)) { waiting.delete(id); resolve(null); } }, 30000);
    }).then((m) => {
      generating -= 1;
      if (!m) { emit(); return null; }
      const audio = { data: m.data, rate: m.rate };
      lastGen = { ms: Math.round(performance.now() - t0), seconds: Math.round((m.data.length / m.rate) * 10) / 10, emotion: emoName, voice };
      const r = lastGen.ms / Math.max(200, (m.data.length / m.rate) * 1000);
      rtf = rtf == null ? r : rtf * 0.6 + r * 0.4;
      emit();
      cache.set(key, audio);
      if (cache.size > 80) cache.delete(cache.keys().next().value);
      return { ...audio, emo };
    });
  }

  // ── playback ──
  let ctx = null, current = null;
  function stopCurrent() { if (current) { try { current.stop(); } catch { /* already stopped */ } current = null; } }
  function curve(amount) {
    const n = 256, c = new Float32Array(n), k = amount * 60;
    for (let i = 0; i < n; i += 1) { const x = (i / (n - 1)) * 2 - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return c;
  }
  function play(audio, emo, volume, onStart) {
    return new Promise((resolve) => {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      stopCurrent();
      const buf = ctx.createBuffer(1, audio.data.length, audio.rate);
      buf.copyToChannel(audio.data, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = emo.rate || 1;
      let node = src, lfo = null;
      if (emo.vib) { lfo = ctx.createOscillator(); const depth = ctx.createGain(); lfo.frequency.value = 6; depth.gain.value = emo.vib; lfo.connect(depth); depth.connect(src.detune); lfo.start(); }
      if (emo.lp) { const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = emo.lp; node.connect(f); node = f; }
      if (emo.drive) { const s = ctx.createWaveShaper(); s.curve = curve(emo.drive); s.oversample = "2x"; node.connect(s); node = s; }
      const gain = ctx.createGain();
      gain.gain.value = Math.min(1.6, volume * (emo.gain || 1));
      node.connect(gain); gain.connect(ctx.destination);
      if (emo.echo) { const d = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain(); d.delayTime.value = 0.17; fb.gain.value = 0.38; wet.gain.value = emo.echo * 2; gain.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(ctx.destination); }
      const seconds = audio.data.length / audio.rate / (emo.rate || 1);
      let done = false;
      const finish = () => { if (done) return; done = true; if (lfo) try { lfo.stop(); } catch { /* stopped */ } if (current === src) current = null; resolve(); };
      src.onended = finish;
      current = src;
      src.start();
      onStart(seconds * 1000);
      setTimeout(finish, seconds * 1000 + 1200);
    });
  }
  function speakBrowser(item, onStart) {
    return new Promise((resolve) => {
      if (!synth) return resolve();
      const line = clean(String(item.text).split("\n").join(". "));
      if (!line) return resolve();
      const u = new SpeechSynthesisUtterance(line);
      const list = synth.getVoices();
      const v = list.find((x) => x.voiceURI === cfg.voice) || list.find((x) => /^en/i.test(x.lang) && /female|zira|aria|jenny|samantha|hazel|susan/i.test(x.name)) || list.find((x) => /^en/i.test(x.lang));
      if (v) { u.voice = v; u.lang = v.lang; }
      u.volume = Math.min(1, cfg.volume * (item.opts.loud ? 1.25 : 1));
      u.pitch = { rage: 0.5, angry: 0.7, creepy: 0.6, bored: 0.85, hyped: 1.4, adrenaline: 1.5, happy: 1.25, shout: 1.2 }[item.emoName] ?? 1.1;
      u.rate = { rage: 1.2, angry: 1.1, creepy: 0.85, bored: 0.8, hyped: 1.25, adrenaline: 1.35, sulk: 0.85 }[item.emoName] ?? 1;
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      let started = false;
      u.onstart = () => { started = true; onStart(line.split(/\s+/).length * 380 + 600); };
      u.onend = u.onerror = finish;
      synth.speak(u);
      setTimeout(() => { if (!started) finish(); }, 2500); // no speech engine answered: never block the queue
      setTimeout(finish, 20000);
    });
  }

  // ── queue: one line playing, at most one (the newest) waiting ──
  let currentItem = null, pending = null, played = 0;
  async function pump() {
    if (currentItem || !pending) return;
    const item = pending;
    pending = null;
    currentItem = item;
    try {
      // When Kokoro is known to be too slow, do not keep the bubble waiting: unless the audio is (almost) ready, use the browser voice.
      const wait = tooSlow() && !item.opts.force ? Promise.race([item.ready, new Promise((r) => setTimeout(() => r(null), 400))]) : item.ready;
      const audio = item.ready ? await wait : null;
      if (item.cancelled) return;
      // A newer bubble arrived while this one was being prepared: saying the old one now would be out of sync.
      if (pending && !item.opts.force && !item.opts.loud) return;
      // the bubble learns how long it has to stay up for this line
      const onStart = (ms) => { played += 1; window.dispatchEvent(new CustomEvent("aura:speech", { detail: { text: item.text, ms } })); };
      if (audio) await play(audio, audio.emo, cfg.volume * (item.opts.loud ? 1.2 : 1), onStart);
      else await speakBrowser(item, onStart);
    } finally { currentItem = null; pump(); }
  }

  let hinted = null;
  const hint = (emotion) => { hinted = { emotion, t: Date.now() }; };
  const estimate = (text) => (cfg.on ? Math.round(String(text).split(/\s+/).length * 380 + 700) : 0);
  const useKokoro = () => cfg.engine === "kokoro" && workerState === "ready";
  const tooSlow = () => rtf != null && rtf > 1.3;
  const isCached = (text, emoName) => { const emo = EMOTIONS[emoName] || EMOTIONS.neutral; return cache.has(`${pickVoice(emoName)}|${emo.speed}|${shape(text, emoName)}`); };

  function speak(text, opts = {}) {
    if (!cfg.on || document.hidden) return;
    if (hinted && Date.now() - hinted.t < 1500 && !opts.emotion) opts = { ...opts, emotion: hinted.emotion };
    hinted = null;
    const item = { text, opts, emoName: inferEmotion(text, opts), cancelled: false };
    if (opts.loud || opts.interrupt || item.emoName === "rage") { if (currentItem) currentItem.cancelled = true; stopCurrent(); if (synth) synth.cancel(); }
    if (pending) pending.cancelled = true; // only the latest bubble is worth saying
    item.ready = useKokoro() && (!tooSlow() || opts.force || isCached(text, item.emoName)) ? generate(text, item.emoName) : null;
    pending = item;
    pump();
  }
  function stop() { if (pending) pending.cancelled = true; pending = null; if (currentItem) currentItem.cancelled = true; stopCurrent(); if (synth) synth.cancel(); }

  // Lines that must land on time (battle cries) are generated ahead, only while she is silent.
  const prefetchList = [];
  function prefetch(lines) {
    prefetchList.push(...lines);
    const tick = async () => {
      if (!prefetchList.length) return;
      if (!cfg.on || !useKokoro() || currentItem || pending || waiting.size) { setTimeout(tick, 2500); return; }
      const [text, emotion] = prefetchList.shift();
      await generate(text, emotion, true);
      setTimeout(tick, 400);
    };
    setTimeout(tick, 3000);
  }

  const info = () => ({ cfg: { ...cfg }, workerState, progress, downloaded, device, message, lastGen, played, rtf, generating, slow: tooSlow(), sizes: MODEL_SIZE, gpu: gpuOk, voices: VOICES });
  function set(patch) {
    const before = cfg.model;
    cfg = { ...cfg, ...patch };
    save();
    if (patch.on === false || patch.engine) stop();
    if (cfg.model !== before) { if (worker) { worker.terminate(); worker = null; } workerState = "idle"; checkDownloaded(); }
    if (cfg.on && cfg.engine === "kokoro" && downloaded) load();
    emit();
  }

  gpuCheck.then(() => checkDownloaded()).then((ok) => { if (ok && cfg.on && cfg.engine === "kokoro") setTimeout(load, 3000); });
  window.AuraSpeech = {
    speak, stop, hint, estimate, prefetch, set, download: load, remove, info,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    state: info, isOn: () => cfg.on, emotions: Object.keys(EMOTIONS)
  };
})();
