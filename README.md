# 🔊 PageVoice

A Chrome extension that reads web articles aloud using text-to-speech. Supports both **ElevenLabs** (high-quality AI voices) and **local browser TTS** (free, no API key needed).

![PageVoice Preview](preview.png)

## Features

- 📖 **Smart Article Extraction** - Automatically extracts article content from any webpage
- 🎙️ **Dual TTS Engines** - Switch between ElevenLabs and local browser voices
- ⏯️ **Playback Controls** - Play, pause, stop, and resume reading
- ⚡ **Speed Control** - Adjust reading speed from 0.5x to 2x
- 💾 **Persistent Settings** - Your preferences are saved across sessions
- 🌙 **Dark Mode UI** - Clean, modern interface

## Installation

### Method 1: Load Unpacked (Developer Mode)

1. **Download or clone this repo:**

    git clone https://github.com/henrino3/pagevoice.git

   Or download the ZIP and extract it.

2. Open Chrome and go to `chrome://extensions/`

3. Enable **Developer mode** (toggle in top-right corner)

4. Click **Load unpacked**

5. Select the `pagevoice` folder

6. Pin the extension: Click the puzzle piece icon in Chrome toolbar, find "PageVoice", click the pin

### Method 2: Pack the Extension

1. Go to `chrome://extensions/`
2. Click **Pack extension**
3. Select the `pagevoice` folder as the extension root
4. Chrome will create a `.crx` file you can install

## Usage

1. **Navigate to any article** or blog post

2. **Click the PageVoice icon** in your Chrome toolbar

3. **Choose your TTS engine:**
   - **Local TTS** - Uses your browser's built-in voices (free, no setup)
   - **ElevenLabs** - Premium AI voices (requires API key)

4. **Select a voice** from the dropdown

5. **Adjust speed** if needed (default: 1x)

6. Click **▶️ Read** to start listening

### ElevenLabs Setup

To use ElevenLabs voices:
1. Get an API key from [elevenlabs.io](https://elevenlabs.io)
2. Paste it in the API Key field
3. Select your preferred voice
4. Start reading!

## Available Voices

### ElevenLabs (Premium)
- **Sarah** - Natural female voice (default)
- **Rachel** - Clear female voice
- **Domi** - Warm female voice
- **Adam** - Natural male voice

### Local TTS
Uses your system's built-in voices. Options vary by operating system.

## Technical Details

- **Manifest Version:** 3 (MV3)
- **Permissions:** storage, activeTab, scripting
- **Host Permissions:** https://api.elevenlabs.io/*

## File Structure

```
pagevoice/
├── manifest.json      # Extension configuration
├── popup.html         # Extension popup UI
├── popup.js           # Popup logic and TTS controls
├── background.js      # Service worker for audio
├── content.js         # Article extraction script
├── styles.css         # Popup styling
├── icon-16.png        # Toolbar icon (16x16)
├── icon-48.png        # Extension management icon
├── icon-128.png       # Chrome Web Store icon
└── README.md          # This file
```

## Troubleshooting

### "Could not extract text"
- Refresh the page and try again
- Some pages may block content scripts

### ElevenLabs not working
- Check your API key is valid
- Ensure you have API credits available

### No sound
- Check your system volume
- Try a different voice
- For local TTS, ensure your OS has voices installed

## License

MIT - Feel free to modify and distribute!

---

Made with ❤️ by [Henry Mascot](https://github.com/henrino3)
