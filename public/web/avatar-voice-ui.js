"use strict";

// Settings > AURI Character > Voice: speak-aloud toggle, engine, Kokoro download (the user decides), voice, volume, test.
(function initAvatarVoiceUi() {
  const S = () => window.AuraSpeech;
  const TESTS = [
    ["Testing, one, two. Is this thing on?", "neutral"], ["YATTA! Found one! I love my job!", "hyped"],
    ["...I'm so bored. Wake me when something happens.", "bored"], ["ARE YOU KIDDING ME?! Stop poking me!", "rage"],
    ["Hello, friend. I see you. I always see you.", "creepy"], ["KAMEHAMEHAAAA!!", "shout"]
  ];
  const label = (v) => `${v.startsWith("b") ? "UK" : "US"} ${v.slice(3, 4).toUpperCase()}${v.slice(4)}`;

  function build() {
    const slot = document.getElementById("auriVoiceSlot");
    if (!slot || !S() || document.getElementById("auriSpeech")) return;
    slot.innerHTML = `
      <div id="auriSpeech" class="auri-speech">
        <label class="check auri-speech-row"><input id="auriSpeechOn" type="checkbox"><span>Speak aloud</span></label>
        <div class="auri-speech-opts">
          <label for="auriSpeechEngine">Engine</label>
          <select id="auriSpeechEngine">
            <option value="browser">Browser voice - instant, flat</option>
            <option value="kokoro">Kokoro - neural voice with emotion</option>
          </select>
          <label for="auriKokoroModel">Kokoro</label>
          <div class="auri-kokoro">
            <select id="auriKokoroModel"></select>
            <button id="auriKokoroBtn" type="button" class="hud-btn hud-sm"></button>
          </div>
          <span></span><div id="auriKokoroState" class="auri-kokoro-state muted"></div>
          <label for="auriSpeechVoice">Voice</label>
          <select id="auriSpeechVoice"></select>
          <label for="auriSpeechVol">Volume</label>
          <input id="auriSpeechVol" type="range" min="0" max="1" step="0.05">
          <div class="auri-speech-test"><button id="auriSpeechTest" type="button" class="hud-btn hud-sm">Test</button><span id="auriSpeechInfo" class="muted"></span></div>
        </div>
        <div class="notice muted compact-notice">Kokoro is free (Apache-2.0) and runs on this PC: it is downloaded once from Hugging Face and kept in the browser cache. Nothing you say is sent anywhere.</div>
      </div>`;
    const $ = (id) => slot.querySelector("#" + id);
    const on = $("auriSpeechOn"), eng = $("auriSpeechEngine"), model = $("auriKokoroModel"), btn = $("auriKokoroBtn"), voice = $("auriSpeechVoice"), vol = $("auriSpeechVol");

    // Option lists are rebuilt only when they change, so an open dropdown is never reset under the cursor.
    let voiceKey = "", modelKey = "";
    function fillVoices(st) {
      const synth = window.speechSynthesis;
      const key = st.cfg.engine + "|" + (synth ? synth.getVoices().length : 0);
      if (key === voiceKey) return;
      voiceKey = key;
      if (st.cfg.engine === "kokoro") {
        voice.innerHTML = '<option value="auto">Auto - changes with her mood</option>' + st.voices.map((v) => `<option value="${v}">${label(v)}</option>`).join("");
        voice.value = st.voices.includes(st.cfg.voice) ? st.cfg.voice : "auto";
      } else {
        const list = synth ? synth.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
        voice.innerHTML = '<option value="auto">Automatic (English, female)</option>' + list.map((v) => `<option value="${v.voiceURI}">${v.name}</option>`).join("");
        voice.value = list.some((v) => v.voiceURI === st.cfg.voice) ? st.cfg.voice : "auto";
      }
    }
    function render(st = S().info()) {
      on.checked = st.cfg.on;
      eng.value = st.cfg.engine;
      vol.value = String(st.cfg.volume);
      slot.querySelector(".auri-speech-opts").hidden = !st.cfg.on;
      if (modelKey !== String(st.gpu)) { modelKey = String(st.gpu); model.innerHTML = (st.gpu ? `<option value="fp32">Fast - ${st.sizes.fp32}, GPU (recommended)</option>` : "") + `<option value="q8">Compact - ${st.sizes.q8}, CPU (slow on most PCs)</option>`; }
      model.value = st.cfg.model === "fp32" && st.gpu ? "fp32" : "q8";
      model.disabled = st.workerState === "loading";
      const state = $("auriKokoroState");
      if (st.workerState === "loading") { btn.textContent = "Downloading..."; btn.disabled = true; state.textContent = st.downloaded ? "Loading the voice model..." : `Downloading the voice model... ${st.progress}%`; }
      else if (st.workerState === "ready") { btn.textContent = "Remove"; btn.disabled = false; state.textContent = `Ready - runs locally on ${st.device === "webgpu" ? "the GPU" : "the CPU"}.`; }
      else if (st.workerState === "failed") { btn.textContent = "Retry"; btn.disabled = false; state.textContent = `Could not load Kokoro: ${st.message || "unknown error"}. The browser voice is used meanwhile.`; }
      else if (st.downloaded) { btn.textContent = "Remove"; btn.disabled = false; state.textContent = "Downloaded. It loads when the Kokoro engine is selected."; }
      else { btn.textContent = `Download (${st.sizes[model.value]})`; btn.disabled = false; state.textContent = "Not downloaded: until then she uses the browser voice."; }
      const g = st.lastGen;
      const speed = st.rtf == null ? "" : st.rtf <= 1 ? " - fast enough for live bubbles" : ` - ${st.rtf.toFixed(1)}x slower than real time` + (st.slow ? ": live bubbles use the browser voice" : "");
      $("auriSpeechInfo").textContent = st.generating ? "Generating voice..." : g ? `Last line: ${g.seconds}s of speech in ${(g.ms / 1000).toFixed(1)}s${speed}` : "";
      if (st.workerState === "ready" && st.slow) state.textContent += st.gpu && st.device !== "webgpu" ? " Too slow on the CPU: choose Fast (GPU)." : " Too slow on this CPU for live bubbles.";
      fillVoices(st);
    }
    const test = () => { const [text, emotion] = TESTS[Math.floor(Math.random() * TESTS.length)]; S().speak(text, { emotion, interrupt: true, force: true }); };

    on.addEventListener("change", () => { S().set({ on: on.checked }); if (on.checked) S().speak("Hello. I can talk now. Try not to regret it.", { emotion: "creepy", interrupt: true }); });
    eng.addEventListener("change", () => S().set({ engine: eng.value, voice: "auto" }));
    model.addEventListener("change", () => S().set({ model: model.value }));
    btn.addEventListener("click", async () => {
      const st = S().info();
      if (st.workerState === "ready" || (st.downloaded && st.workerState !== "failed")) { await S().remove(); return; }
      S().set({ engine: "kokoro" });
      S().download();
    });
    // A new voice is heard right away, so the change is obvious.
    voice.addEventListener("change", () => { S().set({ voice: voice.value }); test(); });
    eng.addEventListener("change", () => { voiceKey = ""; render(); });
    vol.addEventListener("change", () => S().set({ volume: Number(vol.value) }));
    $("auriSpeechTest").addEventListener("click", test);
    if (window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", () => render());
    S().onChange(render);
    render();
  }

  function boot() { build(); setTimeout(build, 1500); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
