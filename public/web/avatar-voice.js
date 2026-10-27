"use strict";

// Auri can speak out loud with the browser's own text-to-speech (free, offline, uses the voices installed on the OS).
// Off by default; the toggle, voice picker and volume live in Settings > AI Agent. The tone follows her temperament:
// calm and light when quiet, low and fast when Psychopathic. Censored curses ("#@%&") are spoken as a bleep.
(function initAvatarVoice() {
  const KEY = "aura.speech";
  const synth = window.speechSynthesis;
  const defaults = { on: false, voice: "", volume: 0.8 };
  let cfg = { ...defaults };
  try { cfg = { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { /* first run */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage unavailable */ } };
  const level = () => Number(document.documentElement.dataset.avatarVoice ?? 2);

  function voices() { return synth ? synth.getVoices() : []; }
  function chosenVoice() {
    const list = voices();
    return list.find((v) => v.voiceURI === cfg.voice) || list.find((v) => /^en/i.test(v.lang) && /female|zira|aria|jenny|samantha|google uk english female/i.test(v.name)) || list.find((v) => /^en/i.test(v.lang)) || null;
  }

  // What is actually spoken: first line first, symbols removed, bleeps for censored swearing, no long monologues.
  function clean(text) {
    return String(text || "")
      .replace(/[♪♫♬♩]/g, "")
      .replace(/[#@%&*$!?]{3,}|(?:[#@%&*$]\w?){3,}/g, " beep ")
      .replace(/\b\w*[#@%&*$]\w*[#@%&*$]\w*\b/g, " beep ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
  }

  function speak(text, opts = {}) {
    if (!cfg.on || !synth || document.hidden) return;
    const line = clean(String(text).split("\n").join(". "));
    if (!line) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(line);
    const v = chosenVoice();
    if (v) { u.voice = v; u.lang = v.lang; }
    const l = level();
    u.volume = Math.min(1, cfg.volume * (opts.loud ? 1.25 : 1));
    u.pitch = [1.15, 1.1, 1.05, 1.2, 0.6][l] ?? 1;
    u.rate = [0.95, 0.95, 1, 1.12, 1.2][l] ?? 1;
    if (opts.loud) { u.pitch = 0.5; u.rate = 1.15; }
    synth.speak(u);
  }

  // Settings UI, injected under the personality description so no other file has to know about it.
  function buildUi() {
    const anchor = document.getElementById("avatarVoiceLabel");
    if (!anchor || document.getElementById("auriSpeech")) return;
    const box = document.createElement("div");
    box.id = "auriSpeech";
    box.className = "auri-speech";
    box.innerHTML = `
      <label class="auri-speech-row"><input id="auriSpeechOn" type="checkbox"><span>Speak aloud (browser voice, free)</span></label>
      <div class="auri-speech-opts">
        <select id="auriSpeechVoice" aria-label="Voice"></select>
        <input id="auriSpeechVol" type="range" min="0.1" max="1" step="0.05" aria-label="Volume">
        <button id="auriSpeechTest" type="button" class="hud-btn hud-sm">Test</button>
      </div>
      <div class="notice muted">Uses the voices installed on your system. Add more voices in Windows: Settings &gt; Time &amp; language &gt; Speech &gt; Add voices.</div>`;
    anchor.after(box);
    const on = box.querySelector("#auriSpeechOn"), sel = box.querySelector("#auriSpeechVoice"), vol = box.querySelector("#auriSpeechVol");
    const fill = () => {
      const list = voices();
      sel.innerHTML = '<option value="">Automatic (English)</option>' + list.map((v) => `<option value="${v.voiceURI}">${v.name} (${v.lang})</option>`).join("");
      sel.value = cfg.voice;
    };
    fill();
    if (synth) synth.addEventListener("voiceschanged", fill);
    on.checked = cfg.on;
    vol.value = String(cfg.volume);
    box.querySelector(".auri-speech-opts").hidden = !cfg.on;
    if (!synth) { on.disabled = true; box.querySelector("span").textContent = "Speech is not supported by this browser"; }
    on.addEventListener("change", () => {
      cfg.on = on.checked; save();
      box.querySelector(".auri-speech-opts").hidden = !cfg.on;
      if (cfg.on) speak("Hello. I can talk now. Try not to regret it.");
      else if (synth) synth.cancel();
    });
    sel.addEventListener("change", () => { cfg.voice = sel.value; save(); });
    vol.addEventListener("change", () => { cfg.volume = Number(vol.value); save(); });
    box.querySelector("#auriSpeechTest").addEventListener("click", () => speak("Testing, one, two. Is this thing on?"));
  }

  function boot() { buildUi(); setTimeout(buildUi, 1500); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();

  window.AuraSpeech = { speak, isOn: () => cfg.on, stop: () => synth && synth.cancel() };
})();
