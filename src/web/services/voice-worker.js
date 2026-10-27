"use strict";

// Child process of voice-engine.js: text -> audio with onnxruntime-node, on this PC. Kokoro and Piper share the
// eSpeak NG phonemizer; each model is loaded on first use and kept until the engine stops the process.
// Japanese words (anime battle cries, "Yatta!") skip eSpeak: they are turned into Japanese phonemes (voice-japanese.js).
// argv: <runtime dir> <packs dir> <threads>. Messages in: { type: "speak", id, engine, pack, voice, speed, text, lang }
// (lang "ja": the whole line is romaji).
// Messages out: { type: "ready" } once, then { type: "audio", id, data: Float32Array, rate } or { type: "error", id, message }.

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const japanese = require("./voice-japanese");

const [runtimeDir, packsDir, threadArg] = process.argv.slice(2);
const runtimeRequire = createRequire(path.join(runtimeDir, "package.json"));
const ort = runtimeRequire("onnxruntime-node");
const { phonemize } = runtimeRequire("phonemizer");
const sessionOptions = { executionProviders: ["cpu"], graphOptimizationLevel: "all", intraOpNumThreads: Number(threadArg) || 4 };
const models = new Map();

// Punctuation is kept as is (both models were trained with it); only the words go through eSpeak, except the
// Japanese ones, which become Japanese phonemes.
const PUNCT = /(\s*[;:,.!?¡¿—…"«»“”(){}[\]]+\s*)+/g;
async function words(chunk, lang, engine, allJapanese) {
  const out = [];
  for (const run of japanese.segments(chunk, allJapanese)) out.push(run.ja ? japanese.romajiToIpa(run.text, engine) : (await phonemize(run.text, lang)).join(" "));
  return out.join(" ");
}
async function toPhonemes(text, lang, engine, allJapanese = false) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(PUNCT)) {
    if (m.index > last) out.push(await words(text.slice(last, m.index), lang, engine, allJapanese));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(await words(text.slice(last), lang, engine, allJapanese));
  return out.join("");
}
const int64 = (ids) => new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]);

// ── Kokoro (same text pipeline as kokoro-js, Apache-2.0) ──
function kokoroNormalize(text) {
  return text.replace(/[‘’]/g, "'").replace(/[“”«»]/g, '"').replace(/\(/g, "«").replace(/\)/g, "»")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor").replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister").replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(y)eah?\b/gi, "$1e'a").replace(/(?<=\d),(?=\d)/g, "").replace(/(?<=\d)-(?=\d)/g, " to ").trim();
}
async function kokoroIds(text, british, allJapanese) {
  let ps = (await toPhonemes(kokoroNormalize(text), british ? "en" : "en-us", "kokoro", allJapanese))
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ").replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ").replace(/ʲ/g, "j").replace(/r/g, "ɹ").replace(/x/g, "k").replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ").replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (!british) ps = ps.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return ps;
}
async function kokoro(m) {
  const dir = path.join(packsDir, m.pack);
  let model = models.get(m.pack);
  let loadMs = 0;
  if (!model) {
    const t = Date.now();
    const vocab = JSON.parse(fs.readFileSync(path.join(dir, "tokenizer.json"), "utf8")).model.vocab;
    model = { vocab, voices: new Map(), session: await ort.InferenceSession.create(path.join(dir, "model.onnx"), sessionOptions) };
    models.set(m.pack, model);
    loadMs = Date.now() - t;
  }
  // a Japanese line gets Kokoro's Japanese voice when the pack has it (packs downloaded before it was added do not)
  const ja = m.lang === "ja";
  const voice = ja && fs.existsSync(path.join(dir, "voices", "jf_alpha.bin")) ? "jf_alpha" : m.voice;
  let style = model.voices.get(voice);
  if (!style) {
    const buf = fs.readFileSync(path.join(dir, "voices", `${voice}.bin`));
    style = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    model.voices.set(voice, style);
  }
  const ps = (await kokoroIds(m.text, voice.startsWith("b"), ja)).trim();
  const ids = [0];
  for (const ch of ps) if (model.vocab[ch] != null && ids.length < 511) ids.push(model.vocab[ch]);
  ids.push(0);
  // the style vector depends on the length of the sentence
  const offset = 256 * Math.min(Math.max(ids.length - 2, 0), 509);
  const out = await model.session.run({
    input_ids: int64(ids),
    style: new ort.Tensor("float32", style.slice(offset, offset + 256), [1, 256]),
    speed: new ort.Tensor("float32", new Float32Array([m.speed]), [1])
  });
  return { data: out.waveform.data, rate: 24000, loadMs };
}

// ── Piper (VITS) ──
async function piper(m) {
  const dir = path.join(packsDir, m.pack);
  let model = models.get(m.pack);
  let loadMs = 0;
  if (!model) {
    const t = Date.now();
    const config = JSON.parse(fs.readFileSync(path.join(dir, "model.onnx.json"), "utf8"));
    model = { config, session: await ort.InferenceSession.create(path.join(dir, "model.onnx"), sessionOptions) };
    models.set(m.pack, model);
    loadMs = Date.now() - t;
  }
  const { config, session } = model;
  const map = config.phoneme_id_map;
  const ps = await toPhonemes(m.text, config.espeak?.voice || "en-us", "piper", m.lang === "ja");
  const ids = [...map["^"], ...map["_"]];
  for (const ch of ps) if (map[ch]) ids.push(...map[ch], ...map["_"]);
  ids.push(...map["$"]);
  const inf = config.inference || {};
  const feeds = {
    input: int64(ids),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", new Float32Array([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / m.speed, inf.noise_w ?? 0.8]), [3])
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  return { data: out[session.outputNames[0]].data, rate: config.audio?.sample_rate || 22050, loadMs };
}

// The eSpeak phonemizer needs a few seconds to start the first time: do it now, outside every line's timing.
const warmup = phonemize("hello", "en-us").catch(() => {});
process.on("message", async (m) => {
  if (!m || m.type !== "speak") return;
  try {
    await warmup;
    const t0 = Date.now();
    const { data, rate, loadMs } = m.engine === "kokoro" ? await kokoro(m) : await piper(m);
    // genMs = the time this line took without loading the model: that is what tells whether live speech keeps up
    process.send({ type: "audio", id: m.id, data: new Float32Array(data), rate, genMs: Math.max(1, Date.now() - t0 - loadMs), loadMs });
  } catch (error) {
    process.send({ type: "error", id: m.id, message: String(error?.message || error).slice(0, 300) });
  }
});
process.on("disconnect", () => process.exit(0));
process.send({ type: "ready" });
