const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "match",
  "no",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "use",
  "using",
  "was",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
  "your"
]);

const SYNONYMS = {
  ai: ["artificial", "intelligence", "chatbot", "assistant"],
  answer: ["response", "reply", "result"],
  chatbot: ["assistant", "bot", "agent"],
  clean: ["cleaning", "remove", "filter", "deduplicate"],
  data: ["content", "source", "scraped", "knowledge"],
  local: ["offline", "private", "machine"],
  rank: ["score", "relevance", "match", "search"],
  semantic: ["meaning", "intent", "concept", "similar"]
};

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value, { keepStopWords = false } = {}) {
  const tokens = normalizeText(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean);

  if (keepStopWords) return tokens;
  return tokens.filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function expandTokens(tokens) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const stem = stemToken(token);
    expanded.add(stem);
    for (const synonym of SYNONYMS[token] || []) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

export function stemToken(token) {
  if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith("es")) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
  return token;
}

export function splitSentences(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function jaccardSimilarity(leftTokens, rightTokens) {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }

  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
