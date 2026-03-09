/**
 * popup.js — PageVoice Popup UI (v2)
 *
 * Responsibilities: settings, view routing, transport commands.
 * NO audio code here — all playback runs in offscreen.js via background.js.
 *
 * Views:
 *   #player-view  — default, shows transport controls + article info
 *   #settings-view — gear icon opens this; back arrow returns to player
 */

const DEFAULT_ELEVENLABS_KEY = "sk_1762efa9c9a67a671fd67ab38648f0512634c43c126a44f3";

// ─── Curated voice tables ─────────────────────────────────────────────────────

const EDGE_VOICES = [
  { value: "en-GB-SoniaNeural",   label: "Sonia (British Female)" },
  { value: "en-GB-RyanNeural",    label: "Ryan (British Male)" },
  { value: "en-US-JennyNeural",   label: "Jenny (US Female)" },
  { value: "en-US-GuyNeural",     label: "Guy (US Male)" },
  { value: "en-US-AriaNeural",    label: "Aria (US Female, Conversational)" },
  { value: "en-AU-NatashaNeural", label: "Natasha (AU Female)" },
  { value: "en-AU-WilliamNeural", label: "William (AU Male)" },
];

const OPENAI_VOICES = [
  { value: "nova",    label: "Nova (Female, Warm)" },
  { value: "alloy",  label: "Alloy (Neutral)" },
  { value: "echo",   label: "Echo (Male)" },
  { value: "fable",  label: "Fable (Male, Expressive)" },
  { value: "onyx",   label: "Onyx (Male, Deep)" },
  { value: "shimmer", label: "Shimmer (Female, Clear)" },
];

const ELEVENLABS_VOICES = [
  { value: "21m00Tcm4TlvDq8ikWAM", label: "Rachel (Female, Calm)" },
  { value: "EXAVITQu4vr4xnSDxMaL", label: "Sarah (Female, Soft)" },
  { value: "AZnzlk1XvdvUeBnXmlld", label: "Domi (Female, Strong)" },
  { value: "pNInz6obpgDQGcFmaJgB", label: "Adam (Male, Deep)" },
  { value: "TxGEqnHWrfWFTfGW9XjX", label: "Josh (Male, Young)" },
  { value: "VR6AewLTigWG4xSOukaG", label: "Arnold (Male, Crisp)" },
];

// Patterns to match system voice names to friendly labels
// Each entry: { patterns (any match), label, category }
const LOCAL_VOICE_PREFS = [
  // en-GB
  { patterns: ["google uk english female"],          label: "Emma (British Female)",  cat: "en-GB-F" },
  { patterns: ["google uk english male"],            label: "Daniel (British Male)",  cat: "en-GB-M" },
  { patterns: ["microsoft libby"],                   label: "Libby (British Female)", cat: "en-GB-F" },
  { patterns: ["microsoft ryan"],                    label: "Ryan (British Male)",    cat: "en-GB-M" },
  { patterns: ["microsoft hazel"],                   label: "Hazel (British Female)", cat: "en-GB-F" },
  { patterns: ["^daniel$"],                          label: "Daniel (British Male)",  cat: "en-GB-M" },
  { patterns: ["^kate$"],                            label: "Kate (British Female)",  cat: "en-GB-F" },
  // en-US
  { patterns: ["microsoft aria"],                    label: "Aria (US Female)",       cat: "en-US-F" },
  { patterns: ["microsoft jenny"],                   label: "Jenny (US Female)",      cat: "en-US-F" },
  { patterns: ["microsoft guy"],                     label: "Guy (US Male)",          cat: "en-US-M" },
  { patterns: ["google us english"],                 label: "Emily (US Female)",      cat: "en-US-F" },
  { patterns: ["^samantha$"],                        label: "Samantha (US Female)",   cat: "en-US-F" },
  { patterns: ["^alex$"],                            label: "Alex (US Male)",         cat: "en-US-M" },
  { patterns: ["^zira$"],                            label: "Zira (US Female)",       cat: "en-US-F" },
  { patterns: ["^david$"],                           label: "David (US Male)",        cat: "en-US-M" },
  { patterns: ["^mark$"],                            label: "Mark (US Male)",         cat: "en-US-M" },
  // en-AU
  { patterns: ["google australian english"],         label: "Grace (AU Female)",      cat: "en-AU-F" },
  { patterns: ["microsoft natasha"],                 label: "Natasha (AU Female)",    cat: "en-AU-F" },
  { patterns: ["microsoft william"],                 label: "William (AU Male)",      cat: "en-AU-M" },
  { patterns: ["^karen$"],                           label: "Karen (AU Female)",      cat: "en-AU-F" },
  { patterns: ["^lee$"],                             label: "Lee (AU Male)",          cat: "en-AU-M" },
];

function getCuratedLocalVoices(voices) {
  const selected = [];
  const usedCats = new Set();

  // Pass 1: match by preference patterns (prioritised)
  for (const pref of LOCAL_VOICE_PREFS) {
    if (usedCats.has(pref.cat)) continue;
    for (const pattern of pref.patterns) {
      const re = new RegExp(pattern, "i");
      const match = voices.find((v) => re.test(v.name));
      if (match) {
        selected.push({ value: match.name, label: pref.label });
        usedCats.add(pref.cat);
        break;
      }
    }
  }

  // Pass 2: fill empty categories from any available en-* voices
  const locales = ["en-GB", "en-US", "en-AU"];
  const fallbackCats = [
    { cat: "en-GB-F", lang: "en-GB", genderHint: ["female", "f-"] },
    { cat: "en-GB-M", lang: "en-GB", genderHint: ["male"] },
    { cat: "en-US-F", lang: "en-US", genderHint: ["female", "f-"] },
    { cat: "en-US-M", lang: "en-US", genderHint: ["male"] },
    { cat: "en-AU-F", lang: "en-AU", genderHint: ["female", "f-"] },
    { cat: "en-AU-M", lang: "en-AU", genderHint: ["male"] },
  ];

  for (const fb of fallbackCats) {
    if (usedCats.has(fb.cat)) continue;
    const v = voices.find(
      (v) => v.lang.startsWith(fb.lang) &&
             fb.genderHint.some((h) => v.name.toLowerCase().includes(h))
    );
    if (v) {
      const isF = fb.cat.endsWith("F");
      const regionLabel = fb.lang === "en-GB" ? "British" : fb.lang === "en-AU" ? "Australian" : "US";
      selected.push({ value: v.name, label: `${v.name} (${regionLabel} ${isF ? "Female" : "Male"})` });
      usedCats.add(fb.cat);
    }
  }

  // Pass 3: if still nothing useful, pick any English voice
  if (selected.length === 0) {
    const enVoices = voices.filter((v) => v.lang.startsWith("en"));
    enVoices.slice(0, 6).forEach((v) => {
      selected.push({ value: v.name, label: `${v.name} (${v.lang})` });
    });
  }

  return selected;
}

// ─── DOM Refs ─────────────────────────────────────────────────────────────────

const playerView    = document.getElementById("player-view");
const settingsView  = document.getElementById("settings-view");
const settingsBtn   = document.getElementById("settingsBtn");
const backBtn       = document.getElementById("backBtn");

const playBtn       = document.getElementById("playBtn");
const pauseBtn      = document.getElementById("pauseBtn");
const stopBtn       = document.getElementById("stopBtn");
const statusEl      = document.getElementById("status");
const articleTitle  = document.getElementById("articleTitle");
const progressInfo  = document.getElementById("progressInfo");
const engineLabel   = document.getElementById("engineLabel");

const engineRadios  = document.querySelectorAll('input[name="engine"]');
const voiceSelect   = document.getElementById("voiceSelect");
const speedInput    = document.getElementById("speedInput");
const speedValue    = document.getElementById("speedValue");

const openaiKeyGroup = document.getElementById("openaiKeyGroup");
const elevenKeyGroup = document.getElementById("elevenKeyGroup");
const openaiKeyInput = document.getElementById("openaiKey");
const elevenKeyInput = document.getElementById("elevenKey");
const openaiSaved    = document.getElementById("openaiSaved");
const elevenSaved    = document.getElementById("elevenSaved");

// ─── Local State ─────────────────────────────────────────────────────────────

let uiState      = "stopped"; // 'stopped' | 'playing' | 'paused'
let currentEngine = "edge";
let activeTabId   = null;

// ─── Initialise ───────────────────────────────────────────────────────────────

chrome.storage.sync.get(
  ["engine", "voice", "speed", "openaiKey", "elevenLabsKey"],
  (data) => {
    currentEngine = data.engine || "edge";
    setEngineRadio(currentEngine);
    updateEngineUI(currentEngine);

    speedInput.value = data.speed || 1.0;
    speedValue.textContent = (data.speed || 1.0) + "x";

    if (data.openaiKey)     openaiKeyInput.value = data.openaiKey;
    if (data.elevenLabsKey) elevenKeyInput.value  = data.elevenLabsKey;

    // Voice list is populated after engine is set
    populateVoices(currentEngine, data.voice || null);

    // Engine label on player view
    engineLabel.textContent = engineDisplayName(currentEngine);
  }
);

// Sync with any in-progress playback
chrome.runtime.sendMessage({ target: "background", type: "getState" }, (res) => {
  if (chrome.runtime.lastError) return;
  if (res?.ok && res.payload) applyState(res.payload);
});

// ─── View Switching ───────────────────────────────────────────────────────────

settingsBtn.addEventListener("click", () => {
  playerView.classList.remove("active");
  settingsView.classList.add("active");
});

backBtn.addEventListener("click", () => {
  settingsView.classList.remove("active");
  playerView.classList.add("active");
});

// ─── Engine Selection ─────────────────────────────────────────────────────────

engineRadios.forEach((radio) => {
  radio.addEventListener("change", () => {
    currentEngine = radio.value;
    chrome.storage.sync.set({ engine: currentEngine });
    updateEngineUI(currentEngine);
    populateVoices(currentEngine, null);
    engineLabel.textContent = engineDisplayName(currentEngine);
  });
});

function setEngineRadio(engine) {
  engineRadios.forEach((r) => { r.checked = (r.value === engine); });
}

function updateEngineUI(engine) {
  openaiKeyGroup.style.display = (engine === "openai")      ? "flex" : "none";
  elevenKeyGroup.style.display = (engine === "elevenlabs")  ? "flex" : "none";
}

function engineDisplayName(engine) {
  return { edge: "Edge TTS", local: "Browser TTS", openai: "OpenAI TTS", elevenlabs: "ElevenLabs" }[engine] || engine;
}

// ─── Voice Population ─────────────────────────────────────────────────────────

function populateVoices(engine, savedVoice) {
  voiceSelect.innerHTML = "";

  if (engine === "edge") {
    EDGE_VOICES.forEach(({ value, label }) => addOption(voiceSelect, value, label));
    restoreVoice(savedVoice || "en-GB-SoniaNeural");

  } else if (engine === "openai") {
    OPENAI_VOICES.forEach(({ value, label }) => addOption(voiceSelect, value, label));
    restoreVoice(savedVoice || "nova");

  } else if (engine === "elevenlabs") {
    ELEVENLABS_VOICES.forEach(({ value, label }) => addOption(voiceSelect, value, label));
    restoreVoice(savedVoice || "21m00Tcm4TlvDq8ikWAM");

  } else if (engine === "local") {
    loadLocalVoices(savedVoice);
  }
}

function addOption(select, value, label) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}

function restoreVoice(voiceName) {
  if (!voiceName) return;
  voiceSelect.value = voiceName;
}

function loadLocalVoices(savedVoice) {
  const doLoad = () => {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return; // not ready yet
    const curated = getCuratedLocalVoices(voices);
    voiceSelect.innerHTML = "";
    if (curated.length === 0) {
      addOption(voiceSelect, "", "Default Voice");
    } else {
      curated.forEach(({ value, label }) => addOption(voiceSelect, value, label));
    }
    restoreVoice(savedVoice);
    voiceSelect.onchange(); // persist if needed
  };

  if (speechSynthesis.getVoices().length > 0) {
    doLoad();
  } else {
    speechSynthesis.onvoiceschanged = doLoad;
  }
}

voiceSelect.addEventListener("change", () => {
  chrome.storage.sync.set({ voice: voiceSelect.value });
});

// ─── Speed ────────────────────────────────────────────────────────────────────

speedInput.addEventListener("input", () => {
  speedValue.textContent = parseFloat(speedInput.value).toFixed(1) + "x";
  chrome.storage.sync.set({ speed: parseFloat(speedInput.value) });
});

// ─── API Keys ─────────────────────────────────────────────────────────────────

openaiKeyInput.addEventListener("input", () => {
  chrome.storage.sync.set({ openaiKey: openaiKeyInput.value }, () => flashSaved(openaiSaved));
});

elevenKeyInput.addEventListener("input", () => {
  chrome.storage.sync.set({ elevenLabsKey: elevenKeyInput.value }, () => flashSaved(elevenSaved));
});

function flashSaved(indicator) {
  indicator.classList.add("show");
  setTimeout(() => indicator.classList.remove("show"), 2000);
}

// ─── Transport Controls ───────────────────────────────────────────────────────

playBtn.addEventListener("click", async () => {
  if (uiState === "paused") {
    chrome.runtime.sendMessage({ target: "background", type: "resume" });
    setUIState("playing");
    return;
  }

  setUIState("playing");
  setStatus("Extracting article…");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTabId = tab.id;

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (_) {}

    await sleep(200);

    chrome.tabs.sendMessage(tab.id, { action: "getArticleData" }, (response) => {
      if (chrome.runtime.lastError || !response?.text) {
        setStatus("Could not extract text — try refreshing the page.", true);
        setUIState("stopped");
        return;
      }

      articleTitle.textContent = response.title || tab.title || "Article";

      const elevenKey = elevenKeyInput.value.trim() || DEFAULT_ELEVENLABS_KEY;
      const openaiKey  = openaiKeyInput.value.trim();

      const payload = {
        text:      response.text,
        engine:    currentEngine,
        voice:     voiceSelect.value,
        speed:     parseFloat(speedInput.value) || 1.0,
        apiKey:    currentEngine === "elevenlabs" ? elevenKey : openaiKey,
        tabId:     tab.id,
      };

      chrome.runtime.sendMessage({ target: "background", type: "play", payload });
    });
  } catch (err) {
    setStatus("Error: " + err.message, true);
    setUIState("stopped");
  }
});

pauseBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ target: "background", type: "pause" });
  setUIState("paused");
});

stopBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ target: "background", type: "stop" });
  setUIState("stopped");
  setStatus("");
  progressInfo.textContent = "";
});

// ─── State Updates from Background ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "popup") return;
  if (message.type === "stateUpdate" && message.payload) {
    applyState(message.payload);
  }
});

function applyState({ state, statusText, chunk, totalChunks, engine }) {
  setUIState(state);
  if (statusText !== undefined) setStatus(statusText);
  if (chunk !== undefined && totalChunks !== undefined) {
    progressInfo.textContent = totalChunks > 1 ? `${chunk} / ${totalChunks}` : "";
  }
  if (engine) {
    engineLabel.textContent = engineDisplayName(engine);
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────

function setUIState(state) {
  uiState = state;
  if (state === "playing") {
    playBtn.disabled = true;
    playBtn.classList.add("active");
    pauseBtn.disabled = false;
    stopBtn.disabled  = false;
  } else if (state === "paused") {
    playBtn.disabled = false;
    playBtn.classList.remove("active");
    pauseBtn.disabled = true;
    stopBtn.disabled  = false;
  } else {
    playBtn.disabled = false;
    playBtn.classList.remove("active");
    pauseBtn.disabled = true;
    stopBtn.disabled  = true;
    progressInfo.textContent = "";
  }
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
