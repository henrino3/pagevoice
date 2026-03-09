/**
 * popup.js — PageVoice Popup UI
 *
 * Handles settings UI and user interaction only.
 * All audio playback runs in offscreen.js via background.js.
 *
 * Flow:
 *  - On open:  request current state from background → restore button states
 *  - Play btn: extract page text → send play command to background
 *  - Pause btn: send pause/resume toggle to background
 *  - Stop btn:  send stop to background
 *  - Background pushes stateUpdate messages → popup refreshes UI in real time
 */

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const ttsLocal          = document.getElementById("ttsLocal");
const ttsElevenlabs     = document.getElementById("ttsElevenlabs");
const elevenLabsSettings = document.getElementById("elevenLabsSettings");
const localSettings     = document.getElementById("localSettings");
const apiKeyInput       = document.getElementById("apiKey");
const elevenVoiceSelect = document.getElementById("elevenVoice");
const localVoiceSelect  = document.getElementById("localVoice");
const speedInput        = document.getElementById("speed");
const speedValue        = document.getElementById("speedValue");
const playBtn           = document.getElementById("playBtn");
const pauseBtn          = document.getElementById("pauseBtn");
const stopBtn           = document.getElementById("stopBtn");
const statusEl          = document.getElementById("status");

const DEFAULT_API_KEY = "sk_1762efa9c9a67a671fd67ab38648f0512634c43c126a44f3";

// Local UI state (kept in sync with background's authoritative state)
let uiState = "stopped"; // 'stopped' | 'playing' | 'paused'

// ─── Initialise ───────────────────────────────────────────────────────────────

chrome.storage.sync.get(
  ["ttsMode", "elevenLabsApiKey", "elevenLabsVoice", "localVoice", "speed"],
  (data) => {
    if (data.ttsMode === "elevenlabs") {
      ttsElevenlabs.checked = true;
      toggleSettings();
    }
    apiKeyInput.value = data.elevenLabsApiKey || DEFAULT_API_KEY;
    if (data.elevenLabsVoice) elevenVoiceSelect.value = data.elevenLabsVoice;
    if (data.speed) {
      speedInput.value = data.speed;
      speedValue.textContent = data.speed + "x";
    }
    loadLocalVoices();
  }
);

// Restore UI to match any in-progress playback from a previous popup session
chrome.runtime.sendMessage(
  { target: "background", type: "getState" },
  (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.ok && response.payload) {
      applyState(response.payload);
    }
  }
);

// ─── Settings UI ──────────────────────────────────────────────────────────────

function toggleSettings() {
  const isElevenLabs = ttsElevenlabs.checked;
  elevenLabsSettings.style.display = isElevenLabs ? "flex" : "none";
  localSettings.style.display      = isElevenLabs ? "none"  : "flex";
  chrome.storage.sync.set({ ttsMode: isElevenLabs ? "elevenlabs" : "local" });
}

ttsLocal.addEventListener("change", toggleSettings);
ttsElevenlabs.addEventListener("change", toggleSettings);

function loadLocalVoices() {
  const voices = speechSynthesis.getVoices();
  localVoiceSelect.innerHTML = '<option value="">Default Voice</option>';
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = `${voice.name} (${voice.lang})`;
    localVoiceSelect.appendChild(option);
  });
  // Restore saved selection
  chrome.storage.sync.get("localVoice", (data) => {
    if (data.localVoice) localVoiceSelect.value = data.localVoice;
  });
}
speechSynthesis.onvoiceschanged = loadLocalVoices;

apiKeyInput.addEventListener("input",  () => chrome.storage.sync.set({ elevenLabsApiKey: apiKeyInput.value }));
elevenVoiceSelect.addEventListener("change", () => chrome.storage.sync.set({ elevenLabsVoice: elevenVoiceSelect.value }));
localVoiceSelect.addEventListener("change",  () => chrome.storage.sync.set({ localVoice: localVoiceSelect.value }));
speedInput.addEventListener("input", () => {
  speedValue.textContent = speedInput.value + "x";
  chrome.storage.sync.set({ speed: parseFloat(speedInput.value) });
});

// ─── Playback Controls ────────────────────────────────────────────────────────

playBtn.addEventListener("click", async () => {
  // Resume if paused
  if (uiState === "paused") {
    chrome.runtime.sendMessage({ target: "background", type: "resume" });
    setUIState("playing");
    return;
  }

  // Fresh play
  setUIState("playing");
  statusEl.textContent = "Extracting…";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Inject content script if not already present
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (_) {}

    await sleep(300);

    chrome.tabs.sendMessage(tab.id, { action: "getArticleText" }, (response) => {
      if (chrome.runtime.lastError || !response?.text) {
        statusEl.textContent = "Could not extract text. Try refreshing the page.";
        setUIState("stopped");
        return;
      }

      const payload = {
        text:   response.text,
        mode:   ttsElevenlabs.checked ? "elevenlabs" : "local",
        apiKey: apiKeyInput.value.trim() || DEFAULT_API_KEY,
        voice:  ttsElevenlabs.checked ? elevenVoiceSelect.value : localVoiceSelect.value,
        speed:  parseFloat(speedInput.value) || 1.0,
      };

      chrome.runtime.sendMessage({ target: "background", type: "play", payload });
    });
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
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
  statusEl.textContent = "";
});

// ─── State Updates from Background ───────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== "popup") return;
  if (message.type === "stateUpdate" && message.payload) {
    applyState(message.payload);
  }
});

// ─── UI State Helpers ─────────────────────────────────────────────────────────

/**
 * Apply a state object { state, statusText } received from background.
 * This is used both on popup open (to sync with current playback)
 * and for live updates while popup is open.
 */
function applyState({ state, statusText }) {
  setUIState(state);
  if (statusText !== undefined) statusEl.textContent = statusText;
}

function setUIState(state) {
  uiState = state;

  if (state === "playing") {
    playBtn.disabled  = true;
    playBtn.textContent = "▶️ Read";
    pauseBtn.disabled = false;
    stopBtn.disabled  = false;

  } else if (state === "paused") {
    playBtn.disabled  = false;
    playBtn.textContent = "▶️ Resume";
    pauseBtn.disabled = true;
    stopBtn.disabled  = false;

  } else { // stopped
    playBtn.disabled  = false;
    playBtn.textContent = "▶️ Read";
    pauseBtn.disabled = true;
    stopBtn.disabled  = true;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
