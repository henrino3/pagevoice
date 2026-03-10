/**
 * offscreen.js — PageVoice Offscreen Document (v2)
 *
 * Handles ALL audio playback:
 *   - Edge TTS  (free, StreamElements fetch + Bing fallback, default)
 *   - OpenAI TTS (API key, REST)
 *   - ElevenLabs  (API key, REST)
 *   - Browser Local TTS (SpeechSynthesis)
 *
 * Lives as a persistent hidden HTML page so audio continues when popup closes.
 * Communicates exclusively with background.js via chrome.runtime.sendMessage.
 */

const DEFAULT_ELEVENLABS_KEY = "";

// ─── Playback state ───────────────────────────────────────────────────────────

let currentAudio    = null;
let isStopped       = false;
let isPaused        = false;
let currentState    = "stopped";
let currentStatus   = "";

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  (async () => {
    switch (message.type) {

      case "play": {
        isStopped = false;
        isPaused  = false;
        const { text, engine, voice, speed, apiKey } = message.payload;

        // Fire-and-forget — state updates are pushed to background
        switch (engine) {
          case "edge":       speakWithEdgeTTS(text, voice, speed);       break;
          case "openai":     speakWithOpenAI(text, voice, speed, apiKey); break;
          case "elevenlabs": speakWithElevenLabs(text, voice, apiKey);    break;
          default:           speakWithLocalTTS(text, voice, speed);       break;
        }
        sendResponse({ ok: true });
        break;
      }

      case "pause": {
        isPaused = true;
        if (currentAudio) { currentAudio.pause(); }
        else if (typeof speechSynthesis !== "undefined") { speechSynthesis.pause(); }
        reportState("paused", "Paused");
        sendResponse({ ok: true });
        break;
      }

      case "resume": {
        isPaused = false;
        if (currentAudio) { currentAudio.play().catch(() => {}); }
        else if (typeof speechSynthesis !== "undefined") { speechSynthesis.resume(); }
        reportState("playing", currentStatus);
        sendResponse({ ok: true });
        break;
      }

      case "stop": {
        isStopped = true;
        if (currentAudio) { currentAudio.pause(); currentAudio = null; }
        if (typeof speechSynthesis !== "undefined") { speechSynthesis.cancel(); }
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();

  return true;
});

// ─── State Reporter ───────────────────────────────────────────────────────────

function reportState(state, statusText, extra = {}) {
  currentState  = state;
  currentStatus = statusText;
  chrome.runtime.sendMessage({
    target: "background",
    type:   "stateUpdate",
    payload: { state, statusText, ...extra },
  }).catch(() => {});
}

// ─── Shared audio player ──────────────────────────────────────────────────────

function playAudioBlob(blob, playbackRate = 1.0) {
  return new Promise((resolve, reject) => {
    if (isStopped) { resolve(); return; }
    const url      = URL.createObjectURL(blob);
    const audio    = new Audio(url);
    const safeRate = Math.min(4.0, Math.max(0.25, playbackRate || 1.0));

    audio.defaultPlaybackRate = safeRate;
    audio.playbackRate        = safeRate;
    currentAudio = audio;

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      reject(new Error("Audio playback error"));
    };
    audio.play().catch(reject);
  });
}

// ─── Edge TTS (StreamElements primary, Bing fallback) ────────────────────────
//
// Primary: https://api.streamelements.com/kappa/v2/speech
// Fallback protocol reference: https://github.com/rany2/edge-tts
// wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1
// ?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=<UUID>

const EDGE_TOKEN  = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_WS_URL = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${EDGE_TOKEN}`;
const STREAMELEMENTS_TTS_URL = "https://api.streamelements.com/kappa/v2/speech";
const EDGE_STREAMELEMENTS_VOICE_MAP = {
  "en-GB-SoniaNeural":   "Amy",
  "en-GB-RyanNeural":    "Brian",
  "en-US-JennyNeural":   "Joanna",
  "en-US-GuyNeural":     "Matthew",
  "en-AU-NatashaNeural": "Nicole",
  "en-AU-WilliamNeural": "Russell",
  "en-US-AriaNeural":    "Joanna",
};

function getStreamElementsVoice(voiceName) {
  return EDGE_STREAMELEMENTS_VOICE_MAP[voiceName] || "Amy";
}

function mkConnectionId() {
  return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

function isoNow() {
  return new Date().toISOString();
}

function edgeConfigMsg() {
  return (
    `X-Timestamp:${isoNow()}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: "false",
              wordBoundaryEnabled:     "true",
            },
            outputFormat: "audio-24khz-48kbitrate-mono-mp3",
          },
        },
      },
    })
  );
}

function edgeSsmlMsg(requestId, voiceName, text, speedRate) {
  // Convert numeric speed (1.0) to Edge TTS prosody rate (+0%, +50%, -25%, etc.)
  const pct = Math.round((speedRate - 1) * 100);
  const rateStr = (pct >= 0 ? "+" : "") + pct + "%";
  const ssml = [
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>`,
    `<voice name='${voiceName}'>`,
    `<prosody rate='${rateStr}'>${escapeXml(text)}</prosody>`,
    `</voice></speak>`,
  ].join("");

  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${isoNow()}\r\n` +
    `Path:ssml\r\n\r\n` +
    ssml
  );
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Voice → Google Translate language code mapping
const EDGE_GTTS_LANG_MAP = {
  "en-GB-SoniaNeural":   "en-GB",
  "en-GB-RyanNeural":    "en-GB",
  "en-US-JennyNeural":   "en-US",
  "en-US-GuyNeural":     "en-US",
  "en-AU-NatashaNeural": "en-AU",
  "en-AU-WilliamNeural": "en-AU",
  "en-US-AriaNeural":    "en-US",
};

// Synthesise via Google Translate TTS (free, no auth, ~200 char limit per request)
// For longer text, we split into small chunks and concatenate the blobs
async function edgeTTSChunkViaGoogle(voiceName, text) {
  const lang = EDGE_GTTS_LANG_MAP[voiceName] || "en-GB";
  // Split text into ~180 char sentence-aware chunks for Google's limit
  const miniChunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let current = "";
  for (const s of sentences) {
    if ((current + s).length > 180) {
      if (current) miniChunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) miniChunks.push(current.trim());

  const audioBlobs = [];
  for (const chunk of miniChunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(chunk)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Google TTS ${res.status}`);
    audioBlobs.push(await res.blob());
  }

  // Concatenate all blobs
  return new Blob(audioBlobs, { type: "audio/mpeg" });
}

// Synthesise a single chunk via Edge TTS WebSocket; resolves with MP3 Blob
function edgeTTSChunkViaBing(voiceName, text, speedRate) {
  return new Promise((resolve, reject) => {
    const connectionId = mkConnectionId();
    const requestId    = mkConnectionId();
    const wsUrl        = `${EDGE_WS_URL}&ConnectionId=${connectionId}`;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      return reject(err);
    }

    ws.binaryType = "arraybuffer";

    const audioChunks = [];
    let   turnDone    = false;
    const timeout     = setTimeout(() => {
      ws.close();
      reject(new Error("Edge TTS timeout"));
    }, 30000);

    ws.onopen = () => {
      ws.send(edgeConfigMsg());
      ws.send(edgeSsmlMsg(requestId, voiceName, text, speedRate));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        // Text frame — check for turn.end
        if (event.data.includes("Path:turn.end")) {
          turnDone = true;
          ws.close();
        }
      } else {
        // Binary frame — audio data
        // Format: [2-byte header length][header text][audio bytes]
        const buf        = event.data;
        const view       = new DataView(buf);
        const headerLen  = view.getUint16(0); // big-endian
        const header     = new TextDecoder().decode(new Uint8Array(buf, 2, headerLen));

        if (header.includes("Path:audio")) {
          const audioData = buf.slice(2 + headerLen);
          audioChunks.push(audioData);
        }
      }
    };

    ws.onclose = () => {
      clearTimeout(timeout);
      if (audioChunks.length === 0 && !turnDone) {
        reject(new Error("Edge TTS: no audio received"));
        return;
      }
      // Merge ArrayBuffers into a single Blob
      const blob = new Blob(audioChunks, { type: "audio/mpeg" });
      resolve(blob);
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(new Error("Edge TTS WebSocket error"));
    };
  });
}

async function speakWithEdgeTTS(text, voiceName, speed) {
  const voice  = voiceName || "en-GB-SoniaNeural";
  const spd    = speed || 1.0;
  const chunks = splitText(text, 900); // Edge TTS works best with ~800-1000 char chunks

  for (let i = 0; i < chunks.length; i++) {
    if (isStopped) return;
    while (isPaused && !isStopped) { await sleep(100); }
    if (isStopped) return;

    reportState("playing", `Fetching audio… ${i + 1}/${chunks.length}`, {
      chunk: i + 1, totalChunks: chunks.length, engine: "edge",
    });

    try {
      // Try Bing WebSocket first (best quality)
      const blob = await edgeTTSChunkViaBing(voice, chunks[i], spd);
      if (isStopped) return;
      reportState("playing", `Playing… ${i + 1}/${chunks.length}`, {
        chunk: i + 1, totalChunks: chunks.length, engine: "edge",
      });
      await playAudioBlob(blob);
      while (isPaused && !isStopped) { await sleep(100); }
    } catch (bingErr) {
      try {
        // Fallback: Google Translate TTS (free, no auth)
        const blob = await edgeTTSChunkViaGoogle(voice, chunks[i]);
        if (isStopped) return;
        await playAudioBlob(blob, spd);
        while (isPaused && !isStopped) { await sleep(100); }
      } catch (googleErr) {
        // Last resort: Browser Local TTS
        if (!isStopped) {
          reportState("playing", "Network TTS unavailable, using Browser TTS…", {
            chunk: i + 1,
            totalChunks: chunks.length,
            engine: "local",
          });
          speakWithLocalTTS(chunks.slice(i).join(" "), null, spd);
        }
        return;
      }
    }
  }

  if (!isStopped) {
    reportState("stopped", "Finished ✓");
  }
}

// ─── OpenAI TTS ───────────────────────────────────────────────────────────────

async function speakWithOpenAI(text, voice, speed, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    reportState("stopped", "OpenAI API key required — add it in Settings");
    return;
  }

  const effectiveVoice = voice || "nova";
  const chunks         = splitText(text, 4000);

  for (let i = 0; i < chunks.length; i++) {
    if (isStopped) return;
    while (isPaused && !isStopped) { await sleep(100); }
    if (isStopped) return;

    reportState("playing", `Fetching audio… ${i + 1}/${chunks.length}`, {
      chunk: i + 1, totalChunks: chunks.length, engine: "openai",
    });

    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method:  "POST",
        headers: {
          "Authorization": `Bearer ${apiKey.trim()}`,
          "Content-Type":  "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: chunks[i],
          voice: effectiveVoice,
          speed: Math.min(4.0, Math.max(0.25, speed || 1.0)),
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        throw new Error(`OpenAI API ${res.status}: ${msg}`);
      }

      const blob = await res.blob();
      if (isStopped) return;

      reportState("playing", `Playing… ${i + 1}/${chunks.length}`, {
        chunk: i + 1, totalChunks: chunks.length, engine: "openai",
      });

      await playAudioBlob(blob);

      while (isPaused && !isStopped) { await sleep(100); }
    } catch (err) {
      if (!isStopped) {
        reportState("stopped", `OpenAI TTS error: ${err.message}`);
      }
      return;
    }
  }

  if (!isStopped) {
    reportState("stopped", "Finished ✓");
  }
}

// ─── ElevenLabs TTS ───────────────────────────────────────────────────────────

async function speakWithElevenLabs(text, voice, apiKey) {
  const effectiveKey   = (apiKey && apiKey.trim()) || DEFAULT_ELEVENLABS_KEY;
  const effectiveVoice = voice || "21m00Tcm4TlvDq8ikWAM"; // Rachel
  const chunks         = splitText(text, 2500);

  for (let i = 0; i < chunks.length; i++) {
    if (isStopped) return;
    while (isPaused && !isStopped) { await sleep(100); }
    if (isStopped) return;

    reportState("playing", `Fetching audio… ${i + 1}/${chunks.length}`, {
      chunk: i + 1, totalChunks: chunks.length, engine: "elevenlabs",
    });

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${effectiveVoice}`,
        {
          method:  "POST",
          headers: {
            Accept:           "audio/mpeg",
            "Content-Type":   "application/json",
            "xi-api-key":     effectiveKey,
          },
          body: JSON.stringify({
            text:           chunks[i],
            model_id:       "eleven_monolingual_v1",
            voice_settings: { stability: 0.5, similarity_boost: 0.75 },
          }),
        }
      );

      if (!res.ok) {
        throw new Error(`ElevenLabs API ${res.status}: ${res.statusText}`);
      }

      const blob = await res.blob();
      if (isStopped) return;

      reportState("playing", `Playing… ${i + 1}/${chunks.length}`, {
        chunk: i + 1, totalChunks: chunks.length, engine: "elevenlabs",
      });

      await playAudioBlob(blob);

      while (isPaused && !isStopped) { await sleep(100); }
    } catch (err) {
      if (!isStopped) {
        reportState("stopped", `ElevenLabs error: ${err.message}`);
      }
      return;
    }
  }

  if (!isStopped) {
    reportState("stopped", "Finished ✓");
  }
}

// ─── Browser Local TTS ────────────────────────────────────────────────────────

function speakWithLocalTTS(text, voiceName, speed) {
  if (typeof speechSynthesis === "undefined") {
    reportState("stopped", "Speech synthesis unavailable");
    return;
  }

  speechSynthesis.cancel();

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let   index     = 0;

  reportState("playing", "Reading…", {
    chunk: 1, totalChunks: sentences.length, engine: "local",
  });

  function speakNext() {
    if (isStopped) return;
    if (index >= sentences.length) {
      reportState("stopped", "Finished ✓");
      return;
    }

    const utterance  = new SpeechSynthesisUtterance(sentences[index]);
    utterance.rate   = speed || 1.0;

    if (voiceName) {
      const voices = speechSynthesis.getVoices();
      const match  = voices.find((v) => v.name === voiceName);
      if (match) utterance.voice = match;
    }

    utterance.onend = () => {
      index++;
      if (!isStopped) {
        reportState("playing", `Reading…`, {
          chunk: Math.min(index + 1, sentences.length),
          totalChunks: sentences.length,
          engine: "local",
        });
        speakNext();
      }
    };

    utterance.onerror = (e) => {
      if (!isStopped && e.error !== "interrupted") {
        reportState("stopped", `Speech error: ${e.error}`);
      }
    };

    speechSynthesis.speak(utterance);
  }

  speakNext();
}

// ─── Text Splitter ────────────────────────────────────────────────────────────

function splitText(text, maxLen) {
  const chunks    = [];
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  let   chunk     = "";

  for (const s of sentences) {
    if (s.length > maxLen) {
      // Very long sentence: split by commas or just cut hard
      if (chunk) { chunks.push(chunk.trim()); chunk = ""; }
      const parts = s.match(new RegExp(`.{1,${maxLen}}`, "g")) || [s];
      parts.forEach((p) => chunks.push(p.trim()));
    } else if ((chunk + s).length > maxLen) {
      if (chunk) chunks.push(chunk.trim());
      chunk = s;
    } else {
      chunk += s;
    }
  }

  if (chunk.trim()) chunks.push(chunk.trim());
  return chunks.filter(Boolean);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
