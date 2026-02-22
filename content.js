// Extract article text from the page
function extractArticleText() {
  // Get all paragraph text first (most reliable)
  let paragraphs = Array.from(document.querySelectorAll("p"))
    .map(p => p.innerText.trim())
    .filter(text => text.length > 30);

  if (paragraphs.length >= 3) {
    return paragraphs.join("\n\n");
  }

  // Try article/main selectors
  const selectors = [
    "article",
    "[role=\"article\"]",
    ".article-content",
    ".post-content", 
    ".entry-content",
    ".post",
    ".content",
    "main"
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      const text = element.innerText.trim();
      if (text.length > 200) {
        return text;
      }
    }
  }

  // Last resort: get body text
  const bodyText = document.body.innerText;
  if (bodyText.length > 200) {
    return bodyText.substring(0, 50000); // Limit to 50k chars
  }

  return null;
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getArticleText") {
    const text = extractArticleText();
    console.log("Extracted text length:", text ? text.length : 0);
    sendResponse({ text });
  }
  return true; // Keep channel open for async response
});

console.log("Article Reader content script loaded");
