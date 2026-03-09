/**
 * content.js — PageVoice Content Script (v2)
 *
 * Responsibilities:
 *  1. Extract article text and page title on request.
 *  2. Inject / update / remove the floating mini-player.
 *
 * Wrapped in IIFE to prevent redeclaration errors when injected
 * both via manifest content_scripts and chrome.scripting.executeScript.
 */

if (!window.__pagevoice_loaded__) {
window.__pagevoice_loaded__ = true;

// ─── Article Extraction ───────────────────────────────────────────────────────

function extractArticleData() {
  const paragraphs = Array.from(document.querySelectorAll("p"))
    .map((p) => p.innerText.trim())
    .filter((t) => t.length > 30);

  let text = null;

  if (paragraphs.length >= 3) {
    text = paragraphs.join("\n\n");
  } else {
    const selectors = [
      "article",
      '[role="article"]',
      ".article-content",
      ".post-content",
      ".entry-content",
      ".post-body",
      ".content-body",
      "main",
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = el.innerText.trim();
        if (t.length > 200) { text = t; break; }
      }
    }

    if (!text) {
      const body = document.body.innerText;
      if (body.length > 200) text = body.substring(0, 50000);
    }
  }

  let title = "";
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    title = ogTitle.content.trim();
  } else {
    const h1 = document.querySelector("article h1, main h1, h1");
    title = h1 ? h1.innerText.trim() : document.title.trim();
  }

  return { text, title };
}

// ─── Message Listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getArticleData") {
    const data = extractArticleData();
    sendResponse(data);
    return true;
  }

  if (request.action === "getArticleText") {
    const { text } = extractArticleData();
    sendResponse({ text });
    return true;
  }

  if (request.target === "content" && request.type === "playerUpdate") {
    handlePlayerUpdate(request.payload);
    return true;
  }
});

// ─── Floating Mini-Player ─────────────────────────────────────────────────────

let playerEl      = null;
let isDragging    = false;
let dragOffsetX   = 0;
let dragOffsetY   = 0;
let playerVisible = false;

const PLAYER_ID = "__pagevoice_player__";

function handlePlayerUpdate({ state, chunk, totalChunks }) {
  if (state === "stopped") {
    removePlayer();
    return;
  }
  if (!playerVisible) {
    injectPlayer();
  }
  updatePlayer(state, chunk, totalChunks);
}

function injectPlayer() {
  if (document.getElementById(PLAYER_ID)) {
    playerEl      = document.getElementById(PLAYER_ID);
    playerVisible = true;
    return;
  }

  playerEl = document.createElement("div");
  playerEl.id = PLAYER_ID;
  playerEl.innerHTML = `
    <div class="pv-drag-handle" title="Drag to move"></div>
    <div class="pv-body">
      <div class="pv-progress"></div>
      <div class="pv-controls">
        <button class="pv-btn pv-play" title="Play/Pause">▶</button>
        <button class="pv-btn pv-stop" title="Stop">⏹</button>
        <button class="pv-btn pv-close" title="Close">✕</button>
      </div>
    </div>
  `;

  document.body.appendChild(playerEl);
  playerVisible = true;

  playerEl.querySelector(".pv-play").addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ target: "background", type: "pause" });
  });

  playerEl.querySelector(".pv-stop").addEventListener("click", (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ target: "background", type: "stop" });
    removePlayer();
  });

  playerEl.querySelector(".pv-close").addEventListener("click", (e) => {
    e.stopPropagation();
    removePlayer();
  });

  playerEl.addEventListener("mousedown", onDragStart);
  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup",   onDragEnd);
}

function updatePlayer(state, chunk, totalChunks) {
  if (!playerEl) return;

  const playBtn    = playerEl.querySelector(".pv-play");
  const progressEl = playerEl.querySelector(".pv-progress");

  if (state === "paused") {
    playBtn.textContent = "▶";
    playBtn.title       = "Resume";
    playerEl.classList.add("pv-paused");
    playerEl.classList.remove("pv-playing");
    playBtn.onclick = (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ target: "background", type: "resume" });
    };
  } else {
    playBtn.textContent = "⏸";
    playBtn.title       = "Pause";
    playerEl.classList.add("pv-playing");
    playerEl.classList.remove("pv-paused");
    playBtn.onclick = (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ target: "background", type: "pause" });
    };
  }

  if (totalChunks > 1) {
    progressEl.textContent = `${chunk} / ${totalChunks}`;
  } else {
    progressEl.textContent = state === "playing" ? "▶ Reading…" : "⏸ Paused";
  }
}

function removePlayer() {
  if (playerEl) {
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup",   onDragEnd);
    playerEl.remove();
    playerEl      = null;
    playerVisible = false;
  }
}

// ─── Drag Logic ───────────────────────────────────────────────────────────────

function onDragStart(e) {
  if (e.target.classList.contains("pv-btn")) return;
  isDragging  = true;
  const rect  = playerEl.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  playerEl.style.transition = "none";
  e.preventDefault();
}

function onDragMove(e) {
  if (!isDragging || !playerEl) return;
  const x = e.clientX - dragOffsetX;
  const y = e.clientY - dragOffsetY;

  const maxX = window.innerWidth  - playerEl.offsetWidth;
  const maxY = window.innerHeight - playerEl.offsetHeight;

  playerEl.style.left   = Math.max(0, Math.min(x, maxX)) + "px";
  playerEl.style.top    = Math.max(0, Math.min(y, maxY)) + "px";
  playerEl.style.right  = "auto";
  playerEl.style.bottom = "auto";
}

function onDragEnd() {
  isDragging = false;
  if (playerEl) playerEl.style.transition = "";
}

console.log("PageVoice content script loaded");

} // end guard
