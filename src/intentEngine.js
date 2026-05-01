import { normalizeText } from "./tokenizer.js";

const GREETING_WORDS = new Set([
  "hi",
  "hello",
  "hey",
  "hola",
  "namaste",
  "namaskar",
  "namaskaram",
  "yo",
  "sup"
]);

const THANKS_WORDS = new Set([
  "thanks",
  "thank",
  "thankyou",
  "thank-you",
  "thx",
  "ty",
  "dhanyavad",
  "shukriya"
]);

const BYE_WORDS = new Set([
  "bye",
  "goodbye",
  "see ya",
  "see you",
  "cya",
  "take care",
  "good night",
  "gn"
]);

function cleanIntentText(value) {
  return normalizeText(value).replace(/[.\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function response(answer) {
  return {
    answer,
    confidence: 1,
    sources: [],
    chunks: [],
    contradictions: [],
    "Direct Answer": answer,
    "Explanation": "Conversational intent handled locally.",
    "Contextual Advice": "Ask a question or add local data when you want source-backed answers.",
    "Suggestions": "Try asking about something you scraped or taught me.",
    metadata: {
      confidence: 1,
      citations: [],
      chunks: [],
      learnedFactCount: 0,
      matchedSources: [],
      contradictions: [],
      intent: "conversation"
    }
  };
}

export function detectConversationIntent(query) {
  const text = cleanIntentText(query);
  if (!text) return null;

  if (GREETING_WORDS.has(text)) {
    return response("Hi! I’m ready. Ask me anything from your local data, or add new data from the Data panel.");
  }

  if (THANKS_WORDS.has(text) || /^thank you\b/.test(text)) {
    return response("You’re welcome.");
  }

  if (BYE_WORDS.has(text)) {
    return response("Bye! I’ll be here when you want to continue.");
  }

  return null;
}
