// Background service worker for TTS
let currentAudio = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "speak" && request.mode === "elevenlabs") {
    speakWithElevenLabs(request.text, request.apiKey, request.voice);
  } else if (request.action === "stop") {
    stopAudio();
  }
});

async function speakWithElevenLabs(text, apiKey, voiceId) {
  try {
    const chunks = splitTextIntoChunks(text, 2500);
    
    for (let i = 0; i < chunks.length; i++) {
      notifyPopup({ status: `Reading chunk ${i + 1}/${chunks.length}...` });

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": apiKey
        },
        body: JSON.stringify({
          text: chunks[i],
          model_id: "eleven_monolingual_v1",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        })
      });

      if (!response.ok) {
        throw new Error(`ElevenLabs API error: ${response.statusText}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      await playAudio(audioUrl);
    }

    notifyPopup({ state: "ended", status: "Finished reading" });
  } catch (error) {
    console.error("ElevenLabs error:", error);
    notifyPopup({ state: "error", status: `Error: ${error.message}` });
  }
}

function playAudio(url) {
  return new Promise((resolve, reject) => {
    currentAudio = new Audio(url);
    
    currentAudio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    
    currentAudio.onerror = (error) => {
      URL.revokeObjectURL(url);
      reject(error);
    };
    
    currentAudio.play();
  });
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

function splitTextIntoChunks(text, maxLength) {
  const chunks = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  let currentChunk = "";
  
  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxLength) {
      if (currentChunk) chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk.trim());
  
  return chunks;
}

function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}
