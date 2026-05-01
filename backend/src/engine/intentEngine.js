import { normalizeText } from "./tokenizer.js";

const GREETINGS = new Set(["hi", "hello", "hey", "hola", "namaste", "namaskar", "namaskaram", "yo", "sup"]);
const THANKS = new Set(["thanks", "thank", "thankyou", "thank you", "thx", "ty", "dhanyavad", "shukriya"]);
const GOODBYES = new Set(["bye", "goodbye", "see ya", "see you", "cya", "take care", "good night", "gn"]);

function clean(value) {
  return normalizeText(value).replace(/[.\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function reply(answer) {
  return {
    answer,
    confidence: 1,
    sources: [],
    chunks: [],
    contradictions: [],
    intent: "conversation"
  };
}

export function detectConversationIntent(query) {
  const text = clean(query);
  if (!text) return null;
  if (GREETINGS.has(text)) return reply("Hi! I’m ready. Ask me anything from your local data, or add new data from the Data panel.");
  if (THANKS.has(text)) return reply("You’re welcome.");
  if (GOODBYES.has(text)) return reply("Bye! I’ll be here when you want to continue.");
  return null;
}
