const ttsLocal = document.getElementById("ttsLocal");
const ttsElevenlabs = document.getElementById("ttsElevenlabs");
const elevenLabsSettings = document.getElementById("elevenLabsSettings");
const localSettings = document.getElementById("localSettings");
const apiKeyInput = document.getElementById("apiKey");
const elevenVoiceSelect = document.getElementById("elevenVoice");
const localVoiceSelect = document.getElementById("localVoice");
const speedInput = document.getElementById("speed");
const speedValue = document.getElementById("speedValue");
const playBtn = document.getElementById("playBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");
const status = document.getElementById("status");

const DEFAULT_API_KEY = "sk_1762efa9c9a67a671fd67ab38648f0512634c43c126a44f3";

let isPlaying = false;
let isPaused = false;
let currentUtterance = null;
let currentAudio = null;
let audioQueue = [];
let currentChunk = 0;

chrome.storage.sync.get(["ttsMode", "elevenLabsApiKey", "elevenLabsVoice", "localVoice", "speed"], (data) => {
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
});

function toggleSettings() {
  const isElevenLabs = ttsElevenlabs.checked;
  elevenLabsSettings.style.display = isElevenLabs ? "flex" : "none";
  localSettings.style.display = isElevenLabs ? "none" : "flex";
  chrome.storage.sync.set({ ttsMode: isElevenLabs ? "elevenlabs" : "local" });
}

ttsLocal.addEventListener("change", toggleSettings);
ttsElevenlabs.addEventListener("change", toggleSettings);

function loadLocalVoices() {
  const voices = speechSynthesis.getVoices();
  localVoiceSelect.innerHTML = "<option value=\"\">Default Voice</option>";
  voices.forEach(voice => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = voice.name + " (" + voice.lang + ")";
    localVoiceSelect.appendChild(option);
  });
}
speechSynthesis.onvoiceschanged = loadLocalVoices;

apiKeyInput.addEventListener("input", () => chrome.storage.sync.set({ elevenLabsApiKey: apiKeyInput.value }));
elevenVoiceSelect.addEventListener("change", () => chrome.storage.sync.set({ elevenLabsVoice: elevenVoiceSelect.value }));
localVoiceSelect.addEventListener("change", () => chrome.storage.sync.set({ localVoice: localVoiceSelect.value }));
speedInput.addEventListener("input", () => {
  speedValue.textContent = speedInput.value + "x";
  chrome.storage.sync.set({ speed: parseFloat(speedInput.value) });
});

playBtn.addEventListener("click", async () => {
  if (isPaused) {
    if (currentAudio) { currentAudio.play(); }
    else { speechSynthesis.resume(); }
    updateUIState("playing");
    return;
  }

  status.textContent = "Extracting...";
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }); } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
    
    chrome.tabs.sendMessage(tab.id, { action: "getArticleText" }, async (response) => {
      if (chrome.runtime.lastError || !response?.text) {
        status.textContent = "Could not extract text. Refresh page.";
        return;
      }

      const text = response.text;
      if (ttsElevenlabs.checked) {
        await speakWithElevenLabs(text, apiKeyInput.value.trim() || DEFAULT_API_KEY, elevenVoiceSelect.value);
      } else {
        speakWithLocalTTS(text, localVoiceSelect.value, parseFloat(speedInput.value));
      }
    });
  } catch (e) { status.textContent = "Error: " + e.message; }
});

async function speakWithElevenLabs(text, apiKey, voiceId) {
  const chunks = splitText(text, 2500);
  currentChunk = 0;
  updateUIState("playing");

  async function playNext() {
    if (currentChunk >= chunks.length) {
      updateUIState("stopped");
      status.textContent = "Finished";
      return;
    }

    status.textContent = "Reading chunk " + (currentChunk + 1) + "/" + chunks.length + "...";

    try {
      const response = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + voiceId, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey
        },
        body: JSON.stringify({
          text: chunks[currentChunk],
          model_id: "eleven_monolingual_v1",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        })
      });

      if (!response.ok) throw new Error("API error: " + response.status);

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      
      currentAudio = new Audio(url);
      currentAudio.onended = () => {
        URL.revokeObjectURL(url);
        currentChunk++;
        playNext();
      };
      currentAudio.onerror = (e) => {
        status.textContent = "Audio error";
        updateUIState("stopped");
      };
      currentAudio.play();
    } catch (e) {
      status.textContent = "Error: " + e.message;
      updateUIState("stopped");
    }
  }

  playNext();
}

function splitText(text, maxLen) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let chunk = "";
  for (const s of sentences) {
    if ((chunk + s).length > maxLen) {
      if (chunk) chunks.push(chunk.trim());
      chunk = s;
    } else { chunk += s; }
  }
  if (chunk) chunks.push(chunk.trim());
  return chunks;
}

function speakWithLocalTTS(text, voiceName, speed) {
  speechSynthesis.cancel();
  const chunks = text.match(/[^.!?]+[.!?]+/g) || [text];
  let i = 0;
  updateUIState("playing");

  function next() {
    if (i >= chunks.length) { updateUIState("stopped"); status.textContent = "Finished"; return; }
    currentUtterance = new SpeechSynthesisUtterance(chunks[i]);
    currentUtterance.rate = speed || 1.0;
    if (voiceName) {
      const v = speechSynthesis.getVoices().find(v => v.name === voiceName);
      if (v) currentUtterance.voice = v;
    }
    currentUtterance.onend = () => { i++; next(); };
    currentUtterance.onerror = () => { updateUIState("stopped"); };
    speechSynthesis.speak(currentUtterance);
  }
  next();
}

pauseBtn.addEventListener("click", () => {
  if (currentAudio) currentAudio.pause();
  else speechSynthesis.pause();
  updateUIState("paused");
});

stopBtn.addEventListener("click", () => {
  if (currentAudio) { currentAudio.pause(); currentAudio = null; }
  speechSynthesis.cancel();
  updateUIState("stopped");
  status.textContent = "";
});

function updateUIState(state) {
  if (state === "playing") {
    isPlaying = true; isPaused = false;
    playBtn.disabled = true; pauseBtn.disabled = false; stopBtn.disabled = false;
  } else if (state === "paused") {
    isPaused = true;
    playBtn.disabled = false; playBtn.textContent = "▶️ Resume";
    pauseBtn.disabled = true;
  } else {
    isPlaying = false; isPaused = false; currentUtterance = null; currentAudio = null;
    playBtn.disabled = false; playBtn.textContent = "▶️ Read";
    pauseBtn.disabled = true; stopBtn.disabled = true;
  }
}
