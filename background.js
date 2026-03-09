/**
 * background.js — PageVoice Service Worker
 *
 * Responsibilities:
 *  1. Maintain authoritative playback state (persisted in chrome.storage.session
 *     so it survives service-worker restarts within the same browser session).
 *  2. Manage the offscreen document lifecycle.
 *  3. Route messages between popup.js ↔ offscreen.js.
 *
 * Message protocol (all messages carry a `target` field):
 *   From popup     → background  (target: 'background'): getState | play | pause | resume | stop
 *   From offscreen → background  (target: 'background'): stateUpdate
 *   From background → offscreen  (target: 'offscreen'):  play | pause | resume | stop | getState
 *   From background → popup      (target: 'popup'):      stateUpdate
 */

const OFFSCREEN_URL = chrome.runtime.getURL("offscreen.html");

// ─── State ────────────────────────────────────────────────────────────────────

/** In-memory snapshot; authoritative copy lives in chrome.storage.session */
let _state = { state: "stopped", statusText: "" };

async function loadState() {
  const stored = await chrome.storage.session.get("playbackState").catch(() => ({}));
  if (stored.playbackState) _state = stored.playbackState;
  return _state;
}

async function saveState(patch) {
  _state = { ..._state, ...patch };
  await chrome.storage.session.set({ playbackState: _state }).catch(() => {});
  return _state;
}

// ─── Offscreen Document Helpers ───────────────────────────────────────────────

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [OFFSCREEN_URL],
  }).catch(() => []);
  return contexts.length > 0;
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return false; // already exists
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Persistent TTS audio playback that survives popup close",
  });
  // Give the document a moment to load its script before we send messages
  await sleep(150);
  return true; // freshly created
}

async function closeOffscreenDocument() {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument().catch(() => {});
  }
}

// ─── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "background") return false;

  (async () => {
    switch (message.type) {

      // ── Popup requests current state ──────────────────────────────────────
      case "getState": {
        const st = await loadState();

        // If state says playing/paused but no offscreen doc exists, it's stale
        if (st.state !== "stopped" && !(await hasOffscreenDocument())) {
          await saveState({ state: "stopped", statusText: "" });
        }

        sendResponse({ ok: true, payload: await loadState() });
        break;
      }

      // ── Popup requests playback start ─────────────────────────────────────
      case "play": {
        await saveState({ state: "playing", statusText: "Starting…" });
        await ensureOffscreenDocument();
        // Forward full play payload to offscreen
        chrome.runtime.sendMessage({
          target: "offscreen",
          type: "play",
          payload: message.payload,
        }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // ── Popup requests pause ──────────────────────────────────────────────
      case "pause": {
        await saveState({ state: "paused", statusText: "Paused" });
        chrome.runtime.sendMessage({ target: "offscreen", type: "pause" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // ── Popup requests resume ─────────────────────────────────────────────
      case "resume": {
        await saveState({ state: "playing", statusText: _state.statusText || "Resuming…" });
        chrome.runtime.sendMessage({ target: "offscreen", type: "resume" }).catch(() => {});
        sendResponse({ ok: true });
        break;
      }

      // ── Popup requests stop ───────────────────────────────────────────────
      case "stop": {
        await saveState({ state: "stopped", statusText: "" });
        chrome.runtime.sendMessage({ target: "offscreen", type: "stop" }).catch(() => {});
        // Small delay to let offscreen handle the stop before we tear it down
        await sleep(200);
        await closeOffscreenDocument();
        sendResponse({ ok: true });
        break;
      }

      // ── Offscreen reports state change ────────────────────────────────────
      case "stateUpdate": {
        const updated = await saveState(message.payload);

        // Auto-close offscreen when playback finishes naturally
        if (updated.state === "stopped") {
          await sleep(100);
          await closeOffscreenDocument();
        }

        // Forward to popup if it happens to be open
        chrome.runtime.sendMessage({
          target: "popup",
          type: "stateUpdate",
          payload: updated,
        }).catch(() => {});

        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: "Unknown message type" });
    }
  })();

  return true; // keep channel open for async sendResponse
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
