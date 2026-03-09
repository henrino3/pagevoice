# PageVoice — Project Context

## Overview
Chrome extension (Manifest V3) that reads web articles aloud using multiple TTS engines.

## URLs
- **Repo:** github.com/henrino3/pagevoice
- **No deployment** — local Chrome extension loaded unpacked from `~/Extensions/pagevoice/`

## Tech Stack
- Plain JavaScript (no build step, no npm/webpack)
- Chrome Extension Manifest V3
- Offscreen Document API for persistent audio playback
- `chrome.storage.sync` for settings persistence

## Architecture
| File | Role |
|------|------|
| `manifest.json` | Extension manifest (v2.0.0, MV3) |
| `popup.html/js/css` | UI — player controls + settings view |
| `background.js` | Service worker — message routing, offscreen lifecycle |
| `offscreen.html/js` | Persistent audio playback (survives popup close) |
| `content.js` | Article text extraction + floating mini-player overlay |
| `content-player.css` | Styles for floating mini-player |

## TTS Engines
1. **Edge TTS** (default) — Free, WebSocket to `speech.platform.bing.com` — CURRENTLY BROKEN (WebSocket error)
2. **OpenAI TTS** — `tts-1` model, requires API key
3. **ElevenLabs** — requires API key (default key embedded as fallback)
4. **Browser Local** — `speechSynthesis` API, free, works offline

## Key Issues
- Edge TTS WebSocket fails with "Edge TTS WebSocket error" — needs fix
- Extension source: `/tmp/pagevoice/` → copied to `~/Extensions/pagevoice/`

## Last Updated
2026-03-09
