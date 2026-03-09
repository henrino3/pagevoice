/**
 * offscreen.js — PageVoice Offscreen Document
 *
 * Runs as a persistent hidden document (chrome.offscreen API).
 * Handles all audio playback so it continues even when the popup is closed.
 * Communicates with background.js via chrome.runtime.sendMessage.
 *
 * Message protocol (all messages have a `target` field):
 *   Incoming  (target: 'offscreen'): play | pause | resume | stop | getState
 *   Outgoing  (target: 'background'): stateUpdate { state, statusText }
 */

const DEFAULT_API_KEY = "sk_1762efa9c9a67a671fd67ab38648f0512634c43c126a44f3";

let currentAudio = null;
let isStopped = false;
let isPaused = false;
let currentState = "stopped";
let currentStatusText = "";

// ─── Message Router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  (async () => {
    switch (message.type) {
      case "play": {
        isStopped = false;
        isPaused = false;
        const { text, mode, apiKey, voice, speed } = message.payload;
        // Don't await — playback runs asynchronously, state updates are pushed
        if (mode === "elevenlabs") {
          speakWithElevenLabs(text, apiKey, voice);
        } else {
          speakWithLocalTTS(text, voice, speed);
        }
        sendResponse({ ok: true });
        break;
      }

      case "pause":
        isPaused = true;
        if (currentAudio) {
          currentAudio.pause();
        } else if (typeof speechSynthesis !== "undefined") {
          speechSynthesis.pause();
        }
        reportState("paused", "Paused");
        sendResponse({ ok: true });
        break;

      case "resume":
        isPaused = false;
        if (currentAudio) {
          currentAudio.play().catch(() => {});
        } else if (typeof speechSynthesis !== "undefined") {
          speechSynthesis.resume();
        }
        reportState("playing", currentStatusText);
        sendResponse({ ok: true });
        break;

      case "stop":
        isStopped = true;
        if (currentAudio) {
          currentAudio.pause();
          currentAudio = null;
        }
        if (typeof speechSynthesis !== "undefined") {
          speechSynthesis.cancel();
        }
        // background will close this document after receiving the stop ack
        sendResponse({ ok: true });
        break;

      case "getState":
        sendResponse({ ok: true, state: currentState, statusText: currentStatusText });
        break;

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();

  return true; // keep channel open for async sendResponse
});

// ─── State Reporter ───────────────────────────────────────────────────────────

function reportState(state, statusText) {
  currentState = state;
  currentStatusText = statusText;
  chrome.runtime.sendMessage({
    target: "background",
    type: "stateUpdate",
    payload: { state, statusText },
  }).catch(() => {});
}

// ─── ElevenLabs Playback ──────────────────────────────────────────────────────

async function speakWithElevenLabs(text, apiKey, voice) {
  const effectiveKey = (apiKey && apiKey.trim()) || DEFAULT_API_KEY;
  const chunks = splitText(text, 2500);

  for (let i = 0; i < chunks.length; i++) {
    if (isStopped) return;

    // Wait while paused (between chunks)
    while (isPaused && !isStopped) {
      await sleep(100);
    }
    if (isStopped) return;

    reportState("playing", `Reading chunk ${i + 1}/${chunks.length}…`);

    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}`,
        {
          method: "POST",
          headers: {
            Accept: "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": effectiveKey,
          },
          body: JSON.stringify({
            text: chunks[i],
            model_id: "eleven_monolingual_v1",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      // Play audio — resolves when chunk finishes (or rejects on error)
      await new Promise((resolve, reject) => {
        if (isStopped) { URL.revokeObjectURL(url); resolve(); return; }

        const audio = new Audio(url);
        currentAudio = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          currentAudio = null;
          reject(new Error("Audio element playback error"));
        };
        audio.play().catch(reject);
      });

      // If paused just after this chunk ended, wait before fetching the next
      while (isPaused && !isStopped) {
        await sleep(100);
      }
    } catch (err) {
      if (!isStopped) {
        reportState("stopped", `Error: ${err.message}`);
      }
      return;
    }
  }

  if (!isStopped) {
    reportState("stopped", "Finished");
  }
}

// ─── Local TTS Playback ───────────────────────────────────────────────────────

function speakWithLocalTTS(text, voiceName, speed) {
  if (typeof speechSynthesis === "undefined") {
    reportState("stopped", "Speech synthesis not available in this context");
    return;
  }

  speechSynthesis.cancel();

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let index = 0;

  reportState("playing", "Reading…");

  function speakNext() {
    if (isStopped) return;
    if (index >= sentences.length) {
      reportState("stopped", "Finished");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(sentences[index]);
    utterance.rate = speed || 1.0;

    if (voiceName) {
      const voices = speechSynthesis.getVoices();
      const match = voices.find((v) => v.name === voiceName);
      if (match) utterance.voice = match;
    }

    utterance.onend = () => {
      index++;
      speakNext();
    };
    utterance.onerror = (e) => {
      if (!isStopped) {
        reportState("stopped", `Speech error: ${e.error}`);
      }
    };

    speechSynthesis.speak(utterance);
  }

  speakNext();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function splitText(text, maxLen) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let chunk = "";
  for (const s of sentences) {
    if ((chunk + s).length > maxLen) {
      if (chunk) chunks.push(chunk.trim());
      chunk = s;
    } else {
      chunk += s;
    }
  }
  if (chunk) chunks.push(chunk.trim());
  return chunks;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
