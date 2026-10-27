"use strict";

// Settings > AURI Character > Voice: speak-aloud toggle, engine, voice, volume, test, and the voice packs
// (downloaded only when the user asks; they run in the A.U.R.A server on this PC).
(function initAvatarVoiceUi() {
  const S = () => window.AuraSpeech;
  const label = (v) => `${v.startsWith("b") ? "UK" : "US"} ${v.slice(3, 4).toUpperCase()}${v.slice(4)}`;
  const mb = (bytes) => `${Math.round(bytes / 1e6)} MB`;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
            <option value="piper">Piper - fast neural voice</option>
            <option value="kokoro">Kokoro - most expressive neural voice</option>
          </select>
          <label for="auriSpeechVoice">Voice</label>
          <select id="auriSpeechVoice"></select>
          <label for="auriSpeechVol">Volume</label>
          <input id="auriSpeechVol" type="range" min="0" max="1" step="0.05">
          <div class="auri-speech-test"><button id="auriSpeechTest" type="button" class="hud-btn hud-sm" title="A short monologue through all her moods">Test</button><span id="auriSpeechInfo" class="muted"></span></div>
          <div class="auri-packs">
            <div class="auri-packs-head"><span>Voice packs</span><span id="auriPackState" class="muted"></span></div>
            <div id="auriPackList"></div>
          </div>
        </div>
        <div class="notice muted compact-notice">Voice packs are free (Piper: MIT, public-domain voices; Kokoro: Apache-2.0). They are downloaded once into data/voice/ and run on this PC inside the A.U.R.A server: nothing she says leaves the machine. The first pack also installs a small runtime (about 40 MB, via npm).</div>
      </div>`;
    const $ = (id) => slot.querySelector("#" + id);
    const on = $("auriSpeechOn"), eng = $("auriSpeechEngine"), voice = $("auriSpeechVoice"), vol = $("auriSpeechVol"), list = $("auriPackList");

    // Option lists are rebuilt only when they change, so an open dropdown is never reset under the cursor.
    let voiceKey = "", packKey = "", moreOpen = false;
    function fillVoices(st) {
      const synth = window.speechSynthesis;
      const piper = st.piperPacks.filter((p) => p.installed);
      const key = [st.cfg.engine, synth ? synth.getVoices().length : 0, piper.map((p) => p.id).join()].join("|");
      if (key === voiceKey) return;
      voiceKey = key;
      if (st.cfg.engine === "kokoro") {
        voice.innerHTML = '<option value="auto">Auto - changes with her mood</option>' + st.kokoroVoices.map((v) => `<option value="${v}">${label(v)}</option>`).join("");
        voice.value = st.kokoroVoices.includes(st.cfg.voice) ? st.cfg.voice : "auto";
      } else if (st.cfg.engine === "piper") {
        voice.innerHTML = '<option value="auto">Auto - first downloaded voice</option>' + piper.map((p) => `<option value="${p.id}">${esc(p.label.replace(/^Piper - /, ""))}</option>`).join("");
        voice.value = piper.some((p) => p.id === st.cfg.voice) ? st.cfg.voice : "auto";
      } else {
        const voices = synth ? synth.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
        voice.innerHTML = '<option value="auto">Automatic (English, female)</option>' + voices.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)}</option>`).join("");
        voice.value = voices.some((v) => v.voiceURI === st.cfg.voice) ? st.cfg.voice : "auto";
      }
    }
    function fillPacks(st) {
      const srv = st.server;
      const job = srv && srv.job;
      const running = job && !job.done;
      // Downloaded packs (and the one downloading) are always listed; the others stay folded under "More voice packs"
      // once she has a voice, unless the chosen engine still needs one.
      const mine = (p) => p.installed || (running && job.pack === p.id);
      const others = srv ? srv.packs.filter((p) => !mine(p)) : [];
      const needOne = srv && (!srv.packs.some(mine) || (st.cfg.engine !== "browser" && !st.pack && !running));
      const showOthers = needOne || moreOpen;
      const key = srv ? JSON.stringify([srv.packs.map((p) => p.installed), running ? job.pack : "", st.pack, showOthers]) : "none";
      if (key !== packKey) {
        packKey = key;
        const row = (p) => {
          const downloading = running && job.pack === p.id;
          const action = p.installed ? "Remove" : downloading ? "Downloading..." : "Download";
          return `<div class="auri-pack${p.id === st.pack ? " is-current" : ""}" data-pack="${p.id}">
            <span class="auri-pack-name">${esc(p.label)}</span><span class="auri-pack-size muted">${mb(p.bytes)} - ${esc(p.note)}</span>
            <button type="button" class="hud-btn hud-sm" data-act="${p.installed ? "remove" : "download"}"${running && !p.installed ? " disabled" : ""}>${action}</button></div>`;
        };
        list.innerHTML = srv ? srv.packs.filter(mine).map(row).join("")
          + (others.length && !needOne ? `<button type="button" class="auri-packs-more" data-act="more" aria-expanded="${showOthers}">${showOthers ? "Hide" : "More voice packs"} (${others.length})</button>` : "")
          + (showOthers ? others.map(row).join("") : "") : "";
      }
      const state = $("auriPackState");
      if (!srv) state.textContent = st.serverError ? `Voice engine unreachable: ${st.serverError}` : "Checking...";
      else if (running) state.textContent = job.phase === "runtime" ? "Installing the voice runtime (once)..." : `Downloading ${srv.packs.find((p) => p.id === job.pack).label}... ${job.progress}%`;
      else if (job && job.error) state.textContent = `Download failed: ${job.error}`;
      else if (st.cfg.engine !== "browser" && !st.pack) state.textContent = "Download a pack for this engine: until then she uses the browser voice.";
      else if (srv.worker.state === "failed") state.textContent = `Voice engine error: ${srv.worker.error}`;
      else state.textContent = "";
    }
    function render(st = S().info()) {
      on.checked = st.cfg.on;
      eng.value = st.cfg.engine;
      vol.value = String(st.cfg.volume);
      slot.querySelector(".auri-speech-opts").hidden = !st.cfg.on;
      const g = st.lastGen;
      const speed = st.rtf == null ? "" : st.rtf <= 1 ? " - fast enough for live bubbles" : ` - ${st.rtf.toFixed(1)}x slower than real time` + (st.slow ? ": live bubbles use the browser voice" : "");
      $("auriSpeechTest").textContent = st.demo ? "Stop" : "Test";
      $("auriSpeechInfo").textContent = st.demo ? "Mood demo: calm, happy, hyped, adrenaline, bored, angry, creepy, battle cry, sulky..." : st.generating ? "Generating voice..." : g ? `Last line: ${g.seconds}s of speech in ${(g.ms / 1000).toFixed(1)}s${speed}` : st.serverError && st.pack ? `Voice engine: ${st.serverError}` : "";
      fillVoices(st);
      fillPacks(st);
    }
    // Test = the mood demo (click again to stop); a new voice gets one short line so the change is heard at once.
    const test = () => (S().info().demo ? S().stop() : S().showcase());
    const hello = () => S().speak("Hi! This is my new voice. Do you like it?", { emotion: "happy", interrupt: true, force: true });

    on.addEventListener("change", () => { S().set({ on: on.checked }); if (on.checked) S().speak("Hello. I can talk now. Try not to regret it.", { emotion: "creepy", interrupt: true }); });
    eng.addEventListener("change", () => { voiceKey = ""; S().set({ engine: eng.value, voice: "auto" }); });
    // A new voice is heard right away, so the change is obvious.
    voice.addEventListener("change", () => { S().set({ voice: voice.value }); hello(); });
    vol.addEventListener("change", () => S().set({ volume: Number(vol.value) }));
    $("auriSpeechTest").addEventListener("click", test);
    list.addEventListener("click", async (event) => {
      const btn = event.target.closest("button[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "more") { moreOpen = !moreOpen; render(); return; }
      const pack = btn.closest("[data-pack]").dataset.pack;
      btn.disabled = true;
      if (btn.dataset.act === "download") S().download(pack);
      else {
        const name = btn.closest("[data-pack]").querySelector(".auri-pack-name").textContent;
        const ok = await window.AuraDialogs.confirm({ tone: "danger", title: "Remove voice pack", message: `Remove ${name}? It can be downloaded again at any time.`, confirmLabel: "Remove" });
        if (ok) S().remove(pack); else btn.disabled = false;
      }
    });
    if (window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", () => render());
    S().onChange(render);
    render();
  }

  function boot() { build(); setTimeout(build, 1500); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
