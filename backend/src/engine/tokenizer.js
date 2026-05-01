const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "how", "i", "in", "into", "is", "it", "its", "match", "no", "of", "on", "or",
  "that", "the", "their", "this", "to", "use", "using", "was", "what", "when",
  "where", "which", "with", "you", "your"
]);

const SYNONYMS = {
  chatbot: ["assistant", "bot", "agent"],
  data: ["content", "source", "knowledge", "document"],
  local: ["offline", "private", "stored"],
  scrape: ["scraping", "crawl", "fetch", "extract"],
  answer: ["response", "result", "reply"],
  accurate: ["accuracy", "relevant", "correct"],
  learn: ["learning", "memory", "remember"]
};

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stem(token) {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function tokenize(value, { expand = false } = {}) {
  const base = normalizeText(value)
    .split(/\s+/)
    .map((token) => stem(token.replace(/^[.-]+|[.-]+$/g, "")))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

  if (!expand) return base;

  const tokens = new Set(base);
  for (const token of base) {
    for (const synonym of SYNONYMS[token] || []) tokens.add(stem(synonym));
  }
  return [...tokens];
}

export function splitSentences(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function splitChunks(value, maxSentences = 3) {
  const sentences = splitSentences(value).filter((sentence) => sentence.split(/\s+/).length >= 5);
  const chunks = [];
  for (let index = 0; index < sentences.length; index += maxSentences) {
    chunks.push(sentences.slice(index, index + maxSentences).join(" "));
  }
  return chunks;
}
